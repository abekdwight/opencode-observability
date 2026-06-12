// Per-root aggregation atom + supporting types.
//
// The aggregator keeps exactly one thing in memory: a Map<rootSessionId, atom>.
// There is no day-rollup layer and no day-level invalidation. Every projection
// is a pure fold over the atom set, filtered by the selection window.
//
// An atom is built once per root from its source rows (session + descendant
// messages/parts) and only rebuilt when that root's source stamp changes.

// Local-day token totals (sum over a root's assistant messages on that day).
export interface DashboardTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
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

export interface DashboardToolReliabilityTotals {
  tool: string;
  success: number;
  error: number;
  total: number;
}

export interface DashboardMcpUsageTotals {
  server: string;
  calls: number;
  errors: number;
  isBuiltin: boolean;
}

// Raw TPS/latency samples for a (model, provider) within a root. Percentiles
// and averages are computed at projection time after merging across roots.
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

// Everything a root contributes on a single local day. Keyed maps use "\t"
// separated composite keys where noted.
export interface DashboardDayContribution {
  day: string;
  rootSessionCount: number;
  tokenTotals: DashboardTokenTotals;
  tokenInputByHour: Map<string, number>; // hour ("00".."23") -> input tokens
  tokenOutputByHour: Map<string, number>; // hour -> output tokens
  toolCalls: number;
  toolErrors: number;
  errorPatterns: Map<string, number>; // classifyError label -> count
  toolErrorsByHour: Map<string, number>; // hour -> error count
  toolErrorsByTool: Map<string, number>; // tool -> error count
  mcpUsage: Map<string, DashboardMcpUsageTotals>; // server -> totals
  toolReliability: Map<string, DashboardToolReliabilityTotals>; // tool -> totals
  toolUsage: Map<string, number>; // tool -> total calls
  modelCounts: Map<string, number>; // model -> assistant message count
  modelTokenTotals: Map<string, DashboardModelTokenTotals>; // "model\tprovider"
  agentCounts: Map<string, number>; // agent -> assistant message count
  subagentByHour: Map<string, number>; // "agent\thour" -> count
  // Active-repositories inputs (attributed to the root's repoKey at the atom
  // level). repoSessionCount counts the root itself on its created day;
  // repoActiveDurationMs is the summed inter-message gap on each message's day.
  repoSessionCount: number;
  repoActiveDurationMs: number;
}

export interface DashboardRecentMeta {
  id: string;
  title: string;
  directory: string;
  timeUpdated: number;
  totalTokens: number;
}

// Identifies the source state of a root so the aggregator can decide whether an
// atom is stale without re-reading the JSON blobs. Mirrors the per-root stats
// query (counts + max rowids + max time_updated for session/message/part).
export interface DashboardSourceStamp {
  rootSessionId: string;
  sessionRowCount: number;
  sessionMaxRowId: number;
  sessionMaxUpdatedAt: number;
  messageRowCount: number;
  messageMaxRowId: number;
  messageMaxUpdatedAt: number;
  partRowCount: number;
  partMaxRowId: number;
  partMaxUpdatedAt: number;
}

export interface DashboardSessionAtom {
  rootSessionId: string;
  projectId: string;
  // The repository bucket this root belongs to (resolveRepoBucketKey over the
  // root's worktree/directory). Constant for the atom across all its days.
  repoKey: string;
  recentMeta: DashboardRecentMeta;
  sourceStamp: DashboardSourceStamp;
  days: Map<string, DashboardDayContribution>;
  modelPerformanceSamples: Map<string, DashboardModelPerformanceSample>;
}

export interface DashboardAtomSet {
  atoms: Map<string, DashboardSessionAtom>;
}
