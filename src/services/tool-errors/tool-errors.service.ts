import { fillMissingDays } from "../../lib/analytics.js";
import { getDb } from "../../lib/db.js";

interface ErrorDayRow {
  day: string;
  cnt: number;
}

interface ErrorRow {
  time_created: number;
  session_id: string;
  error: string | null;
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

export function buildToolErrorsView(rawTool: string): ToolErrorsView {
  const db = getDb();
  try {
    const toolName = decodeToolName(rawTool);

    const dayRows = db
      .prepare(`
      SELECT date(p.time_created/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.tool') = ?
        AND json_extract(p.data, '$.state.status') = 'error'
      GROUP BY day ORDER BY day
    `)
      .all(toolName) as ErrorDayRow[];

    const endDayDate = new Date();
    endDayDate.setHours(0, 0, 0, 0);
    const startDayDate = new Date(endDayDate);
    startDayDate.setDate(startDayDate.getDate() - 29);

    const dayMap = new Map<string, number>();
    for (const row of dayRows) {
      dayMap.set(row.day, Number(row.cnt) || 0);
    }

    const timelineData = fillMissingDays(
      dayMap,
      formatLocalIsoDay(startDayDate),
      formatLocalIsoDay(endDayDate),
    );

    const errors = db
      .prepare(`
      SELECT p.time_created, p.session_id,
             json_extract(p.data, '$.state.error') AS error
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.tool') = ?
        AND json_extract(p.data, '$.state.status') = 'error'
      ORDER BY p.time_created DESC LIMIT 200
    `)
      .all(toolName) as ErrorRow[];

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
