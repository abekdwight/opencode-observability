import { classifyTool } from "../../lib/analytics.js";
import { resolveRepoBucketKey } from "../../lib/repo-root.js";
import {
  readDashboardSessionAtomSource,
  type DashboardSessionAtomSource,
} from "../../repositories/dashboard/dashboard-repository.js";
import type {
  DashboardMcpUsageTotals,
  DashboardModelPerformanceSample,
  DashboardModelTokenTotals,
  DashboardSessionAtom,
  DashboardSessionAtomDayDelta,
  DashboardSessionAtomDiff,
  DashboardSessionDayContribution,
  DashboardSessionSourceStamp,
  DashboardToolReliabilityTotals,
} from "./dashboard-aggregation-types.js";

type SqliteDatabase = import("better-sqlite3").Database;

function classifyError(error: string): string {
  if (!error) return "Unknown";
  if (/ENOENT|File not found|no such file|EISDIR/i.test(error)) {
    return "File not found";
  }
  if (/Tool execution aborted/i.test(error)) return "Aborted";
  if (/timed? ?out|deadline exceeded/i.test(error)) return "Timeout";
  if (
    /fetch failed|HTTP [45]\d\d|status [45]\d\d|ECONNREFUSED|ENOTFOUND|network/i.test(
      error,
    )
  ) {
    return "Network/HTTP error";
  }
  if (/patch|hunk|conflict/i.test(error)) return "Patch failed";
  if (/permission denied|EACCES/i.test(error)) return "Permission denied";
  if (/not found|not available|no such/i.test(error)) return "Not found";
  if (/syntax|parse|unexpected token/i.test(error)) return "Parse error";
  return "Other";
}

function createEmptyModelTokenTotals(
  model: string,
  provider: string,
): DashboardModelTokenTotals {
  return {
    model,
    provider,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    nonCacheInputTokens: 0,
    inputTotalTokens: 0,
    totalTokens: 0,
  };
}

function createEmptyModelPerformanceSample(
  model: string,
  provider: string,
): DashboardModelPerformanceSample {
  return {
    model,
    provider,
    sumOutputTokens: 0,
    sumDurationMs: 0,
    validTpsMessages: 0,
    validLatencyMessages: 0,
    totalMessages: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    tpsSamples: [],
    latencySamplesMs: [],
  };
}

function createEmptyToolReliabilityTotals(
  tool: string,
): DashboardToolReliabilityTotals {
  return {
    tool,
    success: 0,
    error: 0,
    total: 0,
  };
}

function createEmptyMcpUsageTotals(
  server: string,
  isBuiltin: boolean,
): DashboardMcpUsageTotals {
  return {
    server,
    calls: 0,
    errors: 0,
    isBuiltin,
  };
}

function createEmptyDayContribution(
  day: string,
): DashboardSessionDayContribution {
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
    tokenInputByHour: new Map(),
    tokenOutputByHour: new Map(),
    toolStatus: {
      calls: 0,
      errors: 0,
    },
    errorPatterns: new Map(),
    mcpUsage: new Map(),
    toolReliability: new Map(),
    modelCounts: new Map(),
    modelTokenTotals: new Map(),
    subagentCounts: new Map(),
    subagentByHour: new Map(),
    toolErrorsByHour: new Map(),
    repoSessionCount: 0,
    repoActiveDurationMs: 0,
  };
}

function ensureDayContribution(
  days: Map<string, DashboardSessionDayContribution>,
  day: string,
): DashboardSessionDayContribution {
  let contribution = days.get(day);
  if (!contribution) {
    contribution = createEmptyDayContribution(day);
    days.set(day, contribution);
  }
  return contribution;
}

