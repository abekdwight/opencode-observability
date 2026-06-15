import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { normalizeDashboardSelectionInput } from "../../src/lib/dashboard-time.js";
import { getDb, getWritableDb } from "../../src/lib/db.js";
import type { Database } from "../../src/lib/sqlite.js";
import { DashboardAggregator } from "../../src/services/dashboard/aggregator/aggregator.js";
import { classifyError } from "../../src/services/dashboard/aggregator/session-atom.js";
import {
  ERROR_TREND_COLORS,
  SERIES_COLORS,
} from "../../src/services/dashboard/projection/shared.js";
import {
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

let db: Database;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  useFixtureDb();
});

afterEach(() => {
  db?.close();
  restoreDbPath();
  vi.useRealTimers();
});

describe("classifyError", () => {
  test("maps known signatures to stable categories (order matters)", () => {
    expect(classifyError("")).toBe("Unknown");
    expect(classifyError("ENOENT: no such file")).toBe("File not found");
    expect(classifyError("Tool execution aborted")).toBe("Aborted");
    expect(classifyError("request timed out")).toBe("Timeout");
    expect(classifyError("HTTP 500 upstream")).toBe("Network/HTTP error");
    expect(classifyError("patch conflict while applying diff")).toBe(
      "Patch failed",
    );
    expect(classifyError("permission denied")).toBe("Permission denied");
    expect(classifyError("unexpected token in JSON")).toBe("Parse error");
    expect(classifyError("totally novel failure")).toBe("Other");
  });
});

describe("dashboard projections (semantics preservation)", () => {
  test("model performance respects TPS validity thresholds", () => {
    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const rows = aggregator.projectModelsFor(selection()).modelPerformanceStats;
    expect(rows.length).toBeGreaterThan(0);
    // Every row has at least one TPS-valid message (the filter), and validity
    // ratio stays in [0, 1]. Each statistic is null unless its sample gate is
    // met (the small fixture stays below every gate, so all are null here).
    for (const row of rows) {
      expect(row.validTpsMessages).toBeGreaterThan(0);
      expect(row.validityRatio).toBeGreaterThanOrEqual(0);
      expect(row.validityRatio).toBeLessThanOrEqual(1);
      expect(row.avgTps == null || row.validTpsMessages >= 5).toBe(true);
      expect(row.tpsP10 == null || row.validTpsMessages >= 20).toBe(true);
      expect(row.tpsP50 == null || row.validTpsMessages >= 20).toBe(true);
      expect(row.tpsP90 == null || row.validTpsMessages >= 20).toBe(true);
      expect(row.tpsP99 == null || row.validTpsMessages >= 100).toBe(true);
      expect(row.latencyP50Ms == null || row.validLatencyMessages >= 20).toBe(
        true,
      );
      expect(row.latencyP90Ms == null || row.validLatencyMessages >= 20).toBe(
        true,
      );
      expect(row.latencyP99Ms == null || row.validLatencyMessages >= 100).toBe(
        true,
      );
    }
  });

  test("model token consumption uses max(reported, reconstructed) total and sorts desc", () => {
    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const rows = aggregator.projectModelsFor(selection()).modelTokenConsumption;
    const totals = rows.map((row) => row.totalTokens);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    const gpt = rows.find((row) => row.model === "gpt-4.1");
    expect(gpt).toBeDefined();
    expect(gpt?.totalTokens).toBeGreaterThanOrEqual(
      (gpt?.inputTotalTokens ?? 0) + (gpt?.outputTokens ?? 0),
    );
  });

  test("error patterns classify and aggregate tool errors", () => {
    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const tools = aggregator.projectToolsFor(selection());
    expect(tools.errorPatterns).toEqual(
      expect.arrayContaining([
        { label: "Network/HTTP error", count: 1 },
        { label: "Patch failed", count: 1 },
      ]),
    );
    // mcpUsage rolls builtins under a single "Builtin Tools" row.
    expect(
      tools.mcpUsage.find((row) => row.server === "Builtin Tools"),
    ).toMatchObject({ calls: 3, errors: 1, isBuiltin: true });
    expect(tools.mcpUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ server: "github", calls: 1, errors: 1 }),
      ]),
    );
  });

  test("activity daily series use stable input/output colors", () => {
    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const activity = aggregator.projectActivityFor(selection());
    expect(
      activity.tokenTrend.dailySeries.map((s) => [s.label, s.color]),
    ).toEqual([
      ["Input", "#1565c0"],
      ["Output", "#2e7d32"],
    ]);
  });

  test("folds error-trend tools beyond the top 5 into an Other series", () => {
    // Insert seven distinct error-producing tools on the root session so the
    // top-5 + Other fold is exercised.
    const writable = getWritableDb();
    try {
      const baseTime = new Date("2024-01-11T10:30:00.000Z").getTime();
      for (let i = 0; i < 7; i++) {
        writable
          .prepare(
            `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `part-toolfold-${i}`,
            "msg-root-1-assistant-1",
            ROOT_SESSION_ID,
            baseTime + i * 1_000,
            baseTime + i * 1_000,
            JSON.stringify({
              type: "tool",
              tool: `mcpserver${i}_call`,
              state: { status: "error", error: `synthetic failure ${i}` },
            }),
          );
      }
    } finally {
      writable.close();
    }

    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const tools = aggregator.projectToolsFor(selection());
    const labels = tools.errorTrendSeries.map((series) => series.label);
    expect(labels).toContain("Other");
    // Top series get the first ERROR_TREND_COLORS entries in order.
    expect(tools.errorTrendSeries[0]?.color).toBe(ERROR_TREND_COLORS[0]);
    const otherSeries = tools.errorTrendSeries.find((s) => s.label === "Other");
    expect(otherSeries).toBeDefined();
  });

  test("subagent trend folds agents beyond top 5 with the Other color", () => {
    const writable = getWritableDb();
    try {
      const baseTime = new Date("2024-01-11T10:40:00.000Z").getTime();
      for (let i = 0; i < 7; i++) {
        writable
          .prepare(
            `INSERT INTO message (id, session_id, time_created, time_updated, data)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            `msg-agentfold-${i}`,
            ROOT_SESSION_ID,
            baseTime + i * 1_000,
            baseTime + i * 1_000,
            JSON.stringify({
              role: "assistant",
              time: { created: baseTime + i * 1_000 },
              modelID: "gpt-4.1",
              providerID: "openai",
              agent: `agent-${i}`,
              tokens: { total: 1, input: 1, output: 0 },
            }),
          );
      }
    } finally {
      writable.close();
    }

    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const activity = aggregator.projectActivityFor(selection());
    const labels = activity.subagentTrend.dailySeries.map((s) => s.label);
    expect(labels).toContain("Other");
    const otherSeries = activity.subagentTrend.dailySeries.find(
      (s) => s.label === "Other",
    );
    expect(otherSeries?.color).toBe(SERIES_COLORS[5]);
  });
});

