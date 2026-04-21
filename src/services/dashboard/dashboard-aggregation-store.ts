import type { DashboardContract, DashboardViewContract } from "../../contracts/dashboard.js";
import {
  addLocalDays,
  resolveDashboardTimezone,
  toLocalDateString,
} from "../../lib/dashboard-time.js";
import {
  readDashboardCacheStamp,
  readDashboardChangedRootSessionIdsSince,
  readDashboardSessionSourceStamps,
  type DashboardCacheStamp,
  type DashboardRepositoryWindow,
} from "../../repositories/dashboard/dashboard-repository.js";
import {
  diffDashboardSessionAtoms,
  rebuildDashboardSessionAtom,
} from "./dashboard-session-atom.js";
import type {
  DashboardAggregationStoreSnapshot,
  DashboardDayRollup,
  DashboardMcpUsageTotals,
  DashboardModelTokenTotals,
  DashboardProjectionSource,
  DashboardSessionAtom,
  DashboardToolReliabilityTotals,
} from "./dashboard-aggregation-types.js";

type SqliteDatabase = import("better-sqlite3").Database;

export const DASHBOARD_CACHE_SEMANTICS_VERSION =
  "session-atom-day-rollup-store-v2";

interface DashboardProjectionMemoEntry {
  generation: number;
  response: DashboardContract;
  generatedAt: string;
}

interface DashboardAggregationStore {
  sessionAtoms: Map<string, DashboardSessionAtom>;
  dayRollups: Map<string, DashboardDayRollup>;
  generation: number;
  timezone: string;
  semanticsVersion: string;
  stamp: DashboardCacheStamp | null;
  projectionMemoBySelection: Map<string, DashboardProjectionMemoEntry>;
}

const dashboardAggregationStore: DashboardAggregationStore = {
  sessionAtoms: new Map(),
  dayRollups: new Map(),
  generation: 0,
  timezone: resolveDashboardTimezone(),
  semanticsVersion: DASHBOARD_CACHE_SEMANTICS_VERSION,
  stamp: null,
  projectionMemoBySelection: new Map(),
};

function createEmptyDashboardDayRollup(day: string): DashboardDayRollup {
  return {
    day,
    rootSessionCount: 0,
    tokenTotals: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    },
    toolStatus: {
      calls: 0,
      errors: 0,
    },
    projectIds: new Set(),
    recentSessionIds: new Set(),
    toolErrorsByToolDay: new Map(),
    toolErrorsByHour: new Map(),
    tokenByDay: 0,
    tokenInputByDay: 0,
    tokenOutputByDay: 0,
    tokenInputByHour: new Map(),
    tokenOutputByHour: new Map(),
    subagentByDay: new Map(),
    subagentByHour: new Map(),
    repoSessionCountByDay: new Map(),
    repoActiveDurationMsByDay: new Map(),
    modelCountByDay: new Map(),
    modelTokenTotals: new Map(),
    toolUsage: new Map(),
    agentDistribution: new Map(),
    mcpUsage: new Map(),
    toolReliabilityMatrix: new Map(),
    errorPatterns: new Map(),
  };
}

function incrementNumberMap(
  map: Map<string, number>,
  key: string,
  value: number,
) {
  if (value === 0) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + value);
}

function mergeModelTokenTotals(
  target: Map<string, DashboardModelTokenTotals>,
  source: Map<string, DashboardModelTokenTotals>,
) {
  for (const [key, value] of source) {
    let entry = target.get(key);
    if (!entry) {
      entry = {
        model: value.model,
        provider: value.provider,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        nonCacheInputTokens: 0,
        inputTotalTokens: 0,
        totalTokens: 0,
      };
      target.set(key, entry);
    }

    entry.inputTokens += value.inputTokens;
    entry.outputTokens += value.outputTokens;
    entry.cacheReadTokens += value.cacheReadTokens;
    entry.cacheWriteTokens += value.cacheWriteTokens;
    entry.nonCacheInputTokens += value.nonCacheInputTokens;
    entry.inputTotalTokens += value.inputTotalTokens;
    entry.totalTokens += value.totalTokens;
  }
}

