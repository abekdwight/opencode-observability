import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  DashboardModelPerformanceStatsRowContract,
  DashboardModelTokenConsumptionRowContract,
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
import {
  applyDashboardDraftSelection,
  cancelDashboardDraftSelection,
  createDashboardRequestVersionTracker,
  createDashboardSelectionController,
  type DashboardPresetId,
  type DashboardSelectionControllerState,
  serializeAppliedDashboardSelection,
  setDashboardDraftDates,
  setDashboardDraftPreset,
  setDashboardDraftView,
} from "../lib/dashboard-selection";

const PRESET_OPTIONS: {
  value: DashboardPresetId;
  label: string;
  helper: string;
}[] = [
  { value: "last30d", label: "1 Month", helper: "Last 30 days" },
  { value: "last7d", label: "1 Week", helper: "Last 7 days" },
  { value: "today", label: "1 Day", helper: "Today" },
  { value: "custom", label: "Custom Range", helper: "Select specific dates" },
];

function getTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "Local time";
  }
}

const REFRESH_INTERVAL = 30_000;

const MODEL_PIE_COLORS = [
  "#0b57d0",
  "#2e7d32",
  "#8e24aa",
  "#ef6c00",
  "#c62828",
  "#00838f",
  "#5d4037",
  "#5e35b1",
  "#1e88e5",
  "#7cb342",
  "#f4511e",
  "#546e7a",
] as const;

function toModelProviderLabel(model: string, provider: string): string {
  return `${model} · ${provider}`;
}

function formatLocalDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildLastYearBounds(): {
  startDayInclusive: string;
  endDayInclusive: string;
} {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  return {
    startDayInclusive: formatLocalDay(start),
    endDayInclusive: formatLocalDay(end),
  };
}

function formatAxisCount(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString();
}

function formatAxisTps(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric >= 100 ? numeric.toFixed(0) : numeric.toFixed(1);
}

