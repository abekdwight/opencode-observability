import type {
  DashboardBarItemContract,
  DashboardLineSeriesContract,
  DashboardMcpUsageRowContract,
  DashboardSelectionContract,
  DashboardStackBarContract,
  DashboardToolReliabilityRowContract,
  DashboardToolsDataContract,
} from "../../../contracts/dashboard.js";
import type { DashboardSessionAtom } from "../aggregator/types.js";
import {
  buildDailyPoints,
  ERROR_TREND_COLORS,
  selectAtomsForWindow,
  selectedDayContributions,
  topNLabels,
} from "./shared.js";

interface ToolTotals {
  calls: number;
  errors: number;
  toolUsage: Map<string, number>;
  toolReliability: Map<string, { success: number; error: number }>;
  mcpUsage: Map<
    string,
    { server: string; calls: number; errors: number; isBuiltin: boolean }
  >;
  errorPatterns: Map<string, number>;
  errorsByToolDay: Map<string, number>; // "tool\tday" -> error count
  errorsByHour: number[]; // index 0..23
}

function accumulateTotals(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): ToolTotals {
  const totals: ToolTotals = {
    calls: 0,
    errors: 0,
    toolUsage: new Map(),
    toolReliability: new Map(),
    mcpUsage: new Map(),
    errorPatterns: new Map(),
    errorsByToolDay: new Map(),
    errorsByHour: new Array(24).fill(0),
  };

  for (const day of selectedDayContributions(atoms, selection.bounds)) {
    totals.calls += day.toolCalls;
    totals.errors += day.toolErrors;

    for (const [tool, count] of day.toolUsage) {
      totals.toolUsage.set(tool, (totals.toolUsage.get(tool) ?? 0) + count);
    }
    for (const [tool, reliability] of day.toolReliability) {
      let entry = totals.toolReliability.get(tool);
      if (!entry) {
        entry = { success: 0, error: 0 };
        totals.toolReliability.set(tool, entry);
      }
      entry.success += reliability.success;
      entry.error += reliability.error;
    }
    for (const [server, mcp] of day.mcpUsage) {
      let entry = totals.mcpUsage.get(server);
      if (!entry) {
        entry = {
          server: mcp.server,
          calls: 0,
          errors: 0,
          isBuiltin: mcp.isBuiltin,
        };
        totals.mcpUsage.set(server, entry);
      }
      entry.calls += mcp.calls;
      entry.errors += mcp.errors;
    }
    for (const [label, count] of day.errorPatterns) {
      totals.errorPatterns.set(
        label,
        (totals.errorPatterns.get(label) ?? 0) + count,
      );
    }
    for (const [tool, count] of day.toolErrorsByTool) {
      const key = `${tool}\t${day.day}`;
      totals.errorsByToolDay.set(
        key,
        (totals.errorsByToolDay.get(key) ?? 0) + count,
      );
    }
    for (const [hour, count] of day.toolErrorsByHour) {
      totals.errorsByHour[Number(hour)] += count;
    }
  }

  return totals;
}

function buildToolUsage(totals: ToolTotals): DashboardBarItemContract[] {
  return Array.from(totals.toolUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ label: tool || "(unknown)", count }));
}

function buildToolReliabilityMatrix(
  totals: ToolTotals,
): DashboardToolReliabilityRowContract[] {
  const rows = Array.from(totals.toolReliability.entries())
    .map(([tool, { success, error }]) => ({
      tool,
      success,
      error,
      total: success + error,
      errorRate: success + error > 0 ? (error / (success + error)) * 100 : 0,
    }))
    .sort((a, b) => b.error - a.error);

  const top = rows.slice(0, 15);
  const rest = rows.slice(15);
  if (rest.length > 0) {
    const other = rest.reduce(
      (acc, row) => ({
        tool: "Other",
        success: acc.success + row.success,
        error: acc.error + row.error,
        total: acc.total + row.total,
        errorRate: 0,
      }),
      { tool: "Other", success: 0, error: 0, total: 0, errorRate: 0 },
    );
    other.errorRate = other.total > 0 ? (other.error / other.total) * 100 : 0;
    top.push(other);
  }
  return top;
}

