import React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  DirectorySessionsContract,
  DirectorySessionsSort,
} from "../../../src/contracts/directories";
import { SessionCopyButton } from "../../components/session-copy-button";
import { useJson } from "../../hooks/use-json";
import { cn } from "../../lib/cn";
import {
  formatDurationShort,
  formatTimestampShort,
  formatTokens,
} from "../../lib/format";

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
    <section className="grid gap-2.5">
      <nav className="mb-4 text-[0.85em] text-[var(--color-text-secondary)]">
        <Link to="/" className="text-[var(--color-accent)]">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <Link to="/directories" className="text-[var(--color-accent)]">
          Directories
        </Link>
        <span className="mx-1.5">/</span>
        <span>{prettyDir}</span>
      </nav>

      <section className="p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="m-0 text-[1.15em] font-bold">Sessions</h2>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <input
            className="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] sm:w-auto sm:flex-1"
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
                className={cn(
                  "rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors",
                  sort === s &&
                    "bg-[var(--color-accent-bg)] text-[var(--color-accent)] border-[var(--color-accent)]",
                )}
                onClick={() => handleSort(s)}
              >
                {SORT_LABELS[s]}
              </button>
            ),
          )}
        </div>

        {loading ? (
          <p
            className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
            data-testid="route-loading"
          >
            Loading sessions...
          </p>
        ) : null}

        {error ? (
          <p
            className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
            data-testid="route-error"
          >
            Failed to load sessions: {error}
          </p>
        ) : null}

        {data && data.sessions.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            セッションはありません
          </p>
        ) : null}

        {data ? (
          <ul className="m-0 list-none p-0">
            {data.sessions.map((s) => {
              const fileStr =
                s.summary.files > 0
                  ? `${s.summary.files} files (+${s.summary.additions}/-${s.summary.deletions})`
                  : "";

              return (
                <li key={s.id} className="group my-2.5">
                  <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 transition-all hover:border-[var(--color-accent)] hover:shadow-[0_2px_8px_rgba(99,102,241,0.12)]">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to={`/session/${encodeURIComponent(s.id)}`}
                        className="text-sm font-semibold text-[var(--color-accent)] hover:underline"
                      >
                        {s.title}
                      </Link>
                      <div className="opacity-0 transition-opacity group-hover:opacity-100">
                        <SessionCopyButton
                          sessionId={s.id}
                          directory={data.directory}
                        />
                      </div>
                    </div>
                    <Link
                      to={`/session/${encodeURIComponent(s.id)}`}
                      className="block text-inherit no-underline hover:no-underline"
                    >
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                        <span>{formatTimestampShort(s.createdAt)}</span>
                        <span className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 font-medium text-[var(--color-text-secondary)]">
                          {formatDurationShort(s.durationMs)}
                        </span>
                        <span className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 font-medium text-[var(--color-text-secondary)]">
                          {s.messageCount} msgs
                        </span>
                        <span className="rounded-md bg-[var(--color-warning-bg)] px-2 py-0.5 font-medium text-[var(--color-warning-text)]">
                          {formatTokens(s.totalTokens)} tokens
                        </span>
                        {s.subagentCount > 0 ? (
                          <span className="rounded-md bg-[var(--color-success-bg)] px-2 py-0.5 font-medium text-[var(--color-success)]">
                            {s.subagentCount} subagents
                          </span>
                        ) : null}
                        {fileStr ? (
                          <span className="rounded-md bg-[var(--color-success-bg)] px-2 py-0.5 font-medium text-[var(--color-success)]">
                            {fileStr}
                          </span>
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