function incrementMap(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function cloneMap(map: Map<string, number>): Map<string, number> {
  return new Map(map);
}

function cloneModelTokenTotals(
  totals: DashboardModelTokenTotals,
): DashboardModelTokenTotals {
  return { ...totals };
}

function cloneToolReliabilityTotals(
  totals: DashboardToolReliabilityTotals,
): DashboardToolReliabilityTotals {
  return { ...totals };
}

function cloneMcpUsageTotals(
  totals: DashboardMcpUsageTotals,
): DashboardMcpUsageTotals {
  return { ...totals };
}

function cloneDayContribution(
  contribution: DashboardSessionDayContribution,
): DashboardSessionDayContribution {
  return {
    day: contribution.day,
    rootSessionCount: contribution.rootSessionCount,
    tokenTotals: { ...contribution.tokenTotals },
    tokenInputByHour: cloneMap(contribution.tokenInputByHour),
    tokenOutputByHour: cloneMap(contribution.tokenOutputByHour),
    toolStatus: { ...contribution.toolStatus },
    errorPatterns: cloneMap(contribution.errorPatterns),
    mcpUsage: new Map(
      Array.from(contribution.mcpUsage.entries()).map(([key, value]) => [
        key,
        cloneMcpUsageTotals(value),
      ]),
    ),
    toolReliability: new Map(
      Array.from(contribution.toolReliability.entries()).map(([key, value]) => [
        key,
        cloneToolReliabilityTotals(value),
      ]),
    ),
    modelCounts: cloneMap(contribution.modelCounts),
    modelTokenTotals: new Map(
      Array.from(contribution.modelTokenTotals.entries()).map(([key, value]) => [
        key,
        cloneModelTokenTotals(value),
      ]),
    ),
    subagentCounts: cloneMap(contribution.subagentCounts),
    subagentByHour: cloneMap(contribution.subagentByHour),
    toolErrorsByHour: cloneMap(contribution.toolErrorsByHour),
    repoSessionCount: contribution.repoSessionCount,
    repoActiveDurationMs: contribution.repoActiveDurationMs,
  };
}

function negateNumber(value: number): number {
  return value === 0 ? 0 : -value;
}

function negateDayContribution(
  contribution: DashboardSessionDayContribution,
): DashboardSessionDayContribution {
  const out = cloneDayContribution(contribution);
  out.rootSessionCount = negateNumber(out.rootSessionCount);
  out.tokenTotals.input = negateNumber(out.tokenTotals.input);
  out.tokenTotals.output = negateNumber(out.tokenTotals.output);
  out.tokenTotals.cacheRead = negateNumber(out.tokenTotals.cacheRead);
  out.tokenTotals.cacheWrite = negateNumber(out.tokenTotals.cacheWrite);
  out.tokenTotals.reasoning = negateNumber(out.tokenTotals.reasoning);
  out.tokenTotals.total = negateNumber(out.tokenTotals.total);
  for (const [key, value] of out.tokenInputByHour) {
    out.tokenInputByHour.set(key, negateNumber(value));
  }
  for (const [key, value] of out.tokenOutputByHour) {
    out.tokenOutputByHour.set(key, negateNumber(value));
  }
  out.toolStatus.calls = negateNumber(out.toolStatus.calls);
  out.toolStatus.errors = negateNumber(out.toolStatus.errors);
  out.repoSessionCount = negateNumber(out.repoSessionCount);
  out.repoActiveDurationMs = negateNumber(out.repoActiveDurationMs);

  for (const [key, value] of out.errorPatterns) {
    out.errorPatterns.set(key, negateNumber(value));
  }
  for (const [key, value] of out.modelCounts) {
    out.modelCounts.set(key, negateNumber(value));
  }
  for (const [key, value] of out.subagentCounts) {
    out.subagentCounts.set(key, negateNumber(value));
  }
  for (const [key, value] of out.subagentByHour) {
    out.subagentByHour.set(key, negateNumber(value));
  }
  for (const [key, value] of out.toolErrorsByHour) {
    out.toolErrorsByHour.set(key, negateNumber(value));
  }
  for (const value of out.mcpUsage.values()) {
    value.calls = negateNumber(value.calls);
    value.errors = negateNumber(value.errors);
  }
  for (const value of out.toolReliability.values()) {
    value.success = negateNumber(value.success);
    value.error = negateNumber(value.error);
    value.total = negateNumber(value.total);
  }
  for (const value of out.modelTokenTotals.values()) {
    value.inputTokens = negateNumber(value.inputTokens);
    value.outputTokens = negateNumber(value.outputTokens);
    value.cacheReadTokens = negateNumber(value.cacheReadTokens);
    value.cacheWriteTokens = negateNumber(value.cacheWriteTokens);
    value.nonCacheInputTokens = negateNumber(value.nonCacheInputTokens);
    value.inputTotalTokens = negateNumber(value.inputTotalTokens);
    value.totalTokens = negateNumber(value.totalTokens);
  }

  return out;
}

function diffNumberMaps(
  previous: Map<string, number>,
  next: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const delta = (next.get(key) ?? 0) - (previous.get(key) ?? 0);
    if (delta !== 0) out.set(key, delta);
  }
  return out;
}

