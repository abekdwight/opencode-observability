import type {
  DashboardActivityContract,
  DashboardModelsContract,
  DashboardOverviewContract,
  DashboardSelectionContract,
  DashboardToolsContract,
} from "../../contracts/dashboard.js";

// The in-process InlineGateway resolves contracts synchronously (Wave 1, tests,
// and the inline debug fallback). Selections are already normalized and
// validated by the time they reach the gateway.
export interface DashboardGateway {
  getOverview(selection: DashboardSelectionContract): DashboardOverviewContract;
  getActivity(selection: DashboardSelectionContract): DashboardActivityContract;
  getModels(selection: DashboardSelectionContract): DashboardModelsContract;
  getTools(selection: DashboardSelectionContract): DashboardToolsContract;
}

// The HTTP layer talks to this async-capable surface so the worker-backed
// gateway (Wave 2) and the in-process gateway can be used interchangeably:
// `await`-ing a synchronous value is a no-op, so the InlineGateway satisfies it
// directly while the WorkerGateway returns real Promises. `close()` releases
// the backing resource (worker thread or DB connection).
export interface AsyncDashboardGateway {
  getOverview(
    selection: DashboardSelectionContract,
  ): DashboardOverviewContract | Promise<DashboardOverviewContract>;
  getActivity(
    selection: DashboardSelectionContract,
  ): DashboardActivityContract | Promise<DashboardActivityContract>;
  getModels(
    selection: DashboardSelectionContract,
  ): DashboardModelsContract | Promise<DashboardModelsContract>;
  getTools(
    selection: DashboardSelectionContract,
  ): DashboardToolsContract | Promise<DashboardToolsContract>;
  close(): void | Promise<void>;
}
