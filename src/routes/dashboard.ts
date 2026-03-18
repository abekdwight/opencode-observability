import type { Request, Response } from 'express';
import { getDb } from '../lib/db.js';
import { formatTokens, NAV_SEARCH } from '../lib/html.js';

interface DayCount {
  day: string;
  cnt: number;
}

interface ModelCount {
  model: string;
  cnt: number;
}

interface ToolCount {
  tool: string;
  cnt: number;
}

interface AgentCount {
  agent: string;
  cnt: number;
}

interface RecentSession {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  total_tokens: number;
}

function buildHeatmapSvg(dayCounts: DayCount[]): string {
  const dayMap = new Map<string, number>();
  for (const { day, cnt } of dayCounts) {
    dayMap.set(day, cnt);
  }

  // Build list of 365 days ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: { date: Date; dateStr: string }[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push({ date: d, dateStr: `${y}-${m}-${day}` });
  }

  // Determine color thresholds
  const counts = days.map(d => dayMap.get(d.dateStr) ?? 0);
  const maxCount = Math.max(...counts, 1);
  function getColor(cnt: number): string {
    if (cnt === 0) return '#ebedf0';
    const ratio = cnt / maxCount;
    if (ratio < 0.25) return '#9be9a8';
    if (ratio < 0.5) return '#40c463';
    if (ratio < 0.75) return '#30a14e';
    return '#216e39';
  }

  const CELL = 13;
  const GAP = 2;
  const STEP = CELL + GAP;
  const LEFT_PAD = 28; // space for weekday labels
  const TOP_PAD = 20;  // space for month labels

  // First day of the 365-day window — align to Sunday of that week
  const firstDate = days[0].date;
  const startDow = firstDate.getDay(); // 0=Sun

  // Build week columns: each column is a week (Sun–Sat)
  // Column index for each day
  const totalCols = Math.ceil((365 + startDow) / 7);
  const svgWidth = LEFT_PAD + totalCols * STEP;
  const svgHeight = TOP_PAD + 7 * STEP;

  // Month label positions
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const month = d.date.getMonth();
    const col = Math.floor((i + startDow) / 7);
    if (month !== lastMonth) {
      monthLabels.push({
        col,
        label: d.date.toLocaleString('en-US', { month: 'short' }),
      });
      lastMonth = month;
    }
  }

  // Build cell rects
  const rects: string[] = [];
  for (let i = 0; i < days.length; i++) {
    const { date, dateStr } = days[i];
    const col = Math.floor((i + startDow) / 7);
    const row = (i + startDow) % 7;
    const cnt = dayMap.get(dateStr) ?? 0;
    const color = getColor(cnt);
    const x = LEFT_PAD + col * STEP;
    const y = TOP_PAD + row * STEP;
    const dateLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const title = cnt > 0 ? `${dateLabel}: ${cnt} session${cnt !== 1 ? 's' : ''}` : dateLabel;
    rects.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"><title>${title}</title></rect>`);
  }

  // Weekday labels (Mon, Wed, Fri at rows 1, 3, 5)
  const weekdayLabels = [
    { row: 1, label: 'Mon' },
    { row: 3, label: 'Wed' },
    { row: 5, label: 'Fri' },
  ].map(({ row, label }) => {
    const y = TOP_PAD + row * STEP + CELL - 2;
    return `<text x="0" y="${y}" font-size="9" fill="#86868b" font-family="system-ui,sans-serif">${label}</text>`;
  });

  const monthLabelsSvg = monthLabels.map(({ col, label }) => {
    const x = LEFT_PAD + col * STEP;
    return `<text x="${x}" y="${TOP_PAD - 6}" font-size="10" fill="#86868b" font-family="system-ui,sans-serif">${label}</text>`;
  });

  return `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
  ${weekdayLabels.join('\n  ')}
  ${monthLabelsSvg.join('\n  ')}
  ${rects.join('\n  ')}
</svg>`;
}

