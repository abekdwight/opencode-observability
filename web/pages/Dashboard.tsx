import React from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  DashboardBarItemContract,
  DashboardContract,
  DashboardLineSeriesContract,
  DashboardMcpUsageRowContract,
  DashboardRangeContract,
  DashboardRepoBreakdownContract,
  DashboardStackBarContract,
  DashboardSubagentTrendContract,
  DashboardTokenTrendContract,
  DashboardToolReliabilityRowContract,
  DashboardViewContract,
} from "../../src/contracts/dashboard";
import { ActivityHeatmap } from "../components/charts/ActivityHeatmap";
import { CssBarChart } from "../components/charts/CssBarChart";
import { CHART_THEME } from "../lib/chart-theme";

const RANGES: { value: DashboardRangeContract; label: string }[] = [
  { value: "all", label: "All" },
  { value: "month", label: "1 Month" },
  { value: "week", label: "1 Week" },
  { value: "day", label: "1 Day" },
];

const REFRESH_INTERVAL = 30_000;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function prettifyPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

/* ── Recharts line series helper ── */

interface FlatPoint {
  day: string;
  [seriesLabel: string]: string | number;
}

function flattenLineSeries(series: DashboardLineSeriesContract[]): FlatPoint[] {
  if (series.length === 0) return [];
  const allDays = new Set<string>();
  for (const s of series) for (const p of s.points) allDays.add(p.day);
  const days = [...allDays].sort();
  const lookup = new Map<string, Map<string, number>>();
  for (const s of series) {
    const m = new Map<string, number>();
    for (const p of s.points) m.set(p.day, p.value);
    lookup.set(s.label, m);
  }
  return days.map((day) => {
    const point: FlatPoint = { day };
    for (const s of series) {
      point[s.label] = lookup.get(s.label)?.get(day) ?? 0;
    }
    return point;
  });
}

/* ── Recharts stacked bar helper ── */

interface FlatBar {
  label: string;
  [stackName: string]: string | number;
}

function flattenStackBars(bars: DashboardStackBarContract[]): {
  data: FlatBar[];
  keys: { name: string; color: string }[];
} {
  const keySet = new Map<string, string>();
  for (const bar of bars) {
    for (const s of bar.stacks) {
      if (!keySet.has(s.name)) keySet.set(s.name, s.color);
    }
  }
  const keys = [...keySet.entries()].map(([name, color]) => ({ name, color }));
  const data: FlatBar[] = bars.map((bar) => {
    const row: FlatBar = { label: bar.label };
    for (const s of bar.stacks) row[s.name] = s.value;
    return row;
  });
  return { data, keys };
}

/* ── Custom Recharts Tooltip ── */

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: CHART_THEME.tooltip.backgroundColor,
        color: CHART_THEME.tooltip.textColor,
        borderRadius: CHART_THEME.tooltip.borderRadius,
        padding: `${CHART_THEME.tooltip.padding[0]}px ${CHART_THEME.tooltip.padding[1]}px`,
        fontSize: CHART_THEME.tooltip.fontSize,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((entry) => (
        <div
          key={entry.name}
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: entry.color,
              display: "inline-block",
            }}
          />
          <span>
            {entry.name}: {entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Section Components ── */

function SummaryMetrics({ data }: { data: DashboardContract }) {
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
    <div className="metrics-grid">
      {metrics.map((m) => (
        <article className="metric-card" key={m.label}>
          <p className="metric-label">{m.label}</p>
          <p className="metric-value">{m.value}</p>
          <p className="metric-sub">{m.sub}</p>
        </article>
      ))}
    </div>
  );
}

