import React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  DirectorySessionsContract,
  DirectorySessionsSort,
} from "../../src/contracts/directories";
import { SessionCopyButton } from "../components/SessionCopyButton";
import { useJson } from "../hooks/useJson";
import {
  formatDurationShort,
  formatTimestampShort,
  formatTokens,
} from "../lib/format";

const SORT_LABELS: Record<DirectorySessionsSort, string> = {
  date: "日付",
  tokens: "トークン",
  messages: "メッセージ",
};

export function DirectorySessions() {
  const { directory } = useParams<{ directory: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = (searchParams.get("sort") as DirectorySessionsSort) || "date";
  const filterQuery = searchParams.get("filter") || "";

  const apiUrl = `/api/dir/${encodeURIComponent(directory ?? "")}?sort=${sort}&filter=${encodeURIComponent(filterQuery)}`;

  const { data, error, loading } = useJson<DirectorySessionsContract>(apiUrl);

  const [localFilter, setLocalFilter] = React.useState(filterQuery);

  // Debounce filter into URL
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (localFilter) {
        params.set("filter", localFilter);
      } else {
        params.delete("filter");
      }
      setSearchParams(params, { replace: true });
    }, 300);
    return () => clearTimeout(timeout);
  }, [localFilter, searchParams, setSearchParams]);

  const handleSort = (newSort: DirectorySessionsSort) => {
    const params = new URLSearchParams(searchParams);
    params.set("sort", newSort);
    setSearchParams(params, { replace: true });
  };

  // Prettify directory for breadcrumb (simple ~ replacement)
  const prettyDir = data?.directory ?? directory ?? "";

  return (
    <section className="surface">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <Link to="/directories">Directories</Link>
        <span className="sep">/</span>
        <span>{prettyDir}</span>
      </div>

      <section className="card">
        <div className="section-header">
          <h2>Sessions</h2>
        </div>

        <div className="dir-controls">
          <input
            className="dir-filter-input"
            type="text"
            placeholder="Filter by title..."
            value={localFilter}
            onChange={(e) => setLocalFilter(e.target.value)}
          />
          {(["date", "tokens", "messages"] as DirectorySessionsSort[]).map(
            (s) => (
              <button
                key={s}
                type="button"
                className={`dir-sort-btn${sort === s ? " active" : ""}`}
                onClick={() => handleSort(s)}
              >
                {SORT_LABELS[s]}
              </button>
            ),
          )}
        </div>

        {loading ? (
          <p className="state" data-testid="route-loading">
            Loading sessions...
          </p>
        ) : null}

        {error ? (
          <p className="state state-error" data-testid="route-error">
            Failed to load sessions: {error}
          </p>
        ) : null}

        {data && data.sessions.length === 0 ? (
          <p className="empty-copy">セッションはありません</p>
        ) : null}

        {data ? (
          <ul className="dir-session-list">
            {data.sessions.map((s) => {
              const fileStr =
                s.summary.files > 0
                  ? `${s.summary.files} files (+${s.summary.additions}/-${s.summary.deletions})`
                  : "";

              return (
                <li key={s.id} className="dir-session-row">
                  <div className="dir-session-card">
                    <div className="dir-session-title-row">
                      <Link
                        to={`/session/${encodeURIComponent(s.id)}`}
                        className="dir-session-title"
                      >
                        {s.title}
                      </Link>
                      <SessionCopyButton
                        sessionId={s.id}
                        directory={data.directory}
                      />
                    </div>
                    <Link
                      to={`/session/${encodeURIComponent(s.id)}`}
                      className="dir-session-meta-link"
                    >
                      <div className="dir-session-meta">
                        <span>{formatTimestampShort(s.createdAt)}</span>
                        <span className="meta-pill">
                          {formatDurationShort(s.durationMs)}
                        </span>
                        <span className="meta-pill">{s.messageCount} msgs</span>
                        <span className="meta-pill tokens">
                          {formatTokens(s.totalTokens)} tokens
                        </span>
                        {s.subagentCount > 0 ? (
                          <span className="meta-pill sub">
                            {s.subagentCount} subagents
                          </span>
                        ) : null}
                        {fileStr ? (
                          <span className="meta-pill files">{fileStr}</span>
                        ) : null}
                      </div>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
