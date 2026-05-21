type SqliteDatabase = import("better-sqlite3").Database;
import { buildMessageTotalTokensSql } from "../../lib/message-token-sql.js";
import type { DashboardSessionSourceStamp } from "../../services/dashboard/dashboard-aggregation-types.js";

const MESSAGE_TOTAL_TOKENS_SQL = buildMessageTotalTokensSql("m.data");

export interface DashboardPartRow {
  tool: string | null;
  status: string | null;
  day: string;
  cnt: number;
}

export interface DashboardErrorRow {
  error: string;
  day: string;
}

export interface DashboardToolErrorRow {
  tool: string | null;
  day: string;
  cnt: number;
}

export interface DashboardMessageRow {
  model: string | null;
  agent: string | null;
  tokens: number;
  day: string;
}

export interface DashboardTokenIoRow {
  day: string;
  hour: string;
  input_tokens: number;
  output_tokens: number;
}

export interface DashboardSubagentRow {
  agent: string;
  day: string;
  hour: string;
  cnt: number;
}

export interface DashboardRepoRow {
  worktree: string | null;
  directory: string | null;
  day: string;
  cnt: number;
}

export interface DashboardRecentSessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

export interface DashboardRecentTokenRow {
  session_id: string;
  total_tokens: number;
}

export interface DashboardRepositoryWindow {
  startDayInclusive: string;
  endDayExclusive: string;
}

export interface DashboardPartData {
  rows: DashboardPartRow[];
  errorRows: DashboardErrorRow[];
  toolErrorRows: DashboardToolErrorRow[];
  currentRowId: number;
}

export interface DashboardMessageData {
  rows: DashboardMessageRow[];
  tokenIoRows: DashboardTokenIoRow[];
  subagentRows: DashboardSubagentRow[];
  currentRowId: number;
}

export interface DashboardRepoData {
  rows: DashboardRepoRow[];
  currentRowId: number;
  sessionCount: number;
}

export interface DashboardLiveSummary {
  heatmapRows: { day: string; cnt: number }[];
  totalSessions: number;
  activeProjects: number;
  recentSessions: DashboardRecentSessionRow[];
  recentTokenRows: DashboardRecentTokenRow[];
}

export interface DashboardAtomRootSessionRow {
  id: string;
  projectId: string;
  worktree: string | null;
  directory: string;
  title: string;
  timeCreated: number;
  timeUpdated: number;
  day: string;
}

export interface DashboardAtomMessageRow {
  sessionId: string;
  timeCreated: number;
  day: string;
  hour: string;
  role: string | null;
  model: string | null;
  provider: string | null;
  agent: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number;
}

export interface DashboardAtomPartRow {
  sessionId: string;
  day: string;
  hour: string;
  tool: string | null;
  status: string | null;
  error: string | null;
}

export interface DashboardSessionAtomSource {
  rootSession: DashboardAtomRootSessionRow;
  messages: DashboardAtomMessageRow[];
  parts: DashboardAtomPartRow[];
}

export interface DashboardCacheStamp {
  partRowId: number;
  messageRowId: number;
  sessionRowId: number;
  rootSessionCount: number;
  maxPartUpdatedAt: number;
  maxMessageUpdatedAt: number;
  maxSessionUpdatedAt: number;
}

function toUniqueSortedIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