function diffMcpUsageMaps(
  previous: Map<string, DashboardMcpUsageTotals>,
  next: Map<string, DashboardMcpUsageTotals>,
): Map<string, DashboardMcpUsageTotals> {
  const out = new Map<string, DashboardMcpUsageTotals>();
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const before = previous.get(key);
    const after = next.get(key);
    const calls = (after?.calls ?? 0) - (before?.calls ?? 0);
    const errors = (after?.errors ?? 0) - (before?.errors ?? 0);
    if (calls === 0 && errors === 0) continue;
    out.set(key, {
      server: after?.server ?? before?.server ?? key,
      calls,
      errors,
      isBuiltin: after?.isBuiltin ?? before?.isBuiltin ?? false,
    });
  }
  return out;
}

function diffToolReliabilityMaps(
  previous: Map<string, DashboardToolReliabilityTotals>,
  next: Map<string, DashboardToolReliabilityTotals>,
): Map<string, DashboardToolReliabilityTotals> {
  const out = new Map<string, DashboardToolReliabilityTotals>();
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const before = previous.get(key);
    const after = next.get(key);
    const success = (after?.success ?? 0) - (before?.success ?? 0);
    const error = (after?.error ?? 0) - (before?.error ?? 0);
    const total = (after?.total ?? 0) - (before?.total ?? 0);
    if (success === 0 && error === 0 && total === 0) continue;
    out.set(key, {
      tool: after?.tool ?? before?.tool ?? key,
      success,
      error,
      total,
    });
  }
  return out;
}

function diffModelTokenTotalsMaps(
  previous: Map<string, DashboardModelTokenTotals>,
  next: Map<string, DashboardModelTokenTotals>,
): Map<string, DashboardModelTokenTotals> {
  const out = new Map<string, DashboardModelTokenTotals>();
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const before = previous.get(key);
    const after = next.get(key);
    const delta = {
      model: after?.model ?? before?.model ?? key,
      provider: after?.provider ?? before?.provider ?? "unknown",
      inputTokens: (after?.inputTokens ?? 0) - (before?.inputTokens ?? 0),
      outputTokens: (after?.outputTokens ?? 0) - (before?.outputTokens ?? 0),
      cacheReadTokens:
        (after?.cacheReadTokens ?? 0) - (before?.cacheReadTokens ?? 0),
      cacheWriteTokens:
        (after?.cacheWriteTokens ?? 0) - (before?.cacheWriteTokens ?? 0),
      nonCacheInputTokens:
        (after?.nonCacheInputTokens ?? 0) - (before?.nonCacheInputTokens ?? 0),
      inputTotalTokens:
        (after?.inputTotalTokens ?? 0) - (before?.inputTotalTokens ?? 0),
      totalTokens: (after?.totalTokens ?? 0) - (before?.totalTokens ?? 0),
    };
    if (
      delta.inputTokens === 0 &&
      delta.outputTokens === 0 &&
      delta.cacheReadTokens === 0 &&
      delta.cacheWriteTokens === 0 &&
      delta.nonCacheInputTokens === 0 &&
      delta.inputTotalTokens === 0 &&
      delta.totalTokens === 0
    ) {
      continue;
    }
    out.set(key, delta);
  }
  return out;
}

