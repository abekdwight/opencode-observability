import type { Database } from "../../lib/sqlite.js";

export interface ExportSessionRecord {
  id: string;
  parent_id: string | null;
  title: string;
  directory: string;
  worktree: string;
  time_created: number;
  time_updated: number;
}

export interface ExportSessionFilters {
  worktree?: string;
}

export interface ExportMessageRecord {
  id: string;
  session_id: string;
  parent_id: string | null;
  role: "user" | "assistant";
  model_id: string | null;
  provider_id: string | null;
  agent: string | null;
  time_created: number;
  time_updated: number;
  source_created: number | null;
  source_completed: number | null;
}

export interface ExportPartRecord {
  id: string;
  message_id: string;
  session_id: string;
  parent_id: string | null;
  time_created: number;
  data: string;
}

function isCompactionWhere(alias: string): string {
  return `(
    COALESCE(json_extract(${alias}.data, '$.mode'), '') = 'compaction'
    OR COALESCE(json_extract(${alias}.data, '$.agent'), '') = 'compaction'
    OR COALESCE(json_extract(${alias}.data, '$.summary'), 0) = 1
  )`;
}

export function listExportRootSessions(
  db: Database,
  filters: ExportSessionFilters = {},
): ExportSessionRecord[] {
  const hasWorktreeFilter = typeof filters.worktree === "string";
  return db
    .prepare(
      `SELECT s.id, s.parent_id, s.title, s.directory, p.worktree, s.time_created, s.time_updated
       FROM session s
       JOIN project p ON p.id = s.project_id
       WHERE s.parent_id IS NULL
         ${hasWorktreeFilter ? "AND p.worktree = ?" : ""}
       ORDER BY s.time_updated DESC, s.time_created DESC, s.id ASC`,
    )
    .all(
      ...(hasWorktreeFilter ? [filters.worktree] : []),
    ) as ExportSessionRecord[];
}

export function getExportSession(
  db: Database,
  sessionId: string,
): ExportSessionRecord | null {
  return (
    (db
      .prepare(
        `SELECT s.id, s.parent_id, s.title, s.directory, p.worktree, s.time_created, s.time_updated
         FROM session s
         JOIN project p ON p.id = s.project_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as ExportSessionRecord | undefined) ?? null
  );
}

export function countExportableMessages(
  db: Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM message m
       WHERE m.session_id = ?
         AND json_extract(m.data, '$.role') IN ('user', 'assistant')
         AND NOT ${isCompactionWhere("m")}`,
    )
    .get(sessionId) as { cnt: number };
  return row.cnt;
}

export function listExportableMessages(
  db: Database,
  sessionId: string,
): ExportMessageRecord[] {
  return db
    .prepare(
      `SELECT
         m.id,
         m.session_id,
         s.parent_id,
         json_extract(m.data, '$.role') AS role,
         json_extract(m.data, '$.modelID') AS model_id,
         json_extract(m.data, '$.providerID') AS provider_id,
         json_extract(m.data, '$.agent') AS agent,
         m.time_created,
         m.time_updated,
         json_extract(m.data, '$.time.created') AS source_created,
         json_extract(m.data, '$.time.completed') AS source_completed
       FROM message m
       JOIN session s ON s.id = m.session_id
       WHERE m.session_id = ?
         AND json_extract(m.data, '$.role') IN ('user', 'assistant')
         AND NOT ${isCompactionWhere("m")}
       ORDER BY m.time_created ASC, m.id ASC`,
    )
    .all(sessionId) as ExportMessageRecord[];
}

export function getExportableMessageById(
  db: Database,
  messageId: string,
): ExportMessageRecord | null {
  return (
    (db
      .prepare(
        `SELECT
           m.id,
           m.session_id,
           s.parent_id,
           json_extract(m.data, '$.role') AS role,
           json_extract(m.data, '$.modelID') AS model_id,
           json_extract(m.data, '$.providerID') AS provider_id,
           json_extract(m.data, '$.agent') AS agent,
           m.time_created,
           m.time_updated,
           json_extract(m.data, '$.time.created') AS source_created,
           json_extract(m.data, '$.time.completed') AS source_completed
         FROM message m
         JOIN session s ON s.id = m.session_id
         WHERE m.id = ?
           AND json_extract(m.data, '$.role') IN ('user', 'assistant')
           AND NOT ${isCompactionWhere("m")}`,
      )
      .get(messageId) as ExportMessageRecord | undefined) ?? null
  );
}

export function listPartsForMessages(
  db: Database,
  messageIds: string[],
): ExportPartRecord[] {
  if (messageIds.length === 0) return [];
  const placeholders = messageIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT p.id, p.message_id, p.session_id, s.parent_id, p.time_created, p.data
       FROM part p
       JOIN session s ON s.id = p.session_id
       WHERE message_id IN (${placeholders})
       ORDER BY p.time_created ASC, p.id ASC`,
    )
    .all(...messageIds) as ExportPartRecord[];
}

export function getPartById(
  db: Database,
  partId: string,
): ExportPartRecord | null {
  return (
    (db
      .prepare(
        `SELECT p.id, p.message_id, p.session_id, s.parent_id, p.time_created, p.data
         FROM part p
         JOIN message m ON m.id = p.message_id
         JOIN session s ON s.id = p.session_id
         WHERE p.id = ?
           AND json_extract(m.data, '$.role') IN ('user', 'assistant')
           AND NOT ${isCompactionWhere("m")}`,
      )
      .get(partId) as ExportPartRecord | undefined) ?? null
  );
}

export function getTriggerMessageIdForChildSession(
  db: Database,
  childSessionId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT p.message_id AS message_id
       FROM part p
       WHERE json_extract(p.data, '$.type') = 'tool'
         AND json_extract(p.data, '$.state.metadata.sessionId') = ?
       ORDER BY p.time_created ASC, p.id ASC
       LIMIT 1`,
    )
    .get(childSessionId) as { message_id?: string } | undefined;
  return row?.message_id ?? null;
}
