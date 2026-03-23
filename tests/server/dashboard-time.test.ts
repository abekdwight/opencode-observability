import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import {
  invalidateDashboardApiCache,
  readDashboardSnapshot,
} from "../../src/server/dashboard-api.js";
import { buildBoundedSelection } from "../../src/services/dashboard/dashboard-service.js";
import {
  applyDashboardDraftSelection,
  createDashboardSelectionController,
  setDashboardDraftDates,
  setDashboardDraftPreset,
} from "../../web/lib/dashboard-selection.js";
import { restoreDbPath, useFixtureDb } from "../helpers/fixture-db.js";

type HourBar = {
  label: string;
  stacks: Array<{ name: string; value: number }>;
};

const FIXTURE_NOW = new Date("2024-01-11T11:06:00.000Z");

function totalStacks(bars: HourBar[], label: string): number {
  return (
    bars
      .find((bar) => bar.label === label)
      ?.stacks.reduce((sum, stack) => sum + stack.value, 0) ?? 0
  );
}

function stackValue(bars: HourBar[], label: string, name: string): number {
  return (
    bars
      .find((bar) => bar.label === label)
      ?.stacks.find((stack) => stack.name === name)?.value ?? 0
  );
}

function withWritableDb<T>(
  callback: (db: ReturnType<typeof getWritableDb>) => T,
): T {
  const db = getWritableDb();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  invalidateDashboardApiCache();
});

afterAll(() => {
  restoreDbPath();
  vi.useRealTimers();
});

describe("dashboard selection controller", () => {
  test("defaults to the latest week and ignores unsupported params", () => {
    const defaults = createDashboardSelectionController(
      new URLSearchParams(),
      FIXTURE_NOW,
    );
    const stray = createDashboardSelectionController(
      new URLSearchParams("foo=bar&range=all"),
      FIXTURE_NOW,
    );

    expect(defaults.appliedSelection).toMatchObject({
      preset: "last7d",
      start: "2024-01-05",
      end: "2024-01-11",
      view: "daily",
      refreshable: true,
      bounds: {
        startDayInclusive: "2024-01-05",
        endDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
        dayCount: 7,
      },
    });
    expect(defaults.apiUrl).toBe(
      "/api/dashboard?preset=last7d&start=2024-01-05&end=2024-01-11&view=daily",
    );
    expect(stray.appliedSelection).toEqual(defaults.appliedSelection);
    expect(stray.apiUrl).toBe(defaults.apiUrl);
  });

  test("rejects inverted custom ranges on apply", () => {
    const controller = createDashboardSelectionController(
      new URLSearchParams(),
      FIXTURE_NOW,
    );
    const rejected = applyDashboardDraftSelection(
      setDashboardDraftDates(
        setDashboardDraftPreset(controller, "custom", FIXTURE_NOW),
        { start: "2024-01-10", end: "2024-01-05" },
      ),
      FIXTURE_NOW,
    );

    expect(rejected.validationError).toBe(
      "Custom range start date must be on or before the end date.",
    );
    expect(rejected.appliedSelection).toEqual(controller.appliedSelection);
  });

  test("rejects custom ranges that exceed the 90-day cap", () => {
    const controller = createDashboardSelectionController(
      new URLSearchParams(),
      FIXTURE_NOW,
    );
    const rejected = applyDashboardDraftSelection(
      setDashboardDraftDates(
        setDashboardDraftPreset(controller, "custom", FIXTURE_NOW),
        { start: "2023-10-13", end: "2024-01-11" },
      ),
      FIXTURE_NOW,
    );

    expect(rejected.validationError).toBe(
      "Custom ranges are limited to 90 days.",
    );
    expect(rejected.appliedSelection).toEqual(controller.appliedSelection);
  });
});

describe("dashboard hourly aggregation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXTURE_NOW);
    useFixtureDb();
  });

  test("returns 24 buckets for a single-day selection", () => {
    withWritableDb((db) => {
      const body = readDashboardSnapshot(db, { range: "day", view: "hourly" });

      expect(body.errorTrendHourlyBars).toHaveLength(24);
      expect(body.tokenTrend.hourlyBars).toHaveLength(24);
      expect(body.subagentTrend.hourlyBars).toHaveLength(24);
      expect(stackValue(body.tokenTrend.hourlyBars, "10", "Input")).toBe(114);
      expect(stackValue(body.tokenTrend.hourlyBars, "10", "Output")).toBe(108);
      expect(totalStacks(body.subagentTrend.hourlyBars, "10")).toBe(4);
    });
  });

  test("sums 24 hourly buckets across multiple selected days", () => {
    withWritableDb((db) => {
      const body = readDashboardSnapshot(db, { range: "week", view: "hourly" });

      expect(body.errorTrendHourlyBars).toHaveLength(24);
      expect(body.tokenTrend.hourlyBars).toHaveLength(24);
      expect(body.subagentTrend.hourlyBars).toHaveLength(24);
      expect(stackValue(body.tokenTrend.hourlyBars, "10", "Input")).toBe(169);
      expect(stackValue(body.tokenTrend.hourlyBars, "10", "Output")).toBe(158);
      expect(totalStacks(body.subagentTrend.hourlyBars, "10")).toBe(6);
    });
  });
});

describe("dashboard temporal edge cases", () => {
  test("keeps DST transition dates on single-day boundaries under UTC", () => {
    expect(
      buildBoundedSelection({
        startDayInclusive: "2024-03-10",
        endDayExclusive: "2024-03-11",
      }),
    ).toEqual({
      startDayInclusive: "2024-03-10",
      endDayInclusive: "2024-03-10",
      endDayExclusive: "2024-03-11",
      dayCount: 1,
    });

    expect(
      buildBoundedSelection({
        startDayInclusive: "2024-11-03",
        endDayExclusive: "2024-11-04",
      }),
    ).toEqual({
      startDayInclusive: "2024-11-03",
      endDayInclusive: "2024-11-03",
      endDayExclusive: "2024-11-04",
      dayCount: 1,
    });
  });

  test("keeps leap-day and month-end windows inclusive", () => {
    expect(
      buildBoundedSelection({
        startDayInclusive: "2024-02-28",
        endDayExclusive: "2024-03-01",
      }),
    ).toEqual({
      startDayInclusive: "2024-02-28",
      endDayInclusive: "2024-02-29",
      endDayExclusive: "2024-03-01",
      dayCount: 2,
    });

    expect(
      buildBoundedSelection({
        startDayInclusive: "2024-01-31",
        endDayExclusive: "2024-02-03",
      }),
    ).toEqual({
      startDayInclusive: "2024-01-31",
      endDayInclusive: "2024-02-02",
      endDayExclusive: "2024-02-03",
      dayCount: 3,
    });
  });
});
