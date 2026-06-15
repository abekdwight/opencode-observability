import { fillMissingDays } from "../../lib/analytics.js";
import { getDb } from "../../lib/db.js";

interface ErrorDayRow {
  day: string;
  cnt: number;
}

interface ErrorRow {
  time_created: number;
  session_id: string;
  tool: string | null;
  error: string | null;
}

interface ToolCountRow {
  tool: string | null;
  cnt: number;
}

interface SummaryRow {
  total_errors: number;
  distinct_tools: number;
  affected_sessions: number;
}

export interface ToolErrorRecord {
  time_created: number;
  session_id: string;
  error: string;
}

export interface ToolErrorsView {
  toolName: string;
  timelineData: Map<string, number>;
  errors: ToolErrorRecord[];
}

export interface ToolErrorsOverviewTool {
  tool: string;
  errorCount: number;
  totalCalls: number;
  errorRate: number;
}

export interface ToolErrorsOverviewPattern {
  label: string;
  count: number;
}

export interface ToolErrorsOverviewView {
  windowDays: number;
  totalErrors: number;
  distinctTools: number;
  affectedSessions: number;
  insights: string[];
  topTools: ToolErrorsOverviewTool[];
  errorPatterns: ToolErrorsOverviewPattern[];
  latestErrors: Array<ToolErrorRecord & { tool: string }>;
}

const TOOL_ERROR_WINDOW_DAYS = 30;

function formatLocalIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function decodeToolName(rawTool: string): string {
  try {
    return decodeURIComponent(rawTool);
  } catch {
    return rawTool;
  }
}

function truncateErrorMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength)}...`;
}

function normalizeErrorMessage(error: unknown): string {
  const rawError =
    typeof error === "string" ? error : error == null ? "" : String(error);
  return truncateErrorMessage(rawError, 300);
}

function classifyError(error: string): string {
  if (!error) return "Unknown";
  if (/ENOENT|File not found|no such file|EISDIR/i.test(error)) {
    return "File not found";
  }
  if (/Tool execution aborted/i.test(error)) return "Aborted";
  if (/timed? ?out|deadline exceeded/i.test(error)) return "Timeout";
  if (
    /fetch failed|HTTP [45]\d\d|status [45]\d\d|ECONNREFUSED|ENOTFOUND|network/i.test(
      error,
    )
  ) {
    return "Network/HTTP error";
  }
  if (/patch|hunk|conflict/i.test(error)) return "Patch failed";
  if (/permission denied|EACCES/i.test(error)) return "Permission denied";
  if (/not found|not available|no such/i.test(error)) return "Not found";
  if (/syntax|parse|unexpected token/i.test(error)) return "Parse error";
  return "Other";
}

function buildWindowDays(): {
  startDayDate: Date;
  endDayDate: Date;
  startDayInclusive: string;
  endDayExclusive: string;
} {
  const endDayDate = new Date();
  endDayDate.setHours(0, 0, 0, 0);
  const startDayDate = new Date(endDayDate);
  startDayDate.setDate(startDayDate.getDate() - (TOOL_ERROR_WINDOW_DAYS - 1));

  const endDayExclusive = new Date(endDayDate);
  endDayExclusive.setDate(endDayExclusive.getDate() + 1);

  return {
    startDayDate,
    endDayDate,
    startDayInclusive: formatLocalIsoDay(startDayDate),
    endDayExclusive: formatLocalIsoDay(endDayExclusive),
  };
}

export function buildToolErrorsOverviewView(): ToolErrorsOverviewView {
  const db = getDb();
  try {
    const windowDays = buildWindowDays();

    const summary = db
      .prepare(
        `
      SELECT COUNT(*) AS total_errors,
             COUNT(DISTINCT json_extract(p.data, '$.tool')) AS distinct_tools,
             COUNT(DISTINCT p.session_id) AS affected_sessions
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.state.status') = 'error'
        AND json_extract(p.data, '$.tool') != 'question'
        AND date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
        AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
    `,
      )
      .get(windowDays.startDayInclusive, windowDays.endDayExclusive) as
      | SummaryRow
      | undefined;

    const topErrorRows = db
      .prepare(
        `
      SELECT json_extract(p.data, '$.tool') AS tool,
             COUNT(*) AS cnt
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.state.status') = 'error'
        AND json_extract(p.data, '$.tool') != 'question'
        AND date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
        AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
      GROUP BY tool
      ORDER BY cnt DESC
      LIMIT 20
    `,
      )
      .all(
        windowDays.startDayInclusive,
        windowDays.endDayExclusive,
      ) as ToolCountRow[];

    const totalCallRows = db
      .prepare(
        `
      SELECT json_extract(p.data, '$.tool') AS tool,
             COUNT(*) AS cnt
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.tool') != 'question'
        AND date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
        AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
      GROUP BY tool
    `,
      )
      .all(
        windowDays.startDayInclusive,
        windowDays.endDayExclusive,
      ) as ToolCountRow[];
    const totalCallMap = new Map(
      totalCallRows.map((row) => [
        row.tool ?? "(unknown)",
        Number(row.cnt) || 0,
      ]),
    );

    const topTools = topErrorRows.map((row) => {
      const tool = row.tool ?? "(unknown)";
      const errorCount = Number(row.cnt) || 0;
      const totalCalls = totalCallMap.get(tool) ?? 0;
      return {
        tool,
        errorCount,
        totalCalls,
        errorRate: totalCalls > 0 ? (errorCount / totalCalls) * 100 : 0,
      };
    });

    const latestErrorsRaw = db
      .prepare(
        `
      SELECT p.time_created,
             p.session_id,
             json_extract(p.data, '$.tool') AS tool,
             json_extract(p.data, '$.state.error') AS error
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.state.status') = 'error'
        AND json_extract(p.data, '$.tool') != 'question'
        AND date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
        AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
      ORDER BY p.time_created DESC
      LIMIT 200
    `,
      )
      .all(
        windowDays.startDayInclusive,
        windowDays.endDayExclusive,
      ) as ErrorRow[];

    const latestErrors = latestErrorsRaw.map((row) => ({
      time_created: row.time_created,
      session_id: row.session_id,
      tool: row.tool ?? "(unknown)",
      error: normalizeErrorMessage(row.error),
    }));

    const patternMap = new Map<string, number>();
    for (const row of latestErrors) {
      const pattern = classifyError(row.error);
      patternMap.set(pattern, (patternMap.get(pattern) || 0) + 1);
    }
    const errorPatterns = Array.from(patternMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const totalErrors = Number(summary?.total_errors) || 0;
    const distinctTools = Number(summary?.distinct_tools) || 0;
    const affectedSessions = Number(summary?.affected_sessions) || 0;
    const topTool = topTools[0];
    const topPattern = errorPatterns[0];
    const insights = [
      topTool
        ? `Top failing tool: ${topTool.tool} (${topTool.errorCount.toLocaleString()} errors, ${topTool.errorRate.toFixed(1)}% error rate)`
        : "No tool errors recorded in the selected window.",
      topPattern
        ? `Most frequent pattern: ${topPattern.label} (${topPattern.count.toLocaleString()} occurrences)`
        : "No recurring error pattern detected.",
      `${affectedSessions.toLocaleString()} sessions were impacted across ${distinctTools.toLocaleString()} tools in the last ${TOOL_ERROR_WINDOW_DAYS} days.`,
    ];

    return {
      windowDays: TOOL_ERROR_WINDOW_DAYS,
      totalErrors,
      distinctTools,
      affectedSessions,
      insights,
      topTools,
      errorPatterns,
      latestErrors,
    };
  } finally {
    db.close();
  }
}

export function buildToolErrorsView(rawTool: string): ToolErrorsView {
  const db = getDb();
  try {
    const toolName = decodeToolName(rawTool);
    const isUnknownTool = toolName === "(unknown)";
    const toolFilterSql = isUnknownTool
      ? "(json_extract(p.data, '$.tool') IS NULL OR json_extract(p.data, '$.tool') = '')"
      : "json_extract(p.data, '$.tool') = ?";
    const toolFilterParams: unknown[] = isUnknownTool ? [] : [toolName];
    const windowDays = buildWindowDays();

    const dayRows = db
      .prepare(`
      SELECT date(p.time_created/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND ${toolFilterSql}
        AND json_extract(p.data, '$.state.status') = 'error'
        AND json_extract(p.data, '$.tool') != 'question'
        AND date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
        AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
      GROUP BY day ORDER BY day
    `)
      .all(
        ...toolFilterParams,
        windowDays.startDayInclusive,
        windowDays.endDayExclusive,
      ) as ErrorDayRow[];

    const dayMap = new Map<string, number>();
    for (const row of dayRows) {
      dayMap.set(row.day, Number(row.cnt) || 0);
    }

    const timelineData = fillMissingDays(
      dayMap,
      windowDays.startDayInclusive,
      formatLocalIsoDay(windowDays.endDayDate),
    );

    const errors = db
      .prepare(`
      SELECT p.time_created, p.session_id,
             json_extract(p.data, '$.state.error') AS error
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND ${toolFilterSql}
        AND json_extract(p.data, '$.state.status') = 'error'
        AND json_extract(p.data, '$.tool') != 'question'
        AND date(p.time_created/1000, 'unixepoch', 'localtime') >= ?
        AND date(p.time_created/1000, 'unixepoch', 'localtime') < ?
      ORDER BY p.time_created DESC LIMIT 200
    `)
      .all(
        ...toolFilterParams,
        windowDays.startDayInclusive,
        windowDays.endDayExclusive,
      ) as ErrorRow[];

    return {
      toolName,
      timelineData,
      errors: errors.map((row) => ({
        time_created: row.time_created,
        session_id: row.session_id,
        error: normalizeErrorMessage(row.error),
      })),
    };
  } finally {
    db.close();
  }
}
