type SqliteDatabase = import("better-sqlite3").Database;

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

export interface DashboardCacheStamp {
  partRowId: number;
  messageRowId: number;
  sessionRowId: number;
  rootSessionCount: number;
  maxPartUpdatedAt: number;
  maxMessageUpdatedAt: number;
  maxSessionUpdatedAt: number;
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
  return `date(${column}/1000, 'unixepoch', 'localtime') >= ? AND date(${column}/1000, 'unixepoch', 'localtime') < ?`;
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

export function readDashboardChangedDaysSince(
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
  const ids = Array.from(new Set(sessionIds));
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(",");
  const days = new Set<string>();

  const sessionDays = db
    .prepare(
      `
      SELECT DISTINCT date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM session
      WHERE id IN (${placeholders})
    `,
    )
    .all(...ids) as Array<{ day: string | null }>;
  for (const row of sessionDays) {
    if (row.day) {
      days.add(row.day);
    }
  }

  const messageDays = db
    .prepare(
      `
      SELECT DISTINCT date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM message
      WHERE session_id IN (${placeholders})
    `,
    )
    .all(...ids) as Array<{ day: string | null }>;
  for (const row of messageDays) {
    if (row.day) {
      days.add(row.day);
    }
  }

  const partDays = db
    .prepare(
      `
      SELECT DISTINCT date(p.time_created/1000, 'unixepoch', 'localtime') AS day
      FROM part p
      JOIN message m ON m.id = p.message_id
      WHERE m.session_id IN (${placeholders})
    `,
    )
    .all(...ids) as Array<{ day: string | null }>;
  for (const row of partDays) {
    if (row.day) {
      days.add(row.day);
    }
  }

  return Array.from(days).sort();
}

export function fetchDashboardPartData(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  sinceRowId?: number,
): DashboardPartData {
  const rowidClause = sinceRowId == null ? "" : "rowid > ? AND ";
  const params =
    sinceRowId == null
      ? [window.startDayInclusive, window.endDayExclusive]
      : [sinceRowId, window.startDayInclusive, window.endDayExclusive];

  const rows = db
    .prepare(`
    SELECT json_extract(p.data, '$.tool') AS tool,
           json_extract(p.data, '$.state.status') AS status,
           date(p.time_created/1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS cnt
    FROM part p
    WHERE ${rowidClause}json_extract(p.data, '$.type') = 'tool'
      AND ${buildWindowClause("p.time_created")}
    GROUP BY tool, status, day
  `)
    .all(...params) as DashboardPartRow[];

  const errorRows = db
    .prepare(`
    SELECT json_extract(p.data, '$.state.error') AS error,
           date(p.time_created/1000, 'unixepoch', 'localtime') AS day
    FROM part p
    WHERE ${rowidClause}json_extract(p.data, '$.type') = 'tool'
      AND ${buildWindowClause("p.time_created")}
      AND json_extract(p.data, '$.state.status') = 'error'
  `)
    .all(...params) as DashboardErrorRow[];

  const toolErrorRows = db
    .prepare(`
    SELECT json_extract(p.data, '$.tool') AS tool,
           date(p.time_created/1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS cnt
    FROM part p
    WHERE ${rowidClause}json_extract(p.data, '$.type') = 'tool'
      AND ${buildWindowClause("p.time_created")}
      AND json_extract(p.data, '$.state.status') = 'error'
    GROUP BY tool, day
  `)
    .all(...params) as DashboardToolErrorRow[];

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
  const params =
    sinceRowId == null
      ? [window.startDayInclusive, window.endDayExclusive]
      : [sinceRowId, window.startDayInclusive, window.endDayExclusive];

  const rows = db
    .prepare(`
    SELECT json_extract(m.data, '$.modelID') AS model,
           json_extract(m.data, '$.agent') AS agent,
           COALESCE(json_extract(m.data, '$.tokens.total'), 0) AS tokens,
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
  const params =
    sinceRowId == null
      ? [window.startDayInclusive, window.endDayExclusive]
      : [sinceRowId, window.startDayInclusive, window.endDayExclusive];

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
        .get(window.startDayInclusive, window.endDayExclusive) as
        | { cnt: number }
        | undefined
    )?.cnt ?? 0;

  return {
    rows,
    currentRowId: readMaxRowId(db, "session"),
    sessionCount,
  };
}

export function fetchDashboardLiveSummary(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
): DashboardLiveSummary {
  const heatmapRows = db
    .prepare(`
    SELECT date(time_created/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
    FROM session
    WHERE parent_id IS NULL
      AND ${buildWindowClause("time_created")}
    GROUP BY day
    ORDER BY day
  `)
    .all(window.startDayInclusive, window.endDayExclusive) as {
    day: string;
    cnt: number;
  }[];

  const params = [window.startDayInclusive, window.endDayExclusive];
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
      SELECT m.session_id, COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens
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
