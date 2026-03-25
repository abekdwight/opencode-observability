import type { MonitorIngestEventContract } from "../contracts/monitor-ingest.js";
import {
  isCleanTimelineMeta,
  type MonitorTimelineEventContract,
  type MonitorTimelineEventMeta,
} from "../contracts/monitor-timeline.js";

type NormalizeMonitorTimelineEventInput = {
  sourceId: string;
  rootSessionId: string;
  sessionId: string;
  serverSeq: number;
  at: string;
  receivedAt: string;
  event: MonitorIngestEventContract;
  status?: "idle" | "busy" | "retry";
  todoCount?: number;
  compactionCount?: number;
  childSessionId?: string;
  isSubagentStarted?: boolean;
};

function buildTimelineEvent(
  input: Omit<MonitorTimelineEventContract, "eventId"> & {
    meta: MonitorTimelineEventMeta;
  },
): MonitorTimelineEventContract {
  if (!isCleanTimelineMeta(input.meta as Record<string, unknown>)) {
    throw new Error("timeline meta must contain only allowlisted keys");
  }

  return {
    eventId: `timeline-${input.serverSeq}`,
    ...input,
  };
}

export function normalizeMonitorTimelineEvent(
  input: NormalizeMonitorTimelineEventInput,
): MonitorTimelineEventContract | null {
  const common = {
    serverSeq: input.serverSeq,
    sourceId: input.sourceId,
    rootSessionId: input.rootSessionId,
    sessionId: input.sessionId,
    at: input.at,
    receivedAt: input.receivedAt,
  };

  switch (input.event.type) {
    case "heartbeat":
    case "session.deleted":
      return null;
    case "session.created":
      if (input.isSubagentStarted && input.childSessionId) {
        return buildTimelineEvent({
          ...common,
          label: "Subagent started",
          severity: "info",
          kind: "subagent-started",
          meta: { childSessionId: input.childSessionId },
        });
      }
      return buildTimelineEvent({
        ...common,
        label: "Session created",
        severity: "info",
        kind: "session-created",
        meta: {},
      });
    case "session.updated":
    case "session.upsert":
      return buildTimelineEvent({
        ...common,
        label: "Session updated",
        severity: "info",
        kind: "session-updated",
        meta: {},
      });
    case "session.status":
    case "session.idle":
      return buildTimelineEvent({
        ...common,
        label: `Status: ${input.status ?? "idle"}`,
        severity: input.status === "retry" ? "warning" : "info",
        kind: "status-changed",
        meta: { status: input.status ?? "idle" },
      });
    case "session.error":
      return buildTimelineEvent({
        ...common,
        label: "Session error",
        severity: "error",
        kind: "error",
        meta: {},
      });
    case "session.alert":
      return buildTimelineEvent({
        ...common,
        label: `Alert: ${input.event.category}`,
        severity: input.event.level === "error" ? "error" : "warning",
        kind: "alert",
        meta: {
          category: input.event.category,
          level: input.event.level === "error" ? "error" : "warning",
        },
      });
    case "session.compacted":
      return buildTimelineEvent({
        ...common,
        label: "Compaction",
        severity: "warning",
        kind: "compaction",
        meta: {
          compactionCount: input.compactionCount,
        },
      });
    case "todo.updated":
      return buildTimelineEvent({
        ...common,
        label: "Todo updated",
        severity: "info",
        kind: "todo-updated",
        meta: {
          todoCount: input.todoCount,
        },
      });
    default:
      return null;
  }
}
