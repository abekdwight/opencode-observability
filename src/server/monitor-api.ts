import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { MonitorSnapshotContract } from "../contracts/monitor.js";
import { getMonitorIngestToken } from "../lib/config.js";
import {
  buildMonitorSnapshotFromRuntime,
  ingestMonitorRuntimeEvent,
  MonitorRuntimeError,
  subscribeMonitorRuntimeUpdates,
} from "./monitor-runtime-store.js";

type MonitorSnapshotEventEnvelope = {
  type: "snapshot";
  generatedAt: number;
  payload: MonitorSnapshotContract;
};

type MonitorHeartbeatEventEnvelope = {
  type: "heartbeat";
  generatedAt: number;
};

export const MONITOR_SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export function buildMonitorSnapshot(): MonitorSnapshotContract {
  return buildMonitorSnapshotFromRuntime();
}

function hasValidIngestToken(
  authorizationHeader: string | null,
  tokenHeader: string | null,
): boolean {
  const configuredToken = getMonitorIngestToken();
  if (!configuredToken) {
    return true;
  }

  if (tokenHeader?.trim() === configuredToken) {
    return true;
  }

  if (!authorizationHeader) {
    return false;
  }

  const [scheme, credentials] = authorizationHeader.split(/\s+/, 2);
  return (
    scheme.toLowerCase() === "bearer" && credentials?.trim() === configuredToken
  );
}

export const monitorApi = new Hono()
  .post("/ingest", async (c) => {
    if (
      !hasValidIngestToken(
        c.req.header("authorization") ?? null,
        c.req.header("x-opencode-observability-token") ??
          c.req.header("x-opencode-telemetry-token") ??
          null,
      )
    ) {
      return c.json(
        {
          message: "ingest token mismatch",
        },
        401,
      );
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        {
          message: "invalid ingest payload: body must be JSON",
        },
        400,
      );
    }

    try {
      const result = ingestMonitorRuntimeEvent(payload);
      return c.json(result, 202);
    } catch (error) {
      const message =
        error instanceof MonitorRuntimeError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      return c.json({ message: `invalid ingest payload: ${message}` }, 400);
    }
  })
  .get("/snapshot", async (c) => c.json(buildMonitorSnapshot()))
  .get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const writeSnapshot = async () => {
        const snapshot: MonitorSnapshotEventEnvelope = {
          type: "snapshot",
          generatedAt: Date.now(),
          payload: buildMonitorSnapshot(),
        };
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify(snapshot),
        });
      };

      const writeHeartbeat = async () => {
        const heartbeat: MonitorHeartbeatEventEnvelope = {
          type: "heartbeat",
          generatedAt: Date.now(),
        };
        await stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify(heartbeat),
        });
      };

      await writeSnapshot();

      let writeQueue = Promise.resolve();
      const enqueueWrite = (write: () => Promise<void>) => {
        writeQueue = writeQueue
          .then(async () => {
            if (!stream.aborted) {
              await write();
            }
          })
          .catch(() => undefined);
      };

      const unsubscribe = subscribeMonitorRuntimeUpdates(() => {
        enqueueWrite(writeSnapshot);
      });

      const heartbeatTimer = setInterval(() => {
        enqueueWrite(writeHeartbeat);
      }, MONITOR_SSE_HEARTBEAT_INTERVAL_MS);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeatTimer);
          unsubscribe();
          resolve();
        });
      });

      await writeQueue;
    }),
  );
