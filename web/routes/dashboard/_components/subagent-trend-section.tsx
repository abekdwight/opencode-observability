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
  DashboardSubagentTrendContract,
  DashboardViewContract,
} from "../../../../src/contracts/dashboard";
import { CHART_THEME } from "../../../lib/chart-theme";
import { flattenLineSeries, flattenStackBars } from "../_lib/chart-helpers";
import { formatAxisCount } from "../_lib/formatters";
import { ChartTooltipContent } from "./chart-tooltip-content";
import { ViewToggle } from "./view-toggle";

export function SubagentTrendSection({
  subagentTrend,
  view,
  dayCount,
  onToggleView,
}: {
  subagentTrend: DashboardSubagentTrendContract;
  view: DashboardViewContract;
  dayCount: number;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  const isSingleDay = dayCount === 1;
  const hourlySubtitle = isSingleDay
    ? "Showing hourly breakdown for selected day"
    : "Showing sum of hourly activity across selected days";

  if (view === "hourly") {
    const { data, keys } = flattenStackBars(subagentTrend.hourlyBars);
    return (
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--color-text-primary)]">
              Subagent Activity
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {hourlySubtitle}
            </p>
          </div>
          <ViewToggle view={view} onToggle={onToggleView} />
        </div>
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
                tickMargin={6}
                tickFormatter={formatAxisCount}
              />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend />
              {keys.map((k) => (
                <Bar
                  key={k.name}
                  dataKey={k.name}
                  stackId="sub"
                  fill={k.color}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    );
  }

  const flatData = flattenLineSeries(subagentTrend.dailySeries);

  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-[var(--color-text-primary)]">
          Subagent Activity
        </h2>
        <ViewToggle view={view} onToggle={onToggleView} />
      </div>
      {subagentTrend.dailySeries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No subagent data
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
              {subagentTrend.dailySeries.map((s) => (
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
