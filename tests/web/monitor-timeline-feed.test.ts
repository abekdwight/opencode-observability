/**
 * Tests for the pure reducer and helpers exported by useMonitorTimelineFeed.
 *
 * These tests run in Node (vitest environment: "node") and exercise ONLY the
 * exported pure functions — no React, no EventSource, no browser globals.
 */

import { describe, expect, test } from "vitest";
import type { MonitorTimelineEventContract } from "../../src/contracts/monitor-timeline.js";
import type { TimelineSessionCache } from "../../web/hooks/use-monitor-timeline-feed.js";
import {
  bucketizeEvents,
  classifyEventLane,
  createInitialTimelineFeedState,
  insertTimelineEvent,
  selectActiveRootSessionIds,
  selectRecentEvents,
  selectSessionEvents,
  TIMELINE_BUCKET_COUNT,
  TIMELINE_CACHE_MAX_PER_SESSION,
  TIMELINE_OPERATOR_LANES,
  TIMELINE_WINDOW_MS,
  timelineFeedReducer,
} from "../../web/hooks/use-monitor-timeline-feed.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _seq = 0;
let _idCounter = 0;

function makeEvent(
  overrides: Partial<MonitorTimelineEventContract> & {
    rootSessionId: string;
    serverSeq?: number;
    eventId?: string;
  },
): MonitorTimelineEventContract {
  _seq += 1;
  _idCounter += 1;
  return {
    eventId: overrides.eventId ?? `evt-${_idCounter}`,
    serverSeq: overrides.serverSeq ?? _seq,
    sourceId: overrides.sourceId ?? "source-1",
    rootSessionId: overrides.rootSessionId,
    sessionId: overrides.sessionId ?? overrides.rootSessionId,
    at: overrides.at ?? new Date().toISOString(),
    receivedAt: overrides.receivedAt ?? new Date().toISOString(),
    label: overrides.label ?? "test event",
    severity: overrides.severity ?? "info",
    kind: overrides.kind ?? "session-updated",
    meta: overrides.meta ?? {},
  };
}

function resetCounters() {
  _seq = 0;
  _idCounter = 0;
}

// ---------------------------------------------------------------------------
// insertTimelineEvent helper
// ---------------------------------------------------------------------------

