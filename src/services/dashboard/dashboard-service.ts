import {
  buildLineChartSvg,
  buildStackedBarChartSvg,
  classifyTool,
  computeRatio,
  fillMissingDays,
} from "../../lib/analytics.js";
import { calcRepoDayActiveDurations } from "../../lib/duration.js";
import { resolveRepoBucketKey } from "../../lib/repo-root.js";
import {
  escapeHtml,
  formatDurationShort,
  formatTokens,
  NAV_SEARCH,
  prettifyPath,
} from "../../lib/text-format.js";
import {
  fetchDashboardLiveSummary,
  fetchDashboardMessageData,
  fetchDashboardPartData,
  fetchDashboardRepoData,
} from "../../repositories/dashboard/dashboard-repository.js";

type SqliteDatabase = import("better-sqlite3").Database;

export const DASHBOARD_RANGES = ["all", "month", "week", "day"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export type DashboardView = "daily" | "hourly";

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
  time_updated: number;
  total_tokens: number;
}

interface ToolSuccessError {
  success: number;
  error: number;
}

export interface DashboardAggregateState {
  toolDayBuckets: Map<string, number>;
  errorPatternDays: Map<string, number>;
  toolErrorDetails: Map<string, number>;
  mcpServerBuckets: Map<string, number>;
  lastPartRowid: number;

  modelDays: Map<string, number>;
  agentDays: Map<string, number>;
  tokenDays: Map<string, number>;
  tokenInputDays: Map<string, number>;
  tokenOutputDays: Map<string, number>;
  tokenInputHours: Map<string, number>;
  tokenOutputHours: Map<string, number>;
  subagentDays: Map<string, number>;
  subagentHours: Map<string, number>;
  lastMessageRowid: number;

  sessionCount: number;
  repoDays: Map<string, number>;
  lastSessionRowid: number;

  htmlCache: Map<string, { html: string; time: number }>;
}

export interface DashboardSummaryMetrics {
  totalSessions: number;
  totalTokens: number;
  totalToolCalls: number;
  toolErrors: number;
  toolErrorRate: string;
  activeProjects: number;
}

export interface DashboardRecentSessionItem {
  id: string;
  title: string;
  directory: string;
  timeUpdated: number;
  totalTokens: number;
}

export interface DashboardDayValue {
  day: string;
  value: number;
}

export interface DashboardLineSeries {
  label: string;
  color: string;
  points: DashboardDayValue[];
}

export interface DashboardStackValue {
  name: string;
  value: number;
  color: string;
}

export interface DashboardStackBar {
  label: string;
  stacks: DashboardStackValue[];
}

export interface DashboardTokenTrendData {
  inputRatioPercent: number;
  dailySeries: DashboardLineSeries[];
  hourlyBars: DashboardStackBar[];
}

export interface DashboardSubagentTrendData {
  dailySeries: DashboardLineSeries[];
  hourlyBars: DashboardStackBar[];
}

export interface DashboardRepoDayCell {
  day: string;
  label: string;
  muted: boolean;
}

export interface DashboardRepoRow {
  repo: string;
  dayCells: DashboardRepoDayCell[];
  totalLabel: string;
}

export interface DashboardRepoBreakdownData {
  dayHeaders: string[];
  rows: DashboardRepoRow[];
}

export interface DashboardMcpUsageRow {
  server: string;
  calls: number;
  errors: number;
  errorRate: number;
  isBuiltin: boolean;
}

export interface DashboardToolReliabilityRow {
  tool: string;
  success: number;
  error: number;
  total: number;
  errorRate: number;
}

export interface DashboardBarItem {
  label: string;
  count: number;
}

export interface DashboardViewModel {
  range: DashboardRange;
  view: DashboardView;
  summary: DashboardSummaryMetrics;
  recentSessions: DashboardRecentSessionItem[];
  heatmapDays: DayCount[];
  errorTrendSeries: DashboardLineSeries[];
  tokenTrend: DashboardTokenTrendData;
  subagentTrend: DashboardSubagentTrendData;
  activeRepos: DashboardRepoBreakdownData;
  modelUsage: DashboardBarItem[];
  toolUsage: DashboardBarItem[];
  agentDistribution: DashboardBarItem[];
  mcpUsage: DashboardMcpUsageRow[];
  toolReliabilityMatrix: DashboardToolReliabilityRow[];
  errorPatterns: DashboardBarItem[];
}

