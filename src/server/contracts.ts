import type Database from "better-sqlite3";
import type {
  MonitorSessionSummary,
  MonitorSnapshotContract,
} from "../contracts/monitor.js";
import { getMonitorActiveWindowMs } from "../lib/config.js";
import { buildMessageTotalTokensSql } from "../lib/message-token-sql.js";

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

function computeInputRatioPercent(
  inputTokens: number,
  outputTokens: number,
): number {
  const denominator = inputTokens + outputTokens;
  if (denominator <= 0) return 0;
  return (inputTokens / denominator) * 100;
}

const MESSAGE_TOTAL_TOKENS_SQL = buildMessageTotalTokensSql("data");

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
  const compactionCount = countCompactionMessages(db, row.id);
  const subagentCount = countSubagentSessions(db, row.id);

  // Get token stats for this session
  const tokenStats = db
    .prepare(`
      SELECT
        COALESCE(SUM(json_extract(data, '$.tokens.input')), 0) AS input_tokens,
        COALESCE(SUM(json_extract(data, '$.tokens.output')), 0) AS output_tokens,
        COALESCE(SUM(json_extract(data, '$.tokens.cache.read')), 0) AS cache_read_tokens,
        COALESCE(SUM(json_extract(data, '$.tokens.cache.write')), 0) AS cache_write_tokens,
        COALESCE(SUM(${MESSAGE_TOTAL_TOKENS_SQL}), 0) AS total_tokens,
        COALESCE(SUM(json_extract(data, '$.cost')), 0) AS total_cost
      FROM message
      WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
    `)
    .get(row.id) as {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    total_tokens: number;
    total_cost: number;
  };

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
    totalTokens: asNumber(tokenStats.total_tokens),
    inputTokens: asNumber(tokenStats.input_tokens),
    outputTokens: asNumber(tokenStats.output_tokens),
    inputRatioPercent: computeInputRatioPercent(
      asNumber(tokenStats.input_tokens),
      asNumber(tokenStats.output_tokens),
    ),
    cacheReadTokens: asNumber(tokenStats.cache_read_tokens),
    cacheWriteTokens: asNumber(tokenStats.cache_write_tokens),
    tokenUsage: [],
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

  const alertingRoots =
    activeRootIds.length > 0
      ? getCount(
          db,
          `SELECT COUNT(DISTINCT s.id) AS cnt
           FROM session s
           JOIN part p ON p.session_id = s.id
           WHERE s.id IN (${rootIdPlaceholders})
             AND json_extract(p.data, '$.type') = 'tool'
             AND json_extract(p.data, '$.state.status') = 'error'`,
          activeRootIds,
        )
      : 0;
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

  const signalBadges: MonitorSnapshotContract["signalBadges"] = [
    {
      key: "alerting",
      label: "Alerting sessions",
      count: alertingRoots,
    },
    {
      key: "compacting",
      label: "Compacting sessions",
      count: compactingRoots,
    },
    {
      key: "subagent",
      label: "Subagent sessions",
      count: subagentSessions,
    },
    {
      key: "todos",
      label: "Open todos",
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
