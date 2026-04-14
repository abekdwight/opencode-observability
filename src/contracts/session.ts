import type { SignalBadge, SignalLevel } from "./shared.js";

export interface SessionTokenBreakdown {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SessionModelTokenBreakdown {
  modelId: string;
  providerId: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
}

export interface SessionCompactionBreakdown {
  main: number;
  subagent: number;
  total: number;
}

export interface SessionSubagentSummary {
  id: string;
  title: string;
  updatedAt: string;
  durationMs: number;
  compactionCount: number;
  signalLevel: SignalLevel;
}

export type SessionToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "unknown";

export interface SessionToolCallContract {
  tool: string;
  input: string;
  status: SessionToolStatus;
  error: string;
  fullInput: string;
  fullOutput: string;
  durationMs: number;
}

export interface SessionMessageSubagentLinkContract {
  id: string;
  title: string;
  durationMs: number;
}

export interface MessageFileDiffContract {
  filePath: string;
  tool: "edit" | "apply_patch" | "write";
  diff: string | null;
  additions: number;
  deletions: number;
  isNewFile: boolean;
  fromSubagent: boolean;
}

export interface SessionMessageContract {
  role: "user" | "assistant";
  text: string;
  modelId: string | null;
  agent: string | null;
  outputTpsLabel: string | null;
  createdAt: string;
  toolCalls: SessionToolCallContract[];
  subagentLinks: SessionMessageSubagentLinkContract[];
  fileDiffs: MessageFileDiffContract[];
}

export interface SessionTodoContract {
  content: string;
  status: string;
  priority: string;
}

export interface SessionDetailContract {
  kind: "session.detail";
  generatedAt: string;
  durationMs: number;
  session: {
    id: string;
    title: string;
    directory: string;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
    summary: {
      additions: number;
      deletions: number;
      files: number;
    };
  };
  tokens: SessionTokenBreakdown;
  modelBreakdown: SessionModelTokenBreakdown[];
  compactions: SessionCompactionBreakdown;
  subagents: SessionSubagentSummary[];
  signalBadges: SignalBadge[];
  messages: SessionMessageContract[];
  todos: SessionTodoContract[];
  summaryDiffs: string | null;
}
