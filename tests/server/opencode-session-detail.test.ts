import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Database } from "../../src/lib/sqlite.js";
import { countSessionToolErrors } from "../../src/repositories/session/session.repository.js";
import { buildSessionRouteView } from "../../src/services/session/session-detail.service.js";

// buildSessionRouteView reads the opencode `part` table and turns each
// `type:"tool"` row into a tool call. These tests seed an in-memory DB with
// question parts (and a normal tool part) and assert the structured `question`
// payload, matching the raw shape opencode writes for the `question` tool.

const SCHEMA_SQL = `
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
  path text,
  agent text,
  model text,
  cost real DEFAULT 0,
  tokens_input integer DEFAULT 0,
  tokens_output integer DEFAULT 0,
  tokens_reasoning integer DEFAULT 0,
  tokens_cache_read integer DEFAULT 0,
  tokens_cache_write integer DEFAULT 0,
  metadata text
);

CREATE INDEX session_parent_id_idx ON session(parent_id);

CREATE TABLE message (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);

CREATE TABLE part (
  id text PRIMARY KEY,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);

CREATE INDEX message_session_id_time_created_id_idx
  ON message(session_id, time_created, id);
CREATE INDEX part_session_id_idx ON part(session_id);
CREATE INDEX part_message_id_id_idx ON part(message_id, id);

CREATE TABLE todo (
  session_id text NOT NULL,
  content text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  position integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  PRIMARY KEY (session_id, position)
);
`;

const SESSION_ID = "ses-q-1";
const ASSISTANT_MESSAGE_ID = "msg-q-assistant";
const BASE = 1_700_000_000_000;

