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

const TOKEN_CONSUMPTION_COLORS = [
  CHART_THEME.colors.primary,
  CHART_THEME.colors.success,
  CHART_THEME.colors.warning,
  CHART_THEME.colors.error,
  "#0288d1",
  "#6a1b9a",
  "#8a5700",
  "#5e35b1",
  CHART_THEME.colors.muted,
] as const;

function summarizeBarItems(
  items: DashboardBarItemContract[],
  limit = 8,
): DashboardBarItemContract[] {
  const sorted = [...items]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  if (sorted.length <= limit) return sorted;

  const top = sorted.slice(0, limit);
  const otherCount = sorted
    .slice(limit)
    .reduce((sum, item) => sum + item.count, 0);
  return otherCount > 0 ? [...top, { label: "Other", count: otherCount }] : top;
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number,
): { x: number; y: number } {
  const radians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function describePieSlice(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return [
    "M",
    cx,
    cy,
    "L",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    "Z",
  ].join(" ");
}

interface PieSlice {
  label: string;
  value: number;
  color: string;
  startAngle: number;
  endAngle: number;
}

function buildPieSlices(items: DashboardBarItemContract[]): PieSlice[] {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total <= 0) return [];

  let cursor = 0;
  return items.map((item, index) => {
    const sweep = (item.count / total) * 360;
    const slice = {
      label: item.label,
      value: item.count,
      color: TOKEN_CONSUMPTION_COLORS[index % TOKEN_CONSUMPTION_COLORS.length],
      startAngle: cursor,
      endAngle: cursor + sweep,
    };
    cursor += sweep;
    return slice;
  });
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
                />
                <YAxis
                  tick={{ fontSize: CHART_THEME.axis.fontSize }}
                  stroke={CHART_THEME.axis.tickColor}
                  allowDecimals={false}
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
  items,
}: {
  items: DashboardBarItemContract[];
}) {
  return (
    <section className="card">
      <h2 style={{ fontSize: "1em", fontWeight: 700, margin: "0 0 14px 0" }}>
        Model Performance (TPS)
      </h2>
      <CssBarChart items={items} barColor={CHART_THEME.colors.success} />
    </section>
  );
}

