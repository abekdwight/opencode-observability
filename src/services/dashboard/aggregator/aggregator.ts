import {
  DASHBOARD_MAX_CUSTOM_DAYS,
  type DashboardActivityDataContract,
  type DashboardModelsDataContract,
  type DashboardRollupStatusContract,
  type DashboardSelectionContract,
  type DashboardToolsDataContract,
} from "../../../contracts/dashboard.js";
import {
  addLocalDays,
  toLocalDateString,
  toLocalDayStartMs,
} from "../../../lib/dashboard-time.js";
import {
  type DashboardWindowMs,
  readDashboardHeatmapDays,
  readDashboardRecentSessions,
  readDashboardSummary,
  readRootSource,
  readRootSourceStamps,
} from "../../../repositories/dashboard/dashboard-queries.js";
import { projectActivity } from "../projection/activity.js";
import { projectModels } from "../projection/models.js";
import type { DashboardOverviewSource } from "../projection/overview.js";
import { projectTools } from "../projection/tools.js";
import { DashboardChangeDetector } from "./change-detector.js";
import { buildSessionAtom } from "./session-atom.js";
import type { DashboardSessionAtom, DashboardSourceStamp } from "./types.js";

// Atoms cover a trailing fixed horizon; heatmap uses a longer trailing window
// straight from the session table.
const AGGREGATION_HORIZON_DAYS = DASHBOARD_MAX_CUSTOM_DAYS; // 90
const HEATMAP_TRAILING_DAYS = 365;

// Cold-start chunk size: roots built per buildNextChunk() call. The newest
// roots are built first so the most-viewed recent ranges become ready soonest.
// Kept small so a single build chunk (which reads each root's JSON source) is a
// bounded synchronous span — the worker yields between chunks. Sized so one
// chunk stays well under ~1s on a real multi-GB DB (QA measured multi-second
// worker-response tails at 25 when a chunk hit blob-heavy roots).
const DEFAULT_CHUNK_SIZE = 10;

// Stamp batch size: candidate roots whose source stamp is read per
// stampNextBatch() call. Stamping is a single indexed query per batch (much
// cheaper than building), so the batch is larger than the build chunk. The cold
// start can enqueue every in-horizon root (~10K on a real DB); stamping them in
// one synchronous pass is what blocked the worker for tens of seconds, so the
// pass is split into batches that yield to the event loop between them. The
// batch size only controls yield frequency (stamps run per root either way),
// so it is kept small enough that one batch stays around or under ~1s cold.
const DEFAULT_STAMP_BATCH_SIZE = 50;

type DashboardEndpoint = "activity" | "models" | "tools";
type ProjectionData =
  | DashboardActivityDataContract
  | DashboardModelsDataContract
  | DashboardToolsDataContract;

interface ProjectionMemoEntry {
  generation: number;
  data: ProjectionData;
}

function selectionKey(selection: DashboardSelectionContract): string {
  return `${selection.bounds.startDayInclusive}:${selection.bounds.endDayInclusive}:${selection.view}`;
}

function toWindowMs(
  startDay: string,
  endDayExclusive: string,
): DashboardWindowMs {
  return {
    startMs: toLocalDayStartMs(startDay),
    endMs: toLocalDayStartMs(endDayExclusive),
  };
}

function stampsEqual(
  left: DashboardSourceStamp | undefined,
  right: DashboardSourceStamp,
): boolean {
  if (!left) return false;
  return (
    left.sessionRowCount === right.sessionRowCount &&
    left.sessionMaxRowId === right.sessionMaxRowId &&
    left.sessionMaxUpdatedAt === right.sessionMaxUpdatedAt &&
    left.messageRowCount === right.messageRowCount &&
    left.messageMaxRowId === right.messageMaxRowId &&
    left.messageMaxUpdatedAt === right.messageMaxUpdatedAt &&
    left.partRowCount === right.partRowCount &&
    left.partMaxRowId === right.partMaxRowId &&
    left.partMaxUpdatedAt === right.partMaxUpdatedAt
  );
}

/**
 * DashboardAggregator owns the entire in-memory aggregation state: a single
 * Map of per-root atoms, a change detector, a generation counter, and a
 * projection memo. It performs NO I/O timing of its own — reconcile() and
 * buildNextChunk() are driven externally (by the gateway on request, or by a
 * worker on idle). `now` is always injected for deterministic tests.
 */
