import type { Request, Response } from 'express';
import { getDb } from '../lib/db.js';
import { calcSessionActiveDurations } from '../lib/duration.js';
import {
  NAV_SEARCH,
  SESSION_COPY_SCRIPT,
  SESSION_COPY_STYLES,
  escapeHtml,
  formatDurationShort,
  formatTokens,
  prettifyPath,
  renderSessionCopyButton,
} from '../lib/html.js';

export function directoryRoute(req: Request, res: Response) {
  const db = getDb();
  try {
    const { directory } = req.params;
    const decodedDir = directory;

    const sessions = db.prepare(`
      SELECT s.id, s.title, s.time_created, s.time_updated,
             s.summary_additions, s.summary_deletions, s.summary_files
      FROM session s
      WHERE s.parent_id IS NULL
        AND s.directory = ?
      ORDER BY s.time_created DESC
      LIMIT 50
    `).all(decodedDir) as {
      id: string;
      title: string;
      time_created: number;
      time_updated: number;
      summary_additions: number;
      summary_deletions: number;
      summary_files: number;
    }[];

    if (sessions.length === 0) {
      res.send(buildPage(decodedDir, [], new Map(), new Map(), new Map(), new Map()));
      return;
    }

    const ids = sessions.map(s => s.id);
    const placeholders = ids.map(() => '?').join(',');

    const msgCounts = db.prepare(`
      SELECT m.session_id, COUNT(*) as msg_count
      FROM message m WHERE m.session_id IN (${placeholders})
      GROUP BY m.session_id
    `).all(...ids) as { session_id: string; msg_count: number }[];
    const msgCountMap = new Map(msgCounts.map(c => [c.session_id, c.msg_count]));

    const tokenRows = db.prepare(`
      SELECT m.session_id, COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens
      FROM message m
      WHERE m.session_id IN (${placeholders})
        AND json_extract(m.data, '$.role') = 'assistant'
      GROUP BY m.session_id
    `).all(...ids) as { session_id: string; total_tokens: number }[];
    const tokenMap = new Map(tokenRows.map(r => [r.session_id, r.total_tokens]));

    const subCounts = db.prepare(`
      SELECT parent_id, COUNT(*) as cnt
      FROM session
      WHERE parent_id IN (${placeholders})
      GROUP BY parent_id
    `).all(...ids) as { parent_id: string; cnt: number }[];
    const subCountMap = new Map(subCounts.map(r => [r.parent_id, r.cnt]));

    const durationMap = calcSessionActiveDurations(db, ids);

    res.send(buildPage(decodedDir, sessions, msgCountMap, tokenMap, subCountMap, durationMap));
  } finally {
    db.close();
  }
}

