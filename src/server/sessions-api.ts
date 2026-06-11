import { Hono } from "hono";
import {
  HARNESS_SESSIONS_SORT_OPTIONS,
  type HarnessDirectoryFacetContract,
  type HarnessId,
  type HarnessListEntryContract,
  type HarnessSessionDetailContract,
  type HarnessSessionNotFoundContract,
  type HarnessSessionSummaryContract,
  type HarnessSessionsContract,
  type HarnessSessionsSort,
  isHarnessId,
} from "../contracts/harness.js";
import { getWritableDb } from "../lib/db.js";
import {
  readDashboardAffectedDaysForRootSessionIds,
  readDashboardRootSessionIdsForSessionIds,
  readSessionDeletionTargetIds,
} from "../repositories/dashboard/dashboard-repository.js";
import {
  invalidateDashboardAggregationStore,
  invalidateDashboardAggregationStoreForRootSessionIdsAndDays,
} from "../services/dashboard/dashboard-aggregation-store.js";
import {
  getHarnessAdapter,
  listHarnessAdapters,
} from "../services/harness/registry.js";
import { requireDeleteConfirmation } from "./delete-guard.js";

function normalizeSort(raw: string | undefined): HarnessSessionsSort {
  return HARNESS_SESSIONS_SORT_OPTIONS.includes(raw as HarnessSessionsSort)
    ? (raw as HarnessSessionsSort)
    : "updated";
}

function matchesQuery(
  session: HarnessSessionSummaryContract,
  q: string,
): boolean {
  if (!q) return true;
  return session.title.toLowerCase().includes(q.toLowerCase());
}

function compareUpdatedDesc(
  a: HarnessSessionSummaryContract,
  b: HarnessSessionSummaryContract,
): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function sortSessions(
  sessions: HarnessSessionSummaryContract[],
  sort: HarnessSessionsSort,
): HarnessSessionSummaryContract[] {
  const byNullableNumberDesc =
    (pick: (s: HarnessSessionSummaryContract) => number | null) =>
    (a: HarnessSessionSummaryContract, b: HarnessSessionSummaryContract) => {
      const left = pick(a);
      const right = pick(b);
      if (left === null && right === null) return compareUpdatedDesc(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || compareUpdatedDesc(a, b);
    };

  const sorted = [...sessions];
  switch (sort) {
    case "created":
      sorted.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      );
      break;
    case "tokens":
      sorted.sort(byNullableNumberDesc((s) => s.totalTokens));
      break;
    case "messages":
      sorted.sort(byNullableNumberDesc((s) => s.messageCount));
      break;
    default:
      sorted.sort(compareUpdatedDesc);
  }
  return sorted;
}

function buildDirectoryFacet(
  sessions: HarnessSessionSummaryContract[],
): HarnessDirectoryFacetContract[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.directory) continue;
    counts.set(session.directory, (counts.get(session.directory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([directory, count]) => ({ directory, count }))
    .sort(
      (a, b) => b.count - a.count || a.directory.localeCompare(b.directory),
    );
}

/**
 * Standard faceted-search semantics: each facet's counts are computed with
 * every filter applied EXCEPT its own dimension, so harness and directory
 * combine as AND while their counts stay meaningful.
 *   - harness counts:   q + directory applied (not harness)
 *   - directory counts: q + harness applied (not directory)
 *   - sessions:         q + harness + directory applied
 */
function buildSessionsContract(params: {
  harness: HarnessId | null;
  directory: string | null;
  q: string;
  sort: HarnessSessionsSort;
}): HarnessSessionsContract {
  const harnesses: HarnessListEntryContract[] = [];
  const facetScope: HarnessSessionSummaryContract[] = [];
  const scoped: HarnessSessionSummaryContract[] = [];

  for (const adapter of listHarnessAdapters()) {
    const list = adapter.listSessions();
    const matchingQ = list.sessions.filter((session) =>
      matchesQuery(session, params.q),
    );
    const matchingQDir = params.directory
      ? matchingQ.filter((session) => session.directory === params.directory)
      : matchingQ;
    harnesses.push({
      descriptor: adapter.descriptor,
      source: list.source,
      sessionCount: matchingQDir.length,
    });
    if (params.harness === null || params.harness === adapter.descriptor.id) {
      facetScope.push(...matchingQ);
      scoped.push(...matchingQDir);
    }
  }

  return {
    kind: "harness.sessions",
    generatedAt: new Date().toISOString(),
    harnesses,
    query: {
      harness: params.harness,
      directory: params.directory,
      q: params.q,
      sort: params.sort,
    },
    directories: buildDirectoryFacet(facetScope),
    sessions: sortSessions(scoped, params.sort),
  };
}

export const sessionsApi = new Hono();

sessionsApi.get("/", (c) => {
  const rawHarness = c.req.query("harness")?.trim() ?? "";
  const harness = isHarnessId(rawHarness) ? rawHarness : null;
  const directory = c.req.query("directory")?.trim() || null;
  const q = c.req.query("q")?.trim() ?? "";
  const sort = normalizeSort(c.req.query("sort"));

  return c.json(buildSessionsContract({ harness, directory, q, sort }));
});

sessionsApi.get("/:harness/:id", (c) => {
  const harness = c.req.param("harness");
  const id = c.req.param("id");
  if (!isHarnessId(harness)) {
    return c.json({ kind: "harness.unknown", harness }, 400);
  }

  const detail: HarnessSessionDetailContract | null =
    getHarnessAdapter(harness).getSessionDetail(id);
  if (!detail) {
    const notFound: HarnessSessionNotFoundContract = {
      kind: "harness.session.not-found",
      harness,
      sessionId: id,
    };
    return c.json(notFound, 404);
  }
  return c.json(detail);
});

sessionsApi.delete("/:harness/:id", (c) => {
  const harness = c.req.param("harness");
  const sessionId = c.req.param("id");
  if (!isHarnessId(harness)) {
    return c.json({ kind: "harness.unknown", harness }, 400);
  }
  if (!getHarnessAdapter(harness).descriptor.capabilities.delete) {
    return c.json({ error: "delete is not supported for this harness" }, 405);
  }

  const confirmation = c.req.header("x-opencode-confirm-delete");
  if (!requireDeleteConfirmation(sessionId, confirmation)) {
    return c.json({ error: "delete confirmation required", sessionId }, 400);
  }

  const db = getWritableDb();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const targetSessionIds = readSessionDeletionTargetIds(db, sessionId);
    const affectedRootSessionIds = readDashboardRootSessionIdsForSessionIds(
      db,
      targetSessionIds,
    );
    const affectedDays = readDashboardAffectedDaysForRootSessionIds(
      db,
      affectedRootSessionIds,
    );
    const deleteStmt = db.prepare(
      "DELETE FROM session WHERE id = ? OR parent_id = ?",
    );
    const result = deleteStmt.run(sessionId, sessionId);

    if (result.changes > 0) {
      if (affectedRootSessionIds.length > 0 && affectedDays.length > 0) {
        invalidateDashboardAggregationStoreForRootSessionIdsAndDays(
          db,
          affectedRootSessionIds,
          affectedDays,
        );
      } else {
        invalidateDashboardAggregationStore();
      }
    }

    return c.json({ deleted: result.changes });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  } finally {
    db.close();
  }
});
