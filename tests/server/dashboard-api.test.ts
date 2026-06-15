import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  DashboardActivityContract,
  DashboardModelsContract,
  DashboardOverviewContract,
  DashboardToolsContract,
} from "../../src/contracts/dashboard.js";
import { normalizeDashboardSelectionInput } from "../../src/lib/dashboard-time.js";
import { getDb } from "../../src/lib/db.js";
import type { Database } from "../../src/lib/sqlite.js";
import { createApiApp } from "../../src/server/app.js";
import { resetDashboardGatewayForTests } from "../../src/server/dashboard-api.js";
import { InlineDashboardGateway } from "../../src/services/dashboard/inline-gateway.js";
import {
  ALERT_SESSION_ID,
  FUTURE_SESSION_ID,
  OLD_SESSION_ID,
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

const FIXTURE_NOW = new Date("2024-01-11T11:06:00.000Z");
const NOW_MS = FIXTURE_NOW.getTime();

function selection(view: "daily" | "hourly" = "daily") {
  const result = normalizeDashboardSelectionInput(
    { preset: "custom", start: "2023-10-14", end: "2024-01-11", view },
    FIXTURE_NOW,
  );
  if (!result.ok) throw new Error(result.message);
  return result.selection;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  useFixtureDb();
  resetDashboardGatewayForTests();
});

afterEach(() => {
  resetDashboardGatewayForTests();
});

afterAll(() => {
  restoreDbPath();
  vi.useRealTimers();
});