function buildPage(
  dir: string,
  sessions: {
    id: string;
    title: string;
    time_created: number;
    time_updated: number;
    summary_additions: number;
    summary_deletions: number;
    summary_files: number;
  }[],
  msgCountMap: Map<string, number>,
  tokenMap: Map<string, number>,
  subCountMap: Map<string, number>,
  durationMap: Map<string, number>,
) {
  const prettyDir = prettifyPath(dir);
  const safePrettyDir = escapeHtml(prettyDir);
  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safePrettyDir} - Sessions</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .breadcrumb { font-size: 0.85em; color: #86868b; margin-bottom: 16px; }
    .breadcrumb a { color: #0066cc; }
    .breadcrumb .sep { margin: 0 6px; }
    h1 { font-size: 1.4em; font-weight: 700; margin-bottom: 12px; }
    .controls { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .search-input { padding: 6px 12px; border-radius: 8px; border: 1px solid #d2d2d7; font-size: 0.9em; width: 240px; }
    .sort-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid #d2d2d7; background: white; font-size: 0.8em; cursor: pointer; color: #1d1d1f; }
    .sort-btn:hover, .sort-btn.active { background: #0066cc; color: white; border-color: #0066cc; }
    ul { list-style: none; padding: 0; }
    li.session-row { margin: 10px 0; display: flex; align-items: stretch; gap: 8px; }
    .session-row-link { flex: 1; display: block; padding: 16px 20px; background: white; border-radius: 10px; border: 1px solid #d2d2d7; transition: box-shadow 0.15s, border-color 0.15s; }
    .session-row-link:hover { text-decoration: none; border-color: #0066cc; box-shadow: 0 2px 8px rgba(0,102,204,0.08); }
    .session-title { font-weight: 600; font-size: 1.05em; color: #1d1d1f; margin-bottom: 8px; }
    .session-meta { color: #86868b; font-size: 0.82em; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .meta-pill { background: #f0f0f0; padding: 2px 8px; border-radius: 6px; }
    .meta-pill.tokens { background: #fff3e0; color: #e65100; }
    .meta-pill.files { background: #e8f5e9; color: #2e7d32; }
    .meta-pill.sub { background: #e3f2fd; color: #1565c0; }
${SESSION_COPY_STYLES}
  </style>
</head>
<body>
  <div class="breadcrumb">
    <a href="/">Home</a><span class="sep">/</span>
    <span>${safePrettyDir}</span>
  </div>
  ${NAV_SEARCH}
  <h1>Sessions</h1>

  <div class="controls">
    <input class="search-input" type="text" id="filter-input" placeholder="Filter by title..." oninput="filterList()">
    <button class="sort-btn active" data-sort="date" onclick="sortList('date')">日付</button>
    <button class="sort-btn" data-sort="tokens" onclick="sortList('tokens')">トークン</button>
    <button class="sort-btn" data-sort="messages" onclick="sortList('messages')">メッセージ</button>
  </div>

  ${sessions.length === 0 ? '<p>セッションはありません</p>' : ''}
  <ul id="session-list">
    ${sessions.map(s => {
      const safeTitle = escapeHtml(s.title);
      const dateStr = new Date(Number(s.time_created)).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const msgCount = msgCountMap.get(s.id) || 0;
      const tokens = tokenMap.get(s.id) || 0;
      const subCount = subCountMap.get(s.id) || 0;
      const durationMs = durationMap.get(s.id) || 0;
      const durationStr = formatDurationShort(durationMs);
      const fileStr = s.summary_files > 0 ? `${s.summary_files} files (+${s.summary_additions}/-${s.summary_deletions})` : '';

      return `
       <li class="session-row" data-title="${escapeHtml(s.title.toLowerCase())}" data-tokens="${tokens}" data-messages="${msgCount}" data-date="${s.time_created}">
         <a href="/session/${encodeURIComponent(s.id)}" class="session-row-link">
           <div class="session-title">${safeTitle}</div>
           <div class="session-meta">
              <span>${dateStr}</span>
             <span class="meta-pill">${durationStr}</span>
             <span class="meta-pill">${msgCount} msgs</span>
             <span class="meta-pill tokens">${formatTokens(tokens)} tokens</span>
             ${subCount > 0 ? `<span class="meta-pill sub">${subCount} subagents</span>` : ''}
             ${fileStr ? `<span class="meta-pill files">${fileStr}</span>` : ''}
           </div>
         </a>
         ${renderSessionCopyButton(s.id, dir)}
       </li>
      `;
    }).join('')}
  </ul>

  <script>
    ${SESSION_COPY_SCRIPT}

    function filterList() {
      const q = document.getElementById('filter-input').value.toLowerCase();
      document.querySelectorAll('#session-list li').forEach(li => {
        li.style.display = li.dataset.title.includes(q) ? '' : 'none';
      });
    }
    function sortList(key) {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === key));
      const ul = document.getElementById('session-list');
      const items = Array.from(ul.children);
      items.sort((a, b) => {
        const av = Number(a.dataset[key]);
        const bv = Number(b.dataset[key]);
        return bv - av;
      });
      items.forEach(li => ul.appendChild(li));
    }
  </script>
</body>
</html>
  `;
}
