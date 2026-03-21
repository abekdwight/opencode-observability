import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type FileHandle,
  open as openFile,
  rm as removeFile,
  stat as statFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, PluginInput } from "@opencode-ai/plugin";

type SessionStatus = "idle" | "busy" | "retry";

type SessionInfo = {
  id: string;
  title?: string;
  directory?: string;
  parentID?: string;
  time?: {
    updated?: number;
  };
};

type SessionState = {
  id: string;
  title: string;
  directory: string;
  parentId: string | null;
  updatedAt: string;
  compactionCount: number;
  todoCount: number;
  status: SessionStatus;
};

type SessionStatusInfo = {
  type?: unknown;
};

type SessionStatusMap = Record<string, SessionStatusInfo>;

type ServerTarget = {
  ingestUrl: URL;
  healthUrl: URL;
  host: string;
  port: number;
  isLocal: boolean;
};

type EnsureServerResult = {
  target: ServerTarget | null;
  healthy: boolean;
  reason: string;
};

type ToastVariant = "info" | "success" | "warning" | "error";

const PLUGIN_INSTANCE_KEY = Symbol.for("opencode-observability.instance");
const NOOP_HOOKS = {
  event: async () => undefined,
};

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function envWithFallback(key: string, legacyKey: string): string | undefined {
  return env(key) ?? env(legacyKey);
}

const INGEST_URL =
  envWithFallback(
    "OPENCODE_OBSERVABILITY_INGEST_URL",
    "OPENCODE_TELEMETRY_INGEST_URL",
  ) || "http://127.0.0.1:3737/api/monitor/ingest";
const HEARTBEAT_INTERVAL_MS = Math.max(
  1_000,
  Number(
    envWithFallback(
      "OPENCODE_OBSERVABILITY_HEARTBEAT_MS",
      "OPENCODE_TELEMETRY_HEARTBEAT_MS",
    ) || "10000",
  ),
);
const INGEST_TOKEN = process.env.OPENCODE_MONITOR_INGEST_TOKEN?.trim() || null;
const INSTANCE_ID =
  envWithFallback(
    "OPENCODE_OBSERVABILITY_INSTANCE_ID",
    "OPENCODE_TELEMETRY_INSTANCE_ID",
  ) || `${os.hostname()}:${process.pid}`;
const SOURCE_LABEL =
  envWithFallback(
    "OPENCODE_OBSERVABILITY_SOURCE_LABEL",
    "OPENCODE_TELEMETRY_SOURCE_LABEL",
  ) || "opencode-observability";
const FALLBACK_SESSION_TITLE = "OpenCode terminal";
const AUTOSTART_ENABLED =
  envWithFallback(
    "OPENCODE_OBSERVABILITY_AUTOSTART",
    "OPENCODE_TELEMETRY_AUTOSTART",
  ) !== "0";
const AUTOSTART_TIMEOUT_MS = Math.max(
  1_000,
  Number(
    envWithFallback(
      "OPENCODE_OBSERVABILITY_AUTOSTART_TIMEOUT_MS",
      "OPENCODE_TELEMETRY_AUTOSTART_TIMEOUT_MS",
    ) || "20000",
  ),
);
const AUTOSTART_POLL_INTERVAL_MS = 250;
const HEALTHCHECK_TIMEOUT_MS = 800;
const STARTUP_LOCK_STALE_MS = Math.max(
  1_000,
  Number(
    envWithFallback(
      "OPENCODE_OBSERVABILITY_LOCK_STALE_MS",
      "OPENCODE_TELEMETRY_LOCK_STALE_MS",
    ) || "30000",
  ),
);

function toIso(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return new Date().toISOString();
  }
  return new Date(value).toISOString();
}

function emptySession(sessionId: string): SessionState {
  return {
    id: sessionId,
    title: sessionId,
    directory: "(unknown)",
    parentId: null,
    updatedAt: new Date().toISOString(),
    compactionCount: 0,
    todoCount: 0,
    status: "idle",
  };
}

