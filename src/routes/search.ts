import type { Request, Response } from 'express';
import { getDb } from '../lib/db.js';
import { escapeHtml, NAV_SEARCH, prettifyPath } from '../lib/html.js';

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number | string;
  snippet?: string;
}

function highlightKeyword(text: string, keyword: string): string {
  if (!keyword) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedKeyword = escapeHtml(keyword);
  // Case-insensitive replace — build a regex from the escaped keyword literal
  const re = new RegExp(escapedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return escaped.replace(re, '<mark>$&</mark>');
}

export function searchRoute(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const safeQ = escapeHtml(q);

  if (!q) {
    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search - OpenCode Telemetry</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1 { font-size: 1.4em; font-weight: 700; margin-bottom: 16px; }
    .search-form { display: flex; gap: 8px; margin-bottom: 24px; }
    .search-input { flex: 1; padding: 10px 16px; border-radius: 10px; border: 1px solid #d2d2d7; font-size: 1em; font-family: inherit; outline: none; transition: border-color 0.15s; }
    .search-input:focus { border-color: #0066cc; }
    .search-btn { padding: 10px 20px; border-radius: 10px; border: none; background: #0066cc; color: white; font-size: 0.95em; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s; }
    .search-btn:hover { background: #0055b3; }
    .hint { color: #86868b; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Search Sessions</h1>
  ${NAV_SEARCH}
  <form class="search-form" action="/search" method="get">
    <input class="search-input" type="text" name="q" placeholder="Enter keyword to search session titles and messages..." autofocus />
    <button class="search-btn" type="submit">Search</button>
  </form>
  <p class="hint">Search across session titles and message content.</p>
</body>
</html>
    `);
    return;
  }

  const db = getDb();
  try {
    const like = `%${q}%`;

    const titleRows = db.prepare(`
      SELECT id, title, directory, time_created
      FROM session
      WHERE parent_id IS NULL AND title LIKE ?
      ORDER BY time_created DESC
      LIMIT 30
    `).all(like) as SessionRow[];

    const contentRows = db.prepare(`
      SELECT DISTINCT s.id, s.title, s.directory, s.time_created,
        substr(json_extract(p.data, '$.text'), max(1, instr(lower(json_extract(p.data, '$.text')), lower(?)) - 40), 120) as snippet
      FROM part p
      JOIN message m ON p.message_id = m.id
      JOIN session s ON m.session_id = s.id
      WHERE s.parent_id IS NULL
        AND json_extract(p.data, '$.type') = 'text'
        AND json_extract(p.data, '$.text') LIKE ?
      ORDER BY s.time_created DESC
      LIMIT 30
    `).all(q, like) as SessionRow[];

    // Merge: title matches first, then content matches; deduplicate by id
    const seen = new Set<string>();
    const results: (SessionRow & { matchType: 'title' | 'content' })[] = [];

    for (const row of titleRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push({ ...row, matchType: 'title' });
      }
    }
    for (const row of contentRows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push({ ...row, matchType: 'content' });
      }
    }

    const resultsHtml = results.map(r => {
      const date = new Date(Number(r.time_created)).toLocaleString('ja-JP', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      const highlightedTitle = highlightKeyword(r.title || '(no title)', q);
      const snippetHtml = r.snippet
        ? `<div class="snippet">…${highlightKeyword(r.snippet, q)}…</div>`
        : '';

      return `
<a class="result-card" href="/session/${encodeURIComponent(r.id)}">
  <div class="result-title">${highlightedTitle}</div>
  <div class="result-dir">${escapeHtml(prettifyPath(r.directory))}</div>
  ${snippetHtml}
  <div class="result-date">${date}</div>
</a>`;
    }).join('\n');

    const countLabel = results.length === 0
      ? 'No results found.'
      : `${results.length} result${results.length === 1 ? '' : 's'} for <strong>&ldquo;${safeQ}&rdquo;</strong>`;

    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search: ${safeQ} - OpenCode Telemetry</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1 { font-size: 1.4em; font-weight: 700; margin-bottom: 16px; }
    .search-form { display: flex; gap: 8px; margin-bottom: 20px; }
    .search-input { flex: 1; padding: 10px 16px; border-radius: 10px; border: 1px solid #d2d2d7; font-size: 1em; font-family: inherit; outline: none; transition: border-color 0.15s; }
    .search-input:focus { border-color: #0066cc; }
    .search-btn { padding: 10px 20px; border-radius: 10px; border: none; background: #0066cc; color: white; font-size: 0.95em; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s; }
    .search-btn:hover { background: #0055b3; }
    .result-count { font-size: 0.9em; color: #86868b; margin-bottom: 20px; }
    .result-card { display: block; background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 16px 20px; margin-bottom: 12px; transition: border-color 0.15s, box-shadow 0.15s; color: inherit; }
    .result-card:hover { border-color: #0066cc; box-shadow: 0 2px 8px rgba(0,102,204,0.08); text-decoration: none; }
    .result-title { font-size: 1.05em; font-weight: 600; color: #1d1d1f; margin-bottom: 4px; }
    .result-dir { font-size: 0.8em; color: #86868b; font-family: 'SF Mono', 'Fira Code', monospace; margin-bottom: 6px; }
    .snippet { font-size: 0.88em; color: #3a3a3c; background: #f5f5f7; border-radius: 6px; padding: 6px 10px; margin-bottom: 6px; line-height: 1.5; word-break: break-word; }
    .result-date { font-size: 0.78em; color: #86868b; }
    mark { background: #fff176; color: inherit; border-radius: 2px; padding: 0 1px; }
    .no-results { background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 40px 24px; text-align: center; color: #86868b; }
  </style>
</head>
<body>
  <h1>Search Sessions</h1>
  ${NAV_SEARCH}
  <form class="search-form" action="/search" method="get">
    <input class="search-input" type="text" name="q" value="${safeQ}" autofocus />
    <button class="search-btn" type="submit">Search</button>
  </form>
  <div class="result-count">${countLabel}</div>
  ${results.length === 0
    ? `<div class="no-results">No sessions matched &ldquo;${safeQ}&rdquo;.</div>`
    : resultsHtml}
</body>
</html>
    `);
  } finally {
    db.close();
  }
}