export class DashboardAggregator {
  private readonly db: import("../../../lib/sqlite.js").Database;
  private readonly chunkSize: number;
  private readonly stampBatchSize: number;
  private readonly detector: DashboardChangeDetector;

  private atoms = new Map<string, DashboardSessionAtom>();
  private generation = 0;
  // Candidate roots awaiting source-stamp comparison (stampNextBatch).
  private stampQueue: string[] = [];
  private stampSet = new Set<string>();
  // Roots confirmed changed and awaiting atom (re)build (buildNextChunk).
  private pendingRootIds: string[] = [];
  private pendingSet = new Set<string>();
  private resolvedRootIds = new Set<string>();
  private horizonRootCount = 0;
  private hasReconciledOnce = false;
  // Becomes true the first time the work pipeline fully drains after a
  // reconcile, i.e. the initial cold build is done. After that the rollup stays
  // "ready": incremental updates (detected changes) flow through generation
  // bumps and never revert the UI to a full "building" skeleton. Reset clears it.
  private coldBuildComplete = false;
  private projectionMemo = new Map<string, ProjectionMemoEntry>();

  constructor(
    db: import("../../../lib/sqlite.js").Database,
    options: { chunkSize?: number; stampBatchSize?: number } = {},
  ) {
    this.db = db;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.stampBatchSize = options.stampBatchSize ?? DEFAULT_STAMP_BATCH_SIZE;
    this.detector = new DashboardChangeDetector(db);
  }

  private horizonWindow(now: number): DashboardWindowMs {
    const today = toLocalDateString(new Date(now));
    const startDay = addLocalDays(today, -(AGGREGATION_HORIZON_DAYS - 1));
    const endDayExclusive = addLocalDays(today, 1);
    return toWindowMs(startDay, endDayExclusive);
  }

  private heatmapWindow(now: number): DashboardWindowMs {
    const today = toLocalDateString(new Date(now));
    const startDay = addLocalDays(today, -(HEATMAP_TRAILING_DAYS - 1));
    const endDayExclusive = addLocalDays(today, 1);
    return toWindowMs(startDay, endDayExclusive);
  }

  private bumpGeneration(): void {
    this.generation += 1;
    this.projectionMemo.clear();
  }

  // Once both work queues are empty after the initial reconcile, the cold build
  // is complete and the rollup is permanently "ready" for this lifetime (an
  // empty DB completes immediately). hasReconciledOnce guards against marking
  // complete before the first reconcile populated the work queues.
  private maybeMarkColdBuildComplete(): void {
    if (
      !this.coldBuildComplete &&
      this.hasReconciledOnce &&
      this.stampQueue.length === 0 &&
      this.pendingRootIds.length === 0
    ) {
      this.coldBuildComplete = true;
    }
  }

  private enqueueBuild(rootId: string): void {
    if (this.pendingSet.has(rootId)) return;
    this.pendingSet.add(rootId);
    this.pendingRootIds.push(rootId);
  }

  private enqueueStamp(rootId: string): void {
    // Already queued for stamping, or already known to need a (re)build.
    if (this.stampSet.has(rootId) || this.pendingSet.has(rootId)) return;
    this.stampSet.add(rootId);
    this.stampQueue.push(rootId);
  }

  private dropRoot(rootId: string): boolean {
    const removed = this.atoms.delete(rootId);
    this.resolvedRootIds.delete(rootId);
    if (this.stampSet.delete(rootId)) {
      this.stampQueue = this.stampQueue.filter((id) => id !== rootId);
    }
    if (this.pendingSet.delete(rootId)) {
      this.pendingRootIds = this.pendingRootIds.filter((id) => id !== rootId);
    }
    return removed;
  }

