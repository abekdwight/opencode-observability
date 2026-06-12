import { Hono } from "hono";
import { getOpenCodeDbPath } from "../lib/config.js";
import { normalizeDashboardSelectionInput } from "../lib/dashboard-time.js";
import { getDb } from "../lib/db.js";
import type { AsyncDashboardGateway } from "../services/dashboard/gateway.js";
import { InlineDashboardGateway } from "../services/dashboard/inline-gateway.js";
import { WorkerDashboardGateway } from "../services/dashboard/worker/worker-gateway.js";

// In production the dashboard runs behind an aggregation worker thread so the
// heavy DB work never blocks the HTTP event loop. Setting
// DASHBOARD_INLINE_GATEWAY=1 forces the in-process gateway instead.
//
// WARNING — DEBUG ONLY: with the inline gateway the aggregation runs ON the
// HTTP event-loop thread. The first request triggers a synchronous cold build
// (drain) that stamps + builds every in-horizon root against the live opencode
// DB (up to ~8GB / ~10K roots). That blocks ALL HTTP handlers — including
// /api/sessions — for the entire build (tens of seconds on a real DB). Never
// set this in production; it exists only for local debugging against a small DB.
//
// The InlineGateway owns a long-lived readonly connection (so the change
// detector's PRAGMA data_version gate stays valid); the WorkerGateway owns the
// worker, which owns its own connection. Either way the backing resource is
// created once and released via close().
let gatewayInstance: AsyncDashboardGateway | null = null;

function shouldUseInlineGateway(): boolean {
  // Force-inline for explicit (debug-only — see warning above) use, and default
  // to inline under the test runner so the existing route tests exercise the
  // in-process gateway (the worker path has its own dedicated smoke test).
  return (
    process.env.DASHBOARD_INLINE_GATEWAY === "1" ||
    process.env.VITEST !== undefined
  );
}

function getGateway(): AsyncDashboardGateway {
  if (!gatewayInstance) {
    gatewayInstance = shouldUseInlineGateway()
      ? new InlineDashboardGateway(getDb())
      : new WorkerDashboardGateway(getOpenCodeDbPath());
  }
  return gatewayInstance;
}

function disposeGateway(): void {
  void gatewayInstance?.close();
  gatewayInstance = null;
}

// Graceful shutdown hook for the server entry point (SIGINT/SIGTERM).
export async function closeDashboardGateway(): Promise<void> {
  const instance = gatewayInstance;
  gatewayInstance = null;
  if (instance) {
    await instance.close();
  }
}

// Test hook: drop the singleton (closing its backing resource) so the next
// request rebuilds against the current OPENCODE_DB_PATH fixture from a clean
// state. Used by the API tests, which run against the InlineGateway.
export function resetDashboardGatewayForTests(): void {
  disposeGateway();
}

// Test hook: install a specific gateway implementation (e.g. an InlineGateway
// or a WorkerGateway bound to a fixture DB path).
export function setDashboardGatewayForTests(
  gateway: AsyncDashboardGateway,
): void {
  disposeGateway();
  gatewayInstance = gateway;
}

function readSelectionInput(c: {
  req: { query: (key: string) => string | undefined };
}) {
  return normalizeDashboardSelectionInput({
    preset: c.req.query("preset"),
    start: c.req.query("start"),
    end: c.req.query("end"),
    view: c.req.query("view"),
  });
}

export const dashboardApi = new Hono()
  .get("/overview", async (c) => {
    const result = readSelectionInput(c);
    if (!result.ok) {
      return c.json({ message: result.message }, 400);
    }
    return c.json(await getGateway().getOverview(result.selection));
  })
  .get("/activity", async (c) => {
    const result = readSelectionInput(c);
    if (!result.ok) {
      return c.json({ message: result.message }, 400);
    }
    return c.json(await getGateway().getActivity(result.selection));
  })
  .get("/models", async (c) => {
    const result = readSelectionInput(c);
    if (!result.ok) {
      return c.json({ message: result.message }, 400);
    }
    return c.json(await getGateway().getModels(result.selection));
  })
  .get("/tools", async (c) => {
    const result = readSelectionInput(c);
    if (!result.ok) {
      return c.json({ message: result.message }, 400);
    }
    return c.json(await getGateway().getTools(result.selection));
  });
