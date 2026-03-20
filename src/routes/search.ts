import type { Request, Response } from 'express';
import { getDb } from '../lib/db.js';
import {
  SESSION_COPY_SCRIPT,
  SESSION_COPY_STYLES,
  escapeHtml,
  formatTokens,
  NAV_SEARCH,
  prettifyPath,
  renderSessionCopyButton,
} from '../lib/html.js';

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number | string;
  snippet?: string;
}

function splitSearchTerms(query: string): string[] {
  return Array.from(new Set(query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)));
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

function buildLikePattern(term: string): string {
  return `%${escapeLikeWildcards(term)}%`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightKeywords(text: string, terms: string[]): string {
  if (!terms.length) return escapeHtml(text);

  const uniqueTerms = Array.from(new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0)));
  if (!uniqueTerms.length) return escapeHtml(text);

  const escapedText = escapeHtml(text);
  const escapedTerms = uniqueTerms.map(escapeRegExp);
  const re = new RegExp(escapedTerms.join('|'), 'gi');
  return escapedText.replace(re, '<mark>$&</mark>');
}

function buildAndSearchClause(searchTerms: string[]): { whereClause: string; params: string[] } {
  const params = searchTerms.flatMap((term) => {
    const like = buildLikePattern(term);
    return [like, like];
  });

  const whereClause = searchTerms
    .map(() => `(
      lower(s.title) LIKE lower(?) ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM part p
        WHERE p.session_id = s.id
          AND json_extract(p.data, '$.type') = 'text'
          AND lower(json_extract(p.data, '$.text')) LIKE lower(?) ESCAPE '\\'
      )
    )`)
    .join(' AND ');

  return { whereClause, params };
}

function findFirstMatchIndex(text: string, searchTerms: string[]): number {
  const normalizedText = text.toLowerCase();
  let bestIndex = Number.POSITIVE_INFINITY;

  for (const term of searchTerms) {
    const idx = normalizedText.indexOf(term.toLowerCase());
    if (idx >= 0 && idx < bestIndex) {
      bestIndex = idx;
    }
  }

  return Number.isFinite(bestIndex) ? bestIndex : -1;
}

