export interface MonitorSignalBadge {
  key: string;
  label: string;
  count: number;
}

export type MonitorTokenUsageScope = "main" | "subagent";

export interface MonitorTokenUsageRow {
  scope: MonitorTokenUsageScope;
  agent: string;
  modelId: string;
  providerId: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputRatioPercent: number;
}

export interface MonitorSessionSummary {
  id: string;
  title: string;
  directory: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolCallCount: number;
  compactionCount: number;
  subagentCount: number;
  /** Total tokens consumed by this session (assistant messages only) */
  totalTokens: number;
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Input ratio percent, using input / (input + output) * 100 */
  inputRatioPercent: number;
  /** Cache read tokens */
  cacheReadTokens: number;
  /** Cache write tokens */
  cacheWriteTokens: number;
  /** Per-scope token usage rows at agent×model granularity. */
  tokenUsage: MonitorTokenUsageRow[];
}

export interface MonitorSnapshotContract {
  kind: "monitor.snapshot";
  generatedAt: string;
  activeRootSessions: MonitorSessionSummary[];
  compactionCounts: {
    main: number;
    subagent: number;
    total: number;
  };
  signalBadges: MonitorSignalBadge[];
}
