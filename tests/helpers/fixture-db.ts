import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const FIXTURE_DB_PATH = path.resolve(
  "tests/fixtures/opencode-telemetry.sqlite",
);
export const ROOT_SESSION_ID = "ses-root-1";
export const CHILD_SESSION_ID = "ses-child-1";
export const ALERT_SESSION_ID = "ses-root-2";

const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE project (
  id text PRIMARY KEY,
  worktree text NOT NULL,
  vcs text,
  name text,
  icon_url text,
  icon_color text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_initialized integer,
  sandboxes text NOT NULL,
  commands text
);

CREATE TABLE session (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  parent_id text,
  slug text NOT NULL,
  directory text NOT NULL,
  title text NOT NULL,
  version text NOT NULL,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  revert text,
  permission text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_compacting integer,
  time_archived integer,
  workspace_id text,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

CREATE TABLE message (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);

CREATE TABLE part (
  id text PRIMARY KEY,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL,
  FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
);

CREATE TABLE todo (
  session_id text NOT NULL,
  content text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  position integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
`;

function buildFixture() {
  const now = Date.now();
  const dayOne = now - 45 * 60_000;
  const dayTwo = now - 4 * 60_000;

  fs.mkdirSync(path.dirname(FIXTURE_DB_PATH), { recursive: true });
  fs.rmSync(FIXTURE_DB_PATH, { force: true });

  const db = new Database(FIXTURE_DB_PATH);
  db.exec(schemaSql);

  const insertProject = db.prepare(`
    INSERT INTO project (
      id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated, time_initialized, sandboxes, commands
    ) VALUES (
      @id, @worktree, @vcs, @name, @icon_url, @icon_color, @time_created, @time_updated, @time_initialized, @sandboxes, @commands
    )
  `);
  insertProject.run({
    id: "proj-alpha",
    worktree: "/workspace/repo-alpha",
    vcs: "git",
    name: "repo-alpha",
    icon_url: null,
    icon_color: "#0f766e",
    time_created: dayOne,
    time_updated: dayTwo,
    time_initialized: dayOne,
    sandboxes: "[]",
    commands: null,
  });
  insertProject.run({
    id: "proj-beta",
    worktree: "/workspace/repo-beta",
    vcs: "git",
    name: "repo-beta",
    icon_url: null,
    icon_color: "#7c3aed",
    time_created: dayOne,
    time_updated: dayTwo,
    time_initialized: dayOne,
    sandboxes: "[]",
    commands: null,
  });

  const insertSession = db.prepare(`
    INSERT INTO session (
      id, project_id, parent_id, slug, directory, title, version, share_url,
      summary_additions, summary_deletions, summary_files, summary_diffs,
      revert, permission, time_created, time_updated, time_compacting, time_archived, workspace_id
    ) VALUES (
      @id, @project_id, @parent_id, @slug, @directory, @title, @version, NULL,
      @summary_additions, @summary_deletions, @summary_files, @summary_diffs,
      NULL, NULL, @time_created, @time_updated, @time_compacting, NULL, NULL
    )
  `);
  insertSession.run({
    id: ROOT_SESSION_ID,
    project_id: "proj-alpha",
    parent_id: null,
    slug: "root-one",
    directory: "/workspace/repo-alpha",
    title: "Root monitor session",
    version: "1",
    summary_additions: 10,
    summary_deletions: 4,
    summary_files: 2,
    summary_diffs: "diff --git a/src/index.ts b/src/index.ts",
    time_created: dayOne,
    time_updated: dayOne + 60_000,
    time_compacting: null,
  });
  insertSession.run({
    id: CHILD_SESSION_ID,
    project_id: "proj-alpha",
    parent_id: ROOT_SESSION_ID,
    slug: "child-one",
    directory: "/workspace/repo-alpha/subagent",
    title: "Subagent follow-up",
    version: "1",
    summary_additions: 0,
    summary_deletions: 0,
    summary_files: 0,
    summary_diffs: null,
    time_created: dayOne + 90_000,
    time_updated: dayOne + 110_000,
    time_compacting: dayOne + 105_000,
  });
  insertSession.run({
    id: ALERT_SESSION_ID,
    project_id: "proj-beta",
    parent_id: null,
    slug: "root-two",
    directory: "/workspace/repo-beta/packages/api",
    title: "Alerting root session",
    version: "1",
    summary_additions: 3,
    summary_deletions: 1,
    summary_files: 1,
    summary_diffs: "diff --git a/src/api.ts b/src/api.ts",
    time_created: dayTwo,
    time_updated: dayTwo + 70_000,
    time_compacting: dayTwo + 30_000,
  });

  const insertMessage = db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (@id, @session_id, @time_created, @time_created, @data)
  `);
  const insertMessageJson = (
    id: string,
    sessionId: string,
    timeCreated: number,
    data: Record<string, unknown>,
  ) =>
    insertMessage.run({
      id,
      session_id: sessionId,
      time_created: timeCreated,
      data: JSON.stringify(data),
    });

  insertMessageJson("msg-root-1-user", ROOT_SESSION_ID, dayOne, {
    role: "user",
    time: { created: dayOne },
  });
  insertMessageJson(
    "msg-root-1-assistant-1",
    ROOT_SESSION_ID,
    dayOne + 10_000,
    {
      role: "assistant",
      time: { created: dayOne + 10_000, completed: dayOne + 13_000 },
      modelID: "gpt-4.1",
      providerID: "openai",
      agent: "planner",
      cost: 0.12,
      tokens: {
        total: 120,
        input: 80,
        output: 40,
        reasoning: 15,
        cache: { read: 30, write: 5 },
      },
    },
  );
  insertMessageJson(
    "msg-root-1-assistant-2",
    ROOT_SESSION_ID,
    dayOne + 20_000,
    {
      role: "assistant",
      time: { created: dayOne + 20_000, completed: dayOne + 22_000 },
      modelID: "gpt-4.1",
      providerID: "openai",
      agent: "planner",
      cost: 0.05,
      tokens: {
        total: 60,
        input: 20,
        output: 40,
        reasoning: 5,
        cache: { read: 10, write: 0 },
      },
    },
  );
  insertMessageJson("msg-child-1-user", CHILD_SESSION_ID, dayOne + 90_000, {
    role: "user",
    time: { created: dayOne + 90_000 },
  });
  insertMessageJson(
    "msg-child-1-assistant",
    CHILD_SESSION_ID,
    dayOne + 98_000,
    {
      role: "assistant",
      time: { created: dayOne + 98_000, completed: dayOne + 100_500 },
      modelID: "gpt-4.1-mini",
      providerID: "openai",
      agent: "subagent-code",
      cost: 0.03,
      tokens: { total: 30, input: 10, output: 20 },
    },
  );
  insertMessageJson(
    "msg-child-1-compaction",
    CHILD_SESSION_ID,
    dayOne + 105_000,
    {
      role: "assistant",
      time: { created: dayOne + 105_000, completed: dayOne + 107_000 },
      modelID: "gpt-5.3-codex-spark",
      providerID: "openai",
      agent: "compaction",
      mode: "compaction",
      summary: true,
      cost: 0.01,
      tokens: { total: 12, input: 4, output: 8 },
    },
  );
  insertMessageJson("msg-root-2-user", ALERT_SESSION_ID, dayTwo, {
    role: "user",
    time: { created: dayTwo },
  });
  insertMessageJson("msg-root-2-assistant", ALERT_SESSION_ID, dayTwo + 15_000, {
    role: "assistant",
    time: { created: dayTwo + 15_000, completed: dayTwo + 18_000 },
    modelID: "claude-3.5-sonnet",
    providerID: "anthropic",
    agent: "reviewer",
    cost: 0.09,
    tokens: { total: 90, input: 50, output: 40 },
  });
  insertMessageJson(
    "msg-root-2-compaction",
    ALERT_SESSION_ID,
    dayTwo + 30_000,
    {
      role: "assistant",
      time: { created: dayTwo + 30_000, completed: dayTwo + 33_000 },
      modelID: "gpt-5.3-codex-spark",
      providerID: "openai",
      agent: "compaction",
      mode: "compaction",
      summary: true,
      cost: 0.01,
      tokens: { total: 15, input: 5, output: 10 },
    },
  );

  const insertPart = db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (@id, @message_id, @session_id, @time_created, @time_created, @data)
  `);
  const insertPartJson = (
    id: string,
    messageId: string,
    sessionId: string,
    timeCreated: number,
    data: Record<string, unknown>,
  ) =>
    insertPart.run({
      id,
      message_id: messageId,
      session_id: sessionId,
      time_created: timeCreated,
      data: JSON.stringify(data),
    });

  insertPartJson(
    "part-root-1-user-text",
    "msg-root-1-user",
    ROOT_SESSION_ID,
    dayOne,
    {
      type: "text",
      text: "Investigate the failing monitor sessions.",
    },
  );
  insertPartJson(
    "part-root-1-assistant-1-text",
    "msg-root-1-assistant-1",
    ROOT_SESSION_ID,
    dayOne + 10_100,
    {
      type: "text",
      text: "Planning the first response with tool usage.",
    },
  );
  insertPartJson(
    "part-root-1-tool-read",
    "msg-root-1-assistant-1",
    ROOT_SESSION_ID,
    dayOne + 10_200,
    {
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/workspace/repo-alpha/src/index.ts" },
        output: { bytes: 128 },
        time: { start: dayOne + 10_200, end: dayOne + 10_600 },
      },
    },
  );
  insertPartJson(
    "part-root-1-tool-subagent",
    "msg-root-1-assistant-1",
    ROOT_SESSION_ID,
    dayOne + 10_700,
    {
      type: "tool",
      tool: "github_search",
      state: {
        status: "error",
        error: "HTTP 500 upstream",
        input: { query: "open issue" },
        metadata: { sessionId: CHILD_SESSION_ID },
        time: { start: dayOne + 10_700, end: dayOne + 10_900 },
      },
    },
  );
  insertPartJson(
    "part-root-1-assistant-2-text",
    "msg-root-1-assistant-2",
    ROOT_SESSION_ID,
    dayOne + 20_100,
    {
      type: "text",
      text: "Execution update with follow-up command output.",
    },
  );
  insertPartJson(
    "part-root-1-tool-bash",
    "msg-root-1-assistant-2",
    ROOT_SESSION_ID,
    dayOne + 20_200,
    {
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "npm test" },
        output: "ok",
        time: { start: dayOne + 20_200, end: dayOne + 21_300 },
      },
    },
  );
  insertPartJson(
    "part-child-1-user-text",
    "msg-child-1-user",
    CHILD_SESSION_ID,
    dayOne + 90_000,
    {
      type: "text",
      text: "Investigate the subagent failure.",
    },
  );
  insertPartJson(
    "part-child-1-assistant-text",
    "msg-child-1-assistant",
    CHILD_SESSION_ID,
    dayOne + 98_100,
    {
      type: "text",
      text: "Subagent finished the focused review.",
    },
  );
  insertPartJson(
    "part-child-1-compaction-text",
    "msg-child-1-compaction",
    CHILD_SESSION_ID,
    dayOne + 105_100,
    {
      type: "text",
      text: "Compaction summary for the subagent context.",
    },
  );
  insertPartJson(
    "part-root-2-user-text",
    "msg-root-2-user",
    ALERT_SESSION_ID,
    dayTwo,
    {
      type: "text",
      text: "Investigate the alerting regression.",
    },
  );
  insertPartJson(
    "part-root-2-assistant-text",
    "msg-root-2-assistant",
    ALERT_SESSION_ID,
    dayTwo + 15_100,
    {
      type: "text",
      text: "Alert review captured the key failure mode.",
    },
  );
  insertPartJson(
    "part-root-2-tool-webfetch",
    "msg-root-2-assistant",
    ALERT_SESSION_ID,
    dayTwo + 15_200,
    {
      type: "tool",
      tool: "webfetch",
      state: {
        status: "error",
        error: "patch conflict while applying diff",
        input: { url: "https://example.com/patch" },
        output: { ok: false },
        time: { start: dayTwo + 15_200, end: dayTwo + 15_700 },
      },
    },
  );
  insertPartJson(
    "part-root-2-compaction-text",
    "msg-root-2-compaction",
    ALERT_SESSION_ID,
    dayTwo + 30_100,
    {
      type: "text",
      text: "Compaction summary for the root monitor session.",
    },
  );

  const insertTodo = db.prepare(`
    INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
    VALUES (@session_id, @content, @status, @priority, @position, @time_created, @time_updated)
  `);
  insertTodo.run({
    session_id: ROOT_SESSION_ID,
    content: "Collect failing commands",
    status: "completed",
    priority: "high",
    position: 1,
    time_created: dayOne + 1_000,
    time_updated: dayOne + 30_000,
  });
  insertTodo.run({
    session_id: ROOT_SESSION_ID,
    content: "Summarize the root cause",
    status: "in_progress",
    priority: "medium",
    position: 2,
    time_created: dayOne + 2_000,
    time_updated: dayOne + 31_000,
  });

  db.close();
  return FIXTURE_DB_PATH;
}

const previousDbPath = process.env.OPENCODE_DB_PATH;

export function useFixtureDb() {
  process.env.OPENCODE_DB_PATH = buildFixture();
}

export function restoreDbPath() {
  if (previousDbPath) {
    process.env.OPENCODE_DB_PATH = previousDbPath;
  } else {
    delete process.env.OPENCODE_DB_PATH;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(buildFixture());
}
