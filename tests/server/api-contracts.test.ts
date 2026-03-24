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
import * as dashboardService from "../../src/services/dashboard/dashboard-service.js";
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
      "/workspace/repo-alpha",
      "/workspace/repo-beta",
    ]);
    expect(body.repoGroups[0].directories).toEqual([
      {
        rawDirectory: "/workspace/repo-alpha",
        prettyDirectory: "/workspace/repo-alpha",
        sessionCount: 1,
      },
      {
        rawDirectory: "/workspace/repo-alpha/future",
        prettyDirectory: "/workspace/repo-alpha/future",
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
    expect(body.durationMs).toBeGreaterThan(0);
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
      modelPerformance: Array<{ label: string; count: number }>;
      modelPerformanceStats: Array<{
        model: string;
        avgTps: number | null;
        tpsP10: number | null;
        tpsP50: number | null;
        validTpsMessages: number;
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
    expect(body.modelPerformance.length).toBeGreaterThan(0);
    expect(body.modelPerformance.map((entry) => entry.label)).toEqual(
      expect.arrayContaining(["gpt-4.1", "claude-3.5-sonnet"]),
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
        (entry) => entry.tpsP10 == null || entry.tpsP10 >= 0,
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
      modelPerformance: Array<{ label: string }>;
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
    expect(body.modelPerformance.map((entry) => entry.label)).not.toContain(
      "claude-3.5-sonnet",
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
      modelPerformance: Array<{ label: string }>;
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
    expect(body.modelPerformance.map((entry) => entry.label)).toContain(
      "claude-3.5-sonnet",
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

  test("dashboard cache hydrates bounded all-window day buckets on first load", () => {
    useFixtureDb();

    const db = getWritableDb();
    const buildSpy = vi.spyOn(
      dashboardService,
      "buildDashboardAggregateStateForWindow",
    );

    try {
      const body = readDashboardSnapshot(db, { range: "all", view: "daily" });

      expect(body.summary.totalSessions).toBe(3);
      expect(buildSpy).toHaveBeenCalledTimes(90);
      expect(
        buildSpy.mock.calls.some(([, windowArg]) => {
          const window = windowArg as {
            startDayInclusive: string;
            endDayExclusive: string;
          };
          return (
            window.startDayInclusive === "2023-10-14" &&
            window.endDayExclusive === "2023-10-15"
          );
        }),
      ).toBe(true);
      expect(
        buildSpy.mock.calls.some(([, windowArg]) => {
          const window = windowArg as {
            startDayInclusive: string;
            endDayExclusive: string;
          };
          return (
            window.startDayInclusive === "2024-01-11" &&
            window.endDayExclusive === "2024-01-12"
          );
        }),
      ).toBe(true);
      const snapshot = getDashboardApiCacheSnapshotForTests();
      expect(snapshot.rawKeys).toHaveLength(90);
      expect(snapshot.rawKeys[0]).toBe("2023-10-14");
      expect(snapshot.rawKeys.at(-1)).toBe("2024-01-11");
    } finally {
      buildSpy.mockRestore();
      db.close();
    }
  });

  test("dashboard cache reuses day buckets across overlapping bounded windows", () => {
    useFixtureDb();

    const db = getWritableDb();
    const buildSpy = vi.spyOn(
      dashboardService,
      "buildDashboardAggregateStateForWindow",
    );

    try {
      const weekBody = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      const allBody = readDashboardSnapshot(db, {
        range: "all",
        view: "daily",
      });

      expect(weekBody.summary.totalSessions).toBe(2);
      expect(allBody.summary.totalSessions).toBe(3);
      expect(buildSpy).toHaveBeenCalledTimes(90);
      const weekDayBuilds = buildSpy.mock.calls.filter(([, windowArg]) => {
        const window = windowArg as {
          startDayInclusive: string;
          endDayExclusive: string;
        };
        return (
          window.startDayInclusive === "2024-01-05" &&
          window.endDayExclusive === "2024-01-06"
        );
      });
      expect(weekDayBuilds).toHaveLength(1);

      const snapshot = getDashboardApiCacheSnapshotForTests();
      expect(snapshot.rawKeys).toHaveLength(90);
      expect(snapshot.rawKeys[0]).toBe("2023-10-14");
      expect(snapshot.rawKeys.at(-1)).toBe("2024-01-11");
    } finally {
      buildSpy.mockRestore();
      db.close();
    }
  });

  test("dashboard cache refreshes live windows every 30 seconds but keeps fixed historical windows stable", () => {
    useFixtureDb();

    const db = getWritableDb();
    const updateSpy = vi.spyOn(
      dashboardService,
      "updateDashboardAggregateStateForWindow",
    );

    try {
      const liveFirst = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      vi.advanceTimersByTime(29_000);
      const liveSecond = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });
      vi.advanceTimersByTime(2_000);
      const liveThird = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
      });

      const historicalWindow = {
        startDayInclusive: "2024-01-04",
        endDayExclusive: "2024-01-05",
      };
      const historicalFirst = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: historicalWindow,
      });
      vi.advanceTimersByTime(31_000);
      const historicalSecond = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: historicalWindow,
      });

      expect(liveFirst.generatedAt).toBe(liveSecond.generatedAt);
      expect(liveThird.generatedAt).not.toBe(liveSecond.generatedAt);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        db,
        expect.any(Object),
        expect.objectContaining({
          startDayInclusive: "2024-01-11",
          endDayExclusive: "2024-01-12",
        }),
      );

      expect(historicalFirst.generatedAt).toBe(historicalSecond.generatedAt);
    } finally {
      updateSpy.mockRestore();
      db.close();
    }
  });

  test("dashboard cache clears when session count drops", () => {
    useFixtureDb();

    const db = getWritableDb();

    try {
      const window = {
        startDayInclusive: "2024-01-04",
        endDayExclusive: "2024-01-05",
      };
      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      expect(before.summary.totalSessions).toBe(1);
      expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
        "2024-01-04",
      ]);

      db.prepare("DELETE FROM session WHERE id = ?").run(OLD_SESSION_ID);
      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      expect(after.summary.totalSessions).toBe(0);
      expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
        "2024-01-04",
      ]);
      expect(after.generatedAt).not.toBe(before.generatedAt);
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
});
