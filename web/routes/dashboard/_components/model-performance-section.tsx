import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardModelPerformanceStatsRowContract } from "../../../../src/contracts/dashboard";
import {
  Tooltip as RadixTooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { CHART_THEME } from "../../../lib/chart-theme";
import { cn } from "../../../lib/cn";
import {
  formatAxisTps,
  formatDeviation,
  formatLatencySeconds,
  formatModelTickLabel,
  formatNullableMetric,
  formatPercentRatio,
  quantileNumber,
} from "../_lib/formatters";

/* ── Header column with info tooltip ── */

function ModelPerformanceHeaderHelp({
  label,
  tooltip,
  align = "left",
}: {
  label: string;
  tooltip: string;
  align?: "left" | "right";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        align === "right" && "justify-end",
      )}
    >
      <span className="model-performance-th-label">{label}</span>
      <RadixTooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="model-performance-info-btn inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            aria-label={`${label} help`}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              focusable="false"
              aria-hidden="true"
            >
              <circle
                cx="8"
                cy="8"
                r="6.75"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
              />
              <path
                d="M7.25 6.25h1.5V12h-1.5zM8 4.05a.95.95 0 1 1 0 1.9.95.95 0 0 1 0-1.9Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="model-performance-tooltip max-w-xs"
        >
          {tooltip}
        </TooltipContent>
      </RadixTooltip>
    </span>
  );
}