function formatModelTickLabel(value: string, max = 16): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function quantileNumber(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0] ?? 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  if (lower === upper) return lowerValue;
  const weight = index - lower;
  return lowerValue * (1 - weight) + upperValue * weight;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNullableMetric(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatLatencySeconds(valueMs: number | null): string {
  if (valueMs == null || !Number.isFinite(valueMs)) return "—";
  const sec = valueMs / 1000;
  return sec >= 100 ? `${sec.toFixed(0)}s` : `${sec.toFixed(1)}s`;
}

function formatPercentRatio(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatDeviation(
  p10: number | null,
  p90: number | null,
  digits = 2,
): string {
  if (p10 == null || p90 == null) return "—";
  const sigma = Math.abs(p90 - p10) / 2.56;
  return `σ≈${sigma.toFixed(digits)}`;
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

function ModelPerformanceHeaderHelp({
  label,
  tooltip,
  align = "left",
}: {
  label: string;
  tooltip: string;
  align?: "left" | "right";
}) {
  const tooltipId = React.useId();

  return (
    <span
      className={`model-performance-th-content${
        align === "right" ? " is-right" : ""
      }`}
    >
      <span className="model-performance-th-label">{label}</span>
      <button
        type="button"
        className="model-performance-info-btn"
        aria-label={`${label} help`}
        aria-describedby={tooltipId}
      >
        <span className="model-performance-info-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
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
        </span>
        <span
          className="model-performance-tooltip"
          id={tooltipId}
          role="tooltip"
        >
          {tooltip}
        </span>
      </button>
    </span>
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

function ViewToggle({
  view,
  onToggle,
}: {
  view: DashboardViewContract;
  onToggle: (v: DashboardViewContract) => void;
}) {
  return (
    <div className="view-toggle-bar" role="tablist" aria-label="View mode">
      <button
        type="button"
        className={`view-toggle-btn${view === "daily" ? " active" : ""}`}
        onClick={() => onToggle("daily")}
        aria-pressed={view === "daily"}
        data-testid="dashboard-view-toggle-daily"
      >
        Daily
      </button>
      <button
        type="button"
        className={`view-toggle-btn${view === "hourly" ? " active" : ""}`}
        onClick={() => onToggle("hourly")}
        aria-pressed={view === "hourly"}
        data-testid="dashboard-view-toggle-hourly"
      >
        Hourly
      </button>
    </div>
  );
}

function PresetDropdown({
  value,
  onChange,
}: {
  value: DashboardPresetId;
  onChange: (preset: DashboardPresetId) => void;
}) {
  const selectedOption = PRESET_OPTIONS.find((o) => o.value === value);
  return (
    <div className="preset-dropdown-wrapper">
      <select
        className="preset-dropdown"
        value={value}
        onChange={(e) => onChange(e.target.value as DashboardPresetId)}
        data-testid="dashboard-time-preset"
        aria-label="Time range preset"
      >
        {PRESET_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {selectedOption && selectedOption.value !== "custom" && (
        <span className="preset-helper" data-testid="dashboard-preset-helper">
          {selectedOption.helper}
        </span>
      )}
    </div>
  );
}

function CustomRangePopover({
  isOpen,
  onClose,
  draftStart,
  draftEnd,
  onChangeDates,
  onApply,
  onCancel,
  validationError,
}: {
  isOpen: boolean;
  onClose: () => void;
  draftStart: string;
  draftEnd: string;
  onChangeDates: (dates: { start?: string; end?: string }) => void;
  onApply: () => void;
  onCancel: () => void;
  validationError: string | null;
}) {
  const popoverRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // Close on Escape key
  React.useEffect(() => {
    if (!isOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="custom-range-popover"
      ref={popoverRef}
      role="dialog"
      aria-label="Custom date range"
    >
      <div className="custom-range-fields">
        <label className="custom-range-label">
          <span>Start date</span>
          <input
            type="date"
            value={draftStart}
            onChange={(e) => onChangeDates({ start: e.target.value })}
            data-testid="dashboard-range-start"
            aria-label="Start date"
          />
        </label>
        <label className="custom-range-label">
          <span>End date</span>
          <input
            type="date"
            value={draftEnd}
            onChange={(e) => onChangeDates({ end: e.target.value })}
            data-testid="dashboard-range-end"
            aria-label="End date"
          />
        </label>
      </div>
      {validationError && (
        <div className="custom-range-error" data-testid="dashboard-range-error">
          {validationError}
        </div>
      )}
      <div className="custom-range-actions">
        <button
          type="button"
          className="custom-range-btn secondary"
          onClick={onCancel}
          data-testid="dashboard-range-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          className="custom-range-btn primary"
          onClick={onApply}
          data-testid="dashboard-range-apply"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function TimeRangeSelector({
  controller,
  onApply,
  onCancel,
}: {
  controller: DashboardSelectionControllerState;
  onApply: (controller: DashboardSelectionControllerState) => void;
  onCancel: (controller: DashboardSelectionControllerState) => void;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const [localController, setLocalController] = React.useState(controller);

  // Sync local controller when applied selection changes externally
  React.useEffect(() => {
    setLocalController(controller);
  }, [controller]);

  const handlePresetChange = (preset: DashboardPresetId) => {
    const nextController = setDashboardDraftPreset(localController, preset);
    setLocalController(nextController);
    if (preset === "custom") {
      setIsPopoverOpen(true);
    } else {
      // Auto-apply preset selections
      const applied = applyDashboardDraftSelection(nextController);
      if (!applied.validationError) {
        onApply(applied);
      }
    }
  };

  const handleChangeDates = (dates: { start?: string; end?: string }) => {
    setLocalController(setDashboardDraftDates(localController, dates));
  };

  const handleApply = () => {
    const applied = applyDashboardDraftSelection(localController);
    if (applied.validationError) {
      setLocalController(applied);
    } else {
      onApply(applied);
      setIsPopoverOpen(false);
    }
  };

  const handleCancel = () => {
    const cancelled = cancelDashboardDraftSelection(localController);
    setLocalController(cancelled);
    onCancel(cancelled);
    setIsPopoverOpen(false);
  };

  const isCustom = localController.draftSelection.preset === "custom";

  return (
    <div className="time-range-selector">
      <div className="time-range-controls">
        <PresetDropdown
          value={localController.draftSelection.preset}
          onChange={handlePresetChange}
        />
        {isCustom && (
          <button
            type="button"
            className="custom-range-trigger"
            onClick={() => setIsPopoverOpen(!isPopoverOpen)}
            data-testid="dashboard-custom-range-trigger"
            aria-expanded={isPopoverOpen}
            aria-haspopup="dialog"
          >
            {localController.draftSelection.start &&
            localController.draftSelection.end
              ? `${localController.draftSelection.start} → ${localController.draftSelection.end}`
              : "Select dates..."}
          </button>
        )}
        <span className="timezone-label" data-testid="dashboard-timezone-label">
          {getTimezoneLabel()}
        </span>
      </div>
      {isCustom && (
        <CustomRangePopover
          isOpen={isPopoverOpen}
          onClose={() => setIsPopoverOpen(false)}
          draftStart={localController.draftSelection.start}
          draftEnd={localController.draftSelection.end}
          onChangeDates={handleChangeDates}
          onApply={handleApply}
          onCancel={handleCancel}
          validationError={localController.validationError}
        />
      )}
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
      <section className="card">
        <div className="trend-header">
          <h2 style={{ fontSize: "1em", fontWeight: 700, margin: 0 }}>
            Error Daily Trend
          </h2>
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
        {hourlyBars.length === 0 ? (
          <p className="no-data">No error data</p>
        ) : (
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
    <section className="card">
      <div className="trend-header">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: 0 }}>
          Error Daily Trend
        </h2>
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

function ModelPerformanceSection({
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
      <section className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          Model Performance (TPS)
        </h2>
        <p className="no-data">No model performance data</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Model Performance (TPS)
      </h2>
      <div className="trend-header-end" style={{ marginBottom: 8 }}>
        <div
          className="range-bar"
          role="tablist"
          aria-label="Model performance view"
        >
          <button
            type="button"
            className={`range-btn${mode === "table" ? " active" : ""}`}
            onClick={() => setMode("table")}
            aria-pressed={mode === "table"}
          >
            Table
          </button>
          <button
            type="button"
            className={`range-btn${mode === "chart" ? " active" : ""}`}
            onClick={() => setMode("chart")}
            aria-pressed={mode === "chart"}
          >
            Chart
          </button>
        </div>
      </div>

      {mode === "table" ? (
        <div className="model-performance-table-scroll">
          <table className="repo-table model-performance-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>
                  <ModelPerformanceHeaderHelp
                    label="Model"
                    tooltip="Model and provider are shown together in one cell."
                  />
                </th>
                <th style={{ textAlign: "right" }}>
                  <ModelPerformanceHeaderHelp
                    label="TPS"
                    tooltip="Primary throughput uses P50 when available; the asterisk marks weighted-average fallback."
                    align="right"
                  />
                </th>
                <th style={{ textAlign: "right" }}>
                  <ModelPerformanceHeaderHelp
                    label="Deviation"
                    tooltip="Observed spread from P10–P90, shown as σ≈(P90−P10)/2.56."
                    align="right"
                  />
                </th>
                <th style={{ textAlign: "right" }}>
                  <ModelPerformanceHeaderHelp
                    label="Latency"
                    tooltip="Latency at P50 / P90 / P99."
                    align="right"
                  />
                </th>
                <th style={{ textAlign: "right" }}>
                  <ModelPerformanceHeaderHelp
                    label="Weighted TPS"
                    tooltip="Weighted average throughput (Σoutput / Σduration)."
                    align="right"
                  />
                </th>
                <th style={{ textAlign: "right" }}>
                  <ModelPerformanceHeaderHelp
                    label="Validity"
                    tooltip="Valid TPS messages divided by total messages."
                    align="right"
                  />
                </th>
                <th style={{ textAlign: "right" }}>
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
                  <tr key={`${row.model}-${row.provider}`}>
                    <td
                      className="repo-name model-performance-model"
                      title={`${row.model} · ${row.provider}`}
                    >
                      {row.model} · {row.provider}
                    </td>
                    <td className="model-performance-primary">
                      <div className="model-performance-primary-wrap">
                        {isFallback ? (
                          <span
                            className="model-performance-fallback"
                            title="P50 unavailable — showing weighted average"
                          >
                            *
                          </span>
                        ) : null}
                        <span className="model-performance-primary-value">
                          {formatNullableMetric(primaryTps)}
                        </span>
                      </div>
                    </td>
                    <td className="model-performance-num model-performance-deviation">
                      {formatDeviation(row.tpsP10, row.tpsP90)}
                    </td>
                    <td className="model-performance-num model-performance-latency">
                      {formatLatencySeconds(row.latencyP50Ms)} /{" "}
                      {formatLatencySeconds(row.latencyP90Ms)} /{" "}
                      {formatLatencySeconds(row.latencyP99Ms)}
                    </td>
                    <td className="model-performance-num">
                      {formatNullableMetric(row.avgTps)}
                    </td>
                    <td
                      className="model-performance-num"
                      title={`latency valid: ${row.validLatencyMessages.toLocaleString()}`}
                    >
                      {formatPercentRatio(row.validityRatio)}
                    </td>
                    <td className="model-performance-num">
                      {formatPercentRatio(row.reasoningShare)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-scroll">
          <div className="model-performance-chart-shell">
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
                      deviation && deviation !== "—"
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
        </div>
      )}
    </section>
  );
}

function ModelTokenConsumptionSection({
  rows,
}: {
  rows: DashboardModelTokenConsumptionRowContract[];
}) {
  const [includeCache, setIncludeCache] = React.useState(true);

  const displayRows = React.useMemo(() => rows.slice(0, 10), [rows]);

  const pieRows = React.useMemo(
    () =>
      displayRows.map((row, index) => {
        const cacheInputTokens = row.cacheReadTokens + row.cacheWriteTokens;
        return {
          key: `${row.model}-${row.provider}`,
          name: toModelProviderLabel(row.model, row.provider),
          color: MODEL_PIE_COLORS[index % MODEL_PIE_COLORS.length],
          nonCacheInput: Math.max(0, row.nonCacheInputTokens),
          cacheInput: Math.max(0, cacheInputTokens),
          inputWithCache: Math.max(0, row.inputTotalTokens),
          output: Math.max(0, row.outputTokens),
        };
      }),
    [displayRows],
  );

  const inputSolidData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: row.nonCacheInput,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [pieRows],
  );

  const inputDashedData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: row.cacheInput,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [pieRows],
  );

  const inputSingleData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: includeCache ? row.inputWithCache : row.nonCacheInput,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [includeCache, pieRows],
  );

  const outputData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: row.output,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [pieRows],
  );

  const inputTotal = React.useMemo(
    () => inputSingleData.reduce((sum, row) => sum + row.value, 0),
    [inputSingleData],
  );
  const outputTotal = React.useMemo(
    () => outputData.reduce((sum, row) => sum + row.value, 0),
    [outputData],
  );

  const showData = inputSingleData.length > 0 || outputData.length > 0;

  return (
    <section className="card model-token-card-single">
      <div className="trend-header-with-toggle" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 6px 0" }}>
            Model Token Consumption
          </h2>
          <p className="hourly-subtitle">
            Input / Output を円グラフで比較。Input は cache 表示の ON/OFF
            を切替可能。
          </p>
        </div>
        <div className="range-bar" role="tablist" aria-label="Input cache mode">
          <button
            type="button"
            className={`range-btn${includeCache ? " active" : ""}`}
            onClick={() => setIncludeCache(true)}
            aria-pressed={includeCache}
          >
            Cache ON
          </button>
          <button
            type="button"
            className={`range-btn${includeCache ? "" : " active"}`}
            onClick={() => setIncludeCache(false)}
            aria-pressed={!includeCache}
          >
            Cache OFF
          </button>
        </div>
      </div>
      {showData ? (
        <div className="model-token-pies-grid">
          <article className="model-token-pie-card">
            <header className="model-token-pie-header">
              <h3>Input tokens</h3>
              <span>{inputTotal.toLocaleString()} total</span>
            </header>
            <div className="model-token-pie-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Tooltip
                    formatter={(value) =>
                      `${Math.round(Number(value) || 0).toLocaleString()} tokens`
                    }
                  />
                  {includeCache ? (
                    <>
                      <Pie
                        data={inputSolidData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={42}
                        outerRadius={78}
                        stroke="#ffffff"
                        strokeWidth={1.2}
                      >
                        {inputSolidData.map((entry) => (
                          <Cell
                            key={`input-solid-${entry.name}`}
                            fill={entry.color}
                          />
                        ))}
                      </Pie>
                      <Pie
                        data={inputDashedData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={82}
                        outerRadius={106}
                        stroke="#2b2b2f"
                        strokeWidth={1.2}
                        strokeDasharray="4 3"
                      >
                        {inputDashedData.map((entry) => (
                          <Cell
                            key={`input-cache-${entry.name}`}
                            fill={entry.color}
                            fillOpacity={0.35}
                          />
                        ))}
                      </Pie>
                    </>
                  ) : (
                    <Pie
                      data={inputSingleData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={46}
                      outerRadius={106}
                      stroke="#ffffff"
                      strokeWidth={1.2}
                    >
                      {inputSingleData.map((entry) => (
                        <Cell key={`input-${entry.name}`} fill={entry.color} />
                      ))}
                    </Pie>
                  )}
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="model-token-pie-note">
              {includeCache
                ? "内側=non-cache(実線), 外側=cache(点線リング)"
                : "cache を除外した Input 内訳"}
            </p>
          </article>

          <article className="model-token-pie-card">
            <header className="model-token-pie-header">
              <h3>Output tokens</h3>
              <span>{outputTotal.toLocaleString()} total</span>
            </header>
            <div className="model-token-pie-wrap">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Tooltip
                    formatter={(value) =>
                      `${Math.round(Number(value) || 0).toLocaleString()} tokens`
                    }
                  />
                  <Pie
                    data={outputData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={46}
                    outerRadius={106}
                    stroke="#ffffff"
                    strokeWidth={1.2}
                  >
                    {outputData.map((entry) => (
                      <Cell key={`output-${entry.name}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="model-token-pie-note">モデル別 Output 構成</p>
          </article>
        </div>
      ) : (
        <p className="no-data">No data</p>
      )}
      {displayRows.length > 0 ? (
        <div className="model-token-legend-grid">
          {pieRows.map((row) => (
            <div key={row.key} className="model-token-legend-item">
              <span
                className="model-token-legend-dot"
                style={{ background: row.color }}
              />
              <span className="model-token-legend-label" title={row.name}>
                {row.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TokenTrendSection({
  tokenTrend,
  view,
  dayCount,
  onToggleView,
}: {
  tokenTrend: DashboardTokenTrendContract;
  view: DashboardViewContract;
  dayCount: number;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  const ioRatioPct = tokenTrend.inputRatioPercent.toFixed(1);
  const isSingleDay = dayCount === 1;
  const hourlySubtitle = isSingleDay
    ? "Showing hourly breakdown for selected day"
    : "Showing sum of hourly activity across selected days";

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
        <div className="trend-header-with-toggle">
          <div>
            <h2
              style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 6px 0" }}
            >
              Token I/O Trend
            </h2>
            <p className="hourly-subtitle">{hourlySubtitle}</p>
          </div>
          <ViewToggle view={view} onToggle={onToggleView} />
        </div>
        <div className="trend-header">{ioRatioBar}</div>
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
      <div className="trend-header-with-toggle">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: 0 }}>
          Token I/O Trend
        </h2>
        <ViewToggle view={view} onToggle={onToggleView} />
      </div>
      <div className="trend-header">{ioRatioBar}</div>
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
            {tokenTrend.dailySeries.map((s) => (
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
    </section>
  );
}

function SubagentTrendSection({
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
      <section className="card">
        <div className="trend-header-with-toggle">
          <div>
            <h2
              style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 6px 0" }}
            >
              Subagent Activity
            </h2>
            <p className="hourly-subtitle">{hourlySubtitle}</p>
          </div>
          <ViewToggle view={view} onToggle={onToggleView} />
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
    <section className="card">
      <div className="trend-header-with-toggle">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: 0 }}>
          Subagent Activity
        </h2>
        <ViewToggle view={view} onToggle={onToggleView} />
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
        <Link
          to="/tool-errors"
          style={{ fontSize: "0.82em", whiteSpace: "nowrap" }}
        >
          View all tool errors &rarr;
        </Link>
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
  const controllerFromUrl = React.useMemo(
    () => createDashboardSelectionController(searchParams),
    [searchParams],
  );
  const [selectionController, setSelectionController] =
    React.useState(controllerFromUrl);
  const requestVersionTrackerRef = React.useRef(
    createDashboardRequestVersionTracker(),
  );

  React.useEffect(() => {
    const currentApplied = serializeAppliedDashboardSelection(
      selectionController.appliedSelection,
    ).toString();
    const nextApplied = serializeAppliedDashboardSelection(
      controllerFromUrl.appliedSelection,
    ).toString();
    if (currentApplied !== nextApplied) {
      setSelectionController(controllerFromUrl);
    }
  }, [controllerFromUrl, selectionController.appliedSelection]);

  const { appliedSelection, apiUrl } = selectionController;
  const view = appliedSelection.view;
  const [data, setData] = React.useState<DashboardContract | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  /* Fetch + periodic refresh */
  React.useEffect(() => {
    let cancelled = false;
    const controllers = new Set<AbortController>();

    async function load() {
      const requestVersion = requestVersionTrackerRef.current.start();
      const controller = new AbortController();
      controllers.add(controller);
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
        if (
          !cancelled &&
          requestVersionTrackerRef.current.isCurrent(requestVersion)
        ) {
          setData(json);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (
          !cancelled &&
          requestVersionTrackerRef.current.isCurrent(requestVersion)
        )
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        controllers.delete(controller);
        if (
          !cancelled &&
          requestVersionTrackerRef.current.isCurrent(requestVersion)
        ) {
          setLoading(false);
        }
      }
    }

    load();

    const timer = appliedSelection.refreshable
      ? setInterval(() => {
          if (!cancelled) load();
        }, REFRESH_INTERVAL)
      : null;

    return () => {
      cancelled = true;
      for (const controller of controllers) {
        controller.abort();
      }
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [apiUrl, appliedSelection.refreshable]);

  const applyController = React.useCallback(
    (nextController: typeof selectionController) => {
      setSelectionController(nextController);
      setSearchParams(
        serializeAppliedDashboardSelection(nextController.appliedSelection),
      );
    },
    [setSearchParams],
  );

  const handleViewToggle = React.useCallback(
    (v: DashboardViewContract) => {
      applyController(
        applyDashboardDraftSelection(
          setDashboardDraftView(selectionController, v),
        ),
      );
    },
    [applyController, selectionController],
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

  const activityBounds = buildLastYearBounds();

  return (
    <section className="dash-surface" data-testid="dashboard">
      {/* 1. Summary Metrics */}
      <SummaryMetrics data={data} />

      {/* 2. Range Selector */}
      <div className="dashboard-controls">
        <TimeRangeSelector
          controller={selectionController}
          onApply={(nextController) => {
            applyController(nextController);
          }}
          onCancel={(nextController) => {
            applyController(nextController);
          }}
        />
      </div>

      {/* 3. Recent Sessions */}
      <RecentSessions sessions={data.recentSessions} />

      {/* 4. Activity Heatmap */}
      <section className="card">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
          Activity (last 1 year)
        </h2>
        <ActivityHeatmap
          days={data.heatmapDays}
          startDay={activityBounds.startDayInclusive}
          endDay={activityBounds.endDayInclusive}
        />
      </section>

      {/* 5. Error Daily Trend */}
      <ErrorTrendSection
        series={data.errorTrendSeries}
        hourlyBars={data.errorTrendHourlyBars}
        view={view}
        onToggleView={handleViewToggle}
      />

      {/* 6. Token I/O Trend */}
      <TokenTrendSection
        tokenTrend={data.tokenTrend}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 7. Subagent Activity */}
      <SubagentTrendSection
        subagentTrend={data.subagentTrend}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 8. Active Repositories */}
      <ActiveReposSection repos={data.activeRepos} />

      {/* 9. Model Performance (full width) */}
      <ModelPerformanceSection rows={data.modelPerformanceStats ?? []} />

      {/* 10. Model Token Consumption (full width) */}
      <ModelTokenConsumptionSection rows={data.modelTokenConsumption} />

      {/* 11-14. Model views, usage, tools, MCP (2-column grid) */}
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
