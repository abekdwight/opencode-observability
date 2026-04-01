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

  const changedDays = readDashboardChangedDaysSince(db, previousStamp);
  if (changedDays.length === 0) {
    clearDashboardApiCache();
    return;
  }

  invalidateDayBucketsAndViews(changedDays);
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

function extractLastSegment(value: string): string {
  const lastTab = value.lastIndexOf("\t");
  return lastTab >= 0 ? value.slice(lastTab + 1) : value;
}

function extractFirstSegment(value: string): string {
  const firstTab = value.indexOf("\t");
  return firstTab >= 0 ? value.slice(0, firstTab) : value;
}

function extractMiddleSegmentBeforeLast(value: string): string {
  const lastTab = value.lastIndexOf("\t");
  if (lastTab < 0) {
    return "";
  }
  const beforeLastTab = value.lastIndexOf("\t", lastTab - 1);
  if (beforeLastTab < 0) {
    return "";
  }
  return value.slice(beforeLastTab + 1, lastTab);
}

function filterKeyedMapByDay(
  source: Map<string, number>,
  extractDay: (value: string) => string,
  day: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of source) {
    if (extractDay(key) === day) {
      out.set(key, value);
    }
  }
  return out;
}

function filterExactDayMap(
  source: Map<string, number>,
  day: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of source) {
    if (key === day) {
      out.set(key, value);
    }
  }
  return out;
}

function sumKeyedMapByDay(
  source: Map<string, number>,
  extractDay: (value: string) => string,
  day: string,
): number {
  let total = 0;
  for (const [key, value] of source) {
    if (extractDay(key) === day) {
      total += value;
    }
  }
  return total;
}

function buildDayAggregateStateFromWindowState(
  source: DashboardAggregateState,
  day: string,
): DashboardAggregateState {
  return {
    toolDayBuckets: filterKeyedMapByDay(
      source.toolDayBuckets,
      extractLastSegment,
      day,
    ),
    errorPatternDays: filterKeyedMapByDay(
      source.errorPatternDays,
      extractLastSegment,
      day,
    ),
    toolErrorDetails: filterKeyedMapByDay(
      source.toolErrorDetails,
      extractLastSegment,
      day,
    ),
    mcpServerBuckets: filterKeyedMapByDay(
      source.mcpServerBuckets,
      extractLastSegment,
      day,
    ),
    lastPartRowid: source.lastPartRowid,
    modelDays: filterKeyedMapByDay(source.modelDays, extractLastSegment, day),
    modelTokenDays: filterKeyedMapByDay(
      source.modelTokenDays,
      extractLastSegment,
      day,
    ),
    agentDays: filterKeyedMapByDay(source.agentDays, extractLastSegment, day),
    tokenDays: filterExactDayMap(source.tokenDays, day),
    tokenInputDays: filterExactDayMap(source.tokenInputDays, day),
    tokenOutputDays: filterExactDayMap(source.tokenOutputDays, day),
    tokenInputHours: filterKeyedMapByDay(
      source.tokenInputHours,
      extractFirstSegment,
      day,
    ),
    tokenOutputHours: filterKeyedMapByDay(
      source.tokenOutputHours,
      extractFirstSegment,
      day,
    ),
    subagentDays: filterKeyedMapByDay(
      source.subagentDays,
      extractLastSegment,
      day,
    ),
    subagentHours: filterKeyedMapByDay(
      source.subagentHours,
      extractMiddleSegmentBeforeLast,
      day,
    ),
    lastMessageRowid: source.lastMessageRowid,
    sessionCount: sumKeyedMapByDay(source.repoDays, extractLastSegment, day),
    repoDays: filterKeyedMapByDay(source.repoDays, extractLastSegment, day),
    lastSessionRowid: source.lastSessionRowid,
  };
}

function resolveWindowStateFromDayBuckets(
  db: import("better-sqlite3").Database,
  window: DashboardRepositoryWindow,
  nowMs: number,
  refreshable: boolean,
  now = new Date(),
): DashboardAggregateState {
  const daysInWindow = listDaysInWindow(window);
  const missingDays = daysInWindow.filter(
    (day) => !dashboardApiCache.dayBuckets.has(day),
  );

  // On cold start, avoid N-day fanout queries by building once for the
  // whole window. This keeps first dashboard render latency bounded.
  if (daysInWindow.length > 1 && missingDays.length === daysInWindow.length) {
    const windowState = buildDashboardAggregateStateForWindow(db, window);
    for (const day of daysInWindow) {
      const dayWindow = buildSingleDayWindow(day);
      dashboardApiCache.dayBuckets.set(day, {
        day,
        window: dayWindow,
        state: buildDayAggregateStateFromWindowState(windowState, day),
        refreshedAt: nowMs,
      });
    }
    return windowState;
  }

  const states: DashboardAggregateState[] = [];
  const today = toLocalDateString(now);

  for (const day of daysInWindow) {
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
