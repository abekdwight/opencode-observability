import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Database } from "../../src/lib/sqlite.js";

const FIXTURE_DIR = path.resolve("tests/fixtures");
export const FIXTURE_DB_PATH = path.join(
  FIXTURE_DIR,
  "opencode-observability.sqlite",
);

type SessionSeed = {
  id: string;
  projectId: string;
  parentId: string | null;
  directory: string;
  title: string;
  timeCreated: number;
  timeUpdated: number;
  summaryAdditions?: number;
  summaryDeletions?: number;
  summaryFiles?: number;
};

type MessageSeed = {
  id: string;
  sessionId: string;
  timeCreated: number;
  role: "user" | "assistant";
  agent?: string | null;
  modelID?: string;
  providerID?: string;
  cost?: number;
  tokens?: {
    total: number;
    input: number;
    output: number;
    reasoning?: number;
    cache?: { read: number; write: number };
  };
  time?: {
    created?: number;
    completed?: number;
    compacted?: number;
  };
};

type PartSeed = {
  id: string;
  messageId: string;
  sessionId: string;
  timeCreated: number;
  data: Record<string, unknown>;
};

function createSchema(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT,
      vcs TEXT,
      name TEXT,
      icon_url TEXT,
      icon_color TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_initialized INTEGER,
      sandboxes TEXT,
      commands TEXT
    );

    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      slug TEXT,
      directory TEXT,
      title TEXT,
      version TEXT,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_compacting INTEGER,
      time_archived INTEGER,
      workspace_id TEXT
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );

    CREATE TABLE todo (
      session_id TEXT,
      content TEXT,
      status TEXT,
      priority TEXT,
      position INTEGER,
      time_created INTEGER,
      time_updated INTEGER
    );
  `);
}

function insertProjects(db: Database): void {
  const stmt = db.prepare(`
    INSERT INTO project (
      id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated,
      time_initialized, sandboxes, commands
    ) VALUES (
      @id, @worktree, 'git', @name, NULL, @iconColor, @time, @time, @time, '[]', '[]'
    )
  `);

  stmt.run({
    id: "proj_alpha",
    worktree: "/repo/alpha",
    name: "Alpha",
    iconColor: "#2563eb",
    time: 1_710_000_000_000,
  });
  stmt.run({
    id: "proj_beta",
    worktree: "/repo/beta",
    name: "Beta",
    iconColor: "#16a34a",
    time: 1_710_000_000_000,
  });
}

function insertSessions(db: Database, sessions: SessionSeed[]): void {
  const stmt = db.prepare(`
    INSERT INTO session (
      id, project_id, parent_id, slug, directory, title, version, share_url,
      summary_additions, summary_deletions, summary_files, summary_diffs, revert,
      permission, time_created, time_updated, time_compacting, time_archived, workspace_id
    ) VALUES (
      @id, @projectId, @parentId, @slug, @directory, @title, '1.2.27', NULL,
      @summaryAdditions, @summaryDeletions, @summaryFiles, NULL, NULL, NULL,
      @timeCreated, @timeUpdated, NULL, NULL, NULL
    )
  `);

  for (const session of sessions) {
    stmt.run({
      ...session,
      slug: session.id.replace(/^ses_/, ""),
      summaryAdditions: session.summaryAdditions ?? 0,
      summaryDeletions: session.summaryDeletions ?? 0,
      summaryFiles: session.summaryFiles ?? 0,
    });
  }
}

function insertMessages(db: Database, messages: MessageSeed[]): void {
  const stmt = db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (@id, @sessionId, @timeCreated, @timeCreated, @data)
  `);

  for (const message of messages) {
    stmt.run({
      id: message.id,
      sessionId: message.sessionId,
      timeCreated: message.timeCreated,
      data: JSON.stringify({
        role: message.role,
        agent: message.agent ?? null,
        modelID: message.modelID,
        providerID: message.providerID,
        cost: message.cost,
        tokens: message.tokens,
        time: message.time,
      }),
    });
  }
}

function insertParts(db: Database, parts: PartSeed[]): void {
  const stmt = db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (@id, @messageId, @sessionId, @timeCreated, @timeCreated, @data)
  `);

  for (const part of parts) {
    stmt.run({
      id: part.id,
      messageId: part.messageId,
      sessionId: part.sessionId,
      timeCreated: part.timeCreated,
      data: JSON.stringify(part.data),
    });
  }
}

function insertTodos(db: Database): void {
  const stmt = db.prepare(`
    INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    "ses_root_active",
    "Investigate compaction spike for the main session",
    "completed",
    "high",
    0,
    1_710_000_150_000,
    1_710_000_150_000,
  );
}

