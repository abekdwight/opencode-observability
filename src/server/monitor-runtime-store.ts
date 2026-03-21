import type {
  MonitorSessionSummary,
  MonitorSnapshotContract,
} from "../contracts/monitor.js";
import type {
  MonitorIngestEventContract,
  MonitorIngestRequestContract,
  MonitorIngestResponseContract,
  MonitorIngestSessionContract,
  MonitorSessionRuntimeStatus,
} from "../contracts/monitor-ingest.js";
import { getMonitorHeartbeatTtlMs } from "../lib/config.js";

interface RuntimeSourceState {
  instanceId: string;
  label?: string;
  lastHeartbeatAtMs: number;
  lastSeenAtMs: number;
}

interface RuntimeSessionState {
  key: string;
  sourceId: string;
  id: string;
  title: string;
  directory: string;
  parentId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  messageCount: number;
  toolCallCount: number;
  compactionCount: number;
  todoCount: number;
  status: MonitorSessionRuntimeStatus;
  lastSeenAtMs: number;
}

type RuntimeRootAggregate = {
  session: RuntimeSessionState;
  subagentCount: number;
  hasTodos: boolean;
  hasRetry: boolean;
};

export class MonitorRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonitorRuntimeError";
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asTimestampMs(value: unknown, fallbackMs: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  return fallbackMs;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  return Math.trunc(value);
}

function asRuntimeStatus(
  value: unknown,
): MonitorSessionRuntimeStatus | undefined {
  if (value === "idle" || value === "busy" || value === "retry") {
    return value;
  }
  return undefined;
}

function buildSessionKey(sourceId: string, sessionId: string): string {
  return `${sourceId}::${sessionId}`;
}

export function parseMonitorIngestRequest(
  payload: unknown,
): MonitorIngestRequestContract {
  if (!payload || typeof payload !== "object") {
    throw new MonitorRuntimeError("ingest payload must be a JSON object");
  }

  const parsed = payload as MonitorIngestRequestContract;
  const sourceId = asNonEmptyString(parsed.source?.instanceId);
  if (!sourceId) {
    throw new MonitorRuntimeError("source.instanceId is required");
  }

  if (parsed.heartbeat?.activeSessionIds) {
    const allValid = parsed.heartbeat.activeSessionIds.every(
      (id) => typeof id === "string" && id.trim().length > 0,
    );
    if (!allValid) {
      throw new MonitorRuntimeError(
        "heartbeat.activeSessionIds must contain non-empty strings",
      );
    }
  }

  if (parsed.events && !Array.isArray(parsed.events)) {
    throw new MonitorRuntimeError("events must be an array");
  }

  return parsed;
}

class MonitorRuntimeStore {
  private sources = new Map<string, RuntimeSourceState>();
  private sessions = new Map<string, RuntimeSessionState>();
  private listeners = new Set<() => void>();

  public ingest(payload: unknown): MonitorIngestResponseContract {
    const nowMs = Date.now();
    this.pruneStaleState(nowMs);

    const request = parseMonitorIngestRequest(payload);
    const sourceId = request.source.instanceId.trim();
    const source = this.touchSource(
      sourceId,
      request.source.label,
      asTimestampMs(request.sentAt, nowMs),
    );

    let acceptedEvents = 0;

    if (request.heartbeat) {
      this.applyHeartbeat(sourceId, request.heartbeat, nowMs);
      acceptedEvents += 1;
    }

    const events: MonitorIngestEventContract[] = [];
    if (request.event) {
      events.push(request.event);
    }
    if (request.events) {
      events.push(...request.events);
    }

    for (const event of events) {
      this.applyEvent(sourceId, event, nowMs);
      acceptedEvents += 1;
    }

    source.lastSeenAtMs = nowMs;
    if (acceptedEvents > 0) {
      this.emit();
    }

    return {
      acceptedEvents,
      snapshot: this.getSnapshot(nowMs),
    };
  }