function mergeMcpUsageTotals(
  target: Map<string, DashboardMcpUsageTotals>,
  source: Map<string, DashboardMcpUsageTotals>,
) {
  for (const [key, value] of source) {
    let entry = target.get(key);
    if (!entry) {
      entry = {
        server: value.server,
        calls: 0,
        errors: 0,
        isBuiltin: value.isBuiltin,
      };
      target.set(key, entry);
    }
    entry.calls += value.calls;
    entry.errors += value.errors;
  }
}

function mergeToolReliabilityTotals(
  target: Map<string, DashboardToolReliabilityTotals>,
  source: Map<string, DashboardToolReliabilityTotals>,
) {
  for (const [key, value] of source) {
    let entry = target.get(key);
    if (!entry) {
      entry = {
        tool: value.tool,
        success: 0,
        error: 0,
        total: 0,
      };
      target.set(key, entry);
    }
    entry.success += value.success;
    entry.error += value.error;
    entry.total += value.total;
  }
}

function rebuildDayRollupFromSessionAtoms(day: string): DashboardDayRollup | null {
  const rollup = createEmptyDashboardDayRollup(day);

  for (const atom of dashboardAggregationStore.sessionAtoms.values()) {
    const contribution = atom.days.get(day);
    if (!contribution) {
      continue;
    }

    rollup.projectIds.add(atom.projectId);
    rollup.recentSessionIds.add(atom.rootSessionId);
    rollup.rootSessionCount += contribution.rootSessionCount;
    rollup.tokenTotals.input += contribution.tokenTotals.input;
    rollup.tokenTotals.output += contribution.tokenTotals.output;
    rollup.tokenTotals.cacheRead += contribution.tokenTotals.cacheRead;
    rollup.tokenTotals.cacheWrite += contribution.tokenTotals.cacheWrite;
    rollup.tokenTotals.reasoning += contribution.tokenTotals.reasoning;
    rollup.tokenTotals.total += contribution.tokenTotals.total;
    rollup.toolStatus.calls += contribution.toolStatus.calls;
    rollup.toolStatus.errors += contribution.toolStatus.errors;
    rollup.tokenByDay += contribution.tokenTotals.total;
    rollup.tokenInputByDay += contribution.tokenTotals.input;
    rollup.tokenOutputByDay += contribution.tokenTotals.output;

    for (const [hour, count] of contribution.tokenInputByHour) {
      incrementNumberMap(rollup.tokenInputByHour, hour, count);
    }
    for (const [hour, count] of contribution.tokenOutputByHour) {
      incrementNumberMap(rollup.tokenOutputByHour, hour, count);
    }

    incrementNumberMap(
      rollup.repoSessionCountByDay,
      atom.repoKey,
      contribution.repoSessionCount,
    );
    incrementNumberMap(
      rollup.repoActiveDurationMsByDay,
      atom.repoKey,
      contribution.repoActiveDurationMs,
    );

    for (const [label, count] of contribution.errorPatterns) {
      incrementNumberMap(rollup.errorPatterns, label, count);
    }
    for (const [hour, count] of contribution.toolErrorsByHour) {
      incrementNumberMap(rollup.toolErrorsByHour, hour, count);
    }
    for (const [agent, count] of contribution.subagentCounts) {
      incrementNumberMap(rollup.subagentByDay, agent, count);
      incrementNumberMap(rollup.agentDistribution, agent, count);
    }
    for (const [agentHour, count] of contribution.subagentByHour) {
      incrementNumberMap(rollup.subagentByHour, agentHour, count);
    }
    for (const [model, count] of contribution.modelCounts) {
      incrementNumberMap(rollup.modelCountByDay, model, count);
    }
    for (const [tool, totals] of contribution.toolReliability) {
      incrementNumberMap(rollup.toolUsage, tool, totals.total);
      incrementNumberMap(rollup.toolErrorsByToolDay, tool, totals.error);
    }

    mergeMcpUsageTotals(rollup.mcpUsage, contribution.mcpUsage);
    mergeToolReliabilityTotals(
      rollup.toolReliabilityMatrix,
      contribution.toolReliability,
    );
    mergeModelTokenTotals(rollup.modelTokenTotals, contribution.modelTokenTotals);
  }

  if (
    rollup.rootSessionCount === 0 &&
    rollup.tokenTotals.total === 0 &&
    rollup.toolStatus.calls === 0 &&
    rollup.repoSessionCountByDay.size === 0
  ) {
    return null;
  }

  return rollup;
}

