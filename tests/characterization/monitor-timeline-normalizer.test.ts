import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { isCleanTimelineMeta } from "../../src/contracts/monitor-timeline.js";
import {
  ingestMonitorRuntimeEvent,
  resetMonitorRuntimeStoreForTest,
  subscribeMonitorTimelineEvents,
} from "../../src/server/monitor-runtime-store.js";

function collectTimelineEvents() {
  const events: Array<
    Parameters<Parameters<typeof subscribeMonitorTimelineEvents>[0]>[0]
  > = [];
  const unsubscribe = subscribeMonitorTimelineEvents((event) => {
    events.push(event);
  });

  return {
    events,
    unsubscribe,
  };
}

describe("monitor timeline normalizer characterization", () => {
  beforeEach(() => {
    resetMonitorRuntimeStoreForTest();
  });

  afterAll(() => {
    resetMonitorRuntimeStoreForTest();
  });

  test("maps ingest events into the v1 timeline taxonomy without leaking sensitive payloads", () => {
    const { events, unsubscribe } = collectTimelineEvents();

    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "timeline-source-1",
        label: "terminal-a",
      },
      heartbeat: {
        at: "2026-03-25T10:00:00.000Z",
        activeSessionIds: ["ses-root-1", "ses-heartbeat-only"],
      },
      events: [
        {
          type: "session.created",
          session: {
            id: "ses-root-1",
            title: "Root session",
            directory: "/workspace/root",
            updatedAt: "2026-03-25T10:00:01.000Z",
          },
        },
        {
          type: "session.created",
          session: {
            id: "ses-child-1",
            parentId: "ses-root-1",
            title: "Child session",
            directory: "/workspace/root",
            updatedAt: "2026-03-25T10:00:02.000Z",
          },
        },
        {
          type: "session.status",
          session: {
            id: "ses-root-1",
            updatedAt: "2026-03-25T10:00:03.000Z",
          },
          status: "retry",
        },
        {
          type: "session.error",
          session: {
            id: "ses-root-1",
            updatedAt: "2026-03-25T10:00:04.000Z",
          },
          error: "stack trace should never reach timeline",
          stackTrace: "Error: secret stack",
        },
        {
          type: "session.alert",
          session: {
            id: "ses-root-1",
            updatedAt: "2026-03-25T10:00:05.000Z",
          },
          at: "2026-03-25T10:00:05.500Z",
          category: "network",
          level: "error",
          message: "provider retry said secret body",
          prompt: "do not leak prompt",
          toolArgs: { dangerous: true },
        },
        {
          type: "todo.updated",
          sessionId: "ses-root-1",
          openCount: 3,
          session: {
            id: "ses-root-1",
            updatedAt: "2026-03-25T10:00:06.000Z",
          },
          content: "hidden todo body",
        },
      ],
    } as unknown);

    unsubscribe();

    expect(events).toHaveLength(6);
    expect(events.map((event) => event.kind)).toEqual([
      "session-created",
      "subagent-started",
      "status-changed",
      "error",
      "alert",
      "todo-updated",
    ]);
    expect(events.map((event) => event.serverSeq)).toEqual([1, 2, 3, 4, 5, 6]);

    expect(events[0]).toMatchObject({
      sourceId: "timeline-source-1",
      rootSessionId: "ses-root-1",
      sessionId: "ses-root-1",
      kind: "session-created",
      label: "Session created",
      meta: {},
    });
    expect(events[1]).toMatchObject({
      rootSessionId: "ses-root-1",
      sessionId: "ses-child-1",
      kind: "subagent-started",
      label: "Subagent started",
      meta: { childSessionId: "ses-child-1" },
    });
    expect(events[2]).toMatchObject({
      kind: "status-changed",
      label: "Status: retry",
      severity: "warning",
      meta: { status: "retry" },
    });
    expect(events[3]).toMatchObject({
      kind: "error",
      label: "Session error",
      severity: "error",
      meta: {},
    });
    expect(events[4]).toMatchObject({
      kind: "alert",
      label: "Alert: network",
      severity: "error",
      at: "2026-03-25T10:00:05.500Z",
      meta: { category: "network", level: "error" },
    });
    expect(events[5]).toMatchObject({
      kind: "todo-updated",
      label: "Todo updated",
      meta: { todoCount: 3 },
    });

    expect(events.every((event) => event.receivedAt.length > 0)).toBe(true);
    expect(
      events.every((event) =>
        isCleanTimelineMeta(event.meta as Record<string, unknown>),
      ),
    ).toBe(true);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("stack trace should never reach timeline");
    expect(serialized).not.toContain("Error: secret stack");
    expect(serialized).not.toContain("provider retry said secret body");
    expect(serialized).not.toContain("do not leak prompt");
    expect(serialized).not.toContain("hidden todo body");
    expect(serialized).not.toContain('"message"');
    expect(serialized).not.toContain('"prompt"');
    expect(serialized).not.toContain('"stackTrace"');
    expect(serialized).not.toContain('"toolArgs"');
    expect(serialized).not.toContain('"content"');
    expect(serialized).not.toContain("ses-heartbeat-only");
  });

  test("heartbeat-derived implicit upserts do not emit timeline events", () => {
    const { events, unsubscribe } = collectTimelineEvents();

    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "timeline-source-2",
      },
      heartbeat: {
        at: "2026-03-25T11:00:00.000Z",
        activeSessionIds: ["ses-implicit-1"],
      },
    });

    unsubscribe();

    expect(events).toEqual([]);
  });

  test("ordering is determined by serverSeq rather than plugin timestamps and compaction uses cumulative count", () => {
    const { events, unsubscribe } = collectTimelineEvents();

    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "timeline-source-3",
      },
      events: [
        {
          type: "session.upsert",
          session: {
            id: "ses-order-1",
            updatedAt: "2026-03-25T12:00:10.000Z",
            compactionCount: 4,
          },
        },
        {
          type: "session.compacted",
          session: {
            id: "ses-order-1",
            updatedAt: "2026-03-25T11:59:00.000Z",
          },
          increment: 2,
        },
        {
          type: "session.updated",
          session: {
            id: "ses-order-1",
            updatedAt: "2026-03-25T12:00:05.000Z",
          },
        },
      ],
    });

    unsubscribe();

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.serverSeq)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.kind)).toEqual([
      "session-updated",
      "compaction",
      "session-updated",
    ]);
    expect(Date.parse(events[1]!.at)).toBeLessThan(Date.parse(events[0]!.at));
    expect(events[1]).toMatchObject({
      kind: "compaction",
      meta: { compactionCount: 6 },
    });
    expect(events[1]!.serverSeq).toBeGreaterThan(events[0]!.serverSeq);
  });
});
