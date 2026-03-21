import type Database from "better-sqlite3";
import type {
  MonitorSessionSummary,
  MonitorSnapshotContract,
} from "../contracts/monitor.js";
import type { SessionDetailContract } from "../contracts/session.js";
import type { SignalBadge, SignalLevel } from "../contracts/shared.js";
import { getMonitorActiveWindowMs } from "../lib/config.js";
import {
  buildSessionDetailSnapshot,
  buildSessionRouteView,
} from "../services/session/session-detail.service.js";

interface SessionRow {
  id: string;
  parent_id: string | null;
  title: string;
  directory: string;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  time_created: number;
  time_updated: number;
}

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

function getCount(
  db: Database.Database,
  sql: string,
  params: unknown[] = [],
): number {
  const row = db.prepare(sql).get(...params) as { cnt?: number } | undefined;
  return asNumber(row?.cnt);
}

function countToolCalls(db: Database.Database, sessionId: string): number {
  return getCount(
    db,
    `SELECT COUNT(*) AS cnt FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool'`,
    [sessionId],
  );
}

function countToolErrors(db: Database.Database, sessionId: string): number {
  return getCount(
    db,
    `SELECT COUNT(*) AS cnt FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'error'`,
    [sessionId],
  );
}

function countCompactionMessages(
  db: Database.Database,
  sessionId: string,
): number {
  return getCount(
    db,
    `SELECT COUNT(*) AS cnt FROM message WHERE session_id = ? AND (
      json_extract(data, '$.mode') = 'compaction' OR json_extract(data, '$.agent') = 'compaction'
    )`,
    [sessionId],
  );
}

function countSubagentSessions(
  db: Database.Database,
  sessionId: string,
): number {
  return getCount(
    db,
    `SELECT COUNT(*) AS cnt FROM session WHERE parent_id = ?`,
    [sessionId],
  );
}

function getSignalLevel(
  toolErrorCount: number,
  compactionCount: number,
): SignalLevel {
  if (toolErrorCount > 0) return "error";
  if (compactionCount > 0) return "warning";
  return "success";
}

function buildRootSessionSummary(
  db: Database.Database,
  row: SessionRow,
): MonitorSessionSummary {
  const messageCount = asNumber(
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM message WHERE session_id = ?`)
      .get(row.id),
  );
  const toolCallCount = countToolCalls(db, row.id);
  const toolErrorCount = countToolErrors(db, row.id);
  const compactionCount = countCompactionMessages(db, row.id);
  const subagentCount = countSubagentSessions(db, row.id);

  return {
    id: row.id,
    title: row.title,
    directory: row.directory,
    createdAt: toIso(row.time_created),
    updatedAt: toIso(row.time_updated),
    messageCount,
    toolCallCount,
    compactionCount,
    subagentCount,
    signalLevel: getSignalLevel(toolErrorCount, compactionCount),
  };
}

function placeholders(size: number): string {
  return Array.from({ length: size }, () => "?").join(",");
}

function listActiveRootSessions(
  db: Database.Database,
  nowMs: number,
  activeWindowMs: number,
): SessionRow[] {
  return db
    .prepare(
      `SELECT id, parent_id, title, directory, summary_additions, summary_deletions, summary_files, time_created, time_updated
       FROM session
       WHERE parent_id IS NULL
         AND time_archived IS NULL
         AND time_updated >= ?
       ORDER BY time_updated DESC, time_created DESC, id ASC`,
    )
    .all(nowMs - activeWindowMs) as SessionRow[];
}

export function buildMonitorSnapshotContract(
  db: Database.Database,
): MonitorSnapshotContract {
  const nowMs = Date.now();
  const activeWindowMs = getMonitorActiveWindowMs();
  const rootSessions = listActiveRootSessions(db, nowMs, activeWindowMs);

  const activeRootSessions = rootSessions.map((row) =>
    buildRootSessionSummary(db, row),
  );
  const activeRootIds = activeRootSessions.map((session) => session.id);
  const rootIdPlaceholders = placeholders(activeRootIds.length);

  const mainCompactions =
    activeRootIds.length > 0
      ? getCount(
          db,
          `SELECT COUNT(*) AS cnt FROM message m
           JOIN session s ON s.id = m.session_id
           WHERE s.id IN (${rootIdPlaceholders})
             AND (json_extract(m.data, '$.mode') = 'compaction' OR json_extract(m.data, '$.agent') = 'compaction')`,
          activeRootIds,
        )
      : 0;
  const subagentCompactions =
    activeRootIds.length > 0
      ? getCount(
          db,
          `SELECT COUNT(*) AS cnt FROM message m
           JOIN session s ON s.id = m.session_id
           WHERE s.parent_id IN (${rootIdPlaceholders})
             AND (json_extract(m.data, '$.mode') = 'compaction' OR json_extract(m.data, '$.agent') = 'compaction')`,
          activeRootIds,
        )
      : 0;

  const alertingRoots = activeRootSessions.filter(
    (session) => session.signalLevel === "error",
  ).length;
  const compactingRoots = activeRootSessions.filter(
    (session) => session.compactionCount > 0,
  ).length;
  const subagentSessions =
    activeRootIds.length > 0
      ? getCount(
          db,
          `SELECT COUNT(*) AS cnt FROM session WHERE parent_id IN (${rootIdPlaceholders})`,
          activeRootIds,
        )
      : 0;
  const openTodos =
    activeRootIds.length > 0
      ? getCount(
          db,
          `SELECT COUNT(*) AS cnt
           FROM todo t
           JOIN session s ON s.id = t.session_id
           WHERE s.id IN (${rootIdPlaceholders}) OR s.parent_id IN (${rootIdPlaceholders})`,
          [...activeRootIds, ...activeRootIds],
        )
      : 0;

  const signalBadges: SignalBadge[] = [
    {
      key: "alerting",
      label: "Alerting sessions",
      level: alertingRoots > 0 ? "error" : "success",
      count: alertingRoots,
    },
    {
      key: "compacting",
      label: "Compacting sessions",
      level: compactingRoots > 0 ? "warning" : "info",
      count: compactingRoots,
    },
    {
      key: "subagent",
      label: "Subagent sessions",
      level: subagentSessions > 0 ? "info" : "success",
      count: subagentSessions,
    },
    {
      key: "todos",
      label: "Open todos",
      level: openTodos > 0 ? "warning" : "success",
      count: openTodos,
    },
  ];

  return {
    kind: "monitor.snapshot",
    generatedAt: new Date().toISOString(),
    activeRootSessions,
    compactionCounts: {
      main: mainCompactions,
      subagent: subagentCompactions,
      total: mainCompactions + subagentCompactions,
    },
    signalBadges,
  };
}

export function buildSessionDetailContract(
  db: Database.Database,
  sessionId: string,
): SessionDetailContract | null {
  const snapshot = buildSessionDetailSnapshot(db, sessionId);
  if (!snapshot) return null;

  const routeView = buildSessionRouteView(db, sessionId);
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
    kind: "session.detail",
    generatedAt: new Date().toISOString(),
    session: {
      id: sessionInfo.id,
      title: sessionInfo.title,
      directory: sessionInfo.directory,
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
      })),
      subagentLinks: message.subagentLinks.map((link) => ({
        id: link.id,
        title: link.title,
        durationMs: link.durationMs,
      })),
    })),
    todos: routeView.todos.map((todo) => ({
      content: todo.content,
      status: todo.status,
      priority: todo.priority,
    })),
    summaryDiffs: routeView.summaryDiffs,
  };
}