function buildBarChart(items: { label: string; count: number }[], barColor: string): string {
  if (items.length === 0) return '<p style="color:#86868b;font-size:0.9em;">No data</p>';
  const maxCount = Math.max(...items.map(i => i.count), 1);
  return items.map(({ label, count }) => {
    const pct = (count / maxCount) * 100;
    return `
    <div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <span style="font-size:0.82em;color:#1d1d1f;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">${label}</span>
        <span style="font-size:0.8em;color:#86868b;font-weight:600;flex-shrink:0;margin-left:8px;">${count.toLocaleString()}</span>
      </div>
      <div style="height:8px;border-radius:4px;background:${barColor}26;overflow:hidden;">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${barColor};border-radius:4px;"></div>
      </div>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Incremental aggregation cache
//
// The OpenCode DB is append-only: session/message/part rows are never updated
// or deleted after creation. We exploit this by doing a full scan once, then
// only querying rows with time_created > watermark on subsequent requests.
//
// If a future delete feature is added, call invalidateDashboardCache() after
// the delete operation to force a full rebuild. As a safety net, we also
// compare session counts — if the count drops, we auto-rebuild.
// ---------------------------------------------------------------------------

interface ToolSuccessError {
  success: number;
  error: number;
}

interface AggCache {
  // Part aggregates
  toolCounts: Map<string, number>;
  toolErrors: number;
  totalToolCalls: number;
  toolSuccessErrorMap: Map<string, ToolSuccessError>; // tool → {success, error}
  errorPatterns: Map<string, number>; // classified error pattern → count
  lastPartRowid: number;

  // Message aggregates
  modelCounts: Map<string, number>;
  agentCounts: Map<string, number>;
  totalTokens: number;
  lastMessageRowid: number;

  // Session count (for delete detection)
  sessionCount: number;

  // Rendered HTML (rebuilt from aggregates)
  html: string | null;
  htmlTime: number;
}

// Classify free-text error strings into buckets
function classifyError(error: string): string {
  if (!error) return 'Unknown';
  if (/ENOENT|File not found|no such file|EISDIR/i.test(error)) return 'File not found';
  if (/Tool execution aborted/i.test(error)) return 'Aborted';
  if (/timed? ?out|deadline exceeded/i.test(error)) return 'Timeout';
  if (/fetch failed|status [45]\d\d|ECONNREFUSED|ENOTFOUND|network/i.test(error)) return 'Network/HTTP error';
  if (/patch|hunk|conflict/i.test(error)) return 'Patch failed';
  if (/permission denied|EACCES/i.test(error)) return 'Permission denied';
  if (/not found|not available|no such/i.test(error)) return 'Not found';
  if (/syntax|parse|unexpected token/i.test(error)) return 'Parse error';
  return 'Other';
}

let agg: AggCache | null = null;
const DELTA_MIN_INTERVAL = 10_000; // min 10s between delta checks
const HTML_REBUILD_INTERVAL = 30_000; // rebuild HTML every 30s (lightweight)

/** Call this when rows are deleted from the DB to force full rebuild. */
export function invalidateDashboardCache() {
  agg = null;
}

function fullBuild(db: ReturnType<typeof getDb>): AggCache {
  // Tool × status matrix (no extra cost: same GROUP BY)
  const partStats = db.prepare(`
    SELECT json_extract(p.data, '$.tool') AS tool,
           json_extract(p.data, '$.state.status') AS status,
           COUNT(*) AS cnt
    FROM part p
    WHERE json_extract(p.data, '$.type') = 'tool'
    GROUP BY tool, status
  `).all() as { tool: string; status: string; cnt: number }[];

  const toolCounts = new Map<string, number>();
  const toolSuccessErrorMap = new Map<string, ToolSuccessError>();
  let totalToolCalls = 0;
  let toolErrors = 0;
  for (const { tool, status, cnt } of partStats) {
    totalToolCalls += cnt;
    if (status === 'error') toolErrors += cnt;
    toolCounts.set(tool, (toolCounts.get(tool) || 0) + cnt);
    const entry = toolSuccessErrorMap.get(tool) || { success: 0, error: 0 };
    if (status === 'error') entry.error += cnt;
    else if (status === 'completed') entry.success += cnt;
    toolSuccessErrorMap.set(tool, entry);
  }

  // Error pattern classification (separate scan, only error rows)
  const errorRows = db.prepare(`
    SELECT json_extract(p.data, '$.state.error') AS error
    FROM part p
    WHERE json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.state.status') = 'error'
  `).all() as { error: string }[];

  const errorPatterns = new Map<string, number>();
  for (const { error } of errorRows) {
    const pattern = classifyError(error);
    errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
  }

  const lastPartRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM part`).get() as { r: number | null }).r ?? 0;

  const msgRows = db.prepare(`
    SELECT json_extract(m.data, '$.modelID') AS model,
           json_extract(m.data, '$.agent') AS agent,
           COALESCE(json_extract(m.data, '$.tokens.total'), 0) AS tokens
    FROM message m
    WHERE json_extract(m.data, '$.role') = 'assistant'
  `).all() as { model: string | null; agent: string | null; tokens: number }[];

  const modelCounts = new Map<string, number>();
  const agentCounts = new Map<string, number>();
  let totalTokens = 0;
  for (const { model, agent, tokens } of msgRows) {
    totalTokens += tokens;
    if (model) modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    if (agent) agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
  }

  const lastMessageRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM message`).get() as { r: number | null }).r ?? 0;
  const sessionCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM session`).get() as { cnt: number }).cnt;

  return { toolCounts, toolErrors, totalToolCalls, toolSuccessErrorMap, errorPatterns, lastPartRowid, modelCounts, agentCounts, totalTokens, lastMessageRowid, sessionCount, html: null, htmlTime: 0 };
}

