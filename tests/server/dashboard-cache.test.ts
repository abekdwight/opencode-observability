import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import * as dashboardRepository from "../../src/repositories/dashboard/dashboard-repository.js";
import {
  getDashboardApiCacheSnapshotForTests,
  invalidateDashboardApiCache,
  invalidateDashboardApiCacheForDays,
  readDashboardSnapshot,
} from "../../src/server/dashboard-api.js";
import * as dashboardService from "../../src/services/dashboard/dashboard-service.js";
import {
  OLD_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

const FIXTURE_NOW = new Date("2024-01-11T11:06:00.000Z");

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

afterAll(() => {
  restoreDbPath();
  vi.useRealTimers();
});

describe("dashboard bounded cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXTURE_NOW);
    useFixtureDb();
    invalidateDashboardApiCache();
  });

  test("reuses day buckets across overlapping bounded windows", () => {
    const buildSpy = vi.spyOn(
      dashboardService,
      "buildDashboardAggregateStateForWindow",
    );

    try {
      withWritableDb((db) => {
        const narrowerWindow = {
          startDayInclusive: "2024-01-05",
          endDayExclusive: "2024-01-12",
        };
        const widerWindow = {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-12",
        };

        const narrower = readDashboardSnapshot(db, {
          range: "week",
          view: "daily",
          window: narrowerWindow,
        });
        const wider = readDashboardSnapshot(db, {
          range: "week",
          view: "daily",
          window: widerWindow,
        });

        expect(narrower.summary.totalSessions).toBe(2);
        expect(wider.summary.totalSessions).toBe(3);

        // Cold load is built in one bounded pass, then only the missing day is built.
        expect(buildSpy).toHaveBeenCalledTimes(2);
        expect(buildSpy).toHaveBeenCalledWith(
          db,
          expect.objectContaining(narrowerWindow),
        );
        expect(buildSpy).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            startDayInclusive: "2024-01-04",
            endDayExclusive: "2024-01-05",
          }),
        );

        const rebuiltForJan5 = buildSpy.mock.calls.filter(([, windowArg]) => {
          const window = windowArg as {
            startDayInclusive: string;
            endDayExclusive: string;
          };
          return (
            window.startDayInclusive === "2024-01-05" &&
            window.endDayExclusive === "2024-01-06"
          );
        });
        expect(rebuiltForJan5).toHaveLength(0);

        expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
          "2024-01-04",
          "2024-01-05",
          "2024-01-06",
          "2024-01-07",
          "2024-01-08",
          "2024-01-09",
          "2024-01-10",
          "2024-01-11",
        ]);
        expect(getDashboardApiCacheSnapshotForTests().viewKeys).toEqual([
          "2024-01-04:2024-01-11:daily",
          "2024-01-05:2024-01-11:daily",
        ]);
      });
    } finally {
      buildSpy.mockRestore();
    }
  });

  test("clears overlapping caches when the root session count drops", () => {
    const buildSpy = vi.spyOn(
      dashboardService,
      "buildDashboardAggregateStateForWindow",
    );

    try {
      withWritableDb((db) => {
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
        expect(buildSpy).toHaveBeenCalledTimes(1);

        db.prepare("DELETE FROM session WHERE id = ?").run(OLD_SESSION_ID);
        vi.advanceTimersByTime(1_000);

        const after = readDashboardSnapshot(db, {
          range: "week",
          view: "daily",
          window,
        });

        expect(after.summary.totalSessions).toBe(0);
        expect(after.generatedAt).not.toBe(before.generatedAt);
        expect(buildSpy).toHaveBeenCalledTimes(2);
        expect(buildSpy).toHaveBeenNthCalledWith(
          2,
          db,
          expect.objectContaining(window),
        );
        expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
          "2024-01-04",
        ]);
        expect(getDashboardApiCacheSnapshotForTests().viewKeys).toEqual([
          "2024-01-04:2024-01-04:daily",
        ]);
      });
    } finally {
      buildSpy.mockRestore();
    }
  });

  test("invalidates only affected day buckets and overlapping views", () => {
    withWritableDb((db) => {
      readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-05",
        },
      });
      readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: {
          startDayInclusive: "2024-01-05",
          endDayExclusive: "2024-01-12",
        },
      });

      invalidateDashboardApiCacheForDays(["2024-01-04"]);

      expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
        "2024-01-05",
        "2024-01-06",
        "2024-01-07",
        "2024-01-08",
        "2024-01-09",
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(getDashboardApiCacheSnapshotForTests().viewKeys).toEqual([
        "2024-01-05:2024-01-11:daily",
      ]);
    });
  });

  test("clears stale cache when stamp changed but changed-day diff is empty", () => {
    const buildSpy = vi.spyOn(
      dashboardService,
      "buildDashboardAggregateStateForWindow",
    );
    const cacheStampSpy = vi.spyOn(
      dashboardRepository,
      "readDashboardCacheStamp",
    );
    const changedDaysSpy = vi.spyOn(
      dashboardRepository,
      "readDashboardChangedDaysSince",
    );

    const baseStamp = {
      partRowId: 100,
      messageRowId: 200,
      sessionRowId: 300,
      rootSessionCount: 3,
      maxPartUpdatedAt: 1000,
      maxMessageUpdatedAt: 2000,
      maxSessionUpdatedAt: 3000,
    };

    try {
      cacheStampSpy
        .mockImplementationOnce(() => baseStamp)
        .mockImplementation(() => ({ ...baseStamp, partRowId: 101 }));
      changedDaysSpy.mockReturnValue([]);

      withWritableDb((db) => {
        const window = {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-05",
        };

        readDashboardSnapshot(db, {
          range: "week",
          view: "daily",
          window,
        });
        readDashboardSnapshot(db, {
          range: "week",
          view: "daily",
          window,
        });

        expect(buildSpy).toHaveBeenCalledTimes(2);
        expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
          "2024-01-04",
        ]);
      });
    } finally {
      buildSpy.mockRestore();
      cacheStampSpy.mockRestore();
      changedDaysSpy.mockRestore();
    }
  });
});