  public getSnapshot(referenceMs = Date.now()): MonitorSnapshotContract {
    this.pruneStaleState(referenceMs);
    const ttlMs = getMonitorHeartbeatTtlMs();
    const activeSourceIds = new Set<string>();

    for (const [sourceId, source] of this.sources) {
      if (referenceMs - source.lastHeartbeatAtMs <= ttlMs) {
        activeSourceIds.add(sourceId);
      }
    }

    const activeSessions = new Map<string, RuntimeSessionState>();
    for (const [key, session] of this.sessions) {
      if (activeSourceIds.has(session.sourceId)) {
        activeSessions.set(key, session);
      }
    }

    const roots = new Map<string, RuntimeRootAggregate>();
    const rootBySessionKey = new Map<string, string>();

    for (const [sessionKey, _session] of activeSessions) {
      const rootKey = this.resolveRootKey(sessionKey, activeSessions);
      rootBySessionKey.set(sessionKey, rootKey);
      const root = activeSessions.get(rootKey);
      if (!root) continue;
      if (!roots.has(rootKey)) {
        roots.set(rootKey, {
          session: root,
          subagentCount: 0,
          hasTodos: false,
          hasRetry: false,
        });
      }
    }

    for (const [sessionKey, session] of activeSessions) {
      const rootKey = rootBySessionKey.get(sessionKey);
      if (!rootKey) continue;
      const aggregate = roots.get(rootKey);
      if (!aggregate) continue;

      if (sessionKey !== rootKey) {
        aggregate.subagentCount += 1;
      }
      if (session.todoCount > 0) {
        aggregate.hasTodos = true;
      }
      if (session.status === "retry") {
        aggregate.hasRetry = true;
      }
    }

    const activeRootSessions: MonitorSessionSummary[] = Array.from(
      roots.values(),
      (aggregate) => ({
        id: aggregate.session.id,
        title: aggregate.session.title,
        directory: aggregate.session.directory,
        createdAt: new Date(aggregate.session.createdAtMs).toISOString(),
        updatedAt: new Date(aggregate.session.updatedAtMs).toISOString(),
        messageCount: aggregate.session.messageCount,
        toolCallCount: aggregate.session.toolCallCount,
        compactionCount: aggregate.session.compactionCount,
        subagentCount: aggregate.subagentCount,
        signalLevel: this.getSignalLevel(
          aggregate.session.status,
          aggregate.session.compactionCount,
          aggregate.session.todoCount,
          aggregate.hasRetry,
          aggregate.hasTodos,
        ),
      }),
    ).sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );

    let mainCompactions = 0;
    let subagentCompactions = 0;
    for (const [sessionKey, session] of activeSessions) {
      const rootKey = rootBySessionKey.get(sessionKey);
      if (!rootKey) continue;
      if (sessionKey === rootKey) {
        mainCompactions += session.compactionCount;
      } else {
        subagentCompactions += session.compactionCount;
      }
    }

    const retryCount = activeRootSessions.filter(
      (session) => session.signalLevel === "error",
    ).length;
    const totalSubagentCount = activeRootSessions.reduce(
      (sum, session) => sum + session.subagentCount,
      0,
    );
    const todoSessionCount = Array.from(roots.values()).filter(
      (aggregate) => aggregate.hasTodos,
    ).length;

