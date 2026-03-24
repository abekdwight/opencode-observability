import { Hono } from "hono";
import type {
  DashboardContract,
  DashboardRangeContract,
  DashboardSelectionContract,
  DashboardViewContract,
} from "../contracts/dashboard.js";
import {
  deriveDashboardRangeFromSelection,
  normalizeDashboardSelectionInput,
  resolveDashboardTimezone,
  toLocalDateString,
} from "../lib/dashboard-time.js";
import { getDb } from "../lib/db.js";
import {
  type DashboardCacheStamp,
  type DashboardRepositoryWindow,
  readDashboardCacheStamp,
  readDashboardChangedDaysSince,
} from "../repositories/dashboard/dashboard-repository.js";
import {
  addLocalDays,
  buildBoundedSelection,
  buildDashboardAggregateStateForWindow,
  buildDashboardViewModelForWindow,
  type DashboardAggregateState,
  isDashboardSelectionRefreshable,
  materializeDashboardCacheWindow,
  mergeDashboardAggregateStates,
  updateDashboardAggregateStateForWindow,
} from "../services/dashboard/dashboard-service.js";

const LIVE_WINDOW_REFRESH_MS = 30_000;
const DASHBOARD_CACHE_SEMANTICS_VERSION = "day-bucket-window-view-v1";

interface DashboardDayBucketCacheEntry {
  day: string;
  window: DashboardRepositoryWindow;
  state: DashboardAggregateState;
  refreshedAt: number;
}

interface DashboardViewCacheEntry {
  window: DashboardRepositoryWindow;
  view: DashboardViewContract;
  response: DashboardContract;
  refreshedAt: number;
}

interface DashboardApiCacheStore {
  dayBuckets: Map<string, DashboardDayBucketCacheEntry>;
  viewModels: Map<string, DashboardViewCacheEntry>;
  dayToViewKeys: Map<string, Set<string>>;
  stamp: DashboardCacheStamp | null;
  semanticsVersion: string;
}

export interface DashboardSnapshotRequest {
  range: DashboardRangeContract;
  view: DashboardViewContract;
  window?: DashboardRepositoryWindow;
  selection?: DashboardSelectionContract;
}

const dashboardApiCache: DashboardApiCacheStore = {
  dayBuckets: new Map(),
  viewModels: new Map(),
  dayToViewKeys: new Map(),
  stamp: null,
  semanticsVersion: DASHBOARD_CACHE_SEMANTICS_VERSION,
};

function toWindowEndInclusive(window: DashboardRepositoryWindow): string {
  return addLocalDays(window.endDayExclusive, -1);
}

function buildWindowKey(window: DashboardRepositoryWindow): string {
  return `${window.startDayInclusive}:${toWindowEndInclusive(window)}`;
}

function buildViewKey(
  window: DashboardRepositoryWindow,
  view: DashboardViewContract,
): string {
  return `${buildWindowKey(window)}:${view}`;
}

function shouldRefreshLiveEntry(refreshedAt: number, nowMs: number): boolean {
  return nowMs - refreshedAt >= LIVE_WINDOW_REFRESH_MS;
}

function buildSingleDayWindow(day: string): DashboardRepositoryWindow {
  return {
    startDayInclusive: day,
    endDayExclusive: addLocalDays(day, 1),
  };
}

