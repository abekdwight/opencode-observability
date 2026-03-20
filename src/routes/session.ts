import type { Request, Response } from 'express';
import { marked } from 'marked';
import { getDb } from '../lib/db.js';
import { calcSessionActiveDurations } from '../lib/duration.js';
import {
  SESSION_COPY_SCRIPT,
  SESSION_COPY_STYLES,
  escapeHtml,
  formatDuration,
  formatDurationShort,
  formatTokens,
  prettifyPath,
  renderSessionCopyButton,
} from '../lib/html.js';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time_created: string | number;
  model_id?: string;
  provider_id?: string;
  agent?: string;
  output_tokens?: number | string;
  response_started?: number | string;
  response_completed?: number | string;
}

type ToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'unknown';

interface ToolCallItem {
  tool: string;
  input: string;
  status: ToolStatus;
  error: string;
  fullInput: string;
  fullOutput: string;
  durationMs: number;
}

interface SubagentInfo {
  id: string;
  title: string;
}

function parseToolStatus(raw: unknown): ToolStatus {
  if (typeof raw !== 'string') return 'unknown';
  const normalized = raw.toLowerCase();
  if (normalized === 'pending' || normalized === 'running' || normalized === 'completed' || normalized === 'error') {
    return normalized;
  }
  return 'unknown';
}

function parseToolError(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const message = raw.message;
    if (typeof message === 'string') return message.trim();
    if (typeof message === 'number') return String(message);
  }
  return '';
}

