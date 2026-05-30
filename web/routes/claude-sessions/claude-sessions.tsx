import { Link } from "react-router-dom";
import type { ClaudeSessionsContract } from "../../../src/contracts/claude-sessions";
import { useJson } from "../../hooks/use-json";
import { formatTimestampShort, formatTokens } from "../../lib/format";

export function ClaudeSessionsPage() {
  const { data, error, loading } = useJson<ClaudeSessionsContract>(
    "/api/claude-sessions",
  );

  return (
    <section className="min-w-0 grid gap-2.5">
      <section className="min-w-0 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[1.3em] font-bold">Claude Code Sessions</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Claude Code の session history をローカルの transcript
              ファイルから表示します。
            </p>
          </div>
        </div>

        {loading ? (
          <p
            className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
            data-testid="route-loading"
          >
            Loading Claude sessions...
          </p>
        ) : null}

        {error ? (
          <p
            className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
            data-testid="route-error"
          >
            Failed to load Claude sessions: {error}
          </p>
        ) : null}

        {data && !data.source.available ? (
          <p className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            Claude transcript directory not found at ~/.claude/projects
          </p>
        ) : null}

        {data && data.source.available && data.sessions.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Claude sessions are not recorded yet.
          </p>
        ) : null}

        {data && data.source.available ? (
          <ul className="m-0 list-none p-0 min-w-0">
            {data.sessions.map((session) => (
              <li key={session.id} className="group my-2.5 min-w-0">
                <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4 transition-all hover:border-[var(--color-accent)] hover:shadow-[0_2px_8px_rgba(99,102,241,0.12)] min-w-0">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <Link
                      to={`/claude-sessions/${encodeURIComponent(session.id)}`}
                      className="min-w-0 truncate text-sm font-semibold text-[var(--color-accent)] hover:underline"
                    >
                      {session.title}
                    </Link>
                  </div>
                  <p className="mt-1.5 truncate font-mono text-xs text-[var(--color-text-tertiary)]">
                    {session.cwd}
                    {session.gitBranch ? ` · ${session.gitBranch}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                    <span>{formatTimestampShort(session.updatedAt)}</span>
                    {session.model ? (
                      <span className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 font-medium">
                        {session.model}
                      </span>
                    ) : null}
                    <span className="rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 font-medium">
                      {session.messageCount} msgs
                    </span>
                    <span className="rounded-md bg-[var(--color-warning-bg)] px-2 py-0.5 font-medium text-[var(--color-warning-text)]">
                      {formatTokens(session.tokensUsed)} tokens
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
