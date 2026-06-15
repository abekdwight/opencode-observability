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
  scope: "main" | "subagent";
  agent: string;
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

export interface SessionQuestionOptionContract {
  label: string;
  /** "" when the harness provides no description for the option. */
  description: string;
}

export interface SessionQuestionItemContract {
  /** Short label for the question; "" when absent. */
  header: string;
  question: string;
  multiSelect: boolean;
  options: SessionQuestionOptionContract[];
  /**
   * The user's chosen value(s). Each entry is an option label when it matches
   * one of `options`, or free-text when the user answered outside the options.
   * Empty when the question was left unanswered.
   */
  selected: string[];
  /** Free-text note attached to the answer; null when none was given. */
  note: string | null;
}

/**
 * A user-question interaction (OpenCode `question`, Codex `request_user_input`,
 * Claude `AskUserQuestion`). Carried on the tool call that invoked it; null on
 * every non-question tool call.
 */
export interface SessionQuestionContract {
  questions: SessionQuestionItemContract[];
}

export interface SessionToolCallContract {
  tool: string;
  input: string;
  status: SessionToolStatus;
  error: string;
  fullInput: string;
  fullOutput: string;
  durationMs: number;
  /** Structured payload for user-question tools; null for ordinary tools. */
  question: SessionQuestionContract | null;
}

export interface SessionToolEventContract extends SessionToolCallContract {
  createdAt: string;
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
  toolEvents: SessionToolEventContract[];
  todos: SessionTodoContract[];
  summaryDiffs: string | null;
}
