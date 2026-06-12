import type { DashboardSummaryContract } from "../../../../src/contracts/dashboard";
import { MetricCard } from "../../../components/ui/metric-card";
import { MetricGrid } from "../../../components/ui/metric-grid";
import { formatTokens } from "../_lib/formatters";

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.0001) return `$${cost.toExponential(2)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  if (cost < 1000) return `$${cost.toFixed(2)}`;
  return `$${(cost / 1000).toFixed(1)}K`;
}

export function SummaryMetrics({
  summary,
}: {
  summary: DashboardSummaryContract;
}) {
  const metrics = [
    {
      label: "Total Sessions",
      value: summary.totalSessions.toLocaleString(),
      sub: "main sessions only",
    },
    {
      label: "Total Tokens",
      value: formatTokens(summary.totalTokens),
      sub: "input + output + cache",
    },
    {
      label: "Total Cost",
      value: formatCost(summary.totalCost),
      sub: "session-level sum",
    },
    {
      label: "Active Projects",
      value: summary.activeProjects.toLocaleString(),
      sub: "distinct project IDs",
    },
  ];

  return (
    <MetricGrid>
      {metrics.map((m) => (
        <MetricCard key={m.label} label={m.label} value={m.value} sub={m.sub} />
      ))}
    </MetricGrid>
  );
}