function syncDayRollup(day: string) {
  const rollup = rebuildDayRollupFromSessionAtoms(day);
  if (rollup) {
    dashboardAggregationStore.dayRollups.set(day, rollup);
    return;
  }

  dashboardAggregationStore.dayRollups.delete(day);
}

function clearProjectionMemo() {
  dashboardAggregationStore.projectionMemoBySelection.clear();
}

function clearStoreState() {
  dashboardAggregationStore.sessionAtoms.clear();
  dashboardAggregationStore.dayRollups.clear();
  clearProjectionMemo();
}

function commitStoreMutation() {
  dashboardAggregationStore.generation += 1;
  clearProjectionMemo();
}

function buildSelectionKey(
  window: DashboardRepositoryWindow,
  view: DashboardViewContract,
  timezone: string,
): string {
  return `${window.startDayInclusive}:${window.endDayExclusive}:${view}:${timezone}`;
}

function buildTrailingHeatmapWindow(now = new Date()): DashboardRepositoryWindow {
  const today = toLocalDateString(now);
  return {
    startDayInclusive: addLocalDays(today, -364),
    endDayExclusive: addLocalDays(today, 1),
  };
}

function isDayWithinWindow(day: string, window: DashboardRepositoryWindow): boolean {
  return day >= window.startDayInclusive && day < window.endDayExclusive;
}

function atomTouchesWindow(
  atom: DashboardSessionAtom,
  window: DashboardRepositoryWindow,
): boolean {
  for (const day of atom.days.keys()) {
    if (isDayWithinWindow(day, window)) {
      return true;
    }
  }
  return false;
}

function readDayRollupsForWindow(
  window: DashboardRepositoryWindow,
): DashboardDayRollup[] {
  return Array.from(dashboardAggregationStore.dayRollups.values())
    .filter((rollup) => isDayWithinWindow(rollup.day, window))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function sameSourceStamp(
  left: DashboardSessionAtom["sourceStamp"] | null,
  right: DashboardSessionAtom["sourceStamp"] | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.rootSessionId === right.rootSessionId &&
    left.sessionRowCount === right.sessionRowCount &&
    left.sessionRowId === right.sessionRowId &&
    left.maxSessionUpdatedAt === right.maxSessionUpdatedAt &&
    left.messageRowCount === right.messageRowCount &&
    left.messageRowId === right.messageRowId &&
    left.maxMessageUpdatedAt === right.maxMessageUpdatedAt &&
    left.partRowCount === right.partRowCount &&
    left.partRowId === right.partRowId &&
    left.maxPartUpdatedAt === right.maxPartUpdatedAt
  );
}

function sameCacheStamp(
  left: DashboardCacheStamp | null,
  right: DashboardCacheStamp | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.partRowId === right.partRowId &&
    left.messageRowId === right.messageRowId &&
    left.sessionRowId === right.sessionRowId &&
    left.rootSessionCount === right.rootSessionCount &&
    left.maxPartUpdatedAt === right.maxPartUpdatedAt &&
    left.maxMessageUpdatedAt === right.maxMessageUpdatedAt &&
    left.maxSessionUpdatedAt === right.maxSessionUpdatedAt
  );
}