export function buildFixtureDatabase(
  outputPath: string = FIXTURE_DB_PATH,
): string {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  rmSync(outputPath, { force: true });

  const db = new Database(outputPath);
  createSchema(db);
  insertProjects(db);

  const sessions: SessionSeed[] = [
    {
      id: "ses_root_active",
      projectId: "proj_alpha",
      parentId: null,
      directory: "/repo/alpha",
      title: "Active root session",
      timeCreated: 1_710_000_000_000,
      timeUpdated: 1_710_000_180_000,
      summaryAdditions: 12,
      summaryDeletions: 3,
      summaryFiles: 2,
    },
    {
      id: "ses_child_code",
      projectId: "proj_alpha",
      parentId: "ses_root_active",
      directory: "/repo/alpha",
      title: "Child code helper",
      timeCreated: 1_710_000_030_000,
      timeUpdated: 1_710_000_095_000,
    },
    {
      id: "ses_child_docs",
      projectId: "proj_alpha",
      parentId: "ses_root_active",
      directory: "/repo/alpha",
      title: "Child docs helper",
      timeCreated: 1_710_000_040_000,
      timeUpdated: 1_710_000_125_000,
    },
    {
      id: "ses_root_quiet",
      projectId: "proj_beta",
      parentId: null,
      directory: "/repo/beta",
      title: "Quiet root session",
      timeCreated: 1_710_000_060_000,
      timeUpdated: 1_710_000_090_000,
      summaryAdditions: 1,
      summaryDeletions: 0,
      summaryFiles: 1,
    },
  ];
  insertSessions(db, sessions);

  const messages: MessageSeed[] = [
    {
      id: "msg_root_user_1",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_000_000,
      role: "user",
      agent: "Main Operator",
    },
    {
      id: "msg_root_assistant_1",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_060_000,
      role: "assistant",
      agent: null,
      modelID: "gpt-5.4",
      providerID: "openai",
      cost: 0.2,
      tokens: {
        total: 1_200,
        input: 800,
        output: 400,
        reasoning: 140,
        cache: { read: 200, write: 0 },
      },
      time: {
        created: 1_710_000_000_000,
        completed: 1_710_000_060_000,
        compacted: 1_710_000_059_000,
      },
    },
    {
      id: "msg_root_user_2",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_120_000,
      role: "user",
      agent: "Main Operator",
    },
    {
      id: "msg_root_assistant_2",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_180_000,
      role: "assistant",
      agent: null,
      modelID: "gpt-5.4",
      providerID: "openai",
      cost: 0.1067,
      tokens: {
        total: 600,
        input: 300,
        output: 300,
        reasoning: 60,
        cache: { read: 100, write: 0 },
      },
      time: {
        created: 1_710_000_120_000,
        completed: 1_710_000_180_000,
      },
    },
    {
      id: "msg_child_code_user",
      sessionId: "ses_child_code",
      timeCreated: 1_710_000_030_000,
      role: "user",
      agent: "Explorer",
    },
    {
      id: "msg_child_code_assistant",
      sessionId: "ses_child_code",
      timeCreated: 1_710_000_095_000,
      role: "assistant",
      agent: "explore",
      modelID: "gpt-5.4-mini",
      providerID: "openai",
      cost: 0.03,
      tokens: {
        total: 250,
        input: 150,
        output: 100,
        reasoning: 20,
        cache: { read: 50, write: 0 },
      },
      time: {
        created: 1_710_000_030_000,
        completed: 1_710_000_095_000,
        compacted: 1_710_000_094_000,
      },
    },
    {
      id: "msg_child_docs_user",
      sessionId: "ses_child_docs",
      timeCreated: 1_710_000_040_000,
      role: "user",
      agent: "Docs Agent",
    },
    {
      id: "msg_child_docs_assistant",
      sessionId: "ses_child_docs",
      timeCreated: 1_710_000_125_000,
      role: "assistant",
      agent: "docs",
      modelID: "gpt-5.4-mini",
      providerID: "openai",
      cost: 0.02,
      tokens: {
        total: 100,
        input: 60,
        output: 40,
        reasoning: 5,
        cache: { read: 0, write: 0 },
      },
      time: {
        created: 1_710_000_040_000,
        completed: 1_710_000_125_000,
      },
    },
    {
      id: "msg_quiet_user",
      sessionId: "ses_root_quiet",
      timeCreated: 1_710_000_060_000,
      role: "user",
      agent: "Quiet Operator",
    },
    {
      id: "msg_quiet_assistant",
      sessionId: "ses_root_quiet",
      timeCreated: 1_710_000_090_000,
      role: "assistant",
      agent: null,
      modelID: "gpt-5.4-mini",
      providerID: "openai",
      cost: 0.01,
      tokens: {
        total: 90,
        input: 50,
        output: 40,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: {
        created: 1_710_000_060_000,
        completed: 1_710_000_090_000,
      },
    },
  ];
  insertMessages(db, messages);

  const parts: PartSeed[] = [
    {
      id: "prt_root_user_1_text",
      messageId: "msg_root_user_1",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_000_001,
      data: { type: "text", text: "Need a monitor-first telemetry plan." },
    },
    {
      id: "prt_root_assistant_1_text",
      messageId: "msg_root_assistant_1",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_060_001,
      data: { type: "text", text: "Created the first triage summary." },
    },
    {
      id: "prt_root_assistant_1_reasoning",
      messageId: "msg_root_assistant_1",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_060_002,
      data: {
        type: "reasoning",
        text: "Compaction marker for the main session.",
        time: { compacted: 1_710_000_059_000 },
      },
    },
    {
      id: "prt_root_assistant_1_tool_read",
      messageId: "msg_root_assistant_1",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_060_003,
      data: {
        type: "tool",
        tool: "read",
        callID: "call_read_root",
        state: {
          status: "completed",
          input: { filePath: "src/routes/dashboard.ts" },
          output: "dashboard contents",
        },
      },
    },
    {
      id: "prt_root_user_2_text",
      messageId: "msg_root_user_2",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_120_001,
      data: {
        type: "text",
        text: "Investigate child agent results and tool failures.",
      },
    },
    {
      id: "prt_root_assistant_2_text",
      messageId: "msg_root_assistant_2",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_180_001,
      data: {
        type: "text",
        text: "Attached child session outputs and an error summary.",
      },
    },
    {
      id: "prt_root_assistant_2_tool_grep_error",
      messageId: "msg_root_assistant_2",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_180_002,
      data: {
        type: "tool",
        tool: "grep",
        callID: "call_grep_root",
        state: {
          status: "error",
          input: { pattern: "compacted", path: "src" },
          error: "Pattern not found",
          metadata: { sessionId: "ses_child_code" },
        },
      },
    },
    {
      id: "prt_root_assistant_2_tool_task",
      messageId: "msg_root_assistant_2",
      sessionId: "ses_root_active",
      timeCreated: 1_710_000_180_003,
      data: {
        type: "tool",
        tool: "task",
        callID: "call_task_root",
        state: {
          status: "completed",
          input: { prompt: "Summarize docs work" },
          output: "Child docs helper completed",
          metadata: { sessionId: "ses_child_docs" },
        },
      },
    },
    {
      id: "prt_child_code_user_text",
      messageId: "msg_child_code_user",
      sessionId: "ses_child_code",
      timeCreated: 1_710_000_030_001,
      data: {
        type: "text",
        text: "Inspect code paths for dashboard and session routes.",
      },
    },
    {
      id: "prt_child_code_assistant_text",
      messageId: "msg_child_code_assistant",
      sessionId: "ses_child_code",
      timeCreated: 1_710_000_095_001,
      data: {
        type: "text",
        text: "Found chart generation and session drill-down metrics.",
      },
    },
    {
      id: "prt_child_code_assistant_reasoning",
      messageId: "msg_child_code_assistant",
      sessionId: "ses_child_code",
      timeCreated: 1_710_000_095_002,
      data: {
        type: "reasoning",
        text: "Compaction marker for the child session.",
        time: { compacted: 1_710_000_094_000 },
      },
    },
    {
      id: "prt_child_code_assistant_tool_github",
      messageId: "msg_child_code_assistant",
      sessionId: "ses_child_code",
      timeCreated: 1_710_000_095_003,
      data: {
        type: "tool",
        tool: "github_search",
        callID: "call_github_child",
        state: {
          status: "completed",
          input: { query: "monitor shell" },
          output: "search results",
        },
      },
    },
    {
      id: "prt_child_docs_user_text",
      messageId: "msg_child_docs_user",
      sessionId: "ses_child_docs",
      timeCreated: 1_710_000_040_001,
      data: { type: "text", text: "Check contributor docs coverage." },
    },
    {
      id: "prt_child_docs_assistant_text",
      messageId: "msg_child_docs_assistant",
      sessionId: "ses_child_docs",
      timeCreated: 1_710_000_125_001,
      data: {
        type: "text",
        text: "README and CONTRIBUTING updates are needed.",
      },
    },
    {
      id: "prt_quiet_user_text",
      messageId: "msg_quiet_user",
      sessionId: "ses_root_quiet",
      timeCreated: 1_710_000_060_101,
      data: { type: "text", text: "Small follow-up question." },
    },
    {
      id: "prt_quiet_assistant_text",
      messageId: "msg_quiet_assistant",
      sessionId: "ses_root_quiet",
      timeCreated: 1_710_000_090_101,
      data: { type: "text", text: "Quiet session response." },
    },
  ];
  insertParts(db, parts);
  insertTodos(db);

  db.close();
  return outputPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = buildFixtureDatabase();
  console.log(outputPath);
}
