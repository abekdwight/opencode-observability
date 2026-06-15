import type {
  HarnessDescriptorContract,
  HarnessSessionDetailContract,
  HarnessSessionSummaryContract,
} from "../../../contracts/harness.js";
import type { SignalBadge } from "../../../contracts/shared.js";
import { getDb } from "../../../lib/db.js";
import {
  countMessagesBySession,
  countSubagentsBySession,
  listRootSessionRecords,
  sumAssistantTokensBySession,
} from "../../../repositories/session/session.repository.js";
import {
  buildSessionDetailSnapshot,
  buildSessionRouteView,
} from "../../session/session-detail.service.js";
import type { HarnessAdapter, HarnessSessionList } from "../types.js";

const LIST_LIMIT = 200;

const descriptor: HarnessDescriptorContract = {
  id: "opencode",
  label: "OpenCode",
  capabilities: {
    delete: true,
    livePrompt: true,
    resume: true,
  },
};

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toIsoFromUnknown(value: string | number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return toIso(value);
  }
  if (typeof value !== "string") {
    return new Date(0).toISOString();
  }
  const maybeNumeric = Number(value);
  if (Number.isFinite(maybeNumeric)) {
    return toIso(maybeNumeric);
  }
  const maybeDate = Date.parse(value);
  if (Number.isFinite(maybeDate)) {
    return new Date(maybeDate).toISOString();
  }
  return value;
}

function listSessions(): HarnessSessionList {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    return {
      source: { available: false, reason: "missing-database" },
      sessions: [],
    };
  }

  try {
    const records = listRootSessionRecords(db, LIST_LIMIT);
    const ids = records.map((record) => record.id);
    const messageCounts = countMessagesBySession(db, ids);
    const tokenSums = sumAssistantTokensBySession(db, ids);
    const subagentCounts = countSubagentsBySession(db, ids);

    const sessions = records.map<HarnessSessionSummaryContract>((record) => ({
      harness: "opencode",
      id: record.id,
      title: record.title,
      directory: record.directory,
      gitBranch: null,
      createdAt: toIso(record.time_created),
      updatedAt: toIso(record.time_updated),
      model: null,
      messageCount: messageCounts.get(record.id) ?? 0,
      totalTokens: tokenSums.get(record.id) ?? 0,
      subagentCount: subagentCounts.get(record.id) ?? 0,
      detailAvailable: true,
    }));

    return { source: { available: true, reason: "ok" }, sessions };
  } catch {
    return {
      source: { available: false, reason: "error" },
      sessions: [],
    };
  } finally {
    db.close();
  }
}

function getSessionDetail(id: string): HarnessSessionDetailContract | null {
  const db = getDb();
  try {
    const snapshot = buildSessionDetailSnapshot(db, id);
    if (!snapshot) return null;
    const routeView = buildSessionRouteView(db, id);
    if (!routeView) return null;

    const { sessionInfo, tokens, modelBreakdown, compactions, subagents } =
      snapshot;
    const signalBadges: SignalBadge[] = [
      {
        key: "tool-errors",
        label: "Tool errors",
        level: snapshot.toolErrorCount > 0 ? "error" : "success",
        count: snapshot.toolErrorCount,
      },
      {
        key: "subagents",
        label: "Subagents",
        level: subagents.length > 0 ? "info" : "success",
        count: subagents.length,
      },
      {
        key: "compactions",
        label: "Compactions",
        level: compactions.total > 0 ? "warning" : "info",
        count: compactions.total,
      },
    ];

    return {
      kind: "harness.session.detail",
      generatedAt: new Date().toISOString(),
      harness: descriptor,
      source: { ok: true, parseWarningCount: 0 },
      durationMs: Math.max(0, routeView.durationMs),
      session: {
        id: sessionInfo.id,
        title: sessionInfo.title,
        directory: sessionInfo.directory,
        gitBranch: null,
        parentId: sessionInfo.parent_id,
        createdAt: toIso(sessionInfo.time_created),
        updatedAt: toIso(sessionInfo.time_updated),
        summary: {
          additions: asNumber(sessionInfo.summary_additions),
          deletions: asNumber(sessionInfo.summary_deletions),
          files: asNumber(sessionInfo.summary_files),
        },
      },
      tokens: {
        total: asNumber(tokens.total_tokens),
        input: asNumber(tokens.input_tokens),
        output: asNumber(tokens.output_tokens),
        reasoning: asNumber(tokens.reasoning_tokens),
        cacheRead: asNumber(tokens.cache_read_tokens),
        cacheWrite: asNumber(tokens.cache_write_tokens),
        cost: asNumber(tokens.total_cost),
      },
      models: [...new Set(modelBreakdown.map((row) => row.modelId))],
      modelBreakdown,
      compactions,
      subagents,
      signalBadges,
      messages: routeView.messageDetails.map((message) => ({
        role: message.role,
        text: message.text,
        modelId: message.model_id ?? null,
        agent: message.agent ?? null,
        outputTpsLabel: message.output_tps_label ?? null,
        createdAt: toIsoFromUnknown(message.time_created),
        toolCalls: message.toolCalls.map((call) => ({
          tool: call.tool,
          input: call.input,
          status: call.status,
          error: call.error,
          fullInput: call.fullInput,
          fullOutput: call.fullOutput,
          durationMs: call.durationMs,
          question: call.question,
        })),
        subagentLinks: message.subagentLinks.map((link) => ({
          id: link.id,
          title: link.title,
          durationMs: link.durationMs,
        })),
        fileDiffs: message.fileDiffs,
      })),
      toolEvents: routeView.toolEvents.map((event) => ({
        tool: event.tool,
        input: event.input,
        status: event.status,
        error: event.error,
        fullInput: event.fullInput,
        fullOutput: event.fullOutput,
        durationMs: event.durationMs,
        question: event.question,
        createdAt: toIsoFromUnknown(event.time_created),
      })),
      todos: routeView.todos.map((todo) => ({
        content: todo.content,
        status: todo.status,
        priority: todo.priority,
      })),
      summaryDiffs: routeView.summaryDiffs,
    };
  } finally {
    db.close();
  }
}

export const opencodeAdapter: HarnessAdapter = {
  descriptor,
  listSessions,
  getSessionDetail,
};
