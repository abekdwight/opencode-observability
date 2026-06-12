import { classifyTool } from "../../../lib/analytics.js";
import { resolveRepoBucketKey } from "../../../lib/repo-root.js";
import type {
  DashboardAtomMessageRow,
  DashboardAtomPartRow,
  DashboardRootSource,
} from "../../../repositories/dashboard/dashboard-queries.js";
import type {
  DashboardDayContribution,
  DashboardMcpUsageTotals,
  DashboardModelPerformanceSample,
  DashboardModelTokenTotals,
  DashboardSessionAtom,
  DashboardSourceStamp,
  DashboardToolReliabilityTotals,
} from "./types.js";

// classifyError: maps a raw tool error string into a coarse failure category.
// Order matters — earlier patterns win. Preserved verbatim from the prior
// dashboard service so error-pattern counts stay identical.
export function classifyError(error: string): string {
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

function incrementMap(
  map: Map<string, number>,
  key: string,
  value: number,
): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

function createEmptyDayContribution(day: string): DashboardDayContribution {
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
    toolCalls: 0,
    toolErrors: 0,
    errorPatterns: new Map(),
    toolErrorsByHour: new Map(),
    toolErrorsByTool: new Map(),
    mcpUsage: new Map(),
    toolReliability: new Map(),
    toolUsage: new Map(),
    modelCounts: new Map(),
    modelTokenTotals: new Map(),
    agentCounts: new Map(),
    subagentByHour: new Map(),
    repoSessionCount: 0,
    repoActiveDurationMs: 0,
  };
}