function diffDayContribution(
  previous: DashboardSessionDayContribution,
  next: DashboardSessionDayContribution,
): DashboardSessionDayContribution {
  return {
    day: next.day,
    rootSessionCount: next.rootSessionCount - previous.rootSessionCount,
    tokenTotals: {
      input: next.tokenTotals.input - previous.tokenTotals.input,
      output: next.tokenTotals.output - previous.tokenTotals.output,
      cacheRead: next.tokenTotals.cacheRead - previous.tokenTotals.cacheRead,
      cacheWrite: next.tokenTotals.cacheWrite - previous.tokenTotals.cacheWrite,
      reasoning: next.tokenTotals.reasoning - previous.tokenTotals.reasoning,
      total: next.tokenTotals.total - previous.tokenTotals.total,
    },
    tokenInputByHour: diffNumberMaps(
      previous.tokenInputByHour,
      next.tokenInputByHour,
    ),
    tokenOutputByHour: diffNumberMaps(
      previous.tokenOutputByHour,
      next.tokenOutputByHour,
    ),
    toolStatus: {
      calls: next.toolStatus.calls - previous.toolStatus.calls,
      errors: next.toolStatus.errors - previous.toolStatus.errors,
    },
    errorPatterns: diffNumberMaps(previous.errorPatterns, next.errorPatterns),
    mcpUsage: diffMcpUsageMaps(previous.mcpUsage, next.mcpUsage),
    toolReliability: diffToolReliabilityMaps(
      previous.toolReliability,
      next.toolReliability,
    ),
    modelCounts: diffNumberMaps(previous.modelCounts, next.modelCounts),
    modelTokenTotals: diffModelTokenTotalsMaps(
      previous.modelTokenTotals,
      next.modelTokenTotals,
    ),
    subagentCounts: diffNumberMaps(previous.subagentCounts, next.subagentCounts),
    subagentByHour: diffNumberMaps(
      previous.subagentByHour,
      next.subagentByHour,
    ),
    toolErrorsByHour: diffNumberMaps(
      previous.toolErrorsByHour,
      next.toolErrorsByHour,
    ),
    repoSessionCount: next.repoSessionCount - previous.repoSessionCount,
    repoActiveDurationMs:
      next.repoActiveDurationMs - previous.repoActiveDurationMs,
  };
}

function isDayContributionZero(
  contribution: DashboardSessionDayContribution,
): boolean {
  return (
    contribution.rootSessionCount === 0 &&
    contribution.tokenTotals.input === 0 &&
    contribution.tokenTotals.output === 0 &&
    contribution.tokenTotals.cacheRead === 0 &&
    contribution.tokenTotals.cacheWrite === 0 &&
    contribution.tokenTotals.reasoning === 0 &&
    contribution.tokenTotals.total === 0 &&
    contribution.tokenInputByHour.size === 0 &&
    contribution.tokenOutputByHour.size === 0 &&
    contribution.toolStatus.calls === 0 &&
    contribution.toolStatus.errors === 0 &&
    contribution.errorPatterns.size === 0 &&
    contribution.mcpUsage.size === 0 &&
    contribution.toolReliability.size === 0 &&
    contribution.modelCounts.size === 0 &&
    contribution.modelTokenTotals.size === 0 &&
    contribution.subagentCounts.size === 0 &&
    contribution.subagentByHour.size === 0 &&
    contribution.toolErrorsByHour.size === 0 &&
    contribution.repoSessionCount === 0 &&
    contribution.repoActiveDurationMs === 0
  );
}

function createAtomDayDelta(
  day: string,
  previous: DashboardSessionDayContribution | null,
  next: DashboardSessionDayContribution | null,
  delta: DashboardSessionDayContribution,
): DashboardSessionAtomDayDelta {
  return {
    day,
    previous: previous ? cloneDayContribution(previous) : null,
    next: next ? cloneDayContribution(next) : null,
    delta,
  };
}

