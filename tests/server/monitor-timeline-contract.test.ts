import { describe, expect, test } from "vitest";
import {
  findSensitiveMetaKey,
  isCleanTimelineMeta,
  MONITOR_TIMELINE_SELECTORS,
  MONITOR_TIMELINE_SENSITIVE_FIELDS,
  type MonitorTimelineEventContract,
  type MonitorTimelineEventKind,
  type MonitorTimelineEventMeta,
  type MonitorTimelineFeedHeartbeatContract,
  type MonitorTimelineFeedMessageContract,
  type MonitorTimelineFeedState,
  type MonitorTimelineMetaCategory,
  type MonitorTimelineMetaLevel,
  type MonitorTimelineMetaStatus,
} from "../../src/contracts/monitor-timeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<MonitorTimelineEventContract> = {},
): MonitorTimelineEventContract {
  return {
    eventId: "evt_001",
    serverSeq: 1,
    sourceId: "macbook-pro:12345",
    rootSessionId: "ses_root_abc",
    sessionId: "ses_root_abc",
    at: "2026-03-25T10:00:00.000Z",
    receivedAt: "2026-03-25T10:00:00.050Z",
    label: "Session started",
    severity: "info",
    kind: "session-created",
    meta: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// v1 event taxonomy
// ---------------------------------------------------------------------------

describe("MonitorTimelineEventKind taxonomy", () => {
  test("all eight v1 kinds are representable as MonitorTimelineEventKind", () => {
    const v1Kinds: MonitorTimelineEventKind[] = [
      "session-created",
      "session-updated",
      "status-changed",
      "error",
      "alert",
      "compaction",
      "todo-updated",
      "subagent-started",
    ];
    expect(v1Kinds).toHaveLength(8);
    for (const kind of v1Kinds) {
      const event = makeEvent({ kind });
      expect(event.kind).toBe(kind);
    }
  });

  test("event contract includes all required fields", () => {
    const event = makeEvent();
    expect(typeof event.eventId).toBe("string");
    expect(typeof event.serverSeq).toBe("number");
    expect(typeof event.sourceId).toBe("string");
    expect(typeof event.rootSessionId).toBe("string");
    expect(typeof event.sessionId).toBe("string");
    expect(typeof event.at).toBe("string");
    expect(typeof event.receivedAt).toBe("string");
    expect(typeof event.label).toBe("string");
    expect(typeof event.severity).toBe("string");
    expect(typeof event.kind).toBe("string");
    expect(typeof event.meta).toBe("object");
  });

  test("severity accepts info, warning, and error", () => {
    const severities: MonitorTimelineEventContract["severity"][] = [
      "info",
      "warning",
      "error",
    ];
    for (const severity of severities) {
      const event = makeEvent({ severity });
      expect(event.severity).toBe(severity);
    }
  });
});

// ---------------------------------------------------------------------------
// Allowlisted meta keys
// ---------------------------------------------------------------------------

describe("MonitorTimelineEventMeta allowlist", () => {
  test("status meta key accepts idle, busy, and retry", () => {
    const statuses: MonitorTimelineMetaStatus[] = ["idle", "busy", "retry"];
    for (const status of statuses) {
      const meta: MonitorTimelineEventMeta = { status };
      expect(meta.status).toBe(status);
    }
  });

  test("category meta key accepts all seven alert categories", () => {
    const categories: MonitorTimelineMetaCategory[] = [
      "model",
      "token",
      "network",
      "retry",
      "compaction",
      "limit",
      "other",
    ];
    for (const category of categories) {
      const meta: MonitorTimelineEventMeta = { category };
      expect(meta.category).toBe(category);
    }
  });

  test("level meta key accepts warning and error", () => {
    const levels: MonitorTimelineMetaLevel[] = ["warning", "error"];
    for (const level of levels) {
      const meta: MonitorTimelineEventMeta = { level };
      expect(meta.level).toBe(level);
    }
  });

  test("todoCount, compactionCount, and childSessionId are valid meta keys", () => {
    const meta: MonitorTimelineEventMeta = {
      todoCount: 3,
      compactionCount: 1,
      childSessionId: "ses_child_xyz",
    };
    expect(meta.todoCount).toBe(3);
    expect(meta.compactionCount).toBe(1);
    expect(meta.childSessionId).toBe("ses_child_xyz");
  });
});

// ---------------------------------------------------------------------------
// Privacy boundary: isCleanTimelineMeta guard helper
// ---------------------------------------------------------------------------

describe("isCleanTimelineMeta privacy guard", () => {
  test("accepts an empty meta object", () => {
    expect(isCleanTimelineMeta({})).toBe(true);
  });

  test("accepts all six allowlisted meta keys", () => {
    const clean: Record<string, unknown> = {
      status: "busy",
      category: "network",
      level: "warning",
      todoCount: 2,
      compactionCount: 0,
      childSessionId: "ses_abc",
    };
    expect(isCleanTimelineMeta(clean)).toBe(true);
  });

  test("rejects prompt field", () => {
    expect(isCleanTimelineMeta({ prompt: "do something dangerous" })).toBe(
      false,
    );
  });

  test("rejects message field", () => {
    expect(isCleanTimelineMeta({ message: "sensitive text" })).toBe(false);
  });

  test("rejects content field", () => {
    expect(isCleanTimelineMeta({ content: "raw content" })).toBe(false);
  });

  test("rejects text field", () => {
    expect(isCleanTimelineMeta({ text: "raw text" })).toBe(false);
  });

  test("rejects toolArgs field", () => {
    expect(isCleanTimelineMeta({ toolArgs: { path: "/etc/passwd" } })).toBe(
      false,
    );
  });

  test("rejects toolArguments field", () => {
    expect(isCleanTimelineMeta({ toolArguments: "{}" })).toBe(false);
  });

  test("rejects input field", () => {
    expect(isCleanTimelineMeta({ input: "user prompt" })).toBe(false);
  });

  test("rejects output field", () => {
    expect(isCleanTimelineMeta({ output: "model response" })).toBe(false);
  });

  test("rejects rawOutput field", () => {
    expect(isCleanTimelineMeta({ rawOutput: "raw model response" })).toBe(
      false,
    );
  });

  test("rejects stackTrace field", () => {
    expect(isCleanTimelineMeta({ stackTrace: "Error at line 1" })).toBe(false);
  });

  test("rejects args field", () => {
    expect(isCleanTimelineMeta({ args: ["--flag", "value"] })).toBe(false);
  });

  test("rejects result field", () => {
    expect(isCleanTimelineMeta({ result: "tool output here" })).toBe(false);
  });

  test("rejects any unrecognized unknown field", () => {
    expect(isCleanTimelineMeta({ unknownField: 42 })).toBe(false);
  });

  test("rejects mix of allowlisted and sensitive keys", () => {
    expect(
      isCleanTimelineMeta({ status: "busy", prompt: "hidden payload" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Privacy boundary: findSensitiveMetaKey helper
// ---------------------------------------------------------------------------

describe("findSensitiveMetaKey privacy guard", () => {
  test("returns null when meta has no sensitive keys", () => {
    expect(findSensitiveMetaKey({ status: "idle", todoCount: 1 })).toBeNull();
  });

  test("returns null for empty meta", () => {
    expect(findSensitiveMetaKey({})).toBeNull();
  });

  test("returns the sensitive key when prompt is present", () => {
    const key = findSensitiveMetaKey({ prompt: "do something" });
    expect(key).toBe("prompt");
  });

  test("returns the sensitive key when message is present", () => {
    const key = findSensitiveMetaKey({ message: "raw text" });
    expect(key).toBe("message");
  });

  test("returns the sensitive key when toolArgs is present", () => {
    const key = findSensitiveMetaKey({ toolArgs: {} });
    expect(key).toBe("toolArgs");
  });

  test("SENSITIVE_FIELDS constant covers all privacy-relevant field names", () => {
    const fields = MONITOR_TIMELINE_SENSITIVE_FIELDS as readonly string[];
    expect(fields).toContain("prompt");
    expect(fields).toContain("message");
    expect(fields).toContain("content");
    expect(fields).toContain("text");
    expect(fields).toContain("toolArgs");
    expect(fields).toContain("toolArguments");
    expect(fields).toContain("input");
    expect(fields).toContain("output");
    expect(fields).toContain("rawOutput");
    expect(fields).toContain("stackTrace");
    expect(fields).toContain("error");
    expect(fields).toContain("args");
    expect(fields).toContain("result");
    expect(fields.length).toBeGreaterThanOrEqual(13);
  });
});

// ---------------------------------------------------------------------------
// Selector naming constants
// ---------------------------------------------------------------------------

describe("MONITOR_TIMELINE_SELECTORS naming constants", () => {
  test("FEED_STATE matches expected data-testid prefix", () => {
    expect(MONITOR_TIMELINE_SELECTORS.FEED_STATE).toBe(
      "monitor-timeline-feed-state",
    );
  });

  test("PREVIEW generates correct session-scoped selector", () => {
    expect(MONITOR_TIMELINE_SELECTORS.PREVIEW("ses_abc")).toBe(
      "monitor-timeline-preview-ses_abc",
    );
    expect(MONITOR_TIMELINE_SELECTORS.PREVIEW("ses_xyz")).toBe(
      "monitor-timeline-preview-ses_xyz",
    );
  });
});

// ---------------------------------------------------------------------------
// Feed state type
// ---------------------------------------------------------------------------

describe("MonitorTimelineFeedState type values", () => {
  test("all UI feed states are representable", () => {
    const states: MonitorTimelineFeedState[] = [
      "pending",
      "loading",
      "live",
      "reconnecting",
      "disconnected",
    ];
    expect(states).toHaveLength(5);
    for (const state of states) {
      expect(typeof state).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Feed SSE envelope contracts
// ---------------------------------------------------------------------------

describe("MonitorTimelineFeedMessageContract SSE envelopes", () => {
  test("timeline.event envelope carries a full timeline event", () => {
    const event = makeEvent({ kind: "alert", severity: "warning" });
    const envelope: MonitorTimelineFeedMessageContract = {
      type: "timeline.event",
      serverSeq: event.serverSeq,
      event,
    };
    expect(envelope.type).toBe("timeline.event");
    expect(envelope.serverSeq).toBe(1);
    expect(envelope.event.kind).toBe("alert");
    expect(envelope.event.severity).toBe("warning");
  });

  test("timeline.heartbeat envelope carries at and serverSeq", () => {
    const heartbeat: MonitorTimelineFeedHeartbeatContract = {
      type: "timeline.heartbeat",
      serverSeq: 42,
      at: "2026-03-25T10:01:00.000Z",
    };
    expect(heartbeat.type).toBe("timeline.heartbeat");
    expect(heartbeat.serverSeq).toBe(42);
    expect(heartbeat.at).toBe("2026-03-25T10:01:00.000Z");
  });

  test("feed message does not contain prompt field in serialized form", () => {
    const event = makeEvent({ meta: { status: "busy" } });
    const envelope: MonitorTimelineFeedMessageContract = {
      type: "timeline.event",
      serverSeq: 1,
      event,
    };
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('"prompt"');
    expect(serialized).not.toContain('"message"');
    expect(serialized).not.toContain('"toolArgs"');
    expect(serialized).not.toContain('"input"');
    expect(serialized).not.toContain('"output"');
    expect(serialized).not.toContain('"stackTrace"');
  });

  test("subagent-started event carries childSessionId in meta", () => {
    const event = makeEvent({
      kind: "subagent-started",
      sessionId: "ses_root_abc",
      meta: { childSessionId: "ses_child_xyz" },
    });
    const envelope: MonitorTimelineFeedMessageContract = {
      type: "timeline.event",
      serverSeq: 5,
      event,
    };
    expect(envelope.event.meta.childSessionId).toBe("ses_child_xyz");
    expect(
      isCleanTimelineMeta(envelope.event.meta as Record<string, unknown>),
    ).toBe(true);
  });

  test("serverSeq in envelope matches serverSeq in event", () => {
    const event = makeEvent({ serverSeq: 99 });
    const envelope: MonitorTimelineFeedMessageContract = {
      type: "timeline.event",
      serverSeq: event.serverSeq,
      event,
    };
    expect(envelope.serverSeq).toBe(envelope.event.serverSeq);
  });
});

// ---------------------------------------------------------------------------
// Integration: full event for each v1 kind — privacy check
// ---------------------------------------------------------------------------

describe("privacy boundary: full event serialization for each v1 kind", () => {
  const scenarios: Array<{
    kind: MonitorTimelineEventKind;
    meta: MonitorTimelineEventMeta;
  }> = [
    { kind: "session-created", meta: {} },
    { kind: "session-updated", meta: {} },
    { kind: "status-changed", meta: { status: "busy" } },
    { kind: "error", meta: {} },
    { kind: "alert", meta: { category: "network", level: "warning" } },
    { kind: "compaction", meta: { compactionCount: 2 } },
    { kind: "todo-updated", meta: { todoCount: 3 } },
    { kind: "subagent-started", meta: { childSessionId: "ses_child_123" } },
  ];

  for (const { kind, meta } of scenarios) {
    test(`${kind} event serializes without sensitive payload fields`, () => {
      const event = makeEvent({ kind, meta });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('"prompt"');
      expect(serialized).not.toContain('"message"');
      expect(serialized).not.toContain('"content"');
      expect(serialized).not.toContain('"text":');
      expect(serialized).not.toContain('"toolArgs"');
      expect(serialized).not.toContain('"input"');
      expect(serialized).not.toContain('"output"');
      expect(serialized).not.toContain('"stackTrace"');
      expect(isCleanTimelineMeta(meta as Record<string, unknown>)).toBe(true);
    });
  }
});