function readRootSessionIdsTouchingWindow(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
): string[] {
  const rows = db
    .prepare(
      `
        WITH RECURSIVE descendants(root_session_id, session_id) AS (
          SELECT id, id
          FROM session
          WHERE parent_id IS NULL

          UNION ALL

          SELECT descendants.root_session_id, child.id
          FROM session child
          JOIN descendants ON child.parent_id = descendants.session_id
        ),
        touched_roots(rootSessionId) AS (
          SELECT DISTINCT descendants.root_session_id
          FROM descendants
          JOIN session s ON s.id = descendants.session_id
          WHERE date(s.time_created/1000, 'unixepoch', 'localtime') >= ?
            AND date(s.time_created/1000, 'unixepoch', 'localtime') < ?

          UNION

          SELECT DISTINCT descendants.root_session_id
          FROM descendants
          JOIN message m ON m.session_id = descendants.session_id
          WHERE date(m.time_created/1000, 'unixepoch', 'localtime') >= ?
            AND date(m.time_created/1000, 'unixepoch', 'localtime') < ?

          UNION

          SELECT DISTINCT descendants.root_session_id
          FROM descendants
          JOIN part p ON p.session_id = descendants.session_id
          WHERE date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
            AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
        )
        SELECT rootSessionId
        FROM touched_roots
        ORDER BY rootSessionId
      `,
    )
    .all(
      window.startDayInclusive,
      window.endDayExclusive,
      window.startDayInclusive,
      window.endDayExclusive,
      window.startDayInclusive,
      window.endDayExclusive,
    ) as Array<{ rootSessionId: string }>;

  return rows.map((row) => row.rootSessionId);
}

function ensureSelectionRootsLoaded(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  generatedAt: string,
): boolean {
  const rootSessionIds = readRootSessionIdsTouchingWindow(db, window);
  const missingRootIds = rootSessionIds.filter(
    (rootSessionId) => !dashboardAggregationStore.sessionAtoms.has(rootSessionId),
  );

  let mutated = false;
  if (missingRootIds.length > 0) {
    const sourceStamps = readDashboardSessionSourceStamps(db, missingRootIds);
    for (const sourceStamp of sourceStamps) {
      const atom = rebuildDashboardSessionAtom(
        db,
        sourceStamp.rootSessionId,
        sourceStamp,
        generatedAt,
      );
      if (!atom) {
        continue;
      }

      dashboardAggregationStore.sessionAtoms.set(atom.rootSessionId, atom);
      for (const day of atom.days.keys()) {
        syncDayRollup(day);
      }
      mutated = true;
    }
  }

  return mutated;
}

function fallbackResetStore(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  nextStamp: DashboardCacheStamp,
  generatedAt: string,
): boolean {
  clearStoreState();
  dashboardAggregationStore.stamp = nextStamp;
  return ensureSelectionRootsLoaded(db, window, generatedAt) || true;
}