function buildDashboardSessionAtomFromSource(
  source: DashboardSessionAtomSource,
  sourceStamp: DashboardSessionSourceStamp,
  generatedAt: string,
): DashboardSessionAtom {
  const repoKey = resolveRepoBucketKey(
    source.rootSession.worktree ?? "",
    source.rootSession.directory,
  );
  const days = new Map<string, DashboardSessionDayContribution>();
  const modelPerformanceSamples = new Map<string, DashboardModelPerformanceSample>();
  const recentTimeUpdated = Math.max(
    source.rootSession.timeUpdated,
    sourceStamp.maxSessionUpdatedAt,
    sourceStamp.maxMessageUpdatedAt,
    sourceStamp.maxPartUpdatedAt,
  );

  const rootDayContribution = ensureDayContribution(days, source.rootSession.day);
  rootDayContribution.rootSessionCount += 1;
  rootDayContribution.repoSessionCount += 1;

  let recentTotalTokens = 0;
  const previousMessageTsBySession = new Map<string, number>();

  for (const message of source.messages) {
    const previousMessageTs = previousMessageTsBySession.get(message.sessionId);
    previousMessageTsBySession.set(message.sessionId, message.timeCreated);

    if (message.role !== "assistant") {
      continue;
    }

    const dayContribution = ensureDayContribution(days, message.day);
    incrementMap(
      dayContribution.tokenInputByHour,
      message.hour,
      Number(message.inputTokens) || 0,
    );
    incrementMap(
      dayContribution.tokenOutputByHour,
      message.hour,
      Number(message.outputTokens) || 0,
    );
    dayContribution.tokenTotals.input += Number(message.inputTokens) || 0;
    dayContribution.tokenTotals.output += Number(message.outputTokens) || 0;
    dayContribution.tokenTotals.cacheRead += Number(message.cacheReadTokens) || 0;
    dayContribution.tokenTotals.cacheWrite +=
      Number(message.cacheWriteTokens) || 0;
    dayContribution.tokenTotals.reasoning +=
      Number(message.reasoningTokens) || 0;
    dayContribution.tokenTotals.total += Number(message.totalTokens) || 0;

    recentTotalTokens += Number(message.totalTokens) || 0;

    if (previousMessageTs != null) {
      dayContribution.repoActiveDurationMs += Math.max(
        0,
        message.timeCreated - previousMessageTs,
      );
    }

    if (message.agent) {
      incrementMap(dayContribution.subagentCounts, message.agent, 1);
      incrementMap(
        dayContribution.subagentByHour,
        `${message.agent}\t${message.hour}`,
        1,
      );
    }

    if (message.model) {
      incrementMap(dayContribution.modelCounts, message.model, 1);

      const provider = message.provider || "unknown";
      const modelKey = `${message.model}\t${provider}`;
      let modelTokenTotals = dayContribution.modelTokenTotals.get(modelKey);
      if (!modelTokenTotals) {
        modelTokenTotals = createEmptyModelTokenTotals(message.model, provider);
        dayContribution.modelTokenTotals.set(modelKey, modelTokenTotals);
      }

      modelTokenTotals.inputTokens += Number(message.inputTokens) || 0;
      modelTokenTotals.outputTokens += Number(message.outputTokens) || 0;
      modelTokenTotals.cacheReadTokens += Number(message.cacheReadTokens) || 0;
      modelTokenTotals.cacheWriteTokens += Number(message.cacheWriteTokens) || 0;
      modelTokenTotals.nonCacheInputTokens += Number(message.inputTokens) || 0;
      modelTokenTotals.inputTotalTokens +=
        (Number(message.inputTokens) || 0) +
        (Number(message.cacheReadTokens) || 0) +
        (Number(message.cacheWriteTokens) || 0);
      modelTokenTotals.totalTokens += Number(message.totalTokens) || 0;

      let performance = modelPerformanceSamples.get(modelKey);
      if (!performance) {
        performance = createEmptyModelPerformanceSample(message.model, provider);
        modelPerformanceSamples.set(modelKey, performance);
      }

      performance.totalMessages += 1;
      performance.outputTokens += Number(message.outputTokens) || 0;
      performance.reasoningTokens += Number(message.reasoningTokens) || 0;

      const durationMs = Number(message.durationMs) || 0;
      const outputTokens = Number(message.outputTokens) || 0;

      if (durationMs > 0) {
        performance.validLatencyMessages += 1;
        performance.latencySamplesMs.push(durationMs);
      }

      if (durationMs > 0 && outputTokens > 0) {
        performance.validTpsMessages += 1;
        performance.sumOutputTokens += outputTokens;
        performance.sumDurationMs += durationMs;
        performance.tpsSamples.push((outputTokens * 1000) / durationMs);
      }
    }
  }

  for (const part of source.parts) {
    const dayContribution = ensureDayContribution(days, part.day);
    const toolName = part.tool ?? "unknown";
    const status = part.status ?? "unknown";
    const isError = status === "error";

    dayContribution.toolStatus.calls += 1;
    if (isError) {
      dayContribution.toolStatus.errors += 1;
      incrementMap(dayContribution.errorPatterns, classifyError(part.error ?? ""), 1);
      incrementMap(dayContribution.toolErrorsByHour, part.hour, 1);
    }

    let toolReliability = dayContribution.toolReliability.get(toolName);
    if (!toolReliability) {
      toolReliability = createEmptyToolReliabilityTotals(toolName);
      dayContribution.toolReliability.set(toolName, toolReliability);
    }
    if (isError) {
      toolReliability.error += 1;
    } else {
      toolReliability.success += 1;
    }
    toolReliability.total += 1;

    const { type, mcpServer } = classifyTool(toolName);
    const server = type === "builtin" ? "builtin" : (mcpServer ?? "other");
    let mcpUsage = dayContribution.mcpUsage.get(server);
    if (!mcpUsage) {
      mcpUsage = createEmptyMcpUsageTotals(server, type === "builtin");
      dayContribution.mcpUsage.set(server, mcpUsage);
    }
    mcpUsage.calls += 1;
    if (isError) {
      mcpUsage.errors += 1;
    }
  }

  return {
    rootSessionId: source.rootSession.id,
    projectId: source.rootSession.projectId,
    repoKey,
    recentMeta: {
      id: source.rootSession.id,
      title: source.rootSession.title,
      directory: source.rootSession.directory,
      timeUpdated: recentTimeUpdated,
      totalTokens: recentTotalTokens,
      projectId: source.rootSession.projectId,
      repoKey,
    },
    sourceStamp,
    generatedAt,
    days,
    modelPerformanceSamples,
  };
}