function ModelTokenConsumptionSection({
  items,
}: {
  items: DashboardBarItemContract[];
}) {
  const [mode, setMode] = React.useState<"pie" | "stacked">("pie");
  const displayItems = React.useMemo(
    () => summarizeBarItems(items, 8),
    [items],
  );
  const totalTokens = React.useMemo(
    () => displayItems.reduce((sum, item) => sum + item.count, 0),
    [displayItems],
  );
  const pieSlices = React.useMemo(
    () => buildPieSlices(displayItems),
    [displayItems],
  );

  return (
    <section className="card">
      <div className="trend-header">
        <h2 style={{ fontSize: "1em", fontWeight: 700, margin: 0 }}>
          Model Token Consumption
        </h2>
        <div className="range-bar" role="tablist" aria-label="Model token view">
          <button
            type="button"
            className={`range-btn${mode === "pie" ? " active" : ""}`}
            onClick={() => setMode("pie")}
            aria-pressed={mode === "pie"}
          >
            Pie
          </button>
          <button
            type="button"
            className={`range-btn${mode === "stacked" ? " active" : ""}`}
            onClick={() => setMode("stacked")}
            aria-pressed={mode === "stacked"}
          >
            Stacked bar
          </button>
        </div>
      </div>

      {displayItems.length === 0 ? (
        <p className="no-data">No data</p>
      ) : (
        <>
          {mode === "pie" ? (
            <div className="chart-scroll">
              <div style={{ display: "flex", justifyContent: "center" }}>
                <svg
                  viewBox="0 0 260 220"
                  role="img"
                  aria-label="Model token consumption pie chart"
                  style={{ display: "block", maxWidth: 320, width: "100%" }}
                >
                  <circle cx="130" cy="98" r="78" fill="#f5f5f7" />
                  {pieSlices.length === 1 ? (
                    <circle
                      cx="130"
                      cy="98"
                      r="78"
                      fill={pieSlices[0].color}
                      stroke="#ffffff"
                      strokeWidth={2}
                    >
                      <title>
                        {pieSlices[0].label}: {formatTokens(pieSlices[0].value)}
                      </title>
                    </circle>
                  ) : (
                    pieSlices.map((slice) => (
                      <path
                        key={slice.label}
                        d={describePieSlice(
                          130,
                          98,
                          78,
                          slice.startAngle,
                          slice.endAngle,
                        )}
                        fill={slice.color}
                        stroke="#ffffff"
                        strokeWidth={2}
                      >
                        <title>
                          {slice.label}: {formatTokens(slice.value)}
                        </title>
                      </path>
                    ))
                  )}
                  <circle
                    cx="130"
                    cy="98"
                    r="42"
                    fill="#ffffff"
                    stroke="#d2d2d7"
                  />
                  <text
                    x="130"
                    y="92"
                    textAnchor="middle"
                    fontSize="18"
                    fontWeight="700"
                    fill="#1d1d1f"
                  >
                    {formatTokens(totalTokens)}
                  </text>
                  <text
                    x="130"
                    y="110"
                    textAnchor="middle"
                    fontSize="11"
                    fill="#86868b"
                  >
                    tokens
                  </text>
                </svg>
              </div>
            </div>
          ) : (
            <div className="chart-scroll">
              <div
                style={{
                  display: "flex",
                  height: 18,
                  borderRadius: 999,
                  overflow: "hidden",
                  background: "#edf1f5",
                }}
              >
                {displayItems.map((item, index) => {
                  const widthPct =
                    totalTokens > 0 ? (item.count / totalTokens) * 100 : 0;
                  return (
                    <div
                      key={item.label}
                      title={`${item.label}: ${formatTokens(item.count)}`}
                      style={{
                        width: `${widthPct}%`,
                        minWidth: widthPct > 0 ? 2 : 0,
                        background:
                          TOKEN_CONSUMPTION_COLORS[
                            index % TOKEN_CONSUMPTION_COLORS.length
                          ],
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 8,
              marginTop: 12,
            }}
          >
            {displayItems.map((item, index) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.82em",
                  color: "#1d1d1f",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background:
                      TOKEN_CONSUMPTION_COLORS[
                        index % TOKEN_CONSUMPTION_COLORS.length
                      ],
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    color: "#86868b",
                    fontWeight: 600,
                  }}
                >
                  {formatTokens(item.count)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TokenTrendSection({
  tokenTrend,
  range,
  view,
  dayCount,
  onToggleView,
}: {
  tokenTrend: DashboardTokenTrendContract;
  range: DashboardRangeContract;
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
  range,
  view,
  dayCount,
  onToggleView,
}: {
  subagentTrend: DashboardSubagentTrendContract;
  range: DashboardRangeContract;
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
  const range: DashboardRangeContract =
    appliedSelection.preset === "today"
      ? "day"
      : appliedSelection.preset === "last30d"
        ? "month"
        : "week";

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

  const handleRangeSelect = React.useCallback(
    (preset: DashboardPresetId) => {
      applyController(
        applyDashboardDraftSelection(
          setDashboardDraftPreset(selectionController, preset),
        ),
      );
    },
    [applyController, selectionController],
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
          Activity (selected range)
        </h2>
        <ActivityHeatmap
          days={data.heatmapDays}
          startDay={appliedSelection.bounds.startDayInclusive}
          endDay={appliedSelection.bounds.endDayInclusive}
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
        range={range}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 7. Subagent Activity */}
      <SubagentTrendSection
        subagentTrend={data.subagentTrend}
        range={range}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 8. Active Repositories */}
      <ActiveReposSection repos={data.activeRepos} />

      {/* 9-14. Model views, usage, tools, MCP (CSS-only bars) */}
      <div className="charts-grid">
        <ModelPerformanceSection items={data.modelPerformance} />
        <ModelTokenConsumptionSection items={data.modelTokenConsumption} />
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
