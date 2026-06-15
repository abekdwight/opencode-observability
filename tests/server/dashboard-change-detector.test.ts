import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { toLocalDayStartMs } from "../../src/lib/dashboard-time.js";
import { getDb, getWritableDb } from "../../src/lib/db.js";
import type { Database } from "../../src/lib/sqlite.js";
import { DashboardChangeDetector } from "../../src/services/dashboard/aggregator/change-detector.js";
import {
  CHILD_SESSION_ID,
  OLD_SESSION_ID,
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

const FIXTURE_NOW = new Date("2024-01-11T11:06:00.000Z");
const NOW_MS = FIXTURE_NOW.getTime();

// The aggregation horizon used in tests (trailing 90 days from the fixture day).
const HORIZON = {
  startMs: toLocalDayStartMs("2023-10-14"),
  endMs: toLocalDayStartMs("2024-01-12"),
};

let detectorDb: Database;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXTURE_NOW);
  useFixtureDb();
  detectorDb = getDb();
});

afterEach(() => {
  detectorDb.close();
  restoreDbPath();
  vi.useRealTimers();
});

function withWritableDb(callback: (db: Database) => void): void {
  const db = getWritableDb();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    callback(db);
  } finally {
    db.close();
  }
}

describe("dashboard change detector", () => {
  test("first cycle reports every root in the horizon as a candidate", () => {
    const detector = new DashboardChangeDetector(detectorDb);
    const report = detector.detect(HORIZON, NOW_MS, true);

    expect(report.candidateRootIds.sort()).toEqual(
      [OLD_SESSION_ID, ROOT_SESSION_ID, "ses-root-2"].sort(),
    );
    expect(report.removedRootIds).toEqual([]);
  });

  test("data_version gate short-circuits when nothing was committed", () => {
    const detector = new DashboardChangeDetector(detectorDb);
    detector.detect(HORIZON, NOW_MS, true);

    // Second cycle with no external writes: only the bounded restamp passes run
    // (hot roots), and nothing is reported as removed.
    const idle = detector.detect(HORIZON, NOW_MS, false);
    expect(idle.removedRootIds).toEqual([]);
    // Restamp roots are a bounded subset, never the unbounded full scan output.
    expect(idle.candidateRootIds.length).toBeLessThanOrEqual(3);
  });

  test("detects an appended message via rowid range scan", () => {
    const detector = new DashboardChangeDetector(detectorDb);
    detector.detect(HORIZON, NOW_MS, true);

    const createdAt = new Date("2024-01-11T10:22:55.000Z").getTime();
    withWritableDb((db) => {
      db.prepare(
        `INSERT INTO message (id, session_id, time_created, time_updated, data)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        "msg-child-1-append-detector",
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
    });

    const report = detector.detect(HORIZON, NOW_MS, false);
    // The new message belongs to a child of ROOT_SESSION_ID, so its root is the
    // candidate to rebuild.
    expect(report.candidateRootIds).toContain(ROOT_SESSION_ID);
  });

  test("detects an in-place message update via hot restamp", () => {
    const detector = new DashboardChangeDetector(detectorDb);
    detector.detect(HORIZON, NOW_MS, true);
    // A no-op idle cycle establishes the data_version watermark.
    detector.detect(HORIZON, NOW_MS, false);

    withWritableDb((db) => {
      db.prepare("UPDATE message SET data = ? WHERE id = ?").run(
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
    });

    const report = detector.detect(HORIZON, NOW_MS, false);
    // ROOT_SESSION_ID is updated today (hot), so its restamp catches the
    // in-place edit even though no rows were appended.
    expect(report.candidateRootIds).toContain(ROOT_SESSION_ID);
  });

  test("detects a deleted root via root-list diff", () => {
    const detector = new DashboardChangeDetector(detectorDb);
    detector.detect(HORIZON, NOW_MS, true);

    withWritableDb((db) => {
      db.prepare("DELETE FROM session WHERE id = ? OR parent_id = ?").run(
        ROOT_SESSION_ID,
        ROOT_SESSION_ID,
      );
    });

    const report = detector.detect(HORIZON, NOW_MS, false);
    expect(report.removedRootIds).toEqual([ROOT_SESSION_ID]);
    expect(report.candidateRootIds).not.toContain(ROOT_SESSION_ID);
  });

  test("reset clears watermarks so the next detect re-scans everything", () => {
    const detector = new DashboardChangeDetector(detectorDb);
    detector.detect(HORIZON, NOW_MS, true);
    detector.reset();

    const report = detector.detect(HORIZON, NOW_MS, true);
    expect(report.candidateRootIds.sort()).toEqual(
      [OLD_SESSION_ID, ROOT_SESSION_ID, "ses-root-2"].sort(),
    );
  });
});