export function reconcileDashboardAggregationStore(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
  now = new Date(),
) {
  const generatedAt = now.toISOString();
  const heatmapWindow = buildTrailingHeatmapWindow(now);
  let mutated = false;
  const nextTimezone = resolveDashboardTimezone();

  if (
    dashboardAggregationStore.timezone !== nextTimezone ||
    dashboardAggregationStore.semanticsVersion !== DASHBOARD_CACHE_SEMANTICS_VERSION
  ) {
    clearStoreState();
    dashboardAggregationStore.timezone = nextTimezone;
    dashboardAggregationStore.semanticsVersion = DASHBOARD_CACHE_SEMANTICS_VERSION;
    dashboardAggregationStore.stamp = null;
    mutated = true;
  }

  const nextStamp = readDashboardCacheStamp(db);
  const previousStamp = dashboardAggregationStore.stamp;

  if (!previousStamp) {
    dashboardAggregationStore.stamp = nextStamp;
    mutated = ensureSelectionRootsLoaded(db, window, generatedAt) || mutated || true;
    if (ensureSelectionRootsLoaded(db, heatmapWindow, generatedAt)) {
      mutated = true;
    }
    if (mutated) {
      commitStoreMutation();
    }
    return;
  }

  if (!sameCacheStamp(previousStamp, nextStamp)) {
    if (nextStamp.rootSessionCount < previousStamp.rootSessionCount) {
      mutated = fallbackResetStore(db, window, nextStamp, generatedAt);
    } else {
      const changedRootSessionIds = readDashboardChangedRootSessionIdsSince(
        db,
        previousStamp,
      );

      if (changedRootSessionIds.length === 0) {
        mutated = fallbackResetStore(db, window, nextStamp, generatedAt);
      } else {
        const nextSourceStampByRootSessionId = new Map(
          readDashboardSessionSourceStamps(db, changedRootSessionIds).map(
            (sourceStamp) => [sourceStamp.rootSessionId, sourceStamp] as const,
          ),
        );

        for (const rootSessionId of changedRootSessionIds) {
          const previousAtom =
            dashboardAggregationStore.sessionAtoms.get(rootSessionId) ?? null;
          const previousSourceStamp = previousAtom?.sourceStamp ?? null;
          const nextSourceStamp = nextSourceStampByRootSessionId.get(rootSessionId) ?? null;

          if (sameSourceStamp(previousSourceStamp, nextSourceStamp)) {
            continue;
          }

          const nextAtom = nextSourceStamp
            ? rebuildDashboardSessionAtom(db, rootSessionId, nextSourceStamp, generatedAt)
            : null;
          const diff = diffDashboardSessionAtoms(previousAtom, nextAtom);
          const affectedDays = new Set<string>();

          for (const delta of diff.addedDays) affectedDays.add(delta.day);
          for (const delta of diff.removedDays) affectedDays.add(delta.day);
          for (const delta of diff.changedDays) affectedDays.add(delta.day);

          if (nextAtom) {
            dashboardAggregationStore.sessionAtoms.set(rootSessionId, nextAtom);
          } else {
            dashboardAggregationStore.sessionAtoms.delete(rootSessionId);
          }

          for (const day of affectedDays) {
            syncDayRollup(day);
          }

          mutated = true;
        }
      }
    }

    dashboardAggregationStore.stamp = nextStamp;
  }

  if (ensureSelectionRootsLoaded(db, window, generatedAt)) {
    mutated = true;
  }

  if (ensureSelectionRootsLoaded(db, heatmapWindow, generatedAt)) {
    mutated = true;
  }

  if (mutated) {
    commitStoreMutation();
  }
}

export function readDashboardProjectionSourceFromStore(
  window: DashboardRepositoryWindow,
  now = new Date(),
): DashboardProjectionSource {
  const selectedSessionAtoms = Array.from(
    dashboardAggregationStore.sessionAtoms.values(),
  ).filter((atom) => atomTouchesWindow(atom, window));
  const selectedDayRollups = readDayRollupsForWindow(window);
  const trailingDayRollups = readDayRollupsForWindow(buildTrailingHeatmapWindow(now));

  return {
    summary: {
      selectedDayRollups,
      selectedSessionAtoms,
      projectIds: new Set(selectedSessionAtoms.map((atom) => atom.projectId)),
    },
    recentSessions: {
      selectedSessionAtoms,
    },
    heatmapDays: {
      trailingDayRollups,
    },
    errorTrend: {
      selectedDayRollups,
    },
    tokenTrend: {
      selectedDayRollups,
    },
    subagentTrend: {
      selectedDayRollups,
    },
    activeRepos: {
      selectedDayRollups,
    },
    modelUsage: {
      selectedDayRollups,
    },
    modelTokenConsumption: {
      selectedDayRollups,
    },
    modelPerformanceStats: {
      selectedSessionAtoms,
    },
    toolUsage: {
      selectedDayRollups,
    },
    agentDistribution: {
      selectedDayRollups,
    },
    mcpUsage: {
      selectedDayRollups,
    },
    toolReliabilityMatrix: {
      selectedDayRollups,
    },
    errorPatterns: {
      selectedDayRollups,
    },
  };
}