describe("dashboard activeRepos projection", () => {
  function insertProject(
    writable: ReturnType<typeof getWritableDb>,
    id: string,
    worktree: string,
  ): void {
    writable
      .prepare(
        `INSERT INTO project (
          id, worktree, vcs, name, icon_url, icon_color,
          time_created, time_updated, time_initialized, sandboxes, commands
        ) VALUES (?, ?, 'git', ?, NULL, '#000000', ?, ?, ?, '[]', NULL)`,
      )
      .run(id, worktree, id, NOW_MS, NOW_MS, NOW_MS);
  }

  function insertRoot(
    writable: ReturnType<typeof getWritableDb>,
    id: string,
    projectId: string,
    directory: string,
    timeCreated: number,
  ): void {
    writable
      .prepare(
        `INSERT INTO session (
          id, project_id, parent_id, slug, directory, title, version, share_url,
          summary_additions, summary_deletions, summary_files, summary_diffs,
          revert, permission, time_created, time_updated, time_compacting,
          time_archived, workspace_id
        ) VALUES (?, ?, NULL, ?, ?, ?, '1', NULL, 0, 0, 0, NULL, NULL, NULL,
          ?, ?, NULL, NULL, NULL)`,
      )
      .run(id, projectId, id, directory, id, timeCreated, timeCreated);
  }

  function insertMessage(
    writable: ReturnType<typeof getWritableDb>,
    id: string,
    sessionId: string,
    timeCreated: number,
    data: Record<string, unknown>,
  ): void {
    writable
      .prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, timeCreated, timeCreated, JSON.stringify(data));
  }

  test("ranks repos by sessions, formats durations, and falls back to counts", () => {
    // gamma: a root with two assistant turns 5 minutes apart -> "5m" duration.
    // delta: a root with a single user message -> no duration, count fallback.
    const dayStart = new Date("2024-01-11T09:00:00.000Z").getTime();
    const FIVE_MIN = 5 * 60_000;

    const writable = getWritableDb();
    try {
      insertProject(writable, "proj-gamma", "/workspace/repo-gamma");
      insertProject(writable, "proj-delta", "/workspace/repo-delta");

      insertRoot(
        writable,
        "ses-gamma-root",
        "proj-gamma",
        "/workspace/repo-gamma",
        dayStart,
      );
      insertMessage(writable, "msg-gamma-1", "ses-gamma-root", dayStart, {
        role: "assistant",
        time: { created: dayStart, completed: dayStart + 1_000 },
        modelID: "gpt-4.1",
        providerID: "openai",
        tokens: { total: 10, input: 6, output: 4 },
      });
      insertMessage(
        writable,
        "msg-gamma-2",
        "ses-gamma-root",
        dayStart + FIVE_MIN,
        {
          role: "assistant",
          time: {
            created: dayStart + FIVE_MIN,
            completed: dayStart + FIVE_MIN + 1_000,
          },
          modelID: "gpt-4.1",
          providerID: "openai",
          tokens: { total: 10, input: 6, output: 4 },
        },
      );

      insertRoot(
        writable,
        "ses-delta-root",
        "proj-delta",
        "/workspace/repo-delta",
        dayStart,
      );
      insertMessage(writable, "msg-delta-1", "ses-delta-root", dayStart, {
        role: "user",
        time: { created: dayStart },
      });
    } finally {
      writable.close();
    }

    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const { activeRepos } = aggregator.projectActivityFor(selection());

    // dayHeaders cover the full 90-day window inclusively.
    expect(activeRepos.dayHeaders).toHaveLength(90);
    expect(activeRepos.dayHeaders[0]).toBe("2023-10-14");
    expect(activeRepos.dayHeaders.at(-1)).toBe("2024-01-11");

    const gamma = activeRepos.rows.find(
      (row) => row.repo === "/workspace/repo-gamma",
    );
    const delta = activeRepos.rows.find(
      (row) => row.repo === "/workspace/repo-delta",
    );
    expect(gamma).toBeDefined();
    expect(delta).toBeDefined();

    // gamma: the 5-minute inter-message gap renders as "5m" on its active day
    // and as the row total; muted is always false.
    const gammaCell = gamma?.dayCells.find((cell) => cell.day === "2024-01-11");
    expect(gammaCell).toMatchObject({ label: "5m", muted: false });
    expect(gamma?.totalLabel).toBe("5m");
    // Idle days render an em dash.
    expect(
      gamma?.dayCells.find((cell) => cell.day === "2024-01-10")?.label,
    ).toBe("—");

    // delta: no duration accrued, so the cell and total fall back to "1s".
    const deltaCell = delta?.dayCells.find((cell) => cell.day === "2024-01-11");
    expect(deltaCell).toMatchObject({ label: "1s", muted: false });
    expect(delta?.totalLabel).toBe("1s");

    // Every cell day matches a dayHeader and muted stays false everywhere.
    for (const row of activeRepos.rows) {
      expect(row.dayCells.map((cell) => cell.day)).toEqual(
        activeRepos.dayHeaders,
      );
      expect(row.dayCells.every((cell) => cell.muted === false)).toBe(true);
    }
  });

  test("ranks repos by total session count and caps at the top 10", () => {
    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const { activeRepos } = aggregator.projectActivityFor(selection());
    // The fixture has repo-beta (2 roots) and repo-alpha (1 root); beta ranks
    // first by session count.
    expect(activeRepos.rows.map((row) => row.repo)).toEqual([
      "/workspace/repo-beta",
      "/workspace/repo-alpha",
    ]);
    expect(activeRepos.rows.length).toBeLessThanOrEqual(10);
  });
});

