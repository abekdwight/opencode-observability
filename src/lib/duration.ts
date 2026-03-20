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
  const repoPlaceholders = repositories.map(() => '?').join(',');
  const dayPlaceholders = days.map(() => '?').join(',');
  const rows = db.prepare(`
    WITH root_sessions AS (
      SELECT id, directory
      FROM session
      WHERE parent_id IS NULL
        AND directory IN (${repoPlaceholders})
    ),
    ordered AS (
      SELECT
        rs.directory AS directory,
        date(m.time_created/1000, 'unixepoch', 'localtime') AS day,
        json_extract(m.data, '$.role') AS role,
        m.time_created AS ts,
        LAG(m.time_created) OVER (PARTITION BY m.session_id ORDER BY m.time_created) AS prev_ts
      FROM message m
      JOIN root_sessions rs ON rs.id = m.session_id
    )
    SELECT
      directory,
      day,
      SUM(CASE WHEN role = 'assistant' AND prev_ts IS NOT NULL THEN ts - prev_ts ELSE 0 END) AS active_ms
    FROM ordered
    WHERE day IN (${dayPlaceholders})
    GROUP BY directory, day
  `).all(...repositories, ...days) as { directory: string; day: string; active_ms: number }[];
  return new Map(rows.map(r => [`${r.directory}\t${r.day}`, r.active_ms]));
}
