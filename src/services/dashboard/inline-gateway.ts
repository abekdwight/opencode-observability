import type {
  DashboardActivityContract,
  DashboardMetaContract,
  DashboardModelsContract,
  DashboardOverviewContract,
  DashboardSelectionContract,
  DashboardToolsContract,
} from "../../contracts/dashboard.js";
import { toLocalDayStartMs } from "../../lib/dashboard-time.js";
import type { DashboardWindowMs } from "../../repositories/dashboard/dashboard-queries.js";
import { DashboardAggregator } from "./aggregator/aggregator.js";
import type { AsyncDashboardGateway, DashboardGateway } from "./gateway.js";
import { projectOverview } from "./projection/overview.js";

export interface InlineGatewayOptions {
  // When true (default), each request reconciles and builds atoms to
  // completion so reads return ready data. When false, requests only
  // reconcile (enqueue) and tests drive building explicitly via
  // reconcile()/buildNextChunk() to observe the building -> ready transition.
  autoDrain?: boolean;
  // When false, requests do NOT drive reconcile/build at all and instead read
  // the aggregator's current state. The worker host uses this so its timer
  // loop is the sole driver and request handling stays cheap. Defaults to true.
  driveOnRequest?: boolean;
  chunkSize?: number;
  now?: () => number;
}

function selectionWindow(
  selection: DashboardSelectionContract,
): DashboardWindowMs {
  return {
    startMs: toLocalDayStartMs(selection.bounds.startDayInclusive),
    endMs: toLocalDayStartMs(selection.bounds.endDayExclusive),
  };
}

/**
 * In-process gateway used by the API in Wave 1 and by all tests. It owns a
 * single long-lived Database connection so the change detector's
 * PRAGMA data_version gate stays valid across requests. The connection is
 * injected and never swapped.
 */
export class InlineDashboardGateway
  implements DashboardGateway, AsyncDashboardGateway
{
  private readonly db: import("../../lib/sqlite.js").Database;
  private readonly aggregator: DashboardAggregator;
  private readonly autoDrain: boolean;
  private readonly driveOnRequest: boolean;
  private readonly now: () => number;

  constructor(
    db: import("../../lib/sqlite.js").Database,
    options: InlineGatewayOptions = {},
  ) {
    this.db = db;
    this.aggregator = new DashboardAggregator(db, {
      chunkSize: options.chunkSize,
    });
    this.autoDrain = options.autoDrain ?? true;
    this.driveOnRequest = options.driveOnRequest ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  private prepare(): void {
    if (!this.driveOnRequest) {
      return;
    }
    const now = this.now();
    if (this.autoDrain) {
      this.aggregator.drain(now);
    } else {
      this.aggregator.reconcile(now);
    }
  }

  private meta(): DashboardMetaContract {
    return {
      generation: this.aggregator.getGeneration(),
      rollup: this.aggregator.rollupStatus(),
    };
  }

  getOverview(
    selection: DashboardSelectionContract,
  ): DashboardOverviewContract {
    this.prepare();
    const now = this.now();
    const source = this.aggregator.readOverviewSource(
      now,
      selectionWindow(selection),
    );
    return projectOverview(
      source,
      selection,
      this.meta(),
      new Date(now).toISOString(),
    );
  }

  getActivity(
    selection: DashboardSelectionContract,
  ): DashboardActivityContract {
    this.prepare();
    const generatedAt = new Date(this.now()).toISOString();
    if (!this.aggregator.isReady()) {
      return {
        kind: "dashboard.activity",
        generatedAt,
        selection,
        state: "building",
        progressPercent: this.aggregator.rollupStatus().progressPercent,
        generation: this.aggregator.getGeneration(),
      };
    }
    return {
      kind: "dashboard.activity",
      generatedAt,
      selection,
      state: "ready",
      generation: this.aggregator.getGeneration(),
      data: this.aggregator.projectActivityFor(selection),
    };
  }

  getModels(selection: DashboardSelectionContract): DashboardModelsContract {
    this.prepare();
    const generatedAt = new Date(this.now()).toISOString();
    if (!this.aggregator.isReady()) {
      return {
        kind: "dashboard.models",
        generatedAt,
        selection,
        state: "building",
        progressPercent: this.aggregator.rollupStatus().progressPercent,
        generation: this.aggregator.getGeneration(),
      };
    }
    return {
      kind: "dashboard.models",
      generatedAt,
      selection,
      state: "ready",
      generation: this.aggregator.getGeneration(),
      data: this.aggregator.projectModelsFor(selection),
    };
  }

  getTools(selection: DashboardSelectionContract): DashboardToolsContract {
    this.prepare();
    const generatedAt = new Date(this.now()).toISOString();
    if (!this.aggregator.isReady()) {
      return {
        kind: "dashboard.tools",
        generatedAt,
        selection,
        state: "building",
        progressPercent: this.aggregator.rollupStatus().progressPercent,
        generation: this.aggregator.getGeneration(),
      };
    }
    return {
      kind: "dashboard.tools",
      generatedAt,
      selection,
      state: "ready",
      generation: this.aggregator.getGeneration(),
      data: this.aggregator.projectToolsFor(selection),
    };
  }

  // Explicit drivers for the worker host and for tests that need to observe the
  // building -> ready transition step by step.
  reconcile(): boolean {
    return this.aggregator.reconcile(this.now());
  }

  // Advance the pipeline by one bounded unit (one stamp batch or one build
  // chunk). The worker pumps this between event-loop yields.
  pumpWork(): boolean {
    return this.aggregator.pumpWork();
  }

  hasPendingWork(): boolean {
    return this.aggregator.hasPendingWork();
  }

  stampNextBatch(): boolean {
    return this.aggregator.stampNextBatch();
  }

  buildNextChunk(): boolean {
    return this.aggregator.buildNextChunk();
  }

  reset(): void {
    this.aggregator.reset();
  }

  // Releases the backing connection. Idempotent: better-sqlite3's close() is a
  // no-op once the database is already closed, so callers that also manage the
  // connection lifecycle (existing tests) are unaffected.
  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }
}