function seed(db: Database): void {
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT INTO project (id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated, time_initialized, sandboxes, commands)
     VALUES (@id, @worktree, NULL, @name, NULL, NULL, @t, @t, @t, '[]', NULL)`,
  ).run({
    id: "proj-q",
    worktree: "/workspace/repo",
    name: "repo",
    t: BASE,
  });
  db.prepare(
    `INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, share_url,
       summary_additions, summary_deletions, summary_files, summary_diffs, revert, permission,
       time_created, time_updated, time_compacting, time_archived, workspace_id, path, agent, model, cost,
       tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, metadata)
     VALUES (@id, @project_id, NULL, @slug, @directory, @title, '1', NULL,
       0, 0, 0, NULL, NULL, NULL,
       @t, @t, NULL, NULL, NULL, @directory, NULL, NULL, 0,
       0, 0, 0, 0, 0, NULL)`,
  ).run({
    id: SESSION_ID,
    project_id: "proj-q",
    slug: "question-session",
    directory: "/workspace/repo",
    title: "Question session",
    t: BASE,
  });

  const insertMessage = db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (@id, @session_id, @t, @t, @data)`,
  );
  insertMessage.run({
    id: "msg-q-user",
    session_id: SESSION_ID,
    t: BASE,
    data: JSON.stringify({ role: "user", time: { created: BASE } }),
  });
  insertMessage.run({
    id: ASSISTANT_MESSAGE_ID,
    session_id: SESSION_ID,
    t: BASE + 1_000,
    data: JSON.stringify({
      role: "assistant",
      time: { created: BASE + 1_000, completed: BASE + 2_000 },
      modelID: "gpt-4.1",
      providerID: "openai",
      agent: "planner",
      tokens: { total: 0, input: 0, output: 0 },
    }),
  });

  const insertPart = db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (@id, @message_id, @session_id, @t, @t, @data)`,
  );
  const insertPartJson = (
    id: string,
    timeCreated: number,
    data: Record<string, unknown>,
  ): void => {
    insertPart.run({
      id,
      message_id: ASSISTANT_MESSAGE_ID,
      session_id: SESSION_ID,
      t: timeCreated,
      data: JSON.stringify(data),
    });
  };

  // A normal tool call: question must be null.
  insertPartJson("part-read", BASE + 1_100, {
    type: "tool",
    tool: "read",
    state: {
      status: "completed",
      input: { filePath: "/workspace/repo/src/index.ts" },
      output: { bytes: 10 },
      time: { start: BASE + 1_100, end: BASE + 1_200 },
    },
  });

  // An answered question: answers[i] maps positionally to questions[i]. The
  // second question is multi-select; the third carries a free-text answer that
  // does not match any option.
  insertPartJson("part-question-answered", BASE + 1_300, {
    type: "tool",
    tool: "question",
    state: {
      status: "completed",
      input: {
        questions: [
          {
            header: "方針",
            question: "どの方針にしますか？",
            options: [
              { label: "速度優先", description: "速い" },
              { label: "安全優先", description: "堅実" },
            ],
          },
          {
            header: "対象",
            question: "対象を選んでください",
            multiple: true,
            options: [
              { label: "API", description: "" },
              { label: "UI", description: "" },
            ],
          },
          {
            header: "備考",
            question: "補足はありますか？",
            options: [{ label: "なし", description: "" }],
          },
        ],
      },
      metadata: {
        answers: [["速度優先"], ["API", "UI"], ["自由記述の回答"]],
      },
      time: { start: BASE + 1_300, end: BASE + 5_300 },
    },
  });

  // An unanswered question (status "error"): selected stays empty.
  insertPartJson("part-question-unanswered", BASE + 5_400, {
    type: "tool",
    tool: "question",
    state: {
      status: "error",
      input: {
        questions: [
          {
            header: "確認",
            question: "進めてよいですか？",
            options: [{ label: "はい", description: "" }],
          },
        ],
      },
      time: { start: BASE + 5_400, end: BASE + 5_400 },
    },
  });
}

describe("opencode session detail question extraction", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    seed(db);
  });

  afterEach(() => {
    db.close();
  });

  test("builds structured question payloads from question tool parts", () => {
    const view = buildSessionRouteView(db, SESSION_ID);
    if (!view) throw new Error("expected a session route view");

    const calls = view.messageToolCalls.get(ASSISTANT_MESSAGE_ID);
    if (!calls) throw new Error("expected tool calls on the assistant message");
    expect(calls.map((call) => call.tool)).toEqual([
      "read",
      "question",
      "question",
    ]);

    // A non-question tool never carries a question payload.
    expect(calls[0].question).toBeNull();

    const answered = calls[1];
    expect(answered.input).toBe("3件の質問");
    expect(answered.fullInput).toBe("");
    expect(answered.question).toEqual({
      questions: [
        {
          header: "方針",
          question: "どの方針にしますか？",
          multiSelect: false,
          options: [
            { label: "速度優先", description: "速い" },
            { label: "安全優先", description: "堅実" },
          ],
          selected: ["速度優先"],
          note: null,
        },
        {
          header: "対象",
          question: "対象を選んでください",
          multiSelect: true,
          options: [
            { label: "API", description: "" },
            { label: "UI", description: "" },
          ],
          selected: ["API", "UI"],
          note: null,
        },
        {
          header: "備考",
          question: "補足はありますか？",
          multiSelect: false,
          options: [{ label: "なし", description: "" }],
          selected: ["自由記述の回答"],
          note: null,
        },
      ],
    });
    // fullOutput renders the canonical plain-text card.
    expect(answered.fullOutput).toContain("Q1.");
    expect(answered.fullOutput).toContain("自由記述の回答");

    // An unanswered question keeps its options but has no selection.
    const unanswered = calls[2];
    expect(unanswered.question?.questions[0]).toMatchObject({
      question: "進めてよいですか？",
      multiSelect: false,
      selected: [],
      note: null,
    });
  });

  test("excludes question tools from the session tool-error count", () => {
    // The only "error" status part is the unanswered question, which is a user
    // interaction and must never count as a tool failure.
    expect(countSessionToolErrors(db, SESSION_ID)).toBe(0);
  });
});