describe("insertTimelineEvent", () => {
  test("inserts first event into empty array", () => {
    resetCounters();
    const ev = makeEvent({ rootSessionId: "r1" });
    const result = insertTimelineEvent([], ev);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(ev);
  });

  test("deduplicates by eventId — returns same array reference", () => {
    resetCounters();
    const ev = makeEvent({ rootSessionId: "r1" });
    const withOne = insertTimelineEvent([], ev);
    const withDupe = insertTimelineEvent(withOne, ev);
    expect(withDupe).toBe(withOne);
  });

  test("deduplicates even when same eventId has different serverSeq (should not happen, but protected)", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "r1",
      eventId: "fixed-id",
      serverSeq: 1,
    });
    const withOne = insertTimelineEvent([], ev);
    const dupe = { ...ev, serverSeq: 99 };
    const result = insertTimelineEvent(withOne, dupe);
    expect(result).toBe(withOne);
    expect(result[0]?.serverSeq).toBe(1);
  });

  test("orders events ascending by serverSeq — appends when in order", () => {
    resetCounters();
    const ev1 = makeEvent({ rootSessionId: "r1", serverSeq: 1 });
    const ev2 = makeEvent({ rootSessionId: "r1", serverSeq: 2 });
    const ev3 = makeEvent({ rootSessionId: "r1", serverSeq: 3 });
    let result: TimelineSessionCache = [];
    for (const ev of [ev1, ev2, ev3]) {
      result = insertTimelineEvent(result, ev);
    }
    expect([...result].map((e) => e.serverSeq)).toEqual([1, 2, 3]);
  });

  test("orders events ascending by serverSeq — handles out-of-order arrival", () => {
    resetCounters();
    const ev3 = makeEvent({ rootSessionId: "r1", serverSeq: 3 });
    const ev1 = makeEvent({ rootSessionId: "r1", serverSeq: 1 });
    const ev2 = makeEvent({ rootSessionId: "r1", serverSeq: 2 });
    let result: TimelineSessionCache = [];
    for (const ev of [ev3, ev1, ev2]) {
      result = insertTimelineEvent(result, ev);
    }
    expect([...result].map((e) => e.serverSeq)).toEqual([1, 2, 3]);
  });

  test("evicts oldest events when TIMELINE_CACHE_MAX_PER_SESSION is exceeded", () => {
    resetCounters();
    let cache: MonitorTimelineEventContract[] = [];
    for (let i = 1; i <= TIMELINE_CACHE_MAX_PER_SESSION + 5; i++) {
      cache = insertTimelineEvent(
        cache,
        makeEvent({ rootSessionId: "r1", serverSeq: i }),
      ) as MonitorTimelineEventContract[];
    }
    expect(cache).toHaveLength(TIMELINE_CACHE_MAX_PER_SESSION);
    // Oldest (lowest serverSeq) should have been evicted
    expect(cache[0]?.serverSeq).toBe(6);
    expect(cache[cache.length - 1]?.serverSeq).toBe(
      TIMELINE_CACHE_MAX_PER_SESSION + 5,
    );
  });

  test("evicts oldest entries when inserting out-of-order event causes overflow", () => {
    resetCounters();
    let cache: MonitorTimelineEventContract[] = [];
    // Fill exactly to the cap with serverSeq 2..201
    for (let i = 2; i <= TIMELINE_CACHE_MAX_PER_SESSION + 1; i++) {
      cache = insertTimelineEvent(
        cache,
        makeEvent({ rootSessionId: "r1", serverSeq: i }),
      ) as MonitorTimelineEventContract[];
    }
    expect(cache).toHaveLength(TIMELINE_CACHE_MAX_PER_SESSION);

    // Insert a late-arriving event with serverSeq 1 (oldest) — should still evict from front
    const late = makeEvent({ rootSessionId: "r1", serverSeq: 1 });
    const after = insertTimelineEvent(
      cache,
      late,
    ) as MonitorTimelineEventContract[];
    expect(after).toHaveLength(TIMELINE_CACHE_MAX_PER_SESSION);
    // After insertion and eviction the first entry should be serverSeq 2
    expect(after[0]?.serverSeq).toBe(2);
  });

  test("does not mutate original array", () => {
    resetCounters();
    const ev1 = makeEvent({ rootSessionId: "r1", serverSeq: 1 });
    const original: MonitorTimelineEventContract[] = [];
    const result = insertTimelineEvent(original, ev1);
    expect(original).toHaveLength(0);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// timelineFeedReducer — initial state
// ---------------------------------------------------------------------------

describe("timelineFeedReducer — initial state", () => {
  test("createInitialTimelineFeedState returns expected shape", () => {
    const state = createInitialTimelineFeedState();
    expect(state.feedState).toBe("loading");
    expect(state.cache.size).toBe(0);
    expect(state.lastHeartbeatAt).toBeNull();
    expect(state.liveOnlyNotice).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// timelineFeedReducer — CONNECTING / CONNECTED / DISCONNECTED
// ---------------------------------------------------------------------------

describe("timelineFeedReducer — connection lifecycle", () => {
  test("CONNECTING from loading stays loading", () => {
    const s0 = createInitialTimelineFeedState();
    const s1 = timelineFeedReducer(s0, { type: "CONNECTING" });
    expect(s1.feedState).toBe("loading");
  });

  test("CONNECTING from live transitions to reconnecting", () => {
    const s0 = {
      ...createInitialTimelineFeedState(),
      feedState: "live" as const,
    };
    const s1 = timelineFeedReducer(s0, { type: "CONNECTING" });
    expect(s1.feedState).toBe("reconnecting");
  });

  test("CONNECTED transitions to live and sets liveOnlyNotice true", () => {
    const s0 = createInitialTimelineFeedState();
    const s1 = timelineFeedReducer(s0, { type: "CONNECTED" });
    expect(s1.feedState).toBe("live");
    expect(s1.liveOnlyNotice).toBe(true);
  });

  test("DISCONNECTED transitions to disconnected", () => {
    const s0 = {
      ...createInitialTimelineFeedState(),
      feedState: "live" as const,
    };
    const s1 = timelineFeedReducer(s0, { type: "DISCONNECTED" });
    expect(s1.feedState).toBe("disconnected");
  });

  test("DISCONNECTED before reconnect keeps disconnected reachable until next CONNECTING", () => {
    const s0 = {
      ...createInitialTimelineFeedState(),
      feedState: "live" as const,
    };
    const s1 = timelineFeedReducer(s0, { type: "DISCONNECTED" });
    expect(s1.feedState).toBe("disconnected");

    const s2 = timelineFeedReducer(s1, { type: "CONNECTING" });
    expect(s2.feedState).toBe("loading");
  });
});

// ---------------------------------------------------------------------------
// timelineFeedReducer — HEARTBEAT
// ---------------------------------------------------------------------------

describe("timelineFeedReducer — HEARTBEAT", () => {
  test("HEARTBEAT sets feedState to live and records lastHeartbeatAt", () => {
    const s0 = createInitialTimelineFeedState();
    const at = "2026-03-25T10:00:00.000Z";
    const s1 = timelineFeedReducer(s0, { type: "HEARTBEAT", at });
    expect(s1.feedState).toBe("live");
    expect(s1.lastHeartbeatAt).toBe(at);
  });

  test("HEARTBEAT does NOT add any entry to the event cache", () => {
    const s0 = createInitialTimelineFeedState();
    const s1 = timelineFeedReducer(s0, {
      type: "HEARTBEAT",
      at: "2026-03-25T10:00:00.000Z",
    });
    expect(s1.cache.size).toBe(0);
  });

  test("multiple HEARTBEATs update lastHeartbeatAt to most recent", () => {
    const s0 = createInitialTimelineFeedState();
    const s1 = timelineFeedReducer(s0, {
      type: "HEARTBEAT",
      at: "2026-03-25T09:00:00.000Z",
    });
    const s2 = timelineFeedReducer(s1, {
      type: "HEARTBEAT",
      at: "2026-03-25T10:00:00.000Z",
    });
    expect(s2.lastHeartbeatAt).toBe("2026-03-25T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// timelineFeedReducer — EVENT
// ---------------------------------------------------------------------------

describe("timelineFeedReducer — EVENT", () => {
  test("single EVENT creates a new cache entry for the rootSessionId", () => {
    resetCounters();
    const s0 = createInitialTimelineFeedState();
    const ev = makeEvent({ rootSessionId: "session-A", serverSeq: 1 });
    const s1 = timelineFeedReducer(s0, { type: "EVENT", event: ev });
    expect(s1.cache.size).toBe(1);
    expect(s1.cache.get("session-A")).toHaveLength(1);
    expect(s1.cache.get("session-A")?.[0]).toBe(ev);
  });

  test("events are grouped by rootSessionId", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    const evA = makeEvent({ rootSessionId: "A", serverSeq: 1 });
    const evB = makeEvent({ rootSessionId: "B", serverSeq: 2 });
    const evA2 = makeEvent({ rootSessionId: "A", serverSeq: 3 });
    state = timelineFeedReducer(state, { type: "EVENT", event: evA });
    state = timelineFeedReducer(state, { type: "EVENT", event: evB });
    state = timelineFeedReducer(state, { type: "EVENT", event: evA2 });

    expect(state.cache.size).toBe(2);
    expect(state.cache.get("A")).toHaveLength(2);
    expect(state.cache.get("B")).toHaveLength(1);
  });

  test("events within a session are ordered by serverSeq ascending", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    // Deliver out of order
    const ev3 = makeEvent({ rootSessionId: "R", serverSeq: 3 });
    const ev1 = makeEvent({ rootSessionId: "R", serverSeq: 1 });
    const ev2 = makeEvent({ rootSessionId: "R", serverSeq: 2 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev3 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev2 });

    const events = state.cache.get("R");
    expect(events?.map((e) => e.serverSeq)).toEqual([1, 2, 3]);
  });

  test("duplicate eventId is ignored — state reference unchanged for that session", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    const ev = makeEvent({ rootSessionId: "R", serverSeq: 1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev });
    const before = state.cache.get("R");
    // Dispatch same event again
    const state2 = timelineFeedReducer(state, { type: "EVENT", event: ev });
    expect(state2).toBe(state);
    expect(state2.cache.get("R")).toBe(before);
  });

  test("EVENT sets feedState to live", () => {
    resetCounters();
    const s0 = createInitialTimelineFeedState();
    expect(s0.feedState).toBe("loading");
    const ev = makeEvent({ rootSessionId: "R", serverSeq: 1 });
    const s1 = timelineFeedReducer(s0, { type: "EVENT", event: ev });
    expect(s1.feedState).toBe("live");
  });

  test("session cache is evicted to TIMELINE_CACHE_MAX_PER_SESSION when overflow", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    for (let i = 1; i <= TIMELINE_CACHE_MAX_PER_SESSION + 10; i++) {
      const ev = makeEvent({ rootSessionId: "R", serverSeq: i });
      state = timelineFeedReducer(state, { type: "EVENT", event: ev });
    }
    const events = state.cache.get("R");
    expect(events).toHaveLength(TIMELINE_CACHE_MAX_PER_SESSION);
    // Oldest should be evicted (first serverSeq present = 11)
    expect(events?.[0]?.serverSeq).toBe(11);
  });

  test("events for different sessions do not interfere with each other's caps", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    // Fill session A to exactly the cap
    for (let i = 1; i <= TIMELINE_CACHE_MAX_PER_SESSION; i++) {
      const ev = makeEvent({ rootSessionId: "A", serverSeq: i });
      state = timelineFeedReducer(state, { type: "EVENT", event: ev });
    }
    // Add one more to session B
    const evB = makeEvent({ rootSessionId: "B", serverSeq: 1000 });
    state = timelineFeedReducer(state, { type: "EVENT", event: evB });

    expect(state.cache.get("A")).toHaveLength(TIMELINE_CACHE_MAX_PER_SESSION);
    expect(state.cache.get("B")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// timelineFeedReducer — RESET (source-reset / page navigation)
// ---------------------------------------------------------------------------

describe("timelineFeedReducer — RESET", () => {
  test("RESET clears the entire cache", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    const ev = makeEvent({ rootSessionId: "R", serverSeq: 1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev });
    expect(state.cache.size).toBe(1);

    const reset = timelineFeedReducer(state, { type: "RESET" });
    expect(reset.cache.size).toBe(0);
  });

  test("RESET sets feedState back to loading", () => {
    const state = {
      ...createInitialTimelineFeedState(),
      feedState: "live" as const,
    };
    const reset = timelineFeedReducer(state, { type: "RESET" });
    expect(reset.feedState).toBe("loading");
  });

  test("RESET clears lastHeartbeatAt", () => {
    const state = {
      ...createInitialTimelineFeedState(),
      lastHeartbeatAt: "2026-03-25T10:00:00.000Z",
    };
    const reset = timelineFeedReducer(state, { type: "RESET" });
    expect(reset.lastHeartbeatAt).toBeNull();
  });

  test("RESET after source change does not leak old cache into new session", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    for (let i = 1; i <= 5; i++) {
      state = timelineFeedReducer(state, {
        type: "EVENT",
        event: makeEvent({ rootSessionId: "old-session", serverSeq: i }),
      });
    }
    expect(state.cache.get("old-session")).toHaveLength(5);

    // Simulate source reset (effect cleanup)
    state = timelineFeedReducer(state, { type: "RESET" });
    expect(state.cache.size).toBe(0);

    // New events after reconnect go into fresh cache
    const newEv = makeEvent({ rootSessionId: "new-session", serverSeq: 1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: newEv });
    expect(state.cache.size).toBe(1);
    expect(state.cache.get("new-session")).toHaveLength(1);
    expect(state.cache.get("old-session")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Source-key-driven reset behaviour (mirrors useMonitorTimelineFeed sourceKey
  // option: changing sourceKey causes React to tear down the effect, which
  // dispatches RESET before reconnecting with fresh state).
  // -------------------------------------------------------------------------

  test("source change: RESET followed by new-source events produces a completely separate cache", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();

    // Lifecycle for source-key "src-A"
    state = timelineFeedReducer(state, { type: "CONNECTING" });
    state = timelineFeedReducer(state, { type: "CONNECTED" });
    for (let i = 1; i <= 3; i++) {
      state = timelineFeedReducer(state, {
        type: "EVENT",
        event: makeEvent({
          rootSessionId: "ses-A",
          serverSeq: i,
          sourceId: "src-A",
        }),
      });
    }
    expect(state.cache.get("ses-A")).toHaveLength(3);
    expect(state.feedState).toBe("live");

    // Source key changes: React runs the effect cleanup → RESET
    state = timelineFeedReducer(state, { type: "RESET" });
    expect(state.cache.size).toBe(0);
    expect(state.feedState).toBe("loading");
    expect(state.lastHeartbeatAt).toBeNull();

    // React then runs the new effect → CONNECTING → CONNECTED
    state = timelineFeedReducer(state, { type: "CONNECTING" });
    state = timelineFeedReducer(state, { type: "CONNECTED" });

    // Events from the new source arrive
    for (let i = 1; i <= 2; i++) {
      state = timelineFeedReducer(state, {
        type: "EVENT",
        event: makeEvent({
          rootSessionId: "ses-B",
          serverSeq: i,
          sourceId: "src-B",
        }),
      });
    }

    // Only new-source data is present; old source data is gone
    expect(state.cache.size).toBe(1);
    expect(state.cache.get("ses-B")).toHaveLength(2);
    expect(state.cache.get("ses-A")).toBeUndefined();
    expect(state.feedState).toBe("live");
  });

  test("source change: eventId from old source cannot re-enter cache after RESET", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();

    // Old-source event
    const oldEv = makeEvent({
      rootSessionId: "ses-old",
      serverSeq: 1,
      eventId: "stable-event-id",
      sourceId: "src-old",
    });
    state = timelineFeedReducer(state, { type: "EVENT", event: oldEv });
    expect(state.cache.get("ses-old")).toHaveLength(1);

    // Source changes — RESET clears cache
    state = timelineFeedReducer(state, { type: "RESET" });
    expect(state.cache.size).toBe(0);

    // The same eventId (reused for whatever reason) now arrives for the new source
    const reusedEv = makeEvent({
      rootSessionId: "ses-new",
      serverSeq: 2,
      eventId: "stable-event-id",
      sourceId: "src-new",
    });
    state = timelineFeedReducer(state, { type: "EVENT", event: reusedEv });

    // It enters the new session cache because the old cache was wiped
    expect(state.cache.get("ses-new")).toHaveLength(1);
    expect(state.cache.get("ses-new")?.[0]?.sourceId).toBe("src-new");
    expect(state.cache.get("ses-old")).toBeUndefined();
  });

  test("source change: heartbeat from old source lifecycle does not update state after RESET", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    state = timelineFeedReducer(state, {
      type: "HEARTBEAT",
      at: "2026-03-25T09:00:00.000Z",
    });
    expect(state.lastHeartbeatAt).toBe("2026-03-25T09:00:00.000Z");

    // Source changes — RESET clears heartbeat timestamp
    state = timelineFeedReducer(state, { type: "RESET" });
    expect(state.lastHeartbeatAt).toBeNull();
    expect(state.feedState).toBe("loading");
  });
});

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

describe("selectors", () => {
  test("selectSessionEvents returns empty array for unknown rootSessionId", () => {
    const state = createInitialTimelineFeedState();
    expect(selectSessionEvents(state, "unknown")).toEqual([]);
  });

  test("selectSessionEvents returns ordered events for known rootSessionId", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    const ev2 = makeEvent({ rootSessionId: "R", serverSeq: 2 });
    const ev1 = makeEvent({ rootSessionId: "R", serverSeq: 1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev2 });
    state = timelineFeedReducer(state, { type: "EVENT", event: ev1 });
    const events = selectSessionEvents(state, "R");
    expect(events.map((e) => e.serverSeq)).toEqual([1, 2]);
  });

  test("selectActiveRootSessionIds returns all session ids with events", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    state = timelineFeedReducer(state, {
      type: "EVENT",
      event: makeEvent({ rootSessionId: "A" }),
    });
    state = timelineFeedReducer(state, {
      type: "EVENT",
      event: makeEvent({ rootSessionId: "B" }),
    });
    const ids = selectActiveRootSessionIds(state);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("A");
    expect(ids).toContain("B");
  });

  test("selectActiveRootSessionIds returns empty array when cache is empty", () => {
    expect(
      selectActiveRootSessionIds(createInitialTimelineFeedState()),
    ).toEqual([]);
  });

  test("selectRecentEvents returns events across all sessions ordered by serverSeq", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    const evA1 = makeEvent({ rootSessionId: "A", serverSeq: 1 });
    const evB1 = makeEvent({ rootSessionId: "B", serverSeq: 2 });
    const evA2 = makeEvent({ rootSessionId: "A", serverSeq: 3 });
    state = timelineFeedReducer(state, { type: "EVENT", event: evA1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: evB1 });
    state = timelineFeedReducer(state, { type: "EVENT", event: evA2 });

    const recent = selectRecentEvents(state, 10);
    expect(recent.map((e) => e.serverSeq)).toEqual([1, 2, 3]);
  });

  test("selectRecentEvents respects the limit — returns most recent N", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    for (let i = 1; i <= 10; i++) {
      state = timelineFeedReducer(state, {
        type: "EVENT",
        event: makeEvent({ rootSessionId: "R", serverSeq: i }),
      });
    }
    const recent = selectRecentEvents(state, 3);
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.serverSeq)).toEqual([8, 9, 10]);
  });

  test("selectRecentEvents with limit=0 returns all events", () => {
    resetCounters();
    let state = createInitialTimelineFeedState();
    for (let i = 1; i <= 5; i++) {
      state = timelineFeedReducer(state, {
        type: "EVENT",
        event: makeEvent({ rootSessionId: "R", serverSeq: i }),
      });
    }
    const all = selectRecentEvents(state, 0);
    expect(all).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// classifyEventLane — operator-lane classification
// ---------------------------------------------------------------------------

describe("classifyEventLane", () => {
  test("error kind → failure", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "error",
      severity: "error",
    });
    expect(classifyEventLane(ev)).toBe("failure");
  });

  test("alert kind with level=error → failure", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "alert",
      severity: "error",
      meta: { level: "error", category: "network" },
    });
    expect(classifyEventLane(ev)).toBe("failure");
  });

  test("alert kind with level=warning → pressure", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "alert",
      severity: "warning",
      meta: { level: "warning", category: "token" },
    });
    expect(classifyEventLane(ev)).toBe("pressure");
  });

  test("alert kind without explicit level → pressure (default)", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "alert",
      severity: "warning",
      meta: { category: "model" },
    });
    expect(classifyEventLane(ev)).toBe("pressure");
  });

  test("compaction kind → pressure", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "compaction",
      severity: "warning",
      meta: { compactionCount: 3 },
    });
    expect(classifyEventLane(ev)).toBe("pressure");
  });

  test("status-changed with status=retry → pressure", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "status-changed",
      severity: "warning",
      meta: { status: "retry" },
    });
    expect(classifyEventLane(ev)).toBe("pressure");
  });

  test("status-changed with status=busy → activity", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "status-changed",
      severity: "info",
      meta: { status: "busy" },
    });
    expect(classifyEventLane(ev)).toBe("activity");
  });

  test("status-changed with status=idle → activity", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "status-changed",
      severity: "info",
      meta: { status: "idle" },
    });
    expect(classifyEventLane(ev)).toBe("activity");
  });

  test("subagent-started → subagent", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "subagent-started",
      severity: "info",
      meta: { childSessionId: "child-1" },
    });
    expect(classifyEventLane(ev)).toBe("subagent");
  });

  test("session-created → activity", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "session-created",
      severity: "info",
    });
    expect(classifyEventLane(ev)).toBe("activity");
  });

  test("session-updated → activity", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "session-updated",
      severity: "info",
    });
    expect(classifyEventLane(ev)).toBe("activity");
  });

  test("todo-updated → activity", () => {
    resetCounters();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "todo-updated",
      severity: "info",
      meta: { todoCount: 5 },
    });
    expect(classifyEventLane(ev)).toBe("activity");
  });
});