function buildMcpUsage(totals: ToolTotals): DashboardMcpUsageRowContract[] {
  const byServer = new Map<string, { calls: number; errors: number }>();
  for (const entry of totals.mcpUsage.values()) {
    byServer.set(entry.server, { calls: entry.calls, errors: entry.errors });
  }

  const builtin = byServer.get("builtin") ?? { calls: 0, errors: 0 };
  byServer.delete("builtin");

  const sorted = Array.from(byServer.entries()).sort(
    (a, b) => b[1].calls - a[1].calls,
  );
  const serverRows = sorted.slice(0, 10);
  const other = sorted.slice(10).reduce(
    (acc, [, entry]) => ({
      calls: acc.calls + entry.calls,
      errors: acc.errors + entry.errors,
    }),
    { calls: 0, errors: 0 },
  );
  if (other.calls > 0) {
    serverRows.push(["Other", other]);
  }

  const rows: DashboardMcpUsageRowContract[] = [
    {
      server: "Builtin Tools",
      calls: builtin.calls,
      errors: builtin.errors,
      errorRate: builtin.calls > 0 ? (builtin.errors / builtin.calls) * 100 : 0,
      isBuiltin: true,
    },
    ...serverRows.map(([server, entry]) => ({
      server,
      calls: entry.calls,
      errors: entry.errors,
      errorRate: entry.calls > 0 ? (entry.errors / entry.calls) * 100 : 0,
      isBuiltin: false,
    })),
  ];

  return rows.some((row) => row.calls > 0) ? rows : [];
}

function buildErrorPatterns(totals: ToolTotals): DashboardBarItemContract[] {
  return Array.from(totals.errorPatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

function buildErrorTrendSeries(
  totals: ToolTotals,
  selection: DashboardSelectionContract,
): DashboardLineSeriesContract[] {
  const errorTotalsByTool = new Map<string, number>();
  for (const [key, count] of totals.errorsByToolDay) {
    const tool = key.slice(0, key.lastIndexOf("\t"));
    errorTotalsByTool.set(tool, (errorTotalsByTool.get(tool) ?? 0) + count);
  }

  const topTools = topNLabels(errorTotalsByTool, 5);
  const topToolSet = new Set(topTools);

  const seriesMaps = new Map<string, Map<string, number>>(
    [...topTools, "Other"].map((tool) => [tool, new Map<string, number>()]),
  );
  for (const [key, count] of totals.errorsByToolDay) {
    const separator = key.lastIndexOf("\t");
    const tool = key.slice(0, separator);
    const day = key.slice(separator + 1);
    const seriesKey = topToolSet.has(tool) ? tool : "Other";
    const dayMap = seriesMaps.get(seriesKey);
    if (dayMap) dayMap.set(day, (dayMap.get(day) ?? 0) + count);
  }

  const seriesOrder = [
    ...topTools,
    ...(seriesMaps.get("Other")?.size ? ["Other"] : []),
  ];

  return seriesOrder.map((tool, index) => ({
    label: tool,
    color: ERROR_TREND_COLORS[index] ?? "#86868b",
    points: buildDailyPoints(
      seriesMaps.get(tool) ?? new Map(),
      selection.bounds,
    ),
  }));
}

function buildErrorTrendHourlyBars(
  totals: ToolTotals,
): DashboardStackBarContract[] {
  if (!totals.errorsByHour.some((value) => value > 0)) {
    return [];
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    label: String(hour).padStart(2, "0"),
    stacks:
      totals.errorsByHour[hour] > 0
        ? [
            {
              name: "Errors",
              value: totals.errorsByHour[hour],
              color: ERROR_TREND_COLORS[0],
            },
          ]
        : [],
  }));
}

export function projectTools(
  atoms: Iterable<DashboardSessionAtom>,
  selection: DashboardSelectionContract,
): DashboardToolsDataContract {
  const selectedAtoms = selectAtomsForWindow(atoms, selection.bounds);
  const totals = accumulateTotals(selectedAtoms, selection);

  const toolErrorRate =
    totals.calls > 0
      ? `${((totals.errors / totals.calls) * 100).toFixed(1)}%`
      : "0.0%";

  const isHourly = selection.view === "hourly";

  return {
    totalToolCalls: totals.calls,
    toolErrors: totals.errors,
    toolErrorRate,
    toolUsage: buildToolUsage(totals),
    toolReliabilityMatrix: buildToolReliabilityMatrix(totals),
    mcpUsage: buildMcpUsage(totals),
    errorPatterns: buildErrorPatterns(totals),
    errorTrendSeries: isHourly ? [] : buildErrorTrendSeries(totals, selection),
    errorTrendHourlyBars: isHourly ? buildErrorTrendHourlyBars(totals) : [],
  };
}
