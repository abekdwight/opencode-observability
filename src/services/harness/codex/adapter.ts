import fs from "node:fs";
import type {
  HarnessDescriptorContract,
  HarnessSessionDetailContract,
  HarnessSessionSummaryContract,
} from "../../../contracts/harness.js";
import { getCodexDb } from "../../../lib/codex-db.js";
import { calcActiveDurationFromTimeline } from "../../../lib/duration.js";
import {
  type CodexThreadRecord,
  codexThreadExists,
  getCodexThread,
  listCodexThreads,
} from "../../../repositories/codex-sessions/codex-sessions.repository.js";
import type { HarnessAdapter, HarnessSessionList } from "../types.js";
import { parseCodexRollout } from "./rollout-parser.js";

const descriptor: HarnessDescriptorContract = {
  id: "codex",
  label: "Codex",
  capabilities: {
    delete: false,
    livePrompt: false,
    resume: true,
  },
};

function toIso(value: number): string {
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function toSummary(thread: CodexThreadRecord): HarnessSessionSummaryContract {
  return {
    harness: "codex",
    id: thread.id,
    title: thread.title || thread.first_user_message || thread.id,
    directory: thread.cwd,
    gitBranch: thread.git_branch,
    createdAt: toIso(thread.created_at),
    updatedAt: toIso(thread.updated_at),
    model: thread.model,
    messageCount: null,
    totalTokens: thread.tokens_used,
    subagentCount: null,
    detailAvailable: fileExists(thread.rollout_path),
  };
}

function listSessions(): HarnessSessionList {
  let db: ReturnType<typeof getCodexDb>;
  try {
    db = getCodexDb();
  } catch {
    return {
      source: { available: false, reason: "missing-database" },
      sessions: [],
    };
  }

  try {
    return {
      source: { available: true, reason: "ok" },
      sessions: listCodexThreads(db).map(toSummary),
    };
  } catch {
    return {
      source: { available: false, reason: "missing-database" },
      sessions: [],
    };
  } finally {
    db.close();
  }
}

function getSessionDetail(id: string): HarnessSessionDetailContract | null {
  let db: ReturnType<typeof getCodexDb>;
  try {
    db = getCodexDb();
  } catch {
    return null;
  }

  try {
    const thread = getCodexThread(db, id);
    if (!thread) return null;
    const summary = toSummary(thread);

    let content: string | null = null;
    try {
      content = fs.readFileSync(thread.rollout_path, "utf-8");
    } catch {
      content = null;
    }

    const parsed = content
      ? parseCodexRollout(content)
      : {
          messages: [],
          toolEvents: [],
          todos: [],
          tokens: null,
          models: [],
          cwd: null,
          parentThreadId: null,
          parseWarningCount: 0,
        };

    // Only link to a parent thread that is actually addressable.
    const parentId =
      parsed.parentThreadId && codexThreadExists(db, parsed.parentThreadId)
        ? parsed.parentThreadId
        : null;

    const durationMs = content
      ? calcActiveDurationFromTimeline(
          parsed.messages.map((message) => ({
            role: message.role,
            timestampMs: Date.parse(message.createdAt),
          })),
        )
      : null;

    const toolErrorCount = parsed.toolEvents.filter(
      (event) => event.status === "error",
    ).length;

    const models =
      parsed.models.length > 0
        ? parsed.models
        : thread.model
          ? [thread.model]
          : [];

    return {
      kind: "harness.session.detail",
      generatedAt: new Date().toISOString(),
      harness: descriptor,
      source: {
        ok: content !== null,
        parseWarningCount: parsed.parseWarningCount,
      },
      durationMs,
      session: {
        id: thread.id,
        title: summary.title,
        directory: parsed.cwd ?? thread.cwd,
        gitBranch: thread.git_branch,
        parentId,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        summary: null,
      },
      models,
      tokens: parsed.tokens
        ? {
            total: parsed.tokens.total,
            input: parsed.tokens.input,
            output: parsed.tokens.output,
            reasoning: parsed.tokens.reasoning,
            cacheRead: parsed.tokens.cachedInput,
            cacheWrite: null,
            cost: null,
          }
        : null,
      modelBreakdown: null,
      compactions: null,
      subagents: null,
      signalBadges: [
        {
          key: "tool-errors",
          label: "Tool errors",
          level: toolErrorCount > 0 ? "error" : "success",
          count: toolErrorCount,
        },
      ],
      messages: parsed.messages,
      toolEvents: parsed.toolEvents,
      todos: parsed.todos,
      summaryDiffs: null,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export const codexAdapter: HarnessAdapter = {
  descriptor,
  listSessions,
  getSessionDetail,
};
