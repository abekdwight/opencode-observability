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

// In-memory cache (TTL: 3 minutes)
let cache: { html: string; time: number } | null = null;
const CACHE_TTL = 3 * 60 * 1000;

export function dashboardRoute(_req: Request, res: Response) {
  if (cache && Date.now() - cache.time < CACHE_TTL) {
    res.send(cache.html);
    return;
  }

  const db = getDb();
  try {
    // Activity heatmap data
    const heatmapRows = db.prepare(`
      SELECT date(time_created/1000, 'unixepoch', 'localtime') as day, COUNT(*) as cnt
      FROM session
      WHERE parent_id IS NULL
      GROUP BY day
    `).all() as DayCount[];

    // Summary metrics
    const totalSessions = (db.prepare(`
      SELECT COUNT(*) as cnt FROM session WHERE parent_id IS NULL
    `).get() as { cnt: number }).cnt;

    // Single-pass part scan: tool counts, error counts, tool ranking
    const partStats = db.prepare(`
      SELECT
        json_extract(p.data, '$.tool') AS tool,
        json_extract(p.data, '$.state.status') AS status,
        COUNT(*) AS cnt
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
      GROUP BY tool, status
    `).all() as { tool: string; status: string; cnt: number }[];

    let totalToolCalls = 0;
    let toolErrors = 0;
    const toolCountMap = new Map<string, number>();
    for (const { tool, status, cnt } of partStats) {
      totalToolCalls += cnt;
      if (status === 'error') toolErrors += cnt;
      toolCountMap.set(tool, (toolCountMap.get(tool) || 0) + cnt);
    }
    const toolRows: ToolCount[] = Array.from(toolCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, cnt]) => ({ tool, cnt }));

    const toolErrorRate = totalToolCalls > 0
      ? ((toolErrors / totalToolCalls) * 100).toFixed(1) + '%'
      : '0.0%';

    // Single-pass message scan: tokens, model usage, agent distribution
    const msgStats = db.prepare(`
      SELECT
        json_extract(m.data, '$.modelID') AS model,
        json_extract(m.data, '$.agent') AS agent,
        COALESCE(json_extract(m.data, '$.tokens.total'), 0) AS tokens
      FROM message m
      WHERE json_extract(m.data, '$.role') = 'assistant'
    `).all() as { model: string | null; agent: string | null; tokens: number }[];

    let totalTokens = 0;
    const modelCountMap = new Map<string, number>();
    const agentCountMap = new Map<string, number>();
    for (const { model, agent, tokens } of msgStats) {
      totalTokens += tokens;
      if (model) modelCountMap.set(model, (modelCountMap.get(model) || 0) + 1);
      if (agent) agentCountMap.set(agent, (agentCountMap.get(agent) || 0) + 1);
    }
    const modelRows: ModelCount[] = Array.from(modelCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([model, cnt]) => ({ model, cnt }));
    const agentRows: AgentCount[] = Array.from(agentCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([agent, cnt]) => ({ agent, cnt }));

    const activeProjects = (db.prepare(`
      SELECT COUNT(DISTINCT project_id) as cnt FROM session WHERE parent_id IS NULL
    `).get() as { cnt: number }).cnt;

    // Recent sessions
    const recentSessions = db.prepare(`
      SELECT s.id, s.title, s.time_created,
             COALESCE((
               SELECT SUM(json_extract(m.data, '$.tokens.total'))
               FROM message m
               WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
             ), 0) as total_tokens
      FROM session s
      WHERE s.parent_id IS NULL
      ORDER BY s.time_created DESC
      LIMIT 10
    `).all() as RecentSession[];

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

    // Recent sessions list
    const recentSessionsHtml = recentSessions.map(s => {
      const dateStr = new Date(Number(s.time_created)).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      const tokens = s.total_tokens > 0 ? formatTokens(s.total_tokens) : '—';
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <div style="overflow:hidden;margin-right:12px;">
          <a href="/session/${s.id}" style="font-size:0.9em;font-weight:500;color:#0066cc;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.title || '(no title)'}</a>
          <span style="font-size:0.75em;color:#86868b;">${dateStr}</span>
        </div>
        <span style="font-size:0.8em;color:#86868b;white-space:nowrap;flex-shrink:0;">${tokens}</span>
      </div>`;
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
      <h2>Recent Sessions</h2>
      ${recentSessionsHtml || '<p style="color:#86868b;font-size:0.9em;">No sessions found</p>'}
    </div>
  </div>
</body>
</html>
    `;
    cache = { html, time: Date.now() };
    res.send(html);
  } finally {
    db.close();
  }
}
