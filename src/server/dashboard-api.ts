import { Hono } from "hono";
import {
  DASHBOARD_RANGES,
  DASHBOARD_VIEWS,
  type DashboardContract,
  type DashboardRangeContract,
  type DashboardViewContract,
} from "../contracts/dashboard.js";
import { getDb } from "../lib/db.js";
import {
  buildDashboardAggregateState,
  buildDashboardViewModel,
} from "../services/dashboard/dashboard-service.js";

function parseDashboardRange(
  rawRange: string | undefined,
): DashboardRangeContract {
  if (rawRange && (DASHBOARD_RANGES as readonly string[]).includes(rawRange)) {
    return rawRange as DashboardRangeContract;
  }
  return "all";
}

function parseDashboardView(
  rawView: string | undefined,
): DashboardViewContract {
  if (rawView && (DASHBOARD_VIEWS as readonly string[]).includes(rawView)) {
    return rawView as DashboardViewContract;
  }
  return "daily";
}

export const dashboardApi = new Hono().get("/", (c) => {
  const range = parseDashboardRange(c.req.query("range"));
  const view = parseDashboardView(c.req.query("view"));

  const db = getDb();
  try {
    const aggregate = buildDashboardAggregateState(db);
    const vm = buildDashboardViewModel(db, aggregate, range, view);

    const response: DashboardContract = {
      kind: "dashboard.snapshot",
      generatedAt: new Date().toISOString(),
      range,
      view,
      summary: vm.summary,
      recentSessions: vm.recentSessions,
      heatmapDays: vm.heatmapDays.map((entry) => ({
        day: entry.day,
        count: entry.cnt,
      })),
      errorTrendSeries: vm.errorTrendSeries,
      tokenTrend: vm.tokenTrend,
      subagentTrend: vm.subagentTrend,
      activeRepos: vm.activeRepos,
      modelUsage: vm.modelUsage,
      toolUsage: vm.toolUsage,
      agentDistribution: vm.agentDistribution,
      mcpUsage: vm.mcpUsage,
      toolReliabilityMatrix: vm.toolReliabilityMatrix,
      errorPatterns: vm.errorPatterns,
    };

    return c.json(response);
  } finally {
    db.close();
  }
});
