type SqliteDatabase = import("better-sqlite3").Database;

import { buildMessageTotalTokensSql } from "../../lib/message-token-sql.js";

// =============================================================================
// SQL access-pattern policy (PERMANENT — do not violate)
// =============================================================================
// opencode's DB is ~8GB (message ~250K rows, part ~1.25M rows, each carrying a
// ~5KB JSON blob in `data`). time_updated is NOT indexed on message/part. The
// only safe access patterns against message/part are:
//
//   (a) MAX(rowid)                      -- O(1), reads the btree tail.
//   (b) WHERE rowid > ?                 -- rowid range scan, new rows only.
//   (c) session_id index lookups        -- per-root reads via
//       message(session_id,time_created,id) / part(session_id).
//   (d) full scan of the small `session` table (~10K rows) is allowed, as long
//       as we never SELECT blob columns (e.g. summary_diffs).
//   (e) PRAGMA data_version on a long-lived connection (see change-detector).
//
// FORBIDDEN on message/part: MAX(time_updated), COUNT(*) over the whole table,
// and any `WHERE ... OR ...` that defeats the index and forces a full scan.
// =============================================================================

const MESSAGE_TOTAL_TOKENS_SQL = buildMessageTotalTokensSql("m.data");

// ---------------------------------------------------------------------------
// Selection-window types
// ---------------------------------------------------------------------------

export interface DashboardWindowMs {
  startMs: number; // inclusive (local midnight of startDay)
  endMs: number; // exclusive (local midnight of endDayExclusive)
}

// ---------------------------------------------------------------------------
// Overview reads (session table only — pattern (d))
// ---------------------------------------------------------------------------

export interface DashboardSummaryRow {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  activeProjects: number;
}