describe("dashboard model performance percentiles", () => {
  // Insert a root whose assistant messages all share the same duration and
  // output so the percentile values are exact and easy to assert.
  function seedPerfRoot(params: {
    sessionId: string;
    projectId: string;
    modelId: string;
    count: number;
    durationMs: number;
    outputTokens: number;
  }): void {
    const writable = getWritableDb();
    try {
      writable
        .prepare(
          `INSERT INTO project (
            id, worktree, vcs, name, icon_url, icon_color,
            time_created, time_updated, time_initialized, sandboxes, commands
          ) VALUES (?, ?, 'git', ?, NULL, '#000000', ?, ?, ?, '[]', NULL)`,
        )
        .run(
          params.projectId,
          `/workspace/${params.projectId}`,
          params.projectId,
          NOW_MS,
          NOW_MS,
          NOW_MS,
        );
      writable
        .prepare(
          `INSERT INTO session (
            id, project_id, parent_id, slug, directory, title, version, share_url,
            summary_additions, summary_deletions, summary_files, summary_diffs,
            revert, permission, time_created, time_updated, time_compacting,
            time_archived, workspace_id
          ) VALUES (?, ?, NULL, ?, ?, ?, '1', NULL, 0, 0, 0, NULL, NULL, NULL,
            ?, ?, NULL, NULL, NULL)`,
        )
        .run(
          params.sessionId,
          params.projectId,
          params.sessionId,
          `/workspace/${params.projectId}`,
          params.sessionId,
          NOW_MS,
          NOW_MS,
        );

      const base = new Date("2024-01-11T09:00:00.000Z").getTime();
      const insert = writable.prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (let i = 0; i < params.count; i++) {
        const created = base + i * 1_000;
        insert.run(
          `${params.sessionId}-msg-${i}`,
          params.sessionId,
          created,
          created,
          JSON.stringify({
            role: "assistant",
            time: { created, completed: created + params.durationMs },
            modelID: params.modelId,
            providerID: "openai",
            tokens: {
              total: params.outputTokens,
              input: 0,
              output: params.outputTokens,
            },
          }),
        );
      }
    } finally {
      writable.close();
    }
  }

  test("computes TPS and latency percentiles once the sample gate is met", () => {
    // 120 identical turns: duration 50ms, output 25 tokens => TPS 500 each.
    seedPerfRoot({
      sessionId: "ses-perf-big",
      projectId: "proj-perf-big",
      modelId: "perf-big",
      count: 120,
      durationMs: 50,
      outputTokens: 25,
    });

    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const row = aggregator
      .projectModelsFor(selection())
      .modelPerformanceStats.find((entry) => entry.model === "perf-big");
    expect(row).toBeDefined();
    expect(row?.validTpsMessages).toBe(120);
    expect(row?.validLatencyMessages).toBe(120);

    // Constant samples => every percentile equals the constant.
    expect(row?.tpsP10).toBe(500);
    expect(row?.tpsP50).toBe(500);
    expect(row?.tpsP90).toBe(500);
    expect(row?.tpsP99).toBe(500);
    expect(row?.avgTps).toBe(500);
    expect(row?.latencyP50Ms).toBe(50);
    expect(row?.latencyP90Ms).toBe(50);
    expect(row?.latencyP99Ms).toBe(50);
  });

  test("gates P99 (needs >=100) while P50/P90 (need >=20) are computed", () => {
    // 30 turns: meets the 20-sample gate (P10/P50/P90) but not the 100 gate (P99).
    seedPerfRoot({
      sessionId: "ses-perf-mid",
      projectId: "proj-perf-mid",
      modelId: "perf-mid",
      count: 30,
      durationMs: 40,
      outputTokens: 20,
    });

    db = getDb();
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const row = aggregator
      .projectModelsFor(selection())
      .modelPerformanceStats.find((entry) => entry.model === "perf-mid");
    expect(row).toBeDefined();
    expect(row?.validTpsMessages).toBe(30);

    // TPS = 20 * 1000 / 40 = 500.
    expect(row?.tpsP10).toBe(500);
    expect(row?.tpsP50).toBe(500);
    expect(row?.tpsP90).toBe(500);
    expect(row?.tpsP99).toBeNull(); // below the 100-sample gate
    expect(row?.latencyP50Ms).toBe(40);
    expect(row?.latencyP90Ms).toBe(40);
    expect(row?.latencyP99Ms).toBeNull();
  });
});
