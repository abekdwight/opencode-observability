import type { Database } from "../../lib/sqlite.js";

export interface CodexThreadRecord {
  id: string;
  title: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  model: string | null;
  model_provider: string | null;
  tokens_used: number;
  cwd: string;
  git_branch: string | null;
  first_user_message: string;
  preview: string;
  cli_version: string | null;
  agent_nickname: string | null;
  agent_role: string | null;
  thread_source: string | null;
  parent_thread_id: string | null;
}

const PARENT_THREAD_ID_EXPR = `
  CASE
    WHEN json_valid(source)
    THEN json_extract(source, '$.subagent.thread_spawn.parent_thread_id')
    ELSE NULL
  END
`;

const THREAD_COLUMNS = `
  id, title, rollout_path, created_at, updated_at, model, model_provider,
  tokens_used, cwd, git_branch, first_user_message, preview, cli_version,
  agent_nickname, agent_role, thread_source,
  ${PARENT_THREAD_ID_EXPR} AS parent_thread_id
`;

export function listCodexThreads(db: Database): CodexThreadRecord[] {
  return db
    .prepare(`
      SELECT ${THREAD_COLUMNS}
      FROM threads
      WHERE archived = 0
        AND COALESCE(thread_source, '') <> 'subagent'
        AND ${PARENT_THREAD_ID_EXPR} IS NULL
      ORDER BY updated_at DESC
      LIMIT 200
    `)
    .all() as CodexThreadRecord[];
}

export function listCodexChildThreads(
  db: Database,
  parentThreadId: string,
): CodexThreadRecord[] {
  return db
    .prepare(`
      SELECT ${THREAD_COLUMNS}
      FROM threads
      WHERE archived = 0
        AND ${PARENT_THREAD_ID_EXPR} = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(parentThreadId) as CodexThreadRecord[];
}

export function getCodexThread(
  db: Database,
  id: string,
): CodexThreadRecord | null {
  return (
    (db
      .prepare(`
        SELECT ${THREAD_COLUMNS}
        FROM threads
        WHERE id = ?
      `)
      .get(id) as CodexThreadRecord | undefined) ?? null
  );
}

export function codexThreadExists(db: Database, id: string): boolean {
  return db.prepare("SELECT 1 FROM threads WHERE id = ?").get(id) !== undefined;
}
