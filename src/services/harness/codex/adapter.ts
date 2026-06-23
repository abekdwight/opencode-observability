import fs from "node:fs";
import type {
  HarnessDescriptorContract,
  HarnessSessionDetailContract,
  HarnessSessionSummaryContract,
} from "../../../contracts/harness.js";
import { isOperationalToolError } from "../../../contracts/question.js";
import type { SessionModelTokenBreakdown } from "../../../contracts/session.js";
import { getCodexDb } from "../../../lib/codex-db.js";
import { calcActiveDurationFromTimeline } from "../../../lib/duration.js";
import {
  type CodexThreadRecord,
  codexThreadExists,
  getCodexThread,
  listCodexChildThreads,
  listCodexThreads,
} from "../../../repositories/codex-sessions/codex-sessions.repository.js";
import {
  mergeModelTokenBreakdownRows,
  retargetModelTokenBreakdownRows,
  summarizeModelTokenBreakdown,
} from "../model-breakdown.js";
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

function toMs(value: number): number {
  return value > 1e12 ? value : value * 1000;
}

function toIso(value: number): string {
  return new Date(toMs(value)).toISOString();
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

function toSubagentLink(thread: CodexThreadRecord): {
  id: string;
  title: string;
  durationMs: number;
} {
  return {
    id: thread.id,
    title:
      thread.agent_nickname ||
      thread.title ||
      thread.first_user_message ||
      thread.id,
    durationMs: Math.max(0, toMs(thread.updated_at) - toMs(thread.created_at)),
  };
}

function findFallbackSubagentHost(
  messages: HarnessSessionDetailContract["messages"],
  child: CodexThreadRecord,
): HarnessSessionDetailContract["messages"][number] | null {
  const childCreatedMs = toMs(child.created_at);
  let candidate: HarnessSessionDetailContract["messages"][number] | null = null;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const messageCreatedMs = Date.parse(message.createdAt);
    if (
      Number.isFinite(messageCreatedMs) &&
      messageCreatedMs <= childCreatedMs
    ) {
      candidate = message;
    }
  }

  return (
    candidate ??
    messages.find((message) => message.role === "assistant") ??
    messages.find((message) => message.role === "user") ??
    null
  );
}

function attachCodexSubagentLinks(
  messages: HarnessSessionDetailContract["messages"],
  childThreads: CodexThreadRecord[],
): void {
  const childById = new Map(childThreads.map((child) => [child.id, child]));
  const linkedIds = new Set<string>();

  for (const message of messages) {
    message.subagentLinks = message.subagentLinks.map((link) => {
      const child = childById.get(link.id);
      if (!child) return link;
      linkedIds.add(child.id);
      return toSubagentLink(child);
    });
  }

  for (const child of childThreads) {
    if (linkedIds.has(child.id)) continue;
    const host = findFallbackSubagentHost(messages, child);
    if (!host) continue;
    host.subagentLinks.push(toSubagentLink(child));
  }
}

function emptyParsedRollout(): ReturnType<typeof parseCodexRollout> {
  return {
    messages: [],
    toolEvents: [],
    todos: [],
    tokens: null,
    modelBreakdown: [],
    models: [],
    cwd: null,
    parentThreadId: null,
    parseWarningCount: 0,
  };
}

function readCodexRollout(thread: CodexThreadRecord): {
  content: string | null;
  parsed: ReturnType<typeof parseCodexRollout>;
} {
  try {
    const content = fs.readFileSync(thread.rollout_path, "utf-8");
    return { content, parsed: parseCodexRollout(content) };
  } catch {
    return { content: null, parsed: emptyParsedRollout() };
  }
}

function codexSubagentAgentName(thread: CodexThreadRecord): string {
  return (
    thread.agent_nickname?.trim() || thread.agent_role?.trim() || "subagent"
  );
}

function buildCodexModelBreakdown(
  thread: CodexThreadRecord,
  parsed: ReturnType<typeof parseCodexRollout>,
  childParses: Array<{
    thread: CodexThreadRecord;
    parsed: ReturnType<typeof parseCodexRollout>;
  }>,
): SessionModelTokenBreakdown[] {
  const rows = [
    ...retargetModelTokenBreakdownRows(parsed.modelBreakdown, {
      scope: "main",
      agent: "main",
      providerId: thread.model_provider,
    }),
  ];

  for (const child of childParses) {
    rows.push(
      ...retargetModelTokenBreakdownRows(child.parsed.modelBreakdown, {
        scope: "subagent",
        agent: codexSubagentAgentName(child.thread),
        providerId: child.thread.model_provider,
      }),
    );
  }

  return mergeModelTokenBreakdownRows(rows);
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
    const { content, parsed } = readCodexRollout(thread);
    const childThreads = listCodexChildThreads(db, thread.id);
    const childParses = childThreads.map((child) => ({
      thread: child,
      parsed: readCodexRollout(child).parsed,
    }));
    const modelBreakdown = buildCodexModelBreakdown(
      thread,
      parsed,
      childParses,
    );

    // Only link to a parent thread that is actually addressable.
    const rawParentId = thread.parent_thread_id ?? parsed.parentThreadId;
    const parentId =
      rawParentId && codexThreadExists(db, rawParentId) ? rawParentId : null;
    attachCodexSubagentLinks(parsed.messages, childThreads);

    const durationMs = content
      ? calcActiveDurationFromTimeline(
          parsed.messages.map((message) => ({
            role: message.role,
            timestampMs: Date.parse(message.createdAt),
          })),
        )
      : null;

    const toolErrorCount = parsed.toolEvents.filter(
      isOperationalToolError,
    ).length;

    const models = [
      ...new Set(
        modelBreakdown.length > 0
          ? modelBreakdown.map((row) => row.modelId)
          : parsed.models.length > 0
            ? parsed.models
            : thread.model
              ? [thread.model]
              : [],
      ),
    ];
    const tokens =
      modelBreakdown.length > 0
        ? summarizeModelTokenBreakdown(modelBreakdown, {
            reasoning: true,
            cacheRead: true,
            cacheWrite: false,
            cost: false,
          })
        : parsed.tokens
          ? {
              total: parsed.tokens.total,
              input: parsed.tokens.input,
              output: parsed.tokens.output,
              reasoning: parsed.tokens.reasoning,
              cacheRead: parsed.tokens.cachedInput,
              cacheWrite: null,
              cost: null,
            }
          : null;

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
      tokens,
      modelBreakdown: modelBreakdown.length > 0 ? modelBreakdown : null,
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
