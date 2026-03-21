import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { createApiApp } from "../../src/server/app.js";
import { MONITOR_SSE_HEARTBEAT_INTERVAL_MS } from "../../src/server/monitor-api.js";
import { resetMonitorRuntimeStoreForTest } from "../../src/server/monitor-runtime-store.js";
import {
  ALERT_SESSION_ID,
  CHILD_SESSION_ID,
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

type SseMessage = {
  event: string;
  data: string;
};

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

describe("server api contracts", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-11T11:06:00.000Z"));
    useFixtureDb();
  });

  beforeEach(() => {
    resetMonitorRuntimeStoreForTest();
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
      activeRootSessions: Array<{ id: string; signalLevel: string }>;
      compactionCounts: { main: number; subagent: number; total: number };
      signalBadges: Array<{ key: string; count: number }>;
    };

    expect(body.kind).toBe("monitor.snapshot");
    expect(body.activeRootSessions).toHaveLength(1);
    expect(body.activeRootSessions.map((session) => session.id)).toEqual([
      ALERT_SESSION_ID,
    ]);
    expect(
      body.activeRootSessions.map((session) => session.signalLevel),
    ).toEqual(["error"]);
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
      activeRootSessions: Array<{ id: string; signalLevel: string }>;
      signalBadges: Array<{ key: string; count: number }>;
    };

    expect(body.activeRootSessions.map((session) => session.id)).toEqual([
      ROOT_SESSION_ID,
    ]);
    expect(
      body.signalBadges.find((badge) => badge.key === "active")?.count,
    ).toBe(1);
    expect(
      body.activeRootSessions.map((session) => session.signalLevel),
    ).toEqual(["success"]);
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
          sessionCount: number;
        }>;
      }>;
    };

    expect(body.kind).toBe("directories.list");
    expect(body.repoGroups.map((group) => group.rawWorktree)).toEqual([
      "/workspace/repo-beta",
      "/workspace/repo-alpha",
    ]);
    expect(body.repoGroups[0].directories).toEqual([
      {
        rawDirectory: "/workspace/repo-beta/packages/api",
        prettyDirectory: "/workspace/repo-beta/packages/api",
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
      todos: Array<{
        content: string;
        status: string;
        priority: string;
      }>;
      summaryDiffs: string | null;
    };

    expect(body.kind).toBe("session.detail");
    expect(body.session).toMatchObject({
      id: ROOT_SESSION_ID,
      title: "Root monitor session",
      parentId: null,
    });
    expect(body.tokens).toEqual({
      total: 180,
      input: 100,
      output: 80,
      reasoning: 20,
      cacheRead: 40,
      cacheWrite: 5,
      cost: 0.16999999999999998,
    });
    expect(body.modelBreakdown).toHaveLength(1);
    expect(body.modelBreakdown[0]).toEqual({
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
    });
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

  test("GET /api/dashboard returns the dashboard contract shape", async () => {
    const app = createApiApp();
    const response = await app.request("/api/dashboard?range=all&view=daily");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      kind: string;
      range: string;
      view: string;
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
      tokenTrend: {
        inputRatioPercent: number;
        dailySeries: Array<unknown>;
        hourlyBars: Array<unknown>;
      };
      mcpUsage: Array<{ server: string; calls: number; errors: number }>;
      toolReliabilityMatrix: Array<{ tool: string; error: number }>;
      errorPatterns: Array<{ label: string; count: number }>;
    };

    expect(body.kind).toBe("dashboard.snapshot");
    expect(body.range).toBe("all");
    expect(body.view).toBe("daily");
    expect(body.summary).toEqual({
      totalSessions: 2,
      totalTokens: 327,
      totalToolCalls: 4,
      toolErrors: 2,
      toolErrorRate: "50.0%",
      activeProjects: 2,
    });
    expect(body.recentSessions.map((session) => session.id)).toEqual([
      ALERT_SESSION_ID,
      ROOT_SESSION_ID,
    ]);
    expect(body.heatmapDays).not.toEqual([]);
    expect(body.heatmapDays.some((entry) => entry.count > 0)).toBe(true);
    expect(body.tokenTrend.dailySeries.length).toBeGreaterThan(0);
    expect(body.tokenTrend.hourlyBars).toEqual([]);
    expect(
      body.mcpUsage.find((entry) => entry.server === "Builtin Tools"),
    ).toMatchObject({ calls: 3, errors: 1 });
    expect(
      body.toolReliabilityMatrix.find(
        (entry) => entry.tool === "github_search",
      ),
    ).toMatchObject({ error: 1 });
    expect(
      body.errorPatterns.find((entry) => entry.label === "Network/HTTP error")
        ?.count,
    ).toBe(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("<svg");
    expect(serialized).not.toContain("<div");
  });

  test("GET /api/dashboard supports hourly view semantics", async () => {
    const app = createApiApp();
    const response = await app.request("/api/dashboard?range=all&view=hourly");

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      range: string;
      view: string;
      tokenTrend: { dailySeries: Array<unknown>; hourlyBars: Array<unknown> };
      subagentTrend: {
        dailySeries: Array<unknown>;
        hourlyBars: Array<unknown>;
      };
    };

    expect(body.range).toBe("all");
    expect(body.view).toBe("hourly");
    expect(body.tokenTrend.dailySeries).toEqual([]);
    expect(body.tokenTrend.hourlyBars).toHaveLength(24);
    expect(body.subagentTrend.dailySeries).toEqual([]);
    expect(body.subagentTrend.hourlyBars).toHaveLength(24);
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
});
