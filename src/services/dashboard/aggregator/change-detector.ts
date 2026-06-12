import {
  type DashboardRootListRow,
  type DashboardWindowMs,
  readRootSessionIdsForSessionIds,
  readRootSessionList,
  readSessionIdsWithNewRows,
  readSessionRowsWithNewRows,
  readTableWatermarks,
} from "../../../repositories/dashboard/dashboard-queries.js";

type SqliteDatabase = import("better-sqlite3").Database;

// Roots active within this trailing window are re-stamped every cycle to catch
// in-place message/part UPDATEs that rowid-append detection cannot see.
const HOT_WINDOW_MS = 48 * 60 * 60 * 1000;

// Number of cold (older) roots re-stamped per cycle as a result-integrity
// backstop against missed updates / rowid reuse.
const COLD_SWEEP_BATCH = 20;

export interface DashboardChangeReport {
  // Roots whose source may have changed and should be (re)stamped/rebuilt.
  candidateRootIds: string[];
  // Roots that no longer exist in the horizon and should be evicted.
  removedRootIds: string[];
  // Number of in-horizon root sessions, surfaced so the caller can report
  // build progress without re-running the (already-performed) root-list scan.
  // On a data_version short-circuit cycle this reflects the last known count.
  horizonRootCount: number;
}

interface ChangeDetectorWatermarks {
  sessionMaxRowId: number;
  messageMaxRowId: number;
  partMaxRowId: number;
}

/**
 * Detects what changed in the opencode DB without ever full-scanning the heavy
 * message/part tables.
 *
 * data_version is the cheap first gate. PRAGMA data_version only advances on a
 * committed write seen by THIS connection; it is meaningless across separate
 * connections. Therefore the detector requires a single long-lived connection,
 * injected via the constructor, and the gateway must reuse that same
 * connection for every cycle. We assert this invariant by capturing the
 * connection once and never accepting another.
 */
export class DashboardChangeDetector {
  private readonly db: SqliteDatabase;
  private watermarks: ChangeDetectorWatermarks | null = null;
  private knownRootIds = new Set<string>();
  private rootUpdatedAt = new Map<string, number>();
  private coldSweepCursor = 0;
  private lastDataVersion: number | null = null;
  private lastHorizonRootCount = 0;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  private readDataVersion(): number {
    const row = this.db.prepare("PRAGMA data_version").get() as
      | { data_version: number }
      | undefined;
    return row?.data_version ?? 0;
  }

  /**
   * Compute the set of roots to (re)consider and to evict for this cycle.
   *
   * @param window      the aggregation horizon (trailing 90 days) in ms
   * @param now         injected clock for hot-window selection (test determinism)
   * @param forceScan   when true, bypass the data_version short-circuit (used
   *                    for the initial cold build and cold sweeps)
   */
  detect(
    window: DashboardWindowMs,
    now: number,
    forceScan = false,
  ): DashboardChangeReport {
    const dataVersion = this.readDataVersion();
    const dataVersionChanged =
      this.lastDataVersion === null || dataVersion !== this.lastDataVersion;
    this.lastDataVersion = dataVersion;

    const firstCycle = this.watermarks === null;

    // Cheap gate: when nothing was committed and we are not forcing a sweep,
    // only the hot/cold restamp passes run (they are bounded and cheap). The
    // root list is unchanged here, so we reuse the last known horizon count.
    if (!dataVersionChanged && !forceScan && !firstCycle) {
      return {
        candidateRootIds: this.collectRestampRoots(now),
        removedRootIds: [],
        horizonRootCount: this.lastHorizonRootCount,
      };
    }

    const candidates = new Set<string>();

    // (3) Session-table scan: the in-horizon root list is the source of truth
    // for which roots exist. New roots, removed roots, and time_updated changes
    // are derived from it.
    const rootList = readRootSessionList(this.db, window);
    const horizonRootIds = new Set(rootList.map((row) => row.id));
    this.lastHorizonRootCount = rootList.length;
    const removedRootIds = this.diffRemovedRoots(rootList);
    for (const root of this.diffChangedRoots(rootList)) {
      candidates.add(root);
    }

    // (1) Append detection via rowid range scans on message/part. Skipped on
    // the first cycle (everything is "new" then; the root-list scan already
    // covers the cold build). On later cycles it catches appended rows.
    const nextWatermarks = readTableWatermarks(this.db);
    if (!firstCycle && this.watermarks) {
      const previous = this.watermarks;
      if (nextWatermarks.messageMaxRowId > previous.messageMaxRowId) {
        for (const root of this.rootsForSessionIds(
          readSessionIdsWithNewRows(
            this.db,
            "message",
            previous.messageMaxRowId,
          ),
        )) {
          candidates.add(root);
        }
      }
      if (nextWatermarks.partMaxRowId > previous.partMaxRowId) {
        for (const root of this.rootsForSessionIds(
          readSessionIdsWithNewRows(this.db, "part", previous.partMaxRowId),
        )) {
          candidates.add(root);
        }
      }
      if (nextWatermarks.sessionMaxRowId > previous.sessionMaxRowId) {
        for (const root of this.rootsForSessionRows(
          readSessionRowsWithNewRows(this.db, previous.sessionMaxRowId),
        )) {
          candidates.add(root);
        }
      }
    }
    this.watermarks = nextWatermarks;
    this.refreshKnownRoots(rootList);

    // (4)+(5) Hot restamp and cold sweep.
    for (const root of this.collectRestampRoots(now)) {
      candidates.add(root);
    }

    // Constrain candidates to the in-horizon root set, and never rebuild a root
    // we are about to evict.
    const candidateRootIds = Array.from(candidates).filter((rootId) =>
      horizonRootIds.has(rootId),
    );

    return {
      candidateRootIds,
      removedRootIds,
      horizonRootCount: rootList.length,
    };
  }

