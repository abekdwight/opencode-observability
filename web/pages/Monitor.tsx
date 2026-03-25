import React from "react";
import { Link } from "react-router-dom";
import { MONITOR_TIMELINE_SELECTORS } from "../../src/contracts/monitor-timeline.js";
import { Disclosure } from "../components/Disclosure";
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
import { formatTimestamp } from "../lib/format";

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
      className="timeline-chart-wrap"
      data-testid={MONITOR_TIMELINE_SELECTORS.PREVIEW(sessionId)}
    >
      {/* ── Degraded state with NO cached data → full-replacement text ── */}
      {isDegraded && !hasCachedEvents ? (
        feedState === "reconnecting" ? (
          <p
            className="timeline-preview-pending timeline-preview-reconnecting"
            data-testid={MONITOR_TIMELINE_SELECTORS.FEED_STATE}
            data-state="reconnecting"
          >
            ⟳ Reconnecting to live timeline…
          </p>
        ) : (
          <p
            className="timeline-preview-pending timeline-preview-disconnected"
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
            <span
              className={`timeline-feed-badge ${feedState === "reconnecting" ? "timeline-feed-badge--reconnecting" : "timeline-feed-badge--disconnected"}`}
              data-testid={MONITOR_TIMELINE_SELECTORS.FEED_STATE}
              data-state={feedState}
            >
              {feedState === "reconnecting"
                ? "⟳ Reconnecting"
                : "■ Disconnected"}
            </span>
          ) : null}

          <svg
            className="timeline-chart-svg"
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Session activity timeline"
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
          evictedSessionIds: timeline.evictedSessionIds,
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
        hasTrimmedEvents: timeline.evictedSessionIds.has(session.id),
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
    <section className="surface">
      {data ? (
        <div className="metrics-grid">
          <article className="metric-card">
            <p className="metric-label">Active Sessions</p>
            <p className="metric-value">{activeRealSessions.length}</p>
            <p className="metric-sub">sessions</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Alert Events</p>
            <p className="metric-value">{alertEvents}</p>
            <p className="metric-sub">model/token/network/limit</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Main Compactions</p>
            <p className="metric-value">{data.compactionCounts.main}</p>
            <p className="metric-sub">main sessions</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Subagent Compactions</p>
            <p className="metric-value">{data.compactionCounts.subagent}</p>
            <p className="metric-sub">subagent sessions</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Total Compactions</p>
            <p className="metric-value">{data.compactionCounts.total}</p>
            <p className="metric-sub">all sessions</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Feed Status</p>
            <p className="metric-value">
              {liveState === "live" ? "Live" : "Degraded"}
            </p>
            <p className="metric-sub">{formatTimestamp(data.generatedAt)}</p>
          </article>
        </div>
      ) : null}

      {liveState === "degraded" ? (
        <p className="state state-warning" data-testid="route-live-degraded">
          Live updates degraded. Reconnecting to the observability stream.
        </p>
      ) : null}

      {loading ? (
        <p className="state" data-testid="route-loading">
          Loading monitor snapshot...
        </p>
      ) : null}

      {error ? (
        <p className="state state-error" data-testid="route-error">
          Monitor API unavailable: {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="card">
            <div className="section-header">
              <h2>Recent Sessions</h2>
              <div className="monitor-section-meta-block">
                <p className="section-meta">{timelineStatus}</p>
                {timeline.liveOnlyNotice ? (
                  <p className="monitor-timeline-note">
                    Live-only timeline from this page load
                  </p>
                ) : null}
              </div>
            </div>
            <div className="timeline-legend">
              {TIMELINE_OPERATOR_LANES.map((lane) => (
                <span className="timeline-legend-item" key={lane}>
                  <span
                    className={`timeline-legend-swatch timeline-legend-swatch--${lane}`}
                    aria-hidden="true"
                  />
                  {LANE_LABELS[lane]}
                </span>
              ))}
            </div>
            <div className="recent-list">
              {sessionCards.length === 0 ? (
                <p className="empty-copy">
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
                    hasTrimmedEvents,
                  }) => {
                    return (
                      <div className="recent-item" key={session.id}>
                        <div className="recent-title-row">
                          <Link
                            className="recent-title"
                            to={`/session/${session.id}`}
                          >
                            {session.title}
                          </Link>
                        </div>
                        <div className="recent-meta">
                          <span className="recent-dir">
                            {session.directory}
                          </span>
                          <span>{formatTimestamp(session.updatedAt)}</span>
                        </div>
                        <div className="timeline-card-status-row">
                          {latestActionableEvent ? (
                            <p
                              className={`timeline-incident-note timeline-incident-note--${latestActionableLane}`}
                            >
                              <strong>
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
                            <p className="timeline-incident-note timeline-incident-note--quiet">
                              No intervention signals in the last 5 minutes
                            </p>
                          )}
                          {hasTrimmedEvents ? (
                            <span className="timeline-trimmed-badge">
                              Older events trimmed
                            </span>
                          ) : null}
                        </div>
                        <dl className="stats compact-stats">
                          <div>
                            <dt>Messages</dt>
                            <dd>{session.messageCount}</dd>
                          </div>
                          <div>
                            <dt>Tools</dt>
                            <dd>{session.toolCallCount}</dd>
                          </div>
                          <div>
                            <dt>Compactions</dt>
                            <dd>{session.compactionCount}</dd>
                          </div>
                          <div>
                            <dt>Subagents</dt>
                            <dd>{session.subagentCount}</dd>
                          </div>
                        </dl>
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

          <Disclosure
            label="Monitor Signals &amp; Usage Detail"
            testId="monitor-secondary-details"
          >
            <section className="card">
              <div className="section-header">
                <h2>Monitor Signals</h2>
                <p className="section-meta">
                  {formatTimestamp(data.generatedAt)}
                </p>
              </div>
              <dl className="stats stats-wide">
                {data.signalBadges.map((badge) => (
                  <div key={badge.key}>
                    <dt>{badge.label}</dt>
                    <dd>{badge.count}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </Disclosure>
        </>
      ) : null}
    </section>
  );
}
