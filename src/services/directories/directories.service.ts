import { getDb } from "../../lib/db.js";
import { resolveRepoBucketKey } from "../../lib/repo-root.js";
import { prettifyPath } from "../../lib/text-format.js";

export interface RepoGroup {
  name: string;
  rawWorktree: string;
  prettyWorktree: string;
  iconColor: string | null;
  dirs: Map<
    string,
    {
      count: number;
      rawDir: string;
      worktree: string;
      prettyWorktree: string;
    }
  >;
  totalCount: number;
  latestTime: number;
}

interface DirectoryRow {
  repo_root: string;
  project_name: string | null;
  icon_color: string | null;
  directory: string;
  session_count: number;
  latest_time: number;
}

export function listRepoGroups(): RepoGroup[] {
  const db = getDb();
  try {
    const rows = db
      .prepare(`
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
    `)
      .all() as DirectoryRow[];

    const repoMap = new Map<string, RepoGroup>();

    for (const row of rows) {
      const key = resolveRepoBucketKey(row.repo_root, row.directory);

      if (!repoMap.has(key)) {
        const prettyWorktree = prettifyPath(key);
        let name: string;
        if (row.repo_root !== "/" && row.project_name) {
          name = row.project_name;
        } else {
          const segments = key.replace(/[\\/]+$/, "").split(/[\\/]/);
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

      const group = repoMap.get(key);
      if (!group) continue;

      const prettyDir = prettifyPath(row.directory);
      group.dirs.set(prettyDir, {
        count: row.session_count,
        rawDir: row.directory,
        worktree: row.repo_root,
        prettyWorktree: prettifyPath(row.repo_root),
      });
      group.totalCount += row.session_count;
      const ts =
        typeof row.latest_time === "number"
          ? row.latest_time
          : Number(row.latest_time);
      if (ts > group.latestTime) {
        group.latestTime = ts;
      }
    }

    return Array.from(repoMap.values()).sort(
      (a, b) => b.latestTime - a.latestTime,
    );
  } finally {
    db.close();
  }
}
