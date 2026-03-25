import React from "react";
import type {
  MonitorTimelineEventContract,
  MonitorTimelineFeedMessageContract,
  MonitorTimelineFeedState,
} from "../../src/contracts/monitor-timeline.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Maximum events retained per root session in the in-memory cache. */
export const TIMELINE_CACHE_MAX_PER_SESSION = 200;

/** SSE endpoint for the timeline feed. */
export const TIMELINE_EVENTS_URL = "/api/monitor/timeline/events";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/**
 * Per-root-session ordered event list.
 * Entries are sorted ascending by `serverSeq`; duplicates (same `eventId`) are
 * not allowed.  Oldest events are evicted once the cap is reached.
 */
export type TimelineSessionCache = ReadonlyArray<MonitorTimelineEventContract>;

/**
 * Feed connection state exposed by the hook.
 *
 * - `loading`      — initial connection attempt, no events received yet
 * - `live`         — connected and receiving events / heartbeats normally
 * - `reconnecting` — connection lost, a reconnect attempt is in progress
 * - `disconnected` — EventSource is not connected (used before first connect
 *                    or after explicit teardown, e.g. during tests)
 */
export type TimelineFeedState = MonitorTimelineFeedState;

// ---------------------------------------------------------------------------
// Reducer action types
// ---------------------------------------------------------------------------

export type TimelineFeedAction =
  | { type: "CONNECTING" }
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "HEARTBEAT"; at: string }
  | { type: "EVENT"; event: MonitorTimelineEventContract }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Reducer state
// ---------------------------------------------------------------------------

export interface TimelineFeedReducerState {
  /** Connection health indicator. */
  feedState: TimelineFeedState;
  /**
   * Per-root-session event cache.  Keyed by `rootSessionId`.
   * Ordered by `serverSeq` ascending; deduped by `eventId`; capped at
   * TIMELINE_CACHE_MAX_PER_SESSION entries (oldest evicted).
   */
  cache: ReadonlyMap<string, TimelineSessionCache>;
  /** ISO timestamp of the last heartbeat received, or null. */
  lastHeartbeatAt: string | null;
  /**
   * True when the feed is live-only — i.e. the browser has connected but
   * has NOT received any replayed history.  T5/T6 may use this to render a
   * "live events only — history not available" notice.
   */
  liveOnlyNotice: boolean;
  /** Root sessions that have actually evicted older cached events. */
  evictedSessionIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Reducer helper — insert an event into a session's sorted+deduped list
// ---------------------------------------------------------------------------

/**
 * Pure helper: inserts `incoming` into `existing` maintaining serverSeq order
 * and enforcing eventId deduplication and TIMELINE_CACHE_MAX_PER_SESSION cap.
 *
 * Returns the same array reference if no change is needed.
 */
export function insertTimelineEvent(
  existing: TimelineSessionCache,
  incoming: MonitorTimelineEventContract,
): TimelineSessionCache {
  // Deduplicate by eventId
  for (const ev of existing) {
    if (ev.eventId === incoming.eventId) {
      return existing;
    }
  }

  // Insertion-sort by serverSeq (events usually arrive in order)
  const arr = existing.slice() as MonitorTimelineEventContract[];
  let insertAt = arr.length;
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i];
    if (item === undefined) continue;
    if (item.serverSeq <= incoming.serverSeq) {
      insertAt = i + 1;
      break;
    }
    insertAt = i;
  }
  arr.splice(insertAt, 0, incoming);

  // Evict oldest entries if over cap
  if (arr.length > TIMELINE_CACHE_MAX_PER_SESSION) {
    arr.splice(0, arr.length - TIMELINE_CACHE_MAX_PER_SESSION);
  }

  return arr;
}

// ---------------------------------------------------------------------------
// Initial state factory (exported for tests)
// ---------------------------------------------------------------------------

