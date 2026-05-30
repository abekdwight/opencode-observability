import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "opencode.db",
);
const DEFAULT_CODEX_STATE_DB_PATH = path.join(
  homedir(),
  ".codex",
  "state_5.sqlite",
);
const DEFAULT_CLAUDE_PROJECTS_DIR = path.join(homedir(), ".claude", "projects");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3737;
const DEFAULT_MONITOR_ACTIVE_WINDOW_MS = 15 * 60_000;
const DEFAULT_MONITOR_HEARTBEAT_TTL_MS = 90 * 1_000;

export function getPort(): number {
  const value = process.env.PORT;
  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

export function getHost(): string {
  const value = process.env.HOST?.trim();
  if (!value) {
    return DEFAULT_HOST;
  }
  return value;
}

export function getOpenCodeDbPath(): string {
  const value = process.env.OPENCODE_DB_PATH?.trim();
  return value && value.length > 0 ? value : DEFAULT_DB_PATH;
}

export function getCodexStateDbPath(): string {
  const value = process.env.CODEX_STATE_DB_PATH?.trim();
  return value && value.length > 0 ? value : DEFAULT_CODEX_STATE_DB_PATH;
}

export function getClaudeProjectsDir(): string {
  const value = process.env.CLAUDE_PROJECTS_DIR?.trim();
  return value && value.length > 0 ? value : DEFAULT_CLAUDE_PROJECTS_DIR;
}

export function getMonitorActiveWindowMs(): number {
  const value = process.env.OPENCODE_MONITOR_ACTIVE_WINDOW_MS;
  if (!value) {
    return DEFAULT_MONITOR_ACTIVE_WINDOW_MS;
  }

  const ms = Number(value);
  return Number.isInteger(ms) && ms > 0 ? ms : DEFAULT_MONITOR_ACTIVE_WINDOW_MS;
}

export function getMonitorHeartbeatTtlMs(): number {
  const value = process.env.OPENCODE_MONITOR_HEARTBEAT_TTL_MS;
  if (!value) {
    return DEFAULT_MONITOR_HEARTBEAT_TTL_MS;
  }

  const ms = Number(value);
  return Number.isInteger(ms) && ms > 0 ? ms : DEFAULT_MONITOR_HEARTBEAT_TTL_MS;
}

export function getMonitorIngestToken(): string | null {
  const value = process.env.OPENCODE_MONITOR_INGEST_TOKEN?.trim();
  return value && value.length > 0 ? value : null;
}