function buildHeatmapSvg(dayCounts: DayCount[]): string {
  const dayMap = new Map<string, number>();
  for (const { day, cnt } of dayCounts) {
    dayMap.set(day, cnt);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: { date: Date; dateStr: string }[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    days.push({ date: d, dateStr: `${y}-${m}-${day}` });
  }

  const counts = days.map((d) => dayMap.get(d.dateStr) ?? 0);
  const maxCount = Math.max(...counts, 1);
  function getColor(cnt: number): string {
    if (cnt === 0) return "#ebedf0";
    const ratio = cnt / maxCount;
    if (ratio < 0.25) return "#9be9a8";
    if (ratio < 0.5) return "#40c463";
    if (ratio < 0.75) return "#30a14e";
    return "#216e39";
  }

  const CELL = 13;
  const GAP = 2;
  const STEP = CELL + GAP;
  const LEFT_PAD = 28;
  const TOP_PAD = 20;

  const firstDate = days[0].date;
  const startDow = firstDate.getDay();

  const totalCols = Math.ceil((365 + startDow) / 7);
  const svgWidth = LEFT_PAD + totalCols * STEP;
  const svgHeight = TOP_PAD + 7 * STEP;

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const month = d.date.getMonth();
    const col = Math.floor((i + startDow) / 7);
    if (month !== lastMonth) {
      monthLabels.push({
        col,
        label: d.date.toLocaleString("en-US", { month: "short" }),
      });
      lastMonth = month;
    }
  }

  const rects: string[] = [];
  for (let i = 0; i < days.length; i++) {
    const { date, dateStr } = days[i];
    const col = Math.floor((i + startDow) / 7);
    const row = (i + startDow) % 7;
    const cnt = dayMap.get(dateStr) ?? 0;
    const color = getColor(cnt);
    const x = LEFT_PAD + col * STEP;
    const y = TOP_PAD + row * STEP;
    const dateLabel = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const title =
      cnt > 0
        ? `${dateLabel}: ${cnt} session${cnt !== 1 ? "s" : ""}`
        : dateLabel;
    rects.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"><title>${title}</title></rect>`,
    );
  }

  const weekdayLabels = [
    { row: 1, label: "Mon" },
    { row: 3, label: "Wed" },
    { row: 5, label: "Fri" },
  ].map(({ row, label }) => {
    const y = TOP_PAD + row * STEP + CELL - 2;
    return `<text x="0" y="${y}" font-size="9" fill="#86868b" font-family="system-ui,sans-serif">${label}</text>`;
  });

  const monthLabelsSvg = monthLabels.map(({ col, label }) => {
    const x = LEFT_PAD + col * STEP;
    return `<text x="${x}" y="${TOP_PAD - 6}" font-size="10" fill="#86868b" font-family="system-ui,sans-serif">${label}</text>`;
  });

  return `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
  ${weekdayLabels.join("\n  ")}
  ${monthLabelsSvg.join("\n  ")}
  ${rects.join("\n  ")}
</svg>`;
}

function buildBarChart(
  items: { label: string; count: number }[],
  barColor: string,
): string {
  if (items.length === 0)
    return '<p style="color:#86868b;font-size:0.9em;">No data</p>';
  const maxCount = Math.max(...items.map((i) => i.count), 1);
  return items
    .map(({ label, count }) => {
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
    })
    .join("");
}

function classifyError(error: string): string {
  if (!error) return "Unknown";
  if (/ENOENT|File not found|no such file|EISDIR/i.test(error))
    return "File not found";
  if (/Tool execution aborted/i.test(error)) return "Aborted";
  if (/timed? ?out|deadline exceeded/i.test(error)) return "Timeout";
  if (
    /fetch failed|HTTP [45]\d\d|status [45]\d\d|ECONNREFUSED|ENOTFOUND|network/i.test(
      error,
    )
  )
    return "Network/HTTP error";
  if (/patch|hunk|conflict/i.test(error)) return "Patch failed";
  if (/permission denied|EACCES/i.test(error)) return "Permission denied";
  if (/not found|not available|no such/i.test(error)) return "Not found";
  if (/syntax|parse|unexpected token/i.test(error)) return "Parse error";
  return "Other";
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMinDay(range: DashboardRange): string | null {
  if (range === "all") return null;
  const d = new Date();
  if (range === "week") d.setDate(d.getDate() - 6);
  else if (range === "month") d.setDate(d.getDate() - 29);
  return toLocalDateStr(d);
}

function filterMap(
  map: Map<string, number>,
  minDay: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, cnt] of map) {
    const tab = key.lastIndexOf("\t");
    const day = key.substring(tab + 1);
    if (minDay && day < minDay) continue;
    const label = key.substring(0, tab);
    out.set(label, (out.get(label) || 0) + cnt);
  }
  return out;
}

function applyPartData(
  state: DashboardAggregateState,
  data: ReturnType<typeof fetchDashboardPartData>,
): void {
  for (const { tool, status, day, cnt } of data.rows) {
    const key = `${tool}\t${status}\t${day}`;
    state.toolDayBuckets.set(key, (state.toolDayBuckets.get(key) || 0) + cnt);

    const { type, mcpServer } = classifyTool(tool ?? "");
    const server = type === "builtin" ? "builtin" : (mcpServer ?? "other");
    const mcpKey = `${server}\t${status}\t${day}`;
    state.mcpServerBuckets.set(
      mcpKey,
      (state.mcpServerBuckets.get(mcpKey) || 0) + cnt,
    );
  }

  for (const { error, day } of data.errorRows) {
    const key = `${classifyError(error)}\t${day}`;
    state.errorPatternDays.set(key, (state.errorPatternDays.get(key) || 0) + 1);
  }

  for (const { tool, day, cnt } of data.toolErrorRows) {
    const toolName = tool ?? "unknown";
    const key = `${toolName}\t${day}`;
    state.toolErrorDetails.set(
      key,
      (state.toolErrorDetails.get(key) || 0) + cnt,
    );
  }

  state.lastPartRowid = data.currentRowId;
}

function applyMessageData(
  state: DashboardAggregateState,
  data: ReturnType<typeof fetchDashboardMessageData>,
): void {
  for (const { model, agent, tokens, day } of data.rows) {
    state.tokenDays.set(day, (state.tokenDays.get(day) || 0) + tokens);
    if (model) {
      const key = `${model}\t${day}`;
      state.modelDays.set(key, (state.modelDays.get(key) || 0) + 1);
    }
    if (agent) {
      const key = `${agent}\t${day}`;
      state.agentDays.set(key, (state.agentDays.get(key) || 0) + 1);
    }
  }

  for (const { day, hour, input_tokens, output_tokens } of data.tokenIoRows) {
    const input = Number(input_tokens) || 0;
    const output = Number(output_tokens) || 0;
    state.tokenInputDays.set(day, (state.tokenInputDays.get(day) || 0) + input);
    state.tokenOutputDays.set(
      day,
      (state.tokenOutputDays.get(day) || 0) + output,
    );
    const hourKey = `${day}\t${hour}`;
    state.tokenInputHours.set(
      hourKey,
      (state.tokenInputHours.get(hourKey) || 0) + input,
    );
    state.tokenOutputHours.set(
      hourKey,
      (state.tokenOutputHours.get(hourKey) || 0) + output,
    );
  }

  for (const { agent, day, hour, cnt } of data.subagentRows) {
    const dayKey = `${agent}\t${day}`;
    state.subagentDays.set(dayKey, (state.subagentDays.get(dayKey) || 0) + cnt);
    const hourKey = `${agent}\t${day}\t${hour}`;
    state.subagentHours.set(
      hourKey,
      (state.subagentHours.get(hourKey) || 0) + cnt,
    );
  }

  state.lastMessageRowid = data.currentRowId;
}

