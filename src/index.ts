import express from 'express';
import { marked } from 'marked';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 3737;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

interface Project {
  id: string;
  name: string | null;
  worktree: string;
  vcs: string | null;
}

interface Session {
  id: string;
  directory: string;
  title: string;
  time_created: string | number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time_created: string | number;
  model_id?: string;
  provider_id?: string;
  agent?: string;
  tool_message_id?: string;
}

interface SubagentInfo {
  id: string;
  title: string;
}

function getDb(): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
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

    for (const { directory, session_count, latest_time } of sessionGroups) {
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
    h1 { font-size: 1.6em; font-weight: 700; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid #1d1d1f; }
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
});

app.get('/dir/:directory(.*)', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const { directory } = req.params;
    const decodedDir = decodeURIComponent(directory);

    const sessions = db.prepare(`
      SELECT id, title, time_created
      FROM session
      WHERE parent_id IS NULL
        AND directory = ?
      ORDER BY time_created DESC
      LIMIT 50
    `).all(decodedDir) as Session[];

    const sessionCounts = db.prepare(`
      SELECT m.session_id, COUNT(*) as msg_count
      FROM message m
      WHERE m.session_id IN (${sessions.map(() => '?').join(',')})
      GROUP BY m.session_id
    `).all(...sessions.map(s => s.id)) as { session_id: string; msg_count: number }[];

    const countMap = new Map(sessionCounts.map(c => [c.session_id, c.msg_count]));

    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${decodedDir} - Sessions</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .breadcrumb { font-size: 0.85em; color: #86868b; margin-bottom: 16px; }
    .breadcrumb a { color: #0066cc; }
    .breadcrumb .sep { margin: 0 6px; }
    h1 { font-size: 1.4em; font-weight: 700; margin-bottom: 20px; }
    ul { list-style: none; padding: 0; }
    li { margin: 10px 0; }
    li a { display: block; padding: 16px 20px; background: white; border-radius: 10px; border: 1px solid #d2d2d7; transition: box-shadow 0.15s, border-color 0.15s; }
    li a:hover { text-decoration: none; border-color: #0066cc; box-shadow: 0 2px 8px rgba(0,102,204,0.08); }
    .session-title { font-weight: 600; font-size: 1.05em; color: #1d1d1f; margin-bottom: 6px; }
    .session-meta { color: #86868b; font-size: 0.85em; display: flex; gap: 12px; align-items: center; }
    .msg-count { background: #e8f4fd; color: #0066cc; padding: 2px 10px; border-radius: 10px; font-size: 0.82em; font-weight: 500; }
  </style>
</head>
<body>
  <div class="breadcrumb">
    <a href="/">Directories</a><span class="sep">/</span>
    <span>${decodedDir}</span>
  </div>
  <h1>Sessions</h1>
  ${sessions.length === 0 ? '<p>セッションはありません</p>' : ''}
  <ul>
    ${sessions.map(s => {
      const dateStr = new Date(Number(s.time_created)).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const msgCount = countMap.get(s.id) || 0;
      return `
      <li>
        <a href="/session/${s.id}">
          <div class="session-title">${s.title}</div>
          <div class="session-meta">
            <span>${dateStr}</span>
            <span class="msg-count">${msgCount} messages</span>
          </div>
        </a>
      </li>
      `;
    }).join('')}
  </ul>
</body>
</html>
    `);
  } finally {
    db.close();
  }
});

app.get('/session/:sessionId', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const { sessionId } = req.params;

    // Get session info
    const sessionInfo = db.prepare(`
      SELECT id, title, directory, time_created, time_updated, parent_id,
             summary_additions, summary_deletions, summary_files
      FROM session
      WHERE id = ?
    `).get(sessionId) as { id: string; title: string; directory: string; time_created: number; time_updated: number; parent_id: string | null; summary_additions: number; summary_deletions: number; summary_files: number } | undefined;

    if (!sessionInfo) {
      res.status(404).send('Session not found');
      return;
    }

    const createdDate = new Date(Number(sessionInfo.time_created)).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Metrics: message counts by role
    const roleCounts = db.prepare(`
      SELECT json_extract(m.data, '$.role') AS role, COUNT(*) AS cnt
      FROM message m
      WHERE m.session_id = ?
      GROUP BY role
    `).all(sessionId) as { role: string; cnt: number }[];
    const roleCountMap = new Map(roleCounts.map(r => [r.role, r.cnt]));
    const totalMessages = roleCounts.reduce((sum, r) => sum + r.cnt, 0);
    const userMessages = roleCountMap.get('user') || 0;
    const assistantMessages = roleCountMap.get('assistant') || 0;

    // Metrics: tool call count
    const toolCallCount = (db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM part p
      WHERE p.session_id = ?
        AND json_extract(p.data, '$.type') = 'tool'
    `).get(sessionId) as { cnt: number }).cnt;

    // Metrics: subagent count
    const subagentCount = (db.prepare(`
      SELECT COUNT(*) AS cnt FROM session WHERE parent_id = ?
    `).get(sessionId) as { cnt: number }).cnt;

    // Metrics: token usage and cost
    const tokenStats = db.prepare(`
      SELECT
        COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens,
        COALESCE(SUM(json_extract(m.data, '$.tokens.input')), 0) AS input_tokens,
        COALESCE(SUM(json_extract(m.data, '$.tokens.output')), 0) AS output_tokens,
        COALESCE(SUM(json_extract(m.data, '$.tokens.reasoning')), 0) AS reasoning_tokens,
        COALESCE(SUM(json_extract(m.data, '$.cost')), 0) AS total_cost
      FROM message m
      WHERE m.session_id = ?
        AND json_extract(m.data, '$.role') = 'assistant'
    `).get(sessionId) as { total_tokens: number; input_tokens: number; output_tokens: number; reasoning_tokens: number; total_cost: number };

    // Metrics: session duration
    const timeRange = db.prepare(`
      SELECT MIN(m.time_created) AS first_msg, MAX(m.time_created) AS last_msg
      FROM message m
      WHERE m.session_id = ?
    `).get(sessionId) as { first_msg: number; last_msg: number };
    const durationMs = timeRange.last_msg - timeRange.first_msg;
    const durationMin = Math.floor(durationMs / 60000);
    const durationSec = Math.floor((durationMs % 60000) / 1000);
    const durationStr = durationMin > 0 ? `${durationMin}分${durationSec}秒` : `${durationSec}秒`;

    // Metrics: model and agent info
    const modelInfo = db.prepare(`
      SELECT DISTINCT
        json_extract(m.data, '$.modelID') AS model_id,
        json_extract(m.data, '$.providerID') AS provider_id,
        json_extract(m.data, '$.agent') AS agent
      FROM message m
      WHERE m.session_id = ?
        AND json_extract(m.data, '$.role') = 'assistant'
        AND json_extract(m.data, '$.modelID') IS NOT NULL
    `).all(sessionId) as { model_id: string; provider_id: string; agent: string | null }[];

    // Format token count
    const formatTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : `${n}`;

    // Parent session info (for subagent sessions)
    let parentInfo: { id: string; title: string } | null = null;
    if (sessionInfo.parent_id) {
      parentInfo = db.prepare('SELECT id, title FROM session WHERE id = ?').get(sessionInfo.parent_id) as { id: string; title: string } | undefined ?? null;
    }

    const sql = `
      SELECT m.id,
             json_extract(m.data, '$.role') AS role,
             json_extract(m.data, '$.modelID') AS model_id,
             json_extract(m.data, '$.providerID') AS provider_id,
             json_extract(m.data, '$.agent') AS agent,
             json_extract(p.data, '$.text') AS text,
             m.time_created
      FROM message m
      JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ?
        AND json_extract(p.data, '$.type') = 'text'
        AND json_extract(p.data, '$.text') IS NOT NULL
      ORDER BY m.time_created ASC
    `;

    const messages = db.prepare(sql).all(sessionId) as ChatMessage[];

    // Build map from assistant message id to subagent session ids (supports multiple per message)
    const allToolParts = db.prepare(`
      SELECT p.message_id, p.data as data
      FROM part p
      WHERE p.session_id = ?
        AND json_extract(p.data, '$.type') = 'tool'
      ORDER BY p.message_id
    `).all(sessionId) as { message_id: string; data: string }[];

    const messageToSubagentsMap = new Map<string, SubagentInfo[]>();

    for (const { message_id, data } of allToolParts) {
      try {
        const parsedData = JSON.parse(data);
        if (parsedData.type !== 'tool') continue;
        const subagentSessionId = parsedData.state?.metadata?.sessionId;
        if (!subagentSessionId) continue;

        const subSessionInfo = db.prepare('SELECT id, title FROM session WHERE id = ?').get(subagentSessionId) as { id: string; title: string } | undefined;
        if (!subSessionInfo) continue;

        const existing = messageToSubagentsMap.get(message_id) || [];
        // Deduplicate by session ID
        if (!existing.some(s => s.id === subSessionInfo.id)) {
          existing.push(subSessionInfo);
          messageToSubagentsMap.set(message_id, existing);
        }
      } catch {
        // JSON parse error - skip
      }
    }

    const messagesHtml = messages.map((m) => {
      const dateStr = new Date(Number(m.time_created)).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const isUser = m.role === 'user';
      const roleClass = isUser ? 'message-user' : 'message-assistant';
      const roleLabel = isUser ? 'User' : 'Assistant';

      const subagents = messageToSubagentsMap.get(m.id) || [];

      let metaInfo = '';
      if (!isUser) {
        const modelItem = m.model_id ? `<span class="meta-item">${m.model_id}</span>` : '';
        const providerItem = m.provider_id ? `<span class="meta-item">${m.provider_id}</span>` : '';
        const agentItem = m.agent ? `<span class="meta-item">${m.agent}</span>` : '';
        const subagentLinks = subagents.map(s =>
          `<a href="/session/${s.id}" class="subagent-link">→ ${s.title}</a>`
        ).join('');
        metaInfo = `
          <div class="message-meta">
            ${modelItem}${providerItem}${agentItem}
          </div>
          ${subagentLinks ? `<div class="subagent-links">${subagentLinks}</div>` : ''}
        `;
      }

      return `
<div class="message ${roleClass}" data-role="${m.role}">
  <div class="message-header">
    <span class="message-role">${roleLabel}</span>
    <span class="message-time">${dateStr}</span>
  </div>
  ${metaInfo}
  <div class="message-body">
    <div class="message-content">${marked.parse(m.text)}</div>
    <div class="message-raw"><span class="raw-label">${roleLabel} (${dateStr})</span>\n${escapeHtml(m.text)}</div>
    <div class="content-fade"></div>
    <button class="expand-btn" onclick="toggleMessage(this)">続きを表示</button>
  </div>
  <hr class="plain-sep">
</div>
`;
    }).join('\n');

    // Build metrics HTML
    const modelStr = modelInfo.map(m => `${m.model_id} (${m.provider_id})`).join(', ');
    const agentStr = modelInfo.filter(m => m.agent).map(m => m.agent).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const costStr = tokenStats.total_cost > 0 ? `$${tokenStats.total_cost.toFixed(4)}` : '$0.00';

    const fileChangesStr = sessionInfo.summary_files > 0
      ? `${sessionInfo.summary_files} files (+${sessionInfo.summary_additions} -${sessionInfo.summary_deletions})`
      : 'なし';

    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${sessionInfo.title} - Session</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Breadcrumb */
    .breadcrumb { font-size: 0.85em; color: #86868b; margin-bottom: 16px; }
    .breadcrumb a { color: #0066cc; }
    .breadcrumb .sep { margin: 0 6px; }

    /* Session Header */
    .session-header { background: white; padding: 24px 28px; border-radius: 12px; border: 1px solid #d2d2d7; margin-bottom: 20px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
    .session-title { font-size: 1.4em; font-weight: 700; color: #1d1d1f; margin: 0; line-height: 1.3; flex: 1; }
    .session-id { font-size: 0.75em; color: #86868b; font-family: 'SF Mono', 'Fira Code', monospace; background: #f5f5f7; padding: 4px 10px; border-radius: 6px; white-space: nowrap; }
    .header-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .header-tag { font-size: 0.8em; padding: 3px 10px; border-radius: 6px; font-weight: 500; }
    .tag-model { background: #e8e0f0; color: #6b3fa0; }
    .tag-agent { background: #dff0df; color: #2d6a2e; }
    .tag-dir { background: #f0f0f0; color: #666; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75em; }
    .tag-parent { background: #fff3e0; color: #e65100; }

    /* Metrics Grid */
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .metric-card { background: #f5f5f7; border-radius: 8px; padding: 12px 14px; }
    .metric-label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; color: #86868b; font-weight: 600; margin-bottom: 4px; }
    .metric-value { font-size: 1.15em; font-weight: 700; color: #1d1d1f; }
    .metric-sub { font-size: 0.75em; color: #86868b; margin-top: 2px; }

    /* Messages */
    .chat { margin-top: 8px; }
    .message { margin: 14px 0; display: flex; flex-direction: column; }
    .message-user { align-items: flex-end; }
    .message-assistant { align-items: flex-start; }
    .message-header { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; font-size: 0.8em; color: #86868b; }
    .message-role { font-weight: 600; padding: 2px 10px; border-radius: 4px; font-size: 0.85em; }
    .message-user .message-role { background: #e3f2fd; color: #1565c0; }
    .message-assistant .message-role { background: #3a3a3c; color: white; }
    .message-meta { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; align-items: center; }
    .meta-item { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; color: #86868b; }
    .subagent-links { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .subagent-link { display: inline-block; color: #0066cc; font-size: 0.82em; padding: 4px 10px; background: #e8f4fd; border-radius: 6px; border-left: 3px solid #0066cc; }
    .subagent-link:hover { background: #d0e8f7; text-decoration: none; }
    /* Raw text (hidden by default) */
    .message-raw { display: none; white-space: pre-wrap; word-break: break-word; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 0.93em; line-height: 1.6; margin: 0; padding: 0; width: 100%; }
    .raw-label { font-weight: 700; color: #1d1d1f; }
    .plain-sep { display: none; }
    /* Plain mode: strip all chat UI */
    body.plain-mode .message-content { display: none; }
    body.plain-mode .message-raw { display: block; }
    body.plain-mode .message-header { display: none; }
    body.plain-mode .message-meta { display: none; }
    body.plain-mode .subagent-links { display: none; }
    body.plain-mode .message { margin: 0; align-items: stretch; }
    body.plain-mode .message-user .message-raw,
    body.plain-mode .message-assistant .message-raw { background: none; border: none; border-radius: 0; }
    body.plain-mode .content-fade { display: none !important; }
    body.plain-mode .expand-btn { display: none !important; }
    body.plain-mode .plain-sep { display: block; border: none; border-top: 1px dashed #c0c0c0; margin: 12px 0; }
    body.plain-mode .message:last-child .plain-sep { display: none; }
    /* Collapse applies to raw too (non-plain mode) */
    .message-body.collapsed .message-raw { max-height: 300px; overflow: hidden; }

    /* Message body wrapper for collapse */
    .message-body { position: relative; width: 100%; }
    .message-body.collapsed .message-content { max-height: 300px; overflow: hidden; }
    .message-body.collapsed .content-fade { display: block; }
    .message-body:not(.collapsed) .content-fade { display: none; }
    .message-body:not(.collapsed) .expand-btn { display: none; }
    .message-body:not(.overflows) .expand-btn { display: none; }
    .message-body:not(.overflows) .content-fade { display: none; }
    .content-fade { position: absolute; bottom: 32px; left: 0; right: 0; height: 60px; pointer-events: none; border-radius: 0 0 12px 12px; }
    .message-user .content-fade { background: linear-gradient(transparent, #e3f2fd); }
    .message-assistant .content-fade { background: linear-gradient(transparent, #ffffff); }
    .expand-btn { display: block; width: 100%; padding: 6px; border: none; background: transparent; color: #0066cc; font-size: 0.82em; font-weight: 600; cursor: pointer; text-align: center; border-radius: 0 0 12px 12px; }
    .expand-btn:hover { background: rgba(0,102,204,0.05); }
    .message-body:not(.collapsed) .expand-btn.has-overflow { display: block; color: #86868b; }

    .message-content { padding: 14px 18px; border-radius: 12px; width: 100%; line-height: 1.7; font-size: 0.95em; }
    .message-content img { max-width: 100%; height: auto; }
    .message-user .message-content { background: #e3f2fd; border: 1px solid #bbdefb; }
    .message-assistant .message-content { background: white; border: 1px solid #d2d2d7; }
    .message-content p { margin: 8px 0; }
    .message-content pre { background: #f5f5f7; padding: 14px; border-radius: 8px; overflow-x: auto; border: 1px solid #e5e5e5; }
    .message-content code { background: #f5f5f7; padding: 2px 6px; border-radius: 4px; font-size: 0.88em; font-family: 'SF Mono', 'Fira Code', monospace; }
    .message-content pre code { background: none; padding: 0; }
    .message-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    .message-content th, .message-content td { border: 1px solid #d2d2d7; padding: 8px 12px; text-align: left; }
    .message-content th { background: #f5f5f7; font-weight: 600; }

    /* Hidden messages (filter) */
    .message.hidden { display: none; }

    /* Sticky footer control bar */
    .control-bar { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid #d2d2d7; padding: 10px 0; z-index: 100; }
    .control-bar-inner { max-width: 960px; margin: 0 auto; padding: 0 20px; display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
    .ctrl-btn { padding: 6px 16px; border-radius: 8px; border: 1px solid #d2d2d7; background: white; color: #1d1d1f; font-size: 0.82em; font-weight: 500; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
    .ctrl-btn:hover { border-color: #0066cc; color: #0066cc; }
    .ctrl-btn.active { background: #0066cc; color: white; border-color: #0066cc; }
    .ctrl-sep { width: 1px; height: 20px; background: #d2d2d7; }
    .nav-counter { font-size: 0.8em; font-weight: 600; color: #86868b; min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
    .message.nav-active { scroll-margin-top: 16px; }
    .message.nav-highlight .message-header .message-role { box-shadow: 0 0 0 2px #0066cc; }
    .chat { padding-bottom: 60px; }
  </style>
</head>
<body>
  <div class="breadcrumb">
    <a href="/">Directories</a><span class="sep">/</span>
    <a href="/dir/${encodeURIComponent(sessionInfo.directory)}">${sessionInfo.directory}</a><span class="sep">/</span>
    <span>Session</span>
  </div>

  <div class="session-header">
    <div class="header-top">
      <h1 class="session-title">${sessionInfo.title}</h1>
      <span class="session-id">${sessionId}</span>
    </div>
    <div class="header-tags">
      ${modelStr ? `<span class="header-tag tag-model">${modelStr}</span>` : ''}
      ${agentStr ? `<span class="header-tag tag-agent">${agentStr}</span>` : ''}
      <span class="header-tag tag-dir">${sessionInfo.directory}</span>
      ${parentInfo ? `<a href="/session/${parentInfo.id}" class="header-tag tag-parent">← 親セッション: ${parentInfo.title}</a>` : ''}
    </div>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">所要時間</div>
        <div class="metric-value">${durationStr}</div>
        <div class="metric-sub">${createdDate}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">メッセージ</div>
        <div class="metric-value">${totalMessages}</div>
        <div class="metric-sub">User ${userMessages} / Assistant ${assistantMessages}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">ツール呼出</div>
        <div class="metric-value">${toolCallCount}</div>
        <div class="metric-sub">サブエージェント ${subagentCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">トークン</div>
        <div class="metric-value">${formatTokens(tokenStats.total_tokens)}</div>
        <div class="metric-sub">入力 ${formatTokens(tokenStats.input_tokens)} / 出力 ${formatTokens(tokenStats.output_tokens)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">コスト</div>
        <div class="metric-value">${costStr}</div>
        <div class="metric-sub">ファイル変更: ${fileChangesStr}</div>
      </div>
    </div>
  </div>

  ${messages.length === 0 ? '<p>メッセージはありません</p>' : ''}
  <div class="chat">${messagesHtml}</div>

  <div class="control-bar">
    <div class="control-bar-inner">
      <button class="ctrl-btn active" id="btn-collapse" onclick="toggleCollapseAll()">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>
        折りたたみ
      </button>
      <div class="ctrl-sep"></div>
      <button class="ctrl-btn" id="btn-filter" onclick="cycleFilter()">🧑‍💻🤖</button>
      <div class="ctrl-sep"></div>
      <button class="ctrl-btn" id="btn-plain" onclick="togglePlainMode()">Aa</button>
      <div class="ctrl-sep"></div>
      <button class="ctrl-btn" id="btn-prev" onclick="jumpMessage(-1)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 10l-4-4-4 4"/></svg>
      </button>
      <span class="nav-counter" id="nav-counter">- / -</span>
      <button class="ctrl-btn" id="btn-next" onclick="jumpMessage(1)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>
      </button>
    </div>
  </div>

  <script>
    const COLLAPSE_HEIGHT = 300;
    let collapseEnabled = localStorage.getItem('ot-collapse') !== 'false';
    let currentFilter = localStorage.getItem('ot-filter') || 'all';
    let plainMode = localStorage.getItem('ot-plain') === 'true';
    let navIndex = -1;

    function initCollapse() {
      recheckOverflows();
    }

    function recheckOverflows() {
      document.querySelectorAll('.message-body').forEach(body => {
        const el = plainMode ? body.querySelector('.message-raw') : body.querySelector('.message-content');
        const overflows = el.scrollHeight > COLLAPSE_HEIGHT;
        body.classList.toggle('overflows', overflows);
        if (!overflows) {
          body.classList.remove('collapsed');
        } else if (collapseEnabled) {
          body.classList.add('collapsed');
        }
      });
    }

    function togglePlainMode() {
      const anchor = getAnchor();
      plainMode = !plainMode;
      localStorage.setItem('ot-plain', String(plainMode));
      document.body.classList.toggle('plain-mode', plainMode);
      document.getElementById('btn-plain').classList.toggle('active', plainMode);
      recheckOverflows();
      restoreAnchor(anchor);
    }

    // Find the message element closest to the top of the viewport
    function getAnchor() {
      const msgs = document.querySelectorAll('.message:not(.hidden)');
      for (const msg of msgs) {
        const r = msg.getBoundingClientRect();
        if (r.bottom > 0) return { el: msg, offset: r.top };
      }
      return null;
    }

    // Restore scroll so the anchor element stays at the same viewport position
    function restoreAnchor(anchor) {
      if (!anchor) return;
      const newTop = anchor.el.getBoundingClientRect().top;
      window.scrollBy(0, newTop - anchor.offset);
    }

    function toggleMessage(btn) {
      const body = btn.closest('.message-body');
      const anchor = getAnchor();
      const isCollapsed = body.classList.contains('collapsed');
      if (isCollapsed) {
        body.classList.remove('collapsed');
        btn.textContent = '折りたたむ';
        btn.classList.add('has-overflow');
      } else {
        body.classList.add('collapsed');
        btn.textContent = '続きを表示';
        btn.classList.remove('has-overflow');
      }
      restoreAnchor(anchor);
    }

    function toggleCollapseAll() {
      const anchor = getAnchor();
      collapseEnabled = !collapseEnabled;
      localStorage.setItem('ot-collapse', String(collapseEnabled));
      const btn = document.getElementById('btn-collapse');
      btn.classList.toggle('active', collapseEnabled);
      document.querySelectorAll('.message-body.overflows').forEach(body => {
        const expandBtn = body.querySelector('.expand-btn');
        if (collapseEnabled) {
          body.classList.add('collapsed');
          expandBtn.textContent = '続きを表示';
          expandBtn.classList.remove('has-overflow');
        } else {
          body.classList.remove('collapsed');
          expandBtn.textContent = '折りたたむ';
          expandBtn.classList.add('has-overflow');
        }
      });
      restoreAnchor(anchor);
    }

    const FILTER_CYCLE = ['all', 'user', 'assistant'];
    const FILTER_LABELS = { all: '🧑‍💻🤖', user: '🧑‍💻', assistant: '🤖' };

    function cycleFilter() {
      const idx = (FILTER_CYCLE.indexOf(currentFilter) + 1) % FILTER_CYCLE.length;
      applyFilter(FILTER_CYCLE[idx]);
    }

    function applyFilter(filter) {
      const anchor = getAnchor();
      currentFilter = filter;
      localStorage.setItem('ot-filter', filter);
      const btn = document.getElementById('btn-filter');
      btn.textContent = FILTER_LABELS[filter];
      btn.classList.toggle('active', filter !== 'all');

      document.querySelectorAll('.message[data-role]').forEach(msg => {
        if (filter === 'all') {
          msg.classList.remove('hidden');
        } else {
          msg.classList.toggle('hidden', msg.dataset.role !== filter);
        }
      });
      restoreAnchor(anchor);
      syncNavToView();
    }

    // Returns visible (non-hidden) messages
    function getVisibleMessages() {
      return Array.from(document.querySelectorAll('.message:not(.hidden)'));
    }

    // Detect which message is currently at the top of the viewport and sync navIndex
    function syncNavToView() {
      const msgs = getVisibleMessages();
      const total = msgs.length;
      if (total === 0) { updateCounter(-1, 0); return; }

      let best = 0;
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].getBoundingClientRect().top <= window.innerHeight / 3) best = i;
      }
      navIndex = best;
      updateCounter(navIndex, total);
    }

    function updateCounter(idx, total) {
      document.getElementById('nav-counter').textContent =
        total === 0 ? '- / -' : (idx + 1) + ' / ' + total;
    }

    function jumpMessage(dir) {
      const msgs = getVisibleMessages();
      if (msgs.length === 0) return;

      // On first jump, sync to current viewport position
      if (navIndex < 0) syncNavToView();

      navIndex = Math.max(0, Math.min(msgs.length - 1, navIndex + dir));
      msgs[navIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateCounter(navIndex, msgs.length);

      // Brief highlight pulse
      msgs[navIndex].classList.add('nav-highlight');
      setTimeout(() => msgs[navIndex]?.classList.remove('nav-highlight'), 800);
    }

    // Keep counter in sync while scrolling
    let scrollTimer;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(syncNavToView, 150);
    }, { passive: true });

    // Keyboard shortcuts: j/k or ↑/↓
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'j' || e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); jumpMessage(1); }
      if (e.key === 'k' || e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); jumpMessage(-1); }
    });

    document.addEventListener('DOMContentLoaded', () => {
      // Restore plain mode
      if (plainMode) {
        document.body.classList.add('plain-mode');
        document.getElementById('btn-plain').classList.add('active');
      }
      // Restore collapse state
      document.getElementById('btn-collapse').classList.toggle('active', collapseEnabled);
      initCollapse();
      // Restore filter state
      if (currentFilter !== 'all') applyFilter(currentFilter);
      syncNavToView();
    });
  </script>
</body>
</html>
    `);
  } finally {
    db.close();
  }
});

app.listen(PORT, () => {
  console.log(`OpenCode Telemetry running at http://localhost:${PORT}`);
});
