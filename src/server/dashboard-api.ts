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
} from "../lib/dashboard-time.js";
import { getDb } from "../lib/db.js";
import { type DashboardRepositoryWindow } from "../repositories/dashboard/dashboard-repository.js";
import {
  buildBoundedSelection,
  buildDashboardViewModelForWindow,
  isDashboardSelectionRefreshable,
  materializeDashboardCacheWindow,
} from "../services/dashboard/dashboard-service.js";
import {
  getDashboardAggregationStoreSnapshotForTests,
  invalidateDashboardAggregationStore,
  invalidateDashboardAggregationStoreForDays,
  overrideDashboardAggregationStoreMetadataForTests,
  readDashboardProjectionSourceFromStore,
  readDashboardProjectionMemoFromStore,
  reconcileDashboardAggregationStore,
} from "../services/dashboard/dashboard-aggregation-store.js";

export interface DashboardSnapshotRequest {
  range: DashboardRangeContract;
  view: DashboardViewContract;
  window?: DashboardRepositoryWindow;
  selection?: DashboardSelectionContract;
}

function buildSelection(
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

export function readDashboardSnapshot(
  db: import("better-sqlite3").Database,
  request: DashboardSnapshotRequest,
  now = new Date(),
): DashboardContract {
  const window =
    request.window ?? materializeDashboardCacheWindow(request.range);
  const selection =
    request.selection ?? buildSelection(request.range, request.view, window, now);

  reconcileDashboardAggregationStore(db, window, now);

  return readDashboardProjectionMemoFromStore({
    window,
    view: request.view,
    now,
    buildResponse: (generatedAt) => {
      const source = readDashboardProjectionSourceFromStore(window, now);
      const vm = buildDashboardViewModelForWindow(
        source,
        window,
        request.range,
        request.view,
      );

      return {
        kind: "dashboard.snapshot",
        generatedAt,
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
        modelPerformanceStats: vm.modelPerformanceStats,
        modelTokenConsumption: vm.modelTokenConsumption,
        toolUsage: vm.toolUsage,
        agentDistribution: vm.agentDistribution,
        mcpUsage: vm.mcpUsage,
        toolReliabilityMatrix: vm.toolReliabilityMatrix,
        errorPatterns: vm.errorPatterns,
      };
    },
  });
}

export function invalidateDashboardApiCache() {
  invalidateDashboardAggregationStore();
}

export function invalidateDashboardApiCacheForDays(days: string[]) {
  invalidateDashboardAggregationStoreForDays(days);
}

export function overrideDashboardApiCacheMetadataForTests(overrides: {
  timezone?: string;
  semanticsVersion?: string;
}) {
  overrideDashboardAggregationStoreMetadataForTests(overrides);
}

export function getDashboardApiCacheSnapshotForTests() {
  return getDashboardAggregationStoreSnapshotForTests();
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
