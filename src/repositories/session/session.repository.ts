import type { Database } from "better-sqlite3";

export interface SessionRecord {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
  parent_id: string | null;
  summary_additions: number;
  summary_deletions: number;
  summary_files: number;
  summary_diffs: string | null;
}

export interface SessionTitleRecord {
  id: string;
  title: string;
}

export interface SessionRoleCountRecord {
  role: string;
  cnt: number;
}

export interface SessionTokenStatsRecord {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_cost: number;
}

export interface SessionChildRecord {
  id: string;
  title: string;
  time_created: number;
  time_updated: number;
}

export interface SessionModelTokenBreakdownRecord {
  model_id: string;
  provider_id: string;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  total_cost: number;
}

export interface SessionMessageRecord {
  id: string;
  role: "user" | "assistant";
  text: string;
  time_created: string | number;
  model_id?: string;
  provider_id?: string;
  agent?: string;
  output_tokens?: number | string;
  response_started?: number | string;
  response_completed?: number | string;
}

export interface SessionToolPartRecord {
  message_id: string;
  data: string;
}

export interface SessionTodoRecord {
  content: string;
  status: string;
  priority: string;
}

export function getSessionRecord(
  db: Database,
  sessionId: string,
): SessionRecord | null {
  return (
    (db
      .prepare(`
      SELECT id, title, directory, time_created, time_updated, parent_id,
             summary_additions, summary_deletions, summary_files, summary_diffs
      FROM session
      WHERE id = ?
    `)
      .get(sessionId) as SessionRecord | undefined) ?? null
  );
}

export function getSessionTitleRecord(
  db: Database,
  sessionId: string,
): SessionTitleRecord | null {
  return (
    (db.prepare("SELECT id, title FROM session WHERE id = ?").get(sessionId) as
      | SessionTitleRecord
      | undefined) ?? null
  );
}

export function listSessionTitlesByIds(
  db: Database,
  sessionIds: string[],
): SessionTitleRecord[] {
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, title FROM session WHERE id IN (${placeholders}) ORDER BY time_updated DESC`,
    )
    .all(...sessionIds) as SessionTitleRecord[];
}

export function listSessionRoleCounts(
  db: Database,
  sessionId: string,
): SessionRoleCountRecord[] {
  return db
    .prepare(
      `SELECT json_extract(m.data, '$.role') AS role, COUNT(*) AS cnt FROM message m WHERE m.session_id = ? GROUP BY role`,
    )
    .all(sessionId) as SessionRoleCountRecord[];
}

export function getSessionTokenStats(
  db: Database,
  sessionId: string,
): SessionTokenStatsRecord {
  return db
    .prepare(`
      SELECT COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.input')), 0) AS input_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.output')), 0) AS output_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.reasoning')), 0) AS reasoning_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.cache.read')), 0) AS cache_read_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.cache.write')), 0) AS cache_write_tokens,
             COALESCE(SUM(json_extract(m.data, '$.cost')), 0) AS total_cost
      FROM message m WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'assistant'
    `)
    .get(sessionId) as SessionTokenStatsRecord;
}

export function countSessionCompactionMessages(
  db: Database,
  sessionId: string,
): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM message WHERE session_id = ? AND (
          json_extract(data, '$.mode') = 'compaction' OR json_extract(data, '$.agent') = 'compaction'
        )`,
      )
      .get(sessionId) as { cnt: number }
  ).cnt;
}

export function countSessionToolErrors(
  db: Database,
  sessionId: string,
): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'error'`,
      )
      .get(sessionId) as { cnt: number }
  ).cnt;
}

export function listChildSessionRecords(
  db: Database,
  sessionId: string,
): SessionChildRecord[] {
  return db
    .prepare(
      `SELECT id, title, time_created, time_updated
       FROM session
       WHERE parent_id = ?
       ORDER BY time_updated DESC, time_created DESC, id ASC`,
    )
    .all(sessionId) as SessionChildRecord[];
}

export function listSessionModelTokenBreakdown(
  db: Database,
  sessionId: string,
): SessionModelTokenBreakdownRecord[] {
  return db
    .prepare(
      `SELECT
          COALESCE(json_extract(data, '$.modelID'), 'unknown') AS model_id,
          COALESCE(json_extract(data, '$.providerID'), 'unknown') AS provider_id,
          COUNT(*) AS message_count,
          COALESCE(SUM(json_extract(data, '$.tokens.input')), 0) AS input_tokens,
          COALESCE(SUM(json_extract(data, '$.tokens.output')), 0) AS output_tokens,
          COALESCE(SUM(json_extract(data, '$.tokens.reasoning')), 0) AS reasoning_tokens,
          COALESCE(SUM(json_extract(data, '$.tokens.cache.read')), 0) AS cache_read_tokens,
          COALESCE(SUM(json_extract(data, '$.tokens.cache.write')), 0) AS cache_write_tokens,
          COALESCE(SUM(json_extract(data, '$.tokens.total')), 0) AS total_tokens,
          COALESCE(SUM(json_extract(data, '$.cost')), 0) AS total_cost
       FROM message
       WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
       GROUP BY model_id, provider_id
       ORDER BY total_tokens DESC`,
    )
    .all(sessionId) as SessionModelTokenBreakdownRecord[];
}

export function countSessionToolCalls(db: Database, sessionId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM part p WHERE p.session_id = ? AND json_extract(p.data, '$.type') = 'tool'`,
      )
      .get(sessionId) as { cnt: number }
  ).cnt;
}

export function countSubagentSessions(db: Database, sessionId: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM session WHERE parent_id = ?`)
      .get(sessionId) as { cnt: number }
  ).cnt;
}

export function listSessionMessages(
  db: Database,
  sessionId: string,
): SessionMessageRecord[] {
  return db
    .prepare(`
      SELECT m.id, json_extract(m.data, '$.role') AS role, json_extract(m.data, '$.modelID') AS model_id,
             json_extract(m.data, '$.providerID') AS provider_id, json_extract(m.data, '$.agent') AS agent,
             json_extract(m.data, '$.tokens.output') AS output_tokens,
             json_extract(m.data, '$.time.created') AS response_started,
             json_extract(m.data, '$.time.completed') AS response_completed,
             json_extract(p.data, '$.text') AS text, m.time_created
      FROM message m JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ? AND json_extract(p.data, '$.type') = 'text' AND json_extract(p.data, '$.text') IS NOT NULL
      ORDER BY m.time_created ASC
    `)
    .all(sessionId) as SessionMessageRecord[];
}

export function listSessionToolParts(
  db: Database,
  sessionId: string,
): SessionToolPartRecord[] {
  return db
    .prepare(`
      SELECT p.message_id, p.data as data
      FROM part p WHERE p.session_id = ? AND json_extract(p.data, '$.type') = 'tool'
      ORDER BY p.message_id, p.time_created ASC, p.rowid ASC
    `)
    .all(sessionId) as SessionToolPartRecord[];
}

export function listSessionTodos(
  db: Database,
  sessionId: string,
): SessionTodoRecord[] {
  return db
    .prepare(`
      SELECT content, status, priority FROM todo WHERE session_id = ? ORDER BY position ASC
    `)
    .all(sessionId) as SessionTodoRecord[];
}
