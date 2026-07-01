import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const pythonAvailable = spawnSync("python3", ["--version"]).status === 0;
const describeIf = pythonAvailable ? describe : describe.skip;
const tempDirs: string[] = [];

function quoteForShlex(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a port"));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function writeFakeServerScript(dir: string): string {
  const scriptPath = path.join(dir, "fake-server.mjs");
  fs.writeFileSync(
    scriptPath,
    `
import fs from "node:fs";
import http from "node:http";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || "0");

const server = http.createServer((request, response) => {
  if (request.url === "/api/monitor/snapshot") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ kind: "monitor.snapshot", sessions: [] }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ok");
});

server.listen(port, host, () => {
  if (process.env.TEST_PID_FILE) {
    fs.writeFileSync(process.env.TEST_PID_FILE, String(process.pid));
  }
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
`,
  );
  return scriptPath;
}

function writeOpenCaptureScript(dir: string): string {
  const scriptPath = path.join(dir, "capture-open.mjs");
  fs.writeFileSync(
    scriptPath,
    `
import fs from "node:fs";

if (process.env.TEST_OPEN_FILE) {
  fs.writeFileSync(process.env.TEST_OPEN_FILE, process.argv[2] || "");
}
`,
  );
  return scriptPath;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

function cleanupServer(pidFile: string): void {
  if (!fs.existsSync(pidFile)) {
    return;
  }

  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The test server may already have exited.
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    cleanupServer(path.join(dir, "server.pid"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describeIf("open monitor plugin hooks", () => {
  test.each([
    {
      name: "codex",
      script: "plugins/codex/scripts/open_monitor.py",
      payload: { prompt: "/monitor", session_id: "codex-session-1" },
      expectedUrl: (base: string) => `${base}/sessions/codex/codex-session-1`,
    },
    {
      name: "claude",
      script: "plugins/claude-code/scripts/open_monitor.py",
      payload: { command_name: "oc:monitor", session_id: "claude-session-1" },
      expectedUrl: (base: string) => `${base}/sessions/claude/claude-session-1`,
    },
  ])("$name hook autostarts a missing local viewer server", async (fixture) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-monitor-hook-"));
    tempDirs.push(dir);

    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const pidFile = path.join(dir, "server.pid");
    const openFile = path.join(dir, "opened.txt");
    const serverScript = writeFakeServerScript(dir);
    const openScript = writeOpenCaptureScript(dir);

    const result = spawnSync("python3", [fixture.script], {
      input: JSON.stringify(fixture.payload),
      encoding: "utf8",
      timeout: 12000,
      env: {
        ...process.env,
        OPENCODE_OBSERVABILITY_URL: base,
        OPENCODE_OBSERVABILITY_AUTOSTART_TIMEOUT_MS: "5000",
        OPENCODE_OBSERVABILITY_SERVER_CMD: [
          quoteForShlex(process.execPath),
          quoteForShlex(serverScript),
        ].join(" "),
        OPENCODE_OBSERVABILITY_OPEN_CMD: [
          quoteForShlex(process.execPath),
          quoteForShlex(openScript),
        ].join(" "),
        PYTHONDONTWRITEBYTECODE: "1",
        TEST_PID_FILE: pidFile,
        TEST_OPEN_FILE: openFile,
      },
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      decision: string;
      reason: string;
    };
    expect(output.decision).toBe("block");
    expect(output.reason).toContain("ビューアを開きました");

    await waitForFile(pidFile);
    await waitForFile(openFile);
    expect(fs.readFileSync(openFile, "utf8")).toBe(fixture.expectedUrl(base));
  });
});
