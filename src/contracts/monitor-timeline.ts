/**
 * Browser-facing timeline contract for monitor active-session timeline (v1).
 *
 * Privacy boundary: this file MUST NOT expose message text, prompt text,
 * tool arguments, raw tool output, stack traces, or any other sensitive
 * payload content. Only metadata-level fields are permitted here.
 */

// ---------------------------------------------------------------------------
// Event taxonomy — v1 fixed set
// ---------------------------------------------------------------------------

export type MonitorTimelineEventKind =
  | "session-created"
  | "session-updated"
  | "status-changed"
  | "error"
  | "alert"
  | "compaction"
  | "todo-updated"
  | "subagent-started";

// ---------------------------------------------------------------------------
// Allowlisted meta keys — values that may appear in MonitorTimelineEventMeta
// ---------------------------------------------------------------------------

export type MonitorTimelineMetaStatus = "idle" | "busy" | "retry";

export type MonitorTimelineMetaCategory =
  | "model"
  | "token"
  | "network"
  | "retry"
  | "compaction"
  | "limit"
  | "other";

export type MonitorTimelineMetaLevel = "warning" | "error";

/**
 * Metadata-only payload. Every field is optional; only the keys in this
 * interface are permitted — do NOT add raw message or tool payload fields.
 */
export interface MonitorTimelineEventMeta {
  /** Runtime status for status-changed events */
  status?: MonitorTimelineMetaStatus;
  /** Alert category for alert events */
  category?: MonitorTimelineMetaCategory;
  /** Severity level for alert events */
  level?: MonitorTimelineMetaLevel;
  /** Open todo count for todo-updated events */
  todoCount?: number;
  /** Cumulative compaction count for compaction events */
  compactionCount?: number;
  /** Child session id for subagent-started events */
  childSessionId?: string;
}

// ---------------------------------------------------------------------------
// Core timeline event — metadata-only, browser-facing
// ---------------------------------------------------------------------------

export interface MonitorTimelineEventContract {
  /** Stable unique id for this event (server-assigned, opaque string) */
  eventId: string;
  /** Server-assigned monotonic sequence number; use for ordering, not timestamps */
  serverSeq: number;
  /** Source instance id (plugin instanceId) that produced this event */
  sourceId: string;
  /** Root session id for the timeline stream this event belongs to */
  rootSessionId: string;
  /** Session id that directly emitted this event (may equal rootSessionId) */
  sessionId: string;
  /** ISO 8601 timestamp of when the originating plugin event occurred */
  at: string;
  /** ISO 8601 timestamp of when the server received and accepted this event */
  receivedAt: string;
  /** Human-readable label for UI display (e.g. "Status: busy") */
  label: string;
  /** Visual severity hint for the browser timeline renderer */
  severity: "info" | "warning" | "error";
  /** Fixed v1 event kind */
  kind: MonitorTimelineEventKind;
  /** Allowlisted metadata — no sensitive payloads permitted */
  meta: MonitorTimelineEventMeta;
}

// ---------------------------------------------------------------------------
// Timeline feed SSE envelope (browser receives this as JSON in data field)
// ---------------------------------------------------------------------------

export interface MonitorTimelineFeedEventContract {
  type: "timeline.event";
  serverSeq: number;
  event: MonitorTimelineEventContract;
}

export interface MonitorTimelineFeedHeartbeatContract {
  type: "timeline.heartbeat";
  serverSeq: number;
  at: string;
}

export type MonitorTimelineFeedMessageContract =
  | MonitorTimelineFeedEventContract
  | MonitorTimelineFeedHeartbeatContract;

// ---------------------------------------------------------------------------
// Selector naming constants — used by both browser components and tests
// These map to data-testid values following the monitor-timeline-* prefix.
// ---------------------------------------------------------------------------

export const MONITOR_TIMELINE_SELECTORS = {
  /** Feed state indicator: pending | loading | live | reconnecting | disconnected */
  FEED_STATE: "monitor-timeline-feed-state",
  /** Preview badge/strip for the inline time-series chart in a session card */
  PREVIEW: (sessionId: string) => `monitor-timeline-preview-${sessionId}`,
} as const;

/** Type of `data-state` values used in FEED_STATE data-testid */
export type MonitorTimelineFeedState =
  | "pending"
  | "loading"
  | "live"
  | "reconnecting"
  | "disconnected";

// ---------------------------------------------------------------------------
// Guard helpers — ensure sensitive fields are never accepted at call sites
// ---------------------------------------------------------------------------

/**
 * A set of known sensitive field names that must never appear in timeline
 * meta or event payloads. This is used in tests to enforce the privacy boundary.
 */
export const MONITOR_TIMELINE_SENSITIVE_FIELDS = [
  "prompt",
  "message",
  "content",
  "text",
  "toolArgs",
  "toolArguments",
  "input",
  "output",
  "rawOutput",
  "stackTrace",
  "error",
  "args",
  "result",
] as const;

export type MonitorTimelineSensitiveField =
  (typeof MONITOR_TIMELINE_SENSITIVE_FIELDS)[number];

/**
 * Validates that a meta object contains ONLY allowlisted keys.
 * Returns `true` if the meta is clean, `false` if any sensitive key is present.
 */
export function isCleanTimelineMeta(meta: Record<string, unknown>): boolean {
  const allowlisted = new Set<string>([
    "status",
    "category",
    "level",
    "todoCount",
    "compactionCount",
    "childSessionId",
  ]);
  for (const key of Object.keys(meta)) {
    if (!allowlisted.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Validates that a meta object contains no sensitive field values that
 * look like raw payload strings (non-empty string values for sensitive keys).
 * Returns the first offending key found, or null if clean.
 */
export function findSensitiveMetaKey(
  meta: Record<string, unknown>,
): string | null {
  for (const key of MONITOR_TIMELINE_SENSITIVE_FIELDS) {
    if (key in meta) {
      return key;
    }
  }
  return null;
}
