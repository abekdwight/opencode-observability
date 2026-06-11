import type { DashboardSelectionBoundsContract } from "../../contracts/dashboard.js";
import {
  buildLineChartSvg,
  buildStackedBarChartSvg,
  classifyTool,
  computeRatio,
  fillMissingDays,
} from "../../lib/analytics.js";
import {
  buildDashboardSelectionBounds,
  computeDashboardRefreshEligibility,
  parseLocalDate,
  toLocalDateString,
} from "../../lib/dashboard-time.js";
import { resolveRepoBucketKey } from "../../lib/repo-root.js";
import {
  escapeHtml,
  formatDurationShort,
  prettifyPath,
} from "../../lib/text-format.js";
import {
  type DashboardRepositoryWindow,
  fetchDashboardMessageData,
  fetchDashboardPartData,
  fetchDashboardRepoData,
} from "../../repositories/dashboard/dashboard-repository.js";
import type {
  DashboardDayRollup,
  DashboardMcpUsageTotals,
  DashboardModelTokenTotals,
  DashboardProjectionSource,
  DashboardToolReliabilityTotals,
} from "./dashboard-aggregation-types.js";

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
  modelTokenDays: Map<string, number>;
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
  annotation?: string;
}

export interface DashboardModelTokenConsumptionRow {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  nonCacheInputTokens: number;
  inputTotalTokens: number;
  totalTokens: number;
}

export interface DashboardModelPerformanceStatsRow {
  model: string;
  provider: string;
  avgTps: number | null;
  tpsP10: number | null;
  tpsP50: number | null;
  tpsP90: number | null;
  tpsP99: number | null;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  latencyP99Ms: number | null;
  totalMessages: number;
  validTpsMessages: number;
  validLatencyMessages: number;
  validityRatio: number;
  outputTokens: number;
  reasoningTokens: number;
  reasoningShare: number | null;
}

export interface DashboardViewModel {
  range: DashboardRange;
  view: DashboardView;
  selection: DashboardSelectionBoundsContract;
  summary: DashboardSummaryMetrics;
  recentSessions: DashboardRecentSessionItem[];
  heatmapDays: DayCount[];
  errorTrendSeries: DashboardLineSeries[];
  errorTrendHourlyBars: DashboardStackBar[];
  tokenTrend: DashboardTokenTrendData;
  subagentTrend: DashboardSubagentTrendData;
  activeRepos: DashboardRepoBreakdownData;
  modelUsage: DashboardBarItem[];
  modelPerformanceStats: DashboardModelPerformanceStatsRow[];
  modelTokenConsumption: DashboardModelTokenConsumptionRow[];
  toolUsage: DashboardBarItem[];
  agentDistribution: DashboardBarItem[];
  mcpUsage: DashboardMcpUsageRow[];
  toolReliabilityMatrix: DashboardToolReliabilityRow[];
  errorPatterns: DashboardBarItem[];
}

const ERROR_TREND_COLORS = [
  "#d32f2f",
  "#1565c0",
  "#2e7d32",
  "#e65100",
  "#6a1b9a",
  "#86868b",
] as const;