export function readDashboardRootSessionIdsForSessionIds(
  db: SqliteDatabase,
  sessionIds: string[],
): string[] {
  const ids = toUniqueSortedIds(sessionIds);
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      WITH RECURSIVE session_tree(id, root_session_id) AS (
        SELECT id, id
        FROM session
        WHERE parent_id IS NULL

        UNION ALL

        SELECT child.id, session_tree.root_session_id
        FROM session child
        JOIN session_tree ON child.parent_id = session_tree.id
      )
      SELECT DISTINCT session_tree.root_session_id AS rootSessionId
      FROM session_tree
      WHERE session_tree.id IN (${placeholders})
      ORDER BY session_tree.root_session_id
    `,
    )
    .all(...ids) as Array<{ rootSessionId: string }>;

  return rows.map((row) => row.rootSessionId);
}

function readMaxRowId(
  db: SqliteDatabase,
  table: "part" | "message" | "session",
): number {
  const row = db.prepare(`SELECT MAX(rowid) AS r FROM ${table}`).get() as
    | { r: number | null }
    | undefined;
  return row?.r ?? 0;
}

function buildWindowClause(column: string): string {
  return `${column} >= ? AND ${column} < ?`;
}

function toLocalDayStartMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, (month || 1) - 1, date || 1);
  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime();
}

function buildWindowMsParams(
  window: DashboardRepositoryWindow,
): [number, number] {
  return [
    toLocalDayStartMs(window.startDayInclusive),
    toLocalDayStartMs(window.endDayExclusive),
  ];
}

function readMaxUpdatedAt(
  db: SqliteDatabase,
  table: "part" | "message" | "session",
): number {
  const row = db.prepare(`SELECT MAX(time_updated) AS t FROM ${table}`).get() as
    | { t: number | null }
    | undefined;
  return row?.t ?? 0;
}

export function readDashboardCacheStamp(
  db: SqliteDatabase,
): DashboardCacheStamp {
  const rootSessionCount =
    (
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM session WHERE parent_id IS NULL`)
        .get() as { cnt: number } | undefined
    )?.cnt ?? 0;

  return {
    partRowId: readMaxRowId(db, "part"),
    messageRowId: readMaxRowId(db, "message"),
    sessionRowId: readMaxRowId(db, "session"),
    rootSessionCount,
    maxPartUpdatedAt: readMaxUpdatedAt(db, "part"),
    maxMessageUpdatedAt: readMaxUpdatedAt(db, "message"),
    maxSessionUpdatedAt: readMaxUpdatedAt(db, "session"),
  };
}

function readDashboardChangedDaysSince(
  db: SqliteDatabase,
  previous: DashboardCacheStamp,
): string[] {
  const days = new Set<string>();

  const partRows = db
    .prepare(`
      SELECT DISTINCT date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM part
      WHERE rowid > ? OR time_updated > ?
    `)
    .all(previous.partRowId, previous.maxPartUpdatedAt) as Array<{
    day: string | null;
  }>;
  for (const row of partRows) {
    if (row.day) days.add(row.day);
  }

  const messageRows = db
    .prepare(`
      SELECT DISTINCT date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM message
      WHERE rowid > ? OR time_updated > ?
    `)
    .all(previous.messageRowId, previous.maxMessageUpdatedAt) as Array<{
    day: string | null;
  }>;
  for (const row of messageRows) {
    if (row.day) days.add(row.day);
  }

  const sessionRows = db
    .prepare(`
      SELECT DISTINCT date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM session
      WHERE rowid > ? OR time_updated > ?
    `)
    .all(previous.sessionRowId, previous.maxSessionUpdatedAt) as Array<{
    day: string | null;
  }>;
  for (const row of sessionRows) {
    if (row.day) days.add(row.day);
  }

  return Array.from(days).sort();
}

export function readDashboardChangedRootSessionIdsSince(
  db: SqliteDatabase,
  previous: DashboardCacheStamp,
): string[] {
  const rows = db
    .prepare(
      `
      WITH RECURSIVE session_tree(id, root_session_id) AS (
        SELECT id, id
        FROM session
        WHERE parent_id IS NULL

        UNION ALL

        SELECT child.id, session_tree.root_session_id
        FROM session child
        JOIN session_tree ON child.parent_id = session_tree.id
      ),
      changed_session_ids(session_id) AS (
        SELECT id
        FROM session
        WHERE rowid > ? OR time_updated > ?

        UNION

        SELECT session_id
        FROM message
        WHERE rowid > ? OR time_updated > ?

        UNION

        SELECT session_id
        FROM part
        WHERE rowid > ? OR time_updated > ?
      )
      SELECT DISTINCT session_tree.root_session_id AS rootSessionId
      FROM changed_session_ids
      JOIN session_tree ON session_tree.id = changed_session_ids.session_id
      ORDER BY session_tree.root_session_id
    `,
    )
    .all(
      previous.sessionRowId,
      previous.maxSessionUpdatedAt,
      previous.messageRowId,
      previous.maxMessageUpdatedAt,
      previous.partRowId,
      previous.maxPartUpdatedAt,
    ) as Array<{ rootSessionId: string }>;

  return rows.map((row) => row.rootSessionId);
}

