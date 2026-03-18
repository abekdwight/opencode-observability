import type { Request, Response } from 'express';
import { getDb } from '../lib/db.js';
import { NAV_SEARCH } from '../lib/html.js';

export function homeRoute(_req: Request, res: Response) {
  const db = getDb();
  try {
    const sessionGroups = db.prepare(`
      SELECT directory, COUNT(*) as session_count, MAX(time_created) as latest_time
      FROM session
      WHERE parent_id IS NULL
      GROUP BY directory
      ORDER BY latest_time DESC
    `).all() as { directory: string; session_count: number; latest_time: string | number }[];

    const dirTree: Map<string, { dirs: Map<string, number>, totalCount: number }> = new Map();

    for (const { directory, session_count } of sessionGroups) {
      const parts = directory.split('/');
      if (parts.length < 2) continue;

      const root = parts[0];
      const subdir = parts.slice(1).join('/');

      if (!dirTree.has(root)) {
        dirTree.set(root, { dirs: new Map(), totalCount: 0 });
      }
      const rootEntry = dirTree.get(root)!;
      rootEntry.dirs.set(subdir, session_count);
      rootEntry.totalCount += session_count;
    }

    const sortedRoots = Array.from(dirTree.entries())
      .sort(([, a], [, b]) => b.totalCount - a.totalCount);

    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Telemetry</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    h1 { font-size: 1.6em; font-weight: 700; margin-bottom: 8px; padding-bottom: 12px; border-bottom: 2px solid #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .root-section { margin: 20px 0; background: white; border-radius: 12px; border: 1px solid #d2d2d7; overflow: hidden; }
    .root-title { font-size: 1.05em; font-weight: 700; color: #1d1d1f; padding: 14px 20px; background: #f5f5f7; border-bottom: 1px solid #d2d2d7; display: flex; align-items: center; gap: 8px; }
    .root-count { font-size: 0.8em; font-weight: 500; color: #86868b; background: #e5e5e5; padding: 2px 10px; border-radius: 10px; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { border-bottom: 1px solid #f0f0f0; }
    li:last-child { border-bottom: none; }
    li a { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; transition: background 0.15s; }
    li a:hover { background: #f5f5f7; text-decoration: none; }
    .dir-name { font-weight: 500; color: #1d1d1f; }
    .session-count { color: #86868b; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>OpenCode Telemetry</h1>
  ${NAV_SEARCH}
  ${sortedRoots.map(([root, { dirs, totalCount }]) => `
    <div class="root-section">
      <div class="root-title">
        <span>${root}</span>
        <span class="root-count">${totalCount}</span>
      </div>
      <ul>
        ${Array.from(dirs.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([subdir, count]) => `
          <li><a href="/dir/${encodeURIComponent(root + '/' + subdir)}">
            <span class="dir-name">${subdir}</span>
            <span class="session-count">${count} sessions</span>
          </a></li>
        `).join('')}
      </ul>
    </div>
  `).join('')}
</body>
</html>
    `);
  } finally {
    db.close();
  }
}