export function readDashboardProjectionMemoFromStore(args: {
  window: DashboardRepositoryWindow;
  view: DashboardViewContract;
  now?: Date;
  buildResponse: (generatedAt: string) => DashboardContract;
}): DashboardContract {
  const now = args.now ?? new Date();
  const selectionKey = buildSelectionKey(
    args.window,
    args.view,
    dashboardAggregationStore.timezone,
  );
  const cached = dashboardAggregationStore.projectionMemoBySelection.get(selectionKey);

  if (cached && cached.generation === dashboardAggregationStore.generation) {
    return cached.response;
  }

  const generatedAt = now.toISOString();
  const response = args.buildResponse(generatedAt);
  dashboardAggregationStore.projectionMemoBySelection.set(selectionKey, {
    generation: dashboardAggregationStore.generation,
    response,
    generatedAt,
  });
  return response;
}

export function invalidateDashboardAggregationStore() {
  clearStoreState();
  dashboardAggregationStore.timezone = resolveDashboardTimezone();
  dashboardAggregationStore.semanticsVersion = DASHBOARD_CACHE_SEMANTICS_VERSION;
  dashboardAggregationStore.stamp = null;
  commitStoreMutation();
}

export function invalidateDashboardAggregationStoreForRootSessionIdsAndDays(
  db: SqliteDatabase,
  rootSessionIds: string[],
  days: string[],
) {
  const normalizedRootSessionIds = Array.from(
    new Set(rootSessionIds.filter(Boolean)),
  ).sort();
  const normalizedDays = Array.from(new Set(days.filter(Boolean))).sort();

  if (normalizedRootSessionIds.length === 0 || normalizedDays.length === 0) {
    return;
  }

  for (const rootSessionId of normalizedRootSessionIds) {
    dashboardAggregationStore.sessionAtoms.delete(rootSessionId);
  }

  for (const day of normalizedDays) {
    syncDayRollup(day);
  }

  dashboardAggregationStore.stamp = readDashboardCacheStamp(db);
  commitStoreMutation();
}

export function invalidateDashboardAggregationStoreForDays(days: string[]) {
  const daySet = new Set(days.filter(Boolean));
  if (daySet.size === 0) {
    return;
  }

  let mutated = false;
  for (const [rootSessionId, atom] of dashboardAggregationStore.sessionAtoms) {
    const touchesInvalidatedDay = Array.from(atom.days.keys()).some((day) =>
      daySet.has(day),
    );
    if (!touchesInvalidatedDay) {
      continue;
    }

    dashboardAggregationStore.sessionAtoms.delete(rootSessionId);
    mutated = true;
  }

  if (!mutated) {
    return;
  }

  dashboardAggregationStore.dayRollups.clear();
  for (const atom of dashboardAggregationStore.sessionAtoms.values()) {
    for (const day of atom.days.keys()) {
      syncDayRollup(day);
    }
  }
  commitStoreMutation();
}

export function overrideDashboardAggregationStoreMetadataForTests(overrides: {
  timezone?: string;
  semanticsVersion?: string;
}) {
  if (typeof overrides.timezone === "string") {
    dashboardAggregationStore.timezone = overrides.timezone;
  }

  if (typeof overrides.semanticsVersion === "string") {
    dashboardAggregationStore.semanticsVersion = overrides.semanticsVersion;
  }
}

export function getDashboardAggregationStoreSnapshotForTests(): DashboardAggregationStoreSnapshot {
  const dayKeys = Array.from(dashboardAggregationStore.dayRollups.keys()).sort();
  return {
    generation: dashboardAggregationStore.generation,
    timezone: dashboardAggregationStore.timezone,
    semanticsVersion: dashboardAggregationStore.semanticsVersion,
    sessionKeys: Array.from(dashboardAggregationStore.sessionAtoms.keys()).sort(),
    dayKeys,
    rawKeys: dayKeys,
    viewKeys: Array.from(
      dashboardAggregationStore.projectionMemoBySelection.keys(),
    ).sort(),
    stamp: dashboardAggregationStore.stamp,
  };
}
