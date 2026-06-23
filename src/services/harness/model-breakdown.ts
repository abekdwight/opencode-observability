import type { HarnessTokenTotalsContract } from "../../contracts/harness.js";
import type { SessionModelTokenBreakdown } from "../../contracts/session.js";

type TokenSupport = {
  reasoning: boolean;
  cacheRead: boolean;
  cacheWrite: boolean;
  cost: boolean;
};

function sortRows(
  rows: SessionModelTokenBreakdown[],
): SessionModelTokenBreakdown[] {
  return rows.sort((left, right) => {
    if (right.totalTokens !== left.totalTokens) {
      return right.totalTokens - left.totalTokens;
    }
    return (
      left.scope.localeCompare(right.scope) ||
      left.agent.localeCompare(right.agent) ||
      left.providerId.localeCompare(right.providerId) ||
      left.modelId.localeCompare(right.modelId)
    );
  });
}

export function mergeModelTokenBreakdownRows(
  rows: SessionModelTokenBreakdown[],
): SessionModelTokenBreakdown[] {
  const grouped = new Map<string, SessionModelTokenBreakdown>();

  for (const row of rows) {
    const key = [row.scope, row.agent, row.providerId, row.modelId].join("::");
    const current = grouped.get(key);
    if (current) {
      current.messageCount += row.messageCount;
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.reasoningTokens += row.reasoningTokens;
      current.cacheReadTokens += row.cacheReadTokens;
      current.cacheWriteTokens += row.cacheWriteTokens;
      current.totalTokens += row.totalTokens;
      current.totalCost += row.totalCost;
      continue;
    }

    grouped.set(key, { ...row });
  }

  return sortRows([...grouped.values()]);
}

export function retargetModelTokenBreakdownRows(
  rows: SessionModelTokenBreakdown[],
  target: {
    scope: "main" | "subagent";
    agent: string;
    providerId?: string | null;
  },
): SessionModelTokenBreakdown[] {
  return rows.map((row) => ({
    ...row,
    scope: target.scope,
    agent: target.agent,
    providerId: target.providerId?.trim() || row.providerId || "unknown",
  }));
}

export function summarizeModelTokenBreakdown(
  rows: SessionModelTokenBreakdown[],
  support: TokenSupport,
): HarnessTokenTotalsContract {
  const totals = rows.reduce(
    (sum, row) => ({
      total: sum.total + row.totalTokens,
      input: sum.input + row.inputTokens,
      output: sum.output + row.outputTokens,
      reasoning: sum.reasoning + row.reasoningTokens,
      cacheRead: sum.cacheRead + row.cacheReadTokens,
      cacheWrite: sum.cacheWrite + row.cacheWriteTokens,
      cost: sum.cost + row.totalCost,
    }),
    {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    },
  );

  return {
    total: totals.total,
    input: totals.input,
    output: totals.output,
    reasoning: support.reasoning ? totals.reasoning : null,
    cacheRead: support.cacheRead ? totals.cacheRead : null,
    cacheWrite: support.cacheWrite ? totals.cacheWrite : null,
    cost: support.cost ? totals.cost : null,
  };
}
