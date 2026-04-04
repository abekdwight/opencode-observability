import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DashboardLineSeriesContract,
  DashboardStackBarContract,
  DashboardViewContract,
} from "../../../../src/contracts/dashboard";
import { CHART_THEME } from "../../../lib/chart-theme";
import { flattenLineSeries, flattenStackBars } from "../_lib/chart-helpers";
import { formatAxisCount } from "../_lib/formatters";
import { ChartTooltipContent } from "./chart-tooltip-content";

export function ErrorTrendSection({
  series,
  hourlyBars,
  view,
  onToggleView,
}: {
  series: DashboardLineSeriesContract[];
  hourlyBars: DashboardStackBarContract[];
  view: DashboardViewContract;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  const flatData = React.useMemo(() => flattenLineSeries(series), [series]);
  const hourlyData = React.useMemo(
    () => flattenStackBars(hourlyBars),
    [hourlyBars],
  );

  if (view === "hourly") {
    const { data, keys } = hourlyData;

    return (
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">
            Error Daily Trend
          </h2>
          <button
            type="button"
            className="border-none bg-transparent text-sm font-medium text-[var(--color-accent)] hover:underline"
            onClick={() => onToggleView("daily")}
          >
            View daily &rarr;
          </button>
        </div>
        {hourlyBars.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)]">
            No error data
          </p>
        ) : (
          <div className="overflow-x-auto">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={CHART_THEME.axis.gridColor}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: CHART_THEME.axis.fontSize }}
                  stroke={CHART_THEME.axis.tickColor}
                  tickMargin={6}
                />
                <YAxis
                  tick={{ fontSize: CHART_THEME.axis.fontSize }}
                  stroke={CHART_THEME.axis.tickColor}
                  allowDecimals={false}
                  tickMargin={6}
                  tickFormatter={formatAxisCount}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
                {keys.map((k) => (
                  <Bar
                    key={k.name}
                    dataKey={k.name}
                    stackId="error"
                    fill={k.color}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-[var(--color-text-primary)]">
          Error Daily Trend
        </h2>
        <button
          type="button"
          className="border-none bg-transparent text-sm font-medium text-[var(--color-accent)] hover:underline"
          onClick={() => onToggleView("hourly")}
        >
          View hourly &rarr;
        </button>
      </div>
      {series.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No error data
        </p>
      ) : (
        <div className="overflow-x-auto">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={flatData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={CHART_THEME.axis.gridColor}
              />
              <XAxis
                dataKey="day"
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
                tickMargin={6}
              />
              <YAxis
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
                allowDecimals={false}
                tickMargin={6}
                tickFormatter={formatAxisCount}
              />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend />
              {series.map((s) => (
                <Line
                  key={s.label}
                  type="linear"
                  dataKey={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
