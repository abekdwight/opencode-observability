import { Link } from "react-router-dom";
import type {
  DirectoriesContract,
  RepoGroupContract,
} from "../../../src/contracts/directories";
import { useJson } from "../../hooks/use-json";

export function Directories() {
  const { data, error, loading } =
    useJson<DirectoriesContract>("/api/directories");

  return (
    <section className="grid gap-2.5">
      {loading ? (
        <p
          className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading directories...
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Failed to load directories: {error}
        </p>
      ) : null}

      {data
        ? data.repoGroups.map((repo) => (
            <RepoSection key={repo.rawWorktree} repo={repo} />
          ))
        : null}

      {data && data.repoGroups.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No directories found.
        </p>
      ) : null}
    </section>
  );
}

function RepoSection({ repo }: { repo: RepoGroupContract }) {
  return (
    <div
      className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4"
      data-testid="repo-section"
    >
      <div
        className="flex items-center gap-2 text-[1.05em] font-bold"
        title={repo.rawWorktree}
      >
        {repo.iconColor ? (
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: repo.iconColor }}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          {repo.name}
          {repo.prettyWorktree !== repo.name ? (
            <span className="ml-2 text-[0.75em] font-normal text-[var(--color-text-secondary)]">
              {repo.prettyWorktree}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--color-bg-muted)] px-2 py-0.5 text-[0.8em] font-medium text-[var(--color-text-secondary)]">
          {repo.totalCount}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {repo.directories.map((dir) => (
          <li
            key={dir.rawDirectory}
            className="border-b border-[var(--color-border-faint)] last:border-b-0"
          >
            <Link
              to={`/dir/${encodeURIComponent(dir.rawDirectory)}`}
              className="flex items-center justify-between px-1 py-2.5 text-sm no-underline transition-colors hover:bg-[var(--color-bg-page)] hover:no-underline"
            >
              <span className="font-medium text-[var(--color-text-primary)]">
                {dir.prettyDirectory}
              </span>
              <span className="text-[0.85em] text-[var(--color-text-secondary)]">
                {dir.sessionCount} sessions
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
