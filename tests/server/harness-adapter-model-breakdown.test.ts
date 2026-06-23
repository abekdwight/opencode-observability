import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Database } from "../../src/lib/sqlite.js";
import { claudeAdapter } from "../../src/services/harness/claude/adapter.js";
import { codexAdapter } from "../../src/services/harness/codex/adapter.js";

const tempDirs: string[] = [];
const originalCodexStateDbPath = process.env.CODEX_STATE_DB_PATH;
const originalClaudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR;

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function jsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

function codexRollout(options: {
  threadId: string;
  parentThreadId?: string;
  model: string;
  input: number;
  output: number;
  reasoning: number;
  cachedInput: number;
  total: number;
}): string {
  return jsonl([
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: options.threadId,
        cwd: "/repo",
        parent_thread_id: options.parentThreadId,
      },
    },
    {
      timestamp: "2026-01-01T00:00:01.000Z",
      type: "turn_context",
      payload: { model: options.model },
    },
    {
      timestamp: "2026-01-01T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
      },
    },
    {
      timestamp: "2026-01-01T00:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: options.input,
            cached_input_tokens: options.cachedInput,
            output_tokens: options.output,
            reasoning_output_tokens: options.reasoning,
            total_tokens: options.total,
          },
          last_token_usage: {
            input_tokens: options.input,
            cached_input_tokens: options.cachedInput,
            output_tokens: options.output,
            reasoning_output_tokens: options.reasoning,
            total_tokens: options.total,
          },
        },
      },
    },
  ]);
}

function makeCodexStateDb(dbPath: string, rolloutDir: string): void {
  const db = new Database(dbPath);
  try {
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

    const rootPath = path.join(rolloutDir, "root.jsonl");
    const childPath = path.join(rolloutDir, "child.jsonl");
    fs.writeFileSync(
      rootPath,
      codexRollout({
        threadId: "codex-root",
        model: "gpt-5.5",
        input: 10,
        output: 5,
        reasoning: 2,
        cachedInput: 3,
        total: 15,
      }),
    );
    fs.writeFileSync(
      childPath,
      codexRollout({
        threadId: "codex-child",
        parentThreadId: "codex-root",
        model: "gpt-5.4-mini",
        input: 7,
        output: 4,
        reasoning: 1,
        cachedInput: 2,
        total: 11,
      }),
    );

    const insert = db.prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd,
        title, tokens_used, archived, git_branch, cli_version,
        first_user_message, agent_nickname, agent_role, thread_source, model,
        preview
      ) VALUES (?, ?, ?, ?, ?, 'openai', '/repo', ?, ?, 0, 'main', 'test', '', ?, ?, ?, ?, '')
    `);
    insert.run(
      "codex-root",
      rootPath,
      1,
      3,
      "vscode",
      "Root",
      15,
      null,
      null,
      "user",
      "gpt-5.5",
    );
    insert.run(
      "codex-child",
      childPath,
      2,
      4,
      JSON.stringify({
        subagent: {
          thread_spawn: { parent_thread_id: "codex-root" },
        },
      }),
      "Child",
      11,
      "Explorer",
      "explorer",
      "subagent",
      "gpt-5.4-mini",
    );
  } finally {
    db.close();
  }
}

function claudeTranscript(options: {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): string {
  return jsonl([
    {
      type: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/repo",
      gitBranch: "main",
      message: {
        role: "user",
        content: [{ type: "text", text: "依頼" }],
      },
    },
    {
      type: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        id: `msg-${options.model}`,
        model: options.model,
        role: "assistant",
        usage: {
          input_tokens: options.input,
          output_tokens: options.output,
          cache_read_input_tokens: options.cacheRead,
          cache_creation_input_tokens: options.cacheWrite,
        },
        content: [{ type: "text", text: "完了" }],
      },
    },
    { type: "ai-title", aiTitle: "Claude root" },
  ]);
}

afterEach(() => {
  if (originalCodexStateDbPath === undefined) {
    delete process.env.CODEX_STATE_DB_PATH;
  } else {
    process.env.CODEX_STATE_DB_PATH = originalCodexStateDbPath;
  }
  if (originalClaudeProjectsDir === undefined) {
    delete process.env.CLAUDE_PROJECTS_DIR;
  } else {
    process.env.CLAUDE_PROJECTS_DIR = originalClaudeProjectsDir;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("harness adapter model breakdown", () => {
  test("codex detail includes child thread token usage as subagent rows", () => {
    const dir = makeTempDir("codex-adapter-");
    const dbPath = path.join(dir, "state.sqlite");
    process.env.CODEX_STATE_DB_PATH = dbPath;
    makeCodexStateDb(dbPath, dir);

    const detail = codexAdapter.getSessionDetail("codex-root");

    expect(detail?.tokens).toMatchObject({
      total: 26,
      input: 17,
      output: 9,
      reasoning: 3,
      cacheRead: 5,
    });
    expect(detail?.models).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
    expect(detail?.modelBreakdown).toEqual([
      expect.objectContaining({
        scope: "main",
        agent: "main",
        providerId: "openai",
        modelId: "gpt-5.5",
        totalTokens: 15,
      }),
      expect.objectContaining({
        scope: "subagent",
        agent: "Explorer",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        totalTokens: 11,
      }),
    ]);
  });

  test("claude detail includes nested subagent transcript token usage", () => {
    const projectsDir = makeTempDir("claude-adapter-");
    process.env.CLAUDE_PROJECTS_DIR = projectsDir;
    const projectDir = path.join(projectsDir, "project-a");
    const subagentsDir = path.join(projectDir, "claude-root", "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });

    fs.writeFileSync(
      path.join(projectDir, "claude-root.jsonl"),
      claudeTranscript({
        model: "claude-fable-5",
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheWrite: 3,
      }),
    );
    fs.writeFileSync(
      path.join(subagentsDir, "claude-child.jsonl"),
      claudeTranscript({
        model: "claude-haiku",
        input: 7,
        output: 4,
        cacheRead: 1,
        cacheWrite: 0,
      }),
    );
    fs.writeFileSync(
      path.join(subagentsDir, "claude-child.meta.json"),
      JSON.stringify({ agentType: "Explore", toolUseId: "tool-agent" }),
    );

    const detail = claudeAdapter.getSessionDetail("claude-root");

    expect(detail?.tokens).toMatchObject({
      total: 32,
      input: 17,
      output: 9,
      cacheRead: 3,
      cacheWrite: 3,
    });
    expect(detail?.models).toEqual(["claude-fable-5", "claude-haiku"]);
    expect(detail?.modelBreakdown).toEqual([
      expect.objectContaining({
        scope: "main",
        agent: "main",
        providerId: "anthropic",
        modelId: "claude-fable-5",
        totalTokens: 20,
      }),
      expect.objectContaining({
        scope: "subagent",
        agent: "Explore",
        providerId: "anthropic",
        modelId: "claude-haiku",
        totalTokens: 12,
      }),
    ]);
  });
});