export function readDashboardSessionSourceStamps(
  db: SqliteDatabase,
  rootSessionIds: string[],
): DashboardSessionSourceStamp[] {
  const ids = toUniqueSortedIds(rootSessionIds);
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      WITH RECURSIVE descendants(root_session_id, session_id) AS (
        SELECT id, id
        FROM session
        WHERE id IN (${placeholders})
          AND parent_id IS NULL

        UNION ALL

        SELECT descendants.root_session_id, child.id
        FROM session child
        JOIN descendants ON child.parent_id = descendants.session_id
      ),
      session_stats AS (
        SELECT descendants.root_session_id AS rootSessionId,
               COUNT(*) AS sessionRowCount,
               MAX(s.rowid) AS sessionRowId,
               MAX(s.time_updated) AS maxSessionUpdatedAt
        FROM descendants
        JOIN session s ON s.id = descendants.session_id
        GROUP BY descendants.root_session_id
      ),
      message_stats AS (
        SELECT descendants.root_session_id AS rootSessionId,
               COUNT(*) AS messageRowCount,
               MAX(m.rowid) AS messageRowId,
               MAX(m.time_updated) AS maxMessageUpdatedAt
        FROM descendants
        JOIN message m ON m.session_id = descendants.session_id
        GROUP BY descendants.root_session_id
      ),
      part_stats AS (
        SELECT descendants.root_session_id AS rootSessionId,
               COUNT(*) AS partRowCount,
               MAX(p.rowid) AS partRowId,
               MAX(p.time_updated) AS maxPartUpdatedAt
        FROM descendants
        JOIN part p ON p.session_id = descendants.session_id
        GROUP BY descendants.root_session_id
      )
      SELECT session_stats.rootSessionId AS rootSessionId,
             session_stats.sessionRowCount AS sessionRowCount,
             session_stats.sessionRowId AS sessionRowId,
             session_stats.maxSessionUpdatedAt AS maxSessionUpdatedAt,
             COALESCE(message_stats.messageRowCount, 0) AS messageRowCount,
             COALESCE(message_stats.messageRowId, 0) AS messageRowId,
             COALESCE(message_stats.maxMessageUpdatedAt, 0) AS maxMessageUpdatedAt,
             COALESCE(part_stats.partRowCount, 0) AS partRowCount,
             COALESCE(part_stats.partRowId, 0) AS partRowId,
             COALESCE(part_stats.maxPartUpdatedAt, 0) AS maxPartUpdatedAt
      FROM session_stats
      LEFT JOIN message_stats ON message_stats.rootSessionId = session_stats.rootSessionId
      LEFT JOIN part_stats ON part_stats.rootSessionId = session_stats.rootSessionId
      ORDER BY session_stats.rootSessionId
    `,
    )
    .all(...ids) as DashboardSessionSourceStamp[];

  return rows;
}

export function readDashboardAffectedDaysForRootSessionIds(
  db: SqliteDatabase,
  rootSessionIds: string[],
): string[] {
  const ids = toUniqueSortedIds(rootSessionIds);
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      WITH RECURSIVE descendants(root_session_id, session_id) AS (
        SELECT id, id
        FROM session
        WHERE id IN (${placeholders})
          AND parent_id IS NULL

        UNION ALL

        SELECT descendants.root_session_id, child.id
        FROM session child
        JOIN descendants ON child.parent_id = descendants.session_id
      ),
      touched_days(day) AS (
        SELECT DISTINCT date(s.time_created/1000, 'unixepoch', 'localtime') AS day
        FROM descendants
        JOIN session s ON s.id = descendants.session_id

        UNION

        SELECT DISTINCT date(m.time_created/1000, 'unixepoch', 'localtime') AS day
        FROM descendants
        JOIN message m ON m.session_id = descendants.session_id

        UNION

        SELECT DISTINCT date(p.time_created/1000, 'unixepoch', 'localtime') AS day
        FROM descendants
        JOIN part p ON p.session_id = descendants.session_id
      )
      SELECT day
      FROM touched_days
      WHERE day IS NOT NULL
      ORDER BY day
    `,
    )
    .all(...ids) as Array<{ day: string }>;

  return rows.map((row) => row.day);
}

