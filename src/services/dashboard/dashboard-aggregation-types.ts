import type {
  DashboardRecentSessionContract,
  DashboardRepoBreakdownContract,
  DashboardSummaryContract,
} from "../../contracts/dashboard.js";
import type { DashboardCacheStamp } from "../../repositories/dashboard/dashboard-repository.js";

export interface DashboardTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

export interface DashboardToolStatusTotals {
  calls: number;
  errors: number;
}

export interface DashboardLabeledCount {
  label: string;
  count: number;
}

export interface DashboardMcpUsageTotals {
  server: string;
  calls: number;
  errors: number;
  isBuiltin: boolean;
}

export interface DashboardToolReliabilityTotals {
  tool: string;
  success: number;
  error: number;
  total: number;
}

export interface DashboardModelTokenTotals {
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

export interface DashboardSessionRecentMeta
  extends DashboardRecentSessionContract {
  projectId: string;
  repoKey: string;
}

export interface DashboardSessionSourceStamp {
  rootSessionId: string;
  sessionRowCount: number;
  sessionRowId: number;
  maxSessionUpdatedAt: number;
  messageRowCount: number;
  messageRowId: number;
  maxMessageUpdatedAt: number;
  partRowCount: number;
  partRowId: number;
  maxPartUpdatedAt: number;
}

export interface DashboardModelPerformanceSample {
  model: string;
  provider: string;
  sumOutputTokens: number;
  sumDurationMs: number;
  validTpsMessages: number;
  validLatencyMessages: number;
  totalMessages: number;
  outputTokens: number;
  reasoningTokens: number;
  tpsSamples: number[];
  latencySamplesMs: number[];
}

export interface DashboardSessionDayContribution {
  day: string;
  rootSessionCount: number;
  tokenTotals: DashboardTokenTotals;
  tokenInputByHour: Map<string, number>;
  tokenOutputByHour: Map<string, number>;
  toolStatus: DashboardToolStatusTotals;
  errorPatterns: Map<string, number>;
  mcpUsage: Map<string, DashboardMcpUsageTotals>;
  toolReliability: Map<string, DashboardToolReliabilityTotals>;
  modelCounts: Map<string, number>;
  modelTokenTotals: Map<string, DashboardModelTokenTotals>;
  subagentCounts: Map<string, number>;
  subagentByHour: Map<string, number>;
  toolErrorsByHour: Map<string, number>;
  repoSessionCount: number;
  repoActiveDurationMs: number;
}

export interface DashboardSessionAtom {
  rootSessionId: string;
  projectId: string;
  repoKey: string;
  recentMeta: DashboardSessionRecentMeta;
  sourceStamp: DashboardSessionSourceStamp;
  generatedAt: string;
  days: Map<string, DashboardSessionDayContribution>;
  modelPerformanceSamples: Map<string, DashboardModelPerformanceSample>;
}

export interface DashboardSessionAtomDayDelta {
  day: string;
  previous: DashboardSessionDayContribution | null;
  next: DashboardSessionDayContribution | null;
  delta: DashboardSessionDayContribution;
}

export interface DashboardSessionAtomDiff {
  addedDays: DashboardSessionAtomDayDelta[];
  removedDays: DashboardSessionAtomDayDelta[];
  changedDays: DashboardSessionAtomDayDelta[];
}

export interface DashboardDayRollup {
  day: string;
  rootSessionCount: number;
  tokenTotals: DashboardTokenTotals;
  toolStatus: DashboardToolStatusTotals;
  projectIds: Set<string>;
  recentSessionIds: Set<string>;
  toolErrorsByToolDay: Map<string, number>;
  toolErrorsByHour: Map<string, number>;
  tokenByDay: number;
  tokenInputByDay: number;
  tokenOutputByDay: number;
  tokenInputByHour: Map<string, number>;
  tokenOutputByHour: Map<string, number>;
  subagentByDay: Map<string, number>;
  subagentByHour: Map<string, number>;
  repoSessionCountByDay: Map<string, number>;
  repoActiveDurationMsByDay: Map<string, number>;
  modelCountByDay: Map<string, number>;
  modelTokenTotals: Map<string, DashboardModelTokenTotals>;
  toolUsage: Map<string, number>;
  agentDistribution: Map<string, number>;
  mcpUsage: Map<string, DashboardMcpUsageTotals>;
  toolReliabilityMatrix: Map<string, DashboardToolReliabilityTotals>;
  errorPatterns: Map<string, number>;
}

export interface DashboardProjectionSource {
  // summary.totalSessions -> selectedDayRollups.rootSessionCount
  // summary.totalTokens -> selectedDayRollups.tokenTotals.total
  // summary.totalToolCalls/toolErrors/toolErrorRate -> selectedDayRollups.toolStatus
  // summary.activeProjects -> selectedSessionAtoms.projectId distinct set
  summary: {
    selectedDayRollups: DashboardDayRollup[];
    selectedSessionAtoms: DashboardSessionAtom[];
    projectIds: Set<string>;
    contractShape?: DashboardSummaryContract;
  };

  // recentSessions -> selectedSessionAtoms.recentMeta sorted by timeUpdated DESC, top 5
  recentSessions: {
    selectedSessionAtoms: DashboardSessionAtom[];
  };

  // heatmapDays -> trailing365DayRollups.rootSessionCount
  heatmapDays: {
    trailingDayRollups: DashboardDayRollup[];
  };

  // errorTrendSeries/errorTrendHourlyBars -> dayRollup.toolErrorsByToolDay / dayRollup.toolErrorsByHour
  errorTrend: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // tokenTrend -> dayRollup.tokenByDay + dayRollup.tokenInputByHour/dayRollup.tokenOutputByHour
  tokenTrend: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // subagentTrend -> dayRollup.subagentByDay / dayRollup.subagentByHour
  subagentTrend: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // activeRepos -> dayRollup.repoSessionCountByDay + dayRollup.repoActiveDurationMsByDay
  activeRepos: {
    selectedDayRollups: DashboardDayRollup[];
    contractShape?: DashboardRepoBreakdownContract;
  };

  // modelUsage -> dayRollup.modelCountByDay
  modelUsage: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // modelTokenConsumption -> dayRollup.modelTokenTotals
  modelTokenConsumption: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // modelPerformanceStats -> selectedSessionAtoms.modelPerformanceSamples
  modelPerformanceStats: {
    selectedSessionAtoms: DashboardSessionAtom[];
  };

  // toolUsage -> dayRollup.toolUsage
  toolUsage: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // agentDistribution -> dayRollup.agentDistribution
  agentDistribution: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // mcpUsage -> dayRollup.mcpUsage
  mcpUsage: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // toolReliabilityMatrix -> dayRollup.toolReliabilityMatrix
  toolReliabilityMatrix: {
    selectedDayRollups: DashboardDayRollup[];
  };

  // errorPatterns -> dayRollup.errorPatterns
  errorPatterns: {
    selectedDayRollups: DashboardDayRollup[];
  };
}

export interface DashboardAggregationStoreSnapshot {
  generation: number;
  timezone: string;
  semanticsVersion: string;
  sessionKeys: string[];
  dayKeys: string[];
  rawKeys: string[];
  viewKeys: string[];
  stamp: DashboardCacheStamp | null;
}
