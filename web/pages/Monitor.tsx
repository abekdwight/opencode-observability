import React from "react";
import { Link } from "react-router-dom";
import { MONITOR_TIMELINE_SELECTORS } from "../../src/contracts/monitor-timeline.js";
import { Badge } from "../components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible";
import { MetricCard } from "../components/ui/metric-card";
import { MetricGrid } from "../components/ui/metric-grid";
import { isLegacySourceSession, useMonitorFeed } from "../hooks/useMonitorFeed";
import {
  bucketizeEvents,
  classifyEventLane,
  selectSessionEvents,
  TIMELINE_BUCKET_COUNT,
  TIMELINE_BUCKET_MS,
  TIMELINE_OPERATOR_LANES,
  type TimelineBucket,
  type TimelineOperatorLane,
  useMonitorTimelineFeed,
} from "../hooks/useMonitorTimelineFeed";
import { formatTimestamp, formatTokens } from "../lib/format";

// ---------------------------------------------------------------------------
// SVG chart constants — reference-dashboard chart-lane style
// ---------------------------------------------------------------------------

/** How often (ms) the chart re-renders to slide the time window. */
const CHART_TICK_INTERVAL_MS = 2_000;

/** SVG viewBox dimensions — wider for timeline clarity. */
const SVG_WIDTH = 720;
const SVG_HEIGHT = 72;

/** Left padding for the "ago" labels; right padding for the "Now" label. */
const SVG_PAD_LEFT = 28;
const SVG_PAD_RIGHT = 28;

/** Bottom area reserved for the time-axis labels. */
const AXIS_HEIGHT = 16;

/** Top inset so bars don't touch the chart-lane border. */
const SVG_PAD_TOP = 4;

/** Computed chart lane dimensions. */
const CHART_WIDTH = SVG_WIDTH - SVG_PAD_LEFT - SVG_PAD_RIGHT;
const CHART_HEIGHT = SVG_HEIGHT - SVG_PAD_TOP - AXIS_HEIGHT;

/** Bar geometry. */
const BAR_GAP = 0.6;
const BAR_STEP = CHART_WIDTH / TIMELINE_BUCKET_COUNT;
const BAR_WIDTH = Math.max(BAR_STEP - BAR_GAP, 1);

/** Operator lane → colour mapping (muted activity, vivid pressure/failure). */
const LANE_COLORS: Record<TimelineOperatorLane, string> = {
  activity: "#a1a1a6",
  subagent: "#3b82f6",
  pressure: "#f59e0b",
  failure: "#ef4444",
};

/** Horizontal gridline y-fractions (25 %, 50 %, 75 % of chart height). */
const H_GRID_FRACTIONS = [0.25, 0.5, 0.75];

const LANE_LABELS: Record<TimelineOperatorLane, string> = {
  activity: "Activity",
  subagent: "Subagent",
  pressure: "Pressure",
  failure: "Failure",
};

/** Vertical gridlines: minute offsets from the right edge, with labels. */
const V_GRID = [
  { offsetMs: 60_000, label: "1m" },
  { offsetMs: 120_000, label: "2m" },
  { offsetMs: 180_000, label: "3m" },
  { offsetMs: 240_000, label: "4m" },
];

type MonitorTokenView = "model" | "agent-model";