function ensureDay(
  days: Map<string, DashboardDayContribution>,
  day: string,
): DashboardDayContribution {
  let contribution = days.get(day);
  if (!contribution) {
    contribution = createEmptyDayContribution(day);
    days.set(day, contribution);
  }
  return contribution;
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

function createEmptyPerformanceSample(
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

function applyMessage(
  atom: { days: Map<string, DashboardDayContribution> },
  performanceSamples: Map<string, DashboardModelPerformanceSample>,
  message: DashboardAtomMessageRow,
  previousMessageTs: number | null,
): number {
  // Only assistant messages carry tokens/models/agents. Returns the message's
  // total tokens so the caller can accumulate recentMeta.totalTokens.
  // previousMessageTs is the prior message of ANY role in the same session, so
  // repoActiveDurationMs measures the gap leading into this assistant turn.
  if (message.role !== "assistant") {
    return 0;
  }

  const day = ensureDay(atom.days, message.day);
  const input = Number(message.inputTokens) || 0;
  const output = Number(message.outputTokens) || 0;
  const cacheRead = Number(message.cacheReadTokens) || 0;
  const cacheWrite = Number(message.cacheWriteTokens) || 0;
  const reasoning = Number(message.reasoningTokens) || 0;
  const total = Number(message.totalTokens) || 0;

  incrementMap(day.tokenInputByHour, message.hour, input);
  incrementMap(day.tokenOutputByHour, message.hour, output);
  day.tokenTotals.input += input;
  day.tokenTotals.output += output;
  day.tokenTotals.cacheRead += cacheRead;
  day.tokenTotals.cacheWrite += cacheWrite;
  day.tokenTotals.reasoning += reasoning;
  day.tokenTotals.total += total;

  if (previousMessageTs != null) {
    day.repoActiveDurationMs += Math.max(
      0,
      message.timeCreated - previousMessageTs,
    );
  }

  if (message.agent) {
    incrementMap(day.agentCounts, message.agent, 1);
    incrementMap(day.subagentByHour, `${message.agent}\t${message.hour}`, 1);
  }

  if (message.model) {
    incrementMap(day.modelCounts, message.model, 1);

    const provider = message.provider || "unknown";
    const modelKey = `${message.model}\t${provider}`;
    let tokenTotals = day.modelTokenTotals.get(modelKey);
    if (!tokenTotals) {
      tokenTotals = createEmptyModelTokenTotals(message.model, provider);
      day.modelTokenTotals.set(modelKey, tokenTotals);
    }
    tokenTotals.inputTokens += input;
    tokenTotals.outputTokens += output;
    tokenTotals.cacheReadTokens += cacheRead;
    tokenTotals.cacheWriteTokens += cacheWrite;
    tokenTotals.nonCacheInputTokens += input;
    tokenTotals.inputTotalTokens += input + cacheRead + cacheWrite;
    tokenTotals.totalTokens += total;

    let sample = performanceSamples.get(modelKey);
    if (!sample) {
      sample = createEmptyPerformanceSample(message.model, provider);
      performanceSamples.set(modelKey, sample);
    }
    sample.totalMessages += 1;
    sample.outputTokens += output;
    sample.reasoningTokens += reasoning;

    const durationMs = Number(message.durationMs) || 0;
    // A message is latency-valid when it has a positive completion duration,
    // and TPS-valid only when it ALSO produced output tokens.
    if (durationMs > 0) {
      sample.validLatencyMessages += 1;
      sample.latencySamplesMs.push(durationMs);
    }
    if (durationMs > 0 && output > 0) {
      sample.validTpsMessages += 1;
      sample.sumOutputTokens += output;
      sample.sumDurationMs += durationMs;
      sample.tpsSamples.push((output * 1000) / durationMs);
    }
  }

  return total;
}

function applyPart(
  days: Map<string, DashboardDayContribution>,
  part: DashboardAtomPartRow,
): void {
  const day = ensureDay(days, part.day);
  const toolName = part.tool ?? "unknown";
  const status = part.status ?? "unknown";
  const isError = status === "error";

  day.toolCalls += 1;
  incrementMap(day.toolUsage, toolName, 1);
  if (isError) {
    day.toolErrors += 1;
    incrementMap(day.errorPatterns, classifyError(part.error ?? ""), 1);
    incrementMap(day.toolErrorsByHour, part.hour, 1);
    incrementMap(day.toolErrorsByTool, toolName, 1);
  }

  let reliability = day.toolReliability.get(toolName);
  if (!reliability) {
    reliability = {
      tool: toolName,
      success: 0,
      error: 0,
      total: 0,
    } satisfies DashboardToolReliabilityTotals;
    day.toolReliability.set(toolName, reliability);
  }
  if (isError) {
    reliability.error += 1;
  } else {
    reliability.success += 1;
  }
  reliability.total += 1;

  // MCP classification: builtin tools roll up under "builtin"; everything else
  // groups by its extracted server name.
  const { type, mcpServer } = classifyTool(toolName);
  const server = type === "builtin" ? "builtin" : (mcpServer ?? "other");
  let mcpUsage = day.mcpUsage.get(server);
  if (!mcpUsage) {
    mcpUsage = {
      server,
      calls: 0,
      errors: 0,
      isBuiltin: type === "builtin",
    } satisfies DashboardMcpUsageTotals;
    day.mcpUsage.set(server, mcpUsage);
  }
  mcpUsage.calls += 1;
  if (isError) {
    mcpUsage.errors += 1;
  }
}

export function buildSessionAtom(
  source: DashboardRootSource,
  sourceStamp: DashboardSourceStamp,
): DashboardSessionAtom {
  const days = new Map<string, DashboardDayContribution>();
  const modelPerformanceSamples = new Map<
    string,
    DashboardModelPerformanceSample
  >();

  // The root session itself contributes one session count on its created day,
  // and one repo-session count toward its repository bucket.
  const repoKey = resolveRepoBucketKey(
    source.root.worktree ?? "",
    source.root.directory,
  );
  const rootDay = ensureDay(days, source.root.day);
  rootDay.rootSessionCount += 1;
  rootDay.repoSessionCount += 1;

  let recentTotalTokens = 0;
  // The previous message timestamp is tracked per descendant session across ALL
  // roles so the inter-message gap (repoActiveDurationMs) spans user->assistant
  // turns, matching the legacy active-repos computation.
  const previousMessageTsBySession = new Map<string, number>();
  for (const message of source.messages) {
    const previousMessageTs =
      previousMessageTsBySession.get(message.sessionId) ?? null;
    previousMessageTsBySession.set(message.sessionId, message.timeCreated);
    recentTotalTokens += applyMessage(
      { days },
      modelPerformanceSamples,
      message,
      previousMessageTs,
    );
  }

  for (const part of source.parts) {
    applyPart(days, part);
  }

  // recentMeta.timeUpdated reflects the freshest activity across the root's
  // session/message/part rows (so "recently updated" tracks real edits, not
  // just the session.time_updated column which may lag message writes).
  const recentTimeUpdated = Math.max(
    source.root.timeUpdated,
    sourceStamp.sessionMaxUpdatedAt,
    sourceStamp.messageMaxUpdatedAt,
    sourceStamp.partMaxUpdatedAt,
  );

  return {
    rootSessionId: source.root.id,
    projectId: source.root.projectId,
    repoKey,
    recentMeta: {
      id: source.root.id,
      title: source.root.title,
      directory: source.root.directory,
      timeUpdated: recentTimeUpdated,
      totalTokens: recentTotalTokens,
    },
    sourceStamp,
    days,
    modelPerformanceSamples,
  };
}
