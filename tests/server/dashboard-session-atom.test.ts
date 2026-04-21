import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getWritableDb } from "../../src/lib/db.js";
import { readDashboardSessionSourceStamps } from "../../src/repositories/dashboard/dashboard-repository.js";
import {
  diffDashboardSessionAtoms,
  rebuildDashboardSessionAtom,
} from "../../src/services/dashboard/dashboard-session-atom.js";
import {
  CHILD_SESSION_ID,
  restoreDbPath,
  ROOT_SESSION_ID,
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

function readSourceStamp(db: ReturnType<typeof getWritableDb>) {
  const sourceStamp = readDashboardSessionSourceStamps(db, [ROOT_SESSION_ID])[0];
  expect(sourceStamp).toBeDefined();
  return sourceStamp;
}

afterAll(() => {
  restoreDbPath();
  vi.useRealTimers();
});

describe("dashboard session atom", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXTURE_NOW);
    useFixtureDb();
  });

  test("builds a root session atom including child sessions", () => {
    withWritableDb((db) => {
      const atom = rebuildDashboardSessionAtom(
        db,
        ROOT_SESSION_ID,
        readSourceStamp(db),
        FIXTURE_NOW.toISOString(),
      );

      expect(atom).not.toBeNull();
      expect(atom).toMatchObject({
        rootSessionId: ROOT_SESSION_ID,
        projectId: "proj-alpha",
        repoKey: "/workspace/repo-alpha",
        generatedAt: FIXTURE_NOW.toISOString(),
        recentMeta: {
          id: ROOT_SESSION_ID,
          title: "Root monitor session",
          directory: "/workspace/repo-alpha",
          projectId: "proj-alpha",
          repoKey: "/workspace/repo-alpha",
          totalTokens: 222,
        },
        sourceStamp: {
          rootSessionId: ROOT_SESSION_ID,
          sessionRowCount: 2,
          messageRowCount: 6,
          partRowCount: 10,
        },
      });

      const day = atom?.days.get("2024-01-11");
      expect(day).toBeDefined();
      expect(day).toMatchObject({
        day: "2024-01-11",
        rootSessionCount: 1,
        repoSessionCount: 1,
        repoActiveDurationMs: 35_000,
        tokenTotals: {
          input: 114,
          output: 108,
          cacheRead: 40,
          cacheWrite: 5,
          reasoning: 20,
          total: 222,
        },
        toolStatus: {
          calls: 3,
          errors: 1,
        },
      });
      expect(day?.errorPatterns).toEqual(new Map([["Network/HTTP error", 1]]));
      expect(day?.toolErrorsByHour).toEqual(new Map([["10", 1]]));
      expect(day?.modelCounts).toEqual(
        new Map([
          ["gpt-4.1", 2],
          ["gpt-4.1-mini", 1],
          ["gpt-5.3-codex-spark", 1],
        ]),
      );
      expect(day?.subagentCounts).toEqual(
        new Map([
          ["planner", 2],
          ["subagent-code", 1],
          ["compaction", 1],
        ]),
      );
      expect(day?.mcpUsage).toEqual(
        new Map([
          [
            "builtin",
            { server: "builtin", calls: 2, errors: 0, isBuiltin: true },
          ],
          [
            "github",
            { server: "github", calls: 1, errors: 1, isBuiltin: false },
          ],
        ]),
      );
      expect(day?.toolReliability).toEqual(
        new Map([
          ["read", { tool: "read", success: 1, error: 0, total: 1 }],
          [
            "github_search",
            { tool: "github_search", success: 0, error: 1, total: 1 },
          ],
          ["bash", { tool: "bash", success: 1, error: 0, total: 1 }],
        ]),
      );
      expect(day?.modelTokenTotals).toEqual(
        new Map([
          [
            "gpt-4.1\topenai",
            {
              model: "gpt-4.1",
              provider: "openai",
              inputTokens: 100,
              outputTokens: 80,
              cacheReadTokens: 40,
              cacheWriteTokens: 5,
              nonCacheInputTokens: 100,
              inputTotalTokens: 145,
              totalTokens: 180,
            },
          ],
          [
            "gpt-4.1-mini\topenai",
            {
              model: "gpt-4.1-mini",
              provider: "openai",
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              nonCacheInputTokens: 10,
              inputTotalTokens: 10,
              totalTokens: 30,
            },
          ],
          [
            "gpt-5.3-codex-spark\topenai",
            {
              model: "gpt-5.3-codex-spark",
              provider: "openai",
              inputTokens: 4,
              outputTokens: 8,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              nonCacheInputTokens: 4,
              inputTotalTokens: 4,
              totalTokens: 12,
            },
          ],
        ]),
      );

      expect(atom?.modelPerformanceSamples.get("gpt-4.1\topenai")).toMatchObject({
        model: "gpt-4.1",
        provider: "openai",
        sumOutputTokens: 80,
        sumDurationMs: 5_000,
        validTpsMessages: 2,
        validLatencyMessages: 2,
        totalMessages: 2,
        outputTokens: 80,
        reasoningTokens: 20,
      });
      expect(
        atom?.modelPerformanceSamples.get("gpt-4.1\topenai")?.latencySamplesMs,
      ).toEqual([3_000, 2_000]);
      expect(
        atom?.modelPerformanceSamples.get("gpt-4.1-mini\topenai")?.tpsSamples,
      ).toEqual([8]);
      expect(
        atom?.modelPerformanceSamples.get("gpt-5.3-codex-spark\topenai")
          ?.tpsSamples,
      ).toEqual([4]);
    });
  });

  test("rebuilds a session atom without double counting updated rows", () => {
    withWritableDb((db) => {
      const before = rebuildDashboardSessionAtom(
        db,
        ROOT_SESSION_ID,
        readSourceStamp(db),
        FIXTURE_NOW.toISOString(),
      );

      db.prepare("UPDATE session SET time_updated = ? WHERE id = ?").run(
        FIXTURE_NOW.getTime() + 120_000,
        CHILD_SESSION_ID,
      );
      db.prepare("UPDATE message SET time_updated = ?, data = ? WHERE id = ?").run(
        FIXTURE_NOW.getTime() + 120_001,
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
      db.prepare("UPDATE part SET time_updated = ?, data = ? WHERE id = ?").run(
        FIXTURE_NOW.getTime() + 120_002,
        JSON.stringify({
          type: "tool",
          tool: "github_search",
          state: {
            status: "completed",
            input: { query: "open issue" },
            output: { ok: true },
          },
        }),
        "part-root-1-tool-subagent",
      );

      const after = rebuildDashboardSessionAtom(
        db,
        ROOT_SESSION_ID,
        readSourceStamp(db),
        new Date(FIXTURE_NOW.getTime() + 120_005).toISOString(),
      );

      const day = after?.days.get("2024-01-11");
      expect(day).toMatchObject({
        tokenTotals: {
          input: 124,
          output: 118,
          cacheRead: 40,
          cacheWrite: 5,
          reasoning: 22,
          total: 242,
        },
        toolStatus: {
          calls: 3,
          errors: 0,
        },
        repoActiveDurationMs: 35_000,
      });
      expect(day?.errorPatterns.size).toBe(0);
      expect(day?.toolErrorsByHour.size).toBe(0);
      expect(day?.toolReliability.get("github_search")).toEqual({
        tool: "github_search",
        success: 1,
        error: 0,
        total: 1,
      });
      expect(day?.mcpUsage.get("github")).toEqual({
        server: "github",
        calls: 1,
        errors: 0,
        isBuiltin: false,
      });
      expect(
        after?.modelPerformanceSamples.get("gpt-4.1-mini\topenai"),
      ).toMatchObject({
        sumOutputTokens: 30,
        sumDurationMs: 6_000,
        validTpsMessages: 1,
        validLatencyMessages: 1,
        totalMessages: 1,
        outputTokens: 30,
        reasoningTokens: 2,
      });

      const diff = diffDashboardSessionAtoms(before ?? null, after ?? null);
      expect(diff.addedDays).toEqual([]);
      expect(diff.removedDays).toEqual([]);
      expect(diff.changedDays).toHaveLength(1);
      expect(diff.changedDays[0]).toMatchObject({
        day: "2024-01-11",
        delta: {
          tokenTotals: {
            input: 10,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 2,
            total: 20,
          },
          toolStatus: {
            calls: 0,
            errors: -1,
          },
          repoActiveDurationMs: 0,
        },
      });
      expect(diff.changedDays[0]?.delta.errorPatterns).toEqual(
        new Map([["Network/HTTP error", -1]]),
      );
      expect(diff.changedDays[0]?.delta.toolErrorsByHour).toEqual(
        new Map([["10", -1]]),
      );
    });
  });

  test("diffs added removed and changed day contributions with signed deltas", () => {
    withWritableDb((db) => {
      const before = rebuildDashboardSessionAtom(
        db,
        ROOT_SESSION_ID,
        readSourceStamp(db),
        FIXTURE_NOW.toISOString(),
      );

      const nextDayCreatedAt = new Date("2024-01-12T00:05:00.000Z").getTime();
      const expectedNextDayActiveDurationMs =
        nextDayCreatedAt - new Date("2024-01-11T10:22:45.000Z").getTime();
      db.prepare(
        `
          INSERT INTO message (id, session_id, time_created, time_updated, data)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run(
        "msg-child-1-follow-up",
        CHILD_SESSION_ID,
        nextDayCreatedAt,
        nextDayCreatedAt,
        JSON.stringify({
          role: "assistant",
          time: { created: nextDayCreatedAt, completed: nextDayCreatedAt + 2_000 },
          modelID: "gpt-4.1-mini",
          providerID: "openai",
          agent: "subagent-code",
          tokens: { total: 18, input: 8, output: 10 },
        }),
      );

      const withAddedDay = rebuildDashboardSessionAtom(
        db,
        ROOT_SESSION_ID,
        readSourceStamp(db),
        new Date(FIXTURE_NOW.getTime() + 2_000).toISOString(),
      );
      const addedDiff = diffDashboardSessionAtoms(before ?? null, withAddedDay ?? null);
      expect(addedDiff.addedDays).toHaveLength(1);
      expect(addedDiff.addedDays[0]).toMatchObject({
        day: "2024-01-12",
        delta: {
          tokenTotals: {
            input: 8,
            output: 10,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            total: 18,
          },
          repoActiveDurationMs: expectedNextDayActiveDurationMs,
        },
      });

      db.prepare("DELETE FROM message WHERE id = ?").run("msg-child-1-follow-up");
      const removedDay = rebuildDashboardSessionAtom(
        db,
        ROOT_SESSION_ID,
        readSourceStamp(db),
        new Date(FIXTURE_NOW.getTime() + 4_000).toISOString(),
      );
      const removedDiff = diffDashboardSessionAtoms(
        withAddedDay ?? null,
        removedDay ?? null,
      );
      expect(removedDiff.removedDays).toHaveLength(1);
      expect(removedDiff.removedDays[0]).toMatchObject({
        day: "2024-01-12",
        delta: {
          tokenTotals: {
            input: -8,
            output: -10,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            total: -18,
          },
          repoActiveDurationMs: -expectedNextDayActiveDurationMs,
        },
      });
    });
  });
});