function _buildHeatmapSvg(
  dayCounts: DayCount[],
  selection: DashboardSelectionBoundsContract,
): string {
  const dayMap = new Map<string, number>();
  for (const { day, cnt } of dayCounts) {
    dayMap.set(day, cnt);
  }

  const days: { date: Date; dateStr: string }[] = [];
  for (const day of buildDayRange(
    selection.startDayInclusive,
    selection.endDayInclusive,
  )) {
    const date = parseLocalDate(day);
    if (!date) continue;
    days.push({ date, dateStr: day });
  }

  if (days.length === 0) {
    return '<p style="color:#86868b;font-size:0.9em;">No activity</p>';
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

  const totalCols = Math.ceil((days.length + startDow) / 7);
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

function _buildBarChart(
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

export { addLocalDays, parseLocalDate } from "../../lib/dashboard-time.js";

function buildDayRange(
  startDayInclusive: string,
  endDayInclusive: string,
): string[] {
  const days: string[] = [];
  const start = parseLocalDate(startDayInclusive);
  const end = parseLocalDate(endDayInclusive);
  if (!start || !end || start.getTime() > end.getTime()) return days;

  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

const DASHBOARD_HISTORY_START_DAY = "1970-01-01";

export function getDashboardWindow(
  range: DashboardRange,
): DashboardRepositoryWindow {
  const endExclusive = new Date();
  endExclusive.setHours(0, 0, 0, 0);
  const start = new Date(endExclusive);
  if (range === "week") start.setDate(start.getDate() - 6);
  else if (range === "month") start.setDate(start.getDate() - 29);
  else if (range === "all") start.setTime(Number.NaN);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return {
    startDayInclusive:
      range === "all" ? DASHBOARD_HISTORY_START_DAY : toLocalDateString(start),
    endDayExclusive: toLocalDateString(endExclusive),
  };
}

export function buildBoundedSelection(
  window: DashboardRepositoryWindow,
): DashboardSelectionBoundsContract {
  return buildDashboardSelectionBounds(window);
}

function isDayWithinSelection(
  day: string,
  selection: DashboardSelectionBoundsContract,
): boolean {
  return day >= selection.startDayInclusive && day <= selection.endDayInclusive;
}

export function isDashboardSelectionRefreshable(
  selection: DashboardSelectionBoundsContract,
  now = new Date(),
): boolean {
  return computeDashboardRefreshEligibility(selection.endDayInclusive, now);
}

export function materializeDashboardCacheWindow(
  range: DashboardRange,
): DashboardRepositoryWindow {
  const selection = buildBoundedSelection(getDashboardWindow(range));
  return {
    startDayInclusive: selection.startDayInclusive,
    endDayExclusive: selection.endDayExclusive,
  };
}

export function cloneDashboardAggregateState(
  state: DashboardAggregateState,
): DashboardAggregateState {
  return {
    toolDayBuckets: new Map(state.toolDayBuckets),
    errorPatternDays: new Map(state.errorPatternDays),
    toolErrorDetails: new Map(state.toolErrorDetails),
    mcpServerBuckets: new Map(state.mcpServerBuckets),
    lastPartRowid: state.lastPartRowid,
    modelDays: new Map(state.modelDays),
    modelTokenDays: new Map(state.modelTokenDays),
    agentDays: new Map(state.agentDays),
    tokenDays: new Map(state.tokenDays),
    tokenInputDays: new Map(state.tokenInputDays),
    tokenOutputDays: new Map(state.tokenOutputDays),
    tokenInputHours: new Map(state.tokenInputHours),
    tokenOutputHours: new Map(state.tokenOutputHours),
    subagentDays: new Map(state.subagentDays),
    subagentHours: new Map(state.subagentHours),
    lastMessageRowid: state.lastMessageRowid,
    sessionCount: state.sessionCount,
    repoDays: new Map(state.repoDays),
    lastSessionRowid: state.lastSessionRowid,
  };
}

function mergeCountMaps<K>(maps: Map<K, number>[]): Map<K, number> {
  const merged = new Map<K, number>();
  for (const map of maps) {
    for (const [key, value] of map) {
      merged.set(key, (merged.get(key) || 0) + value);
    }
  }
  return merged;
}

export function mergeDashboardAggregateStates(
  states: DashboardAggregateState[],
): DashboardAggregateState {
  if (states.length === 0) {
    return createEmptyAggregateState();
  }

  return {
    toolDayBuckets: mergeCountMaps(states.map((state) => state.toolDayBuckets)),
    errorPatternDays: mergeCountMaps(
      states.map((state) => state.errorPatternDays),
    ),
    toolErrorDetails: mergeCountMaps(
      states.map((state) => state.toolErrorDetails),
    ),
    mcpServerBuckets: mergeCountMaps(
      states.map((state) => state.mcpServerBuckets),
    ),
    lastPartRowid: Math.max(...states.map((state) => state.lastPartRowid)),
    modelDays: mergeCountMaps(states.map((state) => state.modelDays)),
    modelTokenDays: mergeCountMaps(states.map((state) => state.modelTokenDays)),
    agentDays: mergeCountMaps(states.map((state) => state.agentDays)),
    tokenDays: mergeCountMaps(states.map((state) => state.tokenDays)),
    tokenInputDays: mergeCountMaps(states.map((state) => state.tokenInputDays)),
    tokenOutputDays: mergeCountMaps(
      states.map((state) => state.tokenOutputDays),
    ),
    tokenInputHours: mergeCountMaps(
      states.map((state) => state.tokenInputHours),
    ),
    tokenOutputHours: mergeCountMaps(
      states.map((state) => state.tokenOutputHours),
    ),
    subagentDays: mergeCountMaps(states.map((state) => state.subagentDays)),
    subagentHours: mergeCountMaps(states.map((state) => state.subagentHours)),
    lastMessageRowid: Math.max(
      ...states.map((state) => state.lastMessageRowid),
    ),
    sessionCount: states.reduce((sum, state) => sum + state.sessionCount, 0),
    repoDays: mergeCountMaps(states.map((state) => state.repoDays)),
    lastSessionRowid: Math.max(
      ...states.map((state) => state.lastSessionRowid),
    ),
  };
}

function _filterMap(
  map: Map<string, number>,
  selection: DashboardSelectionBoundsContract,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, cnt] of map) {
    const tab = key.lastIndexOf("\t");
    const day = key.substring(tab + 1);
    if (!isDayWithinSelection(day, selection)) continue;
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
      state.modelTokenDays.set(
        key,
        (state.modelTokenDays.get(key) || 0) + tokens,
      );
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
    modelTokenDays: new Map(),
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

function incrementCount(
  map: Map<string, number>,
  key: string,
  value: number,
): void {
  if (!key || value === 0) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

function aggregateNumberMapFromRollups(
  rollups: DashboardDayRollup[],
  pickMap: (rollup: DashboardDayRollup) => Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const rollup of rollups) {
    for (const [key, value] of pickMap(rollup)) {
      incrementCount(out, key, value);
    }
  }
  return out;
}

function aggregateMcpUsageTotalsFromRollups(
  rollups: DashboardDayRollup[],
): Map<string, DashboardMcpUsageTotals> {
  const out = new Map<string, DashboardMcpUsageTotals>();
  for (const rollup of rollups) {
    for (const [key, value] of rollup.mcpUsage) {
      let entry = out.get(key);
      if (!entry) {
        entry = {
          server: value.server,
          calls: 0,
          errors: 0,
          isBuiltin: value.isBuiltin,
        };
        out.set(key, entry);
      }
      entry.calls += value.calls;
      entry.errors += value.errors;
    }
  }
  return out;
}

function aggregateToolReliabilityTotalsFromRollups(
  rollups: DashboardDayRollup[],
): Map<string, DashboardToolReliabilityTotals> {
  const out = new Map<string, DashboardToolReliabilityTotals>();
  for (const rollup of rollups) {
    for (const [key, value] of rollup.toolReliabilityMatrix) {
      let entry = out.get(key);
      if (!entry) {
        entry = {
          tool: value.tool,
          success: 0,
          error: 0,
          total: 0,
        };
        out.set(key, entry);
      }
      entry.success += value.success;
      entry.error += value.error;
      entry.total += value.total;
    }
  }
  return out;
}

function aggregateModelTokenTotalsFromRollups(
  rollups: DashboardDayRollup[],
): Map<string, DashboardModelTokenTotals> {
  const out = new Map<string, DashboardModelTokenTotals>();
  for (const rollup of rollups) {
    for (const [key, value] of rollup.modelTokenTotals) {
      let entry = out.get(key);
      if (!entry) {
        entry = {
          model: value.model,
          provider: value.provider,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          nonCacheInputTokens: 0,
          inputTotalTokens: 0,
          totalTokens: 0,
        };
        out.set(key, entry);
      }
      entry.inputTokens += value.inputTokens;
      entry.outputTokens += value.outputTokens;
      entry.cacheReadTokens += value.cacheReadTokens;
      entry.cacheWriteTokens += value.cacheWriteTokens;
      entry.nonCacheInputTokens += value.nonCacheInputTokens;
      entry.inputTotalTokens += value.inputTotalTokens;
      entry.totalTokens += value.totalTokens;
    }
  }
  return out;
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

function _renderToolMatrixHtml(rows: DashboardToolReliabilityRow[]): string {
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
  mcpUsageTotals: Map<string, DashboardMcpUsageTotals>,
): DashboardMcpUsageRow[] {
  const mcpServerMap = new Map<string, { calls: number; errors: number }>();
  for (const value of mcpUsageTotals.values()) {
    mcpServerMap.set(value.server, {
      calls: value.calls,
      errors: value.errors,
    });
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

function _renderMcpAggHtml(rows: DashboardMcpUsageRow[]): string {
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
  selectedDayRollups: DashboardDayRollup[],
  selection: DashboardSelectionBoundsContract,
): DashboardLineSeries[] {
  const toolErrorDetails = new Map<string, number>();
  for (const rollup of selectedDayRollups) {
    for (const [tool, count] of rollup.toolErrorsByToolDay) {
      incrementCount(toolErrorDetails, `${tool}\t${rollup.day}`, count);
    }
  }

  const toolErrorTotals = new Map<string, number>();
  for (const [key, cnt] of toolErrorDetails) {
    const [tool, day] = key.split("\t");
    if (!isDayWithinSelection(day, selection)) continue;
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
    if (!isDayWithinSelection(day, selection)) continue;
    const seriesKey = topErrorToolSet.has(tool) ? tool : "Other";
    const m = errorTrendSeriesMap.get(seriesKey);
    if (!m) continue;
    m.set(day, (m.get(day) || 0) + cnt);
  }

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
      color: ERROR_TREND_COLORS[i] ?? "#86868b",
      points: toDashboardDayValues(
        fillMissingDays(
          item.data,
          selection.startDayInclusive,
          selection.endDayInclusive,
        ),
      ),
    }));
}

function buildHourlyErrorBars(
  selectedDayRollups: DashboardDayRollup[],
): DashboardStackBar[] {
  const hourTotals = new Array(24).fill(0);
  for (const rollup of selectedDayRollups) {
    for (const [hour, count] of rollup.toolErrorsByHour) {
      const hourIndex = Number(hour);
      if (!Number.isInteger(hourIndex) || hourIndex < 0 || hourIndex > 23) {
        continue;
      }
      hourTotals[hourIndex] += count;
    }
  }

  if (!hourTotals.some((value) => value > 0)) {
    return [];
  }

  return Array.from({ length: 24 }, (_, hour) => ({
    label: String(hour).padStart(2, "0"),
    stacks:
      hourTotals[hour] > 0
        ? [
            {
              name: "Errors",
              value: hourTotals[hour],
              color: ERROR_TREND_COLORS[0],
            },
          ]
        : [],
  }));
}

const TPS_AVG_MIN_SAMPLES = 5;
const TPS_P50_MIN_SAMPLES = 20;

function interpolateQuantile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0] ?? 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  if (lower === upper) return lowerValue;
  const weight = index - lower;
  return lowerValue * (1 - weight) + upperValue * weight;
}

function quantileOrNull(
  values: number[],
  quantile: number,
  minSamples: number,
): number | null {
  if (values.length < minSamples) return null;
  return Number(interpolateQuantile(values, quantile).toFixed(2));
}

function buildModelPerformanceStatsRows(
  selectedSessionAtoms: DashboardProjectionSource["modelPerformanceStats"]["selectedSessionAtoms"],
): DashboardModelPerformanceStatsRow[] {
  interface Bucket {
    model: string;
    provider: string;
    totalMessages: number;
    validTpsMessages: number;
    validLatencyMessages: number;
    outputTokens: number;
    reasoningTokens: number;
    sumTpsOutputTokens: number;
    sumTpsDurationMs: number;
    tpsValues: number[];
    latencyValuesMs: number[];
  }

  const buckets = new Map<string, Bucket>();

  for (const atom of selectedSessionAtoms) {
    for (const [key, sample] of atom.modelPerformanceSamples) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          model: sample.model,
          provider: sample.provider,
          totalMessages: 0,
          validTpsMessages: 0,
          validLatencyMessages: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          sumTpsOutputTokens: 0,
          sumTpsDurationMs: 0,
          tpsValues: [],
          latencyValuesMs: [],
        };
        buckets.set(key, bucket);
      }

      bucket.totalMessages += sample.totalMessages;
      bucket.validTpsMessages += sample.validTpsMessages;
      bucket.validLatencyMessages += sample.validLatencyMessages;
      bucket.outputTokens += sample.outputTokens;
      bucket.reasoningTokens += sample.reasoningTokens;
      bucket.sumTpsOutputTokens += sample.sumOutputTokens;
      bucket.sumTpsDurationMs += sample.sumDurationMs;
      bucket.tpsValues.push(...sample.tpsSamples);
      bucket.latencyValuesMs.push(...sample.latencySamplesMs);
    }
  }

  return Array.from(buckets.values())
    .map((bucket) => {
      const avgTps =
        bucket.validTpsMessages >= TPS_AVG_MIN_SAMPLES &&
        bucket.sumTpsDurationMs > 0
          ? Number(
              (
                (bucket.sumTpsOutputTokens * 1000) /
                bucket.sumTpsDurationMs
              ).toFixed(2),
            )
          : null;

      const validityRatio =
        bucket.totalMessages > 0
          ? Number((bucket.validTpsMessages / bucket.totalMessages).toFixed(4))
          : 0;

      const reasoningShare =
        bucket.outputTokens > 0
          ? Number((bucket.reasoningTokens / bucket.outputTokens).toFixed(4))
          : null;

      return {
        model: bucket.model,
        provider: bucket.provider,
        avgTps,
        tpsP10: null,
        tpsP50: quantileOrNull(bucket.tpsValues, 0.5, TPS_P50_MIN_SAMPLES),
        tpsP90: null,
        tpsP99: null,
        latencyP50Ms: null,
        latencyP90Ms: null,
        latencyP99Ms: null,
        totalMessages: bucket.totalMessages,
        validTpsMessages: bucket.validTpsMessages,
        validLatencyMessages: bucket.validLatencyMessages,
        validityRatio,
        outputTokens: bucket.outputTokens,
        reasoningTokens: bucket.reasoningTokens,
        reasoningShare,
      };
    })
    .filter((row) => row.validTpsMessages > 0)
    .sort((a, b) => {
      const hasPrimaryA = a.tpsP50 != null ? 1 : 0;
      const hasPrimaryB = b.tpsP50 != null ? 1 : 0;
      if (hasPrimaryA !== hasPrimaryB) return hasPrimaryB - hasPrimaryA;

      const scoreA = a.tpsP50 ?? a.avgTps ?? -1;
      const scoreB = b.tpsP50 ?? b.avgTps ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;

      if (a.validityRatio !== b.validityRatio) {
        return b.validityRatio - a.validityRatio;
      }

      if (a.validTpsMessages !== b.validTpsMessages) {
        return b.validTpsMessages - a.validTpsMessages;
      }
      return a.model.localeCompare(b.model);
    });
}

