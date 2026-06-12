import type {
  DashboardHeatmapDayContract,
  DashboardMetaContract,
  DashboardOverviewContract,
  DashboardRecentSessionContract,
  DashboardSelectionContract,
  DashboardSummaryContract,
} from "../../../contracts/dashboard.js";
import type {
  DashboardHeatmapDayRow,
  DashboardRecentSessionRow,
  DashboardSummaryRow,
} from "../../../repositories/dashboard/dashboard-queries.js";

export interface DashboardOverviewSource {
  summary: DashboardSummaryRow;
  heatmapDays: DashboardHeatmapDayRow[];
  recentSessions: DashboardRecentSessionRow[];
}

export function projectOverview(
  source: DashboardOverviewSource,
  selection: DashboardSelectionContract,
  meta: DashboardMetaContract,
  generatedAt: string,
): DashboardOverviewContract {
  const summary: DashboardSummaryContract = {
    totalSessions: source.summary.totalSessions,
    totalTokens: source.summary.totalTokens,
    totalCost: source.summary.totalCost,
    activeProjects: source.summary.activeProjects,
  };

  const recentSessions: DashboardRecentSessionContract[] =
    source.recentSessions.map((session) => ({
      id: session.id,
      title: session.title,
      directory: session.directory,
      timeUpdated: session.timeUpdated,
      totalTokens: session.totalTokens,
    }));

  const heatmapDays: DashboardHeatmapDayContract[] = source.heatmapDays.map(
    (entry) => ({ day: entry.day, count: entry.count }),
  );

  return {
    kind: "dashboard.overview",
    generatedAt,
    selection,
    summary,
    recentSessions,
    heatmapDays,
    meta,
  };
}