function deltaUpdate(db: ReturnType<typeof getDb>, c: AggCache): void {
  // Safety net: detect deletes by comparing session count
  const currentCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM session`).get() as { cnt: number }).cnt;
  if (currentCount < c.sessionCount) {
    // Rows were deleted — full rebuild
    const fresh = fullBuild(db);
    Object.assign(c, fresh);
    return;
  }
  c.sessionCount = currentCount;

  // Delta parts (rowid-based: 0ms for empty delta, ~2ms for 100 new rows)
  const currentPartRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM part`).get() as { r: number | null }).r ?? 0;
  const prevPartRowid = c.lastPartRowid;
  if (currentPartRowid > prevPartRowid) {
    const newParts = db.prepare(`
      SELECT json_extract(data, '$.tool') AS tool,
             json_extract(data, '$.state.status') AS status,
             COUNT(*) AS cnt
      FROM part
      WHERE rowid > ? AND json_extract(data, '$.type') = 'tool'
      GROUP BY tool, status
    `).all(prevPartRowid) as { tool: string; status: string; cnt: number }[];

    for (const { tool, status, cnt } of newParts) {
      c.totalToolCalls += cnt;
      if (status === 'error') c.toolErrors += cnt;
      c.toolCounts.set(tool, (c.toolCounts.get(tool) || 0) + cnt);
      const entry = c.toolSuccessErrorMap.get(tool) || { success: 0, error: 0 };
      if (status === 'error') entry.error += cnt;
      else if (status === 'completed') entry.success += cnt;
      c.toolSuccessErrorMap.set(tool, entry);
    }

    // Delta error patterns
    const newErrors = db.prepare(`
      SELECT json_extract(data, '$.state.error') AS error
      FROM part
      WHERE rowid > ? AND json_extract(data, '$.type') = 'tool'
        AND json_extract(data, '$.state.status') = 'error'
    `).all(prevPartRowid) as { error: string }[];
    for (const { error } of newErrors) {
      const pattern = classifyError(error);
      c.errorPatterns.set(pattern, (c.errorPatterns.get(pattern) || 0) + 1);
    }

    c.lastPartRowid = currentPartRowid;
    c.html = null;
  }

  // Delta messages (rowid-based)
  const currentMsgRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM message`).get() as { r: number | null }).r ?? 0;
  if (currentMsgRowid > c.lastMessageRowid) {
    const newMsgs = db.prepare(`
      SELECT json_extract(data, '$.modelID') AS model,
             json_extract(data, '$.agent') AS agent,
             COALESCE(json_extract(data, '$.tokens.total'), 0) AS tokens
      FROM message
      WHERE rowid > ? AND json_extract(data, '$.role') = 'assistant'
    `).all(c.lastMessageRowid) as { model: string | null; agent: string | null; tokens: number }[];

    for (const { model, agent, tokens } of newMsgs) {
      c.totalTokens += tokens;
      if (model) c.modelCounts.set(model, (c.modelCounts.get(model) || 0) + 1);
      if (agent) c.agentCounts.set(agent, (c.agentCounts.get(agent) || 0) + 1);
    }
    c.lastMessageRowid = currentMsgRowid;
    c.html = null;
  }
}

export function dashboardRoute(_req: Request, res: Response) {
  const db = getDb();
  try {
    const now = Date.now();

    // Initialize or delta-update the aggregate cache
    if (!agg) {
      agg = fullBuild(db);
    } else if (now - agg.htmlTime > DELTA_MIN_INTERVAL) {
      deltaUpdate(db, agg);
    }

    // Return cached HTML if still fresh
    if (agg.html && now - agg.htmlTime < HTML_REBUILD_INTERVAL) {
      res.send(agg.html);
      return;
    }

    // --- Derive display values from aggregate cache ---
    const toolRows: ToolCount[] = Array.from(agg.toolCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([tool, cnt]) => ({ tool, cnt }));
    const modelRows: ModelCount[] = Array.from(agg.modelCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([model, cnt]) => ({ model, cnt }));
    const agentRows: AgentCount[] = Array.from(agg.agentCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([agent, cnt]) => ({ agent, cnt }));

    const totalToolCalls = agg.totalToolCalls;
    const toolErrors = agg.toolErrors;
    const totalTokens = agg.totalTokens;
    const toolErrorRate = totalToolCalls > 0
      ? ((toolErrors / totalToolCalls) * 100).toFixed(1) + '%' : '0.0%';

    // These are cheap queries — always run live
    const heatmapRows = db.prepare(`
      SELECT date(time_created/1000, 'unixepoch', 'localtime') as day, COUNT(*) as cnt
      FROM session WHERE parent_id IS NULL GROUP BY day
    `).all() as DayCount[];

    const totalSessions = (db.prepare(`SELECT COUNT(*) as cnt FROM session WHERE parent_id IS NULL`).get() as { cnt: number }).cnt;
    const activeProjects = (db.prepare(`SELECT COUNT(DISTINCT project_id) as cnt FROM session WHERE parent_id IS NULL`).get() as { cnt: number }).cnt;

    const recentSessionsBase = db.prepare(`
      SELECT id, title, directory, time_created FROM session WHERE parent_id IS NULL ORDER BY time_created DESC LIMIT 5
    `).all() as { id: string; title: string; directory: string; time_created: number }[];

    // Batch token lookup for recent sessions (avoids correlated subquery)
    const recentIds = recentSessionsBase.map(s => s.id);
    const recentTokenRows = recentIds.length > 0 ? db.prepare(`
      SELECT m.session_id, COALESCE(SUM(json_extract(m.data, '$.tokens.total')), 0) AS total_tokens
      FROM message m WHERE m.session_id IN (${recentIds.map(() => '?').join(',')})
        AND json_extract(m.data, '$.role') = 'assistant' GROUP BY m.session_id
    `).all(...recentIds) as { session_id: string; total_tokens: number }[] : [];
    const recentTokenMap = new Map(recentTokenRows.map(r => [r.session_id, r.total_tokens]));
    const recentSessions: RecentSession[] = recentSessionsBase.map(s => ({
      ...s, total_tokens: recentTokenMap.get(s.id) || 0,
    }));

    // Build SVG heatmap
    const heatmapSvg = buildHeatmapSvg(heatmapRows);

    // Build bar charts
    const modelBarChart = buildBarChart(
      modelRows.map(r => ({ label: r.model ?? '(unknown)', count: r.cnt })),
      '#0066cc'
    );
    const toolBarChart = buildBarChart(
      toolRows.map(r => ({ label: r.tool ?? '(unknown)', count: r.cnt })),
      '#0066cc'
    );
    const agentBarChart = buildBarChart(
      agentRows.map(r => ({ label: r.agent ?? '(unknown)', count: r.cnt })),
      '#0066cc'
    );

    // Tool success/error matrix
    const toolMatrixRows = Array.from(agg.toolSuccessErrorMap.entries())
      .map(([tool, { success, error }]) => ({ tool, success, error, total: success + error, rate: success + error > 0 ? ((error / (success + error)) * 100) : 0 }))
      .sort((a, b) => b.error - a.error)
      .slice(0, 12);

    const toolMatrixHtml = toolMatrixRows.length > 0 ? toolMatrixRows.map(r => {
      const pct = r.rate.toFixed(1);
      const barW = Math.max(1, r.rate);
      const color = r.rate > 20 ? '#d32f2f' : r.rate > 5 ? '#f57c00' : '#4caf50';
      return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:0.82em;">
        <span style="width:140px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.tool}</span>
        <span style="width:55px;text-align:right;color:#4caf50;">${r.success.toLocaleString()}</span>
        <span style="width:45px;text-align:right;color:#d32f2f;">${r.error.toLocaleString()}</span>
        <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barW}%;background:${color};border-radius:3px;"></div>
        </div>
        <span style="width:45px;text-align:right;color:${color};font-weight:600;">${pct}%</span>
      </div>`;
    }).join('') : '<p style="color:#86868b;font-size:0.9em;">No data</p>';

    // Error pattern chart
    const errorPatternChart = buildBarChart(
      Array.from(agg.errorPatterns.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count })),
      '#d32f2f'
    );

    // Recent sessions list
    const recentSessionsHtml = recentSessions.map(s => {
      const dateStr = new Date(Number(s.time_created)).toLocaleString('ja-JP', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const tokens = s.total_tokens > 0 ? formatTokens(s.total_tokens) : '—';
      const dir = s.directory || '';
      return `
      <a href="/session/${s.id}" class="recent-item">
        <div class="recent-title">${s.title || '(no title)'}</div>
        <div class="recent-meta">
          <span>${dateStr}</span>
          <span class="recent-pill">${tokens} tokens</span>
          <span class="recent-dir">${dir}</span>
        </div>
      </a>`;
    }).join('');

    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - OpenCode Telemetry</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    h1 { font-size: 1.6em; font-weight: 700; margin-bottom: 8px; padding-bottom: 12px; border-bottom: 2px solid #1d1d1f; }
    h2 { font-size: 1em; font-weight: 700; color: #1d1d1f; margin: 0 0 14px 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card { background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 20px 24px; margin-bottom: 16px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric-card { background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 16px 18px; }
    .metric-label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; color: #86868b; font-weight: 600; margin-bottom: 4px; }
    .metric-value { font-size: 1.4em; font-weight: 700; color: #1d1d1f; }
    .metric-sub { font-size: 0.75em; color: #86868b; margin-top: 2px; }
    .charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 600px) { .charts-grid { grid-template-columns: 1fr; } }
    .heatmap-scroll { overflow-x: auto; padding-bottom: 4px; }
    /* Recent sessions */
    .recent-item { display: block; padding: 14px 0; border-bottom: 1px solid #f0f0f0; transition: background 0.1s; text-decoration: none; }
    .recent-item:last-child { border-bottom: none; }
    .recent-item:hover { background: #f8f8fa; }
    .recent-title { font-size: 0.95em; font-weight: 600; color: #1d1d1f; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .recent-meta { font-size: 0.78em; color: #86868b; display: flex; gap: 10px; align-items: center; }
    .recent-pill { background: #fff3e0; color: #e65100; padding: 1px 8px; border-radius: 6px; }
    .recent-dir { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.92em; }
    .more-link { display: block; text-align: center; padding: 12px; font-size: 0.88em; font-weight: 500; color: #0066cc; border-top: 1px solid #f0f0f0; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Dashboard</h1>
  ${NAV_SEARCH}

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Total Sessions</div>
      <div class="metric-value">${totalSessions.toLocaleString()}</div>
      <div class="metric-sub">main sessions only</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens</div>
      <div class="metric-value">${formatTokens(totalTokens)}</div>
      <div class="metric-sub">assistant messages</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Tool Calls</div>
      <div class="metric-value">${totalToolCalls.toLocaleString()}</div>
      <div class="metric-sub">all sessions</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Tool Error Rate</div>
      <div class="metric-value">${toolErrorRate}</div>
      <div class="metric-sub">${toolErrors.toLocaleString()} errors</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Projects</div>
      <div class="metric-value">${activeProjects.toLocaleString()}</div>
      <div class="metric-sub">distinct project IDs</div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Sessions</h2>
    ${recentSessionsHtml || '<p style="color:#86868b;font-size:0.9em;">No sessions found</p>'}
    <a href="/directories" class="more-link">All directories &rarr;</a>
  </div>

  <div class="card">
    <h2>Activity (last 365 days)</h2>
    <div class="heatmap-scroll">
      ${heatmapSvg}
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:0.75em;color:#86868b;">
      <span>Less</span>
      <svg width="68" height="12"><rect x="0"  y="0" width="12" height="12" rx="2" fill="#ebedf0"/><rect x="14" y="0" width="12" height="12" rx="2" fill="#9be9a8"/><rect x="28" y="0" width="12" height="12" rx="2" fill="#40c463"/><rect x="42" y="0" width="12" height="12" rx="2" fill="#30a14e"/><rect x="56" y="0" width="12" height="12" rx="2" fill="#216e39"/></svg>
      <span>More</span>
    </div>
  </div>

  <div class="charts-grid">
    <div class="card">
      <h2>Model Usage</h2>
      ${modelBarChart}
    </div>
    <div class="card">
      <h2>Top Tools</h2>
      ${toolBarChart}
    </div>
    <div class="card">
      <h2>Agent Distribution</h2>
      ${agentBarChart}
    </div>
    <div class="card">
      <h2>Tool Reliability</h2>
      <div style="display:flex;gap:10px;margin-bottom:10px;font-size:0.7em;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">
        <span style="width:140px;">Tool</span>
        <span style="width:55px;text-align:right;">OK</span>
        <span style="width:45px;text-align:right;">Error</span>
        <span style="flex:1;">Error Rate</span>
        <span style="width:45px;"></span>
      </div>
      ${toolMatrixHtml}
    </div>
    <div class="card">
      <h2>Error Patterns</h2>
      ${errorPatternChart}
    </div>
  </div>
</body>
</html>
    `;
    agg.html = html;
    agg.htmlTime = Date.now();
    res.send(html);
  } finally {
    db.close();
  }
}