function countTermMatches(text: string, searchTerms: string[]): number {
  const normalizedText = text.toLowerCase();
  return searchTerms.reduce((count, term) => count + (normalizedText.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function extractSnippet(text: string, searchTerms: string[]): string | null {
  const firstMatchIndex = findFirstMatchIndex(text, searchTerms);
  if (firstMatchIndex < 0) return null;

  const start = Math.max(0, firstMatchIndex - 40);
  return text.slice(start, start + 120).trim();
}

function fetchSessionSnippet(db: ReturnType<typeof getDb>, sessionId: string, searchTerms: string[]): string | null {
  if (!searchTerms.length) return null;

  const anyMatchClause = searchTerms
    .map(() => `lower(json_extract(p.data, '$.text')) LIKE lower(?) ESCAPE '\\'`)
    .join(' OR ');

  const rows = db.prepare(`
    SELECT json_extract(p.data, '$.text') AS text
    FROM part p
    WHERE p.session_id = ?
      AND json_extract(p.data, '$.type') = 'text'
      AND (${anyMatchClause})
    LIMIT 12
  `).all(sessionId, ...searchTerms.map(buildLikePattern)) as { text: string | null }[];

  const bestMatch = rows
    .map((row) => {
      if (!row.text) return null;
      return {
        text: row.text,
        score: countTermMatches(row.text, searchTerms),
        firstMatchIndex: findFirstMatchIndex(row.text, searchTerms),
      };
    })
    .filter((row): row is { text: string; score: number; firstMatchIndex: number } => row !== null && row.firstMatchIndex >= 0)
    .sort((a, b) => b.score - a.score || a.firstMatchIndex - b.firstMatchIndex)[0];

  return bestMatch ? extractSnippet(bestMatch.text, searchTerms) : null;
}

export function searchRoute(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const safeQ = escapeHtml(q);
  const searchTerms = splitSearchTerms(q);

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
    .search-form { display: flex; gap: 8px; margin-bottom: 20px; }
    .search-input { flex: 1; padding: 10px 16px; border-radius: 10px; border: 1px solid #d2d2d7; font-size: 1em; font-family: inherit; outline: none; transition: border-color 0.15s; }
    .search-input:focus { border-color: #0066cc; }
    .search-btn { padding: 10px 20px; border-radius: 10px; border: none; background: #0066cc; color: white; font-size: 0.95em; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s; }
    .search-btn:hover { background: #0055b3; }
    .hint { color: #86868b; font-size: 0.9em; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Search Sessions</h1>
  ${NAV_SEARCH}
  <form class="search-form" action="/search" method="get">
    <input class="search-input" type="text" name="q" placeholder="Search titles and chat history" autofocus />
    <button class="search-btn" type="submit">Search</button>
  </form>
  <p class="hint">Matches titles and user/agent chat text. Separate words with spaces for AND.</p>
</body>
</html>
    `);
    return;
  }

  const db = getDb();
  try {
    const { whereClause, params } = buildAndSearchClause(searchTerms);

    const rows = db.prepare(`
      SELECT id, title, directory, time_created
      FROM session s
      WHERE s.parent_id IS NULL
        AND (${whereClause})
      ORDER BY s.time_created DESC
      LIMIT 30
    `).all(...params) as SessionRow[];

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const msgCountMap = new Map<string, number>();
    const tokenMap = new Map<string, number>();

    if (ids.length > 0) {
      const msgCounts = db.prepare(`
        SELECT m.session_id, COUNT(*) AS msg_count
        FROM message m WHERE m.session_id IN (${placeholders})
        GROUP BY m.session_id
      `).all(...ids) as { session_id: string; msg_count: number }[];
      for (const r of msgCounts) msgCountMap.set(r.session_id, r.msg_count);

      const tokenRows = db.prepare(`
        SELECT m.session_id, COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens
        FROM message m
        WHERE m.session_id IN (${placeholders})
          AND json_extract(m.data, '$.role') = 'assistant'
        GROUP BY m.session_id
      `).all(...ids) as { session_id: string; total_tokens: number }[];
      for (const r of tokenRows) tokenMap.set(r.session_id, r.total_tokens);
    }

    const results = rows.map((row) => ({
      ...row,
      snippet: fetchSessionSnippet(db, row.id, searchTerms) ?? undefined,
    }));

    const resultsHtml = results.map((r) => {
      const date = new Date(Number(r.time_created)).toLocaleString('ja-JP', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      const sessionHref = `/session/${encodeURIComponent(r.id)}`;
      const highlightedTitle = highlightKeywords(r.title || '(no title)', searchTerms);
      const snippetHtml = r.snippet
        ? `<div class="snippet">…${highlightKeywords(r.snippet, searchTerms)}…</div>`
        : '';

      return `
      <div class="result-card" data-session-dir="${escapeHtml(r.directory)}">
        <div class="result-title-row">
          <a class="result-title-link" href="${sessionHref}">
            <div class="result-title">${highlightedTitle}</div>
          </a>
          <div class="result-card-actions">
            ${renderSessionCopyButton(r.id, r.directory)}
          </div>
        </div>
        <a class="result-main" href="${sessionHref}">
          <div class="result-dir">${escapeHtml(prettifyPath(r.directory))}</div>
          ${snippetHtml}
          <div class="result-meta">
            <span>${date}</span>
            <span class="meta-pill">${msgCountMap.get(r.id) || 0} msgs</span>
            <span class="meta-pill">${formatTokens(tokenMap.get(r.id) || 0)} tokens</span>
          </div>
        </a>
      </div>`;
    }).join('\n');

    const countLabel = results.length === 0
      ? 'No results found.'
      : `${results.length} result${results.length === 1 ? '' : 's'} for <strong>&ldquo;${safeQ}&rdquo;</strong> (AND match)`;

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
    .result-card { display: flex; flex-direction: column; gap: 8px; background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 16px 20px; margin-bottom: 12px; transition: border-color 0.15s, box-shadow 0.15s; }
    .result-card:hover { border-color: #0066cc; box-shadow: 0 2px 8px rgba(0,102,204,0.08); }
    .result-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .result-title-link { color: inherit; flex: 1; min-width: 0; }
    .result-title-link:hover { text-decoration: none; }
    .result-title-link:hover .result-title { text-decoration: underline; }
    .result-main { display: block; color: inherit; }
    .result-title { font-size: 1.05em; font-weight: 600; color: #1d1d1f; margin: 0; }
    .result-dir { font-size: 0.8em; color: #86868b; font-family: 'SF Mono', 'Fira Code', monospace; margin-bottom: 6px; }
    .snippet { font-size: 0.88em; color: #3a3a3c; background: #f5f5f7; border-radius: 6px; padding: 6px 10px; margin-bottom: 6px; line-height: 1.5; word-break: break-word; }
    .result-meta { display: flex; align-items: center; gap: 8px; font-size: 0.78em; color: #86868b; flex-wrap: wrap; }
    .meta-pill { background: #f0f0f0; padding: 1px 7px; border-radius: 4px; font-weight: 500; }
    .result-card-actions { display: flex; flex-shrink: 0; }
    mark { background: #fff176; color: inherit; border-radius: 2px; padding: 0 1px; }
    .no-results { background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 40px 24px; text-align: center; color: #86868b; }
    .hint { color: #86868b; font-size: 0.9em; margin-bottom: 8px; }
${SESSION_COPY_STYLES}
  </style>
</head>
<body>
  <h1>Search Sessions</h1>
  ${NAV_SEARCH}
  <form class="search-form" action="/search" method="get">
    <input class="search-input" type="text" name="q" value="${safeQ}" placeholder="Search titles and chat history" autofocus />
    <button class="search-btn" type="submit">Search</button>
  </form>
  <p class="hint">Matches titles and user/agent chat text. Separate words with spaces for AND.</p>
  <div class="result-count">${countLabel}</div>
  ${results.length === 0
    ? `<div class="no-results">No sessions matched &ldquo;${safeQ}&rdquo;.</div>`
    : resultsHtml}
  <script>${SESSION_COPY_SCRIPT}</script>
</body>
</html>
    `);
  } finally {
    db.close();
  }
}
