import type {
  SessionCompactionBreakdown,
  SessionMessageContract,
  SessionModelTokenBreakdown,
  SessionSubagentSummary,
  SessionTodoContract,
  SessionToolEventContract,
} from "./session.js";
import type { SignalBadge } from "./shared.js";

// ---------------------------------------------------------------------------
// Harness identity & capabilities
//
// A "harness" is a coding-agent CLI whose session history this app can view
// (OpenCode, Codex, Claude Code). Every harness is exposed through the same
// session-list / session-detail contracts; data a harness cannot provide is
// `null`, never a fabricated zero. Behavioural differences (delete, live
// prompt) are declared as capabilities so the UI can omit unsupported
// actions instead of rendering dead controls.
// ---------------------------------------------------------------------------

export type HarnessId = "opencode" | "codex" | "claude";

export const HARNESS_IDS: readonly HarnessId[] = [
  "opencode",
  "codex",
  "claude",
];

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value);
}

export interface HarnessCapabilities {
  /** Sessions can be deleted from this app. */
  delete: boolean;
  /** Follow-up prompts can be dispatched to a running session. */
  livePrompt: boolean;
  /** A shell command exists to resume the session in its CLI. */
  resume: boolean;
}

export interface HarnessDescriptorContract {
  id: HarnessId;
  label: string;
  capabilities: HarnessCapabilities;
}

export interface HarnessSourceContract {
  available: boolean;
  reason: "ok" | "missing-database" | "missing-directory" | "error";
}

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

export interface HarnessSessionSummaryContract {
  harness: HarnessId;
  id: string;
  title: string;
  directory: string;
  gitBranch: string | null;
  createdAt: string;
  updatedAt: string;
  model: string | null;
  /** null = the harness does not track this for list rows */
  messageCount: number | null;
  totalTokens: number | null;
  subagentCount: number | null;
  /** Whether the underlying transcript/rollout still exists on disk. */
  detailAvailable: boolean;
}

export type HarnessSessionsSort = "updated" | "created" | "tokens" | "messages";

export const HARNESS_SESSIONS_SORT_OPTIONS: readonly HarnessSessionsSort[] = [
  "updated",
  "created",
  "tokens",
  "messages",
];

export interface HarnessDirectoryFacetContract {
  directory: string;
  count: number;
}

export interface HarnessListEntryContract {
  descriptor: HarnessDescriptorContract;
  source: HarnessSourceContract;
  /** Session count for this harness within the current q filter. */
  sessionCount: number;
}

export interface HarnessSessionsContract {
  kind: "harness.sessions";
  generatedAt: string;
  harnesses: HarnessListEntryContract[];
  query: {
    harness: HarnessId | null;
    directory: string | null;
    q: string;
    sort: HarnessSessionsSort;
  };
  /** Directory facet over the harness+q filtered set. */
  directories: HarnessDirectoryFacetContract[];
  sessions: HarnessSessionSummaryContract[];
}

// ---------------------------------------------------------------------------
// Session detail
// ---------------------------------------------------------------------------

export interface HarnessTokenTotalsContract {
  total: number;
  input: number;
  output: number;
  /** null = the harness does not report this dimension */
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cost: number | null;
}

export interface HarnessSessionDetailContract {
  kind: "harness.session.detail";
  generatedAt: string;
  harness: HarnessDescriptorContract;
  source: {
    ok: boolean;
    parseWarningCount: number;
  };
  durationMs: number | null;
  session: {
    id: string;
    title: string;
    directory: string;
    gitBranch: string | null;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
    summary: {
      additions: number;
      deletions: number;
      files: number;
    } | null;
  };
  /** Distinct models observed in the session (always derivable). */
  models: string[];
  /** Sections below are null when the harness cannot provide them. */
  tokens: HarnessTokenTotalsContract | null;
  modelBreakdown: SessionModelTokenBreakdown[] | null;
  compactions: SessionCompactionBreakdown | null;
  subagents: SessionSubagentSummary[] | null;
  signalBadges: SignalBadge[];
  messages: SessionMessageContract[];
  toolEvents: SessionToolEventContract[] | null;
  todos: SessionTodoContract[] | null;
  summaryDiffs: string | null;
}

export interface HarnessSessionNotFoundContract {
  kind: "harness.session.not-found";
  harness: HarnessId;
  sessionId: string;
}
