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

// Day-keyed bucket: "tool\tstatus\tday" → count (for time-range filtering)
// and "model\tday" → count, "agent\tday" → count, "errorPattern\tday" → count
interface AggCache {
  // Part aggregates (daily buckets)
  toolDayBuckets: Map<string, number>;  // "tool\tstatus\tday" → count
  errorPatternDays: Map<string, number>; // "pattern\tday" → count
  lastPartRowid: number;

  // Message aggregates (daily buckets)
  modelDays: Map<string, number>;  // "model\tday" → count
  agentDays: Map<string, number>;  // "agent\tday" → count
  tokenDays: Map<string, number>;  // "day" → total tokens
  lastMessageRowid: number;

  // Session count (for delete detection)
  sessionCount: number;

  // Rendered HTML per range (rebuilt from aggregates)
  htmlCache: Map<string, { html: string; time: number }>;
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
  // Part scan with day dimension
  const partStats = db.prepare(`
    SELECT json_extract(p.data, '$.tool') AS tool,
           json_extract(p.data, '$.state.status') AS status,
           date(p.time_created/1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS cnt
    FROM part p
    WHERE json_extract(p.data, '$.type') = 'tool'
    GROUP BY tool, status, day
  `).all() as { tool: string; status: string; day: string; cnt: number }[];

  const toolDayBuckets = new Map<string, number>();
  for (const { tool, status, day, cnt } of partStats) {
    const key = `${tool}\t${status}\t${day}`;
    toolDayBuckets.set(key, (toolDayBuckets.get(key) || 0) + cnt);
  }

  // Error patterns with day
  const errorRows = db.prepare(`
    SELECT json_extract(p.data, '$.state.error') AS error,
           date(p.time_created/1000, 'unixepoch', 'localtime') AS day
    FROM part p
    WHERE json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.state.status') = 'error'
  `).all() as { error: string; day: string }[];

  const errorPatternDays = new Map<string, number>();
  for (const { error, day } of errorRows) {
    const pattern = classifyError(error);
    const key = `${pattern}\t${day}`;
    errorPatternDays.set(key, (errorPatternDays.get(key) || 0) + 1);
  }

