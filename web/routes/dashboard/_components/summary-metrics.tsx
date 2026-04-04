import type { DashboardContract } from "../../../../src/contracts/dashboard";
import { MetricCard } from "../../../components/ui/metric-card";
import { MetricGrid } from "../../../components/ui/metric-grid";
import { formatTokens } from "../_lib/formatters";

export function SummaryMetrics({ data }: { data: DashboardContract }) {
  const { summary } = data;
  const metrics = [
    {
      label: "Total Sessions",
      value: summary.totalSessions.toLocaleString(),
      sub: "main sessions only",
    },
    {
      label: "Total Tokens",
      value: formatTokens(summary.totalTokens),
      sub: "assistant messages",
    },
    {
      label: "Tool Calls",
      value: summary.totalToolCalls.toLocaleString(),
      sub: "all sessions",
    },
    {
      label: "Tool Error Rate",
      value: summary.toolErrorRate,
      sub: `${summary.toolErrors.toLocaleString()} errors`,
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
        <MetricCard
          key={m.label}
          label={m.label}
          value={m.value}
          sub={m.sub}
        />
      ))}
    </MetricGrid>
  );
}
