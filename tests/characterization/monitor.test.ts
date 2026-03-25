import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  buildMonitorSnapshotFromRuntime,
  ingestMonitorRuntimeEvent,
  resetMonitorRuntimeStoreForTest,
} from "../../src/server/monitor-runtime-store.js";

describe("monitor runtime store characterization", () => {
  beforeAll(() => {
    resetMonitorRuntimeStoreForTest();
  });

  afterAll(() => {
    resetMonitorRuntimeStoreForTest();
  });

  test("returns empty snapshot before any ingest", () => {
    resetMonitorRuntimeStoreForTest();

    const snapshot = buildMonitorSnapshotFromRuntime();

    expect(snapshot.kind).toBe("monitor.snapshot");
    expect(snapshot.activeRootSessions).toEqual([]);
    expect(snapshot.compactionCounts).toEqual({
      main: 0,
      subagent: 0,
      total: 0,
    });
    expect(snapshot.signalBadges.length).toBeGreaterThanOrEqual(4);
    const activeBadge = snapshot.signalBadges.find((b) => b.key === "active");
    expect(activeBadge?.count).toBe(0);
    const alertsBadge = snapshot.signalBadges.find((b) => b.key === "alerts");
    expect(alertsBadge?.count).toBe(0);
  });

  test("ingest heartbeat + session.upsert produces active root session in snapshot", () => {
    resetMonitorRuntimeStoreForTest();

    const result = ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-1",
        label: "terminal-main",
      },
      heartbeat: {
        at: new Date().toISOString(),
        activeSessionIds: ["ses-monitor-1"],
      },
      events: [
        {
          type: "session.upsert",
          session: {
            id: "ses-monitor-1",
            title: "Monitor test session",
            directory: "/workspace/monitor-test",
            updatedAt: new Date().toISOString(),
            messageCount: 5,
            toolCallCount: 3,
          },
        },
      ],
    });

    expect(result.acceptedEvents).toBe(2);
    const snapshot = result.snapshot;
    expect(snapshot.kind).toBe("monitor.snapshot");
    expect(snapshot.activeRootSessions).toHaveLength(1);

    const session = snapshot.activeRootSessions[0];
    expect(session.id).toBe("ses-monitor-1");
    expect(session.title).toBe("Monitor test session");
    expect(session.directory).toBe("/workspace/monitor-test");
    expect(session.messageCount).toBe(5);
    expect(session.toolCallCount).toBe(3);
    expect(session.compactionCount).toBe(0);
    expect(session.subagentCount).toBe(0);
  });

  test("snapshot includes subagent count and signal badges after subagent + todo events", () => {
    resetMonitorRuntimeStoreForTest();

    const now = new Date().toISOString();
    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-2",
        label: "sub-test",
      },
      heartbeat: {
        at: now,
        activeSessionIds: ["ses-parent-1"],
      },
      events: [
        {
          type: "session.upsert",
          session: {
            id: "ses-parent-1",
            title: "Parent session",
            directory: "/workspace/sub-test",
            updatedAt: now,
            messageCount: 10,
            toolCallCount: 8,
          },
        },
        {
          type: "session.upsert",
          session: {
            id: "ses-child-sub",
            title: "Child subagent",
            directory: "/workspace/sub-test",
            updatedAt: now,
            parentId: "ses-parent-1",
            messageCount: 3,
          },
        },
        {
          type: "session.compacted",
          session: { id: "ses-parent-1" },
          increment: 2,
        },
        {
          type: "todo.updated",
          sessionId: "ses-parent-1",
          openCount: 3,
        },
      ],
    });

    const snapshot = buildMonitorSnapshotFromRuntime();
    expect(snapshot.activeRootSessions).toHaveLength(1);

    const session = snapshot.activeRootSessions[0];
    expect(session.subagentCount).toBe(1);
    expect(session.compactionCount).toBe(2);

    expect(snapshot.compactionCounts).toEqual({
      main: 2,
      subagent: 0,
      total: 2,
    });

    const activeBadge = snapshot.signalBadges.find((b) => b.key === "active");
    expect(activeBadge?.count).toBe(1);

    const subBadge = snapshot.signalBadges.find((b) => b.key === "subagent");
    expect(subBadge?.count).toBe(1);

    const todoBadge = snapshot.signalBadges.find((b) => b.key === "todos");
    expect(todoBadge?.count).toBe(1);

    const retryBadge = snapshot.signalBadges.find((b) => b.key === "retry");
    expect(retryBadge?.count).toBe(0);
  });

  test("session.error event increments retry signal badge", () => {
    resetMonitorRuntimeStoreForTest();

    const now = new Date().toISOString();
    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-3",
        label: "error-test",
      },
      heartbeat: {
        at: now,
        activeSessionIds: ["ses-error-1"],
      },
      events: [
        {
          type: "session.upsert",
          session: {
            id: "ses-error-1",
            title: "Error session",
            directory: "/workspace/error-test",
            updatedAt: now,
          },
        },
        {
          type: "session.error",
          session: { id: "ses-error-1" },
          status: "retry",
        },
      ],
    });

    const snapshot = buildMonitorSnapshotFromRuntime();
    expect(snapshot.activeRootSessions).toHaveLength(1);

    const retryBadge = snapshot.signalBadges.find((b) => b.key === "retry");
    expect(retryBadge?.count).toBe(1);
  });

  test("heartbeat with empty activeSessionIds keeps known session visible as idle", () => {
    resetMonitorRuntimeStoreForTest();

    const now = new Date().toISOString();
    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-4",
      },
      heartbeat: {
        at: now,
        activeSessionIds: ["ses-keep-idle-1"],
      },
      event: {
        type: "session.upsert",
        session: {
          id: "ses-keep-idle-1",
          title: "Keep idle session",
          directory: "/workspace/idle-persistence",
          updatedAt: now,
        },
      },
    });

    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-4",
      },
      heartbeat: {
        at: now,
        activeSessionIds: [],
      },
    });

    const snapshot = buildMonitorSnapshotFromRuntime();
    expect(snapshot.activeRootSessions.map((session) => session.id)).toContain(
      "ses-keep-idle-1",
    );
  });

  test("session.alert events are aggregated into monitor signal badges", () => {
    resetMonitorRuntimeStoreForTest();

    const now = new Date().toISOString();
    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-5",
        label: "alerts-test",
      },
      heartbeat: {
        at: now,
        activeSessionIds: ["ses-alert-agg-1"],
      },
      events: [
        {
          type: "session.upsert",
          session: {
            id: "ses-alert-agg-1",
            title: "Alert aggregate session",
            directory: "/workspace/alerts",
            updatedAt: now,
          },
        },
        {
          type: "session.alert",
          category: "token",
          message: "token refresh failed",
          session: {
            id: "ses-alert-agg-1",
          },
        },
        {
          type: "session.alert",
          category: "network",
          message: "network retry triggered",
          session: {
            id: "ses-alert-agg-1",
          },
        },
      ],
    });

    const snapshot = buildMonitorSnapshotFromRuntime();
    const alertsBadge = snapshot.signalBadges.find((b) => b.key === "alerts");
    const tokenBadge = snapshot.signalBadges.find((b) => b.key === "token");
    const networkBadge = snapshot.signalBadges.find((b) => b.key === "network");

    expect(alertsBadge?.count).toBe(2);
    expect(tokenBadge?.count).toBe(1);
    expect(networkBadge?.count).toBe(1);
  });

  test("event-only ingest keeps source active until heartbeat arrives", () => {
    resetMonitorRuntimeStoreForTest();

    const now = new Date().toISOString();
    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-6",
      },
      event: {
        type: "session.upsert",
        session: {
          id: "ses-event-only-1",
          title: "Event only source",
          directory: "/workspace/event-only",
          updatedAt: now,
        },
      },
    });

    const snapshot = buildMonitorSnapshotFromRuntime();
    expect(snapshot.activeRootSessions.map((session) => session.id)).toContain(
      "ses-event-only-1",
    );
  });

  test("heartbeat with empty activeSessionIds does not create source pseudo-sessions", () => {
    resetMonitorRuntimeStoreForTest();

    const now = new Date().toISOString();
    ingestMonitorRuntimeEvent({
      source: {
        instanceId: "test-instance-empty",
        label: "empty-source",
      },
      heartbeat: {
        at: now,
        activeSessionIds: [],
      },
    });

    const snapshot = buildMonitorSnapshotFromRuntime();
    expect(snapshot.activeRootSessions).toEqual([]);
    expect(
      snapshot.activeRootSessions.some((session) =>
        session.id.startsWith("source:"),
      ),
    ).toBe(false);
  });
});
