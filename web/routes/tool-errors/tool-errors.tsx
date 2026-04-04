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
    <section className="surface">
      <div className="breadcrumb">
        <Link to="/">&larr; Dashboard</Link>
      </div>

      {loading ? (
        <p className="state" data-testid="route-loading">
          Loading tool errors...
        </p>
      ) : null}

      {error ? (
        <p className="state state-error" data-testid="route-error">
          Failed to load tool errors: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="card">
            <h2 className="tool-errors-title">Tool Errors Overview</h2>
            <p className="tool-errors-subtitle">Past {data.windowDays} days</p>
            <div className="metrics-grid">
              <article className="metric-card">
                <p className="metric-label">Total Errors</p>
                <p className="metric-value">
                  {data.summary.totalErrors.toLocaleString()}
                </p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Affected Tools</p>
                <p className="metric-value">
                  {data.summary.distinctTools.toLocaleString()}
                </p>
              </article>
              <article className="metric-card">
                <p className="metric-label">Affected Sessions</p>
                <p className="metric-value">
                  {data.summary.affectedSessions.toLocaleString()}
                </p>
              </article>
            </div>

            <ul
              style={{ margin: "10px 0 0", paddingLeft: 18, color: "#4d4d52" }}
            >
              {data.insights.map((insight) => (
                <li key={insight} style={{ marginBottom: 6 }}>
                  {insight}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h3 className="tool-errors-table-title">Top Failing Tools</h3>
            {data.topTools.length > 0 ? (
              <div className="tool-errors-table-wrap">
                <table className="tool-errors-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th style={{ textAlign: "right" }}>Errors</th>
                      <th style={{ textAlign: "right" }}>Calls</th>
                      <th style={{ textAlign: "right" }}>Error Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topTools.map((row) => (
                      <tr key={row.tool}>
                        <td>
                          <Link
                            to={`/tool-errors/${encodeURIComponent(row.tool)}`}
                          >
                            {row.tool}
                          </Link>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {row.errorCount.toLocaleString()}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {row.totalCalls.toLocaleString()}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {row.errorRate.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">
                No tool errors recorded in this window
              </p>
            )}
          </section>

          <section className="card">
            <h3 className="tool-errors-table-title">Error Patterns</h3>
            {data.errorPatterns.length > 0 ? (
              <div className="tool-errors-table-wrap">
                <table className="tool-errors-table">
                  <thead>
                    <tr>
                      <th>Pattern</th>
                      <th style={{ textAlign: "right" }}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errorPatterns.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td style={{ textAlign: "right" }}>
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">No recurring patterns found</p>
            )}
          </section>

          <section className="card">
            <h3 className="tool-errors-table-title">Latest Errors</h3>
            {data.latestErrors.length > 0 ? (
              <div className="tool-errors-table-wrap">
                <table className="tool-errors-table">
                  <thead>
                    <tr>
                      <th className="te-col-date">Datetime</th>
                      <th>Tool</th>
                      <th className="te-col-session">Session</th>
                      <th className="te-col-error">Error Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latestErrors.map((row) => (
                      <tr
                        key={`${row.tool}-${row.sessionId}-${row.timeCreated}`}
                      >
                        <td className="te-col-date">
                          {formatDatePrecise(row.timeCreated)}
                        </td>
                        <td>
                          <Link
                            to={`/tool-errors/${encodeURIComponent(row.tool)}`}
                          >
                            {row.tool}
                          </Link>
                        </td>
                        <td className="te-col-session">
                          <Link
                            to={`/session/${encodeURIComponent(row.sessionId)}`}
                          >
                            {row.sessionId}
                          </Link>
                        </td>
                        <td className="te-col-error">
                          {row.error || "(no message)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">No recent errors</p>
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
    <section className="surface">
      <div className="breadcrumb">
        <Link to="/">Dashboard</Link>
        <span className="sep">/</span>
        <Link to="/tool-errors">Tool errors</Link>
        <span className="sep">/</span>
        <span>{tool}</span>
      </div>

      {loading ? (
        <p className="state" data-testid="route-loading">
          Loading tool errors...
        </p>
      ) : null}

      {error ? (
        <p className="state state-error" data-testid="route-error">
          Failed to load tool errors: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="card">
            <h2 className="tool-errors-title">Tool Errors: {data.tool}</h2>
            <p className="tool-errors-subtitle">
              Error timeline for the past 30 days
            </p>
            <div className="tool-errors-chart-wrap">
              <ErrorTimelineChart
                data={data.dailyErrorCounts}
                toolName={data.tool}
              />
            </div>
          </section>

          <section className="card">
            <h3 className="tool-errors-table-title">Latest 200 Errors</h3>
            {data.latestErrors.length > 0 ? (
              <div className="tool-errors-table-wrap">
                <table className="tool-errors-table">
                  <thead>
                    <tr>
                      <th className="te-col-date">Datetime</th>
                      <th className="te-col-session">Session</th>
                      <th className="te-col-error">Error Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latestErrors.map((row) => (
                      <tr key={`${row.sessionId}-${row.timeCreated}`}>
                        <td className="te-col-date">
                          {formatDatePrecise(row.timeCreated)}
                        </td>
                        <td className="te-col-session">
                          <Link
                            to={`/session/${encodeURIComponent(row.sessionId)}`}
                          >
                            {row.sessionId}
                          </Link>
                        </td>
                        <td className="te-col-error">
                          {row.error || "(no message)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">No errors recorded for this tool</p>
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
    return <p className="empty-copy">No timeline data available</p>;
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
