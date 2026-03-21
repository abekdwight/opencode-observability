import { Link } from "react-router-dom";
import type {
  DirectoriesContract,
  RepoGroupContract,
} from "../../src/contracts/directories";
import { useJson } from "../hooks/useJson";

export function Directories() {
  const { data, error, loading } =
    useJson<DirectoriesContract>("/api/directories");

  return (
    <section className="surface">
      {loading ? (
        <p className="state" data-testid="route-loading">
          Loading directories...
        </p>
      ) : null}

      {error ? (
        <p className="state state-error" data-testid="route-error">
          Failed to load directories: {error}
        </p>
      ) : null}

      {data
        ? data.repoGroups.map((repo) => (
            <RepoSection key={repo.rawWorktree} repo={repo} />
          ))
        : null}

      {data && data.repoGroups.length === 0 ? (
        <p className="empty-copy">No directories found.</p>
      ) : null}
    </section>
  );
}

function RepoSection({ repo }: { repo: RepoGroupContract }) {
  return (
    <div className="repo-section" data-testid="repo-section">
      <div className="repo-header" title={repo.rawWorktree}>
        {repo.iconColor ? (
          <span className="repo-icon" style={{ background: repo.iconColor }} />
        ) : null}
        <span className="dir-repo-name">
          {repo.name}
          {repo.prettyWorktree !== repo.name ? (
            <span className="repo-path">{repo.prettyWorktree}</span>
          ) : null}
        </span>
        <span className="repo-count">{repo.totalCount}</span>
      </div>
      <ul className="repo-dir-list">
        {repo.directories.map((dir) => (
          <li key={dir.rawDirectory} className="repo-dir-item">
            <Link to={`/dir/${encodeURIComponent(dir.rawDirectory)}`}>
              <span className="dir-name">{dir.prettyDirectory}</span>
              <span className="session-count">{dir.sessionCount} sessions</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
