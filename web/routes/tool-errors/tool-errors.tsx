import { Link, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ToolErrorsContract,
  ToolErrorsOverviewContract,
} from "../../../src/contracts/tool-errors";
import { MetricCard } from "../../components/ui/metric-card";
import { MetricGrid } from "../../components/ui/metric-grid";
import { useJson } from "../../hooks/use-json";
import { CHART_THEME } from "../../lib/chart-theme";
import { formatDatePrecise } from "../../lib/format";

function formatAxisCount(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString();
}

export function ToolErrors() {
  const { tool } = useParams<{ tool: string }>();
  if (tool) {
    return <ToolErrorsDetail tool={tool} />;
  }
  return <ToolErrorsOverview />;
}

function ToolErrorsOverview() {
  const { data, error, loading } =
    useJson<ToolErrorsOverviewContract>("/api/tool-errors");

  return (
    <section className="grid gap-2.5">
      <nav className="mb-4 text-[0.85em] text-[var(--color-text-secondary)]">
        <Link to="/" className="text-[var(--color-accent)]">
          &larr; Dashboard
        </Link>
      </nav>

      {loading ? (
        <p
          className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading tool errors...
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Failed to load tool errors: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <h2 className="m-0 text-[1.35em] font-bold">
              Tool Errors Overview
            </h2>
            <p className="mt-1 text-[0.85em] text-[var(--color-text-secondary)]">
              Past {data.windowDays} days
            </p>
            <MetricGrid className="mt-3">
              <MetricCard
                label="Total Errors"
                value={data.summary.totalErrors.toLocaleString()}
              />
              <MetricCard
                label="Affected Tools"
                value={data.summary.distinctTools.toLocaleString()}
              />
              <MetricCard
                label="Affected Sessions"
                value={data.summary.affectedSessions.toLocaleString()}
              />
            </MetricGrid>

            <ul className="mt-2.5 list-disc pl-4 text-sm text-[var(--color-text-secondary)]">
              {data.insights.map((insight) => (
                <li key={insight} className="mb-1.5">
                  {insight}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <h3 className="m-0 mb-3 text-base font-bold">Top Failing Tools</h3>
            {data.topTools.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Tool
                      </th>
                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Errors
                      </th>
                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Calls
                      </th>
                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Error Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topTools.map((row) => (
                      <tr
                        key={row.tool}
                        className="border-b border-[var(--color-border-faint)]"
                      >
                        <td className="py-2.5 px-3">
                          <Link
                            to={`/tool-errors/${encodeURIComponent(row.tool)}`}
                          >
                            {row.tool}
                          </Link>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {row.errorCount.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {row.totalCalls.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {row.errorRate.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                No tool errors recorded in this window
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <h3 className="m-0 mb-3 text-base font-bold">Error Patterns</h3>
            {data.errorPatterns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Pattern
                      </th>
                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errorPatterns.map((row) => (
                      <tr
                        key={row.label}
                        className="border-b border-[var(--color-border-faint)]"
                      >
                        <td className="py-2.5 px-3">{row.label}</td>
                        <td className="py-2.5 px-3 text-right">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                No recurring patterns found
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <h3 className="m-0 mb-3 text-base font-bold">Latest Errors</h3>
            {data.latestErrors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="w-48 whitespace-nowrap text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Datetime
                      </th>
                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Tool
                      </th>
                      <th className="w-56 text-left font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Session
                      </th>
                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Error Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latestErrors.map((row) => (
                      <tr
                        key={`${row.tool}-${row.sessionId}-${row.timeCreated}`}
                        className="border-b border-[var(--color-border-faint)]"
                      >
                        <td className="w-48 whitespace-nowrap py-2.5 px-3">
                          {formatDatePrecise(row.timeCreated)}
                        </td>
                        <td className="py-2.5 px-3">
                          <Link
                            to={`/tool-errors/${encodeURIComponent(row.tool)}`}
                          >
                            {row.tool}
                          </Link>
                        </td>
                        <td className="w-56 py-2.5 px-3 font-mono text-xs">
                          <Link
                            to={`/sessions/opencode/${encodeURIComponent(row.sessionId)}`}
                          >
                            {row.sessionId}
                          </Link>
                        </td>
                        <td className="whitespace-pre-wrap break-words py-2.5 px-3">
                          {row.error || "(no message)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                No recent errors
              </p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function ToolErrorsDetail({ tool }: { tool: string }) {
  const { data, error, loading } = useJson<ToolErrorsContract>(
    `/api/tool-errors/${encodeURIComponent(tool)}`,
  );

  return (
    <section className="grid gap-2.5">
      <nav className="mb-4 text-[0.85em] text-[var(--color-text-secondary)]">
        <Link to="/" className="text-[var(--color-accent)]">
          Dashboard
        </Link>
        <span className="mx-1.5">/</span>
        <Link to="/tool-errors" className="text-[var(--color-accent)]">
          Tool errors
        </Link>
        <span className="mx-1.5">/</span>
        <span>{tool}</span>
      </nav>

      {loading ? (
        <p
          className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading tool errors...
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Failed to load tool errors: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <h2 className="m-0 text-[1.35em] font-bold">
              Tool Errors: {data.tool}
            </h2>
            <p className="mt-1 text-[0.85em] text-[var(--color-text-secondary)]">
              Error timeline for the past 30 days
            </p>
            <div className="mt-3 overflow-x-auto pb-1">
              <ErrorTimelineChart
                data={data.dailyErrorCounts}
                toolName={data.tool}
              />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <h3 className="m-0 mb-3 text-base font-bold">Latest 200 Errors</h3>
            {data.latestErrors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="w-48 whitespace-nowrap text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Datetime
                      </th>
                      <th className="w-56 text-left font-mono text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Session
                      </th>
                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2">
                        Error Message
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latestErrors.map((row) => (
                      <tr
                        key={`${row.sessionId}-${row.timeCreated}`}
                        className="border-b border-[var(--color-border-faint)]"
                      >
                        <td className="w-48 whitespace-nowrap py-2.5 px-3">
                          {formatDatePrecise(row.timeCreated)}
                        </td>
                        <td className="w-56 py-2.5 px-3 font-mono text-xs">
                          <Link
                            to={`/sessions/opencode/${encodeURIComponent(row.sessionId)}`}
                          >
                            {row.sessionId}
                          </Link>
                        </td>
                        <td className="whitespace-pre-wrap break-words py-2.5 px-3">
                          {row.error || "(no message)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                No errors recorded for this tool
              </p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function ErrorTimelineChart({
  data,
  toolName,
}: {
  data: ToolErrorsContract["dailyErrorCounts"];
  toolName: string;
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        No timeline data available
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={CHART_THEME.axis.gridColor}
        />
        <XAxis
          dataKey="day"
          tick={{
            fontSize: CHART_THEME.axis.fontSize,
            fill: CHART_THEME.axis.tickColor,
          }}
          tickFormatter={(d: string) => d.slice(5)}
          tickMargin={6}
        />
        <YAxis
          allowDecimals={false}
          tick={{
            fontSize: CHART_THEME.axis.fontSize,
            fill: CHART_THEME.axis.tickColor,
          }}
          tickMargin={6}
          tickFormatter={formatAxisCount}
        />
        <Tooltip
          formatter={(value) => formatAxisCount(Number(value))}
          contentStyle={{
            backgroundColor: CHART_THEME.tooltip.backgroundColor,
            color: CHART_THEME.tooltip.textColor,
            borderRadius: CHART_THEME.tooltip.borderRadius,
            fontSize: CHART_THEME.tooltip.fontSize,
            border: "none",
          }}
        />
        <Line
          type="monotone"
          dataKey="count"
          name={`${toolName} errors`}
          stroke="#d32f2f"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
