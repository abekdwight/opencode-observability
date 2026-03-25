import React from "react";
import type {
  MonitorSessionSummary,
  MonitorSnapshotContract,
} from "../../src/contracts/monitor.js";

export function isLegacySourceSession(
  session: Pick<MonitorSessionSummary, "id">,
) {
  return session.id.startsWith("source:");
}

export function mergeRetainedMonitorSessions(
  retained: MonitorSessionSummary[],
  nextActive: MonitorSessionSummary[],
): MonitorSessionSummary[] {
  const merged = new Map<string, MonitorSessionSummary>();

  for (const session of retained) {
    if (isLegacySourceSession(session)) continue;
    merged.set(session.id, session);
  }

  for (const session of nextActive) {
    if (isLegacySourceSession(session)) continue;
    merged.set(session.id, session);
  }

  return [...merged.values()].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function useMonitorFeed() {
  const [data, setData] = React.useState<MonitorSnapshotContract | null>(null);
  const [retainedSessions, setRetainedSessions] = React.useState<
    MonitorSessionSummary[]
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [liveState, setLiveState] = React.useState<"live" | "degraded">("live");

  React.useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const clearTimers = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
    };

    const loadSnapshot = async () => {
      try {
        const snapshot = await fetchJson<MonitorSnapshotContract>(
          "/api/monitor/snapshot",
        );
        if (!active) return;
        setData(snapshot);
        setRetainedSessions((current) =>
          mergeRetainedMonitorSessions(current, snapshot.activeRootSessions),
        );
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    const connect = () => {
      eventSource = new EventSource("/api/monitor/events");
      eventSource.addEventListener("snapshot", (event) => {
        const payload = JSON.parse(event.data) as {
          payload?: MonitorSnapshotContract;
        };
        const snapshot = payload.payload;
        if (!active || !snapshot) return;
        setData(snapshot);
        setRetainedSessions((current) =>
          mergeRetainedMonitorSessions(current, snapshot.activeRootSessions),
        );
        setError(null);
        setLiveState("live");
      });
      eventSource.onerror = () => {
        if (!active) return;
        eventSource?.close();
        eventSource = null;
        setLiveState("degraded");
        reconnectTimer = window.setTimeout(() => {
          clearTimers();
          connect();
        }, 3_000);
      };
    };

    void loadSnapshot();
    connect();

    return () => {
      active = false;
      clearTimers();
      eventSource?.close();
    };
  }, []);

  return { data, retainedSessions, error, loading, liveState };
}
