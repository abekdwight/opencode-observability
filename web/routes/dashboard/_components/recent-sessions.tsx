import { Link } from "react-router-dom";
import type { DashboardContract } from "../../../../src/contracts/dashboard";
import { formatTokens, prettifyPath } from "../_lib/formatters";

export function RecentSessions({
  sessions,
}: {
  sessions: DashboardContract["recentSessions"];
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
        Recent Sessions
      </h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No sessions found
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sessions.map((session) => {
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
                className="block rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-bg-elevated)] hover:no-underline"
              >
                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                  {session.title || "(no title)"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <span>{dateStr}</span>
                  <span className="rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5">
                    {tokens} tokens
                  </span>
                  <span className="truncate text-[var(--color-text-tertiary)]">
                    {prettifyPath(session.directory || "")}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <Link
        to="/directories"
        className="mt-3 block text-xs font-medium text-[var(--color-accent)]"
      >
        All directories &rarr;
      </Link>
    </section>
  );
}
