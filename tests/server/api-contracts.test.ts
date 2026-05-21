import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import { createApiApp } from "../../src/server/app.js";
import {
  getDashboardApiCacheSnapshotForTests,
  invalidateDashboardApiCache,
  readDashboardSnapshot,
} from "../../src/server/dashboard-api.js";
import { MONITOR_SSE_HEARTBEAT_INTERVAL_MS } from "../../src/server/monitor-api.js";
import { resetMonitorRuntimeStoreForTest } from "../../src/server/monitor-runtime-store.js";
import {
  ALERT_SESSION_ID,
  CHILD_SESSION_ID,
  FUTURE_SESSION_ID,
  OLD_SESSION_ID,
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

type SseMessage = {
  event: string;
  data: string;
};

function totalStacks(
  bars: Array<{
    label: string;
    stacks: Array<{ name: string; value: number }>;
  }>,
  label: string,
): number {
  return (
    bars
      .find((bar) => bar.label === label)
      ?.stacks.reduce((sum, stack) => sum + stack.value, 0) ?? 0
  );
}

function stackValue(
  bars: Array<{
    label: string;
    stacks: Array<{ name: string; value: number }>;
  }>,
  label: string,
  name: string,
): number {
  return (
    bars
      .find((bar) => bar.label === label)
      ?.stacks.find((stack) => stack.name === name)?.value ?? 0
  );
}

function parseSseMessage(block: string): SseMessage | null {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!event || dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

async function readSseMessages(
  response: Response,
  expectedCount: number,
): Promise<SseMessage[]> {
  const body = response.body;
  if (!body) {
    throw new Error("expected response body to be present for SSE stream");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const messages: SseMessage[] = [];
  let buffer = "";

  while (messages.length < expectedCount) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const message = parseSseMessage(block);
      if (message) {
        messages.push(message);
        if (messages.length >= expectedCount) {
          await reader.cancel();
          return messages;
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  await reader.cancel();
  throw new Error(
    `expected ${expectedCount} SSE messages, received ${messages.length}`,
  );
}

const TODAY_WINDOW = {
  startDayInclusive: "2024-01-11",
  endDayExclusive: "2024-01-12",
};

const HISTORICAL_WINDOW = {
  startDayInclusive: "2024-01-04",
  endDayExclusive: "2024-01-05",
};

function withoutGeneratedAt<T extends { generatedAt: string }>(value: T) {
  const { generatedAt: _generatedAt, ...rest } = value;
  return rest;
}

describe("server api contracts", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-11T11:06:00.000Z"));
    useFixtureDb();
  });

  beforeEach(() => {
    resetMonitorRuntimeStoreForTest();
    invalidateDashboardApiCache();
  });

  afterAll(() => {
    resetMonitorRuntimeStoreForTest();
    vi.useRealTimers();
    restoreDbPath();
  });

  test("GET /api/monitor/snapshot returns the monitor contract shape", async () => {
    const app = createApiApp();
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "instance-local-1",
          label: "terminal-1",
        },
        heartbeat: {
          at: "2024-01-11T11:05:10.000Z",
          activeSessionIds: [ALERT_SESSION_ID],
        },
        events: [
          {
            type: "session.upsert",
            session: {
              id: ALERT_SESSION_ID,
              title: "Alerting root session",
              directory: "/workspace/repo-beta/packages/api",
              updatedAt: "2024-01-11T11:05:15.000Z",
              messageCount: 1,
              toolCallCount: 1,
              compactionCount: 1,
              todoCount: 1,
            },
          },
          {
            type: "session.status",
            session: {
              id: ALERT_SESSION_ID,
            },
            status: "retry",
          },
        ],
      }),
    });
    expect(ingest.status).toBe(202);
    const response = await app.request("/api/monitor/snapshot");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      activeRootSessions: Array<{ id: string }>;
      compactionCounts: { main: number; subagent: number; total: number };
      signalBadges: Array<{ key: string; count: number }>;
    };

    expect(body.kind).toBe("monitor.snapshot");
    expect(body.activeRootSessions).toHaveLength(1);
    expect(body.activeRootSessions.map((session) => session.id)).toEqual([
      ALERT_SESSION_ID,
    ]);
    expect(body.compactionCounts).toEqual({
      main: 1,
      subagent: 0,
      total: 1,
    });
    expect(
      body.signalBadges.find((badge) => badge.key === "retry")?.count,
    ).toBe(1);
    expect(
      body.signalBadges.find((badge) => badge.key === "todos")?.count,
    ).toBe(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("opencode.db");
    expect(serialized).not.toContain('"data"');
  });

  test("GET /api/export/sessions returns thin root session summaries with exportable message counts", async () => {
    const app = createApiApp();

    const response = await app.request("/api/export/sessions");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      schemaVersion: string;
      cursor: string | null;
      nextCursor: string | null;
      items: Array<{
        sessionId: string;
        parentSessionId: string | null;
        title: string;
        directory: string;
        worktree: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
      }>;
    };

    expect(body.kind).toBe("export.sessions");
    expect(body.schemaVersion).toBe("v1");
    expect(body.cursor).toBeNull();
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((item) => item.sessionId)).toEqual([
      FUTURE_SESSION_ID,
      ROOT_SESSION_ID,
      ALERT_SESSION_ID,
      OLD_SESSION_ID,
    ]);
    expect(
      body.items.find((item) => item.sessionId === ROOT_SESSION_ID)
        ?.messageCount,
    ).toBe(3);
    expect(
      body.items.find((item) => item.sessionId === ALERT_SESSION_ID)
        ?.messageCount,
    ).toBe(2);
    expect(
      body.items.find((item) => item.sessionId === ROOT_SESSION_ID)?.worktree,
    ).toBe("/workspace/repo-alpha");
    expect(
      body.items.find((item) => item.sessionId === ALERT_SESSION_ID)?.worktree,
    ).toBe("/workspace/repo-beta");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"parts"');
    expect(serialized).not.toContain('"tool"');
    expect(serialized).not.toContain('"summary"');
  });

  test("GET /api/export/sessions supports exact worktree filtering", async () => {
    useFixtureDb();
    const db = getWritableDb();
    const now = Date.now();

    try {
      db.prepare(
        `INSERT INTO project (
          id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated, time_initialized, sandboxes, commands
        ) VALUES (
          @id, @worktree, @vcs, @name, @icon_url, @icon_color, @time_created, @time_updated, @time_initialized, @sandboxes, @commands
        )`,
      ).run({
        id: "proj-alpha-worktree",
        worktree: "/Users/me/wt/repo-alpha-fix",
        vcs: "git",
        name: "repo-alpha",
        icon_url: null,
        icon_color: "#0f766e",
        time_created: now,
        time_updated: now,
        time_initialized: now,
        sandboxes: "[]",
        commands: null,
      });

      db.prepare(
        `INSERT INTO session (
          id, project_id, parent_id, slug, directory, title, version, share_url,
          summary_additions, summary_deletions, summary_files, summary_diffs,
          revert, permission, time_created, time_updated, time_compacting, time_archived, workspace_id
        ) VALUES (
          @id, @project_id, @parent_id, @slug, @directory, @title, @version, NULL,
          @summary_additions, @summary_deletions, @summary_files, @summary_diffs,
          NULL, NULL, @time_created, @time_updated, @time_compacting, NULL, NULL
        )`,
      ).run({
        id: "ses-root-worktree-alpha",
        project_id: "proj-alpha-worktree",
        parent_id: null,
        slug: "root-worktree-alpha",
        directory: "/Users/me/wt/repo-alpha-fix/packages/api",
        title: "Worktree scoped session",
        version: "1",
        summary_additions: 0,
        summary_deletions: 0,
        summary_files: 0,
        summary_diffs: null,
        time_created: now + 1_000,
        time_updated: now + 2_000,
        time_compacting: null,
      });

      db.prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (@id, @session_id, @time_created, @time_updated, @data)`,
      ).run({
        id: "msg-root-worktree-alpha-user",
        session_id: "ses-root-worktree-alpha",
        time_created: now + 1_100,
        time_updated: now + 1_100,
        data: JSON.stringify({
          role: "user",
          time: { created: now + 1_100 },
        }),
      });
    } finally {
      db.close();
    }

    try {
      const app = createApiApp();

      const filtered = await app.request(
        "/api/export/sessions?worktree=%2FUsers%2Fme%2Fwt%2Frepo-alpha-fix",
      );
      expect(filtered.status).toBe(200);
      const filteredBody = (await filtered.json()) as {
        items: Array<{ sessionId: string; worktree: string }>;
      };
      expect(filteredBody.items).toHaveLength(1);
      expect(filteredBody.items[0]).toMatchObject({
        sessionId: "ses-root-worktree-alpha",
        worktree: "/Users/me/wt/repo-alpha-fix",
      });

      const blank = await app.request("/api/export/sessions?worktree=%20%20");
      expect(blank.status).toBe(200);
      const blankBody = (await blank.json()) as {
        items: Array<{ sessionId: string }>;
      };
      expect(blankBody.items.map((item) => item.sessionId)).toContain(
        ROOT_SESSION_ID,
      );
      expect(blankBody.items.map((item) => item.sessionId)).toContain(
        "ses-root-worktree-alpha",
      );

      const missing = await app.request(
        "/api/export/sessions?worktree=%2FUsers%2Fme%2Fwt%2Fmissing",
      );
      expect(missing.status).toBe(200);
      const missingBody = (await missing.json()) as { items: unknown[] };
      expect(missingBody.items).toEqual([]);
    } finally {
      useFixtureDb();
    }
  });

  test("GET /api/export/sessions/:sessionId/messages returns canonical bundles without compaction messages", async () => {
    const app = createApiApp();

    const response = await app.request(
      `/api/export/sessions/${ROOT_SESSION_ID}/messages`,
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      schemaVersion: string;
      items: Array<{
        bundleId: string;
        sessionId: string;
        messageId: string;
        parentSessionId: string | null;
        role: string;
        ordering: { sessionMessageIndex: number };
        source: { instanceId: string; exportNamespace: string };
        lineage: { triggerMessageId: string | null; childSessionIds: string[] };
        parts: Array<Record<string, unknown>>;
      }>;
    };

    expect(body.kind).toBe("export.message_bundles");
    expect(body.schemaVersion).toBe("v1");
    expect(body.items).toHaveLength(3);
    expect(body.items.map((item) => item.messageId)).toEqual([
      "msg-root-1-user",
      "msg-root-1-assistant-1",
      "msg-root-1-assistant-2",
    ]);
    expect(body.items.map((item) => item.ordering.sessionMessageIndex)).toEqual(
      [1, 2, 3],
    );
    expect(body.items.every((item) => item.bundleId === item.messageId)).toBe(
      true,
    );
    expect(
      body.items.every(
        (item) => item.source.instanceId === "opencode-observability",
      ),
    ).toBe(true);
    expect(
      body.items.every((item) => item.source.exportNamespace === "db"),
    ).toBe(true);

    const assistant = body.items.find(
      (item) => item.messageId === "msg-root-1-assistant-1",
    );
    expect(assistant?.lineage.childSessionIds).toEqual([CHILD_SESSION_ID]);
    expect(assistant?.parts).toHaveLength(4);
    expect(assistant?.parts.map((part) => part.partIndex)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(JSON.stringify(body)).not.toContain("msg-child-1-compaction");
    expect(JSON.stringify(body)).not.toContain('"retrievalScore"');
    expect(JSON.stringify(body)).not.toContain('"embeddingId"');
  });

  test("GET /api/export/messages/:messageId returns one bundle and 404s for unknown ids", async () => {
    const app = createApiApp();

    const response = await app.request(
      "/api/export/messages/msg-child-1-assistant",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      schemaVersion: string;
      cursor: string | null;
      nextCursor: string | null;
      items: Array<{
        messageId: string;
        parentSessionId: string | null;
        lineage: { triggerMessageId: string | null; childSessionIds: string[] };
      }>;
    };

    expect(body.kind).toBe("export.message_bundles");
    expect(body.schemaVersion).toBe("v1");
    expect(body.cursor).toBeNull();
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.messageId).toBe("msg-child-1-assistant");
    expect(body.items[0]?.parentSessionId).toBe(ROOT_SESSION_ID);
    expect(body.items[0]?.lineage.triggerMessageId).toBe(
      "msg-root-1-assistant-1",
    );

    const missing = await app.request("/api/export/messages/msg-missing");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      kind: "export.message-not-found",
      messageId: "msg-missing",
    });
  });

  test("GET /api/export/parts/:partId returns a single part and preserves reasoning parts", async () => {
    const app = createApiApp();

    const response = await app.request(
      "/api/export/parts/prt_root_assistant_1_reasoning",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      items: Array<{
        sessionId: string;
        messageId: string;
        part: {
          type: string;
          partIndex: number;
          text?: string;
          compactedAt?: string;
        };
      }>;
    };

    expect(body.kind).toBe("export.parts");
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.messageId).toBe("msg-root-1-assistant-1");
    expect(body.items[0]?.part.type).toBe("reasoning");
    expect(body.items[0]?.part.partIndex).toBe(1);
    expect(body.items[0]?.part.text).toContain("Compaction marker");
    expect(body.items[0]?.part.compactedAt).toBeDefined();

    const missing = await app.request("/api/export/parts/prt_missing");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      kind: "export.part-not-found",
      partId: "prt_missing",
    });
  });

  test("part-by-id preserves the same partIndex as the parent bundle", async () => {
    const app = createApiApp();

    const bundleResponse = await app.request(
      `/api/export/sessions/${ROOT_SESSION_ID}/messages`,
    );
    const partResponse = await app.request(
      "/api/export/parts/prt_root_assistant_1_reasoning",
    );

    const bundleBody = (await bundleResponse.json()) as {
      items: Array<{
        messageId: string;
        parts: Array<{ partId: string; partIndex: number }>;
      }>;
    };
    const partBody = (await partResponse.json()) as {
      items: Array<{ part: { partId: string; partIndex: number } }>;
    };

    const bundlePart = bundleBody.items
      .find((item) => item.messageId === "msg-root-1-assistant-1")
      ?.parts.find((part) => part.partId === "prt_root_assistant_1_reasoning");

    expect(bundlePart?.partIndex).toBe(1);
    expect(partBody.items[0]?.part.partIndex).toBe(bundlePart?.partIndex);
  });

  test("GET /api/export/parts/:partId rejects compaction-only parts", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/export/parts/part-child-1-compaction-text",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      kind: "export.part-not-found",
      partId: "part-child-1-compaction-text",
    });
  });

  test("GET /api/export/events returns an empty export events envelope", async () => {
    const app = createApiApp();
    const response = await app.request("/api/export/events");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      schemaVersion: string;
      items: unknown[];
    };
    expect(body.kind).toBe("export.events");
    expect(body.schemaVersion).toBe("v1");
    expect(body.items).toEqual([]);
  });

  test("GET /api/export/sessions/:sessionId/context-window returns neighboring previews", async () => {
    const app = createApiApp();
    const response = await app.request(
      `/api/export/sessions/${ROOT_SESSION_ID}/context-window?aroundMessageId=msg-root-1-assistant-1&before=1&after=1`,
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      aroundMessageId: string;
      items: Array<{ messageId: string; role: string; preview: string | null }>;
    };

    expect(body.kind).toBe("export.context_window");
    expect(body.aroundMessageId).toBe("msg-root-1-assistant-1");
    expect(body.items.map((item) => item.messageId)).toEqual([
      "msg-root-1-user",
      "msg-root-1-assistant-1",
      "msg-root-1-assistant-2",
    ]);
    expect(body.items[1]?.preview).toContain(
      "Planning the first response with tool usage.",
    );
  });

  test("GET /api/export/sessions/:sessionId/messages returns 404 for unknown sessions", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/export/sessions/ses-missing/messages",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      kind: "export.session-not-found",
      sessionId: "ses-missing",
    });
  });

  test("active session is determined by heartbeat even when session status is idle", async () => {
    const app = createApiApp();
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "instance-local-2",
        },
        heartbeat: {
          at: "2024-01-11T11:05:50.000Z",
          activeSessionIds: [ROOT_SESSION_ID],
        },
        events: [
          {
            type: "session.upsert",
            session: {
              id: ROOT_SESSION_ID,
              title: "Root monitor session",
              directory: "/workspace/repo-alpha",
              updatedAt: "2024-01-10T00:00:00.000Z",
              status: "idle",
            },
          },
        ],
      }),
    });
    expect(ingest.status).toBe(202);

    const response = await app.request("/api/monitor/snapshot");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      activeRootSessions: Array<{ id: string }>;
      signalBadges: Array<{ key: string; count: number }>;
    };

    expect(body.activeRootSessions.map((session) => session.id)).toEqual([
      ROOT_SESSION_ID,
    ]);
    expect(
      body.signalBadges.find((badge) => badge.key === "active")?.count,
    ).toBe(1);
  });

  test("monitor snapshot backfills message/tool counts from DB when ingest values are missing or stale", async () => {
    const app = createApiApp();
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "instance-local-2b",
        },
        heartbeat: {
          at: "2024-01-11T11:05:50.000Z",
          activeSessionIds: [ROOT_SESSION_ID],
        },
        event: {
          type: "session.upsert",
          session: {
            id: ROOT_SESSION_ID,
            title: "Root monitor session",
            directory: "/workspace/repo-alpha",
            updatedAt: "2024-01-11T11:05:50.000Z",
            messageCount: 1,
            toolCallCount: 1,
          },
        },
      }),
    });
    expect(ingest.status).toBe(202);

    const response = await app.request("/api/monitor/snapshot");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      activeRootSessions: Array<{
        id: string;
        messageCount: number;
        toolCallCount: number;
        subagentCount: number;
        inputRatioPercent: number;
      }>;
    };
    const root = body.activeRootSessions.find(
      (session) => session.id === ROOT_SESSION_ID,
    );

    expect(root).toBeDefined();
    expect((root?.messageCount ?? 0) > 0).toBe(true);
    expect((root?.toolCallCount ?? 0) > 0).toBe(true);
    expect((root?.subagentCount ?? 0) > 0).toBe(true);
    expect((root?.inputRatioPercent ?? 0) > 0).toBe(true);
  });

  test("monitor snapshot backfills session metadata from DB for heartbeat-only active sessions", async () => {
    const app = createApiApp();
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "instance-local-heartbeat-only",
        },
        heartbeat: {
          at: "2024-01-11T11:05:50.000Z",
          activeSessionIds: [ROOT_SESSION_ID],
        },
      }),
    });
    expect(ingest.status).toBe(202);

    const response = await app.request("/api/monitor/snapshot");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      activeRootSessions: Array<{
        id: string;
        title: string;
        directory: string;
      }>;
    };
    const root = body.activeRootSessions.find(
      (session) => session.id === ROOT_SESSION_ID,
    );

    expect(root).toMatchObject({
      id: ROOT_SESSION_ID,
      title: "Root monitor session",
      directory: "/workspace/repo-alpha",
    });
  });

  test("monitor snapshot token summary matches Model Usage rows including active subagents", async () => {
    const app = createApiApp();
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "instance-local-token-tree",
        },
        heartbeat: {
          at: "2024-01-11T11:05:50.000Z",
          activeSessionIds: [ROOT_SESSION_ID, CHILD_SESSION_ID],
        },
        events: [
          {
            type: "session.upsert",
            session: {
              id: ROOT_SESSION_ID,
              title: "Root monitor session",
              directory: "/workspace/repo-alpha",
              updatedAt: "2024-01-11T11:05:50.000Z",
              messageCount: 1,
              toolCallCount: 1,
            },
          },
          {
            type: "session.upsert",
            session: {
              id: CHILD_SESSION_ID,
              parentId: ROOT_SESSION_ID,
              title: "Subagent follow-up",
              directory: "/workspace/repo-alpha/subagent",
              updatedAt: "2024-01-11T11:05:51.000Z",
            },
          },
        ],
      }),
    });
    expect(ingest.status).toBe(202);

    const response = await app.request("/api/monitor/snapshot");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      activeRootSessions: Array<{
        id: string;
        totalTokens: number;
        inputTokens: number;
        outputTokens: number;
        inputRatioPercent: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        tokenUsage: Array<{
          scope: "main" | "subagent";
          agent: string;
          modelId: string;
          providerId: string;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
        }>;
      }>;
    };
    const root = body.activeRootSessions.find(
      (session) => session.id === ROOT_SESSION_ID,
    );

    expect(root).toBeDefined();
    expect(root?.totalTokens).toBe(222);
    expect(root?.inputTokens).toBe(114);
    expect(root?.outputTokens).toBe(108);
    expect(root?.cacheReadTokens).toBe(40);
    expect(root?.cacheWriteTokens).toBe(5);
    expect(root?.inputRatioPercent).toBeCloseTo(51.351, 3);
    expect(root?.tokenUsage).toEqual([
      expect.objectContaining({
        scope: "main",
        agent: "planner",
        providerId: "openai",
        modelId: "gpt-4.1",
        totalTokens: 180,
      }),
      expect.objectContaining({
        scope: "subagent",
        agent: "subagent-code",
        providerId: "openai",
        modelId: "gpt-4.1-mini",
        totalTokens: 30,
      }),
      expect.objectContaining({
        scope: "subagent",
        agent: "compaction",
        providerId: "openai",
        modelId: "gpt-5.3-codex-spark",
        totalTokens: 12,
      }),
    ]);
  });

  test("monitor snapshot token usage falls back when total token field is zero", async () => {
    const fallbackSessionId = "ses-monitor-total-fallback";
    const fallbackMessageId = "msg-monitor-total-fallback-assistant";
    const now = Date.now();
    const db = getWritableDb();

    try {
      db.prepare(
        `INSERT INTO session (
          id, project_id, parent_id, slug, directory, title, version, share_url,
          summary_additions, summary_deletions, summary_files, summary_diffs,
          revert, permission, time_created, time_updated, time_compacting, time_archived, workspace_id
        ) VALUES (
          @id, @project_id, NULL, @slug, @directory, @title, @version, NULL,
          0, 0, 0, NULL,
          NULL, NULL, @time_created, @time_updated, NULL, NULL, NULL
        )`,
      ).run({
        id: fallbackSessionId,
        project_id: "proj-alpha",
        slug: "monitor-total-fallback",
        directory: "/workspace/repo-alpha/fallback",
        title: "Monitor total fallback",
        version: "1",
        time_created: now,
        time_updated: now,
      });
      db.prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (@id, @session_id, @time_created, @time_updated, @data)`,
      ).run({
        id: fallbackMessageId,
        session_id: fallbackSessionId,
        time_created: now,
        time_updated: now,
        data: JSON.stringify({
          role: "assistant",
          modelID: "gpt-fallback",
          providerID: "openai",
          agent: "fallback-agent",
          tokens: {
            total: 0,
            input: 7,
            output: 11,
            cache: { read: 13, write: 17 },
          },
        }),
      });
    } finally {
      db.close();
    }

    try {
      const app = createApiApp();
      const ingest = await app.request("/api/monitor/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source: {
            instanceId: "instance-local-token-fallback",
          },
          heartbeat: {
            at: "2024-01-11T11:05:50.000Z",
            activeSessionIds: [fallbackSessionId],
          },
        }),
      });
      expect(ingest.status).toBe(202);

      const response = await app.request("/api/monitor/snapshot");
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        activeRootSessions: Array<{
          id: string;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          tokenUsage: Array<{
            totalTokens: number;
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
          }>;
        }>;
      };
      const root = body.activeRootSessions.find(
        (session) => session.id === fallbackSessionId,
      );

      expect(root).toMatchObject({
        id: fallbackSessionId,
        totalTokens: 48,
        inputTokens: 7,
        outputTokens: 11,
        cacheReadTokens: 13,
        cacheWriteTokens: 17,
      });
      expect(root?.tokenUsage).toEqual([
        expect.objectContaining({
          totalTokens: 48,
          inputTokens: 7,
          outputTokens: 11,
          cacheReadTokens: 13,
          cacheWriteTokens: 17,
        }),
      ]);
    } finally {
      const cleanupDb = getWritableDb();
      try {
        cleanupDb.prepare("DELETE FROM message WHERE session_id = ?").run(
          fallbackSessionId,
        );
        cleanupDb.prepare("DELETE FROM session WHERE id = ?").run(
          fallbackSessionId,
        );
      } finally {
        cleanupDb.close();
      }
    }
  });

  test("monitor snapshot exposes alert category badges from session.alert events", async () => {
    const app = createApiApp();
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "instance-local-alerts",
        },
        heartbeat: {
          at: "2024-01-11T11:05:10.000Z",
          activeSessionIds: [ALERT_SESSION_ID],
        },
        events: [
          {
            type: "session.upsert",
            session: {
              id: ALERT_SESSION_ID,
              title: "Alerting root session",
              directory: "/workspace/repo-beta/packages/api",
              updatedAt: "2024-01-11T11:05:15.000Z",
            },
          },
          {
            type: "session.alert",
            category: "token",
            message: "token refresh failed",
            session: {
              id: ALERT_SESSION_ID,
            },
          },
          {
            type: "session.alert",
            category: "limit",
            message: "rate limit exceeded",
            session: {
              id: ALERT_SESSION_ID,
            },
          },
          {
            type: "session.alert",
            category: "compaction",
            message: "compaction burst",
            session: {
              id: ALERT_SESSION_ID,
            },
          },
        ],
      }),
    });
    expect(ingest.status).toBe(202);

    const response = await app.request("/api/monitor/snapshot");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      signalBadges: Array<{ key: string; count: number }>;
    };

    expect(
      body.signalBadges.find((badge) => badge.key === "alerts")?.count,
    ).toBe(3);
    expect(
      body.signalBadges.find((badge) => badge.key === "token")?.count,
    ).toBe(1);
    expect(
      body.signalBadges.find((badge) => badge.key === "limit")?.count,
    ).toBe(1);
    expect(
      body.signalBadges.find((badge) => badge.key === "compaction-alert")
        ?.count,
    ).toBe(1);
  });

  test("GET /api/monitor/events emits an initial snapshot event envelope", async () => {
    const app = createApiApp();
    const response = await app.request("/api/monitor/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const [snapshotMessage] = await readSseMessages(response, 1);
    expect(snapshotMessage.event).toBe("snapshot");

    const snapshotEnvelope = JSON.parse(snapshotMessage.data) as {
      type: string;
      generatedAt: number;
      payload: { kind: string };
    };

    expect(snapshotEnvelope.type).toBe("snapshot");
    expect(snapshotEnvelope.payload.kind).toBe("monitor.snapshot");
    expect(Number.isFinite(snapshotEnvelope.generatedAt)).toBe(true);
  });

  test("GET /api/monitor/events emits heartbeat events on interval", async () => {
    const app = createApiApp();
    const response = await app.request("/api/monitor/events");

    const messagesPromise = readSseMessages(response, 2);
    await vi.advanceTimersByTimeAsync(MONITOR_SSE_HEARTBEAT_INTERVAL_MS);
    const [snapshotMessage, heartbeatMessage] = await messagesPromise;

    expect(snapshotMessage.event).toBe("snapshot");
    expect(heartbeatMessage.event).toBe("heartbeat");

    const snapshotEnvelope = JSON.parse(snapshotMessage.data) as {
      type: string;
      generatedAt: number;
    };
    const heartbeatEnvelope = JSON.parse(heartbeatMessage.data) as {
      type: string;
      generatedAt: number;
    };

    expect(snapshotEnvelope.type).toBe("snapshot");
    expect(heartbeatEnvelope.type).toBe("heartbeat");
    expect(heartbeatEnvelope.generatedAt).toBeGreaterThanOrEqual(
      snapshotEnvelope.generatedAt,
    );
  });

  test("session becomes inactive after heartbeat TTL expires", async () => {
    process.env.OPENCODE_MONITOR_HEARTBEAT_TTL_MS = "1000";
    try {
      const app = createApiApp();
      const ingest = await app.request("/api/monitor/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source: {
            instanceId: "instance-local-3",
          },
          heartbeat: {
            at: "2024-01-11T11:06:00.000Z",
            activeSessionIds: [ALERT_SESSION_ID],
          },
          event: {
            type: "session.upsert",
            session: {
              id: ALERT_SESSION_ID,
              title: "Alerting root session",
              directory: "/workspace/repo-beta/packages/api",
            },
          },
        }),
      });
      expect(ingest.status).toBe(202);

      vi.advanceTimersByTime(1001);
      const response = await app.request("/api/monitor/snapshot");
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        activeRootSessions: Array<{ id: string }>;
        signalBadges: Array<{ key: string; count: number }>;
      };

      expect(body.activeRootSessions).toHaveLength(0);
      expect(
        body.signalBadges.find((badge) => badge.key === "active")?.count,
      ).toBe(0);
    } finally {
      delete process.env.OPENCODE_MONITOR_HEARTBEAT_TTL_MS;
    }
  });

  test("POST /api/monitor/ingest requires token when configured", async () => {
    process.env.OPENCODE_MONITOR_INGEST_TOKEN = "test-token";
    try {
      const app = createApiApp();
      const unauthorized = await app.request("/api/monitor/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source: { instanceId: "instance-local-4" },
          heartbeat: {
            activeSessionIds: [],
          },
        }),
      });
      expect(unauthorized.status).toBe(401);

      const authorized = await app.request("/api/monitor/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          source: { instanceId: "instance-local-4" },
          heartbeat: {
            activeSessionIds: [],
          },
        }),
      });
      expect(authorized.status).toBe(202);
    } finally {
      delete process.env.OPENCODE_MONITOR_INGEST_TOKEN;
    }
  });

  test("GET /api/directories returns directories contract shape", async () => {
    const app = createApiApp();
    const response = await app.request("/api/directories");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      repoGroups: Array<{
        name: string;
        rawWorktree: string;
        directories: Array<{
          rawDirectory: string;
          prettyDirectory: string;
          worktree: string;
          prettyWorktree: string;
          sessionCount: number;
        }>;
      }>;
    };

    expect(body.kind).toBe("directories.list");
    expect(body.repoGroups.map((group) => group.rawWorktree)).toEqual([
      "/workspace/repo-alpha",
      "/workspace/repo-beta",
    ]);
    expect(body.repoGroups[0].directories).toEqual([
      {
        rawDirectory: "/workspace/repo-alpha",
        prettyDirectory: "/workspace/repo-alpha",
        worktree: "/workspace/repo-alpha",
        prettyWorktree: "/workspace/repo-alpha",
        sessionCount: 1,
      },
      {
        rawDirectory: "/workspace/repo-alpha/future",
        prettyDirectory: "/workspace/repo-alpha/future",
        worktree: "/workspace/repo-alpha",
        prettyWorktree: "/workspace/repo-alpha",
        sessionCount: 1,
      },
    ]);
  });

  test("GET /api/dir/:directory returns sessions with sort/filter semantics", async () => {
    const app = createApiApp();
    const directory = encodeURIComponent("/workspace/repo-alpha");
    const response = await app.request(
      `/api/dir/${directory}?sort=tokens&filter=root`,
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      directory: string;
      sort: {
        selected: string;
        options: string[];
      };
      filter: {
        query: string;
      };
      sessions: Array<{
        id: string;
        title: string;
        messageCount: number;
        totalTokens: number;
        subagentCount: number;
        durationMs: number;
        summary: {
          additions: number;
          deletions: number;
          files: number;
        };
      }>;
    };

    expect(body.kind).toBe("directory.sessions");
    expect(body.directory).toBe("/workspace/repo-alpha");
    expect(body.sort.selected).toBe("tokens");
    expect(body.sort.options).toEqual(["date", "tokens", "messages"]);
    expect(body.filter.query).toBe("root");
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      id: ROOT_SESSION_ID,
      title: "Root monitor session",
      messageCount: 3,
      totalTokens: 180,
      subagentCount: 1,
      summary: {
        additions: 10,
        deletions: 4,
        files: 2,
      },
    });
    expect(body.sessions[0].durationMs).toBeGreaterThan(0);
  });

  test("GET /api/search returns empty results with no query", async () => {
    const app = createApiApp();
    const response = await app.request("/api/search");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      query: string;
      searchTerms: string[];
      results: unknown[];
    };

    expect(body.kind).toBe("search.results");
    expect(body.query).toBe("");
    expect(body.searchTerms).toEqual([]);
    expect(body.results).toEqual([]);
  });

  test("GET /api/search handles special characters safely", async () => {
    const app = createApiApp();
    const response = await app.request(
      `/api/search?q=${encodeURIComponent("'\";")}`,
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      query: string;
      results: unknown[];
    };

    expect(body.kind).toBe("search.results");
    expect(body.query).toBe("'\";");
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("GET /api/session/:id returns the session contract shape", async () => {
    const app = createApiApp();
    const response = await app.request(`/api/session/${ROOT_SESSION_ID}`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      durationMs: number;
      session: { id: string; title: string; parentId: string | null };
      tokens: {
        total: number;
        input: number;
        output: number;
        reasoning: number;
        cacheRead: number;
        cacheWrite: number;
        cost: number;
      };
      compactions: { main: number; subagent: number; total: number };
      modelBreakdown: Array<{
        scope: "main" | "subagent";
        agent: string;
        modelId: string;
        providerId: string;
        messageCount: number;
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
        totalCost: number;
      }>;
      subagents: Array<{
        id: string;
        title: string;
        durationMs: number;
        compactionCount: number;
      }>;
      signalBadges: Array<{ key: string; count: number }>;
      messages: Array<{
        role: string;
        text: string;
        modelId: string | null;
        agent: string | null;
        outputTpsLabel: string | null;
        createdAt: string;
        toolCalls: Array<{
          tool: string;
          input: string;
          status: string;
          error: string;
          fullInput: string;
          fullOutput: string;
          durationMs: number;
        }>;
        subagentLinks: Array<{
          id: string;
          title: string;
          durationMs: number;
        }>;
      }>;
      toolEvents: Array<{
        tool: string;
        input: string;
        status: string;
        error: string;
        fullInput: string;
        fullOutput: string;
        durationMs: number;
        createdAt: string;
      }>;
      todos: Array<{
        content: string;
        status: string;
        priority: string;
      }>;
      summaryDiffs: string | null;
    };

    expect(body.kind).toBe("session.detail");
    expect(body.durationMs).toBeGreaterThan(0);
    expect(body.session).toMatchObject({
      id: ROOT_SESSION_ID,
      title: "Root monitor session",
      parentId: null,
    });
    expect(body.tokens).toEqual({
      total: 222,
      input: 114,
      output: 108,
      reasoning: 20,
      cacheRead: 40,
      cacheWrite: 5,
      cost: 0.21,
    });
    expect(body.modelBreakdown).toHaveLength(3);
    expect(body.modelBreakdown).toEqual([
      {
        scope: "main",
        agent: "planner",
        modelId: "gpt-4.1",
        providerId: "openai",
        messageCount: 2,
        inputTokens: 100,
        outputTokens: 80,
        reasoningTokens: 20,
        cacheReadTokens: 40,
        cacheWriteTokens: 5,
        totalTokens: 180,
        totalCost: 0.16999999999999998,
      },
      {
        scope: "subagent",
        agent: "subagent-code",
        modelId: "gpt-4.1-mini",
        providerId: "openai",
        messageCount: 1,
        inputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 30,
        totalCost: 0.03,
      },
      {
        scope: "subagent",
        agent: "compaction",
        modelId: "gpt-5.3-codex-spark",
        providerId: "openai",
        messageCount: 1,
        inputTokens: 4,
        outputTokens: 8,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 12,
        totalCost: 0.01,
      },
    ]);
    expect(body.compactions).toEqual({
      main: 0,
      subagent: 1,
      total: 1,
    });
    expect(body.subagents).toHaveLength(1);
    expect(body.subagents[0]).toMatchObject({
      id: CHILD_SESSION_ID,
      title: "Subagent follow-up",
      durationMs: 15_000,
      compactionCount: 1,
    });
    expect(
      body.signalBadges.find((badge) => badge.key === "compactions")?.count,
    ).toBe(1);

    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toMatchObject({
      role: "user",
      text: "Investigate the failing monitor sessions.",
      modelId: null,
      agent: null,
      outputTpsLabel: null,
    });
    expect(body.messages[1].toolCalls).toHaveLength(2);
    expect(body.messages[1].toolCalls[0]).toMatchObject({
      tool: "read",
      status: "completed",
    });
    expect(body.messages[1].toolCalls[1]).toMatchObject({
      tool: "github_search",
      status: "error",
      error: "HTTP 500 upstream",
    });
    expect(body.messages[1].subagentLinks).toEqual([
      {
        id: CHILD_SESSION_ID,
        title: "Subagent follow-up",
        durationMs: 15_000,
      },
    ]);
    expect(body.toolEvents).toHaveLength(3);
    expect(body.toolEvents.map((event) => event.tool)).toEqual([
      "read",
      "github_search",
      "bash",
    ]);

    expect(body.todos).toEqual([
      {
        content: "Collect failing commands",
        status: "completed",
        priority: "high",
      },
      {
        content: "Summarize the root cause",
        status: "in_progress",
        priority: "medium",
      },
    ]);
    expect(body.summaryDiffs).toBe("diff --git a/src/index.ts b/src/index.ts");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("msg-root-1-user");
    expect(serialized).not.toContain("part-root-1-tool-read");
  });

  test("GET /api/session/:id renders tool-only messages as empty-text message shells", async () => {
    useFixtureDb();
    let db: ReturnType<typeof getWritableDb> | null = null;

    try {
      db = getWritableDb();
      const createdAt = Date.parse("2024-01-11T10:30:30.000Z");
      db.prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        "msg-root-1-tool-only-skill",
        ROOT_SESSION_ID,
        createdAt,
        createdAt + 100,
        JSON.stringify({
          role: "assistant",
          time: { created: createdAt, completed: createdAt + 100 },
        }),
      );
      db.prepare(
        `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "part-root-1-tool-only-skill",
        "msg-root-1-tool-only-skill",
        ROOT_SESSION_ID,
        createdAt + 50,
        createdAt + 100,
        JSON.stringify({
          type: "tool",
          tool: "skill",
          state: {
            status: "completed",
            input: { name: "create-skill" },
            output: "skill loaded",
            time: { start: createdAt + 50, end: createdAt + 100 },
          },
        }),
      );
      db.close();
      db = null;

      const app = createApiApp();
      const response = await app.request(`/api/session/${ROOT_SESSION_ID}`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        messages: Array<{
          text: string;
          createdAt: string;
          toolCalls: Array<{ tool: string; input: string }>;
        }>;
        toolEvents: Array<{ tool: string; input: string }>;
      };

      expect(body.messages).toHaveLength(4);
      const toolOnlyMessage = body.messages.find(
        (message) => message.createdAt === new Date(createdAt).toISOString(),
      );
      expect(toolOnlyMessage).toMatchObject({
        text: "",
        toolCalls: [
          expect.objectContaining({ tool: "skill", input: "create-skill" }),
        ],
      });
      expect(body.toolEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: "skill", input: "create-skill" }),
        ]),
      );
    } finally {
      db?.close();
      useFixtureDb();
    }
  });

  test("DELETE /api/session invalidates dashboard aggregates for the deleted root session", async () => {
    useFixtureDb();

    const app = createApiApp();
    const beforeDb = getWritableDb();

    try {
      const before = readDashboardSnapshot(beforeDb, {
        range: "all",
        view: "daily",
      });
      expect(before.summary.totalSessions).toBe(3);
      expect(before.recentSessions.map((session) => session.id)).toContain(
        ROOT_SESSION_ID,
      );
    } finally {
      beforeDb.close();
    }

    const beforeSnapshot = getDashboardApiCacheSnapshotForTests();
    expect(beforeSnapshot.sessionKeys).toEqual([
      OLD_SESSION_ID,
      ROOT_SESSION_ID,
      ALERT_SESSION_ID,
    ]);
    expect(beforeSnapshot.dayKeys).toEqual([
      "2024-01-04",
      "2024-01-10",
      "2024-01-11",
    ]);

    try {
      const response = await app.request(`/api/session/${ROOT_SESSION_ID}`, {
        method: "DELETE",
        headers: {
          "x-opencode-confirm-delete": ROOT_SESSION_ID,
        },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ deleted: 2 });

      const afterDeleteSnapshot = getDashboardApiCacheSnapshotForTests();
      expect(afterDeleteSnapshot.generation).toBe(beforeSnapshot.generation + 1);
      expect(afterDeleteSnapshot.sessionKeys).toEqual([
        OLD_SESSION_ID,
        ALERT_SESSION_ID,
      ]);
      expect(afterDeleteSnapshot.dayKeys).toEqual([
        "2024-01-04",
        "2024-01-10",
      ]);

      const afterDb = getWritableDb();
      try {
        const after = readDashboardSnapshot(afterDb, {
          range: "all",
          view: "daily",
        });
        expect(after.summary.totalSessions).toBe(2);
        expect(after.recentSessions.map((session) => session.id)).not.toContain(
          ROOT_SESSION_ID,
        );
      } finally {
        afterDb.close();
      }
    } finally {
      useFixtureDb();
    }
  });

  test("DELETE /api/session rejects missing confirmation without touching dashboard aggregates", async () => {
    useFixtureDb();

    const app = createApiApp();
    const beforeDb = getWritableDb();

    let beforeGeneratedAt = "";
    try {
      const before = readDashboardSnapshot(beforeDb, {
        range: "all",
        view: "daily",
      });
      beforeGeneratedAt = before.generatedAt;
      expect(before.summary.totalSessions).toBe(3);
    } finally {
      beforeDb.close();
    }

    const beforeSnapshot = getDashboardApiCacheSnapshotForTests();

    try {
      const response = await app.request(`/api/session/${ROOT_SESSION_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "delete confirmation required",
        sessionId: ROOT_SESSION_ID,
      });

      expect(getDashboardApiCacheSnapshotForTests()).toEqual(beforeSnapshot);

      const afterDb = getWritableDb();
      try {
        const after = readDashboardSnapshot(afterDb, {
          range: "all",
          view: "daily",
        });
        expect(after.generatedAt).toBe(beforeGeneratedAt);
        expect(after.summary.totalSessions).toBe(3);
      } finally {
        afterDb.close();
      }
    } finally {
      useFixtureDb();
    }
  });

  test("GET /api/dashboard returns bounded all-window dashboard data", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      selection: {
        preset: string;
        start: string;
        end: string;
        view: string;
        timezone: string;
        refreshable: boolean;
        bounds: {
          startDayInclusive: string;
          endDayInclusive: string;
          endDayExclusive: string;
          dayCount: number;
        };
      };
      summary: {
        totalSessions: number;
        totalTokens: number;
        totalToolCalls: number;
        toolErrors: number;
        toolErrorRate: string;
        activeProjects: number;
      };
      recentSessions: Array<{ id: string }>;
      heatmapDays: Array<{ day: string; count: number }>;
      errorTrendSeries: Array<{
        points: Array<{ day: string; value: number }>;
      }>;
      errorTrendHourlyBars: Array<unknown>;
      tokenTrend: {
        inputRatioPercent: number;
        dailySeries: Array<{ points: Array<{ day: string; value: number }> }>;
        hourlyBars: Array<unknown>;
      };
      modelPerformanceStats: Array<{
        model: string;
        avgTps: number | null;
        tpsP10: number | null;
        tpsP50: number | null;
        tpsP90: number | null;
        tpsP99: number | null;
        latencyP50Ms: number | null;
        latencyP90Ms: number | null;
        latencyP99Ms: number | null;
        validTpsMessages: number;
        validLatencyMessages: number;
        totalMessages: number;
        validityRatio: number;
      }>;
      modelUsage: Array<{ label: string; count: number }>;
      modelTokenConsumption: Array<{
        model: string;
        provider: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        nonCacheInputTokens: number;
        inputTotalTokens: number;
        totalTokens: number;
      }>;
      toolUsage: Array<{ label: string; count: number }>;
      agentDistribution: Array<{ label: string; count: number }>;
      activeRepos: {
        dayHeaders: string[];
        rows: Array<{ repo: string }>;
      };
      mcpUsage: Array<{ server: string; calls: number; errors: number }>;
      toolReliabilityMatrix: Array<{ tool: string; error: number }>;
      errorPatterns: Array<{ label: string; count: number }>;
    };

    expect(body.kind).toBe("dashboard.snapshot");
    expect(body.selection).toMatchObject({
      preset: "custom",
      start: "2023-10-14",
      end: "2024-01-11",
      view: "daily",
      refreshable: true,
      bounds: {
        startDayInclusive: "2023-10-14",
        endDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
        dayCount: 90,
      },
    });
    expect(body.selection.timezone).toBeTruthy();
    expect(body.summary).toEqual({
      totalSessions: 3,
      totalTokens: 351,
      totalToolCalls: 4,
      toolErrors: 2,
      toolErrorRate: "50.0%",
      activeProjects: 2,
    });
    expect(body.recentSessions.map((session) => session.id)).toEqual([
      ROOT_SESSION_ID,
      ALERT_SESSION_ID,
      OLD_SESSION_ID,
    ]);
    expect(body.heatmapDays).not.toEqual([]);
    expect(body.heatmapDays.some((entry) => entry.count > 0)).toBe(true);
    expect(body.heatmapDays).toHaveLength(3);
    expect(body.errorTrendSeries.length).toBeGreaterThan(0);
    expect(body.errorTrendSeries[0]?.points).toHaveLength(90);
    expect(body.errorTrendHourlyBars).toEqual([]);
    expect(body.tokenTrend.dailySeries.length).toBeGreaterThan(0);
    expect(body.tokenTrend.dailySeries[0]).toMatchObject({
      points: expect.arrayContaining([
        { day: "2023-10-14", value: 0 },
        { day: "2024-01-11", value: 114 },
      ]),
    });
    expect(body.tokenTrend.dailySeries[0]?.points).toHaveLength(90);
    expect(body.tokenTrend.hourlyBars).toEqual([]);
    expect(body.activeRepos.dayHeaders).toHaveLength(90);
    expect(body.activeRepos.rows.map((row) => row.repo)).toEqual([
      "/workspace/repo-beta",
      "/workspace/repo-alpha",
    ]);
    expect(body.modelUsage).toEqual(
      expect.arrayContaining([{ label: "gpt-4.1", count: 3 }]),
    );
    expect(body.modelPerformanceStats.length).toBeGreaterThan(0);
    expect(body.modelPerformanceStats.map((entry) => entry.model)).toEqual(
      expect.arrayContaining(["gpt-4.1", "claude-3.5-sonnet"]),
    );
    expect(
      body.modelPerformanceStats.every(
        (entry) => entry.validityRatio >= 0 && entry.validityRatio <= 1,
      ),
    ).toBe(true);
    expect(
      body.modelPerformanceStats.every(
        (entry) =>
          entry.tpsP10 === null &&
          entry.tpsP90 === null &&
          entry.tpsP99 === null &&
          entry.latencyP50Ms === null &&
          entry.latencyP90Ms === null &&
          entry.latencyP99Ms === null,
      ),
    ).toBe(true);
    expect(
      body.modelPerformanceStats.every(
        (entry) => entry.avgTps == null || entry.validTpsMessages >= 5,
      ),
    ).toBe(true);
    expect(
      body.modelPerformanceStats.every(
        (entry) => entry.tpsP50 == null || entry.validTpsMessages >= 20,
      ),
    ).toBe(true);
    const sortKeys = body.modelPerformanceStats.map((entry) => ({
      hasPrimary: entry.tpsP50 == null ? 0 : 1,
      score: entry.tpsP50 ?? entry.avgTps ?? -1,
    }));
    for (let i = 1; i < sortKeys.length; i += 1) {
      const prev = sortKeys[i - 1];
      const cur = sortKeys[i];
      expect(
        prev.hasPrimary > cur.hasPrimary ||
          (prev.hasPrimary === cur.hasPrimary && prev.score >= cur.score),
      ).toBe(true);
    }
    expect(body.modelTokenConsumption.length).toBeGreaterThan(0);
    expect(body.modelTokenConsumption[0]).toMatchObject({
      model: expect.any(String),
      provider: expect.any(String),
    });
    expect(body.toolUsage).toEqual(
      expect.arrayContaining([{ label: "webfetch", count: 1 }]),
    );
    expect(body.agentDistribution).toEqual(
      expect.arrayContaining([{ label: "reviewer", count: 2 }]),
    );
    expect(
      body.mcpUsage.find((entry) => entry.server === "Builtin Tools"),
    ).toMatchObject({ calls: 3, errors: 1 });
    expect(body.mcpUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ server: "github", calls: 1, errors: 1 }),
      ]),
    );
    expect(
      body.toolReliabilityMatrix.find(
        (entry) => entry.tool === "github_search",
      ),
    ).toMatchObject({ error: 1 });
    expect(
      body.toolReliabilityMatrix.find((entry) => entry.tool === "webfetch"),
    ).toMatchObject({ error: 1 });
    expect(
      body.errorPatterns.find((entry) => entry.label === "Network/HTTP error")
        ?.count,
    ).toBe(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("<svg");
    expect(serialized).not.toContain("<div");
    expect(serialized).not.toContain(FUTURE_SESSION_ID);
  });

  test("GET /api/dashboard returns bounded day-window dashboard data", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=today&view=daily",
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      selection: {
        preset: string;
        bounds: { dayCount: number };
      };
      summary: {
        totalSessions: number;
        totalTokens: number;
        totalToolCalls: number;
        toolErrors: number;
        toolErrorRate: string;
        activeProjects: number;
      };
      recentSessions: Array<{ id: string }>;
      heatmapDays: Array<{ day: string; count: number }>;
      errorTrendSeries: Array<{
        points: Array<{ day: string; value: number }>;
      }>;
      tokenTrend: {
        dailySeries: Array<{ points: Array<{ day: string; value: number }> }>;
      };
      subagentTrend: {
        dailySeries: Array<{ points: Array<{ day: string; value: number }> }>;
      };
      activeRepos: {
        dayHeaders: string[];
        rows: Array<{ repo: string }>;
      };
      modelUsage: Array<{ label: string; count: number }>;
      modelPerformanceStats: Array<{ model: string }>;
      toolUsage: Array<{ label: string; count: number }>;
      agentDistribution: Array<{ label: string; count: number }>;
      mcpUsage: Array<{ server: string; calls: number; errors: number }>;
      toolReliabilityMatrix: Array<{ tool: string; error: number }>;
    };

    expect(body.selection).toMatchObject({
      preset: "today",
      bounds: { dayCount: 1 },
    });
    expect(body.summary).toEqual({
      totalSessions: 1,
      totalTokens: 222,
      totalToolCalls: 3,
      toolErrors: 1,
      toolErrorRate: "33.3%",
      activeProjects: 1,
    });
    expect(body.recentSessions.map((session) => session.id)).toEqual([
      ROOT_SESSION_ID,
    ]);
    expect(
      body.heatmapDays.some(
        (entry) => entry.day === "2024-01-11" && entry.count === 1,
      ),
    ).toBe(true);
    expect(body.heatmapDays.length).toBeGreaterThan(0);
    expect(body.errorTrendSeries[0]?.points).toEqual([
      { day: "2024-01-11", value: 1 },
    ]);
    expect(body.tokenTrend.dailySeries[0]?.points).toEqual([
      { day: "2024-01-11", value: 114 },
    ]);
    expect(body.subagentTrend.dailySeries[0]?.points).toEqual([
      { day: "2024-01-11", value: 2 },
    ]);
    expect(body.activeRepos.dayHeaders).toEqual(["2024-01-11"]);
    expect(body.activeRepos.rows.map((row) => row.repo)).toEqual([
      "/workspace/repo-alpha",
    ]);
    expect(body.modelUsage).toEqual(
      expect.arrayContaining([{ label: "gpt-4.1", count: 2 }]),
    );
    expect(
      body.modelPerformanceStats.map((entry) => entry.model),
    ).not.toContain("claude-3.5-sonnet");
    expect(body.toolUsage).not.toEqual(
      expect.arrayContaining([{ label: "webfetch", count: 1 }]),
    );
    expect(body.agentDistribution).not.toEqual(
      expect.arrayContaining([{ label: "reviewer", count: 1 }]),
    );
    expect(body.mcpUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          server: "Builtin Tools",
          calls: 2,
          errors: 0,
        }),
      ]),
    );
    expect(body.mcpUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ server: "github", calls: 1, errors: 1 }),
      ]),
    );
    expect(
      body.toolReliabilityMatrix.find((entry) => entry.tool === "webfetch"),
    ).toBeUndefined();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(OLD_SESSION_ID);
    expect(serialized).not.toContain(FUTURE_SESSION_ID);
  });

  test("GET /api/dashboard returns bounded week-window dashboard data", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=last7d&view=daily",
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      selection: {
        preset: string;
        bounds: { dayCount: number };
      };
      summary: {
        totalSessions: number;
        totalTokens: number;
        totalToolCalls: number;
        toolErrors: number;
        toolErrorRate: string;
        activeProjects: number;
      };
      recentSessions: Array<{ id: string }>;
      heatmapDays: Array<{ day: string; count: number }>;
      errorTrendSeries: Array<{
        points: Array<{ day: string; value: number }>;
      }>;
      tokenTrend: {
        dailySeries: Array<{ points: Array<{ day: string; value: number }> }>;
      };
      subagentTrend: {
        dailySeries: Array<{ points: Array<{ day: string; value: number }> }>;
      };
      activeRepos: {
        dayHeaders: string[];
        rows: Array<{ repo: string }>;
      };
      modelUsage: Array<{ label: string; count: number }>;
      modelPerformanceStats: Array<{ model: string }>;
      toolUsage: Array<{ label: string; count: number }>;
      agentDistribution: Array<{ label: string; count: number }>;
      mcpUsage: Array<{ server: string }>;
      toolReliabilityMatrix: Array<{ tool: string; error: number }>;
    };

    expect(body.selection).toMatchObject({
      preset: "last7d",
      bounds: { dayCount: 7 },
    });
    expect(body.summary).toEqual({
      totalSessions: 2,
      totalTokens: 327,
      totalToolCalls: 4,
      toolErrors: 2,
      toolErrorRate: "50.0%",
      activeProjects: 2,
    });
    expect(body.recentSessions.map((session) => session.id)).toEqual([
      ROOT_SESSION_ID,
      ALERT_SESSION_ID,
    ]);
    expect(
      body.heatmapDays.some(
        (entry) => entry.day === "2024-01-10" && entry.count === 1,
      ),
    ).toBe(true);
    expect(
      body.heatmapDays.some(
        (entry) => entry.day === "2024-01-11" && entry.count === 1,
      ),
    ).toBe(true);
    expect(body.heatmapDays.length).toBeGreaterThanOrEqual(2);
    expect(body.errorTrendSeries[0]?.points).toHaveLength(7);
    expect(body.tokenTrend.dailySeries[0]?.points).toHaveLength(7);
    expect(body.subagentTrend.dailySeries[0]?.points).toHaveLength(7);
    expect(body.activeRepos.dayHeaders).toHaveLength(7);
    expect(body.activeRepos.rows.map((row) => row.repo).sort()).toEqual([
      "/workspace/repo-alpha",
      "/workspace/repo-beta",
    ]);
    expect(body.modelUsage).toEqual(
      expect.arrayContaining([{ label: "claude-3.5-sonnet", count: 1 }]),
    );
    expect(body.modelPerformanceStats.map((entry) => entry.model)).toContain(
      "claude-3.5-sonnet",
    );
    expect(body.toolUsage).toEqual(
      expect.arrayContaining([{ label: "webfetch", count: 1 }]),
    );
    expect(body.agentDistribution).toEqual(
      expect.arrayContaining([{ label: "reviewer", count: 1 }]),
    );
    expect(body.mcpUsage.map((entry) => entry.server)).toEqual(
      expect.arrayContaining(["Builtin Tools", "github"]),
    );
    expect(
      body.toolReliabilityMatrix.find((entry) => entry.tool === "webfetch"),
    ).toMatchObject({ error: 1 });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(OLD_SESSION_ID);
    expect(serialized).not.toContain(FUTURE_SESSION_ID);
  });

  test("GET /api/dashboard supports hourly view semantics", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=custom&start=2023-10-14&end=2024-01-11&view=hourly",
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      selection: {
        preset: string;
        view: string;
        bounds: { dayCount: number };
      };
      errorTrendSeries: Array<unknown>;
      errorTrendHourlyBars: Array<{
        label: string;
        stacks: Array<{ name: string; value: number }>;
      }>;
      tokenTrend: {
        dailySeries: Array<unknown>;
        hourlyBars: Array<{
          label: string;
          stacks: Array<{ name: string; value: number }>;
        }>;
      };
      subagentTrend: {
        dailySeries: Array<unknown>;
        hourlyBars: Array<{
          label: string;
          stacks: Array<{ name: string; value: number }>;
        }>;
      };
    };

    expect(body.selection).toMatchObject({
      preset: "custom",
      view: "hourly",
      bounds: { dayCount: 90 },
    });
    expect(body.errorTrendSeries).toEqual([]);
    expect(body.errorTrendHourlyBars).toHaveLength(24);
    expect(totalStacks(body.errorTrendHourlyBars, "10")).toBe(2);
    expect(body.tokenTrend.dailySeries).toEqual([]);
    expect(body.tokenTrend.hourlyBars).toHaveLength(24);
    expect(stackValue(body.tokenTrend.hourlyBars, "10", "Input")).toBe(179);
    expect(stackValue(body.tokenTrend.hourlyBars, "10", "Output")).toBe(172);
    expect(body.subagentTrend.dailySeries).toEqual([]);
    expect(body.subagentTrend.hourlyBars).toHaveLength(24);
    expect(totalStacks(body.subagentTrend.hourlyBars, "10")).toBe(7);
  });

  test("GET /api/dashboard sums hourly buckets across bounded multi-day and single-day selections", async () => {
    const app = createApiApp();
    const [dayResponse, weekResponse] = await Promise.all([
      app.request("/api/dashboard?preset=today&view=hourly"),
      app.request("/api/dashboard?preset=last7d&view=hourly"),
    ]);

    expect(dayResponse.status).toBe(200);
    expect(weekResponse.status).toBe(200);

    const dayBody = (await dayResponse.json()) as {
      errorTrendHourlyBars: Array<{
        label: string;
        stacks: Array<{ name: string; value: number }>;
      }>;
      tokenTrend: {
        hourlyBars: Array<{
          label: string;
          stacks: Array<{ name: string; value: number }>;
        }>;
      };
      subagentTrend: {
        hourlyBars: Array<{
          label: string;
          stacks: Array<{ name: string; value: number }>;
        }>;
      };
    };
    const weekBody = (await weekResponse.json()) as typeof dayBody;

    expect(dayBody.errorTrendHourlyBars).toHaveLength(24);
    expect(totalStacks(dayBody.errorTrendHourlyBars, "10")).toBe(1);
    expect(stackValue(dayBody.tokenTrend.hourlyBars, "10", "Input")).toBe(114);
    expect(stackValue(dayBody.tokenTrend.hourlyBars, "10", "Output")).toBe(108);
    expect(totalStacks(dayBody.subagentTrend.hourlyBars, "10")).toBe(4);

    expect(weekBody.errorTrendHourlyBars).toHaveLength(24);
    expect(totalStacks(weekBody.errorTrendHourlyBars, "10")).toBe(2);
    expect(stackValue(weekBody.tokenTrend.hourlyBars, "10", "Input")).toBe(169);
    expect(stackValue(weekBody.tokenTrend.hourlyBars, "10", "Output")).toBe(
      158,
    );
    expect(totalStacks(weekBody.subagentTrend.hourlyBars, "10")).toBe(6);
  });

  test("GET /api/dashboard rejects inverted custom ranges", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=custom&start=2024-01-11&end=2024-01-10&view=daily",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Custom range start date must be on or before the end date.",
    });
  });

  test("GET /api/dashboard rejects custom ranges over 90 days", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=custom&start=2023-10-13&end=2024-01-11&view=daily",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Custom ranges are limited to 90 days.",
    });
  });

  test("GET /api/dashboard rejects invalid custom date formats", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard?preset=custom&start=2024-01-32&end=2024-01-11&view=daily",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "Custom range requires valid start and end dates.",
    });
  });

  test("dashboard cache reuses generation across unchanged reads", () => {
    useFixtureDb();

    const db = getWritableDb();

    try {
      const first = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: HISTORICAL_WINDOW,
      });
      const firstSnapshot = getDashboardApiCacheSnapshotForTests();

      vi.advanceTimersByTime(60_000);

      const second = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: HISTORICAL_WINDOW,
      });
      const secondSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(firstSnapshot.generation).toBeGreaterThanOrEqual(1);
      expect(firstSnapshot.sessionKeys).toEqual([
        OLD_SESSION_ID,
        ROOT_SESSION_ID,
        ALERT_SESSION_ID,
      ]);
      expect(firstSnapshot.dayKeys).toEqual([
        "2024-01-04",
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(second.generatedAt).toBe(first.generatedAt);
      expect(withoutGeneratedAt(second)).toEqual(withoutGeneratedAt(first));
      expect(secondSnapshot.generation).toBe(firstSnapshot.generation);
      expect(secondSnapshot.sessionKeys).toEqual(firstSnapshot.sessionKeys);
      expect(secondSnapshot.dayKeys).toEqual(firstSnapshot.dayKeys);
    } finally {
      db.close();
    }
  });

  test("dashboard cache rebuilds only the affected root session after append", () => {
    useFixtureDb();

    const db = getWritableDb();

    try {
      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();
      const unaffectedRecentSessions = before.recentSessions.filter(
        (session) => session.id !== ROOT_SESSION_ID,
      );
      const createdAt = new Date("2024-01-11T10:22:55.000Z").getTime();

      db.prepare(
        `
          INSERT INTO message (id, session_id, time_created, time_updated, data)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run(
        "msg-child-1-append-api-contracts",
        CHILD_SESSION_ID,
        createdAt,
        createdAt,
        JSON.stringify({
          role: "assistant",
          time: { created: createdAt, completed: createdAt + 2_000 },
          modelID: "gpt-4.1-mini",
          providerID: "openai",
          agent: "subagent-code",
          tokens: { total: 25, input: 10, output: 15 },
        }),
      );

      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(after.summary.totalSessions).toBe(before.summary.totalSessions);
      expect(after.summary.totalTokens).toBe(before.summary.totalTokens + 25);
      expect(
        after.recentSessions.filter((session) => session.id !== ROOT_SESSION_ID),
      ).toEqual(unaffectedRecentSessions);
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
      expect(afterSnapshot.sessionKeys).toEqual(beforeSnapshot.sessionKeys);
      expect(afterSnapshot.dayKeys).toEqual(beforeSnapshot.dayKeys);
    } finally {
      db.close();
    }
  });

  test("dashboard cache rebuilds the affected root after updating an existing row", () => {
    useFixtureDb();

    const db = getWritableDb();

    try {
      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();
      const beforeMiniModel = before.modelTokenConsumption.find(
        (entry) =>
          entry.model === "gpt-4.1-mini" && entry.provider === "openai",
      );
      const updatedAt = new Date("2024-01-14T11:06:00.000Z").getTime();

      db.prepare("UPDATE message SET time_updated = ?, data = ? WHERE id = ?").run(
        updatedAt,
        JSON.stringify({
          role: "assistant",
          time: {
            created: new Date("2024-01-11T10:22:38.000Z").getTime(),
            completed: new Date("2024-01-11T10:22:44.000Z").getTime(),
          },
          modelID: "gpt-4.1-mini",
          providerID: "openai",
          agent: "subagent-code",
          tokens: { total: 50, input: 20, output: 30, reasoning: 2 },
        }),
        "msg-child-1-assistant",
      );

      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();
      const afterMiniModel = after.modelTokenConsumption.find(
        (entry) =>
          entry.model === "gpt-4.1-mini" && entry.provider === "openai",
      );

      expect(beforeMiniModel?.totalTokens).toBe(30);
      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(after.summary.totalTokens).toBe(before.summary.totalTokens + 20);
      expect(afterMiniModel?.totalTokens).toBe(50);
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
      expect(afterSnapshot.sessionKeys).toEqual(beforeSnapshot.sessionKeys);
      expect(afterSnapshot.dayKeys).toEqual(beforeSnapshot.dayKeys);
    } finally {
      db.close();
    }
  });

  test("dashboard cache leaves unrelated historical windows unchanged", () => {
    useFixtureDb();

    const db = getWritableDb();

    try {
      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: HISTORICAL_WINDOW,
      });
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();
      const createdAt = new Date("2024-01-11T10:23:05.000Z").getTime();

      db.prepare(
        `
          INSERT INTO message (id, session_id, time_created, time_updated, data)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run(
        "msg-child-1-append-historical-window",
        CHILD_SESSION_ID,
        createdAt,
        createdAt,
        JSON.stringify({
          role: "assistant",
          time: { created: createdAt, completed: createdAt + 1_500 },
          modelID: "gpt-4.1-mini",
          providerID: "openai",
          agent: "subagent-code",
          tokens: { total: 18, input: 8, output: 10 },
        }),
      );

      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: HISTORICAL_WINDOW,
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(withoutGeneratedAt(after)).toEqual(withoutGeneratedAt(before));
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
      expect(afterSnapshot.sessionKeys).toEqual(beforeSnapshot.sessionKeys);
      expect(afterSnapshot.dayKeys).toEqual(beforeSnapshot.dayKeys);
    } finally {
      db.close();
    }
  });

  test("dashboard cache resets safely after a delete", () => {
    useFixtureDb();

    const db = getWritableDb();

    try {
      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: HISTORICAL_WINDOW,
      });
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();

      db.prepare("DELETE FROM session WHERE id = ?").run(OLD_SESSION_ID);

      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: HISTORICAL_WINDOW,
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(before.summary.totalSessions).toBe(1);
      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(after.summary.totalSessions).toBe(0);
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
      expect(afterSnapshot.sessionKeys).toEqual([ROOT_SESSION_ID, ALERT_SESSION_ID]);
      expect(afterSnapshot.dayKeys).toEqual(["2024-01-10", "2024-01-11"]);
    } finally {
      db.close();
    }
  });

  test("GET /api/tool-errors/:tool returns timeline and latest errors", async () => {
    const app = createApiApp();
    const response = await app.request("/api/tool-errors/github_search");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      tool: string;
      dailyErrorCounts: Array<{ day: string; count: number }>;
      latestErrors: Array<{
        timeCreated: number;
        sessionId: string;
        error: string;
      }>;
    };

    expect(body.kind).toBe("tool-errors.detail");
    expect(body.tool).toBe("github_search");
    expect(body.dailyErrorCounts).toHaveLength(30);
    expect(body.dailyErrorCounts.some((entry) => entry.count > 0)).toBe(true);
    expect(body.latestErrors).toHaveLength(1);
    expect(body.latestErrors[0]).toMatchObject({
      sessionId: ROOT_SESSION_ID,
      error: "HTTP 500 upstream",
    });
  });

  test("GET /api/tool-errors returns overview payload with insights", async () => {
    const app = createApiApp();
    const response = await app.request("/api/tool-errors");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      windowDays: number;
      summary: {
        totalErrors: number;
        distinctTools: number;
        affectedSessions: number;
      };
      insights: string[];
      topTools: Array<{ tool: string; errorCount: number; totalCalls: number }>;
      errorPatterns: Array<{ label: string; count: number }>;
      latestErrors: Array<{ tool: string; sessionId: string }>;
    };

    expect(body.kind).toBe("tool-errors.overview");
    expect(body.windowDays).toBe(30);
    expect(body.summary.totalErrors).toBeGreaterThan(0);
    expect(body.summary.distinctTools).toBeGreaterThan(0);
    expect(body.summary.affectedSessions).toBeGreaterThan(0);
    expect(body.insights.length).toBeGreaterThan(0);
    expect(body.topTools.length).toBeGreaterThan(0);
    expect(body.errorPatterns.length).toBeGreaterThan(0);
    expect(body.latestErrors.length).toBeGreaterThan(0);
    expect(body.latestErrors[0]?.tool).toBeTruthy();
  });

  test("GET /api/tool-errors/nonexistent returns safe empty payload", async () => {
    const app = createApiApp();
    const response = await app.request("/api/tool-errors/nonexistent");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      tool: string;
      dailyErrorCounts: Array<{ count: number }>;
      latestErrors: Array<unknown>;
    };

    expect(body.tool).toBe("nonexistent");
    expect(body.dailyErrorCounts).toHaveLength(30);
    expect(body.dailyErrorCounts.every((entry) => entry.count === 0)).toBe(
      true,
    );
    expect(body.latestErrors).toEqual([]);
  });

  test("POST /mcp initializes an MCP session", async () => {
    const app = createApiApp();
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result: {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
        capabilities: Record<string, unknown>;
      };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("opencode-observability");
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.capabilities.resources).toBeTruthy();
  });

  test("POST /mcp supports tools/list and resources/list", async () => {
    const app = createApiApp();

    const toolsResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(toolsResponse.status).toBe(200);
    const toolsBody = (await toolsResponse.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(toolsBody.result.tools.map((tool) => tool.name)).toEqual([
      "list_repo_groups",
      "list_sessions",
      "search_sessions",
      "get_context_window",
    ]);

    const resourcesResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/list",
        params: {},
      }),
    });

    expect(resourcesResponse.status).toBe(200);
    const resourcesBody = (await resourcesResponse.json()) as {
      result: { resources: Array<{ uri: string }> };
    };
    expect(
      resourcesBody.result.resources.map((resource) => resource.uri),
    ).toEqual(["opencode://directories"]);
  });

  test("POST /api/mcp supports resources/templates/list for dynamic readable URIs", async () => {
    const app = createApiApp();
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3.1,
        method: "resources/templates/list",
        params: {},
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { resourceTemplates: Array<{ uriTemplate: string }> };
    };
    expect(
      body.result.resourceTemplates.map((template) => template.uriTemplate),
    ).toEqual([
      "opencode://sessions?worktree={worktree}",
      "opencode://sessions/{sessionId}/messages",
      "opencode://messages/{messageId}",
      "opencode://parts/{partId}",
    ]);
  });

  test("POST /mcp supports tool calls over existing directories/export services", async () => {
    const app = createApiApp();
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "list_sessions",
          arguments: { worktree: "/workspace/repo-alpha" },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        isError: boolean;
        structuredContent: {
          items: Array<{ sessionId: string; worktree: string }>;
        };
      };
    };
    expect(body.result.isError).toBe(false);
    expect(
      body.result.structuredContent.items.map((item) => item.sessionId),
    ).toEqual([FUTURE_SESSION_ID, ROOT_SESSION_ID]);
    expect(
      body.result.structuredContent.items.every(
        (item) => item.worktree === "/workspace/repo-alpha",
      ),
    ).toBe(true);
  });

  test("POST /mcp supports resources/read for directories and session messages", async () => {
    const app = createApiApp();

    const directoriesResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "resources/read",
        params: { uri: "opencode://directories" },
      }),
    });

    expect(directoriesResponse.status).toBe(200);
    const directoriesBody = (await directoriesResponse.json()) as {
      result: {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };
    };
    expect(directoriesBody.result.contents[0]?.uri).toBe(
      "opencode://directories",
    );
    expect(directoriesBody.result.contents[0]?.mimeType).toBe(
      "application/json",
    );
    expect(directoriesBody.result.contents[0]?.text).toContain(
      "directories.list",
    );

    const messagesResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: `opencode://sessions/${ROOT_SESSION_ID}/messages` },
      }),
    });

    expect(messagesResponse.status).toBe(200);
    const messagesBody = (await messagesResponse.json()) as {
      result: {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };
    };
    expect(messagesBody.result.contents[0]?.uri).toBe(
      `opencode://sessions/${ROOT_SESSION_ID}/messages`,
    );
    expect(messagesBody.result.contents[0]?.text).toContain(
      "msg-root-1-assistant-1",
    );
  });

  test("POST /api/mcp supports additional readable resource URIs", async () => {
    const app = createApiApp();

    const messageResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "resources/read",
        params: { uri: "opencode://messages/msg-root-1-assistant-1" },
      }),
    });

    expect(messageResponse.status).toBe(200);
    const messageBody = (await messageResponse.json()) as {
      result: { contents: Array<{ uri: string; text: string }> };
    };
    expect(messageBody.result.contents[0]?.uri).toBe(
      "opencode://messages/msg-root-1-assistant-1",
    );
    expect(messageBody.result.contents[0]?.text).toContain(
      "msg-root-1-assistant-1",
    );

    const partResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "resources/read",
        params: { uri: "opencode://parts/prt_root_assistant_1_reasoning" },
      }),
    });

    expect(partResponse.status).toBe(200);
    const partBody = (await partResponse.json()) as {
      result: { contents: Array<{ uri: string; text: string }> };
    };
    expect(partBody.result.contents[0]?.uri).toBe(
      "opencode://parts/prt_root_assistant_1_reasoning",
    );
    expect(partBody.result.contents[0]?.text).toContain(
      "prt_root_assistant_1_reasoning",
    );
  });

  test("POST /api/mcp search_sessions uses only the implemented query argument", async () => {
    const app = createApiApp();
    const toolsResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/list",
        params: {},
      }),
    });

    const toolsBody = (await toolsResponse.json()) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: { properties: Record<string, unknown> };
        }>;
      };
    };
    const searchTool = toolsBody.result.tools.find(
      (tool) => tool.name === "search_sessions",
    );
    expect(searchTool).toBeTruthy();
    expect(Object.keys(searchTool?.inputSchema.properties ?? {})).toEqual([
      "q",
    ]);

    const searchResponse = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "search_sessions",
          arguments: { q: "alerting" },
        },
      }),
    });

    expect(searchResponse.status).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      result: {
        isError: boolean;
        structuredContent: { results: Array<{ id: string }> };
      };
    };
    expect(searchBody.result.isError).toBe(false);
    expect(
      searchBody.result.structuredContent.results.map((row) => row.id),
    ).toContain(ALERT_SESSION_ID);
  });
});