function clampText(value: string, maxLen = 120): string {
  const normalized = value.trim();
  return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen)}...`;
}

function toNumberOrNull(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function calcOutputTps(outputTokensRaw: unknown, startedRaw: unknown, completedRaw: unknown): number | null {
  const outputTokens = toNumberOrNull(outputTokensRaw);
  const started = toNumberOrNull(startedRaw);
  const completed = toNumberOrNull(completedRaw);
  if (outputTokens == null || started == null || completed == null) return null;
  const durationMs = completed - started;
  if (outputTokens <= 0 || durationMs <= 0) return null;
  return (outputTokens * 1000) / durationMs;
}

function formatTps(value: number): string {
  if (value >= 100) return `${value.toFixed(0)} tok/s`;
  if (value >= 10) return `${value.toFixed(1)} tok/s`;
  return `${value.toFixed(2)} tok/s`;
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

    const activeDurations = calcSessionActiveDurations(db, [sessionId]);
    const durationMs = activeDurations.get(sessionId) || 0;
    const durationStr = formatDuration(durationMs);

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
             json_extract(m.data, '$.tokens.output') AS output_tokens,
             json_extract(m.data, '$.time.created') AS response_started,
             json_extract(m.data, '$.time.completed') AS response_completed,
             json_extract(p.data, '$.text') AS text, m.time_created
      FROM message m JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ? AND json_extract(p.data, '$.type') = 'text' AND json_extract(p.data, '$.text') IS NOT NULL
      ORDER BY m.time_created ASC
    `).all(sessionId) as ChatMessage[];

    // Tool parts for subagent links AND tool timeline
    const allToolParts = db.prepare(`
      SELECT p.message_id, p.data as data
      FROM part p WHERE p.session_id = ? AND json_extract(p.data, '$.type') = 'tool'
      ORDER BY p.message_id, p.time_created ASC, p.rowid ASC
    `).all(sessionId) as { message_id: string; data: string }[];

    const messageToSubagentsMap = new Map<string, SubagentInfo[]>();
    const messageToolCalls = new Map<string, ToolCallItem[]>();

    for (const { message_id, data } of allToolParts) {
      try {
        const parsedData = JSON.parse(data) as {
          type?: string;
          tool?: string;
          status?: unknown;
          error?: unknown;
          state?: {
            status?: unknown;
            error?: unknown;
            input?: Record<string, unknown>;
            output?: unknown;
            metadata?: { sessionId?: string };
            time?: { start?: number; end?: number };
          };
        };
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
        const toolName = typeof parsedData.tool === 'string' ? parsedData.tool : 'unknown';
        let inputSummary = '';
        const inp = parsedData.state?.input;
        if (inp) {
          if (typeof inp.filePath === 'string') inputSummary = inp.filePath.split('/').slice(-2).join('/');
          else if (typeof inp.command === 'string') inputSummary = inp.command.substring(0, 60);
          else if (typeof inp.pattern === 'string') inputSummary = inp.pattern;
          else if (typeof inp.url === 'string') inputSummary = inp.url.substring(0, 60);
          else if (typeof inp.query === 'string') inputSummary = inp.query.substring(0, 60);
          else if (typeof inp.prompt === 'string') inputSummary = inp.prompt.substring(0, 50);
          else if (typeof inp.description === 'string') inputSummary = inp.description.substring(0, 50);
        }
        const fullInput = inp ? JSON.stringify(inp, null, 2) : '';
        const rawOutput = parsedData.state?.output;
        const fullOutput = rawOutput != null
          ? (typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2)).substring(0, 2000)
          : '';
        const timings = parsedData.state?.time;
        const durationMs = timings?.start && timings?.end ? timings.end - timings.start : 0;

        const calls = messageToolCalls.get(message_id) || [];
        calls.push({
          tool: toolName,
          input: inputSummary,
          status: parseToolStatus(parsedData.state?.status ?? parsedData.status),
          error: clampText(parseToolError(parsedData.state?.error ?? parsedData.error)),
          fullInput,
          fullOutput,
          durationMs,
        });
        messageToolCalls.set(message_id, calls);
      } catch { /* skip */ }
    }

    // Todos
    const todos = db.prepare(`
      SELECT content, status, priority FROM todo WHERE session_id = ? ORDER BY position ASC
    `).all(sessionId) as { content: string; status: string; priority: string }[];

    const allSubagentIds = Array.from(new Set(
      Array.from(messageToSubagentsMap.values()).flatMap(subs => subs.map(s => s.id))
    ));
    const subagentDurations = calcSessionActiveDurations(db, allSubagentIds);

    // Build messages HTML
    const messagesHtml = messages.map((m) => {
      const dateStr = new Date(Number(m.time_created)).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const isUser = m.role === 'user';
      const roleClass = isUser ? 'message-user' : 'message-assistant';
      const roleLabel = isUser ? 'User' : 'Assistant';
      const subagents = messageToSubagentsMap.get(m.id) || [];
      const toolCalls = messageToolCalls.get(m.id) || [];

      let inlineMetaHtml = '';
      let subagentLinksHtml = '';
      if (!isUser) {
        const chips: string[] = [];
        if (m.model_id) {
          const label = `${m.model_id}${m.provider_id ? ` (${m.provider_id})` : ''}`;
          chips.push(`<span class="meta-chip chip-model">${escapeHtml(label)}</span>`);
        }
        if (m.agent) chips.push(`<span class="meta-chip chip-agent">${escapeHtml(m.agent)}</span>`);
        const outputTps = calcOutputTps(m.output_tokens, m.response_started, m.response_completed);
        chips.push(`<span class="meta-chip chip-tps">TPS ${outputTps != null ? escapeHtml(formatTps(outputTps)) : '—'}</span>`);
        inlineMetaHtml = chips.join(' ');

        const subLinks = subagents.map(s => {
          const subDur = subagentDurations.get(s.id);
          const durLabel = subDur != null ? ` (${formatDurationShort(subDur)})` : '';
          return `<a href="/session/${encodeURIComponent(s.id)}" class="subagent-link">→ ${escapeHtml(s.title)}${durLabel}</a>`;
        }).join('');
        if (subLinks) subagentLinksHtml = `<div class="subagent-links">${subLinks}</div>`;
      }

      // Tool timeline
      let toolTimelineHtml = '';
      if (toolCalls.length > 0) {
        const TOOL_ICONS: Record<string, string> = { read: '📄', grep: '🔍', bash: '⚡', glob: '📂', write: '✏️', edit: '✏️', apply_patch: '✏️', task: '🤖', background_output: '🤖', webfetch: '🌐', websearch_web_search_exa: '🌐', lsp_diagnostics: '🔧', todowrite: '📋', skill: '⚙️' };
        const lines = toolCalls.map((tc, idx) => {
          const icon = TOOL_ICONS[tc.tool] || '🔧';
          const inputStr = tc.input ? ` <span class="tool-input">${escapeHtml(tc.input)}</span>` : '';
          const errorStr = tc.status === 'error' && tc.error ? ` <span class="tool-error">${escapeHtml(tc.error)}</span>` : '';
          const durStr = tc.durationMs > 0 ? ` <span class="tool-dur">${tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}</span>` : '';
          const hasDetail = tc.fullInput || tc.fullOutput || tc.error;
          const detailId = `tool-detail-${m.id}-${idx}`;
          const detailHtml = hasDetail ? `<div class="tool-detail" id="${detailId}">${
            tc.fullInput ? `<div class="tool-detail-section"><div class="tool-detail-label">Input</div><pre>${escapeHtml(tc.fullInput)}</pre></div>` : ''
          }${
            tc.fullOutput ? `<div class="tool-detail-section"><div class="tool-detail-label">Output</div><pre>${escapeHtml(tc.fullOutput)}</pre></div>` : ''
          }${
            tc.status === 'error' && tc.error ? `<div class="tool-detail-section"><div class="tool-detail-label">Error</div><pre class="tool-detail-error">${escapeHtml(tc.error)}</pre></div>` : ''
          }</div>` : '';
          const clickAttr = hasDetail ? ` onclick="toggleToolDetail('${detailId}')" style="cursor:pointer"` : '';
          return `<span class="tool-line status-${tc.status}"${clickAttr}>${icon} <span class="tool-name">${escapeHtml(tc.tool)}</span>${inputStr}${durStr}${errorStr}</span>${detailHtml}`;
        });
        toolTimelineHtml = `<div class="tool-timeline">${lines.join('')}</div>`;
      }

      return `
<div class="message ${roleClass}" data-role="${m.role}">
  <div class="message-header">
    <span class="message-role">${roleLabel}</span>
    <span class="message-time">${dateStr}</span>
    ${inlineMetaHtml}
  </div>
  ${subagentLinksHtml}
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

    const safeSessionTitle = escapeHtml(sessionInfo.title);
    const safeSessionIdForJs = JSON.stringify(sessionInfo.id);
    const safePrettyDirectory = escapeHtml(prettifyPath(sessionInfo.directory));
    const costStr = tokenStats.total_cost > 0 ? `$${tokenStats.total_cost.toFixed(4)}` : '$0.00';
    const fileChangesStr = sessionInfo.summary_files > 0
      ? `${sessionInfo.summary_files} files (+${sessionInfo.summary_additions} -${sessionInfo.summary_deletions})`
      : 'なし';

    // Todos HTML
    const todosHtml = todos.length > 0 ? (() => {
      const doneCount = todos.filter(t => t.status === 'completed').length;
      return `
      <details class="card todo-accordion" style="margin-top: 16px;">
        <summary class="todo-summary">Todos <span class="todo-count">${doneCount}/${todos.length}</span></summary>
        <div class="todo-list">
          ${todos.map(t => {
            const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'cancelled' ? '❌' : '⬜';
            const dim = t.status === 'completed' || t.status === 'cancelled' ? 'style="opacity:0.6"' : '';
            return `<div class="todo-item" ${dim}>${icon} <span>${escapeHtml(t.content)}</span></div>`;
          }).join('')}
        </div>
      </details>
    `;
    })() : '';

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
  <title>${safeSessionTitle} - Session</title>
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
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 4px; }
    .session-title { font-size: 1.4em; font-weight: 700; color: #1d1d1f; margin: 0; line-height: 1.3; flex: 1; }
    .session-header-actions { display: flex; gap: 8px; align-items: center; }
    .header-parent { margin-bottom: 8px; }
    .header-parent-link { color: #0066cc; font-size: 0.8em; }
    .header-parent-link::before { content: '↳ '; }
    .header-dir { font-size: 0.78em; color: #86868b; font-family: 'SF Mono', 'Fira Code', monospace; margin-bottom: 14px; }
    .btn-delete:hover { border-color: #d32f2f; color: #d32f2f; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
    .metric-card { background: #f5f5f7; border-radius: 8px; padding: 8px 12px; }
    .metric-label { font-size: 0.65em; text-transform: uppercase; letter-spacing: 0.04em; color: #86868b; font-weight: 600; margin-bottom: 2px; }
    .metric-value { font-size: 1.05em; font-weight: 700; color: #1d1d1f; }
    .metric-sub { font-size: 0.7em; color: #86868b; margin-top: 1px; }

    /* Tool timeline */
    .tool-timeline { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; padding: 8px 12px; background: #fafafa; border-radius: 8px; border: 1px dashed #e0e0e0; }
    .tool-timeline.hidden { display: none; }
    .tool-line { font-size: 0.75em; padding: 2px 8px; background: #f5f5f5; border: 1px solid #e8e8e8; border-radius: 4px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; color: #888; }
    .tool-line.status-pending { background: #f5f5f5; border-color: #e8e8e8; }
    .tool-line.status-running { background: #f5f5f5; border-color: #e8e8e8; }
    .tool-line.status-completed { background: #f5f5f5; border-color: #e8e8e8; }
    .tool-line.status-error { background: #fff0f0; border-color: #f5c6c6; color: #c62828; }
    .tool-line.status-unknown { background: #f5f5f5; border-color: #e8e8e8; }
    .tool-name { font-weight: 600; color: #555; }
    .tool-input { color: #86868b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
    .tool-dur { color: #aaa; font-size: 0.9em; }
    .tool-error { color: #b71c1c; font-weight: 500; display: inline-flex; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tool-detail { display: none; width: 100%; background: #fafafa; border: 1px solid #e8e8e8; border-radius: 6px; padding: 8px 12px; margin: 2px 0; font-size: 0.75em; }
    .tool-detail.open { display: block; }
    .tool-detail-section { margin-bottom: 6px; }
    .tool-detail-section:last-child { margin-bottom: 0; }
    .tool-detail-label { font-weight: 600; color: #86868b; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }
    .tool-detail pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.95em; color: #333; max-height: 200px; overflow-y: auto; }
    .tool-detail-error { color: #c62828; }

    /* Todos */
    .todo-accordion { cursor: default; }
    .todo-summary { cursor: pointer; font-size: 0.95em; font-weight: 600; color: #86868b; padding: 4px 0; list-style: none; display: flex; align-items: center; gap: 8px; }
    .todo-summary::-webkit-details-marker { display: none; }
    .todo-summary::before { content: '▸'; font-size: 0.8em; transition: transform 0.15s; }
    details[open] > .todo-summary::before { transform: rotate(90deg); }
    .todo-count { font-size: 0.8em; font-weight: 400; color: #aaa; }
    .todo-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .todo-item { font-size: 0.9em; padding: 4px 0; display: flex; gap: 8px; align-items: flex-start; }

    /* Diffs */
    .diff-view { font-size: 0.8em; line-height: 1.5; overflow-x: auto; background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; max-height: 500px; overflow-y: auto; }

    /* Messages */
    .chat { margin-top: 8px; }
    .message { margin: 14px 0; display: flex; flex-direction: column; }
    .message-user { align-items: flex-end; }
    .message-assistant { align-items: flex-start; }
    .message-header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 0.8em; color: #86868b; flex-wrap: wrap; }
    .message-role { font-weight: 600; padding: 2px 10px; border-radius: 4px; font-size: 0.85em; }
    .message-user .message-role { background: #e3f2fd; color: #1565c0; }
    .message-assistant .message-role { background: #3a3a3c; color: white; }
    .meta-chip { font-size: 0.82em; font-weight: 500; padding: 2px 8px; border-radius: 4px; }
    .chip-model { background: #e8e0f0; color: #6b3fa0; }
    .chip-agent { background: #dff0df; color: #2d6a2e; }
    .chip-tps { background: #e8f4fd; color: #0b4f8a; }
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
${SESSION_COPY_STYLES}
  </style>
</head>
<body>
  <div class="breadcrumb">
    <a href="/">Home</a><span class="sep">/</span>
    <a href="/dir/${encodeURIComponent(sessionInfo.directory)}">${safePrettyDirectory}</a><span class="sep">/</span>
    <span>Session</span>
  </div>

  <div class="session-header">
      ${parentInfo ? `<div class="header-parent"><a href="/session/${encodeURIComponent(parentInfo.id)}" class="header-parent-link">${escapeHtml(parentInfo.title)}</a></div>` : ''}
      <div class="header-top">
        <h1 class="session-title">${safeSessionTitle}</h1>
        <div class="session-header-actions">
          ${renderSessionCopyButton(sessionInfo.id, sessionInfo.directory)}
          <button class="session-copy-btn btn-delete" onclick='deleteSession(${safeSessionIdForJs})' title="セッションを削除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
          </button>
        </div>
      </div>
      <div class="header-dir">${safePrettyDirectory}</div>
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
    ${SESSION_COPY_SCRIPT}

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

    function toggleToolDetail(id) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('open');
    }

    async function deleteSession(sessionId) {
      if (!confirm('このセッションとサブエージェントセッションを削除しますか？\\nこの操作は取り消せません。')) return;
      try {
        const res = await fetch('/api/session/' + encodeURIComponent(sessionId), { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert('削除に失敗しました: ' + (err.error || res.statusText));
          return;
        }
        window.location.href = '/';
      } catch (e) {
        alert('削除に失敗しました: ' + e.message);
      }
    }

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