  private rootsForSessionIds(sessionIds: string[]): string[] {
    if (sessionIds.length === 0) return [];
    return readRootSessionIdsForSessionIds(this.db, sessionIds);
  }

  private rootsForSessionRows(
    rows: Array<{ id: string; parentId: string | null }>,
  ): string[] {
    const sessionIds = rows.map((row) => row.id);
    return this.rootsForSessionIds(sessionIds);
  }

  private diffRemovedRoots(rootList: DashboardRootListRow[]): string[] {
    const present = new Set(rootList.map((row) => row.id));
    const removed: string[] = [];
    for (const knownId of this.knownRootIds) {
      if (!present.has(knownId)) {
        removed.push(knownId);
      }
    }
    return removed;
  }

  private diffChangedRoots(rootList: DashboardRootListRow[]): string[] {
    const changed: string[] = [];
    for (const row of rootList) {
      const previousUpdatedAt = this.rootUpdatedAt.get(row.id);
      if (
        previousUpdatedAt === undefined ||
        previousUpdatedAt !== row.timeUpdated
      ) {
        changed.push(row.id);
      }
    }
    return changed;
  }

  private refreshKnownRoots(rootList: DashboardRootListRow[]): void {
    this.knownRootIds = new Set(rootList.map((row) => row.id));
    const nextUpdatedAt = new Map<string, number>();
    for (const row of rootList) {
      nextUpdatedAt.set(row.id, row.timeUpdated);
    }
    this.rootUpdatedAt = nextUpdatedAt;
  }

  private collectRestampRoots(now: number): string[] {
    const restamp = new Set<string>();

    // Hot restamp: every root updated within the trailing 48h.
    for (const [rootId, updatedAt] of this.rootUpdatedAt) {
      if (now - updatedAt <= HOT_WINDOW_MS) {
        restamp.add(rootId);
      }
    }

    // Cold sweep: a rotating batch of K roots (ordered by id for determinism).
    const allRootIds = Array.from(this.knownRootIds).sort();
    if (allRootIds.length > 0) {
      for (let i = 0; i < COLD_SWEEP_BATCH && i < allRootIds.length; i++) {
        const index = (this.coldSweepCursor + i) % allRootIds.length;
        restamp.add(allRootIds[index]);
      }
      this.coldSweepCursor =
        (this.coldSweepCursor + COLD_SWEEP_BATCH) % allRootIds.length;
    }

    return Array.from(restamp);
  }

  reset(): void {
    this.watermarks = null;
    this.knownRootIds = new Set();
    this.rootUpdatedAt = new Map();
    this.coldSweepCursor = 0;
    this.lastDataVersion = null;
    this.lastHorizonRootCount = 0;
  }
}