function buildModelTokenConsumptionRows(
  selectedDayRollups: DashboardProjectionSource["modelTokenConsumption"]["selectedDayRollups"],
): DashboardModelTokenConsumptionRow[] {
  return Array.from(
    aggregateModelTokenTotalsFromRollups(selectedDayRollups).values(),
  )
    .map((value) => {
      const inputTokens = value.inputTokens;
      const outputTokens = value.outputTokens;
      const cacheReadTokens = value.cacheReadTokens;
      const cacheWriteTokens = value.cacheWriteTokens;
      const inputTotalTokens = value.inputTotalTokens;
      const totalTokens = Math.max(
        value.totalTokens,
        inputTotalTokens + outputTokens,
      );
      return {
        model: value.model || "(unknown)",
        provider: value.provider || "unknown",
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        nonCacheInputTokens: value.nonCacheInputTokens,
        inputTotalTokens,
        totalTokens,
      };
    })
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 12);
}

function buildRecentYearHeatmapDays(
  trailingDayRollups: DashboardProjectionSource["heatmapDays"]["trailingDayRollups"],
): DayCount[] {
  return trailingDayRollups
    .filter((rollup) => rollup.rootSessionCount > 0)
    .map((rollup) => ({ day: rollup.day, cnt: rollup.rootSessionCount }));
}