  const lastPartRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM part`).get() as { r: number | null }).r ?? 0;

  // Message scan with day dimension
  const msgRows = db.prepare(`
    SELECT json_extract(m.data, '$.modelID') AS model,
           json_extract(m.data, '$.agent') AS agent,
           COALESCE(json_extract(m.data, '$.tokens.total'), 0) AS tokens,
           date(m.time_created/1000, 'unixepoch', 'localtime') AS day
    FROM message m
    WHERE json_extract(m.data, '$.role') = 'assistant'
  `).all() as { model: string | null; agent: string | null; tokens: number; day: string }[];

  const modelDays = new Map<string, number>();
  const agentDays = new Map<string, number>();
  const tokenDays = new Map<string, number>();
  for (const { model, agent, tokens, day } of msgRows) {
    tokenDays.set(day, (tokenDays.get(day) || 0) + tokens);
    if (model) { const k = `${model}\t${day}`; modelDays.set(k, (modelDays.get(k) || 0) + 1); }
    if (agent) { const k = `${agent}\t${day}`; agentDays.set(k, (agentDays.get(k) || 0) + 1); }
  }

  const lastMessageRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM message`).get() as { r: number | null }).r ?? 0;
  const sessionCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM session`).get() as { cnt: number }).cnt;

  return { toolDayBuckets, errorPatternDays, lastPartRowid, modelDays, agentDays, tokenDays, lastMessageRowid, sessionCount, htmlCache: new Map() };
}

function deltaUpdate(db: ReturnType<typeof getDb>, c: AggCache): void {
  const currentCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM session`).get() as { cnt: number }).cnt;
  if (currentCount < c.sessionCount) {
    Object.assign(c, fullBuild(db));
    return;
  }
  c.sessionCount = currentCount;

  const currentPartRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM part`).get() as { r: number | null }).r ?? 0;
  const prevPartRowid = c.lastPartRowid;
  if (currentPartRowid > prevPartRowid) {
    const newParts = db.prepare(`
      SELECT json_extract(data, '$.tool') AS tool, json_extract(data, '$.state.status') AS status,
             date(time_created/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
      FROM part WHERE rowid > ? AND json_extract(data, '$.type') = 'tool'
      GROUP BY tool, status, day
    `).all(prevPartRowid) as { tool: string; status: string; day: string; cnt: number }[];
    for (const { tool, status, day, cnt } of newParts) {
      const key = `${tool}\t${status}\t${day}`;
      c.toolDayBuckets.set(key, (c.toolDayBuckets.get(key) || 0) + cnt);
    }

    const newErrors = db.prepare(`
      SELECT json_extract(data, '$.state.error') AS error, date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM part WHERE rowid > ? AND json_extract(data, '$.type') = 'tool' AND json_extract(data, '$.state.status') = 'error'
    `).all(prevPartRowid) as { error: string; day: string }[];
    for (const { error, day } of newErrors) {
      const key = `${classifyError(error)}\t${day}`;
      c.errorPatternDays.set(key, (c.errorPatternDays.get(key) || 0) + 1);
    }
    c.lastPartRowid = currentPartRowid;
    c.htmlCache.clear();
  }

  const currentMsgRowid = (db.prepare(`SELECT MAX(rowid) AS r FROM message`).get() as { r: number | null }).r ?? 0;
  if (currentMsgRowid > c.lastMessageRowid) {
    const newMsgs = db.prepare(`
      SELECT json_extract(data, '$.modelID') AS model, json_extract(data, '$.agent') AS agent,
             COALESCE(json_extract(data, '$.tokens.total'), 0) AS tokens,
             date(time_created/1000, 'unixepoch', 'localtime') AS day
      FROM message WHERE rowid > ? AND json_extract(data, '$.role') = 'assistant'
    `).all(c.lastMessageRowid) as { model: string | null; agent: string | null; tokens: number; day: string }[];
    for (const { model, agent, tokens, day } of newMsgs) {
      c.tokenDays.set(day, (c.tokenDays.get(day) || 0) + tokens);
      if (model) { const k = `${model}\t${day}`; c.modelDays.set(k, (c.modelDays.get(k) || 0) + 1); }
      if (agent) { const k = `${agent}\t${day}`; c.agentDays.set(k, (c.agentDays.get(k) || 0) + 1); }
    }
    c.lastMessageRowid = currentMsgRowid;
    c.htmlCache.clear();
  }
}

// Filter day-keyed maps by date threshold and aggregate
function filterMap(map: Map<string, number>, minDay: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, cnt] of map) {
    const tab = key.lastIndexOf('\t');
    const day = key.substring(tab + 1);
    if (minDay && day < minDay) continue;
    const label = key.substring(0, tab);
    out.set(label, (out.get(label) || 0) + cnt);
  }
  return out;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMinDay(range: string): string | null {
  if (range === 'all') return null;
  const d = new Date();
  // 'day' = today only, 'week' = last 7 days, 'month' = last 30 days
  if (range === 'week') d.setDate(d.getDate() - 6);
  else if (range === 'month') d.setDate(d.getDate() - 29);
  // 'day' → no offset, d is already today
  // Use local time to match DB's date(..., 'localtime')
  return toLocalDateStr(d);
}

const VALID_RANGES = ['all', 'month', 'week', 'day'] as const;

export function dashboardRoute(req: Request, res: Response) {
  const db = getDb();
  try {
    const now = Date.now();
    const range = VALID_RANGES.includes(req.query.range as any) ? (req.query.range as string) : 'all';

    if (!agg) {
      agg = fullBuild(db);
    } else {
      const lastCheck = Math.max(...Array.from(agg.htmlCache.values()).map(v => v.time), 0);
      if (now - lastCheck > DELTA_MIN_INTERVAL) deltaUpdate(db, agg);
    }

    const cached = agg.htmlCache.get(range);
    if (cached && now - cached.time < HTML_REBUILD_INTERVAL) {
      res.send(cached.html);
      return;
    }

    const minDay = getMinDay(range);

    // Derive display values filtered by range
    // Tool counts: aggregate tool\tstatus\tday → tool totals
    const filteredToolStatusDay = new Map<string, number>();
    for (const [key, cnt] of agg.toolDayBuckets) {
      const parts = key.split('\t'); // tool, status, day
      if (minDay && parts[2] < minDay) continue;
      const tsKey = `${parts[0]}\t${parts[1]}`;
      filteredToolStatusDay.set(tsKey, (filteredToolStatusDay.get(tsKey) || 0) + cnt);
    }

    const toolCounts = new Map<string, number>();
    const toolSuccessErrorMap = new Map<string, ToolSuccessError>();
    let totalToolCalls = 0;
    let toolErrors = 0;
    for (const [tsKey, cnt] of filteredToolStatusDay) {
      const [tool, status] = tsKey.split('\t');
      totalToolCalls += cnt;
      if (status === 'error') toolErrors += cnt;
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + cnt);
      const entry = toolSuccessErrorMap.get(tool) || { success: 0, error: 0 };
      if (status === 'error') entry.error += cnt;
      else if (status === 'completed') entry.success += cnt;
      toolSuccessErrorMap.set(tool, entry);
    }

    const toolRows: ToolCount[] = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([tool, cnt]) => ({ tool, cnt }));

    const errorPatterns = filterMap(agg.errorPatternDays, minDay);
    const modelCounts = filterMap(agg.modelDays, minDay);
    const agentCounts = filterMap(agg.agentDays, minDay);

    let totalTokens = 0;
    for (const [day, t] of agg.tokenDays) {
      if (minDay && day < minDay) continue;
      totalTokens += t;
    }

    const modelRows: ModelCount[] = Array.from(modelCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([model, cnt]) => ({ model, cnt }));
    const agentRows: AgentCount[] = Array.from(agentCounts.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([agent, cnt]) => ({ agent, cnt }));

    const toolErrorRate = totalToolCalls > 0
      ? ((toolErrors / totalToolCalls) * 100).toFixed(1) + '%' : '0.0%';

    // These are cheap queries — always run live
    const heatmapRows = db.prepare(`
      SELECT date(time_created/1000, 'unixepoch', 'localtime') as day, COUNT(*) as cnt
      FROM session WHERE parent_id IS NULL GROUP BY day
    `).all() as DayCount[];

    const sessionWhereRange = minDay ? ` AND date(time_created/1000, 'unixepoch', 'localtime') >= '${minDay}'` : '';
    const totalSessions = (db.prepare(`SELECT COUNT(*) as cnt FROM session WHERE parent_id IS NULL${sessionWhereRange}`).get() as { cnt: number }).cnt;
    const activeProjects = (db.prepare(`SELECT COUNT(DISTINCT project_id) as cnt FROM session WHERE parent_id IS NULL${sessionWhereRange}`).get() as { cnt: number }).cnt;

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
    const toolMatrixRows = Array.from(toolSuccessErrorMap.entries())
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
      Array.from(errorPatterns.entries())
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
    .range-bar { display: flex; gap: 6px; margin-bottom: 16px; }
    .range-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid #d2d2d7; background: white; font-size: 0.82em; font-weight: 500; cursor: pointer; color: #1d1d1f; text-decoration: none; transition: all 0.15s; }
    .range-btn:hover { border-color: #0066cc; color: #0066cc; text-decoration: none; }
    .range-btn.active { background: #0066cc; color: white; border-color: #0066cc; }
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

  <div class="range-bar">
    ${VALID_RANGES.map(r => `<a href="/?range=${r}" class="range-btn${r === range ? ' active' : ''}">${r === 'all' ? 'All' : r === 'month' ? '1 Month' : r === 'week' ? '1 Week' : '1 Day'}</a>`).join('')}
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
    agg.htmlCache.set(range, { html, time: Date.now() });
    res.send(html);
  } finally {
    db.close();
  }
}
