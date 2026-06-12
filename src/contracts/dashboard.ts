// Dashboard contracts (Wave 1 re-architecture).
//
// Source-purity axis: each endpoint is classified by how heavy its source is.
//   - overview  : session table only -> always ready (ms-level), never "building".
//   - activity  : message atoms      -> may be "building" while atoms warm up.
//   - models    : message atoms      -> may be "building".
//   - tools     : part atoms         -> may be "building".
//
// The heavy endpoints return a discriminated union so the UI can render a
// skeleton + progress while the aggregator builds atoms in the background.

export const DASHBOARD_PRESETS = [
  "today",
  "last7d",
  "last30d",
  "custom",
] as const;
export type DashboardPresetContract = (typeof DASHBOARD_PRESETS)[number];

// Custom ranges (and therefore the whole aggregation horizon) are capped at 90
// days. The "all" range concept has been removed: there is no unbounded query.
export const DASHBOARD_MAX_CUSTOM_DAYS = 90;

export const DASHBOARD_VIEWS = ["daily", "hourly"] as const;
export type DashboardViewContract = (typeof DASHBOARD_VIEWS)[number];

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

// Rollup state shared by every endpoint via overview.meta. The UI polls
// overview every 30s; activity/models/tools are re-fetched only when this
// generation changes or the selection changes.
export interface DashboardRollupStatusContract {
  state: "building" | "ready";
  progressPercent: number;
}

export interface DashboardMetaContract {
  generation: number;
  rollup: DashboardRollupStatusContract;
}

// ---------------------------------------------------------------------------
// Overview (always ready, session-table sourced)
// ---------------------------------------------------------------------------

export interface DashboardSummaryContract {
  // Attribution: summary metrics are keyed on session.time_created.
  // totalSessions/totalTokens/totalCost/activeProjects count root sessions
  // whose time_created falls in [startDayInclusive, endDayInclusive].
  // totalTokens is the sum over those roots of session.tokens_input +
  // tokens_output + tokens_cache_read + tokens_cache_write.
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  activeProjects: number;
}

export interface DashboardRecentSessionContract {
  // Attribution: recentSessions are the 5 most recently updated root sessions
  // (ORDER BY session.time_updated DESC), independent of the selection window.
  // totalTokens here is the recursive root+descendant token sum.
  id: string;
  title: string;
  directory: string;
  timeUpdated: number;
  totalTokens: number;
}

export interface DashboardHeatmapDayContract {
  // Attribution: keyed on session.time_created over a trailing 365-day window.
  day: string;
  count: number;
}

export interface DashboardOverviewContract {
  kind: "dashboard.overview";
  generatedAt: string;
  selection: DashboardSelectionContract;
  summary: DashboardSummaryContract;
  recentSessions: DashboardRecentSessionContract[];
  heatmapDays: DashboardHeatmapDayContract[];
  meta: DashboardMetaContract;
}

// ---------------------------------------------------------------------------
// Shared chart primitives (used by activity/models/tools data payloads)
// ---------------------------------------------------------------------------

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

export interface DashboardBarItemContract {
  label: string;
  count: number;
  annotation?: string;
}

// ---------------------------------------------------------------------------
// Activity (message atoms)
// ---------------------------------------------------------------------------

export interface DashboardTokenTrendContract {
  inputRatioPercent: number;
  dailySeries: DashboardLineSeriesContract[];
  hourlyBars: DashboardStackBarContract[];
}

export interface DashboardSubagentTrendContract {
  dailySeries: DashboardLineSeriesContract[];
  hourlyBars: DashboardStackBarContract[];
}

// Active Repositories: a repo x day cross-table. A repo bucket is derived from
// a root session's worktree/directory (see resolveRepoBucketKey). Each cell
// shows active duration (preferred) or, lacking duration, a session count;
// `muted` is reserved for de-emphasized cells (currently always false). The
// `dayHeaders` cover every day in the selection window inclusively.
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

export interface DashboardActivityDataContract {
  tokenTrend: DashboardTokenTrendContract;
  subagentTrend: DashboardSubagentTrendContract;
  activeRepos: DashboardRepoBreakdownContract;
}

// ---------------------------------------------------------------------------
// Models (message atoms)
// ---------------------------------------------------------------------------

export interface DashboardModelTokenConsumptionRowContract {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  nonCacheInputTokens: number;
  inputTotalTokens: number;
  totalTokens: number;
}

export interface DashboardModelPerformanceStatsRowContract {
  model: string;
  provider: string;
  avgTps: number | null;
  tpsP10: number | null;
  tpsP50: number | null;
  tpsP90: number | null;
  tpsP99: number | null;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  latencyP99Ms: number | null;
  totalMessages: number;
  validTpsMessages: number;
  validLatencyMessages: number;
  validityRatio: number;
  outputTokens: number;
  reasoningTokens: number;
  reasoningShare: number | null;
}

export interface DashboardModelsDataContract {
  modelUsage: DashboardBarItemContract[];
  modelTokenConsumption: DashboardModelTokenConsumptionRowContract[];
  modelPerformanceStats: DashboardModelPerformanceStatsRowContract[];
}

// ---------------------------------------------------------------------------
// Tools (part atoms)
// ---------------------------------------------------------------------------

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

export interface DashboardToolsDataContract {
  // totalToolCalls/toolErrors/toolErrorRate moved here from summary because
  // they are part-sourced (source-purity).
  totalToolCalls: number;
  toolErrors: number;
  toolErrorRate: string;
  toolUsage: DashboardBarItemContract[];
  toolReliabilityMatrix: DashboardToolReliabilityRowContract[];
  mcpUsage: DashboardMcpUsageRowContract[];
  errorPatterns: DashboardBarItemContract[];
  errorTrendSeries: DashboardLineSeriesContract[];
  errorTrendHourlyBars: DashboardStackBarContract[];
}

// ---------------------------------------------------------------------------
// Heavy-endpoint envelopes (discriminated union: building | ready)
// ---------------------------------------------------------------------------

export interface DashboardBuildingContract {
  kind: "dashboard.activity" | "dashboard.models" | "dashboard.tools";
  generatedAt: string;
  selection: DashboardSelectionContract;
  state: "building";
  progressPercent: number;
  generation: number;
}

export interface DashboardActivityReadyContract {
  kind: "dashboard.activity";
  generatedAt: string;
  selection: DashboardSelectionContract;
  state: "ready";
  generation: number;
  data: DashboardActivityDataContract;
}

export interface DashboardModelsReadyContract {
  kind: "dashboard.models";
  generatedAt: string;
  selection: DashboardSelectionContract;
  state: "ready";
  generation: number;
  data: DashboardModelsDataContract;
}

export interface DashboardToolsReadyContract {
  kind: "dashboard.tools";
  generatedAt: string;
  selection: DashboardSelectionContract;
  state: "ready";
  generation: number;
  data: DashboardToolsDataContract;
}

export type DashboardActivityContract =
  | (DashboardBuildingContract & { kind: "dashboard.activity" })
  | DashboardActivityReadyContract;

export type DashboardModelsContract =
  | (DashboardBuildingContract & { kind: "dashboard.models" })
  | DashboardModelsReadyContract;

export type DashboardToolsContract =
  | (DashboardBuildingContract & { kind: "dashboard.tools" })
  | DashboardToolsReadyContract;