function parseServerTarget(ingestUrlRaw: string): ServerTarget | null {
  let ingestUrl: URL;
  try {
    ingestUrl = new URL(ingestUrlRaw);
  } catch {
    return null;
  }

  const protocol = ingestUrl.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return null;
  }

  const port = Number(ingestUrl.port || (protocol === "https:" ? "443" : "80"));
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  const host = ingestUrl.hostname;
  const normalizedHost = host.toLowerCase();
  const isLocal =
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "localhost" ||
    normalizedHost === "::1";

  const healthUrl = new URL("/api/monitor/snapshot", ingestUrl);
  return {
    ingestUrl,
    healthUrl,
    host,
    port,
    isLocal,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(
  url: URL,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function isServerHealthy(url: URL): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, HEALTHCHECK_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

function resolveServerCommand(metaUrl: string): {
  command: string;
  args: string[];
} | null {
  const moduleDir = path.dirname(fileURLToPath(metaUrl));
  const command =
    resolveScriptRuntimeCommand() ??
    envWithFallback(
      "OPENCODE_OBSERVABILITY_NODE_PATH",
      "OPENCODE_TELEMETRY_NODE_PATH",
    ) ??
    "node";
  const jsCandidates = [
    path.resolve(moduleDir, "../cli/opencode-observability.js"),
    path.resolve(moduleDir, "../../dist/server/cli/opencode-observability.js"),
    path.resolve(process.cwd(), "dist/server/cli/opencode-observability.js"),
    path.resolve(moduleDir, "../cli/opencode-telemetry.js"),
    path.resolve(moduleDir, "../../dist/server/cli/opencode-telemetry.js"),
    path.resolve(process.cwd(), "dist/server/cli/opencode-telemetry.js"),
  ];

  for (const candidate of jsCandidates) {
    if (existsSync(candidate)) {
      return { command, args: [candidate] };
    }
  }

  return null;
}

function resolveScriptRuntimeCommand(): string | null {
  const executable = path.basename(process.execPath).toLowerCase();
  if (executable.includes("node")) {
    return process.execPath;
  }
  return null;
}

function monitorAppUrl(target: ServerTarget): string {
  return new URL("/monitor", target.ingestUrl).toString();
}

async function showToast(
  client: PluginInput["client"],
  {
    title,
    message,
    variant,
    duration,
  }: {
    title?: string;
    message: string;
    variant: ToastVariant;
    duration?: number;
  },
): Promise<void> {
  try {
    await client.tui.showToast({
      body: {
        title,
        message,
        variant,
        duration,
      },
    });
  } catch {
    // ignore toast delivery failures in non-TUI contexts
  }
}

async function waitForHealthy(
  healthUrl: URL,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy(healthUrl)) {
      return true;
    }
    await sleep(AUTOSTART_POLL_INTERVAL_MS);
  }
  return false;
}

function startupLockPathFor(port: number): string {
  return path.join(os.tmpdir(), `opencode-observability-${port}.lock`);
}

async function tryOpenStartupLock(
  lockPath: string,
): Promise<FileHandle | null> {
  try {
    const lockHandle = await openFile(lockPath, "wx");
    await lockHandle.writeFile(String(process.pid));
    return lockHandle;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      return null;
    }
    throw error;
  }
}

async function acquireStartupLock(
  lockPath: string,
): Promise<FileHandle | null> {
  const firstTry = await tryOpenStartupLock(lockPath);
  if (firstTry) {
    return firstTry;
  }

  try {
    const lockStat = await statFile(lockPath);
    if (Date.now() - lockStat.mtimeMs > STARTUP_LOCK_STALE_MS) {
      await removeFile(lockPath, { force: true });
      return await tryOpenStartupLock(lockPath);
    }
  } catch {
    // Lock file vanished while inspecting; try once again.
    return await tryOpenStartupLock(lockPath);
  }

  return null;
}

async function releaseStartupLock(
  lockPath: string,
  lockHandle: FileHandle | null,
): Promise<void> {
  if (!lockHandle) {
    return;
  }

  try {
    await lockHandle.close();
  } catch {
    // ignore close error
  }

  await removeFile(lockPath, { force: true }).catch(() => undefined);
}

