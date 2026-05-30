import type { Database } from "better-sqlite3";

export interface CodexThreadRecord {
  id: string;
  title: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  model: string | null;
  tokens_used: number;
  cwd: string;
  first_user_message: string;
  preview: string;
  cli_version: string | null;
  agent_nickname: string | null;
  agent_role: string | null;
}

const THREAD_COLUMNS = `
  id, title, rollout_path, created_at, updated_at, model, tokens_used, cwd,
  first_user_message, preview, cli_version, agent_nickname, agent_role
`;

export function listCodexThreads(db: Database): CodexThreadRecord[] {
  return db
    .prepare(`
      SELECT ${THREAD_COLUMNS}
      FROM threads
      ORDER BY updated_at DESC
      LIMIT 200
    `)
    .all() as CodexThreadRecord[];
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