export function ModelPerformanceSection({
  rows,
}: {
  rows: DashboardModelPerformanceStatsRowContract[];
}) {
  const [mode, setMode] = React.useState<"table" | "chart">("table");

  const sortedRows = React.useMemo(() => {
    const next = rows.filter((row) => row.validTpsMessages > 0);
    next.sort((a, b) => {
      const hasPrimaryA = a.tpsP50 != null ? 1 : 0;
      const hasPrimaryB = b.tpsP50 != null ? 1 : 0;
      if (hasPrimaryA !== hasPrimaryB) return hasPrimaryB - hasPrimaryA;

      const scoreA = a.tpsP50 ?? a.avgTps ?? -1;
      const scoreB = b.tpsP50 ?? b.avgTps ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;

      if (a.validityRatio !== b.validityRatio) {
        return b.validityRatio - a.validityRatio;
      }

      if (a.validTpsMessages !== b.validTpsMessages) {
        return b.validTpsMessages - a.validTpsMessages;
      }

      return a.model.localeCompare(b.model);
    });
    return next;
  }, [rows]);

  const chartRows = React.useMemo(() => {
    return sortedRows
      .slice(0, 10)
      .map((row) => {
        const tps = row.tpsP50 ?? row.avgTps;
        if (tps == null) return null;

        const lowCandidate = row.tpsP10 ?? row.avgTps ?? tps;
        const highCandidate = row.tpsP90 ?? row.avgTps ?? tps;
        const low = Math.min(tps, lowCandidate);
        const high = Math.max(tps, highCandidate);

        return {
          label: row.model,
          provider: row.provider,
          tps,
          low,
          high,
          weighted: row.avgTps,
          deviation: formatDeviation(row.tpsP10, row.tpsP90),
        };
      })
      .filter(
        (
          row,
        ): row is {
          label: string;
          provider: string;
          tps: number;
          low: number;
          high: number;
          weighted: number | null;
          deviation: string;
        } => row != null,
      );
  }, [sortedRows]);

  const chartView = React.useMemo(() => {
    if (chartRows.length === 0) {
      return {
        data: [] as Array<{
          label: string;
          provider: string;
          tps: number;
          weighted: number | null;
          deviation: string;
          error: [number, number];
          clipped: boolean;
        }>,
        yMax: 10,
      };
    }

    const upperBounds = chartRows.map((row) => row.high);
    const maxTps = Math.max(...chartRows.map((row) => row.tps), 1);
    const robustUpper = quantileNumber(upperBounds, 0.9);
    const yMax = Math.max(maxTps * 1.25, robustUpper * 1.1, 10);

    const data = chartRows.map((row) => {
      const clippedUpper = Math.min(row.high, yMax);
      return {
        label: row.label,
        provider: row.provider,
        tps: row.tps,
        weighted: row.weighted,
        deviation: row.deviation,
        error: [
          Math.max(0, row.tps - row.low),
          Math.max(0, clippedUpper - row.tps),
        ] as [number, number],
        clipped: row.high > yMax,
      };
    });

    return {
      data,
      yMax: Number(yMax.toFixed(2)),
    };
  }, [chartRows]);

  if (sortedRows.length === 0) {
    return (
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
          Model Performance (TPS)
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No model performance data
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
        Model Performance (TPS)
      </h2>
      <div className="mb-2 flex justify-end">
        <div
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-0.5"
          role="tablist"
          aria-label="Model performance view"
        >
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === "table"
                ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
            onClick={() => setMode("table")}
            aria-pressed={mode === "table"}
          >
            Table
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === "chart"
                ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
            onClick={() => setMode("chart")}
            aria-pressed={mode === "chart"}
          >
            Chart
          </button>
        </div>
      </div>

      {mode === "table" ? (
        <div className="model-performance-table-scroll overflow-x-auto">
          <table className="model-performance-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="pb-2 text-left text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="Model"
                    tooltip="Model and provider are shown together in one cell."
                  />
                </th>
                <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="TPS"
                    tooltip="Primary throughput uses P50 when available; the asterisk marks weighted-average fallback."
                    align="right"
                  />
                </th>
                <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="Deviation"
                    tooltip="Observed spread from P10-P90, shown as sigma approx (P90-P10)/2.56."
                    align="right"
                  />
                </th>
                <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="Latency"
                    tooltip="Latency at P50 / P90 / P99."
                    align="right"
                  />
                </th>
                <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="Weighted TPS"
                    tooltip="Weighted average throughput (sum of output / sum of duration)."
                    align="right"
                  />
                </th>
                <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="Validity"
                    tooltip="Valid TPS messages divided by total messages."
                    align="right"
                  />
                </th>
                <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                  <ModelPerformanceHeaderHelp
                    label="Thinking"
                    tooltip="Thinking share based on reasoning tokens."
                    align="right"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const primaryTps = row.tpsP50 ?? row.avgTps;
                const isFallback = row.tpsP50 == null && row.avgTps != null;

                return (
                  <tr
                    key={`${row.model}-${row.provider}`}
                    className="border-b border-[var(--color-border-faint)]"
                  >
                    <td
                      className="max-w-[200px] truncate py-1.5 pr-2 font-mono text-xs"
                      title={`${row.model} · ${row.provider}`}
                    >
                      {row.model} · {row.provider}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs">
                      <span className="inline-flex items-center gap-0.5">
                        {isFallback ? (
                          <span
                            className="model-performance-fallback text-[var(--color-text-tertiary)]"
                            title="P50 unavailable — showing weighted average"
                          >
                            *
                          </span>
                        ) : null}
                        <span className="model-performance-primary-value font-semibold">
                          {formatNullableMetric(primaryTps)}
                        </span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                      {formatDeviation(row.tpsP10, row.tpsP90)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                      {formatLatencySeconds(row.latencyP50Ms)} /{" "}
                      {formatLatencySeconds(row.latencyP90Ms)} /{" "}
                      {formatLatencySeconds(row.latencyP99Ms)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                      {formatNullableMetric(row.avgTps)}
                    </td>
                    <td
                      className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]"
                      title={`latency valid: ${row.validLatencyMessages.toLocaleString()}`}
                    >
                      {formatPercentRatio(row.validityRatio)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                      {formatPercentRatio(row.reasoningShare)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={chartView.data}
              margin={{ top: 10, right: 12, left: -8, bottom: 54 }}
              barCategoryGap="16%"
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
                interval={0}
                angle={-16}
                textAnchor="end"
                height={58}
                tickFormatter={(value) => formatModelTickLabel(String(value))}
              />
              <YAxis
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
                tickMargin={6}
                tickFormatter={formatAxisTps}
                domain={[0, chartView.yMax]}
              />
              <Tooltip
                formatter={(value, name, item) => {
                  const numeric = Number(value);
                  if (name === "TPS") {
                    return [formatNullableMetric(numeric), name];
                  }
                  if (name === "Weighted TPS") {
                    const v =
                      typeof item?.payload?.weighted === "number"
                        ? item.payload.weighted
                        : null;
                    return [formatNullableMetric(v), name];
                  }
                  return [String(value), name];
                }}
                labelFormatter={(label, payload) => {
                  const provider = payload?.[0]?.payload?.provider as
                    | string
                    | undefined;
                  const deviation = payload?.[0]?.payload?.deviation as
                    | string
                    | undefined;
                  const clipped = payload?.[0]?.payload?.clipped as
                    | boolean
                    | undefined;
                  const suffix = clipped ? " (cap)" : "";
                  const metric =
                    deviation && deviation !== "\u2014"
                      ? ` / deviation ${deviation}`
                      : "";
                  return provider
                    ? `${label} · ${provider}${metric}${suffix}`
                    : `${String(label)}${metric}${suffix}`;
                }}
              />
              <Bar
                dataKey="tps"
                name="TPS"
                fill={CHART_THEME.colors.success}
                radius={[5, 5, 0, 0]}
                maxBarSize={20}
              >
                <ErrorBar
                  dataKey="error"
                  direction="y"
                  width={3}
                  stroke="#4f4f54"
                  strokeWidth={1.2}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
