import type { Request, Response } from 'express';
import { marked } from 'marked';
import { getDb } from '../lib/db.js';
import { escapeHtml, formatTokens } from '../lib/html.js';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time_created: string | number;
  model_id?: string;
  provider_id?: string;
  agent?: string;
}

interface SubagentInfo {
  id: string;
  title: string;
}

export function sessionRoute(req: Request, res: Response) {
  const db = getDb();
  try {
    const { sessionId } = req.params;

    const sessionInfo = db.prepare(`
      SELECT id, title, directory, time_created, time_updated, parent_id,
             summary_additions, summary_deletions, summary_files, summary_diffs
      FROM session
      WHERE id = ?
    `).get(sessionId) as { id: string; title: string; directory: string; time_created: number; time_updated: number; parent_id: string | null; summary_additions: number; summary_deletions: number; summary_files: number; summary_diffs: string | null } | undefined;

    if (!sessionInfo) {
      res.status(404).send('Session not found');
      return;
    }

    const createdDate = new Date(Number(sessionInfo.time_created)).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Metrics
    const roleCounts = db.prepare(`SELECT json_extract(m.data, '$.role') AS role, COUNT(*) AS cnt FROM message m WHERE m.session_id = ? GROUP BY role`).all(sessionId) as { role: string; cnt: number }[];
    const roleCountMap = new Map(roleCounts.map(r => [r.role, r.cnt]));
    const totalMessages = roleCounts.reduce((sum, r) => sum + r.cnt, 0);
    const userMessages = roleCountMap.get('user') || 0;
    const assistantMessages = roleCountMap.get('assistant') || 0;

    const toolCallCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM part p WHERE p.session_id = ? AND json_extract(p.data, '$.type') = 'tool'`).get(sessionId) as { cnt: number }).cnt;
    const subagentCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM session WHERE parent_id = ?`).get(sessionId) as { cnt: number }).cnt;

    const tokenStats = db.prepare(`
      SELECT COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.input')), 0) AS input_tokens,
             COALESCE(SUM(json_extract(m.data, '$.tokens.output')), 0) AS output_tokens,
             COALESCE(SUM(json_extract(m.data, '$.cost')), 0) AS total_cost
      FROM message m WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'assistant'
    `).get(sessionId) as { total_tokens: number; input_tokens: number; output_tokens: number; total_cost: number };

    const timeRange = db.prepare(`SELECT MIN(m.time_created) AS first_msg, MAX(m.time_created) AS last_msg FROM message m WHERE m.session_id = ?`).get(sessionId) as { first_msg: number; last_msg: number };
    const durationMs = timeRange.last_msg - timeRange.first_msg;
    const durationMin = Math.floor(durationMs / 60000);
    const durationSec = Math.floor((durationMs % 60000) / 1000);
    const durationStr = durationMin > 0 ? `${durationMin}分${durationSec}秒` : `${durationSec}秒`;

    const modelInfo = db.prepare(`
      SELECT DISTINCT json_extract(m.data, '$.modelID') AS model_id, json_extract(m.data, '$.providerID') AS provider_id, json_extract(m.data, '$.agent') AS agent
      FROM message m WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'assistant' AND json_extract(m.data, '$.modelID') IS NOT NULL
    `).all(sessionId) as { model_id: string; provider_id: string; agent: string | null }[];

    let parentInfo: { id: string; title: string } | null = null;
    if (sessionInfo.parent_id) {
      parentInfo = db.prepare('SELECT id, title FROM session WHERE id = ?').get(sessionInfo.parent_id) as { id: string; title: string } | undefined ?? null;
    }

    // Messages
    const messages = db.prepare(`
      SELECT m.id, json_extract(m.data, '$.role') AS role, json_extract(m.data, '$.modelID') AS model_id,
             json_extract(m.data, '$.providerID') AS provider_id, json_extract(m.data, '$.agent') AS agent,
             json_extract(p.data, '$.text') AS text, m.time_created
      FROM message m JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ? AND json_extract(p.data, '$.type') = 'text' AND json_extract(p.data, '$.text') IS NOT NULL
      ORDER BY m.time_created ASC
    `).all(sessionId) as ChatMessage[];

    // Tool parts for subagent links AND tool timeline
    const allToolParts = db.prepare(`
      SELECT p.message_id, p.data as data
      FROM part p WHERE p.session_id = ? AND json_extract(p.data, '$.type') = 'tool'
      ORDER BY p.message_id
    `).all(sessionId) as { message_id: string; data: string }[];

    const messageToSubagentsMap = new Map<string, SubagentInfo[]>();
    const messageToolCalls = new Map<string, { tool: string; input: string }[]>();

    for (const { message_id, data } of allToolParts) {
      try {
        const parsedData = JSON.parse(data);
        if (parsedData.type !== 'tool') continue;

        // Subagent mapping
        const subagentSessionId = parsedData.state?.metadata?.sessionId;
        if (subagentSessionId) {
          const subSessionInfo = db.prepare('SELECT id, title FROM session WHERE id = ?').get(subagentSessionId) as { id: string; title: string } | undefined;
          if (subSessionInfo) {
            const existing = messageToSubagentsMap.get(message_id) || [];
            if (!existing.some(s => s.id === subSessionInfo.id)) {
              existing.push(subSessionInfo);
              messageToSubagentsMap.set(message_id, existing);
            }
          }
        }

        // Tool timeline
        const toolName = parsedData.tool || 'unknown';
        let inputSummary = '';
        const inp = parsedData.state?.input;
        if (inp) {
          if (inp.filePath) inputSummary = inp.filePath.split('/').slice(-2).join('/');
          else if (inp.command) inputSummary = inp.command.substring(0, 60);
          else if (inp.pattern) inputSummary = inp.pattern;
          else if (inp.url) inputSummary = inp.url.substring(0, 60);
          else if (inp.query) inputSummary = inp.query.substring(0, 60);
          else if (inp.prompt) inputSummary = inp.prompt.substring(0, 50);
          else if (inp.description) inputSummary = inp.description.substring(0, 50);
        }
        const calls = messageToolCalls.get(message_id) || [];
        calls.push({ tool: toolName, input: inputSummary });
        messageToolCalls.set(message_id, calls);
      } catch { /* skip */ }
    }

    // Todos
    const todos = db.prepare(`
      SELECT content, status, priority FROM todo WHERE session_id = ? ORDER BY position ASC
    `).all(sessionId) as { content: string; status: string; priority: string }[];

    // Build messages HTML
    const messagesHtml = messages.map((m) => {
      const dateStr = new Date(Number(m.time_created)).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const isUser = m.role === 'user';
      const roleClass = isUser ? 'message-user' : 'message-assistant';
      const roleLabel = isUser ? 'User' : 'Assistant';
      const subagents = messageToSubagentsMap.get(m.id) || [];
      const toolCalls = messageToolCalls.get(m.id) || [];

      let metaInfo = '';
      if (!isUser) {
        const modelItem = m.model_id ? `<span class="meta-item">${m.model_id}</span>` : '';
        const providerItem = m.provider_id ? `<span class="meta-item">${m.provider_id}</span>` : '';
        const agentItem = m.agent ? `<span class="meta-item">${m.agent}</span>` : '';
        const subagentLinks = subagents.map(s =>
          `<a href="/session/${s.id}" class="subagent-link">→ ${s.title}</a>`
        ).join('');
        metaInfo = `
          <div class="message-meta">${modelItem}${providerItem}${agentItem}</div>
          ${subagentLinks ? `<div class="subagent-links">${subagentLinks}</div>` : ''}
        `;
      }

      // Tool timeline
      let toolTimelineHtml = '';
      if (toolCalls.length > 0) {
        const TOOL_ICONS: Record<string, string> = { read: '📄', grep: '🔍', bash: '⚡', glob: '📂', write: '✏️', edit: '✏️', apply_patch: '✏️', task: '🤖', background_output: '🤖', webfetch: '🌐', websearch_web_search_exa: '🌐', lsp_diagnostics: '🔧', todowrite: '📋', skill: '⚙️' };
        const lines = toolCalls.map(tc => {
          const icon = TOOL_ICONS[tc.tool] || '🔧';
          const inputStr = tc.input ? ` <span class="tool-input">${escapeHtml(tc.input)}</span>` : '';
          return `<span class="tool-line">${icon} <span class="tool-name">${escapeHtml(tc.tool)}</span>${inputStr}</span>`;
        });
        toolTimelineHtml = `<div class="tool-timeline">${lines.join('')}</div>`;
      }

      return `
<div class="message ${roleClass}" data-role="${m.role}">
  <div class="message-header">
    <span class="message-role">${roleLabel}</span>
    <span class="message-time">${dateStr}</span>
  </div>
  ${metaInfo}
  ${toolTimelineHtml}
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

    const modelStr = modelInfo.map(m => `${m.model_id} (${m.provider_id})`).join(', ');
    const agentStr = modelInfo.filter(m => m.agent).map(m => m.agent).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    const costStr = tokenStats.total_cost > 0 ? `$${tokenStats.total_cost.toFixed(4)}` : '$0.00';
    const fileChangesStr = sessionInfo.summary_files > 0
      ? `${sessionInfo.summary_files} files (+${sessionInfo.summary_additions} -${sessionInfo.summary_deletions})`
      : 'なし';

    // Todos HTML
    const todosHtml = todos.length > 0 ? `
      <div class="card" style="margin-top: 16px;">
        <h3 style="margin:0 0 12px 0; font-size: 1em;">Todos</h3>
        <div class="todo-list">
          ${todos.map(t => {
            const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'cancelled' ? '❌' : '⬜';
            const dim = t.status === 'completed' || t.status === 'cancelled' ? 'style="opacity:0.6"' : '';
            return `<div class="todo-item" ${dim}>${icon} <span>${escapeHtml(t.content)}</span></div>`;
          }).join('')}
        </div>
      </div>
    ` : '';

    // Diffs HTML
    const diffsHtml = sessionInfo.summary_diffs ? `
      <div class="card" style="margin-top: 16px;">
        <h3 style="margin:0 0 12px 0; font-size: 1em;">Changes</h3>
        <pre class="diff-view">${escapeHtml(sessionInfo.summary_diffs)}</pre>
      </div>
    ` : '';

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
    .breadcrumb { font-size: 0.85em; color: #86868b; margin-bottom: 16px; }
    .breadcrumb a { color: #0066cc; }
    .breadcrumb .sep { margin: 0 6px; }
    .card { background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 20px 24px; }
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
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    .metric-card { background: #f5f5f7; border-radius: 8px; padding: 12px 14px; }
    .metric-label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; color: #86868b; font-weight: 600; margin-bottom: 4px; }
    .metric-value { font-size: 1.15em; font-weight: 700; color: #1d1d1f; }
    .metric-sub { font-size: 0.75em; color: #86868b; margin-top: 2px; }

    /* Tool timeline */
    .tool-timeline { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; padding: 8px 12px; background: #fafafa; border-radius: 8px; border: 1px dashed #e0e0e0; }
    .tool-timeline.hidden { display: none; }
    .tool-line { font-size: 0.75em; padding: 2px 8px; background: #f0f0f0; border-radius: 4px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
    .tool-name { font-weight: 600; color: #555; }
    .tool-input { color: #86868b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

    /* Todos */
    .todo-list { display: flex; flex-direction: column; gap: 6px; }
    .todo-item { font-size: 0.9em; padding: 4px 0; display: flex; gap: 8px; align-items: flex-start; }

    /* Diffs */
    .diff-view { font-size: 0.8em; line-height: 1.5; overflow-x: auto; background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; max-height: 500px; overflow-y: auto; }

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
    .message-raw { display: none; white-space: pre-wrap; word-break: break-word; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 0.93em; line-height: 1.6; margin: 0; padding: 0; width: 100%; }
    .raw-label { font-weight: 700; color: #1d1d1f; }
    .plain-sep { display: none; }
    body.plain-mode .message-content { display: none; }
    body.plain-mode .message-raw { display: block; }
    body.plain-mode .message-header { display: none; }
    body.plain-mode .message-meta { display: none; }
    body.plain-mode .subagent-links { display: none; }
    body.plain-mode .tool-timeline { display: none; }
    body.plain-mode .message { margin: 0; align-items: stretch; }
    body.plain-mode .message-user .message-raw,
    body.plain-mode .message-assistant .message-raw { background: none; border: none; border-radius: 0; }
    body.plain-mode .content-fade { display: none !important; }
    body.plain-mode .expand-btn { display: none !important; }
    body.plain-mode .plain-sep { display: block; border: none; border-top: 1px dashed #c0c0c0; margin: 12px 0; }
    body.plain-mode .message:last-child .plain-sep { display: none; }
    .message-body.collapsed .message-raw { max-height: 300px; overflow: hidden; }
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
    .message.hidden { display: none; }
    .control-bar { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid #d2d2d7; padding: 10px 0; z-index: 100; }
    .control-bar-inner { max-width: 960px; margin: 0 auto; padding: 0 20px; display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; }
    .ctrl-btn { padding: 6px 16px; border-radius: 8px; border: 1px solid #d2d2d7; background: white; color: #1d1d1f; font-size: 0.82em; font-weight: 500; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
    .ctrl-btn:hover { border-color: #0066cc; color: #0066cc; }
    .ctrl-btn.active { background: #0066cc; color: white; border-color: #0066cc; }
    .ctrl-sep { width: 1px; height: 20px; background: #d2d2d7; }
    .nav-counter { font-size: 0.8em; font-weight: 600; color: #86868b; min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
    .message.nav-highlight .message-header .message-role { box-shadow: 0 0 0 2px #0066cc; }
    .chat { padding-bottom: 60px; }
  </style>
</head>
<body>
  <div class="breadcrumb">
    <a href="/">Home</a><span class="sep">/</span>
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
      ${parentInfo ? `<a href="/session/${parentInfo.id}" class="header-tag tag-parent">← 親: ${parentInfo.title}</a>` : ''}
    </div>
    <div class="metrics-grid">
      <div class="metric-card"><div class="metric-label">所要時間</div><div class="metric-value">${durationStr}</div><div class="metric-sub">${createdDate}</div></div>
      <div class="metric-card"><div class="metric-label">メッセージ</div><div class="metric-value">${totalMessages}</div><div class="metric-sub">User ${userMessages} / Assistant ${assistantMessages}</div></div>
      <div class="metric-card"><div class="metric-label">ツール呼出</div><div class="metric-value">${toolCallCount}</div><div class="metric-sub">サブエージェント ${subagentCount}</div></div>
      <div class="metric-card"><div class="metric-label">トークン</div><div class="metric-value">${formatTokens(tokenStats.total_tokens)}</div><div class="metric-sub">入力 ${formatTokens(tokenStats.input_tokens)} / 出力 ${formatTokens(tokenStats.output_tokens)}</div></div>
      <div class="metric-card"><div class="metric-label">コスト</div><div class="metric-value">${costStr}</div><div class="metric-sub">ファイル変更: ${fileChangesStr}</div></div>
    </div>
  </div>

  ${todosHtml}
  ${diffsHtml}

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
      <button class="ctrl-btn" id="btn-tools" onclick="toggleTools()">🔧</button>
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
    let toolsVisible = localStorage.getItem('ot-tools') !== 'false';
    let navIndex = -1;

    function initCollapse() { recheckOverflows(); }

    function recheckOverflows() {
      document.querySelectorAll('.message-body').forEach(body => {
        const el = plainMode ? body.querySelector('.message-raw') : body.querySelector('.message-content');
        const overflows = el.scrollHeight > COLLAPSE_HEIGHT;
        body.classList.toggle('overflows', overflows);
        if (!overflows) body.classList.remove('collapsed');
        else if (collapseEnabled) body.classList.add('collapsed');
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

    function toggleTools() {
      toolsVisible = !toolsVisible;
      localStorage.setItem('ot-tools', String(toolsVisible));
      document.getElementById('btn-tools').classList.toggle('active', toolsVisible);
      document.querySelectorAll('.tool-timeline').forEach(el => el.classList.toggle('hidden', !toolsVisible));
    }

    function getAnchor() {
      const msgs = document.querySelectorAll('.message:not(.hidden)');
      for (const msg of msgs) { const r = msg.getBoundingClientRect(); if (r.bottom > 0) return { el: msg, offset: r.top }; }
      return null;
    }
    function restoreAnchor(anchor) { if (!anchor) return; window.scrollBy(0, anchor.el.getBoundingClientRect().top - anchor.offset); }

    function toggleMessage(btn) {
      const body = btn.closest('.message-body');
      const anchor = getAnchor();
      const isCollapsed = body.classList.contains('collapsed');
      if (isCollapsed) { body.classList.remove('collapsed'); btn.textContent = '折りたたむ'; btn.classList.add('has-overflow'); }
      else { body.classList.add('collapsed'); btn.textContent = '続きを表示'; btn.classList.remove('has-overflow'); }
      restoreAnchor(anchor);
    }

    function toggleCollapseAll() {
      const anchor = getAnchor();
      collapseEnabled = !collapseEnabled;
      localStorage.setItem('ot-collapse', String(collapseEnabled));
      document.getElementById('btn-collapse').classList.toggle('active', collapseEnabled);
      document.querySelectorAll('.message-body.overflows').forEach(body => {
        const expandBtn = body.querySelector('.expand-btn');
        if (collapseEnabled) { body.classList.add('collapsed'); expandBtn.textContent = '続きを表示'; expandBtn.classList.remove('has-overflow'); }
        else { body.classList.remove('collapsed'); expandBtn.textContent = '折りたたむ'; expandBtn.classList.add('has-overflow'); }
      });
      restoreAnchor(anchor);
    }

    const FILTER_CYCLE = ['all', 'user', 'assistant'];
    const FILTER_LABELS = { all: '🧑‍💻🤖', user: '🧑‍💻', assistant: '🤖' };
    function cycleFilter() { applyFilter(FILTER_CYCLE[(FILTER_CYCLE.indexOf(currentFilter) + 1) % FILTER_CYCLE.length]); }
    function applyFilter(filter) {
      const anchor = getAnchor();
      currentFilter = filter;
      localStorage.setItem('ot-filter', filter);
      document.getElementById('btn-filter').textContent = FILTER_LABELS[filter];
      document.getElementById('btn-filter').classList.toggle('active', filter !== 'all');
      document.querySelectorAll('.message[data-role]').forEach(msg => {
        msg.classList.toggle('hidden', filter !== 'all' && msg.dataset.role !== filter);
      });
      restoreAnchor(anchor);
      syncNavToView();
    }

    function getVisibleMessages() { return Array.from(document.querySelectorAll('.message:not(.hidden)')); }
    function syncNavToView() {
      const msgs = getVisibleMessages();
      if (msgs.length === 0) { updateCounter(-1, 0); return; }
      let best = 0;
      for (let i = 0; i < msgs.length; i++) { if (msgs[i].getBoundingClientRect().top <= window.innerHeight / 3) best = i; }
      navIndex = best;
      updateCounter(navIndex, msgs.length);
    }
    function updateCounter(idx, total) { document.getElementById('nav-counter').textContent = total === 0 ? '- / -' : (idx + 1) + ' / ' + total; }
    function jumpMessage(dir) {
      const msgs = getVisibleMessages();
      if (msgs.length === 0) return;
      if (navIndex < 0) syncNavToView();
      navIndex = Math.max(0, Math.min(msgs.length - 1, navIndex + dir));
      msgs[navIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateCounter(navIndex, msgs.length);
      msgs[navIndex].classList.add('nav-highlight');
      setTimeout(() => msgs[navIndex]?.classList.remove('nav-highlight'), 800);
    }

    let scrollTimer;
    window.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(syncNavToView, 150); }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'j' || (e.key === 'ArrowDown' && e.altKey)) { e.preventDefault(); jumpMessage(1); }
      if (e.key === 'k' || (e.key === 'ArrowUp' && e.altKey)) { e.preventDefault(); jumpMessage(-1); }
    });

    document.addEventListener('DOMContentLoaded', () => {
      if (plainMode) { document.body.classList.add('plain-mode'); document.getElementById('btn-plain').classList.add('active'); }
      if (!toolsVisible) { document.querySelectorAll('.tool-timeline').forEach(el => el.classList.add('hidden')); }
      else { document.getElementById('btn-tools').classList.add('active'); }
      document.getElementById('btn-collapse').classList.toggle('active', collapseEnabled);
      initCollapse();
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
}
