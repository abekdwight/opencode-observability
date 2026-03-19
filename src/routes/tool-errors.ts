import type { Request, Response } from 'express';
import { fillMissingDays, buildLineChartSvg } from '../lib/analytics.js';
import { getDb } from '../lib/db.js';
import { PAGE_SHELL_END, PAGE_SHELL_START, escapeHtml } from '../lib/html.js';

interface ErrorDayRow {
  day: string;
  cnt: number;
}

interface ErrorRow {
  time_created: number;
  session_id: string;
  error: string | null;
}

function formatLocalIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
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

export function toolErrorsRoute(req: Request, res: Response) {
  const db = getDb();
  try {
    const rawTool = req.params.tool;
    const toolName = decodeToolName(rawTool);
    const safeToolName = escapeHtml(toolName);

    const dayRows = db.prepare(`
      SELECT date(p.time_created/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.tool') = ?
        AND json_extract(p.data, '$.state.status') = 'error'
      GROUP BY day ORDER BY day
    `).all(toolName) as ErrorDayRow[];

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

    const timelineSvg = buildLineChartSvg(
      [
        {
          label: `${toolName} errors`,
          color: '#d32f2f',
          data: timelineData,
        },
      ],
      { width: 920, height: 280 },
    );

    const errors = db.prepare(`
      SELECT p.time_created, p.session_id,
             json_extract(p.data, '$.state.error') AS error
      FROM part p
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.tool') = ?
        AND json_extract(p.data, '$.state.status') = 'error'
      ORDER BY p.time_created DESC LIMIT 200
    `).all(toolName) as ErrorRow[];

    const tableRows = errors.map((row) => {
      const dateText = new Date(Number(row.time_created)).toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const rawError = typeof row.error === 'string'
        ? row.error
        : row.error == null
          ? ''
          : String(row.error);
      const truncatedError = truncateErrorMessage(rawError, 300);
      const errorCell = truncatedError.length > 0 ? escapeHtml(truncatedError) : '(no message)';
      const sessionHref = `/session/${encodeURIComponent(row.session_id)}`;

      return `<tr>
  <td class="col-date">${escapeHtml(dateText)}</td>
  <td class="col-session"><a href="${sessionHref}">${escapeHtml(row.session_id)}</a></td>
  <td class="col-error">${errorCell}</td>
</tr>`;
    }).join('\n');

    const hasErrors = errors.length > 0;

    res.send(`
${PAGE_SHELL_START(`${safeToolName} - Tool Errors`)}
    h1 { font-size: 1.35em; font-weight: 700; margin: 0 0 6px 0; }
    h2 { font-size: 1em; font-weight: 700; margin: 0 0 12px 0; }
    .subtle { color: #86868b; font-size: 0.85em; margin: 0 0 14px 0; }
    .chart-wrap { overflow-x: auto; padding-bottom: 4px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #ececf0; text-align: left; vertical-align: top; font-size: 0.9em; }
    th { color: #86868b; font-size: 0.76em; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
    .col-date { width: 190px; white-space: nowrap; color: #3a3a3c; }
    .col-session { width: 220px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.84em; }
    .col-error { white-space: pre-wrap; word-break: break-word; }
    .empty { color: #86868b; font-size: 0.92em; margin: 2px 0 0 0; }
  </style>
</head>
<body>
  <div class="breadcrumb"><a href="/">&larr; Dashboard</a></div>

  <div class="card">
    <h1>Tool Errors: ${safeToolName}</h1>
    <p class="subtle">Error timeline for the past 30 days</p>
    <div class="chart-wrap">${timelineSvg}</div>
  </div>

  <div class="card">
    <h2>Latest 200 Errors</h2>
    ${hasErrors ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Datetime</th>
              <th>Session</th>
              <th>Error Message</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    ` : '<p class="empty">No errors recorded for this tool</p>'}
  </div>
${PAGE_SHELL_END}
    `);
  } finally {
    db.close();
  }
}
