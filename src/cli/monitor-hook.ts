import { spawn } from "node:child_process";
import { type FileHandle, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type HookHarness = "codex" | "claude";

type ServerTarget = {
  healthUrl: URL;
  host: string;
  port: number;
  isLocal: boolean;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:3737";
const DEFAULT_SERVER_PACKAGE = "opencode-observability@latest";
const AUTOSTART_POLL_INTERVAL_MS = 250;
const HEALTHCHECK_TIMEOUT_MS = 800;
const SENTINEL = "OPENCODE_OBSERVABILITY_OPEN_MONITOR";
const RAW_CODEX_TRIGGERS = new Set(["/monitor", "@monitor"]);

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function envIntMs(key: string, fallback: number, minimum: number): number {
  const value = Number(env(key) ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.trunc(value));
}

function block(reason: string): void {
  console.log(JSON.stringify({ decision: "block", reason }));
}

function baseUrl(): string {
  return (env("OPENCODE_OBSERVABILITY_URL") ?? DEFAULT_BASE_URL).replace(
    /\/+$/u,
    "",
  );
}

function parseServerTarget(base: string): ServerTarget | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return null;
  }

  const port = Number(url.port || (protocol === "https:" ? "443" : "80"));
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  const host = url.hostname;
  const normalizedHost = host.toLowerCase();
  const isLocal =
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "localhost" ||
    normalizedHost === "::1";

  return {
    healthUrl: new URL("/api/monitor/snapshot", url),
    host,
    port,
    isLocal,
  };
}

async function isServerHealthy(url: URL): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
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
    await new Promise((resolve) =>
      setTimeout(resolve, AUTOSTART_POLL_INTERVAL_MS),
    );
  }
  return false;
}

function startupLockPathFor(port: number): string {
  return path.join(os.tmpdir(), `opencode-observability-${port}.lock`);
}

async function tryAcquireStartupLock(
  lockPath: string,
): Promise<FileHandle | null> {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(String(process.pid));
    return handle;
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
  const firstTry = await tryAcquireStartupLock(lockPath);
  if (firstTry) {
    return firstTry;
  }

  try {
    const lockStat = await stat(lockPath);
    const staleMs = envIntMs(
      "OPENCODE_OBSERVABILITY_LOCK_STALE_MS",
      30000,
      1000,
    );
    if (Date.now() - lockStat.mtimeMs > staleMs) {
      await rm(lockPath, { force: true });
      return await tryAcquireStartupLock(lockPath);
    }
  } catch {
    return await tryAcquireStartupLock(lockPath);
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
    // Ignore close errors while releasing the best-effort startup lock.
  }

  await rm(lockPath, { force: true }).catch(() => undefined);
}

function npxCommand(): string {
  return (
    env("OPENCODE_OBSERVABILITY_NPX_CMD") ??
    (os.platform() === "win32" ? "npx.cmd" : "npx")
  );
}

function npxPackage(): string {
  return env("OPENCODE_OBSERVABILITY_NPX_PACKAGE") ?? DEFAULT_SERVER_PACKAGE;
}

function spawnAndDetach(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
  } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: options.env,
      shell: options.shell,
      windowsHide: true,
    });
    child.once("error", () => {
      resolve(false);
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

async function spawnServer(target: ServerTarget): Promise<boolean> {
  const childEnv = {
    ...process.env,
    PORT: String(target.port),
    HOST: target.host,
    npm_config_yes: "true",
  };
  const override = env("OPENCODE_OBSERVABILITY_SERVER_CMD");
  if (override) {
    return await spawnAndDetach(override, [], {
      env: childEnv,
      shell: true,
    });
  }

  return await spawnAndDetach(npxCommand(), ["--yes", npxPackage()], {
    env: childEnv,
  });
}

async function ensureServerReady(base: string): Promise<boolean> {
  const target = parseServerTarget(base);
  if (!target) {
    return false;
  }

  if (await isServerHealthy(target.healthUrl)) {
    return true;
  }

  if (env("OPENCODE_OBSERVABILITY_AUTOSTART") === "0" || !target.isLocal) {
    return false;
  }

  const timeoutMs = envIntMs(
    "OPENCODE_OBSERVABILITY_AUTOSTART_TIMEOUT_MS",
    20000,
    1000,
  );
  const lockPath = startupLockPathFor(target.port);
  const lockHandle = await acquireStartupLock(lockPath);

  if (lockHandle) {
    try {
      if (await isServerHealthy(target.healthUrl)) {
        return true;
      }
      if (!(await spawnServer(target))) {
        return false;
      }
      return await waitForHealthy(target.healthUrl, timeoutMs);
    } finally {
      await releaseStartupLock(lockPath, lockHandle);
    }
  }

  return await waitForHealthy(target.healthUrl, timeoutMs);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function openInBrowser(url: string): Promise<boolean> {
  const override = env("OPENCODE_OBSERVABILITY_OPEN_CMD");
  if (override) {
    return await spawnAndDetach(`${override} ${shellQuote(url)}`, [], {
      env: process.env,
      shell: true,
    });
  }

  if (os.platform() === "darwin") {
    return await spawnAndDetach("open", [url], { env: process.env });
  }

  if (os.platform() === "win32") {
    return await spawnAndDetach("cmd", ["/c", "start", "", url], {
      env: process.env,
    });
  }

  return await spawnAndDetach("xdg-open", [url], { env: process.env });
}

function isMonitorTrigger(harness: HookHarness, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (harness === "codex") {
    const prompt = String(record.prompt ?? "").trim();
    return prompt.includes(SENTINEL) || RAW_CODEX_TRIGGERS.has(prompt);
  }

  const commandName = String(record.command_name ?? "");
  return commandName.split(":").at(-1) === "monitor";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runMonitorHook(harness: HookHarness): Promise<number> {
  const rawPayload = await readStdin();
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return 0;
  }

  if (!isMonitorTrigger(harness, payload)) {
    return 0;
  }

  const sessionId = String(
    (payload as Record<string, unknown>).session_id ?? "",
  );
  if (!sessionId) {
    block("セッションIDを取得できなかったため、ビューアを開けませんでした。");
    return 0;
  }

  const base = baseUrl();
  const url = `${base}/sessions/${harness}/${encodeURIComponent(sessionId)}`;

  if (!(await ensureServerReady(base))) {
    block(
      "ビューアサーバーを自動起動できませんでした。" +
        "`npx --yes opencode-observability@latest` " +
        `で起動後に再実行してください。(${url})`,
    );
    return 0;
  }

  if (await openInBrowser(url)) {
    block(`ビューアを開きました: ${url}`);
  } else {
    block(`ブラウザを自動で開けませんでした。手動で開いてください: ${url}`);
  }

  return 0;
}