function _renderErrorTrendSvg(errorTrendSeries: DashboardLineSeries[]): string {
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
  selection: DashboardSelectionBoundsContract,
  view: DashboardView,
): DashboardTokenTrendData {
  const totalInput = [...tokenInputDays.entries()]
    .filter(([day]) => isDayWithinSelection(day, selection))
    .reduce((sum, [, value]) => sum + value, 0);
  const totalOutput = [...tokenOutputDays.entries()]
    .filter(([day]) => isDayWithinSelection(day, selection))
    .reduce((sum, [, value]) => sum + value, 0);
  const inputRatioPercent =
    computeRatio(totalInput, totalInput + totalOutput) * 100;

  if (view === "hourly") {
    const hourInputTotals = new Array(24).fill(0);
    const hourOutputTotals = new Array(24).fill(0);

    for (const [key, value] of tokenInputHours) {
      const [day, hour] = key.split("\t");
      if (!isDayWithinSelection(day, selection)) continue;
      hourInputTotals[Number(hour)] += value;
    }

    for (const [key, value] of tokenOutputHours) {
      const [day, hour] = key.split("\t");
      if (!isDayWithinSelection(day, selection)) continue;
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

  const inputDayMap = new Map<string, number>();
  for (const [day, value] of tokenInputDays) {
    if (!isDayWithinSelection(day, selection)) continue;
    inputDayMap.set(day, value);
  }

  const outputDayMap = new Map<string, number>();
  for (const [day, value] of tokenOutputDays) {
    if (!isDayWithinSelection(day, selection)) continue;
    outputDayMap.set(day, value);
  }

  const dailySeries: DashboardLineSeries[] = [
    {
      label: "Input",
      color: "#1565c0",
      points: toDashboardDayValues(
        fillMissingDays(
          inputDayMap,
          selection.startDayInclusive,
          selection.endDayInclusive,
        ),
      ),
    },
    {
      label: "Output",
      color: "#2e7d32",
      points: toDashboardDayValues(
        fillMissingDays(
          outputDayMap,
          selection.startDayInclusive,
          selection.endDayInclusive,
        ),
      ),
    },
  ];

  return {
    inputRatioPercent,
    dailySeries,
    hourlyBars: [],
  };
}

function _renderTokenTrendHtml(
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
  selection: DashboardSelectionBoundsContract,
  view: DashboardView,
): DashboardSubagentTrendData {
  const subagentTotals = new Map<string, number>();
  for (const [key, cnt] of subagentDays) {
    const [agent, day] = key.split("\t");
    if (!isDayWithinSelection(day, selection)) continue;
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
      if (!isDayWithinSelection(day, selection)) continue;
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
    if (!isDayWithinSelection(day, selection)) continue;
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
        fillMissingDays(
          item.data,
          selection.startDayInclusive,
          selection.endDayInclusive,
        ),
      ),
    }));

  return {
    dailySeries,
    hourlyBars: [],
  };
}

