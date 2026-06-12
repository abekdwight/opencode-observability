import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  normalizeDashboardSelectionInput,
  toLocalDayStartMs,
} from "../../src/lib/dashboard-time.js";
import { getDb } from "../../src/lib/db.js";
import { DashboardAggregator } from "../../src/services/dashboard/aggregator/aggregator.js";
import { restoreDbPath, useFixtureDb } from "../helpers/fixture-db.js";

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

let db: Database.Database;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  useFixtureDb();
  db = getDb();
});

afterEach(() => {
  db.close();
  restoreDbPath();
  vi.useRealTimers();
});

describe("dashboard aggregator", () => {
  test("stamps then builds atoms in chunks, transitioning building -> ready", () => {
    const aggregator = new DashboardAggregator(db, { chunkSize: 1 });

    // Reconcile only enqueues candidates for stamping — no I/O-heavy work.
    aggregator.reconcile(NOW_MS);
    expect(aggregator.isReady()).toBe(false);
    expect(aggregator.rollupStatus().state).toBe("building");

    // First pump is the stamp batch (no atoms built yet, no generation bump).
    expect(aggregator.stampNextBatch()).toBe(true);
    expect(aggregator.getGeneration()).toBe(0);
    expect(aggregator.isReady()).toBe(false);

    // Each subsequent build chunk processes one root and bumps the generation.
    const generations: number[] = [];
    let guard = 0;
    while (aggregator.buildNextChunk()) {
      generations.push(aggregator.getGeneration());
      if (++guard > 50) throw new Error("build did not terminate");
    }

    // Three in-horizon roots (root-1, root-2, old) => three chunks of size 1.
    expect(guard).toBe(3);
    expect(generations).toEqual([1, 2, 3]);
    expect(aggregator.isReady()).toBe(true);
    expect(aggregator.rollupStatus()).toEqual({
      state: "ready",
      progressPercent: 100,
    });
  });

  test("pumpWork drains the stamp queue before building", () => {
    const aggregator = new DashboardAggregator(db, { chunkSize: 1 });
    aggregator.reconcile(NOW_MS);

    // pumpWork advances one bounded unit per call; the first unit is a stamp
    // batch, then build chunks, until both queues empty.
    let guard = 0;
    while (aggregator.pumpWork()) {
      if (++guard > 50) throw new Error("pump did not terminate");
    }
    expect(aggregator.isReady()).toBe(true);
    expect(aggregator.projectModelsFor(selection()).modelUsage.length).toBe(4);
  });

  test("progress percent increases monotonically during the cold build", () => {
    const aggregator = new DashboardAggregator(db, { chunkSize: 1 });
    aggregator.reconcile(NOW_MS);
    aggregator.stampNextBatch();

    const initial = aggregator.rollupStatus();
    expect(initial.state).toBe("building");
    expect(initial.progressPercent).toBe(0);

    aggregator.buildNextChunk();
    const afterOne = aggregator.rollupStatus();
    expect(afterOne.state).toBe("building");
    expect(afterOne.progressPercent).toBeGreaterThan(0);
    expect(afterOne.progressPercent).toBeLessThan(100);
  });

  test("drain reconciles and builds everything in one call", () => {
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);
    expect(aggregator.isReady()).toBe(true);

    const models = aggregator.projectModelsFor(selection());
    expect(models.modelUsage).toEqual(
      expect.arrayContaining([{ label: "gpt-4.1", count: 3 }]),
    );
  });

  test("memoizes projections per generation and selection", () => {
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    const first = aggregator.projectToolsFor(selection());
    const second = aggregator.projectToolsFor(selection());
    // Same generation + selection => identical (memoized) object reference.
    expect(second).toBe(first);
  });

  test("covers the full 90-day horizon including older roots", () => {
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);

    // The legacy root lives on 2024-01-04, ~7 days back, well inside 90 days.
    const tools = aggregator.projectToolsFor(selection());
    expect(tools.errorPatterns).toEqual(
      expect.arrayContaining([
        { label: "Network/HTTP error", count: 1 },
        { label: "Patch failed", count: 1 },
      ]),
    );

    const activity = aggregator.projectActivityFor(selection());
    expect(activity.tokenTrend.dailySeries[0]?.points).toHaveLength(90);
  });

  test("reset clears the atom set and forces a rebuild", () => {
    const aggregator = new DashboardAggregator(db);
    aggregator.drain(NOW_MS);
    const builtGeneration = aggregator.getGeneration();

    aggregator.reset();
    expect(aggregator.getGeneration()).toBeGreaterThan(builtGeneration);

    aggregator.drain(NOW_MS);
    expect(aggregator.isReady()).toBe(true);
    const models = aggregator.projectModelsFor(selection());
    expect(models.modelUsage.length).toBeGreaterThan(0);
  });

  test("overview is answerable before any stamp/build work runs", () => {
    const sel = selection();
    const window = {
      startMs: toLocalDayStartMs(sel.bounds.startDayInclusive),
      endMs: toLocalDayStartMs(sel.bounds.endDayExclusive),
    };

    const aggregator = new DashboardAggregator(db, { chunkSize: 1 });
    // Only reconcile — candidates are enqueued for stamping, nothing is built.
    aggregator.reconcile(NOW_MS);
    expect(aggregator.isReady()).toBe(false);
    expect(aggregator.hasPendingWork()).toBe(true);

    // Overview is sourced from the session table and does NOT depend on the
    // (still pending) atom build: it returns correct data immediately.
    const overview = aggregator.readOverviewSource(NOW_MS, window);
    expect(overview.summary.totalSessions).toBe(3);
    expect(overview.summary.activeProjects).toBe(2);
    expect(overview.recentSessions.length).toBeGreaterThan(0);
    expect(overview.heatmapDays.length).toBeGreaterThan(0);

    // The heavy pipeline still has work outstanding.
    expect(aggregator.hasPendingWork()).toBe(true);
  });

  test("reconcile leaves the heavy work to pumped units (no inline stamping)", () => {
    const aggregator = new DashboardAggregator(db, { chunkSize: 1 });
    aggregator.reconcile(NOW_MS);

    // After reconcile, no atoms exist yet — stamping/building have not run, so
    // heavy projections see an empty atom set until the pipeline is pumped.
    expect(aggregator.projectModelsFor(selection()).modelUsage).toEqual([]);

    // Pump just the stamp batch: still no atoms (stamping only enqueues builds).
    expect(aggregator.stampNextBatch()).toBe(true);
    expect(aggregator.projectModelsFor(selection()).modelUsage).toEqual([]);

    // One build chunk produces the first atom.
    expect(aggregator.buildNextChunk()).toBe(true);
    expect(
      aggregator.projectModelsFor(selection()).modelUsage.length,
    ).toBeGreaterThan(0);
  });
});