export function readSessionDeletionTargetIds(
  db: SqliteDatabase,
  sessionId: string,
): string[] {
  const rows = db
    .prepare(
      `
      SELECT id
      FROM session
      WHERE id = ? OR parent_id = ?
    `,
    )
    .all(sessionId, sessionId) as Array<{ id: string }>;

  return Array.from(new Set(rows.map((row) => row.id)));
}

export function readDashboardAffectedDaysForSessionIds(
  db: SqliteDatabase,
  sessionIds: string[],
): string[] {
  const rootSessionIds = readDashboardRootSessionIdsForSessionIds(db, sessionIds);
  return readDashboardAffectedDaysForRootSessionIds(db, rootSessionIds);
}

const ATOM_DESCENDANTS_CTE = `
  WITH RECURSIVE descendants(session_id) AS (
    SELECT id FROM session
    WHERE id = ? AND parent_id IS NULL
    UNION ALL
    SELECT child.id
    FROM session child
    JOIN descendants ON child.parent_id = descendants.session_id
  )
  SELECT session_id FROM descendants
`;

export function readDashboardSessionAtomSource(
  db: SqliteDatabase,
  rootSessionId: string,
  startMs: number,
  endMs: number,
): DashboardSessionAtomSource | null {
  const rootSession = db
    .prepare(
      `
      SELECT s.id AS id,
             s.project_id AS projectId,
             p.worktree AS worktree,
             s.directory AS directory,
             s.title AS title,
             s.time_created AS timeCreated,
             s.time_updated AS timeUpdated,
             date(s.time_created/1000, 'unixepoch', 'localtime') AS day
      FROM session s
      JOIN project p ON p.id = s.project_id
      WHERE s.id = ?
        AND s.parent_id IS NULL
    `,
    )
    .get(rootSessionId) as DashboardAtomRootSessionRow | undefined;

  if (!rootSession) {
    return null;
  }

  const messages = db
    .prepare(
      `
      SELECT m.session_id AS sessionId,
             m.time_created AS timeCreated,
             date(m.time_created/1000, 'unixepoch', 'localtime') AS day,
             strftime('%H', m.time_created/1000, 'unixepoch', 'localtime') AS hour,
             json_extract(m.data, '$.role') AS role,
             json_extract(m.data, '$.modelID') AS model,
             COALESCE(json_extract(m.data, '$.providerID'), 'unknown') AS provider,
             json_extract(m.data, '$.agent') AS agent,
              ${MESSAGE_TOTAL_TOKENS_SQL} AS totalTokens,
             COALESCE(json_extract(m.data, '$.tokens.input'), 0) AS inputTokens,
             COALESCE(json_extract(m.data, '$.tokens.output'), 0) AS outputTokens,
             COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0) AS cacheReadTokens,
             COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0) AS cacheWriteTokens,
             COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0) AS reasoningTokens,
             CASE
               WHEN json_extract(m.data, '$.time.created') IS NOT NULL
                AND json_extract(m.data, '$.time.completed') IS NOT NULL
                AND json_extract(m.data, '$.time.completed') > json_extract(m.data, '$.time.created')
               THEN json_extract(m.data, '$.time.completed') - json_extract(m.data, '$.time.created')
               ELSE 0
             END AS durationMs
      FROM message m
      WHERE m.session_id IN (${ATOM_DESCENDANTS_CTE})
        AND m.time_created >= ? AND m.time_created < ?
      ORDER BY m.session_id, m.time_created, m.id
    `,
    )
    .all(rootSessionId, startMs, endMs) as DashboardAtomMessageRow[];

  const parts = db
    .prepare(
      `
      SELECT p.session_id AS sessionId,
             date(p.time_created/1000, 'unixepoch', 'localtime') AS day,
             strftime('%H', p.time_created/1000, 'unixepoch', 'localtime') AS hour,
             json_extract(p.data, '$.tool') AS tool,
             json_extract(p.data, '$.state.status') AS status,
             json_extract(p.data, '$.state.error') AS error
      FROM part p
      WHERE p.session_id IN (${ATOM_DESCENDANTS_CTE})
        AND p.time_created >= ? AND p.time_created < ?
        AND json_extract(p.data, '$.type') = 'tool'
      ORDER BY p.time_created, p.id
    `,
    )
    .all(rootSessionId, startMs, endMs) as DashboardAtomPartRow[];

  return {
    rootSession,
    messages,
    parts,
  };
}

