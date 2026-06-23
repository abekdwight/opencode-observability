import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Database } from "../../src/lib/sqlite.js";
import {
  listCodexChildThreads,
  listCodexThreads,
} from "../../src/repositories/codex-sessions/codex-sessions.repository.js";

const tempDirs: string[] = [];

function makeDb(): Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-threads-"));
  tempDirs.push(dir);
  const db = new Database(path.join(dir, "state.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL DEFAULT '',
      approval_mode TEXT NOT NULL DEFAULT '',
      tokens_used INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      git_branch TEXT,
      cli_version TEXT,
      first_user_message TEXT NOT NULL DEFAULT '',
      agent_nickname TEXT,
      agent_role TEXT,
      thread_source TEXT,
      model TEXT,
      preview TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

function insertThread(
  db: Database,
  row: {
    id: string;
    title: string;
    source: string;
    threadSource?: string | null;
    agentNickname?: string | null;
    createdAt?: number;
    updatedAt?: number;
  },
): void {
  db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, cwd, title,
      tokens_used, archived, git_branch, cli_version, first_user_message,
      agent_nickname, agent_role, thread_source, model, preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'main', 'test', '', ?, NULL, ?, 'gpt-test', 'preview')
  `).run(
    row.id,
    `/tmp/${row.id}.jsonl`,
    row.createdAt ?? 1,
    row.updatedAt ?? 1,
    row.source,
    "/repo",
    row.title,
    row.agentNickname ?? null,
    row.threadSource ?? null,
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("codex sessions repository", () => {
  test("lists only root threads and resolves children by parent thread id", () => {
    const db = makeDb();
    try {
      insertThread(db, {
        id: "root-1",
        title: "Root",
        source: "vscode",
        threadSource: "user",
        updatedAt: 10,
      });
      insertThread(db, {
        id: "child-1",
        title: "Child",
        source: JSON.stringify({
          subagent: {
            thread_spawn: { parent_thread_id: "root-1" },
          },
        }),
        threadSource: "subagent",
        agentNickname: "Explorer",
        createdAt: 11,
        updatedAt: 12,
      });

      expect(listCodexThreads(db).map((thread) => thread.id)).toEqual([
        "root-1",
      ]);
      expect(listCodexChildThreads(db, "root-1")).toMatchObject([
        {
          id: "child-1",
          parent_thread_id: "root-1",
          thread_source: "subagent",
          agent_nickname: "Explorer",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