function _renderSubagentTrendHtml(
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
  selectedDayRollups: DashboardProjectionSource["activeRepos"]["selectedDayRollups"],
  selection: DashboardSelectionBoundsContract,
): DashboardRepoBreakdownData {
  const repoSessionCounts = new Map<string, number>();
  const repoDaySessionCountMap = new Map<string, number>();
  const repoDayDurationMap = new Map<string, number>();
  for (const rollup of selectedDayRollups) {
    for (const [repo, cnt] of rollup.repoSessionCountByDay) {
      repoSessionCounts.set(repo, (repoSessionCounts.get(repo) || 0) + cnt);
      repoDaySessionCountMap.set(
        `${repo}\t${rollup.day}`,
        (repoDaySessionCountMap.get(`${repo}\t${rollup.day}`) || 0) + cnt,
      );
    }
    for (const [repo, durationMs] of rollup.repoActiveDurationMsByDay) {
      repoDayDurationMap.set(
        `${repo}\t${rollup.day}`,
        (repoDayDurationMap.get(`${repo}\t${rollup.day}`) || 0) + durationMs,
      );
    }
  }

  const activeRepos = Array.from(repoSessionCounts.entries())
    .filter(([repo]) => repo !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([repo]) => repo);

  const selectedDays = buildDayRange(
    selection.startDayInclusive,
    selection.endDayInclusive,
  );

  if (activeRepos.length === 0) {
    return {
      dayHeaders: selectedDays,
      rows: [],
    };
  }

  const rows: DashboardRepoRow[] = activeRepos.map((repo) => {
    let totalActiveMs = 0;
    const dayCells: DashboardRepoDayCell[] = selectedDays.map((day) => {
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
    dayHeaders: selectedDays,
    rows,
  };
}

function _renderRepoBreakdownHtml(
  repoData: DashboardRepoBreakdownData,
): string {
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
  source: DashboardProjectionSource,
  view: DashboardView,
  selection: DashboardSelectionBoundsContract,
  range: DashboardRange,
): DashboardViewModel {
  const selectedDayRollups = source.summary.selectedDayRollups;
  const selectedSessionAtoms = source.summary.selectedSessionAtoms;
  const toolCounts = aggregateNumberMapFromRollups(
    source.toolUsage.selectedDayRollups,
    (rollup) => rollup.toolUsage,
  );
  const toolReliabilityTotals = aggregateToolReliabilityTotalsFromRollups(
    source.toolReliabilityMatrix.selectedDayRollups,
  );
  const toolSuccessErrorMap = new Map<string, ToolSuccessError>();
  for (const [tool, totals] of toolReliabilityTotals) {
    toolSuccessErrorMap.set(tool, {
      success: totals.success,
      error: totals.error,
    });
  }

  const toolRows: ToolCount[] = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, cnt]) => ({ tool, cnt }));

  const errorPatterns = aggregateNumberMapFromRollups(
    source.errorPatterns.selectedDayRollups,
    (rollup) => rollup.errorPatterns,
  );
  const modelCounts = aggregateNumberMapFromRollups(
    source.modelUsage.selectedDayRollups,
    (rollup) => rollup.modelCountByDay,
  );
  const agentCounts = aggregateNumberMapFromRollups(
    source.agentDistribution.selectedDayRollups,
    (rollup) => rollup.agentDistribution,
  );
  const totalTokens = selectedDayRollups.reduce(
    (sum, rollup) => sum + rollup.tokenTotals.total,
    0,
  );
  const totalToolCalls = selectedDayRollups.reduce(
    (sum, rollup) => sum + rollup.toolStatus.calls,
    0,
  );
  const toolErrors = selectedDayRollups.reduce(
    (sum, rollup) => sum + rollup.toolStatus.errors,
    0,
  );

  const modelRows: ModelCount[] = Array.from(modelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([model, cnt]) => ({ model, cnt }));
  const modelTokenConsumption = buildModelTokenConsumptionRows(
    source.modelTokenConsumption.selectedDayRollups,
  );
  const agentRows: AgentCount[] = Array.from(agentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([agent, cnt]) => ({ agent, cnt }));

  const toolErrorRate =
    totalToolCalls > 0
      ? `${((toolErrors / totalToolCalls) * 100).toFixed(1)}%`
      : "0.0%";

  const recentSessions = selectedSessionAtoms
    .map((atom) => atom.recentMeta)
    .sort((a, b) => b.timeUpdated - a.timeUpdated)
    .slice(0, 5)
    .map((session) => ({
      id: session.id,
      title: session.title,
      directory: session.directory,
      time_created: 0,
      time_updated: session.timeUpdated,
      total_tokens: session.totalTokens,
    }));

  const tokenInputDays = new Map(
    selectedDayRollups.map(
      (rollup) => [rollup.day, rollup.tokenInputByDay] as const,
    ),
  );
  const tokenOutputDays = new Map(
    selectedDayRollups.map(
      (rollup) => [rollup.day, rollup.tokenOutputByDay] as const,
    ),
  );
  const tokenInputHours = new Map<string, number>();
  const tokenOutputHours = new Map<string, number>();
  const subagentDays = new Map<string, number>();
  const subagentHours = new Map<string, number>();

  for (const rollup of selectedDayRollups) {
    for (const [hour, count] of rollup.tokenInputByHour) {
      tokenInputHours.set(`${rollup.day}\t${hour}`, count);
    }
    for (const [hour, count] of rollup.tokenOutputByHour) {
      tokenOutputHours.set(`${rollup.day}\t${hour}`, count);
    }
    for (const [agent, count] of rollup.subagentByDay) {
      subagentDays.set(`${agent}\t${rollup.day}`, count);
    }
    for (const [agentHour, count] of rollup.subagentByHour) {
      const [agent, hour] = agentHour.split("\t");
      subagentHours.set(`${agent}\t${rollup.day}\t${hour}`, count);
    }
  }

  const errorTrendSeries = buildErrorTrendData(
    source.errorTrend.selectedDayRollups,
    selection,
  );
  const errorTrendHourlyBars =
    view === "hourly"
      ? buildHourlyErrorBars(source.errorTrend.selectedDayRollups)
      : [];

  return {
    range,
    view,
    selection,
    summary: {
      totalSessions: selectedDayRollups.reduce(
        (sum, rollup) => sum + rollup.rootSessionCount,
        0,
      ),
      totalTokens,
      totalToolCalls,
      toolErrors,
      toolErrorRate,
      activeProjects: source.summary.projectIds.size,
    },
    recentSessions: buildRecentSessionsData(recentSessions),
    heatmapDays: buildRecentYearHeatmapDays(
      source.heatmapDays.trailingDayRollups,
    ),
    errorTrendSeries: view === "hourly" ? [] : errorTrendSeries,
    errorTrendHourlyBars,
    tokenTrend: buildTokenTrendData(
      tokenInputDays,
      tokenOutputDays,
      tokenInputHours,
      tokenOutputHours,
      selection,
      view,
    ),
    subagentTrend: buildSubagentTrendData(
      subagentDays,
      subagentHours,
      selection,
      view,
    ),
    activeRepos: buildRepoBreakdownData(
      source.activeRepos.selectedDayRollups,
      selection,
    ),
    modelUsage: modelRows.map((row) => ({
      label: row.model ?? "(unknown)",
      count: row.cnt,
    })),
    modelPerformanceStats: buildModelPerformanceStatsRows(
      source.modelPerformanceStats.selectedSessionAtoms,
    ),
    modelTokenConsumption,
    toolUsage: toolRows.map((row) => ({
      label: row.tool ?? "(unknown)",
      count: row.cnt,
    })),
    agentDistribution: agentRows.map((row) => ({
      label: row.agent ?? "(unknown)",
      count: row.cnt,
    })),
    mcpUsage: buildMcpUsageData(
      aggregateMcpUsageTotalsFromRollups(source.mcpUsage.selectedDayRollups),
    ),
    toolReliabilityMatrix: buildToolReliabilityMatrixData(toolSuccessErrorMap),
    errorPatterns: Array.from(errorPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
  };
}

function buildDashboardAggregateStateForWindow(
  db: SqliteDatabase,
  window: DashboardRepositoryWindow,
): DashboardAggregateState {
  const state = createEmptyAggregateState();
  applyPartData(state, fetchDashboardPartData(db, window));
  applyMessageData(state, fetchDashboardMessageData(db, window));
  applyRepoData(state, fetchDashboardRepoData(db, window));
  return state;
}

function _buildDashboardAggregateState(
  db: SqliteDatabase,
  range: DashboardRange,
): DashboardAggregateState {
  return buildDashboardAggregateStateForWindow(
    db,
    materializeDashboardCacheWindow(range),
  );
}

function updateDashboardAggregateStateForWindow(
  db: SqliteDatabase,
  state: DashboardAggregateState,
  window: DashboardRepositoryWindow,
): DashboardAggregateState {
  const repoData = fetchDashboardRepoData(db, window, state.lastSessionRowid);
  if (repoData.sessionCount < state.sessionCount) {
    return buildDashboardAggregateStateForWindow(db, window);
  }

  let changed = false;
  state.sessionCount = repoData.sessionCount;
  if (repoData.currentRowId > state.lastSessionRowid) {
    applyRepoData(state, repoData);
    changed = true;
  }

  const partData = fetchDashboardPartData(db, window, state.lastPartRowid);
  if (partData.currentRowId > state.lastPartRowid) {
    applyPartData(state, partData);
    changed = true;
  }

  const messageData = fetchDashboardMessageData(
    db,
    window,
    state.lastMessageRowid,
  );
  if (messageData.currentRowId > state.lastMessageRowid) {
    applyMessageData(state, messageData);
    changed = true;
  }

  if (changed) {
    return cloneDashboardAggregateState(state);
  }
  return state;
}

function _updateDashboardAggregateState(
  db: SqliteDatabase,
  state: DashboardAggregateState,
  range: DashboardRange,
): DashboardAggregateState {
  return updateDashboardAggregateStateForWindow(
    db,
    state,
    materializeDashboardCacheWindow(range),
  );
}

export function buildDashboardViewModelForWindow(
  source: DashboardProjectionSource,
  window: DashboardRepositoryWindow,
  range: DashboardRange,
  view: DashboardView,
): DashboardViewModel {
  const selection = buildBoundedSelection(window);
  return buildDashboardData(source, view, selection, range);
}

export function buildDashboardViewModel(
  source: DashboardProjectionSource,
  range: DashboardRange,
  view: DashboardView,
): DashboardViewModel {
  return buildDashboardViewModelForWindow(
    source,
    materializeDashboardCacheWindow(range),
    range,
    view,
  );
}
