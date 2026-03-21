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
    expect(snapshot.signalBadges).toHaveLength(4);
    // No active sessions → "success" level for active badge, count 0
    const activeBadge = snapshot.signalBadges.find((b) => b.key === "active");
    expect(activeBadge?.count).toBe(0);
    expect(activeBadge?.level).toBe("success");
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
    expect(session.signalLevel).toBe("warning"); // has compactions + todos

    expect(snapshot.compactionCounts).toEqual({
      main: 2,
      subagent: 0,
      total: 2,
    });

    const activeBadge = snapshot.signalBadges.find((b) => b.key === "active");
    expect(activeBadge?.count).toBe(1);

    const subBadge = snapshot.signalBadges.find((b) => b.key === "subagent");
    expect(subBadge?.count).toBe(1);
    expect(subBadge?.level).toBe("info");

    const todoBadge = snapshot.signalBadges.find((b) => b.key === "todos");
    expect(todoBadge?.count).toBe(1);
    expect(todoBadge?.level).toBe("warning");

    const retryBadge = snapshot.signalBadges.find((b) => b.key === "retry");
    expect(retryBadge?.count).toBe(0);
    expect(retryBadge?.level).toBe("success");
  });

  test("session.error event sets signal level to error", () => {
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
    expect(snapshot.activeRootSessions[0].signalLevel).toBe("error");

    const retryBadge = snapshot.signalBadges.find((b) => b.key === "retry");
    expect(retryBadge?.count).toBe(1);
    expect(retryBadge?.level).toBe("error");
  });
});
