import type { Request, Response } from 'express';
import { getDb } from '../lib/db.js';
import { escapeHtml, NAV_SEARCH, prettifyPath } from '../lib/html.js';
import { resolveRepoBucketKey } from '../lib/repo-root.js';

interface RepoGroup {
  /** Display name derived from the last path segment of the bucket path */
  name: string;
  /** Raw bucket path for tooltip */
  rawWorktree: string;
  /** Prettified bucket path */
  prettyWorktree: string;
  /** project.icon_color if available */
  iconColor: string | null;
  /** Map of directory → { count, rawDir } */
  dirs: Map<string, { count: number; rawDir: string }>;
  /** Sum of all directory session counts */
  totalCount: number;
  /** Latest session timestamp across all dirs */
  latestTime: number;
}

export function homeRoute(_req: Request, res: Response) {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT
        p.worktree   AS repo_root,
        p.name        AS project_name,
        p.icon_color  AS icon_color,
        s.directory   AS directory,
        COUNT(*)      AS session_count,
        MAX(s.time_created) AS latest_time
      FROM session s
      JOIN project p ON s.project_id = p.id
      WHERE s.parent_id IS NULL
      GROUP BY p.worktree, s.directory
      ORDER BY latest_time DESC
    `).all() as {
      repo_root: string;
      project_name: string | null;
      icon_color: string | null;
      directory: string;
      session_count: number;
      latest_time: number;
    }[];

    // Build repo → directories tree
    const repoMap = new Map<string, RepoGroup>();

    for (const row of rows) {
      const key = resolveRepoBucketKey(row.repo_root, row.directory);

      if (!repoMap.has(key)) {
        const prettyWorktree = prettifyPath(key);
        // Derive display name: use project.name for repo buckets, otherwise last path segment.
        let name: string;
        if (row.repo_root !== '/' && row.project_name) {
          name = row.project_name;
        } else {
          const segments = key.replace(/[\\/]+$/, '').split(/[\\/]/);
          name = segments[segments.length - 1] || key;
        }

        repoMap.set(key, {
          name,
          rawWorktree: key,
          prettyWorktree,
          iconColor: row.icon_color,
          dirs: new Map(),
          totalCount: 0,
          latestTime: 0,
        });
      }

      const group = repoMap.get(key)!;
      const prettyDir = prettifyPath(row.directory);
      group.dirs.set(prettyDir, { count: row.session_count, rawDir: row.directory });
      group.totalCount += row.session_count;
      const ts = typeof row.latest_time === 'number' ? row.latest_time : Number(row.latest_time);
      if (ts > group.latestTime) {
        group.latestTime = ts;
      }
    }

    const sortedRepos = Array.from(repoMap.values()).sort((a, b) => b.latestTime - a.latestTime);

    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Directories - OpenCode Telemetry</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    h1 { font-size: 1.6em; font-weight: 700; margin-bottom: 8px; padding-bottom: 12px; border-bottom: 2px solid #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .repo-section { margin: 20px 0; background: white; border-radius: 12px; border: 1px solid #d2d2d7; overflow: hidden; }
    .repo-header { font-size: 1.05em; font-weight: 700; color: #1d1d1f; padding: 14px 20px; background: #f5f5f7; border-bottom: 1px solid #d2d2d7; display: flex; align-items: center; gap: 8px; cursor: default; }
    .repo-icon { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .repo-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-path { font-size: 0.75em; font-weight: 400; color: #86868b; font-family: 'SF Mono', 'Fira Code', monospace; margin-left: 4px; }
    .repo-count { font-size: 0.8em; font-weight: 500; color: #86868b; background: #e5e5e5; padding: 2px 10px; border-radius: 10px; flex-shrink: 0; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { border-bottom: 1px solid #f0f0f0; }
    li:last-child { border-bottom: none; }
    li a { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; transition: background 0.15s; }
    li a:hover { background: #f5f5f7; text-decoration: none; }
    .dir-name { font-weight: 500; color: #1d1d1f; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9em; }
    .session-count { color: #86868b; font-size: 0.85em; flex-shrink: 0; }
  </style>
</head>
<body>
  <h1>Directories</h1>
  ${NAV_SEARCH}
  ${sortedRepos.map((repo) => {
    const sortedDirs = Array.from(repo.dirs.entries())
      .sort(([, a], [, b]) => b.count - a.count);

    const iconHtml = repo.iconColor
      ? `<span class="repo-icon" style="background:${escapeHtml(repo.iconColor)}"></span>`
      : '';

    const pathHtml = repo.prettyWorktree !== repo.name
      ? `<span class="repo-path">${escapeHtml(repo.prettyWorktree)}</span>`
      : '';

    return `
    <div class="repo-section">
      <div class="repo-header" title="${escapeHtml(repo.rawWorktree)}">
        ${iconHtml}
        <span class="repo-name">${escapeHtml(repo.name)}${pathHtml}</span>
        <span class="repo-count">${repo.totalCount}</span>
      </div>
      <ul>
        ${sortedDirs.map(([prettyDir, { count, rawDir }]) => `
          <li><a href="/dir/${encodeURIComponent(rawDir)}">
            <span class="dir-name">${escapeHtml(prettyDir)}</span>
            <span class="session-count">${count} sessions</span>
          </a></li>
        `).join('')}
      </ul>
    </div>
  `;
  }).join('')}
</body>
</html>
    `);
  } finally {
    db.close();
  }
}
