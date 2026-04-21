import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import * as dashboardTime from "../../src/lib/dashboard-time.js";
import {
  getDashboardApiCacheSnapshotForTests,
  invalidateDashboardApiCache,
  overrideDashboardApiCacheMetadataForTests,
  readDashboardSnapshot,
} from "../../src/server/dashboard-api.js";
import {
  CHILD_SESSION_ID,
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

describe("dashboard aggregation store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXTURE_NOW);
    useFixtureDb();
    invalidateDashboardApiCache();
    vi.restoreAllMocks();
  });

  test("dashboard cache exposes generation and semantics metadata", () => {
    withWritableDb((db) => {
      readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-05",
        },
      });

      const snapshot = getDashboardApiCacheSnapshotForTests();

      expect(snapshot.generation).toBeGreaterThanOrEqual(1);
      expect(snapshot.timezone).toBe(dashboardTime.resolveDashboardTimezone());
      expect(snapshot.semanticsVersion).toBe("session-atom-day-rollup-store-v2");
      expect(snapshot.sessionKeys).toEqual([
        OLD_SESSION_ID,
        "ses-root-1",
        "ses-root-2",
      ]);
      expect(snapshot.dayKeys).toEqual(["2024-01-04", "2024-01-10", "2024-01-11"]);
      expect(snapshot.rawKeys).toEqual(snapshot.dayKeys);
      expect(snapshot.viewKeys).toEqual([
        `2024-01-04:2024-01-05:daily:${dashboardTime.resolveDashboardTimezone()}`,
      ]);
      expect(snapshot.stamp).toMatchObject({
        rootSessionCount: expect.any(Number),
        partRowId: expect.any(Number),
        messageRowId: expect.any(Number),
        sessionRowId: expect.any(Number),
      });
    });
  });

  test("dashboard cache resets when timezone or semantics version changes", () => {
    withWritableDb((db) => {
      readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-05",
        },
      });

      const beforeTimezoneDrift = getDashboardApiCacheSnapshotForTests();
      expect(beforeTimezoneDrift.dayKeys).toEqual([
        "2024-01-04",
        "2024-01-10",
        "2024-01-11",
      ]);

      vi.spyOn(dashboardTime, "resolveDashboardTimezone").mockReturnValue(
        "Asia/Tokyo",
      );

      readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-05",
        },
      });

      const afterTimezoneDrift = getDashboardApiCacheSnapshotForTests();
      expect(afterTimezoneDrift.timezone).toBe("Asia/Tokyo");
      expect(afterTimezoneDrift.dayKeys).toEqual([
        "2024-01-04",
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(afterTimezoneDrift.generation).toBe(
        beforeTimezoneDrift.generation + 1,
      );

      overrideDashboardApiCacheMetadataForTests({
        semanticsVersion: "day-bucket-window-view-v1",
      });

      readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window: {
          startDayInclusive: "2024-01-04",
          endDayExclusive: "2024-01-05",
        },
      });

      const afterSemanticsDrift = getDashboardApiCacheSnapshotForTests();
      expect(afterSemanticsDrift.semanticsVersion).toBe(
        "session-atom-day-rollup-store-v2",
      );
      expect(afterSemanticsDrift.dayKeys).toEqual([
        "2024-01-04",
        "2024-01-10",
        "2024-01-11",
      ]);
      expect(afterSemanticsDrift.generation).toBe(
        afterTimezoneDrift.generation + 1,
      );
    });
  });

  test("reuses generation across unchanged dashboard reads", () => {
    withWritableDb((db) => {
      const window = {
        startDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
      };

      const first = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      const firstSnapshot = getDashboardApiCacheSnapshotForTests();

      vi.advanceTimersByTime(60_000);

      const second = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      const secondSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(second.generatedAt).toBe(first.generatedAt);
      expect(secondSnapshot.generation).toBe(firstSnapshot.generation);
      expect(secondSnapshot.sessionKeys).toEqual(firstSnapshot.sessionKeys);
      expect(secondSnapshot.dayKeys).toEqual(firstSnapshot.dayKeys);
      expect(secondSnapshot.viewKeys).toEqual(firstSnapshot.viewKeys);
    });
  });

  test("increments generation and rebuilds memo after appended dashboard rows", () => {
    withWritableDb((db) => {
      const window = {
        startDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
      };

      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();
      const createdAt = new Date("2024-01-11T10:22:55.000Z").getTime();

      db.prepare(
        `
          INSERT INTO message (id, session_id, time_created, time_updated, data)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run(
        "msg-child-1-append",
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
        window,
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(after.summary.totalTokens).toBeGreaterThan(before.summary.totalTokens);
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
      expect(afterSnapshot.sessionKeys).toEqual(beforeSnapshot.sessionKeys);
      expect(afterSnapshot.dayKeys).toEqual(beforeSnapshot.dayKeys);
    });
  });

  test("increments generation and rebuilds memo after updated dashboard rows", () => {
    withWritableDb((db) => {
      const window = {
        startDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
      };

      const before = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();
      const updatedAt = FIXTURE_NOW.getTime() + 3 * 24 * 60 * 60 * 1000;

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
        window,
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(after.summary.totalTokens).toBeGreaterThan(before.summary.totalTokens);
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
    });
  });

  test("rebuilds or resets the store after updated or deleted dashboard rows", () => {
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
      const beforeSnapshot = getDashboardApiCacheSnapshotForTests();

      db.prepare("DELETE FROM session WHERE id = ?").run(OLD_SESSION_ID);

      vi.advanceTimersByTime(1_000);

      const after = readDashboardSnapshot(db, {
        range: "week",
        view: "daily",
        window,
      });
      const afterSnapshot = getDashboardApiCacheSnapshotForTests();

      expect(before.summary.totalSessions).toBe(1);
      expect(after.summary.totalSessions).toBe(0);
      expect(after.generatedAt).not.toBe(before.generatedAt);
      expect(afterSnapshot.generation).toBeGreaterThan(beforeSnapshot.generation);
      expect(afterSnapshot.sessionKeys).toEqual(["ses-root-1", "ses-root-2"]);
      expect(afterSnapshot.dayKeys).toEqual(["2024-01-10", "2024-01-11"]);
    });
  });
});