async function ensureLocalObservabilityServerReady(
  postLogWarn: (message: string, error: unknown) => Promise<void>,
): Promise<EnsureServerResult> {
  const target = parseServerTarget(INGEST_URL);
  if (!AUTOSTART_ENABLED) {
    return {
      target,
      healthy: false,
      reason: "autostart-disabled",
    };
  }

  if (!target) {
    return {
      target: null,
      healthy: false,
      reason: "invalid-ingest-url",
    };
  }

  if (!target.isLocal) {
    return {
      target,
      healthy: true,
      reason: "non-local-ingest",
    };
  }

  if (await isServerHealthy(target.healthUrl)) {
    return {
      target,
      healthy: true,
      reason: "already-healthy",
    };
  }

  const lockPath = startupLockPathFor(target.port);
  const lockHandle = await acquireStartupLock(lockPath);

  if (lockHandle) {
    try {
      if (await isServerHealthy(target.healthUrl)) {
        return {
          target,
          healthy: true,
          reason: "already-healthy",
        };
      }

      const command = resolveServerCommand(import.meta.url);
      if (!command) {
        await postLogWarn(
          "failed to resolve observability server command for autostart",
          `ingest_url=${target.ingestUrl.href}`,
        );
        return {
          target,
          healthy: false,
          reason: "resolve-command-failed",
        };
      }

      await new Promise<void>((resolve) => {
        const child = spawn(command.command, command.args, {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            PORT: String(target.port),
            HOST: target.host,
          },
        });
        child.once("error", (error) => {
          void postLogWarn("failed to spawn observability server", error).then(
            resolve,
          );
        });
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });

      const ready = await waitForHealthy(
        target.healthUrl,
        AUTOSTART_TIMEOUT_MS,
      );
      if (!ready) {
        await postLogWarn(
          "observability server autostart timed out",
          `health_url=${target.healthUrl.href}`,
        );
        return {
          target,
          healthy: false,
          reason: "autostart-timeout",
        };
      }
      return {
        target,
        healthy: true,
        reason: "autostarted",
      };
    } catch (error) {
      await postLogWarn("failed to autostart observability server", error);
      return {
        target,
        healthy: false,
        reason: "autostart-error",
      };
    } finally {
      await releaseStartupLock(lockPath, lockHandle);
    }
  }

  const ready = await waitForHealthy(target.healthUrl, AUTOSTART_TIMEOUT_MS);
  if (!ready) {
    await postLogWarn(
      "observability server is still unavailable while waiting for another starter",
      `health_url=${target.healthUrl.href}`,
    );
    return {
      target,
      healthy: false,
      reason: "wait-timeout",
    };
  }
  return {
    target,
    healthy: true,
    reason: "started-by-other",
  };
}

