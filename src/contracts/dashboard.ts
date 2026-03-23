export const DASHBOARD_RANGES = ["all", "month", "week", "day"] as const;
export type DashboardRangeContract = (typeof DASHBOARD_RANGES)[number];

export const DASHBOARD_PRESETS = [
  "today",
  "last7d",
  "last30d",
  "custom",
] as const;
export type DashboardPresetContract = (typeof DASHBOARD_PRESETS)[number];

export const DASHBOARD_MAX_CUSTOM_DAYS = 90;

export interface DashboardSelectionBoundsContract {
  startDayInclusive: string;
  endDayInclusive: string;
  endDayExclusive: string;
  dayCount: number;
}

export interface DashboardSelectionContract {
  preset: DashboardPresetContract;
  start: string;
  end: string;
  view: DashboardViewContract;
  timezone: string;
  refreshable: boolean;
  bounds: DashboardSelectionBoundsContract;
}

export const DASHBOARD_VIEWS = ["daily", "hourly"] as const;
export type DashboardViewContract = (typeof DASHBOARD_VIEWS)[number];

export interface DashboardSummaryContract {
  totalSessions: number;
  totalTokens: number;
  totalToolCalls: number;
  toolErrors: number;
  toolErrorRate: string;
  activeProjects: number;
}

export interface DashboardRecentSessionContract {
  id: string;
  title: string;
  directory: string;
  timeUpdated: number;
  totalTokens: number;
}

export interface DashboardHeatmapDayContract {
  day: string;
  count: number;
}

export interface DashboardDayValueContract {
  day: string;
  value: number;
}

export interface DashboardLineSeriesContract {
  label: string;
  color: string;
  points: DashboardDayValueContract[];
}

export interface DashboardStackValueContract {
  name: string;
  value: number;
  color: string;
}

export interface DashboardStackBarContract {
  label: string;
  stacks: DashboardStackValueContract[];
}

export interface DashboardTokenTrendContract {
  inputRatioPercent: number;
  dailySeries: DashboardLineSeriesContract[];
  hourlyBars: DashboardStackBarContract[];
}

export interface DashboardSubagentTrendContract {
  dailySeries: DashboardLineSeriesContract[];
  hourlyBars: DashboardStackBarContract[];
}

export interface DashboardRepoDayCellContract {
  day: string;
  label: string;
  muted: boolean;
}

export interface DashboardRepoRowContract {
  repo: string;
  dayCells: DashboardRepoDayCellContract[];
  totalLabel: string;
}

export interface DashboardRepoBreakdownContract {
  dayHeaders: string[];
  rows: DashboardRepoRowContract[];
}

export interface DashboardMcpUsageRowContract {
  server: string;
  calls: number;
  errors: number;
  errorRate: number;
  isBuiltin: boolean;
}

export interface DashboardToolReliabilityRowContract {
  tool: string;
  success: number;
  error: number;
  total: number;
  errorRate: number;
}

export interface DashboardBarItemContract {
  label: string;
  count: number;
}

export interface DashboardContract {
  kind: "dashboard.snapshot";
  generatedAt: string;
  selection: DashboardSelectionContract;
  summary: DashboardSummaryContract;
  recentSessions: DashboardRecentSessionContract[];
  heatmapDays: DashboardHeatmapDayContract[];
  errorTrendSeries: DashboardLineSeriesContract[];
  errorTrendHourlyBars: DashboardStackBarContract[];
  tokenTrend: DashboardTokenTrendContract;
  subagentTrend: DashboardSubagentTrendContract;
  activeRepos: DashboardRepoBreakdownContract;
  modelUsage: DashboardBarItemContract[];
  modelPerformance: DashboardBarItemContract[];
  modelTokenConsumption: DashboardBarItemContract[];
  toolUsage: DashboardBarItemContract[];
  agentDistribution: DashboardBarItemContract[];
  mcpUsage: DashboardMcpUsageRowContract[];
  toolReliabilityMatrix: DashboardToolReliabilityRowContract[];
  errorPatterns: DashboardBarItemContract[];
}
