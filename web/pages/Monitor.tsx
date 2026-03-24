import { Link } from "react-router-dom";
import { Disclosure } from "../components/Disclosure";
import { useMonitorFeed } from "../hooks/useMonitorFeed";
import { formatTimestamp } from "../lib/format";

export function Monitor() {
  const { data, error, loading, liveState } = useMonitorFeed();

  const idleTerminals = data
    ? data.activeRootSessions.filter((s) => s.title === "OpenCode terminal")
        .length
    : 0;
  const visibleSessions = data
    ? data.activeRootSessions.filter((s) => s.title !== "OpenCode terminal")
    : [];
  const alertEvents = data
    ? (data.signalBadges.find((badge) => badge.key === "alerts")?.count ?? 0)
    : 0;

  return (
    <section className="surface">
      {data ? (
        <div className="metrics-grid">
          <article className="metric-card">
            <p className="metric-label">Active Sessions</p>
            <p className="metric-value">{data.activeRootSessions.length}</p>
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
              <h2>
                Recent Sessions
                {idleTerminals > 0 ? (
                  <span
                    className="section-meta"
                    style={{
                      marginLeft: 8,
                      fontSize: "0.6em",
                      fontWeight: 400,
                    }}
                  >
                    +{idleTerminals} idle
                  </span>
                ) : null}
              </h2>
              <p className="section-meta">
                {liveState === "live"
                  ? "Live monitor feed connected"
                  : "Observability stream reconnecting"}
              </p>
            </div>
            <div className="recent-list">
              {visibleSessions.length === 0 ? (
                <p className="empty-copy">No active sessions</p>
              ) : (
                visibleSessions.map((session) => (
                  <Link
                    className="recent-item"
                    key={session.id}
                    to={`/session/${session.id}`}
                  >
                    <div className="recent-title-row">
                      <span className="recent-title">{session.title}</span>
                    </div>
                    <div className="recent-meta">
                      <span className="recent-dir">{session.directory}</span>
                      <span>{formatTimestamp(session.updatedAt)}</span>
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
                  </Link>
                ))
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
