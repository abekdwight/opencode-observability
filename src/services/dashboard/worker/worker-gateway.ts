import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type {
  DashboardActivityContract,
  DashboardModelsContract,
  DashboardOverviewContract,
  DashboardSelectionContract,
  DashboardToolsContract,
} from "../../../contracts/dashboard.js";
import type { AsyncDashboardGateway } from "../gateway.js";
import type {
  DashboardWorkerEndpoint,
  DashboardWorkerInitData,
  DashboardWorkerOutbound,
  DashboardWorkerPayloadByEndpoint,
} from "./protocol.js";

// Upper bound on automatic restarts. A worker that keeps crashing indicates a
// systemic fault (corrupt DB, OOM); after the cap we stop respawning and fail
// requests fast instead of thrashing.
const MAX_RESTARTS = 5;
// Time window in which restarts are counted. Crashes spaced further apart than
// this reset the counter (transient blips do not exhaust the budget).
const RESTART_WINDOW_MS = 60_000;

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  endpoint: DashboardWorkerEndpoint;
}

// Resolve the worker spawn arguments. In the built dist this module is a .js
// file and worker-entry is the sibling .js, spawned directly. In dev/test it is
// a .ts file loaded via tsx; worker threads do not inherit tsx's loader, so we
// spawn a tiny inline bootstrap (eval) that registers tsx in the worker and
// then imports the sibling .ts entry. Keeping path resolution here means the
// rest of the code is build-target agnostic.
function resolveWorkerSpawn(workerData: DashboardWorkerInitData): {
  source: string | URL;
  options: WorkerOptions;
} {
  const selfPath = fileURLToPath(import.meta.url);
  const ext = path.extname(selfPath); // ".ts" in dev/test, ".js" in dist
  const entryPath = path.join(path.dirname(selfPath), `worker-entry${ext}`);

  if (ext === ".ts") {
    const entryUrl = pathToFileURL(entryPath).href;
    const bootstrap = `import { register } from "tsx/esm/api";\nregister();\nawait import(${JSON.stringify(entryUrl)});\n`;
    return { source: bootstrap, options: { eval: true, workerData } };
  }

  return { source: entryPath, options: { workerData } };
}

/**
 * Main-thread DashboardGateway backed by the aggregation worker thread.
 *
 * - Requests are correlated by an incrementing id; responses resolve the
 *   matching pending promise.
 * - On worker crash/exit the gateway rejects all in-flight requests and
 *   auto-restarts, bounded by MAX_RESTARTS within RESTART_WINDOW_MS.
 * - close() asks the worker to shut down gracefully, then terminates it.
 */
export class WorkerDashboardGateway implements AsyncDashboardGateway {
  private readonly dbPath: string;
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private restartTimestamps: number[] = [];
  private closed = false;
  private spawnFailed = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.spawnWorker();
  }

  private spawnWorker(): void {
    const workerData: DashboardWorkerInitData = { dbPath: this.dbPath };
    const { source, options } = resolveWorkerSpawn(workerData);

    const worker = new Worker(source, options);

    worker.on("message", (message: DashboardWorkerOutbound) => {
      this.handleMessage(message);
    });
    worker.on("error", (error) => {
      this.handleWorkerFailure(error);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.handleWorkerFailure(
          new Error(`dashboard worker exited with code ${code}`),
        );
      }
    });

    this.worker = worker;
  }

  private handleMessage(message: DashboardWorkerOutbound): void {
    if (message.kind !== "response") {
      // "status" / "ready" are diagnostics-only; correctness rides on responses.
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.payload);
    } else {
      pending.reject(new Error(message.error));
    }
  }

  private handleWorkerFailure(error: Error): void {
    const failingWorker = this.worker;
    this.worker = null;

    // Reject every in-flight request so callers fail fast (HTTP 500) instead of
    // hanging on a dead worker.
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();

    if (failingWorker) {
      void failingWorker.terminate();
    }

    if (this.closed) {
      return;
    }

    if (this.shouldRestart()) {
      this.spawnWorker();
    } else {
      this.spawnFailed = true;
    }
  }

  private shouldRestart(): boolean {
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter(
      (ts) => now - ts < RESTART_WINDOW_MS,
    );
    this.restartTimestamps.push(now);
    return this.restartTimestamps.length <= MAX_RESTARTS;
  }

  private request<E extends DashboardWorkerEndpoint>(
    endpoint: E,
    selection: DashboardSelectionContract,
  ): Promise<DashboardWorkerPayloadByEndpoint[E]> {
    if (this.closed) {
      return Promise.reject(new Error("dashboard gateway is closed"));
    }
    const worker = this.worker;
    if (!worker || this.spawnFailed) {
      return Promise.reject(new Error("dashboard worker is unavailable"));
    }

    const id = this.nextRequestId++;
    return new Promise<DashboardWorkerPayloadByEndpoint[E]>(
      (resolve, reject) => {
        this.pending.set(id, {
          endpoint,
          resolve: (payload) =>
            resolve(payload as DashboardWorkerPayloadByEndpoint[E]),
          reject,
        });
        worker.postMessage({ kind: "request", id, endpoint, selection });
      },
    );
  }

  getOverview(
    selection: DashboardSelectionContract,
  ): Promise<DashboardOverviewContract> {
    return this.request("overview", selection);
  }

  getActivity(
    selection: DashboardSelectionContract,
  ): Promise<DashboardActivityContract> {
    return this.request("activity", selection);
  }

  getModels(
    selection: DashboardSelectionContract,
  ): Promise<DashboardModelsContract> {
    return this.request("models", selection);
  }

  getTools(
    selection: DashboardSelectionContract,
  ): Promise<DashboardToolsContract> {
    return this.request("tools", selection);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const [, pending] of this.pending) {
      pending.reject(new Error("dashboard gateway is closing"));
    }
    this.pending.clear();

    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.postMessage({ kind: "close" });
      await worker.terminate();
    }
  }
}