function listDaysInWindow(window: DashboardRepositoryWindow): string[] {
  const days: string[] = [];
  const endDayInclusive = toWindowEndInclusive(window);
  let cursor = window.startDayInclusive;
  while (cursor <= endDayInclusive) {
    days.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return days;
}

function deleteViewKeyFromIndex(viewKey: string) {
  for (const [day, keys] of dashboardApiCache.dayToViewKeys) {
    keys.delete(viewKey);
    if (keys.size === 0) {
      dashboardApiCache.dayToViewKeys.delete(day);
    }
  }
}

function rememberViewKeyForWindow(
  viewKey: string,
  window: DashboardRepositoryWindow,
) {
  for (const day of listDaysInWindow(window)) {
    let keys = dashboardApiCache.dayToViewKeys.get(day);
    if (!keys) {
      keys = new Set<string>();
      dashboardApiCache.dayToViewKeys.set(day, keys);
    }
    keys.add(viewKey);
  }
}

function clearDashboardApiCache() {
  dashboardApiCache.dayBuckets.clear();
  dashboardApiCache.viewModels.clear();
  dashboardApiCache.dayToViewKeys.clear();
}

function invalidateDayBucketsAndViews(days: string[]) {
  const normalizedDays = Array.from(new Set(days.filter(Boolean))).sort();
  if (normalizedDays.length === 0) {
    return;
  }

  const viewKeysToDelete = new Set<string>();

  for (const day of normalizedDays) {
    dashboardApiCache.dayBuckets.delete(day);

    const indexedViewKeys = dashboardApiCache.dayToViewKeys.get(day);
    if (indexedViewKeys) {
      for (const viewKey of indexedViewKeys) {
        viewKeysToDelete.add(viewKey);
      }
      dashboardApiCache.dayToViewKeys.delete(day);
    }
  }

  for (const viewKey of viewKeysToDelete) {
    dashboardApiCache.viewModels.delete(viewKey);
    deleteViewKeyFromIndex(viewKey);
  }
}

function reconcileDashboardApiCache(db: import("better-sqlite3").Database) {
  if (
    dashboardApiCache.semanticsVersion !== DASHBOARD_CACHE_SEMANTICS_VERSION
  ) {
    clearDashboardApiCache();
    dashboardApiCache.semanticsVersion = DASHBOARD_CACHE_SEMANTICS_VERSION;
    dashboardApiCache.stamp = null;
  }

  const nextStamp = readDashboardCacheStamp(db);
  const previousStamp = dashboardApiCache.stamp;
  dashboardApiCache.stamp = nextStamp;

  if (!previousStamp) {
    return;
  }

  if (nextStamp.rootSessionCount < previousStamp.rootSessionCount) {
    clearDashboardApiCache();
    return;
  }

  const stampChanged =
    nextStamp.partRowId !== previousStamp.partRowId ||
    nextStamp.messageRowId !== previousStamp.messageRowId ||
    nextStamp.sessionRowId !== previousStamp.sessionRowId ||
    nextStamp.maxPartUpdatedAt !== previousStamp.maxPartUpdatedAt ||
    nextStamp.maxMessageUpdatedAt !== previousStamp.maxMessageUpdatedAt ||
    nextStamp.maxSessionUpdatedAt !== previousStamp.maxSessionUpdatedAt;

  if (!stampChanged) {
    return;
  }

  invalidateDayBucketsAndViews(
    readDashboardChangedDaysSince(db, previousStamp),
  );
}

function buildLegacySelection(
  range: DashboardRangeContract,
  view: DashboardViewContract,
  window: DashboardRepositoryWindow,
  now = new Date(),
): DashboardSelectionContract {
  const bounds = buildBoundedSelection(window);
  return {
    preset:
      range === "day"
        ? "today"
        : range === "week"
          ? "last7d"
          : range === "month"
            ? "last30d"
            : "custom",
    start: bounds.startDayInclusive,
    end: bounds.endDayInclusive,
    view,
    timezone: resolveDashboardTimezone(),
    refreshable: isDashboardSelectionRefreshable(bounds, now),
    bounds,
  };
}

function resolveWindowStateFromDayBuckets(
  db: import("better-sqlite3").Database,
  window: DashboardRepositoryWindow,
  nowMs: number,
  refreshable: boolean,
  now = new Date(),
): DashboardAggregateState {
  const states: DashboardAggregateState[] = [];
  const today = toLocalDateString(now);

  for (const day of listDaysInWindow(window)) {
    const dayWindow = buildSingleDayWindow(day);
    const cached = dashboardApiCache.dayBuckets.get(day);

    if (!cached) {
      const state = buildDashboardAggregateStateForWindow(db, dayWindow);
      dashboardApiCache.dayBuckets.set(day, {
        day,
        window: dayWindow,
        state,
        refreshedAt: nowMs,
      });
      states.push(state);
      continue;
    }

    if (
      refreshable &&
      day === today &&
      shouldRefreshLiveEntry(cached.refreshedAt, nowMs)
    ) {
      cached.state = updateDashboardAggregateStateForWindow(
        db,
        cached.state,
        cached.window,
      );
      cached.refreshedAt = nowMs;
    }

    states.push(cached.state);
  }

  return mergeDashboardAggregateStates(states);
}

export function readDashboardSnapshot(
  db: import("better-sqlite3").Database,
  request: DashboardSnapshotRequest,
  now = new Date(),
): DashboardContract {
  const nowMs = now.getTime();
  const window =
    request.window ?? materializeDashboardCacheWindow(request.range);
  const selection =
    request.selection ??
    buildLegacySelection(request.range, request.view, window, now);
  const refreshable = isDashboardSelectionRefreshable(selection.bounds, now);
  const viewKey = buildViewKey(window, request.view);
  const cachedView = dashboardApiCache.viewModels.get(viewKey);

  if (
    refreshable &&
    cachedView &&
    !shouldRefreshLiveEntry(cachedView.refreshedAt, nowMs)
  ) {
    return cachedView.response;
  }

  reconcileDashboardApiCache(db);

  if (!refreshable) {
    const historicalView = dashboardApiCache.viewModels.get(viewKey);
    if (historicalView) {
      return historicalView.response;
    }
  }

  const state = resolveWindowStateFromDayBuckets(
    db,
    window,
    nowMs,
    refreshable,
    now,
  );
  const vm = buildDashboardViewModelForWindow(
    db,
    state,
    window,
    request.range,
    request.view,
  );

  const response: DashboardContract = {
    kind: "dashboard.snapshot",
    generatedAt: now.toISOString(),
    selection,
    summary: vm.summary,
    recentSessions: vm.recentSessions,
    heatmapDays: vm.heatmapDays.map((entry) => ({
      day: entry.day,
      count: entry.cnt,
    })),
    errorTrendSeries: vm.errorTrendSeries,
    errorTrendHourlyBars: vm.errorTrendHourlyBars,
    tokenTrend: vm.tokenTrend,
    subagentTrend: vm.subagentTrend,
    activeRepos: vm.activeRepos,
    modelUsage: vm.modelUsage,
    modelPerformance: vm.modelPerformance,
    modelPerformanceStats: vm.modelPerformanceStats,
    modelTokenConsumption: vm.modelTokenConsumption,
    toolUsage: vm.toolUsage,
    agentDistribution: vm.agentDistribution,
    mcpUsage: vm.mcpUsage,
    toolReliabilityMatrix: vm.toolReliabilityMatrix,
    errorPatterns: vm.errorPatterns,
  };

  if (dashboardApiCache.viewModels.has(viewKey)) {
    deleteViewKeyFromIndex(viewKey);
  }

  dashboardApiCache.viewModels.set(viewKey, {
    window,
    view: request.view,
    response,
    refreshedAt: nowMs,
  });
  rememberViewKeyForWindow(viewKey, window);

  return response;
}

export function invalidateDashboardApiCache() {
  clearDashboardApiCache();
  dashboardApiCache.stamp = null;
}

export function invalidateDashboardApiCacheForDays(days: string[]) {
  invalidateDayBucketsAndViews(days);
}

export function getDashboardApiCacheSnapshotForTests() {
  const dayKeys = Array.from(dashboardApiCache.dayBuckets.keys()).sort();
  return {
    dayKeys,
    rawKeys: dayKeys,
    viewKeys: Array.from(dashboardApiCache.viewModels.keys()).sort(),
    semanticsVersion: dashboardApiCache.semanticsVersion,
    stamp: dashboardApiCache.stamp,
  };
}

export const dashboardApi = new Hono().get("/", (c) => {
  const selectionResult = normalizeDashboardSelectionInput({
    preset: c.req.query("preset"),
    start: c.req.query("start"),
    end: c.req.query("end"),
    view: c.req.query("view"),
  });

  if (!selectionResult.ok) {
    return c.json({ message: selectionResult.message }, 400);
  }

  const range = deriveDashboardRangeFromSelection(selectionResult.selection);
  const view = selectionResult.selection.view;

  const db = getDb();
  try {
    return c.json(
      readDashboardSnapshot(db, {
        range,
        view,
        window: selectionResult.window,
        selection: selectionResult.selection,
      }),
    );
  } finally {
    db.close();
  }
});