interface TokenUsageDisplayRow {
  scope: "main" | "subagent";
  agent: string;
  modelId: string;
  providerId: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  inputRatioPercent: number;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function buildTokenUsageDisplayRows(
  rows: TokenUsageDisplayRow[],
  view: MonitorTokenView,
): TokenUsageDisplayRow[] {
  if (view === "agent-model") {
    return [...rows].sort(
      (left, right) => right.totalTokens - left.totalTokens,
    );
  }

  const grouped = new Map<string, TokenUsageDisplayRow>();
  for (const row of rows) {
    const key = [row.scope, row.providerId, row.modelId].join("::");
    const current = grouped.get(key);
    if (current) {
      current.messageCount += row.messageCount;
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.cacheReadTokens += row.cacheReadTokens;
      current.cacheWriteTokens += row.cacheWriteTokens;
      current.totalTokens += row.totalTokens;
      const denominator = current.inputTokens + current.outputTokens;
      current.inputRatioPercent =
        denominator > 0 ? (current.inputTokens / denominator) * 100 : 0;
    } else {
      grouped.set(key, { ...row, agent: "all" });
    }
  }

  return Array.from(grouped.values()).sort(
    (left, right) => right.totalTokens - left.totalTokens,
  );
}

// ---------------------------------------------------------------------------
// InlineTimeSeriesChart — reference-dashboard-style SVG chart lane
// ---------------------------------------------------------------------------

interface InlineTimeSeriesChartProps {
  buckets: TimelineBucket[];
  maxTotal: number;
  feedState: string;
  sessionId: string;
  /** True when the session has any cached events (even if outside the visible window). */
  hasCachedEvents: boolean;
}

function formatRelativeAge(msDiff: number): string {
  const seconds = Math.max(0, Math.floor(msDiff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatTimelineFeedStatus(
  feedState: string,
  lastHeartbeatAt: string | null,
  nowMs: number,
): string {
  if (!lastHeartbeatAt) {
    return feedState === "live"
      ? "Timeline live · awaiting heartbeat"
      : `Timeline ${feedState}`;
  }
  const ageMs = Math.max(0, nowMs - new Date(lastHeartbeatAt).getTime());
  const age = formatRelativeAge(ageMs);
  switch (feedState) {
    case "live":
      return `Timeline live · heartbeat ${age}`;
    case "reconnecting":
      return `Timeline reconnecting · last heartbeat ${age}`;
    case "disconnected":
      return `Timeline disconnected · last heartbeat ${age}`;
    case "loading":
      return "Timeline loading";
    default:
      return `Timeline ${feedState}`;
  }
}

function InlineTimeSeriesChart({
  buckets,
  maxTotal,
  feedState,
  sessionId,
  hasCachedEvents,
}: InlineTimeSeriesChartProps) {
  const effectiveMax = Math.max(maxTotal, 1);
  const chartTop = SVG_PAD_TOP;
  const chartBottom = SVG_PAD_TOP + CHART_HEIGHT;
  const axisY = SVG_HEIGHT - 2; // baseline for axis text

  // Show the SVG chart whenever cached data exists, even during
  // reconnecting/disconnected — feed-state is shown as an overlay badge.
  const isDegraded =
    feedState === "reconnecting" || feedState === "disconnected";

  return (
    <div
      className="mt-2 w-full rounded-lg bg-[var(--color-bg-muted)] border border-[var(--color-border-faint)] p-1.5 overflow-hidden relative"
      data-testid={MONITOR_TIMELINE_SELECTORS.PREVIEW(sessionId)}
    >
      {/* ── Degraded state with NO cached data → full-replacement text ── */}
      {isDegraded && !hasCachedEvents ? (
        feedState === "reconnecting" ? (
          <p
            className="py-4 px-3 text-center text-xs text-[var(--color-warning-text)] italic"
            data-testid={MONITOR_TIMELINE_SELECTORS.FEED_STATE}
            data-state="reconnecting"
          >
            ⟳ Reconnecting to live timeline…
          </p>
        ) : (
          <p
            className="py-4 px-3 text-center text-xs text-[var(--color-error-text)] italic"
            data-testid={MONITOR_TIMELINE_SELECTORS.FEED_STATE}
            data-state="disconnected"
          >
            ■ Live timeline disconnected
          </p>
        )
      ) : (
        <>
          {/* ── Degraded state WITH cached data → overlay badge ── */}
          {isDegraded ? (
            <Badge
              variant={feedState === "reconnecting" ? "warning" : "error"}
              className="absolute top-2 right-2 z-[1] text-[0.65em] font-medium"
              data-testid={MONITOR_TIMELINE_SELECTORS.FEED_STATE}
              data-state={feedState}
            >
              {feedState === "reconnecting"
                ? "⟳ Reconnecting"
                : "■ Disconnected"}
            </Badge>
          ) : null}

          <svg
            className="block w-full"
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Session activity timeline"
            style={{ height: 72 }}
          >
            {/* ── Chart lane background ── */}
            <rect
              x={SVG_PAD_LEFT}
              y={chartTop}
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
              fill="#f8f8fa"
              rx="2"
            />

            {/* ── Horizontal gridlines (25/50/75 %) ── */}
            {H_GRID_FRACTIONS.map((frac) => {
              const y = chartBottom - frac * CHART_HEIGHT;
              return (
                <line
                  key={frac}
                  x1={SVG_PAD_LEFT}
                  y1={y}
                  x2={SVG_PAD_LEFT + CHART_WIDTH}
                  y2={y}
                  stroke="#ececef"
                  strokeWidth="0.5"
                />
              );
            })}

            {/* ── Baseline at bottom of chart lane ── */}
            <line
              x1={SVG_PAD_LEFT}
              y1={chartBottom}
              x2={SVG_PAD_LEFT + CHART_WIDTH}
              y2={chartBottom}
              stroke="#d8d8dc"
              strokeWidth="0.75"
            />

            {/* ── Vertical minute gridlines + axis labels ── */}
            {V_GRID.map(({ offsetMs, label }) => {
              const bucketOffset = offsetMs / TIMELINE_BUCKET_MS;
              const x =
                SVG_PAD_LEFT +
                (TIMELINE_BUCKET_COUNT - bucketOffset) * BAR_STEP;
              if (x < SVG_PAD_LEFT) return null;
              return (
                <g key={offsetMs}>
                  <line
                    x1={x}
                    y1={chartTop}
                    x2={x}
                    y2={chartBottom}
                    stroke="#dcdce0"
                    strokeWidth="0.5"
                    strokeDasharray="3,2"
                  />
                  <text
                    x={x}
                    y={axisY}
                    textAnchor="middle"
                    fill="#a1a1a6"
                    fontSize="7.5"
                    fontFamily="system-ui, sans-serif"
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {/* ── Stacked operator-lane bars — one rect per non-zero lane ── */}
            {buckets.map((bucket) => {
              const barX = SVG_PAD_LEFT + bucket.index * BAR_STEP;
              let yOffset = 0;
              return (
                <g key={bucket.index}>
                  {TIMELINE_OPERATOR_LANES.map((lane) => {
                    const count = bucket.counts[lane];
                    if (count === 0) return null;
                    const barHeight = (count / effectiveMax) * CHART_HEIGHT;
                    const y = chartBottom - yOffset - barHeight;
                    yOffset += barHeight;
                    return (
                      <rect
                        key={lane}
                        x={barX}
                        y={y}
                        width={BAR_WIDTH}
                        height={barHeight}
                        fill={LANE_COLORS[lane]}
                        rx="0.5"
                        opacity={
                          lane === "activity"
                            ? 0.45
                            : lane === "subagent"
                              ? 0.65
                              : 0.85
                        }
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* ── "Now" label — right edge of the axis ── */}
            <text
              x={SVG_PAD_LEFT + CHART_WIDTH + 2}
              y={axisY}
              textAnchor="start"
              fill="#1d1d1f"
              fontSize="7.5"
              fontWeight="600"
              fontFamily="system-ui, sans-serif"
            >
              Now
            </text>

            {/* ── "5 min ago" label — left edge of the axis ── */}
            <text
              x={SVG_PAD_LEFT - 2}
              y={axisY}
              textAnchor="end"
              fill="#a1a1a6"
              fontSize="7"
              fontFamily="system-ui, sans-serif"
            >
              5m
            </text>
          </svg>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitor page
// ---------------------------------------------------------------------------

export function Monitor() {
  const { data, retainedSessions, error, loading, liveState } =
    useMonitorFeed();
  const timeline = useMonitorTimelineFeed({ sourceKey: "monitor" });
  const [tokenView, setTokenView] = React.useState<MonitorTokenView>("model");

  // Tick counter to slide the chart window forward in real-time
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(
      () => setNowMs(Date.now()),
      CHART_TICK_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const activeRealSessions = data
    ? data.activeRootSessions.filter(
        (session) => !isLegacySourceSession(session),
      )
    : [];
  const alertEvents = data
    ? (data.signalBadges.find((badge) => badge.key === "alerts")?.count ?? 0)
    : 0;
  const timelineStatus = formatTimelineFeedStatus(
    timeline.feedState,
    timeline.lastHeartbeatAt,
    nowMs,
  );

  const sessionCards = retainedSessions
    .map((session) => {
      const events = selectSessionEvents(
        {
          feedState: timeline.feedState,
          cache: timeline.cache,
          lastHeartbeatAt: timeline.lastHeartbeatAt,
          liveOnlyNotice: timeline.liveOnlyNotice,
        },
        session.id,
      );
      const buckets = bucketizeEvents(events, nowMs);
      const maxTotal = Math.max(...buckets.map((b) => b.total), 0);
      const actionableEvents = [...events].reverse().filter((event) => {
        const lane = classifyEventLane(event);
        return lane === "failure" || lane === "pressure";
      });
      const latestActionableEvent = actionableEvents[0] ?? null;
      const latestActionableLane = latestActionableEvent
        ? classifyEventLane(latestActionableEvent)
        : null;
      const latestActionableAge = latestActionableEvent
        ? formatRelativeAge(
            Math.max(0, nowMs - new Date(latestActionableEvent.at).getTime()),
          )
        : null;
      const priority =
        latestActionableLane === "failure"
          ? 2
          : latestActionableLane === "pressure"
            ? 1
            : 0;

      return {
        session,
        events,
        buckets,
        maxTotal,
        latestActionableEvent,
        latestActionableLane,
        latestActionableAge,
        priority,
      };
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const aTs = a.latestActionableEvent
        ? new Date(a.latestActionableEvent.at).getTime()
        : new Date(a.session.updatedAt).getTime();
      const bTs = b.latestActionableEvent
        ? new Date(b.latestActionableEvent.at).getTime()
        : new Date(b.session.updatedAt).getTime();
      return bTs - aTs;
    });

  return (
    <section className="space-y-4">
      {data ? (
        <MetricGrid>
          <MetricCard
            label="Active Sessions"
            value={activeRealSessions.length}
            sub="sessions"
          />
          <MetricCard
            label="Alert Events"
            value={alertEvents}
            sub="model/token/network/limit"
          />
          <MetricCard
            label="Main Compactions"
            value={data.compactionCounts.main}
            sub="main sessions"
          />
          <MetricCard
            label="Subagent Compactions"
            value={data.compactionCounts.subagent}
            sub="subagent sessions"
          />
          <MetricCard
            label="Total Compactions"
            value={data.compactionCounts.total}
            sub="all sessions"
          />
          <MetricCard
            label="Feed Status"
            value={liveState === "live" ? "Live" : "Degraded"}
            sub={formatTimestamp(data.generatedAt)}
          />
        </MetricGrid>
      ) : null}

      {liveState === "degraded" ? (
        <p
          className="rounded-lg border border-[var(--color-warning-bg)] bg-[var(--color-warning-bg)] px-4 py-2 text-sm text-[var(--color-warning-text)]"
          data-testid="route-live-degraded"
        >
          Live updates degraded. Reconnecting to the observability stream.
        </p>
      ) : null}

      {loading ? (
        <p
          className="py-6 text-center text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading monitor snapshot...
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-2 text-sm text-[var(--color-error-text)]"
          data-testid="route-error"
        >
          Monitor API unavailable: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
            <div className="flex justify-between items-start gap-3 mb-2">
              <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                Recent Sessions
              </h2>
              <div className="flex flex-col items-end gap-0.5">
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {timelineStatus}
                </p>
                {timeline.liveOnlyNotice ? (
                  <p className="text-[0.7rem] text-[var(--color-text-tertiary)] italic">
                    Live-only timeline from this page load
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 gap-x-3.5 mt-3 mb-1">
              {TIMELINE_OPERATOR_LANES.map((lane) => (
                <span
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"
                  key={lane}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    aria-hidden="true"
                    style={{ background: LANE_COLORS[lane] }}
                  />
                  {LANE_LABELS[lane]}
                </span>
              ))}
            </div>
            <div className="mt-3 space-y-3">
              {sessionCards.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">
                  No sessions seen during this page load
                </p>
              ) : (
                sessionCards.map(
                  ({
                    session,
                    events,
                    buckets,
                    maxTotal,
                    latestActionableEvent,
                    latestActionableLane,
                    latestActionableAge,
                  }) => {
                    return (
                      <div
                        className="rounded-lg border border-[var(--color-border-faint)] bg-[var(--color-bg-surface)] p-3 transition-colors hover:border-[var(--color-border-default)]"
                        key={session.id}
                      >
                        <div className="mb-1">
                          <Link
                            className="text-sm font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors no-underline"
                            to={`/session/${session.id}`}
                          >
                            {session.title}
                          </Link>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] mb-2">
                          <span className="font-mono text-[0.7rem] text-[var(--color-text-tertiary)] truncate max-w-[260px]">
                            {session.directory}
                          </span>
                          <span>{formatTimestamp(session.updatedAt)}</span>
                        </div>
                        <div className="mb-2">
                          {latestActionableEvent ? (
                            <p
                              className={`flex items-center gap-2 text-xs ${
                                latestActionableLane === "failure"
                                  ? "text-[var(--color-error-text)]"
                                  : latestActionableLane === "pressure"
                                    ? "text-[var(--color-warning-text)]"
                                    : "text-[var(--color-text-secondary)]"
                              }`}
                            >
                              <strong className="font-semibold">
                                {
                                  LANE_LABELS[
                                    latestActionableLane ?? "activity"
                                  ]
                                }
                              </strong>
                              <span>{latestActionableEvent.label}</span>
                              {latestActionableAge ? (
                                <span>{latestActionableAge}</span>
                              ) : null}
                            </p>
                          ) : (
                            <p className="text-xs text-[var(--color-text-tertiary)] italic">
                              No intervention signals in the last 5 minutes
                            </p>
                          )}
                        </div>
                        <dl className="grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-1 text-xs mb-2">
                          <div className="flex flex-col">
                            <dt className="text-[var(--color-text-secondary)]">
                              Messages
                            </dt>
                            <dd className="font-semibold text-[var(--color-text-primary)]">
                              {session.messageCount}
                            </dd>
                          </div>
                          <div className="flex flex-col">
                            <dt className="text-[var(--color-text-secondary)]">
                              Tools
                            </dt>
                            <dd className="font-semibold text-[var(--color-text-primary)]">
                              {session.toolCallCount}
                            </dd>
                          </div>
                          <div className="flex flex-col">
                            <dt className="text-[var(--color-text-secondary)]">
                              Compactions
                            </dt>
                            <dd className="font-semibold text-[var(--color-text-primary)]">
                              {session.compactionCount}
                            </dd>
                          </div>
                          <div className="flex flex-col">
                            <dt className="text-[var(--color-text-secondary)]">
                              Subagents
                            </dt>
                            <dd className="font-semibold text-[var(--color-text-primary)]">
                              {session.subagentCount}
                            </dd>
                          </div>
                          <div className="flex flex-col">
                            <dt className="text-[var(--color-text-secondary)]">
                              Input ratio
                            </dt>
                            <dd className="font-semibold text-[var(--color-text-primary)]">
                              {formatPercent(session.inputRatioPercent)}
                            </dd>
                          </div>
                        </dl>
                        <div className="flex justify-between items-center gap-3 flex-wrap my-2">
                          <div>
                            <strong className="text-[0.9em] font-semibold text-[var(--color-text-primary)]">
                              Model usage
                            </strong>
                            <span className="ml-2 text-[0.82em] text-[var(--color-text-secondary)]">
                              main / subagent split
                            </span>
                          </div>
                          <div
                            className="inline-flex rounded-lg border border-[var(--color-border-default)] overflow-hidden"
                            role="tablist"
                            aria-label="Monitor token usage view"
                          >
                            <button
                              type="button"
                              className={`px-3 py-1 text-xs font-medium transition-colors ${
                                tokenView === "model"
                                  ? "bg-[var(--color-accent)] text-white"
                                  : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                              }`}
                              onClick={() => setTokenView("model")}
                            >
                              Model
                            </button>
                            <button
                              type="button"
                              className={`px-3 py-1 text-xs font-medium transition-colors ${
                                tokenView === "agent-model"
                                  ? "bg-[var(--color-accent)] text-white"
                                  : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
                              }`}
                              onClick={() => setTokenView("agent-model")}
                            >
                              Agent × Model
                            </button>
                          </div>
                        </div>
                        {(["main", "subagent"] as const).map((scope) => {
                          const rows = buildTokenUsageDisplayRows(
                            session.tokenUsage,
                            tokenView,
                          ).filter((row) => row.scope === scope);
                          if (rows.length === 0) {
                            return null;
                          }

                          return (
                            <div key={scope} className="mb-2.5">
                              <div className="text-[0.82em] font-semibold text-[var(--color-text-secondary)] mb-1.5 uppercase tracking-wider">
                                {scope === "main" ? "Main" : "Subagent"}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr>
                                      <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2 border-b border-[var(--color-border-default)] py-1.5 px-2">
                                        {tokenView === "model"
                                          ? "Model"
                                          : "Agent × Model"}
                                      </th>
                                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2 border-b border-[var(--color-border-default)] py-1.5 px-2">
                                        Input
                                      </th>
                                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2 border-b border-[var(--color-border-default)] py-1.5 px-2">
                                        Output
                                      </th>
                                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2 border-b border-[var(--color-border-default)] py-1.5 px-2">
                                        Cache R
                                      </th>
                                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2 border-b border-[var(--color-border-default)] py-1.5 px-2">
                                        Cache W
                                      </th>
                                      <th className="text-right text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] pb-2 border-b border-[var(--color-border-default)] py-1.5 px-2">
                                        Input ratio
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row) => (
                                      <tr
                                        key={[
                                          scope,
                                          row.agent,
                                          row.providerId,
                                          row.modelId,
                                        ].join("::")}
                                        className="border-b border-[var(--color-border-faint)]"
                                      >
                                        <td className="py-2 px-2">
                                          {tokenView === "model"
                                            ? `${row.providerId}/${row.modelId}`
                                            : `${row.agent} × ${row.providerId}/${row.modelId}`}
                                        </td>
                                        <td className="text-right py-2 px-2">
                                          {formatTokens(row.inputTokens)}
                                        </td>
                                        <td className="text-right py-2 px-2">
                                          {formatTokens(row.outputTokens)}
                                        </td>
                                        <td className="text-right py-2 px-2">
                                          {formatTokens(row.cacheReadTokens)}
                                        </td>
                                        <td className="text-right py-2 px-2">
                                          {formatTokens(row.cacheWriteTokens)}
                                        </td>
                                        <td className="text-right py-2 px-2 font-semibold">
                                          {formatPercent(row.inputRatioPercent)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                        <InlineTimeSeriesChart
                          buckets={buckets}
                          maxTotal={maxTotal}
                          feedState={timeline.feedState}
                          sessionId={session.id}
                          hasCachedEvents={events.length > 0}
                        />
                      </div>
                    );
                  },
                )
              )}
            </div>
          </section>

          <Collapsible defaultOpen={false} data-testid="monitor-secondary-details">
            <CollapsibleTrigger
              className="flex items-center gap-2 w-full p-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-colors"
              data-testid="monitor-secondary-details-toggle"
            >
              <span className="text-xs">▶</span>
              Monitor Signals &amp; Usage Detail
            </CollapsibleTrigger>
            <CollapsibleContent data-testid="monitor-secondary-details-content">
              <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 mt-2">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                    Monitor Signals
                  </h2>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {formatTimestamp(data.generatedAt)}
                  </p>
                </div>
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 text-sm">
                  {data.signalBadges.map((badge) => (
                    <div
                      key={badge.key}
                      className="flex flex-col gap-0.5 rounded-lg bg-[var(--color-bg-muted)] p-2"
                    >
                      <dt className="text-xs text-[var(--color-text-secondary)]">
                        {badge.label}
                      </dt>
                      <dd className="text-lg font-bold text-[var(--color-text-primary)]">
                        {badge.count}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}
    </section>
  );
}
