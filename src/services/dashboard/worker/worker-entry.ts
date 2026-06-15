import { parentPort, workerData } from "node:worker_threads";
import { Database } from "../../../lib/sqlite.js";
import { InlineDashboardGateway } from "../inline-gateway.js";
import type {
  DashboardWorkerEndpoint,
  DashboardWorkerInbound,
  DashboardWorkerInitData,
  DashboardWorkerOutbound,
  DashboardWorkerRequestMessage,
} from "./protocol.js";

// Aggregation worker entry point.
//
// Responsibilities:
//   - open ONE long-lived readonly connection on the dbPath handed in via
//     workerData (the config boundary stays on the main thread),
//   - host an InlineDashboardGateway with request-time driving disabled so the
//     timer loop below is the sole driver,
//   - poll for source changes (data_version) and advance the aggregation
//     pipeline one bounded unit at a time (a stamp batch or a build chunk),
//     yielding to the event loop between units so request messages are served
//     promptly even during the cold-start stamp/build pass.
//
// Critical scheduling invariant: the longest synchronous span the worker ever
// holds is ONE pumpWork() unit. reconcile() is cheap and enqueues candidates;
// the heavy cold-start stamping (~10K roots on a real DB) is split across
// pumpWork batches with yields, so overview requests (session-table only,
// independent of the aggregation state) are answered within one unit's latency
// rather than waiting for the whole cold build.
//
// Timers live HERE (in the worker host), never in the aggregator core.

// Poll interval for the reconcile/data_version check. data_version is ~free, so
// a short interval keeps the dashboard fresh without load.
const RECONCILE_INTERVAL_MS = 1_500;
// Delay between pump units; zero so the cold build finishes promptly while
// still draining the message queue (a macrotask hop) between units.
const PUMP_YIELD_MS = 0;

function isInitData(value: unknown): value is DashboardWorkerInitData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dbPath?: unknown }).dbPath === "string"
  );
}

function post(message: DashboardWorkerOutbound): void {
  parentPort?.postMessage(message);
}

function main(): void {
  if (!parentPort) {
    throw new Error("worker-entry must run inside a worker thread");
  }
  if (!isInitData(workerData)) {
    throw new Error("worker-entry requires workerData.dbPath");
  }

  const db = new Database(workerData.dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  const gateway = new InlineDashboardGateway(db, { driveOnRequest: false });

  let pumpTimer: NodeJS.Timeout | null = null;
  let reconcileTimer: NodeJS.Timeout | null = null;
  let closed = false;

  // Advance the pipeline one bounded unit, then reschedule until both queues
  // empty. Each hop yields to the event loop so pending request messages (in
  // particular overview) are handled between units.
  function pump(): void {
    if (closed) return;
    pumpTimer = null;
    const worked = gateway.pumpWork();
    if (worked && !closed) {
      pumpTimer = setTimeout(pump, PUMP_YIELD_MS);
    }
  }

  function schedulePump(): void {
    if (closed || pumpTimer) return;
    pumpTimer = setTimeout(pump, PUMP_YIELD_MS);
  }

  function reconcileTick(): void {
    if (closed) return;
    // reconcile() is cheap (detect + enqueue); the heavy stamp/build work runs
    // in pumped units so it never blocks request handling.
    gateway.reconcile();
    schedulePump();
  }

  function handleRequest(message: DashboardWorkerRequestMessage): void {
    try {
      const payload = readEndpoint(gateway, message.endpoint, message);
      post({
        kind: "response",
        id: message.id,
        ok: true,
        endpoint: message.endpoint,
        payload,
      });
    } catch (error) {
      post({
        kind: "response",
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function shutdown(): void {
    if (closed) return;
    closed = true;
    if (pumpTimer) clearTimeout(pumpTimer);
    if (reconcileTimer) clearInterval(reconcileTimer);
    pumpTimer = null;
    reconcileTimer = null;
    db.close();
    parentPort?.close();
  }

  parentPort.on("message", (message: DashboardWorkerInbound) => {
    if (message.kind === "close") {
      shutdown();
      return;
    }
    if (message.kind === "request") {
      handleRequest(message);
    }
  });

  // Kick off the initial cold build, then poll on an interval.
  reconcileTick();
  reconcileTimer = setInterval(reconcileTick, RECONCILE_INTERVAL_MS);

  post({ kind: "ready" });
}

function readEndpoint(
  gateway: InlineDashboardGateway,
  endpoint: DashboardWorkerEndpoint,
  message: DashboardWorkerRequestMessage,
):
  | ReturnType<InlineDashboardGateway["getOverview"]>
  | ReturnType<InlineDashboardGateway["getActivity"]>
  | ReturnType<InlineDashboardGateway["getModels"]>
  | ReturnType<InlineDashboardGateway["getTools"]> {
  switch (endpoint) {
    case "overview":
      return gateway.getOverview(message.selection);
    case "activity":
      return gateway.getActivity(message.selection);
    case "models":
      return gateway.getModels(message.selection);
    case "tools":
      return gateway.getTools(message.selection);
  }
}

main();