export function createInitialTimelineFeedState(): TimelineFeedReducerState {
  return {
    feedState: "loading",
    cache: new Map(),
    lastHeartbeatAt: null,
    liveOnlyNotice: true,
    evictedSessionIds: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Pure reducer (exported so tests can drive it without React / EventSource)
// ---------------------------------------------------------------------------

export function timelineFeedReducer(
  state: TimelineFeedReducerState,
  action: TimelineFeedAction,
): TimelineFeedReducerState {
  switch (action.type) {
    case "CONNECTING": {
      return {
        ...state,
        feedState: state.feedState === "live" ? "reconnecting" : "loading",
      };
    }

    case "CONNECTED": {
      return { ...state, feedState: "live", liveOnlyNotice: true };
    }

    case "DISCONNECTED": {
      return { ...state, feedState: "disconnected" };
    }

    case "HEARTBEAT": {
      // Heartbeat keeps the connection alive; does NOT add to the event cache.
      return {
        ...state,
        feedState: "live",
        lastHeartbeatAt: action.at,
      };
    }

    case "EVENT": {
      const { event } = action;
      const prevSession = state.cache.get(event.rootSessionId) ?? [];
      const nextSession = insertTimelineEvent(prevSession, event);

      // Short-circuit if nothing changed (duplicate)
      if (nextSession === prevSession) {
        return state;
      }

      const nextCache = new Map(state.cache);
      nextCache.set(event.rootSessionId, nextSession);
      const didEvict = prevSession.length >= TIMELINE_CACHE_MAX_PER_SESSION;
      const nextEvictedSessionIds = didEvict
        ? new Set(state.evictedSessionIds).add(event.rootSessionId)
        : state.evictedSessionIds;
      return {
        ...state,
        feedState: "live",
        cache: nextCache,
        evictedSessionIds: nextEvictedSessionIds,
      };
    }

    case "RESET": {
      // Called when the EventSource is torn down (effect cleanup / page unload).
      // Clears the entire in-memory cache — no persistence.
      return createInitialTimelineFeedState();
    }

    default: {
      // Exhaustive check — TypeScript will error if a branch is missing
      const _exhaustive: never = action;
      return state;
    }
  }
}

// ---------------------------------------------------------------------------
// Selector helpers (exported for T5/T6/T7 consumption)
// ---------------------------------------------------------------------------

/** Returns the sorted event list for a given root session, or an empty array. */
export function selectSessionEvents(
  state: TimelineFeedReducerState,
  rootSessionId: string,
): TimelineSessionCache {
  return state.cache.get(rootSessionId) ?? [];
}

/** Returns all root session IDs that have at least one cached event. */
export function selectActiveRootSessionIds(
  state: TimelineFeedReducerState,
): ReadonlyArray<string> {
  return Array.from(state.cache.keys());
}

/** Returns the most recent N events across ALL sessions, ordered by serverSeq. */
export function selectRecentEvents(
  state: TimelineFeedReducerState,
  limit: number,
): ReadonlyArray<MonitorTimelineEventContract> {
  const all: MonitorTimelineEventContract[] = [];
  for (const events of state.cache.values()) {
    for (const ev of events) {
      all.push(ev);
    }
  }
  all.sort((a, b) => a.serverSeq - b.serverSeq);
  return limit > 0 ? all.slice(-limit) : all;
}

// ---------------------------------------------------------------------------
// Time-series bucketing for inline SVG chart (T10 redesign)
// ---------------------------------------------------------------------------

/** Duration of the sliding time window in milliseconds (5 minutes). */
export const TIMELINE_WINDOW_MS = 5 * 60 * 1000;

/** Width of each time bucket in milliseconds (2 seconds). */
export const TIMELINE_BUCKET_MS = 2 * 1000;

/** Total number of buckets in the sliding window (150). */
export const TIMELINE_BUCKET_COUNT = Math.floor(
  TIMELINE_WINDOW_MS / TIMELINE_BUCKET_MS,
);

/**
 * Operator-actionable lane categories, rendered as stacked bars bottom-to-top.
 *
 * - `activity`  — non-actionable background movement (session lifecycle, todos)
 * - `subagent`  — subagent spawns (informational but distinct)
 * - `pressure`  — degradation signals (compaction, retries, warning-level alerts)
 * - `failure`   — blocking issues requiring intervention (errors, error-level alerts)
 */
export const TIMELINE_OPERATOR_LANES = [
  "activity",
  "subagent",
  "pressure",
  "failure",
] as const;

export type TimelineOperatorLane = (typeof TIMELINE_OPERATOR_LANES)[number];

/** A single time bucket with event counts broken down by operator lane. */
export interface TimelineBucket {
  /** Bucket index (0 = oldest, TIMELINE_BUCKET_COUNT-1 = newest). */
  index: number;
  /** Epoch ms of the bucket's leading edge. */
  startMs: number;
  /** Per-lane event counts in this bucket. */
  counts: Record<TimelineOperatorLane, number>;
  /** Total events in this bucket (sum of counts). */
  total: number;
}

/**
 * Classifies a timeline event into an operator-actionable lane based on its
 * `kind` and `meta` fields — NOT raw severity.
 */
export function classifyEventLane(
  ev: MonitorTimelineEventContract,
): TimelineOperatorLane {
  // Errors are always failures — highest priority
  if (ev.kind === "error") return "failure";
  // Error-level alerts are failures; warning-level alerts are pressure
  if (ev.kind === "alert") {
    return ev.meta.level === "error" ? "failure" : "pressure";
  }
  // Compaction events signal context-window pressure
  if (ev.kind === "compaction") return "pressure";
  // Status change to retry is a degradation signal
  if (ev.kind === "status-changed" && ev.meta.status === "retry") {
    return "pressure";
  }
  // Subagent spawns are informational but operationally distinct
  if (ev.kind === "subagent-started") return "subagent";
  // Everything else: session-created, session-updated, status-changed (idle/busy), todo-updated
  return "activity";
}

/**
 * Aggregates a session's cached timeline events into fixed-width time buckets.
 *
 * - `nowMs` anchors the right edge of the window (newest bucket).
 * - Events outside the window are silently dropped.
 * - Returns exactly `TIMELINE_BUCKET_COUNT` buckets, always.
 */
export function bucketizeEvents(
  events: TimelineSessionCache,
  nowMs: number,
): TimelineBucket[] {
  const windowStart = nowMs - TIMELINE_WINDOW_MS;

  const buckets: TimelineBucket[] = Array.from(
    { length: TIMELINE_BUCKET_COUNT },
    (_, i) => ({
      index: i,
      startMs: windowStart + i * TIMELINE_BUCKET_MS,
      counts: { activity: 0, subagent: 0, pressure: 0, failure: 0 },
      total: 0,
    }),
  );

  for (const ev of events) {
    const evMs = new Date(ev.at).getTime();
    if (evMs < windowStart || evMs >= nowMs) continue;
    const bucketIdx = Math.min(
      Math.floor((evMs - windowStart) / TIMELINE_BUCKET_MS),
      TIMELINE_BUCKET_COUNT - 1,
    );
    const bucket = buckets[bucketIdx];
    if (!bucket) continue;
    const lane = classifyEventLane(ev);
    bucket.counts[lane] += 1;
    bucket.total += 1;
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseMonitorTimelineFeedOptions {
  /**
   * An opaque key that identifies the current "source" being observed (e.g. a
   * selected source id or instance id).  When this value changes the hook tears
   * down the existing EventSource, dispatches RESET to wipe the in-memory
   * cache, and opens a fresh connection — exactly the same as a page reload
   * but scoped to the component lifecycle.
   *
   * Pass `undefined` (or omit) to disable source-keyed resets; the cache will
   * then only be cleared on component unmount / page navigation.
   *
   * Internally this is passed as the sole React.useEffect dependency, so it
   * MUST be referentially stable for primitives (strings are always stable).
   */
  sourceKey?: string | undefined;
}

// ---------------------------------------------------------------------------
// Hook return type (exported for T5/T6/T7 prop types)
// ---------------------------------------------------------------------------

export interface UseMonitorTimelineFeedResult {
  /** Current connection state of the timeline SSE feed. */
  feedState: TimelineFeedState;
  /**
   * Per-root-session ordered event cache.
   * Reference is stable across renders when the contents have not changed.
   */
  cache: ReadonlyMap<string, TimelineSessionCache>;
  /** ISO timestamp of the last heartbeat, or null before first heartbeat. */
  lastHeartbeatAt: string | null;
  /**
   * True when the feed is live-only and no replay is available.
   * Use this to show an informational notice in the UI.
   */
  liveOnlyNotice: boolean;
  /** Root sessions that have actually evicted older cached events. */
  evictedSessionIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to the monitor timeline SSE feed and maintains a per-root-session
 * in-memory event cache for the current page lifetime.
 *
 * - Events are deduped by `eventId`.
 * - Events are ordered by `serverSeq` within each session.
 * - Each session cache is capped at TIMELINE_CACHE_MAX_PER_SESSION entries;
 *   oldest events are evicted when the cap is reached.
 * - Cache is page-scoped only: source change or page reload resets the cache.
 * - Pass `options.sourceKey` to also reset the cache when the selected source
 *   changes while the component remains mounted (React tears down the effect
 *   when the key changes, which dispatches RESET before reconnecting).
 * - No localStorage, IndexedDB, or any other persistence is used.
 */
export function useMonitorTimelineFeed(
  options?: UseMonitorTimelineFeedOptions,
): UseMonitorTimelineFeedResult {
  const [state, dispatch] = React.useReducer(
    timelineFeedReducer,
    undefined,
    createInitialTimelineFeedState,
  );

  // Stable primitive extracted before the effect so biome's
  // useExhaustiveDependencies can track it as a dep that is read inside.
  const sourceKey = options?.sourceKey ?? null;

  React.useEffect(() => {
    // Capture sourceKey inside the effect body so biome sees it as used.
    // The value itself is not needed at runtime; only the identity change
    // (which React detects via the dep array) drives the RESET+reconnect.
    void sourceKey;

    let active = true;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const clearTimers = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (!active) return;
      dispatch({ type: "CONNECTING" });

      eventSource = new EventSource(TIMELINE_EVENTS_URL);

      eventSource.addEventListener("timeline", (event: MessageEvent) => {
        if (!active) return;
        let parsed: MonitorTimelineFeedMessageContract;
        try {
          parsed = JSON.parse(
            event.data as string,
          ) as MonitorTimelineFeedMessageContract;
        } catch {
          return;
        }
        if (parsed.type === "timeline.event") {
          dispatch({ type: "CONNECTED" });
          dispatch({ type: "EVENT", event: parsed.event });
        }
      });

      eventSource.addEventListener("heartbeat", (event: MessageEvent) => {
        if (!active) return;
        let parsed: MonitorTimelineFeedMessageContract;
        try {
          parsed = JSON.parse(
            event.data as string,
          ) as MonitorTimelineFeedMessageContract;
        } catch {
          return;
        }
        if (parsed.type === "timeline.heartbeat") {
          dispatch({ type: "HEARTBEAT", at: parsed.at });
        }
      });

      eventSource.onerror = () => {
        if (!active) return;
        eventSource?.close();
        eventSource = null;
        dispatch({ type: "DISCONNECTED" });
        reconnectTimer = window.setTimeout(() => {
          clearTimers();
          connect();
        }, 3_000);
      };

      // Treat the open event as confirmed connection
      eventSource.onopen = () => {
        if (!active) return;
        dispatch({ type: "CONNECTED" });
      };
    };

    connect();

    return () => {
      active = false;
      clearTimers();
      eventSource?.close();
      // RESET wipes the in-memory cache so events from the previous source
      // cannot bleed into the next source's lifecycle.
      dispatch({ type: "RESET" });
    };
  }, [sourceKey]);

  return {
    feedState: state.feedState,
    cache: state.cache,
    lastHeartbeatAt: state.lastHeartbeatAt,
    liveOnlyNotice: state.liveOnlyNotice,
    evictedSessionIds: state.evictedSessionIds,
  };
}