// ---------------------------------------------------------------------------
// bucketizeEvents — operator-lane bucketing
// ---------------------------------------------------------------------------

describe("bucketizeEvents", () => {
  test("returns exactly TIMELINE_BUCKET_COUNT buckets", () => {
    const buckets = bucketizeEvents([], Date.now());
    expect(buckets).toHaveLength(TIMELINE_BUCKET_COUNT);
  });

  test("empty input produces all-zero buckets", () => {
    const buckets = bucketizeEvents([], Date.now());
    for (const bucket of buckets) {
      expect(bucket.total).toBe(0);
      for (const lane of TIMELINE_OPERATOR_LANES) {
        expect(bucket.counts[lane]).toBe(0);
      }
    }
  });

  test("event within window lands in the correct bucket", () => {
    resetCounters();
    const nowMs = Date.now();
    // Place event 30 seconds ago → should be in a recent bucket
    const evAt = new Date(nowMs - 30_000).toISOString();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "session-updated",
      severity: "info",
      at: evAt,
    });
    const buckets = bucketizeEvents([ev], nowMs);
    const totalEvents = buckets.reduce((sum, b) => sum + b.total, 0);
    expect(totalEvents).toBe(1);
    // Should land in the activity lane
    const activeBucket = buckets.find((b) => b.counts.activity > 0);
    expect(activeBucket).toBeDefined();
  });

  test("event outside window is dropped", () => {
    resetCounters();
    const nowMs = Date.now();
    // Place event 10 minutes ago → outside the 5-minute window
    const evAt = new Date(nowMs - 10 * 60 * 1000).toISOString();
    const ev = makeEvent({
      rootSessionId: "R",
      kind: "error",
      severity: "error",
      at: evAt,
    });
    const buckets = bucketizeEvents([ev], nowMs);
    const totalEvents = buckets.reduce((sum, b) => sum + b.total, 0);
    expect(totalEvents).toBe(0);
  });

  test("events are classified into correct operator lanes", () => {
    resetCounters();
    const nowMs = Date.now();
    const recentAt = new Date(nowMs - 5_000).toISOString();

    const errorEv = makeEvent({
      rootSessionId: "R",
      kind: "error",
      severity: "error",
      at: recentAt,
    });
    const alertEv = makeEvent({
      rootSessionId: "R",
      kind: "alert",
      severity: "warning",
      meta: { level: "warning", category: "token" },
      at: recentAt,
    });
    const compactionEv = makeEvent({
      rootSessionId: "R",
      kind: "compaction",
      severity: "warning",
      meta: { compactionCount: 2 },
      at: recentAt,
    });
    const subagentEv = makeEvent({
      rootSessionId: "R",
      kind: "subagent-started",
      severity: "info",
      meta: { childSessionId: "child-1" },
      at: recentAt,
    });
    const activityEv = makeEvent({
      rootSessionId: "R",
      kind: "session-updated",
      severity: "info",
      at: recentAt,
    });

    const events = [errorEv, alertEv, compactionEv, subagentEv, activityEv];
    const buckets = bucketizeEvents(events, nowMs);

    // Sum across all buckets per lane
    const totals = { activity: 0, subagent: 0, pressure: 0, failure: 0 };
    for (const b of buckets) {
      for (const lane of TIMELINE_OPERATOR_LANES) {
        totals[lane] += b.counts[lane];
      }
    }

    expect(totals.failure).toBe(1); // error event
    expect(totals.pressure).toBe(2); // alert(warning) + compaction
    expect(totals.subagent).toBe(1); // subagent-started
    expect(totals.activity).toBe(1); // session-updated
  });

  test("bucket counts have all four lane keys", () => {
    const buckets = bucketizeEvents([], Date.now());
    for (const b of buckets) {
      expect(Object.keys(b.counts).sort()).toEqual(
        [...TIMELINE_OPERATOR_LANES].sort(),
      );
    }
  });
});
