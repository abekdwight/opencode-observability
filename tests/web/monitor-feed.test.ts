import { describe, expect, test } from "vitest";
import type { MonitorSessionSummary } from "../../src/contracts/monitor.js";
import {
  isLegacySourceSession,
  mergeRetainedMonitorSessions,
} from "../../web/hooks/use-monitor-feed.js";

function makeSession(
  id: string,
  overrides: Partial<MonitorSessionSummary> = {},
): MonitorSessionSummary {
  return {
    id,
    title: `Session ${id}`,
    directory: `/workspace/${id}`,
    createdAt: "2026-03-25T12:00:00.000Z",
    updatedAt: "2026-03-25T12:00:00.000Z",
    messageCount: 1,
    toolCallCount: 0,
    compactionCount: 0,
    subagentCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    inputRatioPercent: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokenUsage: [],
    ...overrides,
  };
}

describe("useMonitorFeed helpers", () => {
  test("isLegacySourceSession detects source placeholder ids", () => {
    expect(isLegacySourceSession({ id: "source:host.local:7768" })).toBe(true);
    expect(isLegacySourceSession({ id: "ses-real-1" })).toBe(false);
  });

  test("mergeRetainedMonitorSessions keeps a seen real session after later snapshots drop it", () => {
    const retained = mergeRetainedMonitorSessions(
      [],
      [makeSession("ses-real-1")],
    );
    const next = mergeRetainedMonitorSessions(retained, []);
    expect(next.map((session: MonitorSessionSummary) => session.id)).toEqual([
      "ses-real-1",
    ]);
  });

  test("mergeRetainedMonitorSessions refreshes a real session when it reappears", () => {
    const retained = mergeRetainedMonitorSessions(
      [],
      [makeSession("ses-real-1")],
    );
    const refreshed = mergeRetainedMonitorSessions(retained, [
      makeSession("ses-real-1", {
        title: "Renamed Session",
        updatedAt: "2026-03-25T12:05:00.000Z",
        messageCount: 9,
      }),
    ]);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.title).toBe("Renamed Session");
    expect(refreshed[0]?.messageCount).toBe(9);
  });

  test("mergeRetainedMonitorSessions excludes legacy source placeholders from both inputs", () => {
    const retained = mergeRetainedMonitorSessions(
      [],
      [
        makeSession("source:host.local:7768", { title: "placeholder" }),
        makeSession("ses-real-1"),
      ],
    );
    const next = mergeRetainedMonitorSessions(retained, [
      makeSession("source:host.local:7768", { title: "placeholder-2" }),
    ]);
    expect(next.map((session: MonitorSessionSummary) => session.id)).toEqual([
      "ses-real-1",
    ]);
  });
});