export function fetchDashboardPartData(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  sinceRowId?: number,
): DashboardPartData {
  const rowidClause = sinceRowId == null ? "" : "rowid > ? AND ";
  const [windowStartMs, windowEndMs] = buildWindowMsParams(window);
  const params =
    sinceRowId == null
      ? [windowStartMs, windowEndMs]
      : [sinceRowId, windowStartMs, windowEndMs];

  const baseRows = db
    .prepare(`
    SELECT json_extract(p.data, '$.tool') AS tool,
           json_extract(p.data, '$.state.status') AS status,
           json_extract(p.data, '$.state.error') AS error,
           date(p.time_created/1000, 'unixepoch', 'localtime') AS day
    FROM part p
    WHERE ${rowidClause}json_extract(p.data, '$.type') = 'tool'
      AND ${buildWindowClause("p.time_created")}
  `)
    .all(...params) as Array<{
    tool: string | null;
    status: string | null;
    error: string | null;
    day: string;
  }>;

  const rowCounts = new Map<string, DashboardPartRow>();
  const toolErrorCounts = new Map<string, DashboardToolErrorRow>();
  const errorRows: DashboardErrorRow[] = [];

  for (const row of baseRows) {
    const rowKey = `${row.tool ?? ""}\t${row.status ?? ""}\t${row.day}`;
    const existing = rowCounts.get(rowKey);
    if (existing) {
      existing.cnt += 1;
    } else {
      rowCounts.set(rowKey, {
        tool: row.tool,
        status: row.status,
        day: row.day,
        cnt: 1,
      });
    }

    if (row.status === "error") {
      errorRows.push({
        error: row.error ?? "",
        day: row.day,
      });

      const toolErrorKey = `${row.tool ?? ""}\t${row.day}`;
      const existingToolError = toolErrorCounts.get(toolErrorKey);
      if (existingToolError) {
        existingToolError.cnt += 1;
      } else {
        toolErrorCounts.set(toolErrorKey, {
          tool: row.tool,
          day: row.day,
          cnt: 1,
        });
      }
    }
  }

  const rows = Array.from(rowCounts.values());
  const toolErrorRows = Array.from(toolErrorCounts.values());

  return {
    rows,
    errorRows,
    toolErrorRows,
    currentRowId: readMaxRowId(db, "part"),
  };
}

export function fetchDashboardMessageData(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  sinceRowId?: number,
): DashboardMessageData {
  const rowidClause = sinceRowId == null ? "" : "rowid > ? AND ";
  const [windowStartMs, windowEndMs] = buildWindowMsParams(window);
  const params =
    sinceRowId == null
      ? [windowStartMs, windowEndMs]
      : [sinceRowId, windowStartMs, windowEndMs];

  const rows = db
    .prepare(`
    SELECT json_extract(m.data, '$.modelID') AS model,
           json_extract(m.data, '$.agent') AS agent,
           ${MESSAGE_TOTAL_TOKENS_SQL} AS tokens,
           date(m.time_created/1000, 'unixepoch', 'localtime') AS day
    FROM message m
    WHERE ${rowidClause}json_extract(m.data, '$.role') = 'assistant'
      AND ${buildWindowClause("m.time_created")}
  `)
    .all(...params) as DashboardMessageRow[];

  const tokenIoRows = db
    .prepare(`
    SELECT date(m.time_created/1000, 'unixepoch', 'localtime') AS day,
           strftime('%H', m.time_created/1000, 'unixepoch', 'localtime') AS hour,
           SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0)) AS input_tokens,
           SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0)) AS output_tokens
    FROM message m
    WHERE ${rowidClause}json_extract(m.data, '$.role') = 'assistant'
      AND ${buildWindowClause("m.time_created")}
    GROUP BY day, hour
  `)
    .all(...params) as DashboardTokenIoRow[];

  const subagentRows = db
    .prepare(`
    SELECT json_extract(m.data, '$.agent') AS agent,
           date(m.time_created/1000, 'unixepoch', 'localtime') AS day,
           strftime('%H', m.time_created/1000, 'unixepoch', 'localtime') AS hour,
           COUNT(*) AS cnt
    FROM message m
    WHERE ${rowidClause}json_extract(m.data, '$.role') = 'assistant'
      AND ${buildWindowClause("m.time_created")}
      AND json_extract(m.data, '$.agent') IS NOT NULL
    GROUP BY agent, day, hour
  `)
    .all(...params) as DashboardSubagentRow[];

  return {
    rows,
    tokenIoRows,
    subagentRows,
    currentRowId: readMaxRowId(db, "message"),
  };
}