function applyRepoData(
  state: DashboardAggregateState,
  data: ReturnType<typeof fetchDashboardRepoData>,
): void {
  for (const { worktree, directory, day, cnt } of data.rows) {
    const repo = resolveRepoBucketKey(worktree ?? "", directory ?? "");
    const key = `${repo}\t${day}`;
    state.repoDays.set(key, (state.repoDays.get(key) || 0) + cnt);
  }

  state.lastSessionRowid = data.currentRowId;
  state.sessionCount = data.sessionCount;
}

function createEmptyAggregateState(): DashboardAggregateState {
  return {
    toolDayBuckets: new Map(),
    errorPatternDays: new Map(),
    toolErrorDetails: new Map(),
    mcpServerBuckets: new Map(),
    lastPartRowid: 0,
    modelDays: new Map(),
    agentDays: new Map(),
    tokenDays: new Map(),
    tokenInputDays: new Map(),
    tokenOutputDays: new Map(),
    tokenInputHours: new Map(),
    tokenOutputHours: new Map(),
    subagentDays: new Map(),
    subagentHours: new Map(),
    lastMessageRowid: 0,
    sessionCount: 0,
    repoDays: new Map(),
    lastSessionRowid: 0,
    htmlCache: new Map(),
  };
}

function toDashboardDayValues(map: Map<string, number>): DashboardDayValue[] {
  return Array.from(map.entries())
    .map(([day, value]) => ({ day, value }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function toLineChartData(
  series: DashboardLineSeries[],
): { label: string; color: string; data: Map<string, number> }[] {
  return series.map((item) => ({
    label: item.label,
    color: item.color,
    data: new Map(item.points.map((point) => [point.day, point.value])),
  }));
}

function buildRecentSessionsData(
  recentSessions: RecentSession[],
): DashboardRecentSessionItem[] {
  return recentSessions.map((session) => ({
    id: session.id,
    title: session.title,
    directory: session.directory,
    timeUpdated: Number(session.time_updated),
    totalTokens: session.total_tokens,
  }));
}

function renderRecentSessionsHtml(
  recentSessions: DashboardRecentSessionItem[],
): string {
  return recentSessions
    .map((session) => {
      const dateStr = new Date(session.timeUpdated).toLocaleString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const tokens =
        session.totalTokens > 0 ? formatTokens(session.totalTokens) : "—";
      const safeTitle = escapeHtml(session.title || "(no title)");
      const safeDir = escapeHtml(prettifyPath(session.directory || ""));
      return `
      <a href="/session/${encodeURIComponent(session.id)}" class="recent-item">
        <div class="recent-title">${safeTitle}</div>
        <div class="recent-meta">
          <span>${dateStr}</span>
          <span class="recent-pill">${tokens} tokens</span>
          <span class="recent-dir">${safeDir}</span>
        </div>
      </a>`;
    })
    .join("");
}

function buildToolReliabilityMatrixData(
  toolSuccessErrorMap: Map<string, ToolSuccessError>,
): DashboardToolReliabilityRow[] {
  const sortedRows = Array.from(toolSuccessErrorMap.entries())
    .map(([tool, { success, error }]) => ({
      tool,
      success,
      error,
      total: success + error,
      errorRate: success + error > 0 ? (error / (success + error)) * 100 : 0,
    }))
    .sort((a, b) => b.error - a.error);

  const topRows = sortedRows.slice(0, 15);
  const otherRows = sortedRows.slice(15);
  if (otherRows.length > 0) {
    const otherBucket = otherRows.reduce(
      (acc, row) => ({
        tool: "Other",
        success: acc.success + row.success,
        error: acc.error + row.error,
        total: acc.total + row.total,
        errorRate: 0,
      }),
      { tool: "Other", success: 0, error: 0, total: 0, errorRate: 0 },
    );
    otherBucket.errorRate =
      otherBucket.total > 0 ? (otherBucket.error / otherBucket.total) * 100 : 0;
    topRows.push(otherBucket);
  }

  return topRows;
}

function renderToolMatrixHtml(rows: DashboardToolReliabilityRow[]): string {
  return rows.length > 0
    ? rows
        .map((row) => {
          const pct = row.errorRate.toFixed(1);
          const barW = Math.max(1, row.errorRate);
          const color =
            row.errorRate > 20
              ? "#d32f2f"
              : row.errorRate > 5
                ? "#f57c00"
                : "#4caf50";
          const toolLabel =
            row.tool === "Other"
              ? `<span style="width:140px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;color:#86868b;">${escapeHtml(row.tool)}</span>`
              : `<a href="/tool-errors/${encodeURIComponent(row.tool)}" style="width:140px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;color:inherit;text-decoration:none;">${escapeHtml(row.tool)}</a>`;
          return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:0.82em;">
        ${toolLabel}
        <span style="width:55px;text-align:right;color:#4caf50;">${row.success.toLocaleString()}</span>
        <span style="width:45px;text-align:right;color:#d32f2f;">${row.error.toLocaleString()}</span>
        <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barW}%;background:${color};border-radius:3px;"></div>
        </div>
        <span style="width:45px;text-align:right;color:${color};font-weight:600;">${pct}%</span>
      </div>`;
        })
        .join("")
    : '<p style="color:#86868b;font-size:0.9em;">No data</p>';
}

function buildMcpUsageData(
  mcpServerBuckets: Map<string, number>,
  minDay: string | null,
): DashboardMcpUsageRow[] {
  const mcpServerMap = new Map<string, { calls: number; errors: number }>();
  for (const [key, cnt] of mcpServerBuckets) {
    const parts = key.split("\t");
    if (minDay && parts[2] < minDay) continue;
    const server = parts[0];
    const status = parts[1];
    const entry = mcpServerMap.get(server) || { calls: 0, errors: 0 };
    entry.calls += cnt;
    if (status === "error") entry.errors += cnt;
    mcpServerMap.set(server, entry);
  }

  const builtinEntry = mcpServerMap.get("builtin") || { calls: 0, errors: 0 };
  mcpServerMap.delete("builtin");

  const sortedMcpServers = Array.from(mcpServerMap.entries()).sort(
    (a, b) => b[1].calls - a[1].calls,
  );
  const mcpServerRows = sortedMcpServers.slice(0, 10);
  const otherMcpServers = sortedMcpServers.slice(10).reduce(
    (acc, [, entry]) => ({
      calls: acc.calls + entry.calls,
      errors: acc.errors + entry.errors,
    }),
    { calls: 0, errors: 0 },
  );
  if (otherMcpServers.calls > 0) {
    mcpServerRows.push(["Other", otherMcpServers]);
  }

  const rows: DashboardMcpUsageRow[] = [
    {
      server: "Builtin Tools",
      calls: builtinEntry.calls,
      errors: builtinEntry.errors,
      errorRate:
        builtinEntry.calls > 0
          ? (builtinEntry.errors / builtinEntry.calls) * 100
          : 0,
      isBuiltin: true,
    },
    ...mcpServerRows.map(([server, entry]) => ({
      server,
      calls: entry.calls,
      errors: entry.errors,
      errorRate: entry.calls > 0 ? (entry.errors / entry.calls) * 100 : 0,
      isBuiltin: false,
    })),
  ];

  return rows.some((row) => row.calls > 0) ? rows : [];
}

function renderMcpAggHtml(rows: DashboardMcpUsageRow[]): string {
  return rows.length > 0
    ? rows
        .map((row) => {
          const pct = row.errorRate.toFixed(1);
          const barW = Math.max(1, row.errorRate);
          const color =
            row.errorRate > 20
              ? "#d32f2f"
              : row.errorRate > 5
                ? "#f57c00"
                : "#4caf50";
          const serverLabel = row.isBuiltin
            ? '<span style="background:#eef3ff;color:#2f5fd0;border-radius:999px;padding:1px 8px;font-size:0.76em;font-weight:700;">Builtin Tools</span>'
            : escapeHtml(row.server);
          return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:0.82em;${row.isBuiltin ? "background:#f8f9ff;border:1px solid #e1e8ff;padding:6px 8px;border-radius:7px;" : ""}">
        <span style="width:140px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${serverLabel}</span>
        <span style="width:55px;text-align:right;color:#1d1d1f;">${row.calls.toLocaleString()}</span>
        <span style="width:45px;text-align:right;color:#d32f2f;">${row.errors.toLocaleString()}</span>
        <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${barW}%;background:${color};border-radius:3px;"></div>
        </div>
        <span style="width:45px;text-align:right;color:${color};font-weight:600;">${pct}%</span>
      </div>`;
        })
        .join("")
    : '<p style="color:#86868b;font-size:0.9em;">No data</p>';
}

function buildErrorTrendData(
  toolErrorDetails: Map<string, number>,
  minDay: string | null,
): DashboardLineSeries[] {
  const toolErrorTotals = new Map<string, number>();
  for (const [key, cnt] of toolErrorDetails) {
    const [tool, day] = key.split("\t");
    if (minDay && day < minDay) continue;
    toolErrorTotals.set(tool, (toolErrorTotals.get(tool) || 0) + cnt);
  }
  const topErrorTools = Array.from(toolErrorTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tool]) => tool);
  const topErrorToolSet = new Set(topErrorTools);

  const errorTrendSeriesMap = new Map<string, Map<string, number>>();
  for (const tool of topErrorTools) errorTrendSeriesMap.set(tool, new Map());
  errorTrendSeriesMap.set("Other", new Map());
  for (const [key, cnt] of toolErrorDetails) {
    const [tool, day] = key.split("\t");
    if (minDay && day < minDay) continue;
    const seriesKey = topErrorToolSet.has(tool) ? tool : "Other";
    const m = errorTrendSeriesMap.get(seriesKey);
    if (!m) continue;
    m.set(day, (m.get(day) || 0) + cnt);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay30 = new Date(today);
  startDay30.setDate(startDay30.getDate() - 29);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const effectiveStart =
    minDay && minDay > fmt(startDay30) ? minDay : fmt(startDay30);

  const seriesColors = [
    "#d32f2f",
    "#1565c0",
    "#2e7d32",
    "#e65100",
    "#6a1b9a",
    "#86868b",
  ];

  return [
    ...topErrorTools,
    ...(errorTrendSeriesMap.get("Other")?.size ? ["Other"] : []),
  ]
    .map((tool) => {
      const data = errorTrendSeriesMap.get(tool);
      return data ? { tool, data } : null;
    })
    .filter(
      (item): item is { tool: string; data: Map<string, number> } =>
        item !== null,
    )
    .map((item, i) => ({
      label: item.tool,
      color: seriesColors[i] ?? "#86868b",
      points: toDashboardDayValues(
        fillMissingDays(item.data, effectiveStart, fmt(today)),
      ),
    }));
}

function renderErrorTrendSvg(errorTrendSeries: DashboardLineSeries[]): string {
  return errorTrendSeries.length > 0
    ? buildLineChartSvg(toLineChartData(errorTrendSeries), {
        width: 920,
        height: 280,
      })
    : '<p style="color:#86868b;font-size:0.9em;">No error data</p>';
}

function buildTokenTrendData(
  tokenInputDays: Map<string, number>,
  tokenOutputDays: Map<string, number>,
  tokenInputHours: Map<string, number>,
  tokenOutputHours: Map<string, number>,
  minDay: string | null,
  view: DashboardView,
): DashboardTokenTrendData {
  const totalInput = [...tokenInputDays.entries()]
    .filter(([day]) => !minDay || day >= minDay)
    .reduce((sum, [, value]) => sum + value, 0);
  const totalOutput = [...tokenOutputDays.entries()]
    .filter(([day]) => !minDay || day >= minDay)
    .reduce((sum, [, value]) => sum + value, 0);
  const inputRatioPercent =
    computeRatio(totalInput, totalInput + totalOutput) * 100;

  if (view === "hourly") {
    const hourInputTotals = new Array(24).fill(0);
    const hourOutputTotals = new Array(24).fill(0);

    for (const [key, value] of tokenInputHours) {
      const [day, hour] = key.split("\t");
      if (minDay && day < minDay) continue;
      hourInputTotals[Number(hour)] += value;
    }

    for (const [key, value] of tokenOutputHours) {
      const [day, hour] = key.split("\t");
      if (minDay && day < minDay) continue;
      hourOutputTotals[Number(hour)] += value;
    }

    const hourlyBars: DashboardStackBar[] = Array.from(
      { length: 24 },
      (_, h) => ({
        label: String(h).padStart(2, "0"),
        stacks: [
          { name: "Input", value: hourInputTotals[h], color: "#1565c0" },
          { name: "Output", value: hourOutputTotals[h], color: "#2e7d32" },
        ],
      }),
    );

    return {
      inputRatioPercent,
      dailySeries: [],
      hourlyBars,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start30 = new Date(today);
  start30.setDate(start30.getDate() - 29);
  const fmtDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const effStart =
    minDay && minDay > fmtDay(start30) ? minDay : fmtDay(start30);

  const inputDayMap = new Map<string, number>();
  for (const [day, value] of tokenInputDays) {
    if (minDay && day < minDay) continue;
    inputDayMap.set(day, value);
  }

  const outputDayMap = new Map<string, number>();
  for (const [day, value] of tokenOutputDays) {
    if (minDay && day < minDay) continue;
    outputDayMap.set(day, value);
  }

  const dailySeries: DashboardLineSeries[] = [
    {
      label: "Input",
      color: "#1565c0",
      points: toDashboardDayValues(
        fillMissingDays(inputDayMap, effStart, fmtDay(today)),
      ),
    },
    {
      label: "Output",
      color: "#2e7d32",
      points: toDashboardDayValues(
        fillMissingDays(outputDayMap, effStart, fmtDay(today)),
      ),
    },
  ];

  return {
    inputRatioPercent,
    dailySeries,
    hourlyBars: [],
  };
}

function renderTokenTrendHtml(
  tokenTrend: DashboardTokenTrendData,
  range: DashboardRange,
  view: DashboardView,
): string {
  const ioRatioPct = tokenTrend.inputRatioPercent.toFixed(1);
  const ioRatioBar = `
      <div style="display:flex;align-items:center;gap:10px;min-width:260px;">
        <div style="font-size:0.85em;color:#86868b;white-space:nowrap;">Input ratio: <strong style="color:#1d1d1f;">${ioRatioPct}%</strong></div>
        <div style="flex:1;height:10px;background:#edf1f5;border-radius:999px;overflow:hidden;min-width:120px;">
          <div style="height:100%;width:${Math.max(0, Math.min(100, tokenTrend.inputRatioPercent))}%;background:linear-gradient(90deg,#1565c0,#2e7d32);border-radius:999px;"></div>
        </div>
      </div>`;

  if (view === "hourly") {
    const hourlySvg = buildStackedBarChartSvg(tokenTrend.hourlyBars, {
      width: 920,
      height: 280,
    });
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        ${ioRatioBar}
        <div style="font-size:0.82em;"><a href="/?range=${range}">View daily &rarr;</a></div>
      </div>
      <div style="overflow-x:auto;padding-bottom:4px;">${hourlySvg}</div>`;
  }

  const dailySvg = buildLineChartSvg(toLineChartData(tokenTrend.dailySeries), {
    width: 920,
    height: 280,
  });
  return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        ${ioRatioBar}
        <div style="font-size:0.82em;"><a href="/?range=${range}&view=hourly">View hourly &rarr;</a></div>
      </div>
      <div style="overflow-x:auto;padding-bottom:4px;">${dailySvg}</div>`;
}

function buildSubagentTrendData(
  subagentDays: Map<string, number>,
  subagentHours: Map<string, number>,
  minDay: string | null,
  view: DashboardView,
): DashboardSubagentTrendData {
  const subagentTotals = new Map<string, number>();
  for (const [key, cnt] of subagentDays) {
    const [agent, day] = key.split("\t");
    if (minDay && day < minDay) continue;
    subagentTotals.set(agent, (subagentTotals.get(agent) || 0) + cnt);
  }
  const topAgents = Array.from(subagentTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agent]) => agent);
  const topAgentSet = new Set(topAgents);

  if (view === "hourly") {
    const agentHourMap = new Map<string, number[]>();
    for (const agent of [...topAgents, "Other"]) {
      agentHourMap.set(agent, new Array(24).fill(0));
    }
    for (const [key, cnt] of subagentHours) {
      const parts = key.split("\t");
      const agent = parts[0];
      const day = parts[1];
      const hour = Number(parts[2]);
      if (minDay && day < minDay) continue;
      const seriesKey = topAgentSet.has(agent) ? agent : "Other";
      const hourBucket = agentHourMap.get(seriesKey);
      if (!hourBucket) continue;
      hourBucket[hour] += cnt;
    }

    const agentColors = [
      "#0066cc",
      "#d32f2f",
      "#2e7d32",
      "#e65100",
      "#6a1b9a",
      "#86868b",
    ];

    const hourlyBars: DashboardStackBar[] = Array.from(
      { length: 24 },
      (_, h) => ({
        label: String(h).padStart(2, "0"),
        stacks: [...topAgents, "Other"]
          .map((agent) => ({ agent, bucket: agentHourMap.get(agent) }))
          .filter((entry): entry is { agent: string; bucket: number[] } =>
            Boolean(entry.bucket?.some((value) => value > 0)),
          )
          .map((entry, i) => ({
            name: entry.agent,
            value: entry.bucket[h] ?? 0,
            color: agentColors[i] ?? "#86868b",
          })),
      }),
    );

    return {
      dailySeries: [],
      hourlyBars,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start30 = new Date(today);
  start30.setDate(start30.getDate() - 29);
  const fmtDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const effStart =
    minDay && minDay > fmtDay(start30) ? minDay : fmtDay(start30);

  const seriesColors = [
    "#0066cc",
    "#d32f2f",
    "#2e7d32",
    "#e65100",
    "#6a1b9a",
    "#86868b",
  ];

  const agentDaySeriesMap = new Map<string, Map<string, number>>();
  for (const agent of [...topAgents, "Other"]) {
    agentDaySeriesMap.set(agent, new Map());
  }
  for (const [key, cnt] of subagentDays) {
    const [agent, day] = key.split("\t");
    if (minDay && day < minDay) continue;
    const seriesKey = topAgentSet.has(agent) ? agent : "Other";
    const dayMap = agentDaySeriesMap.get(seriesKey);
    if (!dayMap) continue;
    dayMap.set(day, (dayMap.get(day) || 0) + cnt);
  }

  const dailySeries: DashboardLineSeries[] = [
    ...topAgents,
    ...["Other"].filter(() => Boolean(agentDaySeriesMap.get("Other")?.size)),
  ]
    .map((agent) => {
      const data = agentDaySeriesMap.get(agent);
      return data ? { agent, data } : null;
    })
    .filter(
      (item): item is { agent: string; data: Map<string, number> } =>
        item !== null,
    )
    .map((item, i) => ({
      label: item.agent,
      color: seriesColors[i] ?? "#86868b",
      points: toDashboardDayValues(
        fillMissingDays(item.data, effStart, fmtDay(today)),
      ),
    }));

  return {
    dailySeries,
    hourlyBars: [],
  };
}

function renderSubagentTrendHtml(
  subagentTrend: DashboardSubagentTrendData,
  range: DashboardRange,
  view: DashboardView,
): string {
  if (view === "hourly") {
    const hourlySvg = buildStackedBarChartSvg(subagentTrend.hourlyBars, {
      width: 920,
      height: 280,
    });
    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;font-size:0.82em;">
        <a href="/?range=${range}">View daily &rarr;</a>
      </div>
      <div style="overflow-x:auto;padding-bottom:4px;">${hourlySvg}</div>`;
  }

  const dailySvg =
    subagentTrend.dailySeries.length > 0
      ? buildLineChartSvg(toLineChartData(subagentTrend.dailySeries), {
          width: 920,
          height: 280,
        })
      : '<p style="color:#86868b;font-size:0.9em;">No subagent data</p>';

  return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;font-size:0.82em;">
        <a href="/?range=${range}&view=hourly">View hourly &rarr;</a>
      </div>
      <div style="overflow-x:auto;padding-bottom:4px;">${dailySvg}</div>`;
}

function buildRepoBreakdownData(
  db: SqliteDatabase,
  repoDays: Map<string, number>,
  minDay: string | null,
): DashboardRepoBreakdownData {
  const repoSessionCounts = new Map<string, number>();
  for (const [key, cnt] of repoDays) {
    const [repo, day] = key.split("\t");
    if (minDay && day < minDay) continue;
    repoSessionCounts.set(repo, (repoSessionCounts.get(repo) || 0) + cnt);
  }

  const activeRepos = Array.from(repoSessionCounts.entries())
    .filter(([repo]) => repo !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([repo]) => repo);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last7Days: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    last7Days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }

  if (activeRepos.length === 0) {
    return {
      dayHeaders: last7Days,
      rows: [],
    };
  }

  const repoDayDurationMap = calcRepoDayActiveDurations(
    db,
    activeRepos,
    last7Days,
  );
  const repoDaySessionCountMap = new Map<string, number>();
  const activeRepoSet = new Set(activeRepos);
  for (const [key, cnt] of repoDays) {
    const [repo, day] = key.split("\t");
    if (!activeRepoSet.has(repo)) continue;
    if (minDay && day < minDay) continue;
    const repoDayKey = `${repo}\t${day}`;
    repoDaySessionCountMap.set(
      repoDayKey,
      (repoDaySessionCountMap.get(repoDayKey) || 0) + cnt,
    );
  }

  const rows: DashboardRepoRow[] = activeRepos.map((repo) => {
    let totalActiveMs = 0;
    const dayCells: DashboardRepoDayCell[] = last7Days.map((day) => {
      if (minDay && day < minDay) {
        return { day, label: "—", muted: true };
      }

      const key = `${repo}\t${day}`;
      const dur = repoDayDurationMap.get(key) || 0;
      const sessionCount = repoDaySessionCountMap.get(key) || 0;
      if (dur > 0) totalActiveMs += dur;
      const label =
        dur > 0
          ? formatDurationShort(dur)
          : sessionCount > 0
            ? `${sessionCount}s`
            : "—";
      return { day, label, muted: false };
    });

    const totalSessions = repoSessionCounts.get(repo) || 0;
    const totalLabel =
      totalActiveMs > 0
        ? formatDurationShort(totalActiveMs)
        : totalSessions > 0
          ? `${totalSessions}s`
          : "—";

    return {
      repo,
      dayCells,
      totalLabel,
    };
  });

  return {
    dayHeaders: last7Days,
    rows,
  };
}

function renderRepoBreakdownHtml(repoData: DashboardRepoBreakdownData): string {
  if (repoData.rows.length === 0) {
    return '<p style="color:#86868b;font-size:0.9em;">No repository data</p>';
  }

  const repoTableRows = repoData.rows
    .map((row) => {
      const dayCells = row.dayCells
        .map((dayCell) =>
          dayCell.muted
            ? '<td style="text-align:center;color:#d2d2d7;">—</td>'
            : `<td style="text-align:center;font-size:0.82em;">${dayCell.label}</td>`,
        )
        .join("");
      return `<tr>
          <td style="font-family:monospace;font-size:0.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;" title="${escapeHtml(row.repo)}">${escapeHtml(prettifyPath(row.repo))}</td>
          ${dayCells}
          <td style="text-align:right;font-size:0.82em;color:#86868b;">${row.totalLabel}</td>
        </tr>`;
    })
    .join("");

  const dayHeaders = repoData.dayHeaders
    .map((day) => {
      const parts = day.split("-");
      return `<th style="text-align:center;min-width:54px;">${parts[1]}/${parts[2]}</th>`;
    })
    .join("");

  return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
          <thead>
            <tr style="color:#86868b;font-size:0.76em;text-transform:uppercase;letter-spacing:0.05em;">
              <th style="text-align:left;padding:6px 0;">Repository</th>
              ${dayHeaders}
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${repoTableRows}</tbody>
        </table>
      </div>`;
}

function buildDashboardData(
  db: SqliteDatabase,
  state: DashboardAggregateState,
  range: DashboardRange,
  view: DashboardView,
): DashboardViewModel {
  const minDay = getMinDay(range);
  const liveSummary = fetchDashboardLiveSummary(db, minDay);

  const filteredToolStatusDay = new Map<string, number>();
  for (const [key, cnt] of state.toolDayBuckets) {
    const parts = key.split("\t");
    if (minDay && parts[2] < minDay) continue;
    const tsKey = `${parts[0]}\t${parts[1]}`;
    filteredToolStatusDay.set(
      tsKey,
      (filteredToolStatusDay.get(tsKey) || 0) + cnt,
    );
  }

  const toolCounts = new Map<string, number>();
  const toolSuccessErrorMap = new Map<string, ToolSuccessError>();
  let totalToolCalls = 0;
  let toolErrors = 0;
  for (const [tsKey, cnt] of filteredToolStatusDay) {
    const [tool, status] = tsKey.split("\t");
    totalToolCalls += cnt;
    if (status === "error") toolErrors += cnt;
    toolCounts.set(tool, (toolCounts.get(tool) || 0) + cnt);
    const entry = toolSuccessErrorMap.get(tool) || { success: 0, error: 0 };
    if (status === "error") entry.error += cnt;
    else if (status === "completed") entry.success += cnt;
    toolSuccessErrorMap.set(tool, entry);
  }

  const toolRows: ToolCount[] = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, cnt]) => ({ tool, cnt }));

  const errorPatterns = filterMap(state.errorPatternDays, minDay);
  const modelCounts = filterMap(state.modelDays, minDay);
  const agentCounts = filterMap(state.agentDays, minDay);

  let totalTokens = 0;
  for (const [day, tokens] of state.tokenDays) {
    if (minDay && day < minDay) continue;
    totalTokens += tokens;
  }

  const modelRows: ModelCount[] = Array.from(modelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([model, cnt]) => ({ model, cnt }));
  const agentRows: AgentCount[] = Array.from(agentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([agent, cnt]) => ({ agent, cnt }));

  const toolErrorRate =
    totalToolCalls > 0
      ? `${((toolErrors / totalToolCalls) * 100).toFixed(1)}%`
      : "0.0%";

  const recentTokenMap = new Map(
    liveSummary.recentTokenRows.map((row) => [
      row.session_id,
      row.total_tokens,
    ]),
  );
  const recentSessionsWithTokens: RecentSession[] =
    liveSummary.recentSessions.map((session) => ({
      ...session,
      total_tokens: recentTokenMap.get(session.id) || 0,
    }));

  return {
    range,
    view,
    summary: {
      totalSessions: liveSummary.totalSessions,
      totalTokens,
      totalToolCalls,
      toolErrors,
      toolErrorRate,
      activeProjects: liveSummary.activeProjects,
    },
    recentSessions: buildRecentSessionsData(recentSessionsWithTokens),
    heatmapDays: liveSummary.heatmapRows,
    errorTrendSeries: buildErrorTrendData(state.toolErrorDetails, minDay),
    tokenTrend: buildTokenTrendData(
      state.tokenInputDays,
      state.tokenOutputDays,
      state.tokenInputHours,
      state.tokenOutputHours,
      minDay,
      view,
    ),
    subagentTrend: buildSubagentTrendData(
      state.subagentDays,
      state.subagentHours,
      minDay,
      view,
    ),
    activeRepos: buildRepoBreakdownData(db, state.repoDays, minDay),
    modelUsage: modelRows.map((row) => ({
      label: row.model ?? "(unknown)",
      count: row.cnt,
    })),
    toolUsage: toolRows.map((row) => ({
      label: row.tool ?? "(unknown)",
      count: row.cnt,
    })),
    agentDistribution: agentRows.map((row) => ({
      label: row.agent ?? "(unknown)",
      count: row.cnt,
    })),
    mcpUsage: buildMcpUsageData(state.mcpServerBuckets, minDay),
    toolReliabilityMatrix: buildToolReliabilityMatrixData(toolSuccessErrorMap),
    errorPatterns: Array.from(errorPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
  };
}

export function buildDashboardAggregateState(
  db: SqliteDatabase,
): DashboardAggregateState {
  const state = createEmptyAggregateState();
  applyPartData(state, fetchDashboardPartData(db));
  applyMessageData(state, fetchDashboardMessageData(db));
  applyRepoData(state, fetchDashboardRepoData(db));
  return state;
}

export function updateDashboardAggregateState(
  db: SqliteDatabase,
  state: DashboardAggregateState,
): DashboardAggregateState {
  const repoData = fetchDashboardRepoData(db, state.lastSessionRowid);
  if (repoData.sessionCount < state.sessionCount) {
    return buildDashboardAggregateState(db);
  }

  let changed = false;
  state.sessionCount = repoData.sessionCount;
  if (repoData.currentRowId > state.lastSessionRowid) {
    applyRepoData(state, repoData);
    changed = true;
  }

  const partData = fetchDashboardPartData(db, state.lastPartRowid);
  if (partData.currentRowId > state.lastPartRowid) {
    applyPartData(state, partData);
    changed = true;
  }

  const messageData = fetchDashboardMessageData(db, state.lastMessageRowid);
  if (messageData.currentRowId > state.lastMessageRowid) {
    applyMessageData(state, messageData);
    changed = true;
  }

  if (changed) {
    state.htmlCache.clear();
  }
  return state;
}

export function buildDashboardViewModel(
  db: SqliteDatabase,
  state: DashboardAggregateState,
  range: DashboardRange,
  view: DashboardView,
): DashboardViewModel {
  return buildDashboardData(db, state, range, view);
}

export function renderDashboardHtml(vm: DashboardViewModel): string {
  const { range, view, summary } = vm;
  const recentSessionsHtml = renderRecentSessionsHtml(vm.recentSessions);
  const tokenTrendHtml = renderTokenTrendHtml(vm.tokenTrend, range, view);
  const subagentTrendHtml = renderSubagentTrendHtml(
    vm.subagentTrend,
    range,
    view,
  );
  const repoBreakdownHtml = renderRepoBreakdownHtml(vm.activeRepos);
  const modelBarChart = buildBarChart(vm.modelUsage, "#0066cc");
  const toolBarChart = buildBarChart(vm.toolUsage, "#0066cc");
  const agentBarChart = buildBarChart(vm.agentDistribution, "#0066cc");
  const mcpAggHtml = renderMcpAggHtml(vm.mcpUsage);
  const toolMatrixHtml = renderToolMatrixHtml(vm.toolReliabilityMatrix);
  const errorPatternChart = buildBarChart(vm.errorPatterns, "#d32f2f");
  const errorTrendSvg = renderErrorTrendSvg(vm.errorTrendSeries);
  const heatmapSvg = buildHeatmapSvg(vm.heatmapDays);

  return `
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
      <div class="metric-value">${summary.totalSessions.toLocaleString()}</div>
      <div class="metric-sub">main sessions only</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens</div>
      <div class="metric-value">${formatTokens(summary.totalTokens)}</div>
      <div class="metric-sub">assistant messages</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Tool Calls</div>
      <div class="metric-value">${summary.totalToolCalls.toLocaleString()}</div>
      <div class="metric-sub">all sessions</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Tool Error Rate</div>
      <div class="metric-value">${summary.toolErrorRate}</div>
      <div class="metric-sub">${summary.toolErrors.toLocaleString()} errors</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Projects</div>
      <div class="metric-value">${summary.activeProjects.toLocaleString()}</div>
      <div class="metric-sub">distinct project IDs</div>
    </div>
  </div>

  <div class="range-bar">
    ${DASHBOARD_RANGES.map((r) => `<a href="/?range=${r}" class="range-btn${r === range ? " active" : ""}">${r === "all" ? "All" : r === "month" ? "1 Month" : r === "week" ? "1 Week" : "1 Day"}</a>`).join("")}
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

  <div class="card">
    <h2>Error Daily Trend</h2>
    <div style="overflow-x:auto;padding-bottom:4px;">${errorTrendSvg}</div>
  </div>

  <div class="card">
    <h2>Token I/O Trend</h2>
    ${tokenTrendHtml}
  </div>

  <div class="card">
    <h2>Subagent Activity</h2>
    ${subagentTrendHtml}
  </div>

  <div class="card">
    <h2>Active Repositories</h2>
    ${repoBreakdownHtml}
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
      <h2>MCP Tool Usage</h2>
      <div style="display:flex;gap:10px;margin-bottom:10px;font-size:0.7em;color:#86868b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">
        <span style="width:140px;">Server</span>
        <span style="width:55px;text-align:right;">Calls</span>
        <span style="width:45px;text-align:right;">Errors</span>
        <span style="flex:1;">Error Rate</span>
        <span style="width:45px;"></span>
      </div>
      ${mcpAggHtml}
    </div>
  </div>

  <div class="card" id="tool-reliability">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;">
      <h2 style="margin:0;">Tool Reliability</h2>
      <a href="#tool-reliability" style="font-size:0.82em;white-space:nowrap;">View all tool errors &rarr;</a>
    </div>
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
</body>
</html>
  `;
}