  /**
   * Detect source changes and update the work queues. This is a CHEAP, bounded
   * step: it runs the change detector (in-horizon root-list scan + watermark
   * reads + bounded restamp diff) and enqueues candidate roots for stamping. It
   * does NOT stamp or build — those are the chunked stampNextBatch()/
   * buildNextChunk() steps, so reconcile never holds the event loop for the
   * (potentially ~10K-root) cold-start stamping pass.
   *
   * Returns true if state mutated (an eviction changed the atom set).
   */
  reconcile(now: number): boolean {
    const window = this.horizonWindow(now);
    const firstCycle =
      this.resolvedRootIds.size === 0 &&
      this.atoms.size === 0 &&
      this.stampQueue.length === 0 &&
      this.pendingRootIds.length === 0;
    const report = this.detector.detect(window, now, firstCycle);

    // The detector already scanned the in-horizon root list this cycle; reuse
    // its count for progress reporting instead of re-running the scan.
    this.horizonRootCount = report.horizonRootCount;

    let mutated = false;

    // Evict removed roots immediately (cheap, bounded by the removed set).
    for (const rootId of report.removedRootIds) {
      if (this.dropRoot(rootId)) {
        mutated = true;
      }
    }

    // Enqueue candidates for stamping (no I/O here). Stamping happens in
    // stampNextBatch(), which the driver pumps in bounded batches.
    for (const rootId of report.candidateRootIds) {
      this.enqueueStamp(rootId);
    }

    // Eviction changes the atom set, so invalidate projections immediately.
    // (Enqueuing alone does not — the atom set only changes once buildNextChunk
    // runs, which bumps the generation itself.)
    if (mutated) {
      this.bumpGeneration();
    }

    this.hasReconciledOnce = true;
    // An empty horizon (no candidates enqueued) completes the cold build here.
    this.maybeMarkColdBuildComplete();

    return mutated;
  }

  /**
   * Stamp the next batch of candidate roots: read their source stamps in a
   * single indexed query, compare against the in-memory atom, and enqueue the
   * changed ones for rebuild. A single stamp query is far cheaper than building,
   * but the cold start can enqueue every in-horizon root, so the work is split
   * into bounded batches that the driver pumps with yields in between. Returns
   * true if stamp work remained in the queue when this call started.
   */
  stampNextBatch(): boolean {
    if (this.stampQueue.length === 0) {
      return false;
    }

    const batch = this.stampQueue.splice(0, this.stampBatchSize);
    for (const rootId of batch) {
      this.stampSet.delete(rootId);
    }

    const stamps = readRootSourceStamps(this.db, batch);
    const stampById = new Map(
      stamps.map((stamp) => [stamp.rootSessionId, stamp] as const),
    );

    let mutated = false;
    for (const rootId of batch) {
      const stamp = stampById.get(rootId);
      if (!stamp) {
        // Root vanished between scans — treat as removed.
        if (this.dropRoot(rootId)) mutated = true;
        continue;
      }
      const existing = this.atoms.get(rootId);
      if (!stampsEqual(existing?.sourceStamp, stamp)) {
        this.enqueueBuild(rootId);
        this.resolvedRootIds.delete(rootId);
      } else {
        // Unchanged: mark resolved so progress reflects the confirmation.
        this.resolvedRootIds.add(rootId);
      }
    }

    if (mutated) {
      this.bumpGeneration();
    }
    // If stamping found nothing to build and the queue is now empty, the cold
    // build is complete (routine restamp of unchanged hot roots lands here).
    this.maybeMarkColdBuildComplete();
    return true;
  }

  /**
   * Build the next chunk of pending roots into atoms. Returns true if anything
   * was built. Newest roots are processed first (pendingRootIds is filled in
   * newest-first order during reconcile via readRootSessionList DESC ordering).
   * Atom building is time-independent, so no clock is needed here.
   */
  buildNextChunk(): boolean {
    if (this.pendingRootIds.length === 0) {
      return false;
    }

    const batch = this.pendingRootIds.splice(0, this.chunkSize);
    let built = false;
    for (const rootId of batch) {
      this.pendingSet.delete(rootId);
      const stamps = readRootSourceStamps(this.db, [rootId]);
      const stamp = stamps[0];
      if (!stamp) {
        // Disappeared while queued.
        this.atoms.delete(rootId);
        this.resolvedRootIds.add(rootId);
        continue;
      }
      const source = readRootSource(this.db, rootId);
      if (!source) {
        this.atoms.delete(rootId);
        this.resolvedRootIds.add(rootId);
        continue;
      }
      const atom = buildSessionAtom(source, {
        rootSessionId: rootId,
        sessionRowCount: stamp.sessionRowCount,
        sessionMaxRowId: stamp.sessionMaxRowId,
        sessionMaxUpdatedAt: stamp.sessionMaxUpdatedAt,
        messageRowCount: stamp.messageRowCount,
        messageMaxRowId: stamp.messageMaxRowId,
        messageMaxUpdatedAt: stamp.messageMaxUpdatedAt,
        partRowCount: stamp.partRowCount,
        partMaxRowId: stamp.partMaxRowId,
        partMaxUpdatedAt: stamp.partMaxUpdatedAt,
      });
      this.atoms.set(rootId, atom);
      this.resolvedRootIds.add(rootId);
      built = true;
    }

    if (built) {
      this.bumpGeneration();
    }
    this.maybeMarkColdBuildComplete();
    return built;
  }