export function fetchDashboardRepoData(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  sinceRowId?: number,
): DashboardRepoData {
  const rowidClause = sinceRowId == null ? "" : "s.rowid > ? AND ";
  const [windowStartMs, windowEndMs] = buildWindowMsParams(window);
  const params =
    sinceRowId == null
      ? [windowStartMs, windowEndMs]
      : [sinceRowId, windowStartMs, windowEndMs];

  const rows = db
    .prepare(`
    SELECT p.worktree AS worktree,
           s.directory AS directory,
           date(s.time_created/1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS cnt
    FROM session s
    JOIN project p ON s.project_id = p.id
    WHERE ${rowidClause}s.parent_id IS NULL
      AND ${buildWindowClause("s.time_created")}
    GROUP BY p.worktree, s.directory, day
  `)
    .all(...params) as DashboardRepoRow[];

  const sessionCount =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM session WHERE parent_id IS NULL AND ${buildWindowClause("time_created")}`,
        )
        .get(windowStartMs, windowEndMs) as { cnt: number } | undefined
    )?.cnt ?? 0;

  return {
    rows,
    currentRowId: readMaxRowId(db, "session"),
    sessionCount,
  };
}

function fetchDashboardLiveSummary(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
): DashboardLiveSummary {
  const [windowStartMs, windowEndMs] = buildWindowMsParams(window);

  const heatmapRows = db
    .prepare(`
    SELECT date(time_created/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
    FROM session
    WHERE parent_id IS NULL
      AND ${buildWindowClause("time_created")}
    GROUP BY day
    ORDER BY day
  `)
    .all(windowStartMs, windowEndMs) as {
    day: string;
    cnt: number;
  }[];

  const params = [windowStartMs, windowEndMs];
  const totalSessions =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM session WHERE parent_id IS NULL AND ${buildWindowClause("time_created")}`,
        )
        .get(...params) as { cnt: number } | undefined
    )?.cnt ?? 0;
  const activeProjects =
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT project_id) AS cnt FROM session WHERE parent_id IS NULL AND ${buildWindowClause("time_created")}`,
        )
        .get(...params) as { cnt: number } | undefined
    )?.cnt ?? 0;

  const recentSessions = db
    .prepare(`
    SELECT id, title, directory, time_created, time_updated
    FROM session
    WHERE parent_id IS NULL
      AND ${buildWindowClause("time_created")}
    ORDER BY time_updated DESC
    LIMIT 5
  `)
    .all(...params) as DashboardRecentSessionRow[];

  const recentIds = recentSessions.map((session) => session.id);
  const recentTokenRows =
    recentIds.length > 0
      ? (db
          .prepare(`
      SELECT m.session_id, COALESCE(SUM(${MESSAGE_TOTAL_TOKENS_SQL}), 0) AS total_tokens
      FROM message m
      WHERE m.session_id IN (${recentIds.map(() => "?").join(",")})
        AND json_extract(m.data, '$.role') = 'assistant'
      GROUP BY m.session_id
    `)
          .all(...recentIds) as DashboardRecentTokenRow[])
      : [];

  return {
    heatmapRows,
    totalSessions,
    activeProjects,
    recentSessions,
    recentTokenRows,
  };
}