    return {
      kind: "monitor.snapshot",
      generatedAt: new Date(referenceMs).toISOString(),
      activeRootSessions,
      compactionCounts: {
        main: mainCompactions,
        subagent: subagentCompactions,
        total: mainCompactions + subagentCompactions,
      },
      signalBadges: [
        {
          key: "active",
          label: "Active sessions",
          level: activeRootSessions.length > 0 ? "info" : "success",
          count: activeRootSessions.length,
        },
        {
          key: "retry",
          label: "Retrying sessions",
          level: retryCount > 0 ? "error" : "success",
          count: retryCount,
        },
        {
          key: "subagent",
          label: "Active subagents",
          level: totalSubagentCount > 0 ? "info" : "success",
          count: totalSubagentCount,
        },
        {
          key: "todos",
          label: "Sessions with todos",
          level: todoSessionCount > 0 ? "warning" : "success",
          count: todoSessionCount,
        },
      ],
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reset(): void {
    this.sources.clear();
    this.sessions.clear();
    this.listeners.clear();
  }

  private touchSource(
    sourceId: string,
    label: string | undefined,
    nowMs: number,
  ): RuntimeSourceState {
    const current = this.sources.get(sourceId) ?? {
      instanceId: sourceId,
      lastHeartbeatAtMs: 0,
      lastSeenAtMs: nowMs,
    };

    const normalizedLabel = asNonEmptyString(label);
    if (normalizedLabel) {
      current.label = normalizedLabel;
    }
    current.lastSeenAtMs = nowMs;
    this.sources.set(sourceId, current);
    return current;
  }

  private applyHeartbeat(
    sourceId: string,
    heartbeat: MonitorIngestRequestContract["heartbeat"],
    nowMs: number,
  ): void {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new MonitorRuntimeError(
        `source state missing for instance "${sourceId}"`,
      );
    }
    const heartbeatAtMs = asTimestampMs(heartbeat?.at, nowMs);
    source.lastHeartbeatAtMs = heartbeatAtMs;
    source.lastSeenAtMs = nowMs;
    this.sources.set(sourceId, source);

    const activeSessionIds = heartbeat?.activeSessionIds?.map((id) =>
      id.trim(),
    );
    if (!activeSessionIds) {
      return;
    }

    const activeSessionSet = new Set(activeSessionIds);
    for (const [key, session] of this.sessions) {
      if (session.sourceId !== sourceId) continue;
      if (!activeSessionSet.has(session.id)) {
        this.sessions.delete(key);
      }
    }

    for (const sessionId of activeSessionSet) {
      this.upsertSession(sourceId, { id: sessionId }, heartbeatAtMs);
    }
  }

  private applyEvent(
    sourceId: string,
    event: MonitorIngestEventContract,
    nowMs: number,
  ): void {
    switch (event.type) {
      case "heartbeat":
        this.applyHeartbeat(
          sourceId,
          { at: event.at, activeSessionIds: event.activeSessionIds },
          nowMs,
        );
        return;
      case "session.upsert":
      case "session.created":
      case "session.updated":
        this.upsertSession(sourceId, event.session, nowMs);
        return;
      case "session.status": {
        const session = this.upsertSession(sourceId, event.session, nowMs);
        session.status = asRuntimeStatus(event.status) ?? session.status;
        session.lastSeenAtMs = nowMs;
        this.sessions.set(session.key, session);
        return;
      }
      case "session.idle": {
        const session = this.upsertSession(sourceId, event.session, nowMs);
        session.status = "idle";
        session.lastSeenAtMs = nowMs;
        this.sessions.set(session.key, session);
        return;
      }
      case "session.error": {
        const session = this.upsertSession(sourceId, event.session, nowMs);
        session.status = "retry";
        session.lastSeenAtMs = nowMs;
        this.sessions.set(session.key, session);
        return;
      }
      case "session.compacted": {
        const session = this.upsertSession(sourceId, event.session, nowMs);
        const increment = asNonNegativeInteger(event.increment) ?? 1;
        session.compactionCount += increment;
        session.lastSeenAtMs = nowMs;
        this.sessions.set(session.key, session);
        return;
      }
      case "session.deleted": {
        const sessionId = asNonEmptyString(event.sessionId);
        if (!sessionId) {
          throw new MonitorRuntimeError("session.deleted requires sessionId");
        }
        this.sessions.delete(buildSessionKey(sourceId, sessionId));
        return;
      }
      case "todo.updated": {
        const sessionId =
          asNonEmptyString(event.sessionId) ??
          asNonEmptyString(event.session?.id);
        if (!sessionId) {
          throw new MonitorRuntimeError("todo.updated requires sessionId");
        }
        const session = this.upsertSession(
          sourceId,
          event.session ?? { id: sessionId },
          nowMs,
        );

        if (
          typeof event.openCount === "number" &&
          Number.isFinite(event.openCount)
        ) {
          session.todoCount = Math.max(0, Math.trunc(event.openCount));
        } else if (
          typeof event.delta === "number" &&
          Number.isFinite(event.delta)
        ) {
          session.todoCount = Math.max(
            0,
            session.todoCount + Math.trunc(event.delta),
          );
        } else if (typeof event.hasOpenTodo === "boolean") {
          session.todoCount = event.hasOpenTodo
            ? Math.max(1, session.todoCount)
            : 0;
        }

        session.lastSeenAtMs = nowMs;
        this.sessions.set(session.key, session);
        return;
      }
      default:
        throw new MonitorRuntimeError(
          `unsupported event type: ${(event as { type: string }).type}`,
        );
    }
  }

