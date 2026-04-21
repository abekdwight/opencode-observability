import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import {
  readDashboardAffectedDaysForRootSessionIds,
  readDashboardAffectedDaysForSessionIds,
  readDashboardCacheStamp,
  readDashboardChangedRootSessionIdsSince,
  readDashboardSessionSourceStamps,
  readSessionDeletionTargetIds,
} from "../../src/repositories/dashboard/dashboard-repository.js";
import {
  ALERT_SESSION_ID,
  CHILD_SESSION_ID,
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

const FIXTURE_NOW = new Date("2024-01-11T11:06:00.000Z");
const NEXT_DAY_MESSAGE_CREATED_AT = new Date(
  "2024-01-12T00:05:00.000Z",
).getTime();

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

describe("dashboard repository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXTURE_NOW);
    useFixtureDb();
  });

  test("maps changed child rows to root dashboard session ids", () => {
    withWritableDb((db) => {
      const previousStamp = readDashboardCacheStamp(db);
      const initialStamps = readDashboardSessionSourceStamps(db, [
        ALERT_SESSION_ID,
        ROOT_SESSION_ID,
      ]);
      const initialByRoot = new Map(
        initialStamps.map((stamp) => [stamp.rootSessionId, stamp]),
      );

      expect(initialByRoot.get(ALERT_SESSION_ID)).toMatchObject({
        rootSessionId: ALERT_SESSION_ID,
        sessionRowCount: 1,
        messageRowCount: 3,
        partRowCount: 4,
      });
      expect(initialByRoot.get(ROOT_SESSION_ID)).toMatchObject({
        rootSessionId: ROOT_SESSION_ID,
        sessionRowCount: 2,
        messageRowCount: 6,
        partRowCount: 10,
      });

      const updatedAt = FIXTURE_NOW.getTime() + 60_000;
      db.prepare("UPDATE session SET time_updated = ? WHERE id = ?").run(
        updatedAt,
        CHILD_SESSION_ID,
      );
      db.prepare("UPDATE message SET time_updated = ? WHERE id = ?").run(
        updatedAt + 1,
        "msg-child-1-assistant",
      );
      db.prepare("UPDATE part SET time_updated = ? WHERE id = ?").run(
        updatedAt + 2,
        "part-child-1-assistant-text",
      );

      db.prepare(
        `
        INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        "msg-child-1-follow-up",
        CHILD_SESSION_ID,
        NEXT_DAY_MESSAGE_CREATED_AT,
        updatedAt + 3,
        JSON.stringify({
          role: "assistant",
          time: {
            created: NEXT_DAY_MESSAGE_CREATED_AT,
            completed: NEXT_DAY_MESSAGE_CREATED_AT + 2_000,
          },
          modelID: "gpt-4.1-mini",
          providerID: "openai",
          agent: "subagent-code",
          tokens: { total: 18, input: 8, output: 10 },
        }),
      );
      db.prepare(
        `
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        "part-child-1-follow-up-tool",
        "msg-child-1-follow-up",
        CHILD_SESSION_ID,
        NEXT_DAY_MESSAGE_CREATED_AT + 100,
        updatedAt + 4,
        JSON.stringify({
          type: "tool",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/workspace/repo-alpha/src/new.ts" },
            output: { bytes: 42 },
          },
        }),
      );

      expect(readDashboardChangedRootSessionIdsSince(db, previousStamp)).toEqual([
        ROOT_SESSION_ID,
      ]);

      const sourceStamps = readDashboardSessionSourceStamps(db, [
        ALERT_SESSION_ID,
        ROOT_SESSION_ID,
      ]);
      const sourceByRoot = new Map(
        sourceStamps.map((stamp) => [stamp.rootSessionId, stamp]),
      );

      expect(sourceByRoot.get(ALERT_SESSION_ID)).toEqual(
        initialByRoot.get(ALERT_SESSION_ID),
      );
      expect(sourceByRoot.get(ROOT_SESSION_ID)).toMatchObject({
        rootSessionId: ROOT_SESSION_ID,
        sessionRowCount: 2,
        sessionRowId: initialByRoot.get(ROOT_SESSION_ID)?.sessionRowId,
        maxSessionUpdatedAt: updatedAt,
        messageRowCount: 7,
        maxMessageUpdatedAt: updatedAt + 3,
        partRowCount: 11,
        maxPartUpdatedAt: updatedAt + 4,
      });
      expect(
        sourceByRoot.get(ROOT_SESSION_ID)?.messageRowId,
      ).toBeGreaterThan(initialByRoot.get(ROOT_SESSION_ID)?.messageRowId ?? 0);
      expect(sourceByRoot.get(ROOT_SESSION_ID)?.partRowId).toBeGreaterThan(
        initialByRoot.get(ROOT_SESSION_ID)?.partRowId ?? 0,
      );
    });
  });

  test("reports affected local days for updated and deleted dashboard sessions", () => {
    withWritableDb((db) => {
      const previousStamp = readDashboardCacheStamp(db);
      const updatedAt = FIXTURE_NOW.getTime() + 120_000;

      db.prepare("UPDATE message SET time_updated = ? WHERE id = ?").run(
        updatedAt,
        "msg-child-1-assistant",
      );
      db.prepare("UPDATE part SET time_updated = ? WHERE id = ?").run(
        updatedAt + 1,
        "part-child-1-assistant-text",
      );

      const changedRootIds = readDashboardChangedRootSessionIdsSince(
        db,
        previousStamp,
      );
      expect(changedRootIds).toEqual([ROOT_SESSION_ID]);
      expect(
        readDashboardAffectedDaysForRootSessionIds(db, changedRootIds),
      ).toEqual(["2024-01-11"]);

      db.prepare(
        `
        INSERT INTO message (id, session_id, time_created, time_updated, data)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        "msg-child-1-delete-window",
        CHILD_SESSION_ID,
        NEXT_DAY_MESSAGE_CREATED_AT,
        NEXT_DAY_MESSAGE_CREATED_AT,
        JSON.stringify({
          role: "assistant",
          time: {
            created: NEXT_DAY_MESSAGE_CREATED_AT,
            completed: NEXT_DAY_MESSAGE_CREATED_AT + 1_000,
          },
          modelID: "gpt-4.1-mini",
          providerID: "openai",
          agent: "subagent-code",
          tokens: { total: 12, input: 4, output: 8 },
        }),
      );
      db.prepare(
        `
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        "part-child-1-delete-window-text",
        "msg-child-1-delete-window",
        CHILD_SESSION_ID,
        NEXT_DAY_MESSAGE_CREATED_AT + 100,
        NEXT_DAY_MESSAGE_CREATED_AT + 100,
        JSON.stringify({
          type: "text",
          text: "Captured before delete invalidation.",
        }),
      );

      const deletionTargetIds = readSessionDeletionTargetIds(db, ROOT_SESSION_ID);
      expect([...deletionTargetIds].sort()).toEqual([
        CHILD_SESSION_ID,
        ROOT_SESSION_ID,
      ]);

      const rootAffectedDays = readDashboardAffectedDaysForRootSessionIds(db, [
        ROOT_SESSION_ID,
      ]);
      const deleteRouteAffectedDays = readDashboardAffectedDaysForSessionIds(
        db,
        deletionTargetIds,
      );

      expect(rootAffectedDays).toEqual(["2024-01-11", "2024-01-12"]);
      expect(deleteRouteAffectedDays).toEqual(rootAffectedDays);

      db.prepare("DELETE FROM session WHERE id = ? OR parent_id = ?").run(
        ROOT_SESSION_ID,
        ROOT_SESSION_ID,
      );

      expect(readDashboardAffectedDaysForRootSessionIds(db, [ROOT_SESSION_ID])).toEqual(
        [],
      );
      expect(rootAffectedDays).toEqual(["2024-01-11", "2024-01-12"]);
    });
  });
});