describe("GET /api/dashboard/* routes", () => {
  test("overview returns ready session-sourced summary, heatmap, recents", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard/overview?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as DashboardOverviewContract;
    expect(body.kind).toBe("dashboard.overview");
    expect(body.meta.rollup.state).toBe("ready");
    expect(body.selection.bounds.dayCount).toBe(90);
    expect(body.summary).toEqual({
      totalSessions: 3,
      totalTokens: 354,
      totalCost: 0.29000000000000004,
      activeProjects: 2,
    });
    // recentSessions: 5 most recently updated roots, window-independent, so the
    // future-dated root is included.
    expect(body.recentSessions.map((s) => s.id)).toEqual([
      FUTURE_SESSION_ID,
      ROOT_SESSION_ID,
      ALERT_SESSION_ID,
      OLD_SESSION_ID,
    ]);
    expect(
      body.recentSessions.find((s) => s.id === ROOT_SESSION_ID)?.totalTokens,
    ).toBe(222);
    expect(body.heatmapDays).toEqual([
      { day: "2024-01-04", count: 1 },
      { day: "2024-01-10", count: 1 },
      { day: "2024-01-11", count: 1 },
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("<svg");
    expect(serialized).not.toContain("summary_diffs");
  });

  test("activity returns ready token + subagent trends", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard/activity?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as DashboardActivityContract;
    expect(body.kind).toBe("dashboard.activity");
    if (body.state !== "ready") throw new Error("expected ready");
    const input = body.data.tokenTrend.dailySeries.find(
      (s) => s.label === "Input",
    );
    expect(input?.points).toHaveLength(90);
    expect(input?.points.find((p) => p.day === "2024-01-11")?.value).toBe(114);
    expect(body.data.subagentTrend.dailySeries.length).toBeGreaterThan(0);
    // Active Repositories cross-table ships in the activity payload.
    expect(body.data.activeRepos.dayHeaders).toHaveLength(90);
    expect(body.data.activeRepos.rows.map((row) => row.repo)).toEqual([
      "/workspace/repo-beta",
      "/workspace/repo-alpha",
    ]);
  });

  test("models returns ready usage, consumption, and performance", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard/models?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as DashboardModelsContract;
    if (body.state !== "ready") throw new Error("expected ready");
    expect(body.data.modelUsage).toEqual(
      expect.arrayContaining([{ label: "gpt-4.1", count: 3 }]),
    );
    expect(body.data.modelPerformanceStats.map((r) => r.model)).toEqual(
      expect.arrayContaining(["gpt-4.1", "claude-3.5-sonnet"]),
    );
  });

  test("tools carries the part-sourced tool metrics moved out of summary", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard/tools?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as DashboardToolsContract;
    if (body.state !== "ready") throw new Error("expected ready");
    expect(body.data.totalToolCalls).toBe(4);
    expect(body.data.toolErrors).toBe(2);
    expect(body.data.toolErrorRate).toBe("50.0%");
    expect(body.data.toolUsage).toEqual(
      expect.arrayContaining([{ label: "webfetch", count: 1 }]),
    );
    expect(
      body.data.toolReliabilityMatrix.find((r) => r.tool === "github_search"),
    ).toMatchObject({ error: 1 });
  });

  test("tools hourly view returns hourly error bars instead of daily series", async () => {
    const app = createApiApp();
    const response = await app.request(
      "/api/dashboard/tools?preset=custom&start=2023-10-14&end=2024-01-11&view=hourly",
    );
    const body = (await response.json()) as DashboardToolsContract;
    if (body.state !== "ready") throw new Error("expected ready");
    expect(body.data.errorTrendSeries).toEqual([]);
    expect(body.data.errorTrendHourlyBars).toHaveLength(24);
    const bar = body.data.errorTrendHourlyBars.find((b) => b.label === "10");
    expect(bar?.stacks.reduce((sum, s) => sum + s.value, 0)).toBe(2);
  });

  test("rejects invalid custom ranges with 400", async () => {
    const app = createApiApp();

    const inverted = await app.request(
      "/api/dashboard/overview?preset=custom&start=2024-01-11&end=2024-01-10&view=daily",
    );
    expect(inverted.status).toBe(400);
    await expect(inverted.json()).resolves.toEqual({
      message: "Custom range start date must be on or before the end date.",
    });

    const tooLong = await app.request(
      "/api/dashboard/activity?preset=custom&start=2023-10-13&end=2024-01-11&view=daily",
    );
    expect(tooLong.status).toBe(400);
    await expect(tooLong.json()).resolves.toEqual({
      message: "Custom ranges are limited to 90 days.",
    });
  });

  test("heavy endpoints report building before atoms warm up, then ready", () => {
    // Drive an InlineGateway with autoDrain disabled to observe the transition.
    const db: Database = getDb();
    try {
      const gateway = new InlineDashboardGateway(db, {
        autoDrain: false,
        chunkSize: 1,
        now: () => NOW_MS,
      });

      const building = gateway.getActivity(selection());
      expect(building.state).toBe("building");
      if (building.state === "building") {
        expect(building.progressPercent).toBeGreaterThanOrEqual(0);
        expect(building.progressPercent).toBeLessThan(100);
      }

      // pumpWork advances the pipeline one bounded unit at a time (stamp batch,
      // then build chunks).
      let guard = 0;
      while (gateway.pumpWork()) {
        if (++guard > 50) throw new Error("build did not terminate");
      }

      const ready = gateway.getActivity(selection());
      expect(ready.state).toBe("ready");
      if (ready.state === "ready") {
        expect(ready.data.tokenTrend.dailySeries.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });

  test("overview reflects a session deletion automatically on the next request", async () => {
    const app = createApiApp();

    const before = (await (
      await app.request(
        "/api/dashboard/overview?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
      )
    ).json()) as DashboardOverviewContract;
    expect(before.summary.totalSessions).toBe(3);
    const beforeGeneration = before.meta.generation;

    const deleteResponse = await app.request(
      `/api/sessions/opencode/${ROOT_SESSION_ID}`,
      {
        method: "DELETE",
        headers: { "x-opencode-confirm-delete": ROOT_SESSION_ID },
      },
    );
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ deleted: 2 });

    const after = (await (
      await app.request(
        "/api/dashboard/overview?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
      )
    ).json()) as DashboardOverviewContract;
    expect(after.summary.totalSessions).toBe(2);
    expect(after.recentSessions.map((s) => s.id)).not.toContain(
      ROOT_SESSION_ID,
    );
    // Eviction bumps the rollup generation so heavy endpoints re-fetch.
    expect(after.meta.generation).toBeGreaterThan(beforeGeneration);

    const models = (await (
      await app.request(
        "/api/dashboard/models?preset=custom&start=2023-10-14&end=2024-01-11&view=daily",
      )
    ).json()) as DashboardModelsContract;
    if (models.state !== "ready") throw new Error("expected ready");
    // gpt-4.1 usage drops from 3 to 1 once the deleted root's atom is evicted.
    expect(
      models.data.modelUsage.find((row) => row.label === "gpt-4.1")?.count,
    ).toBe(1);
    expect(OLD_SESSION_ID).toBeDefined();
  });
});
