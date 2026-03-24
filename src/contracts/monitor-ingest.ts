import type { MonitorSnapshotContract } from "./monitor.js";

export type MonitorSessionRuntimeStatus = "idle" | "busy" | "retry";

export type MonitorAlertCategory =
  | "model"
  | "token"
  | "network"
  | "retry"
  | "compaction"
  | "limit"
  | "other";

export interface MonitorIngestSourceContract {
  instanceId: string;
  label?: string;
}

export interface MonitorIngestHeartbeatContract {
  at?: string;
  activeSessionIds?: string[];
}

export interface MonitorIngestSessionContract {
  id: string;
  title?: string;
  directory?: string;
  parentId?: string | null;
  updatedAt?: string;
  messageCount?: number;
  toolCallCount?: number;
  compactionCount?: number;
  todoCount?: number;
  status?: MonitorSessionRuntimeStatus;
}

export type MonitorIngestEventContract =
  | {
      type: "heartbeat";
      at?: string;
      activeSessionIds?: string[];
    }
  | {
      type: "session.created" | "session.updated" | "session.upsert";
      session: MonitorIngestSessionContract;
    }
  | {
      type: "session.status";
      session: MonitorIngestSessionContract;
      status: MonitorSessionRuntimeStatus;
    }
  | {
      type: "session.idle";
      session: MonitorIngestSessionContract;
    }
  | {
      type: "session.error";
      session: MonitorIngestSessionContract;
    }
  | {
      type: "session.alert";
      session: MonitorIngestSessionContract;
      category: MonitorAlertCategory;
      at?: string;
      level?: "warning" | "error";
      message?: string;
      increment?: number;
    }
  | {
      type: "session.compacted";
      session: MonitorIngestSessionContract;
      increment?: number;
    }
  | {
      type: "session.deleted";
      sessionId: string;
    }
  | {
      type: "todo.updated";
      sessionId?: string;
      session?: MonitorIngestSessionContract;
      openCount?: number;
      delta?: number;
      hasOpenTodo?: boolean;
    };

export interface MonitorIngestRequestContract {
  source: MonitorIngestSourceContract;
  sentAt?: string;
  heartbeat?: MonitorIngestHeartbeatContract;
  event?: MonitorIngestEventContract;
  events?: MonitorIngestEventContract[];
}

export interface MonitorIngestResponseContract {
  acceptedEvents: number;
  snapshot: MonitorSnapshotContract;
}