export function rebuildDashboardSessionAtom(
  db: SqliteDatabase,
  rootSessionId: string,
  sourceStamp: DashboardSessionSourceStamp,
  generatedAt = new Date().toISOString(),
  startMs?: number,
  endMs?: number,
): DashboardSessionAtom | null {
  const source = readDashboardSessionAtomSource(db, rootSessionId, startMs ?? 0, endMs ?? 9999999999999);
  if (!source) {
    return null;
  }
  return buildDashboardSessionAtomFromSource(source, sourceStamp, generatedAt);
}

export function diffDashboardSessionAtoms(
  previous: DashboardSessionAtom | null,
  next: DashboardSessionAtom | null,
): DashboardSessionAtomDiff {
  const addedDays: DashboardSessionAtomDayDelta[] = [];
  const removedDays: DashboardSessionAtomDayDelta[] = [];
  const changedDays: DashboardSessionAtomDayDelta[] = [];

  const previousDays = previous?.days ?? new Map<string, DashboardSessionDayContribution>();
  const nextDays = next?.days ?? new Map<string, DashboardSessionDayContribution>();
  const allDays = new Set([...previousDays.keys(), ...nextDays.keys()]);

  for (const day of Array.from(allDays).sort()) {
    const previousContribution = previousDays.get(day) ?? null;
    const nextContribution = nextDays.get(day) ?? null;

    if (!previousContribution && nextContribution) {
      addedDays.push(
        createAtomDayDelta(
          day,
          null,
          nextContribution,
          cloneDayContribution(nextContribution),
        ),
      );
      continue;
    }

    if (previousContribution && !nextContribution) {
      removedDays.push(
        createAtomDayDelta(
          day,
          previousContribution,
          null,
          negateDayContribution(previousContribution),
        ),
      );
      continue;
    }

    if (!previousContribution || !nextContribution) {
      continue;
    }

    const delta = diffDayContribution(previousContribution, nextContribution);
    if (!isDayContributionZero(delta)) {
      changedDays.push(
        createAtomDayDelta(day, previousContribution, nextContribution, delta),
      );
    }
  }

  return {
    addedDays,
    removedDays,
    changedDays,
  };
}