export const OpencodeObservabilityPlugin: Plugin = async ({
  client,
  directory,
}) => {
  const globalState = globalThis as Record<PropertyKey, unknown>;
  if (globalState[PLUGIN_INSTANCE_KEY]) {
    return NOOP_HOOKS;
  }
  globalState[PLUGIN_INSTANCE_KEY] = true;

  const sessions = new Map<string, SessionState>();
  const hydratedSessionIds = new Set<string>();
  const fallbackSessionId = `source:${INSTANCE_ID}`;
  let requestQueue = Promise.resolve();

  const postLogWarn = async (message: string, error: unknown) => {
    try {
      await client.app.log({
        body: {
          service: "opencode-observability-plugin",
          level: "warn",
          message,
          extra: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
    } catch {
      // ignore logging errors in plugin bridge
    }
  };

  const ensureServerReadyPromise = ensureLocalObservabilityServerReady(
    postLogWarn,
  ).catch(async (error) => {
    await postLogWarn(
      "failed while ensuring local observability server",
      error,
    );
    return {
      target: parseServerTarget(INGEST_URL),
      healthy: false,
      reason: "ensure-error",
    } satisfies EnsureServerResult;
  });

  void ensureServerReadyPromise.then(async (result) => {
    if (!result.target?.isLocal) {
      return;
    }
    if (result.healthy) {
      await showToast(client, {
        title: "OpenCode Observability",
        message: `monitor is available at ${monitorAppUrl(result.target)}`,
        variant: "success",
        duration: 3000,
      });
      return;
    }
    await showToast(client, {
      title: "OpenCode Observability",
      message: `monitor is unavailable (${result.reason}). check plugin logs`,
      variant: "warning",
      duration: 5000,
    });
  });

  const enqueuePost = (payload: unknown) => {
    requestQueue = requestQueue
      .then(async () => {
        await ensureServerReadyPromise;

        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (INGEST_TOKEN) {
          headers.authorization = `Bearer ${INGEST_TOKEN}`;
        }

        const response = await fetch(INGEST_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`ingest failed: HTTP ${response.status}`);
        }
      })
      .catch(async (error) =>
        postLogWarn("failed to post ingest payload", error),
      );
  };

  const asSessionStatus = (value: unknown): SessionStatus | null => {
    if (value === "busy" || value === "idle" || value === "retry") {
      return value;
    }
    return null;
  };

  const ensureSessionMetadata = async (sessionId: string) => {
    if (sessionId === fallbackSessionId) {
      return;
    }
    if (hydratedSessionIds.has(sessionId)) {
      return;
    }
    try {
      const response = await client.session.get({
        path: { id: sessionId },
      });
      if (response.error || !response.data) {
        return;
      }
      const session = upsertFromInfo(response.data as SessionInfo);
      if (session) {
        hydratedSessionIds.add(session.id);
      }
    } catch (error) {
      await postLogWarn("failed to hydrate session metadata", error);
    }
  };

  const syncSessionStatus = async () => {
    try {
      const response = await client.session.status();
      if (response.error || !response.data) {
        return;
      }

      const statusMap = response.data as SessionStatusMap;
      const activeSessionIds = new Set<string>();

      for (const [rawSessionId, statusInfo] of Object.entries(statusMap)) {
        const sessionId = rawSessionId.trim();
        if (!sessionId || sessionId === fallbackSessionId) {
          continue;
        }

        activeSessionIds.add(sessionId);
        const session = upsertById(sessionId);
        const status = asSessionStatus(statusInfo?.type);
        if (status) {
          session.status = status;
        }
        sessions.set(sessionId, session);
        await ensureSessionMetadata(sessionId);
      }

      for (const sessionId of [...sessions.keys()]) {
        if (activeSessionIds.has(sessionId)) {
          continue;
        }
        sessions.delete(sessionId);
        hydratedSessionIds.delete(sessionId);
      }

      if (activeSessionIds.size === 0) {
        const fallbackExisted = sessions.has(fallbackSessionId);
        const fallback =
          sessions.get(fallbackSessionId) ?? emptySession(fallbackSessionId);
        fallback.title = FALLBACK_SESSION_TITLE;
        fallback.directory = directory || fallback.directory;
        fallback.parentId = null;
        fallback.status = "idle";
        fallback.updatedAt = new Date().toISOString();
        sessions.set(fallbackSessionId, fallback);
        if (!fallbackExisted) {
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.upsert",
              session: {
                id: fallback.id,
                title: fallback.title,
                directory: fallback.directory,
                parentId: fallback.parentId,
                updatedAt: fallback.updatedAt,
                compactionCount: fallback.compactionCount,
                todoCount: fallback.todoCount,
                status: fallback.status,
              },
            },
          });
        }
      } else if (sessions.has(fallbackSessionId)) {
        sessions.delete(fallbackSessionId);
      }
    } catch (error) {
      await postLogWarn("failed to read runtime session status", error);
    }
  };

  const postHeartbeat = async () => {
    await syncSessionStatus();
    enqueuePost({
      source: {
        instanceId: INSTANCE_ID,
        label: SOURCE_LABEL,
      },
      heartbeat: {
        at: new Date().toISOString(),
        activeSessionIds: [...sessions.keys()],
      },
    });
  };

  const upsertFromInfo = (
    info: SessionInfo | undefined,
  ): SessionState | null => {
    if (!info?.id) {
      return null;
    }
    const current = sessions.get(info.id) ?? emptySession(info.id);
    const next: SessionState = {
      ...current,
      id: info.id,
      title: info.title || current.title,
      directory: info.directory || current.directory,
      parentId: info.parentID || current.parentId,
      updatedAt: toIso(info.time?.updated),
    };
    sessions.set(info.id, next);
    hydratedSessionIds.add(info.id);
    return next;
  };

  const upsertById = (sessionId: string): SessionState => {
    const current = sessions.get(sessionId) ?? emptySession(sessionId);
    current.updatedAt = new Date().toISOString();
    sessions.set(sessionId, current);
    return current;
  };

  void postHeartbeat();
  setInterval(() => {
    void postHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  return {
    event: async ({ event }) => {
      switch (event?.type) {
        case "session.created":
        case "session.updated": {
          sessions.delete(fallbackSessionId);
          const session = upsertFromInfo(event.properties?.info);
          if (!session) return;
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.upsert",
              session: {
                id: session.id,
                title: session.title,
                directory: session.directory,
                parentId: session.parentId,
                updatedAt: session.updatedAt,
                compactionCount: session.compactionCount,
                todoCount: session.todoCount,
                status: session.status,
              },
            },
          });
          return;
        }

        case "session.deleted": {
          const sessionId: string | undefined = event.properties?.info?.id;
          if (!sessionId) return;
          sessions.delete(sessionId);
          hydratedSessionIds.delete(sessionId);
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.deleted",
              sessionId,
            },
          });
          return;
        }

        case "session.status": {
          const sessionId: string | undefined = event.properties?.sessionID;
          const rawStatus: string | undefined = event.properties?.status?.type;
          if (!sessionId) return;
          sessions.delete(fallbackSessionId);
          const session = upsertById(sessionId);
          if (
            rawStatus === "busy" ||
            rawStatus === "idle" ||
            rawStatus === "retry"
          ) {
            session.status = rawStatus;
          }
          session.updatedAt = new Date().toISOString();
          sessions.set(sessionId, session);
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.status",
              session: {
                id: session.id,
                title: session.title,
                directory: session.directory,
                parentId: session.parentId,
                updatedAt: session.updatedAt,
              },
              status: session.status,
            },
          });
          return;
        }

        case "session.idle": {
          const sessionId: string | undefined = event.properties?.sessionID;
          if (!sessionId) return;
          sessions.delete(fallbackSessionId);
          const session = upsertById(sessionId);
          session.status = "idle";
          sessions.set(sessionId, session);
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.idle",
              session: {
                id: session.id,
                title: session.title,
                directory: session.directory,
                parentId: session.parentId,
                updatedAt: session.updatedAt,
              },
            },
          });
          return;
        }

        case "session.error": {
          const sessionId: string | undefined = event.properties?.sessionID;
          if (!sessionId) return;
          sessions.delete(fallbackSessionId);
          const session = upsertById(sessionId);
          session.status = "retry";
          sessions.set(sessionId, session);
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.error",
              session: {
                id: session.id,
                title: session.title,
                directory: session.directory,
                parentId: session.parentId,
                updatedAt: session.updatedAt,
              },
            },
          });
          return;
        }

        case "session.compacted": {
          const sessionId: string | undefined = event.properties?.sessionID;
          if (!sessionId) return;
          sessions.delete(fallbackSessionId);
          const session = upsertById(sessionId);
          session.compactionCount += 1;
          sessions.set(sessionId, session);
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "session.compacted",
              session: {
                id: session.id,
                title: session.title,
                directory: session.directory,
                parentId: session.parentId,
                updatedAt: session.updatedAt,
              },
              increment: 1,
            },
          });
          return;
        }

        case "todo.updated": {
          const sessionId: string | undefined = event.properties?.sessionID;
          if (!sessionId) return;
          sessions.delete(fallbackSessionId);
          const todos: Array<{ status?: string }> = Array.isArray(
            event.properties?.todos,
          )
            ? event.properties.todos
            : [];
          const openCount = todos.filter(
            (todo) =>
              todo.status !== "completed" && todo.status !== "cancelled",
          ).length;
          const session = upsertById(sessionId);
          session.todoCount = openCount;
          sessions.set(sessionId, session);
          enqueuePost({
            source: { instanceId: INSTANCE_ID, label: SOURCE_LABEL },
            event: {
              type: "todo.updated",
              sessionId,
              openCount,
              session: {
                id: session.id,
                title: session.title,
                directory: session.directory,
                parentId: session.parentId,
                updatedAt: session.updatedAt,
              },
            },
          });
          return;
        }

        default:
          return;
      }
    },
  };
};

export const OpencodeTelemetryPlugin = OpencodeObservabilityPlugin;

export default OpencodeObservabilityPlugin;