  /**
   * Advance the work pipeline by ONE bounded unit: a stamp batch if any
   * candidates await stamping, otherwise a build chunk. Stamping is drained
   * first so changed roots are discovered before (and interleaved with)
   * building. Returns true if a unit of work was performed (more may remain).
   * This is the single step the worker pumps between event-loop yields, so the
   * worst-case synchronous span is one stamp batch or one build chunk.
   */
  pumpWork(): boolean {
    if (this.stampQueue.length > 0) {
      return this.stampNextBatch();
    }
    return this.buildNextChunk();
  }

  // True while either queue still has work — the worker pump loop keeps going
  // until this is false. Distinct from the UI rollup state (coldBuildComplete):
  // routine hot-restamp work can be pending while the rollup is already "ready".
  hasPendingWork(): boolean {
    return this.stampQueue.length > 0 || this.pendingRootIds.length > 0;
  }

  /** Drive reconcile + stamp + build to completion. Used by the inline gateway. */
  drain(now: number): void {
    this.reconcile(now);
    while (this.pumpWork()) {
      // keep stamping/building until both queues empty
    }
  }

  // UI rollup state. "building" only during the initial cold build; once that
  // completes the rollup stays "ready" and incremental updates flow via
  // generation bumps (never a full skeleton again).
  rollupStatus(): DashboardRollupStatusContract {
    if (this.coldBuildComplete) {
      return { state: "ready", progressPercent: 100 };
    }
    const denom = Math.max(this.horizonRootCount, 1);
    const resolved = Math.min(this.resolvedRootIds.size, denom);
    const progressPercent = Math.min(99, Math.floor((resolved / denom) * 100));
    return { state: "building", progressPercent };
  }

  getGeneration(): number {
    return this.generation;
  }

  // Heavy endpoints return data once the cold build is complete; before that
  // they return the building envelope.
  isReady(): boolean {
    return this.coldBuildComplete;
  }

  // Overview is read straight from the session table on demand (always ready).
  readOverviewSource(
    now: number,
    window: DashboardWindowMs,
  ): DashboardOverviewSource {
    return {
      summary: readDashboardSummary(this.db, window),
      heatmapDays: readDashboardHeatmapDays(this.db, this.heatmapWindow(now)),
      recentSessions: readDashboardRecentSessions(this.db),
    };
  }

  projectActivityFor(
    selection: DashboardSelectionContract,
  ): DashboardActivityDataContract {
    return this.memoized("activity", selection, () =>
      projectActivity(this.atoms.values(), selection),
    ) as DashboardActivityDataContract;
  }

  projectModelsFor(
    selection: DashboardSelectionContract,
  ): DashboardModelsDataContract {
    return this.memoized("models", selection, () =>
      projectModels(this.atoms.values(), selection),
    ) as DashboardModelsDataContract;
  }

  projectToolsFor(
    selection: DashboardSelectionContract,
  ): DashboardToolsDataContract {
    return this.memoized("tools", selection, () =>
      projectTools(this.atoms.values(), selection),
    ) as DashboardToolsDataContract;
  }

  private memoized(
    endpoint: DashboardEndpoint,
    selection: DashboardSelectionContract,
    build: () => ProjectionData,
  ): ProjectionData {
    const key = `${endpoint}:${selectionKey(selection)}`;
    const cached = this.projectionMemo.get(key);
    if (cached && cached.generation === this.generation) {
      return cached.data;
    }
    const data = build();
    this.projectionMemo.set(key, { generation: this.generation, data });
    return data;
  }

  reset(): void {
    this.detector.reset();
    this.atoms.clear();
    this.stampQueue = [];
    this.stampSet.clear();
    this.pendingRootIds = [];
    this.pendingSet.clear();
    this.resolvedRootIds.clear();
    this.horizonRootCount = 0;
    this.hasReconciledOnce = false;
    this.coldBuildComplete = false;
    this.projectionMemo.clear();
    this.bumpGeneration();
  }
}
