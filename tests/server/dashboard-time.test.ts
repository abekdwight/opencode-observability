import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildDashboardSelectionBounds,
  normalizeDashboardSelectionInput,
  toLocalDayStartMs,
} from "../../src/lib/dashboard-time.js";
import { getDb } from "../../src/lib/db.js";
import type { Database } from "../../src/lib/sqlite.js";
import { InlineDashboardGateway } from "../../src/services/dashboard/inline-gateway.js";
import { restoreDbPath, useFixtureDb } from "../helpers/fixture-db.js";

type HourBar = {
  label: string;
  stacks: Array<{ name: string; value: number }>;
};

const FIXTURE_NOW = new Date("2024-01-11T11:06:00.000Z");
const NOW_MS = FIXTURE_NOW.getTime();

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

function selection(preset: "today" | "last7d", view: "daily" | "hourly") {
  const result = normalizeDashboardSelectionInput(
    { preset, view },
    FIXTURE_NOW,
  );
  if (!result.ok) throw new Error(result.message);
  return result.selection;
}

describe("toLocalDayStartMs", () => {
  // Tests run under TZ=UTC (tests/setup.ts), so local midnight is UTC midnight.
  test("returns local-midnight epoch ms for a valid day", () => {
    expect(toLocalDayStartMs("2024-01-11")).toBe(
      Date.UTC(2024, 0, 11, 0, 0, 0, 0),
    );
    expect(toLocalDayStartMs("2024-01-12")).toBe(
      Date.UTC(2024, 0, 12, 0, 0, 0, 0),
    );
    // Adjacent days differ by exactly one day in ms.
    expect(
      toLocalDayStartMs("2024-01-12") - toLocalDayStartMs("2024-01-11"),
    ).toBe(86_400_000);
  });

  test("handles leap day and month/year boundaries", () => {
    expect(toLocalDayStartMs("2024-02-29")).toBe(
      Date.UTC(2024, 1, 29, 0, 0, 0, 0),
    );
    expect(toLocalDayStartMs("2023-12-31")).toBe(
      Date.UTC(2023, 11, 31, 0, 0, 0, 0),
    );
    expect(toLocalDayStartMs("2024-01-01")).toBe(
      Date.UTC(2024, 0, 1, 0, 0, 0, 0),
    );
  });

  test("returns NaN for malformed or invalid day strings", () => {
    expect(toLocalDayStartMs("2024-1-1")).toBeNaN();
    expect(toLocalDayStartMs("2024-13-01")).toBeNaN();
    expect(toLocalDayStartMs("2024-02-30")).toBeNaN();
    expect(toLocalDayStartMs("not-a-date")).toBeNaN();
    expect(toLocalDayStartMs("")).toBeNaN();
  });
});

describe("dashboard selection normalization", () => {
  test("defaults to last7d/daily and ignores unsupported params", () => {
    const result = normalizeDashboardSelectionInput(
      { preset: "all", view: "weekly" },
      FIXTURE_NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection).toMatchObject({
      preset: "last7d",
      view: "daily",
      bounds: {
        startDayInclusive: "2024-01-05",
        endDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
        dayCount: 7,
      },
    });
  });

  test("rejects inverted custom ranges", () => {
    const result = normalizeDashboardSelectionInput(
      { preset: "custom", start: "2024-01-11", end: "2024-01-10" },
      FIXTURE_NOW,
    );
    expect(result).toEqual({
      ok: false,
      message: "Custom range start date must be on or before the end date.",
    });
  });

  test("rejects custom ranges over the 90-day cap", () => {
    const result = normalizeDashboardSelectionInput(
      { preset: "custom", start: "2023-10-13", end: "2024-01-11" },
      FIXTURE_NOW,
    );
    expect(result).toEqual({
      ok: false,
      message: "Custom ranges are limited to 90 days.",
    });
  });
});

describe("dashboard selection bounds", () => {
  test("keeps DST transition dates on single-day boundaries under UTC", () => {
    expect(
      buildDashboardSelectionBounds({
        startDayInclusive: "2024-03-10",
        endDayExclusive: "2024-03-11",
      }),
    ).toEqual({
      startDayInclusive: "2024-03-10",
      endDayInclusive: "2024-03-10",
      endDayExclusive: "2024-03-11",
      dayCount: 1,
    });
  });

  test("keeps leap-day and month-end windows inclusive", () => {
    expect(
      buildDashboardSelectionBounds({
        startDayInclusive: "2024-02-28",
        endDayExclusive: "2024-03-01",
      }),
    ).toEqual({
      startDayInclusive: "2024-02-28",
      endDayInclusive: "2024-02-29",
      endDayExclusive: "2024-03-01",
      dayCount: 2,
    });
  });
});

describe("dashboard hourly aggregation via gateway", () => {
  let db: Database;

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

  test("returns 24 buckets for a single-day selection", () => {
    const gateway = new InlineDashboardGateway(db, { now: () => NOW_MS });
    const tools = gateway.getTools(selection("today", "hourly"));
    const activity = gateway.getActivity(selection("today", "hourly"));
    if (tools.state !== "ready" || activity.state !== "ready") {
      throw new Error("expected ready");
    }

    expect(tools.data.errorTrendHourlyBars).toHaveLength(24);
    expect(activity.data.tokenTrend.hourlyBars).toHaveLength(24);
    expect(activity.data.subagentTrend.hourlyBars).toHaveLength(24);
    expect(stackValue(activity.data.tokenTrend.hourlyBars, "10", "Input")).toBe(
      114,
    );
    expect(
      stackValue(activity.data.tokenTrend.hourlyBars, "10", "Output"),
    ).toBe(108);
    expect(totalStacks(activity.data.subagentTrend.hourlyBars, "10")).toBe(4);
  });

  test("sums 24 hourly buckets across multiple selected days", () => {
    const gateway = new InlineDashboardGateway(db, { now: () => NOW_MS });
    const tools = gateway.getTools(selection("last7d", "hourly"));
    const activity = gateway.getActivity(selection("last7d", "hourly"));
    if (tools.state !== "ready" || activity.state !== "ready") {
      throw new Error("expected ready");
    }

    expect(tools.data.errorTrendHourlyBars).toHaveLength(24);
    expect(totalStacks(tools.data.errorTrendHourlyBars, "10")).toBe(2);
    expect(stackValue(activity.data.tokenTrend.hourlyBars, "10", "Input")).toBe(
      169,
    );
    expect(
      stackValue(activity.data.tokenTrend.hourlyBars, "10", "Output"),
    ).toBe(158);
    expect(totalStacks(activity.data.subagentTrend.hourlyBars, "10")).toBe(6);
  });
});
