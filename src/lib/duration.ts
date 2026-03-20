import { resolveRepoBucketKey } from './repo-root.js';
type SqliteDatabase = import('better-sqlite3').Database;

export function calcSessionActiveDurations(
  db: SqliteDatabase,
  sessionIds: string[],
): Map<string, number> {
  if (sessionIds.length === 0) return new Map();
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db.prepare(`
    WITH ordered AS (
      SELECT
        m.session_id,
        json_extract(m.data, '$.role') AS role,
        m.time_created AS ts,
        LAG(m.time_created) OVER (PARTITION BY m.session_id ORDER BY m.time_created) AS prev_ts
      FROM message m
      WHERE m.session_id IN (${placeholders})
    )
    SELECT
      session_id,
      SUM(CASE WHEN role = 'assistant' AND prev_ts IS NOT NULL THEN ts - prev_ts ELSE 0 END) AS active_ms
    FROM ordered
    GROUP BY session_id
  `).all(...sessionIds) as { session_id: string; active_ms: number }[];
  return new Map(rows.map(r => [r.session_id, r.active_ms]));
}

export function calcRepoDayActiveDurations(
  db: SqliteDatabase,
  repositories: string[],
  days: string[],
): Map<string, number> {
  if (repositories.length === 0 || days.length === 0) return new Map();
  const dayPlaceholders = days.map(() => '?').join(',');
  const rows = db.prepare(`
    WITH root_sessions AS (
      SELECT s.id, p.worktree AS worktree, s.directory AS directory
      FROM session s
      JOIN project p ON s.project_id = p.id
      WHERE s.parent_id IS NULL
    ),
    ordered AS (
      SELECT
        rs.worktree AS worktree,
        rs.directory AS directory,
        date(m.time_created/1000, 'unixepoch', 'localtime') AS day,
        json_extract(m.data, '$.role') AS role,
        m.time_created AS ts,
        LAG(m.time_created) OVER (PARTITION BY m.session_id ORDER BY m.time_created) AS prev_ts
      FROM message m
      JOIN root_sessions rs ON rs.id = m.session_id
    )
    SELECT
      worktree,
      directory,
      day,
      SUM(CASE WHEN role = 'assistant' AND prev_ts IS NOT NULL THEN ts - prev_ts ELSE 0 END) AS active_ms
    FROM ordered
    WHERE day IN (${dayPlaceholders})
    GROUP BY worktree, directory, day
  `).all(...days) as { worktree: string | null; directory: string | null; day: string; active_ms: number }[];

  const repoSet = new Set(repositories);
  const result = new Map<string, number>();
  for (const { worktree, directory, day, active_ms } of rows) {
    const repo = resolveRepoBucketKey(worktree ?? '', directory ?? '');
    if (!repoSet.has(repo)) continue;
    const key = `${repo}\t${day}`;
    result.set(key, (result.get(key) || 0) + active_ms);
  }
  return result;
}