function RangeSelector({
  currentRange,
  onSelect,
}: {
  currentRange: DashboardRangeContract;
  onSelect: (range: DashboardRangeContract) => void;
}) {
  return (
    <div className="range-bar">
      {RANGES.map((r) => (
        <button
          type="button"
          key={r.value}
          className={`range-btn${r.value === currentRange ? " active" : ""}`}
          onClick={() => onSelect(r.value)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function RecentSessions({
  sessions,
}: {
  sessions: DashboardContract["recentSessions"];
}) {
  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Recent Sessions
      </h2>
      {sessions.length === 0 ? (
        <p className="no-data">No sessions found</p>
      ) : (
        sessions.map((session) => {
          const dateStr = new Date(session.timeUpdated).toLocaleString(
            "ja-JP",
            {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            },
          );
          const tokens =
            session.totalTokens > 0
              ? formatTokens(session.totalTokens)
              : "\u2014";
          return (
            <Link
              key={session.id}
              to={`/session/${encodeURIComponent(session.id)}`}
              className="dash-recent-item"
            >
              <div className="dash-recent-title">
                {session.title || "(no title)"}
              </div>
              <div className="dash-recent-meta">
                <span>{dateStr}</span>
                <span className="dash-recent-pill">{tokens} tokens</span>
                <span className="dash-recent-dir">
                  {prettifyPath(session.directory || "")}
                </span>
              </div>
            </Link>
          );
        })
      )}
      <Link to="/directories" className="more-link">
        All directories &rarr;
      </Link>
    </section>
  );
}

function ErrorTrendSection({
  series,
}: {
  series: DashboardLineSeriesContract[];
}) {
  const flatData = React.useMemo(() => flattenLineSeries(series), [series]);

  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Error Daily Trend
      </h2>
      {series.length === 0 ? (
        <p className="no-data">No error data</p>
      ) : (
        <div className="chart-scroll">
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
              />
              <YAxis
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend />
              {series.map((s) => (
                <Line
                  key={s.label}
                  type="monotone"
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

function TokenTrendSection({
  tokenTrend,
  range,
  view,
  onToggleView,
}: {
  tokenTrend: DashboardTokenTrendContract;
  range: DashboardRangeContract;
  view: DashboardViewContract;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  const ioRatioPct = tokenTrend.inputRatioPercent.toFixed(1);

  const ioRatioBar = (
    <div className="io-ratio-bar">
      <div className="io-ratio-label">
        Input ratio: <strong style={{ color: "#1d1d1f" }}>{ioRatioPct}%</strong>
      </div>
      <div className="io-ratio-track">
        <div
          className="io-ratio-fill"
          style={{
            width: `${Math.max(0, Math.min(100, tokenTrend.inputRatioPercent))}%`,
          }}
        />
      </div>
    </div>
  );

  if (view === "hourly") {
    const { data, keys } = flattenStackBars(tokenTrend.hourlyBars);
    return (
      <section className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          Token I/O Trend
        </h2>
        <div className="trend-header">
          {ioRatioBar}
          <button
            type="button"
            className="view-toggle"
            onClick={() => onToggleView("daily")}
            style={{
              background: "none",
              border: "none",
              color: "#0066cc",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            View daily &rarr;
          </button>
        </div>
        <div className="chart-scroll">
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
              />
              <YAxis
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
              />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend />
              {keys.map((k) => (
                <Bar
                  key={k.name}
                  dataKey={k.name}
                  stackId="token"
                  fill={k.color}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    );
  }

  const flatData = flattenLineSeries(tokenTrend.dailySeries);

  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Token I/O Trend
      </h2>
      <div className="trend-header">
        {ioRatioBar}
        <button
          type="button"
          className="view-toggle"
          onClick={() => onToggleView("hourly")}
          style={{
            background: "none",
            border: "none",
            color: "#0066cc",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          View hourly &rarr;
        </button>
      </div>
      <div className="chart-scroll">
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
            />
            <YAxis
              tick={{ fontSize: CHART_THEME.axis.fontSize }}
              stroke={CHART_THEME.axis.tickColor}
            />
            <Tooltip content={<ChartTooltipContent />} />
            <Legend />
            {tokenTrend.dailySeries.map((s) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function SubagentTrendSection({
  subagentTrend,
  range,
  view,
  onToggleView,
}: {
  subagentTrend: DashboardSubagentTrendContract;
  range: DashboardRangeContract;
  view: DashboardViewContract;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  if (view === "hourly") {
    const { data, keys } = flattenStackBars(subagentTrend.hourlyBars);
    return (
      <section className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          Subagent Activity
        </h2>
        <div className="trend-header-end">
          <button
            type="button"
            className="view-toggle"
            onClick={() => onToggleView("daily")}
            style={{
              background: "none",
              border: "none",
              color: "#0066cc",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            View daily &rarr;
          </button>
        </div>
        <div className="chart-scroll">
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
              />
              <YAxis
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
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
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Subagent Activity
      </h2>
      <div className="trend-header-end">
        <button
          type="button"
          className="view-toggle"
          onClick={() => onToggleView("hourly")}
          style={{
            background: "none",
            border: "none",
            color: "#0066cc",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          View hourly &rarr;
        </button>
      </div>
      {subagentTrend.dailySeries.length === 0 ? (
        <p className="no-data">No subagent data</p>
      ) : (
        <div className="chart-scroll">
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
              />
              <YAxis
                tick={{ fontSize: CHART_THEME.axis.fontSize }}
                stroke={CHART_THEME.axis.tickColor}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend />
              {subagentTrend.dailySeries.map((s) => (
                <Line
                  key={s.label}
                  type="monotone"
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

function ActiveReposSection({
  repos,
}: {
  repos: DashboardRepoBreakdownContract;
}) {
  if (repos.rows.length === 0) {
    return (
      <section className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          Active Repositories
        </h2>
        <p className="no-data">No repository data</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Active Repositories
      </h2>
      <div style={{ overflowX: "auto" }}>
        <table className="repo-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Repository</th>
              {repos.dayHeaders.map((day) => {
                const parts = day.split("-");
                return (
                  <th key={day} style={{ textAlign: "center", minWidth: 54 }}>
                    {parts[1]}/{parts[2]}
                  </th>
                );
              })}
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {repos.rows.map((row) => (
              <tr key={row.repo}>
                <td className="repo-name" title={row.repo}>
                  {prettifyPath(row.repo)}
                </td>
                {row.dayCells.map((cell) => (
                  <td
                    key={cell.day}
                    className={`day-cell${cell.muted ? " day-cell-muted" : ""}`}
                  >
                    {cell.label}
                  </td>
                ))}
                <td className="total-cell">{row.totalLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function McpUsageSection({ rows }: { rows: DashboardMcpUsageRowContract[] }) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          MCP Tool Usage
        </h2>
        <p className="no-data">No data</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        MCP Tool Usage
      </h2>
      <div className="matrix-header">
        <span style={{ width: 140 }}>Server</span>
        <span style={{ width: 55, textAlign: "right" }}>Calls</span>
        <span style={{ width: 45, textAlign: "right" }}>Errors</span>
        <span style={{ flex: 1 }}>Error Rate</span>
        <span style={{ width: 45 }} />
      </div>
      {rows.map((row) => {
        const pct = row.errorRate.toFixed(1);
        const barW = Math.max(1, row.errorRate);
        const color =
          row.errorRate > 20
            ? "#d32f2f"
            : row.errorRate > 5
              ? "#f57c00"
              : "#4caf50";
        return (
          <div
            key={row.server}
            className={`matrix-row${row.isBuiltin ? " matrix-row-builtin" : ""}`}
          >
            <span className="matrix-tool">
              {row.isBuiltin ? (
                <span className="matrix-builtin-badge">Builtin Tools</span>
              ) : (
                row.server
              )}
            </span>
            <span className="matrix-calls">{row.calls.toLocaleString()}</span>
            <span className="matrix-err">{row.errors.toLocaleString()}</span>
            <div className="matrix-bar-track">
              <div
                className="matrix-bar-fill"
                style={{ width: `${barW}%`, background: color }}
              />
            </div>
            <span className="matrix-pct" style={{ color }}>
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ToolReliabilitySection({
  rows,
}: {
  rows: DashboardToolReliabilityRowContract[];
}) {
  return (
    <section className="card" id="tool-reliability">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: 0 }}>
          Tool Reliability
        </h2>
        <a
          href="#tool-reliability"
          style={{ fontSize: "0.82em", whiteSpace: "nowrap" }}
        >
          View all tool errors &rarr;
        </a>
      </div>
      <div className="matrix-header">
        <span style={{ width: 140 }}>Tool</span>
        <span style={{ width: 55, textAlign: "right" }}>OK</span>
        <span style={{ width: 45, textAlign: "right" }}>Error</span>
        <span style={{ flex: 1 }}>Error Rate</span>
        <span style={{ width: 45 }} />
      </div>
      {rows.length === 0 ? (
        <p className="no-data">No data</p>
      ) : (
        rows.map((row) => {
          const pct = row.errorRate.toFixed(1);
          const barW = Math.max(1, row.errorRate);
          const color =
            row.errorRate > 20
              ? "#d32f2f"
              : row.errorRate > 5
                ? "#f57c00"
                : "#4caf50";
          const toolLabel =
            row.tool === "Other" ? (
              <span className="matrix-tool matrix-tool-muted">{row.tool}</span>
            ) : (
              <Link
                to={`/tool-errors/${encodeURIComponent(row.tool)}`}
                className="matrix-tool matrix-tool-link"
              >
                {row.tool}
              </Link>
            );

          return (
            <div key={row.tool} className="matrix-row">
              {toolLabel}
              <span className="matrix-ok">{row.success.toLocaleString()}</span>
              <span className="matrix-err">{row.error.toLocaleString()}</span>
              <div className="matrix-bar-track">
                <div
                  className="matrix-bar-fill"
                  style={{ width: `${barW}%`, background: color }}
                />
              </div>
              <span className="matrix-pct" style={{ color }}>
                {pct}%
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}

function ErrorPatternsSection({
  patterns,
}: {
  patterns: DashboardBarItemContract[];
}) {
  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Error Patterns
      </h2>
      <CssBarChart items={patterns} barColor="#d32f2f" />
    </section>
  );
}

/* ── Main Dashboard ── */

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = (searchParams.get("range") ?? "all") as DashboardRangeContract;
  const view = (searchParams.get("view") ?? "daily") as DashboardViewContract;

  const apiUrl = `/api/dashboard?range=${range}&view=${view}`;

  const [data, setData] = React.useState<DashboardContract | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  /* Fetch + periodic refresh */
  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(apiUrl, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as DashboardContract;
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    const timer = setInterval(() => {
      if (!cancelled) load();
    }, REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [apiUrl]);

  const handleRangeSelect = React.useCallback(
    (r: DashboardRangeContract) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("range", r);
        return next;
      });
    },
    [setSearchParams],
  );

  const handleViewToggle = React.useCallback(
    (v: DashboardViewContract) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", v);
        return next;
      });
    },
    [setSearchParams],
  );

  if (loading && !data) {
    return (
      <section className="dash-surface">
        <p className="state" data-testid="route-loading">
          Loading dashboard...
        </p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="dash-surface">
        <p className="state state-error" data-testid="route-error">
          Dashboard API unavailable: {error}
        </p>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="dash-surface" data-testid="dashboard">
      {/* 1. Summary Metrics */}
      <SummaryMetrics data={data} />

      {/* 2. Range Selector */}
      <RangeSelector currentRange={range} onSelect={handleRangeSelect} />

      {/* 3. Recent Sessions */}
      <RecentSessions sessions={data.recentSessions} />

      {/* 4. Activity Heatmap */}
      <section className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          Activity (last 365 days)
        </h2>
        <ActivityHeatmap days={data.heatmapDays} />
      </section>

      {/* 5. Error Daily Trend */}
      <ErrorTrendSection series={data.errorTrendSeries} />

      {/* 6. Token I/O Trend */}
      <TokenTrendSection
        tokenTrend={data.tokenTrend}
        range={range}
        view={view}
        onToggleView={handleViewToggle}
      />

      {/* 7. Subagent Activity */}
      <SubagentTrendSection
        subagentTrend={data.subagentTrend}
        range={range}
        view={view}
        onToggleView={handleViewToggle}
      />

      {/* 8. Active Repositories */}
      <ActiveReposSection repos={data.activeRepos} />

      {/* 9-11. Model Usage, Top Tools, Agent Distribution (CSS-only bars) */}
      <div className="charts-grid">
        <section className="card">
          <h2
            style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}
          >
            Model Usage
          </h2>
          <CssBarChart items={data.modelUsage} barColor="#0066cc" />
        </section>
        <section className="card">
          <h2
            style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}
          >
            Top Tools
          </h2>
          <CssBarChart items={data.toolUsage} barColor="#0066cc" />
        </section>
        <section className="card">
          <h2
            style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}
          >
            Agent Distribution
          </h2>
          <CssBarChart items={data.agentDistribution} barColor="#0066cc" />
        </section>

        {/* 12. MCP Tool Usage */}
        <McpUsageSection rows={data.mcpUsage} />
      </div>

      {/* 13. Tool Reliability Matrix */}
      <ToolReliabilitySection rows={data.toolReliabilityMatrix} />

      {/* 14. Error Patterns */}
      <ErrorPatternsSection patterns={data.errorPatterns} />
    </section>
  );
}
