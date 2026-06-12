import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type {
  DashboardActivityContract,
  DashboardSelectionContract,
} from "../../src/contracts/dashboard.js";
import { normalizeDashboardSelectionInput } from "../../src/lib/dashboard-time.js";
import { getWritableDb } from "../../src/lib/db.js";
import { WorkerDashboardGateway } from "../../src/services/dashboard/worker/worker-gateway.js";
import { restoreDbPath, useFixtureDb } from "../helpers/fixture-db.js";

// These tests spawn a real worker thread loading the .ts entry via tsx, so they
// use generous timeouts for CI stability. Unlike the rest of the dashboard
// suite they do NOT stub the clock: the worker computes its 90-day atom horizon
// from its own wall clock, and the fixture's session timestamps are relative to
// the real "now", so they land inside that horizon. A recent preset selection
// (last30d) therefore covers the fixture data.
const TEST_TIMEOUT_MS = 30_000;

let dbPath: string;
let gateway: WorkerDashboardGateway | null = null;

function recentSelection(
  view: "daily" | "hourly" = "daily",
): DashboardSelectionContract {
  const result = normalizeDashboardSelectionInput({ preset: "last30d", view });
  if (!result.ok) throw new Error(result.message);
  return result.selection;
}

async function pollUntilReady(
  fetchOne: () => Promise<DashboardActivityContract>,
  deadlineMs: number,
): Promise<{ result: DashboardActivityContract; sawBuilding: boolean }> {
  const start = Date.now();
  let sawBuilding = false;
  let latest = await fetchOne();
  while (latest.state === "building" && Date.now() - start < deadlineMs) {
    sawBuilding = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    latest = await fetchOne();
  }
  return { result: latest, sawBuilding };
}

// Add many root sessions (each with a few messages) so the worker's cold build
// genuinely spans many pumped chunks — enough that an overview request lands
// while the build is still in progress.
function seedManyRoots(count: number): void {
  const writable = getWritableDb();
  try {
    const insertSession = writable.prepare(
      `INSERT INTO session (
        id, project_id, parent_id, slug, directory, title, version, share_url,
        summary_additions, summary_deletions, summary_files, summary_diffs,
        revert, permission, time_created, time_updated, time_compacting,
        time_archived, workspace_id
      ) VALUES (?, 'proj-alpha', NULL, ?, '/workspace/repo-alpha', ?, '1', NULL,
        0, 0, 0, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
    );
    const insertMessage = writable.prepare(
      `INSERT INTO message (id, session_id, time_created, time_updated, data)
       VALUES (?, ?, ?, ?, ?)`,
    );
    // Place them ~2 days ago so they fall inside the worker's real-clock window.
    const base = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const seed = writable.transaction(() => {
      for (let i = 0; i < count; i++) {
        const id = `ses-load-${i}`;
        const created = base + i * 1_000;
        insertSession.run(id, id, id, created, created);
        for (let m = 0; m < 4; m++) {
          const mc = created + m * 100;
          insertMessage.run(
            `${id}-msg-${m}`,
            id,
            mc,
            mc,
            JSON.stringify({
              role: "assistant",
              time: { created: mc, completed: mc + 200 },
              modelID: "gpt-4.1",
              providerID: "openai",
              tokens: { total: 10, input: 6, output: 4 },
            }),
          );
        }
      }
    });
    seed();
  } finally {
    writable.close();
  }
}

beforeEach(() => {
  useFixtureDb();
  dbPath = process.env.OPENCODE_DB_PATH as string;
});

afterEach(async () => {
  if (gateway) {
    await gateway.close();
    gateway = null;
  }
  restoreDbPath();
});

describe("WorkerDashboardGateway (smoke)", () => {
  test(
    "serves overview through the worker thread",
    async () => {
      gateway = new WorkerDashboardGateway(dbPath);
      const overview = await gateway.getOverview(recentSelection());

      expect(overview.kind).toBe("dashboard.overview");
      // Overview is session-table sourced, so it is correct immediately even if
      // the atom build is still in progress.
      expect(overview.summary.totalSessions).toBe(3);
      expect(overview.summary.activeProjects).toBe(2);
      expect(overview.meta.rollup.state).toMatch(/^(building|ready)$/);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "activity transitions to ready with correct data",
    async () => {
      const worker = new WorkerDashboardGateway(dbPath);
      gateway = worker;
      const selection = recentSelection();

      const { result, sawBuilding } = await pollUntilReady(
        () => worker.getActivity(selection),
        TEST_TIMEOUT_MS - 5_000,
      );

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        const input = result.data.tokenTrend.dailySeries.find(
          (series) => series.label === "Input",
        );
        const total =
          input?.points.reduce((sum, point) => sum + point.value, 0) ?? 0;
        // The fixture's assistant input tokens across the recent window.
        expect(total).toBeGreaterThan(0);
      }

      // If a building state was observed, it must carry a sane envelope. This
      // is best-effort (the tiny fixture can finish building before the first
      // request), so it is not asserted unconditionally.
      if (sawBuilding) {
        expect(result.generation).toBeGreaterThanOrEqual(0);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "overview responds while a large cold build is still in progress",
    async () => {
      // Seed a large backlog so the cold stamp/build pass spans many pumped
      // units. With the chunked driver, the worker yields between units, so
      // overview (session-table only) must be served before the build finishes.
      seedManyRoots(400);

      const worker = new WorkerDashboardGateway(dbPath);
      gateway = worker;
      const selection = recentSelection();

      // Fire overview requests concurrently with heavy activity polling. The
      // overview must come back correct (and fast) even though the heavy
      // pipeline is mid-build. We require that we observed activity "building"
      // while still getting a successful overview response — proving the
      // overview path is not serialized behind the whole cold build.
      let overviewWhileBuilding = false;
      const deadline = Date.now() + (TEST_TIMEOUT_MS - 8_000);
      let activity = await worker.getActivity(selection);
      while (activity.state === "building" && Date.now() < deadline) {
        const overview = await worker.getOverview(selection);
        expect(overview.kind).toBe("dashboard.overview");
        // Original 3 fixture roots + 400 seeded roots, attributed by
        // time_created over the last-30d window.
        expect(overview.summary.totalSessions).toBeGreaterThanOrEqual(400);
        overviewWhileBuilding = true;
        activity = await worker.getActivity(selection);
      }

      // The build must have been observable as in-progress while overview
      // answered. (If this ever flakes because the build finished instantly,
      // the backlog size should be increased — but 400 roots reliably spans
      // many pumped units.)
      expect(overviewWhileBuilding).toBe(true);

      // And it does eventually reach ready.
      const { result } = await pollUntilReady(
        () => worker.getActivity(selection),
        TEST_TIMEOUT_MS - 8_000,
      );
      expect(result.state).toBe("ready");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "rejects in-flight requests when closed",
    async () => {
      gateway = new WorkerDashboardGateway(dbPath);
      const selection = recentSelection();

      // Warm up so the worker is responsive.
      await gateway.getOverview(selection);

      // Attach the settlement assertion BEFORE close() so the rejection that
      // close() may trigger is never unhandled. The request either resolved
      // before shutdown or rejects with an Error; both are acceptable, but it
      // must settle (no hang).
      const settled = gateway.getModels(selection).then(
        (value) => expect(value.kind).toBe("dashboard.models"),
        (error) => expect(error).toBeInstanceOf(Error),
      );

      await gateway.close();
      gateway = null;
      await settled;
    },
    TEST_TIMEOUT_MS,
  );
});
