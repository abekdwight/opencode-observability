import type {
  DashboardActivityContract,
  DashboardModelsContract,
  DashboardOverviewContract,
  DashboardSelectionContract,
  DashboardToolsContract,
} from "../../../contracts/dashboard.js";

// Wire protocol between the main thread (worker-gateway) and the aggregation
// worker (worker-entry). All messages are structured-clonable plain objects.

// Passed via `workerData` at thread construction. The worker resolves nothing
// itself — the db path is handed in so the config boundary stays on the main
// thread (the worker never reads process env for its data source).
export interface DashboardWorkerInitData {
  dbPath: string;
}

export type DashboardWorkerEndpoint =
  | "overview"
  | "activity"
  | "models"
  | "tools";

// main -> worker
export interface DashboardWorkerRequestMessage {
  kind: "request";
  id: number;
  endpoint: DashboardWorkerEndpoint;
  selection: DashboardSelectionContract;
}

export interface DashboardWorkerCloseMessage {
  kind: "close";
}

export type DashboardWorkerInbound =
  | DashboardWorkerRequestMessage
  | DashboardWorkerCloseMessage;

// Per-endpoint response payloads (the contracts the projections produce).
export interface DashboardWorkerPayloadByEndpoint {
  overview: DashboardOverviewContract;
  activity: DashboardActivityContract;
  models: DashboardModelsContract;
  tools: DashboardToolsContract;
}

// worker -> main
export interface DashboardWorkerResponseOk {
  kind: "response";
  id: number;
  ok: true;
  endpoint: DashboardWorkerEndpoint;
  payload:
    | DashboardOverviewContract
    | DashboardActivityContract
    | DashboardModelsContract
    | DashboardToolsContract;
}

export interface DashboardWorkerResponseError {
  kind: "response";
  id: number;
  ok: false;
  error: string;
}

export type DashboardWorkerResponseMessage =
  | DashboardWorkerResponseOk
  | DashboardWorkerResponseError;

// Unsolicited status broadcast (diagnostics/logging only — the gateway does not
// depend on it for correctness; every response also carries the live meta).
export interface DashboardWorkerStatusMessage {
  kind: "status";
  generation: number;
  state: "building" | "ready";
  progressPercent: number;
}

// Emitted once the worker has opened its connection and is ready to serve.
export interface DashboardWorkerReadyMessage {
  kind: "ready";
}

export type DashboardWorkerOutbound =
  | DashboardWorkerResponseMessage
  | DashboardWorkerStatusMessage
  | DashboardWorkerReadyMessage;