  private upsertSession(
    sourceId: string,
    patch: MonitorIngestSessionContract,
    nowMs: number,
  ): RuntimeSessionState {
    const sessionId = asNonEmptyString(patch.id);
    if (!sessionId) {
      throw new MonitorRuntimeError("session.id is required");
    }

    const key = buildSessionKey(sourceId, sessionId);
    const existing = this.sessions.get(key);
    const updatedAtMs = asTimestampMs(
      patch.updatedAt,
      existing?.updatedAtMs ?? nowMs,
    );

    const next: RuntimeSessionState = {
      key,
      sourceId,
      id: sessionId,
      title: asNonEmptyString(patch.title) ?? existing?.title ?? sessionId,
      directory:
        asNonEmptyString(patch.directory) ?? existing?.directory ?? "(unknown)",
      parentId:
        patch.parentId === null
          ? null
          : (asNonEmptyString(patch.parentId) ?? existing?.parentId ?? null),
      createdAtMs: existing?.createdAtMs ?? updatedAtMs,
      updatedAtMs,
      messageCount:
        asNonNegativeInteger(patch.messageCount) ?? existing?.messageCount ?? 0,
      toolCallCount:
        asNonNegativeInteger(patch.toolCallCount) ??
        existing?.toolCallCount ??
        0,
      compactionCount:
        asNonNegativeInteger(patch.compactionCount) ??
        existing?.compactionCount ??
        0,
      todoCount:
        asNonNegativeInteger(patch.todoCount) ?? existing?.todoCount ?? 0,
      status: asRuntimeStatus(patch.status) ?? existing?.status ?? "idle",
      lastSeenAtMs: nowMs,
    };

    this.sessions.set(key, next);
    return next;
  }

  private resolveRootKey(
    key: string,
    sessions: Map<string, RuntimeSessionState>,
  ): string {
    let currentKey = key;
    const visited = new Set<string>();

    while (true) {
      if (visited.has(currentKey)) {
        return currentKey;
      }
      visited.add(currentKey);

      const current = sessions.get(currentKey);
      if (!current || !current.parentId) {
        return currentKey;
      }

      const parentKey = buildSessionKey(current.sourceId, current.parentId);
      if (!sessions.has(parentKey)) {
        return currentKey;
      }
      currentKey = parentKey;
    }
  }

  private getSignalLevel(
    status: MonitorSessionRuntimeStatus,
    compactionCount: number,
    todoCount: number,
    hasRetry: boolean,
    hasTodos: boolean,
  ): MonitorSessionSummary["signalLevel"] {
    if (status === "retry" || hasRetry) {
      return "error";
    }
    if (compactionCount > 0 || todoCount > 0 || hasTodos) {
      return "warning";
    }
    return "success";
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private pruneStaleState(referenceMs: number): void {
    const pruneWindowMs = getMonitorHeartbeatTtlMs() * 4;
    const staleSourceIds = new Set<string>();

    for (const [sourceId, source] of this.sources) {
      if (referenceMs - source.lastSeenAtMs > pruneWindowMs) {
        staleSourceIds.add(sourceId);
        this.sources.delete(sourceId);
      }
    }

    for (const [sessionKey, session] of this.sessions) {
      if (staleSourceIds.has(session.sourceId)) {
        this.sessions.delete(sessionKey);
      }
    }
  }
}

const runtimeStore = new MonitorRuntimeStore();

export function buildMonitorSnapshotFromRuntime(): MonitorSnapshotContract {
  return runtimeStore.getSnapshot();
}

export function ingestMonitorRuntimeEvent(
  payload: unknown,
): MonitorIngestResponseContract {
  return runtimeStore.ingest(payload);
}

export function subscribeMonitorRuntimeUpdates(
  listener: () => void,
): () => void {
  return runtimeStore.subscribe(listener);
}

export function resetMonitorRuntimeStoreForTest(): void {
  runtimeStore.reset();
}