// Summary uses opencode's pre-aggregated session columns (tokens_*/cost),
// avoiding any message re-computation. Attribution is session.time_created.
export function readDashboardSummary(
  db: SqliteDatabase,
  window: DashboardWindowMs,
): DashboardSummaryRow {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS totalSessions,
             COALESCE(SUM(
               COALESCE(tokens_input, 0)
                 + COALESCE(tokens_output, 0)
                 + COALESCE(tokens_cache_read, 0)
                 + COALESCE(tokens_cache_write, 0)
             ), 0) AS totalTokens,
             COALESCE(SUM(COALESCE(cost, 0)), 0) AS totalCost,
             COUNT(DISTINCT project_id) AS activeProjects
      FROM session
      WHERE parent_id IS NULL
        AND time_created >= ? AND time_created < ?
    `,
    )
    .get(window.startMs, window.endMs) as DashboardSummaryRow | undefined;

  return (
    row ?? {
      totalSessions: 0,
      totalTokens: 0,
      totalCost: 0,
      activeProjects: 0,
    }
  );
}

export interface DashboardHeatmapDayRow {
  day: string;
  count: number;
}

// Heatmap is "root sessions per local day" over a trailing window. Pure session
// table aggregation — never touches message/part atoms.
export function readDashboardHeatmapDays(
  db: SqliteDatabase,
  window: DashboardWindowMs,
): DashboardHeatmapDayRow[] {
  return db
    .prepare(
      `
      SELECT date(time_created/1000, 'unixepoch', 'localtime') AS day,
             COUNT(*) AS count
      FROM session
      WHERE parent_id IS NULL
        AND time_created >= ? AND time_created < ?
      GROUP BY day
      HAVING COUNT(*) > 0
      ORDER BY day
    `,
    )
    .all(window.startMs, window.endMs) as DashboardHeatmapDayRow[];
}

export interface DashboardRecentSessionRow {
  id: string;
  title: string;
  directory: string;
  timeUpdated: number;
  totalTokens: number;
}

// recentSessions: 5 most recently *updated* root sessions, independent of the
// selection window. totalTokens is the recursive root+descendant sum; bounded
// to 5 roots so the recursive CTE + per-root message read stays cheap and uses
// the message(session_id,...) index (pattern (c)).
export function readDashboardRecentSessions(
  db: SqliteDatabase,
): DashboardRecentSessionRow[] {
  const recents = db
    .prepare(
      `
      SELECT id, title, directory, time_updated AS timeUpdated
      FROM session
      WHERE parent_id IS NULL
      ORDER BY time_updated DESC
      LIMIT 5
    `,
    )
    .all() as Array<{
    id: string;
    title: string;
    directory: string;
    timeUpdated: number;
  }>;

  return recents.map((session) => ({
    ...session,
    totalTokens: readRecursiveRootTokens(db, session.id),
  }));
}

function readRecursiveRootTokens(
  db: SqliteDatabase,
  rootSessionId: string,
): number {
  const row = db
    .prepare(
      `
      WITH RECURSIVE descendants(session_id) AS (
        SELECT id FROM session WHERE id = ?
        UNION ALL
        SELECT child.id
        FROM session child
        JOIN descendants ON child.parent_id = descendants.session_id
      )
      SELECT COALESCE(SUM(${MESSAGE_TOTAL_TOKENS_SQL}), 0) AS totalTokens
      FROM message m
      WHERE m.session_id IN (SELECT session_id FROM descendants)
        AND json_extract(m.data, '$.role') = 'assistant'
    `,
    )
    .get(rootSessionId) as { totalTokens: number } | undefined;

  return row?.totalTokens ?? 0;
}

// ---------------------------------------------------------------------------
// Delta reads (watermarks + new-row scans — patterns (a) and (b))
// ---------------------------------------------------------------------------

export interface DashboardTableWatermarks {
  sessionMaxRowId: number;
  messageMaxRowId: number;
  partMaxRowId: number;
}

// MAX(rowid) is O(1) on each table (btree tail). Never use MAX(time_updated).
export function readTableWatermarks(
  db: SqliteDatabase,
): DashboardTableWatermarks {
  return {
    sessionMaxRowId: readMaxRowId(db, "session"),
    messageMaxRowId: readMaxRowId(db, "message"),
    partMaxRowId: readMaxRowId(db, "part"),
  };
}

function readMaxRowId(
  db: SqliteDatabase,
  table: "session" | "message" | "part",
): number {
  const row = db.prepare(`SELECT MAX(rowid) AS r FROM ${table}`).get() as
    | { r: number | null }
    | undefined;
  return row?.r ?? 0;
}

function buildSessionIdsWithNewRowsSql(table: "message" | "part"): string {
  // `NOT INDEXED` is load-bearing: without it the planner satisfies the
  // DISTINCT via a full COVERING-INDEX scan of message(session_id,...) /
  // part(session_id) — reading EVERY index entry, not just new rows. NOT INDEXED
  // forces the INTEGER PRIMARY KEY (rowid>?) range search so we touch only the
  // appended tail (pattern (b)). Verified via EXPLAIN QUERY PLAN.
  return `
      SELECT DISTINCT session_id AS sessionId
      FROM ${table} NOT INDEXED
      WHERE rowid > ?
    `;
}

// New session_ids whose rows appeared after a watermark, via rowid range scan
// (pattern (b)). Catches appended messages/parts without scanning the whole
// table. Returns distinct session_ids touched by new rows.
export function readSessionIdsWithNewRows(
  db: SqliteDatabase,
  table: "message" | "part",
  sinceRowId: number,
): string[] {
  const rows = db
    .prepare(buildSessionIdsWithNewRowsSql(table))
    .all(sinceRowId) as Array<{ sessionId: string }>;
  return rows.map((row) => row.sessionId);
}

// New session rows (root + child) appearing after a watermark. The session
// table is small, so a rowid range scan is trivially cheap.
export function readSessionRowsWithNewRows(
  db: SqliteDatabase,
  sinceRowId: number,
): Array<{ id: string; parentId: string | null }> {
  return db
    .prepare(
      `
      SELECT id, parent_id AS parentId
      FROM session
      WHERE rowid > ?
    `,
    )
    .all(sinceRowId) as Array<{ id: string; parentId: string | null }>;
}

// ---------------------------------------------------------------------------
// Root-list reads (session table scan — pattern (d))
// ---------------------------------------------------------------------------

export interface DashboardRootListRow {
  id: string;
  timeCreated: number;
  timeUpdated: number;
}

// Full list of root sessions whose time_created falls within the aggregation
// horizon (trailing 90 days). Used for cold-start chunk planning, root-list
// diffing (deletion detection), and time_updated change detection.
export function readRootSessionList(
  db: SqliteDatabase,
  window: DashboardWindowMs,
): DashboardRootListRow[] {
  return db
    .prepare(
      `
      SELECT id,
             time_created AS timeCreated,
             time_updated AS timeUpdated
      FROM session
      WHERE parent_id IS NULL
        AND time_created >= ? AND time_created < ?
      ORDER BY time_created DESC
    `,
    )
    .all(window.startMs, window.endMs) as DashboardRootListRow[];
}

// Map a set of session_ids (any depth) to their owning root session ids.
export function readRootSessionIdsForSessionIds(
  db: SqliteDatabase,
  sessionIds: string[],
): string[] {
  const ids = Array.from(new Set(sessionIds)).sort();
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      WITH RECURSIVE session_tree(id, root_session_id) AS (
        SELECT id, id FROM session WHERE parent_id IS NULL
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

// ---------------------------------------------------------------------------
// Per-root source stamps (session_id index lookups — pattern (c))
// ---------------------------------------------------------------------------

export interface DashboardRootStampRow {
  rootSessionId: string;
  sessionRowCount: number;
  sessionMaxRowId: number;
  sessionMaxUpdatedAt: number;
  messageRowCount: number;
  messageMaxRowId: number;
  messageMaxUpdatedAt: number;
  partRowCount: number;
  partMaxRowId: number;
  partMaxUpdatedAt: number;
}

// Per-root stamps: COUNT/MAX scoped to a root's descendant session_ids.
//
// The message/part stats MUST be expressed as
//   SELECT ... FROM message m WHERE m.session_id IN (<descendants>) GROUP BY m.session_id
// (the same shape as readRootSource), NOT as
//   FROM descendants JOIN message m ON m.session_id = descendants.session_id.
// The JOIN form lets the planner drive from the heavy message/part table,
// degrading to `SCAN message` + an AUTOMATIC COVERING INDEX on descendants
// (verified via EXPLAIN QUERY PLAN). The IN form forces a per-session index
// SEARCH on message(session_id,...) / part(session_id). We first aggregate
// per-session through the index, then roll those tiny per-session rows up to
// the root via the descendants mapping. This keeps every COUNT(*)/MAX() bounded
// to a root's own session_ids — never whole-table.
function buildRootSourceStampsSql(placeholders: string): string {
  return `
      WITH RECURSIVE descendants(root_session_id, session_id) AS (
        SELECT id, id FROM session
        WHERE id IN (${placeholders}) AND parent_id IS NULL
        UNION ALL
        SELECT descendants.root_session_id, child.id
        FROM session child
        JOIN descendants ON child.parent_id = descendants.session_id
      ),
      message_per_session AS (
        SELECT m.session_id AS sessionId,
               COUNT(*) AS rowCount,
               MAX(m.rowid) AS maxRowId,
               MAX(m.time_updated) AS maxUpdatedAt
        FROM message m
        WHERE m.session_id IN (SELECT session_id FROM descendants)
        GROUP BY m.session_id
      ),
      part_per_session AS (
        SELECT p.session_id AS sessionId,
               COUNT(*) AS rowCount,
               MAX(p.rowid) AS maxRowId,
               MAX(p.time_updated) AS maxUpdatedAt
        FROM part p
        WHERE p.session_id IN (SELECT session_id FROM descendants)
        GROUP BY p.session_id
      ),
      session_stats AS (
        SELECT descendants.root_session_id AS rootSessionId,
               COUNT(*) AS sessionRowCount,
               MAX(s.rowid) AS sessionMaxRowId,
               MAX(s.time_updated) AS sessionMaxUpdatedAt
        FROM descendants
        JOIN session s ON s.id = descendants.session_id
        GROUP BY descendants.root_session_id
      ),
      message_stats AS (
        SELECT descendants.root_session_id AS rootSessionId,
               COALESCE(SUM(mps.rowCount), 0) AS messageRowCount,
               COALESCE(MAX(mps.maxRowId), 0) AS messageMaxRowId,
               COALESCE(MAX(mps.maxUpdatedAt), 0) AS messageMaxUpdatedAt
        FROM descendants
        LEFT JOIN message_per_session mps
          ON mps.sessionId = descendants.session_id
        GROUP BY descendants.root_session_id
      ),
      part_stats AS (
        SELECT descendants.root_session_id AS rootSessionId,
               COALESCE(SUM(pps.rowCount), 0) AS partRowCount,
               COALESCE(MAX(pps.maxRowId), 0) AS partMaxRowId,
               COALESCE(MAX(pps.maxUpdatedAt), 0) AS partMaxUpdatedAt
        FROM descendants
        LEFT JOIN part_per_session pps
          ON pps.sessionId = descendants.session_id
        GROUP BY descendants.root_session_id
      )
      SELECT session_stats.rootSessionId AS rootSessionId,
             session_stats.sessionRowCount AS sessionRowCount,
             session_stats.sessionMaxRowId AS sessionMaxRowId,
             session_stats.sessionMaxUpdatedAt AS sessionMaxUpdatedAt,
             message_stats.messageRowCount AS messageRowCount,
             message_stats.messageMaxRowId AS messageMaxRowId,
             message_stats.messageMaxUpdatedAt AS messageMaxUpdatedAt,
             part_stats.partRowCount AS partRowCount,
             part_stats.partMaxRowId AS partMaxRowId,
             part_stats.partMaxUpdatedAt AS partMaxUpdatedAt
      FROM session_stats
      JOIN message_stats ON message_stats.rootSessionId = session_stats.rootSessionId
      JOIN part_stats ON part_stats.rootSessionId = session_stats.rootSessionId
      ORDER BY session_stats.rootSessionId
    `;
}

export function readRootSourceStamps(
  db: SqliteDatabase,
  rootSessionIds: string[],
): DashboardRootStampRow[] {
  const ids = Array.from(new Set(rootSessionIds)).sort();
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(buildRootSourceStampsSql(placeholders))
    .all(...ids) as DashboardRootStampRow[];
}

// ---------------------------------------------------------------------------
// Per-root atom source rows (session_id index lookups — pattern (c))
// ---------------------------------------------------------------------------

export interface DashboardRootRow {
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
  provider: string;
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

export interface DashboardRootSource {
  root: DashboardRootRow;
  messages: DashboardAtomMessageRow[];
  parts: DashboardAtomPartRow[];
}

const ATOM_DESCENDANTS_CTE = `
  WITH RECURSIVE descendants(session_id) AS (
    SELECT id FROM session WHERE id = ? AND parent_id IS NULL
    UNION ALL
    SELECT child.id
    FROM session child
    JOIN descendants ON child.parent_id = descendants.session_id
  )
  SELECT session_id FROM descendants
`;

const ROOT_SOURCE_ROOT_SQL = `
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
      WHERE s.id = ? AND s.parent_id IS NULL
    `;

const ROOT_SOURCE_MESSAGES_SQL = `
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
      ORDER BY m.session_id, m.time_created, m.id
    `;

const ROOT_SOURCE_PARTS_SQL = `
      SELECT p.session_id AS sessionId,
             date(p.time_created/1000, 'unixepoch', 'localtime') AS day,
             strftime('%H', p.time_created/1000, 'unixepoch', 'localtime') AS hour,
             json_extract(p.data, '$.tool') AS tool,
             json_extract(p.data, '$.state.status') AS status,
             json_extract(p.data, '$.state.error') AS error
      FROM part p
      WHERE p.session_id IN (${ATOM_DESCENDANTS_CTE})
        AND json_extract(p.data, '$.type') = 'tool'
      ORDER BY p.time_created, p.id
    `;

// Read all source rows for one root (root session + descendant assistant/tool
// rows). All access is via session_id indexes; the JSON blobs are only read for
// rows belonging to this single root, never table-wide.
export function readRootSource(
  db: SqliteDatabase,
  rootSessionId: string,
): DashboardRootSource | null {
  const root = db.prepare(ROOT_SOURCE_ROOT_SQL).get(rootSessionId) as
    | DashboardRootRow
    | undefined;

  if (!root) {
    return null;
  }

  const messages = db
    .prepare(ROOT_SOURCE_MESSAGES_SQL)
    .all(rootSessionId) as DashboardAtomMessageRow[];

  const parts = db
    .prepare(ROOT_SOURCE_PARTS_SQL)
    .all(rootSessionId) as DashboardAtomPartRow[];

  return { root, messages, parts };
}

// ---------------------------------------------------------------------------
// Query-plan probe (test-only)
// ---------------------------------------------------------------------------

export interface DashboardQueryPlan {
  // Human label for the query being probed.
  label: string;
  // The `detail` column of each EXPLAIN QUERY PLAN row.
  steps: string[];
}

// Run EXPLAIN QUERY PLAN over the heavy dashboard queries (stamps / delta /
// per-root source) so a test can assert no `SCAN message` / `SCAN part` ever
// degrades the indexed access. Uses the exact SQL the runtime functions
// prepare, keeping the assertion honest. Intended for tests only.
export function explainDashboardQueryPlans(
  db: SqliteDatabase,
  rootSessionId: string,
): DashboardQueryPlan[] {
  const plan = (label: string, sql: string, params: unknown[]) => {
    const rows = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params) as Array<{ detail: string }>;
    return { label, steps: rows.map((row) => row.detail) };
  };

  return [
    plan("stamps", buildRootSourceStampsSql("?"), [rootSessionId]),
    plan("delta-message", buildSessionIdsWithNewRowsSql("message"), [0]),
    plan("delta-part", buildSessionIdsWithNewRowsSql("part"), [0]),
    plan("per-root-source-messages", ROOT_SOURCE_MESSAGES_SQL, [rootSessionId]),
    plan("per-root-source-parts", ROOT_SOURCE_PARTS_SQL, [rootSessionId]),
  ];
}
