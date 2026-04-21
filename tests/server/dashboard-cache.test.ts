import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import * as dashboardRepository from "../../src/repositories/dashboard/dashboard-repository.js";
import {
  getDashboardApiCacheSnapshotForTests,
  invalidateDashboardApiCache,
  invalidateDashboardApiCacheForDays,
  readDashboardSnapshot,
} from "../../src/server/dashboard-api.js";
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
      expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
        "2024-01-04",
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(getDashboardApiCacheSnapshotForTests().viewKeys).toEqual([
        "2024-01-04:2024-01-12:daily:UTC",
        "2024-01-05:2024-01-12:daily:UTC",
      ]);
    });
  });

  test("clears overlapping caches when the root session count drops", () => {
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

      db.prepare("DELETE FROM session WHERE id = ?").run(OLD_SESSION_ID);
      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });

      expect(after.summary.totalSessions).toBe(0);
      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(getDashboardApiCacheSnapshotForTests().viewKeys).toEqual([
        "2024-01-04:2024-01-05:daily:UTC",
      ]);
    });
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
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(getDashboardApiCacheSnapshotForTests().viewKeys).toEqual([
      ]);
    });
  });

  test("clears stale cache when stamp changed but changed-day diff is empty", () => {
    const cacheStampSpy = vi.spyOn(
      dashboardRepository,
      "readDashboardCacheStamp",
    );
    const changedRootsSpy = vi.spyOn(
      dashboardRepository,
      "readDashboardChangedRootSessionIdsSince",
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
      changedRootsSpy.mockReturnValue([]);

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

        expect(getDashboardApiCacheSnapshotForTests().rawKeys).toEqual([
          "2024-01-04",
          "2024-01-10",
          "2024-01-11",
        ]);
      });
    } finally {
      cacheStampSpy.mockRestore();
      changedRootsSpy.mockRestore();
    }
  });
});
