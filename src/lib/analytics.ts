import { extractMcpServerName, isBuiltinTool } from "./constants.js";
import { escapeHtml } from "./text-format.js";

type ToolClassification = {
  type: "builtin" | "external";
  mcpServer: string | null;
};

function sanitizeChartSize(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

function formatDayTickLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${match[2]}/${match[3]}`;
}

function parseIsoDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(date)
  )
    return null;
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;

  const out = new Date(Date.UTC(year, month - 1, date));
  if (Number.isNaN(out.getTime())) return null;
  if (
    out.getUTCFullYear() !== year ||
    out.getUTCMonth() !== month - 1 ||
    out.getUTCDate() !== date
  )
    return null;
  return out;
}

function formatIsoDay(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptySvg(width: number, height: number, message: string): string {
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
  <rect x="0" y="0" width="${width}" height="${height}" fill="none" />
  <text x="${(width / 2).toFixed(2)}" y="${(height / 2).toFixed(2)}" text-anchor="middle" font-size="12" fill="#86868b" font-family="system-ui,sans-serif">${escapeHtml(message)}</text>
</svg>`;
}

export function classifyTool(toolName: string): ToolClassification {
  if (isBuiltinTool(toolName)) {
    return {
      type: "builtin",
      mcpServer: null,
    };
  }

  return {
    type: "external",
    mcpServer: extractMcpServerName(toolName),
  };
}

export function bucketByDay(
  entries: { day: string; value: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const { day, value } of entries) {
    out.set(day, (out.get(day) ?? 0) + value);
  }
  return out;
}

export function bucketByHour(
  entries: { hour: number; value: number }[],
): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const { hour, value } of entries) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    out[hour] += value;
  }
  return out;
}

export function topNWithOther(
  map: Map<string, number>,
  n: number,
): { label: string; count: number }[] {
  const sorted = [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const limit = Math.max(0, Math.floor(n));
  const top = sorted.slice(0, limit);
  const other = sorted.slice(limit).reduce((sum, item) => sum + item.count, 0);
  if (other > 0) top.push({ label: "Other", count: other });
  return top;
}

export function computeRatio(a: number, b: number): number {
  if (b === 0) return 0;
  return a / b;
}

export function fillMissingDays(
  dayMap: Map<string, number>,
  startDay: string,
  endDay: string,
): Map<string, number> {
  const start = parseIsoDay(startDay);
  const end = parseIsoDay(endDay);
  if (!start || !end || start.getTime() > end.getTime())
    return new Map<string, number>();

  const out = new Map<string, number>();
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const key = formatIsoDay(cursor);
    out.set(key, dayMap.get(key) ?? 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function buildLineChartSvg(
  series: { label: string; color: string; data: Map<string, number> }[],
  opts: { width: number; height: number },
): string {
  const width = sanitizeChartSize(opts.width, 800);
  const height = sanitizeChartSize(opts.height, 280);

  if (series.length === 0) {
    return emptySvg(width, height, "No data");
  }

  const daySet = new Set<string>();
  for (const item of series) {
    for (const day of item.data.keys()) daySet.add(day);
  }

  const days = [...daySet].sort();
  if (days.length === 0) {
    return emptySvg(width, height, "No data");
  }

  let maxValue = 0;
  for (const item of series) {
    for (const day of days) {
      const value = item.data.get(day) ?? 0;
      if (value > maxValue) maxValue = value;
    }
  }
  if (maxValue <= 0) maxValue = 1;

  const LEFT_PAD = 44;
  const RIGHT_PAD = 14;
  const TOP_PAD = 16;
  const BOTTOM_PAD = 64;
  const chartWidth = Math.max(1, width - LEFT_PAD - RIGHT_PAD);
  const chartHeight = Math.max(1, height - TOP_PAD - BOTTOM_PAD);

  const axisX = LEFT_PAD;
  const axisY = TOP_PAD + chartHeight;
  const xDenom = Math.max(1, days.length - 1);

  const gridLines: string[] = [];
  const yLabels: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const y = TOP_PAD + (i / 4) * chartHeight;
    const value = maxValue * (1 - i / 4);
    gridLines.push(
      `<line x1="${axisX}" y1="${y.toFixed(2)}" x2="${(axisX + chartWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#ececf0" stroke-width="1" />`,
    );
    yLabels.push(
      `<text x="${(axisX - 8).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-size="10" fill="#86868b" font-family="system-ui,sans-serif">${escapeHtml(formatAxisValue(value))}</text>`,
    );
  }

  const xLabels: string[] = [];
  const maxLabels = Math.min(6, days.length);
  const labelIndexes = new Set<number>();
  for (let i = 0; i < maxLabels; i++) {
    const idx =
      maxLabels === 1
        ? 0
        : Math.round((i * (days.length - 1)) / (maxLabels - 1));
    labelIndexes.add(idx);
  }
  for (const idx of [...labelIndexes].sort((a, b) => a - b)) {
    const x = axisX + (idx / xDenom) * chartWidth;
    const label = escapeHtml(formatDayTickLabel(days[idx]));
    xLabels.push(
      `<text x="${x.toFixed(2)}" y="${(axisY + 16).toFixed(2)}" text-anchor="middle" font-size="10" fill="#86868b" font-family="system-ui,sans-serif">${label}</text>`,
    );
  }

  const lines: string[] = [];
  for (const item of series) {
    const points = days.map((day, idx) => {
      const x = axisX + (idx / xDenom) * chartWidth;
      const y =
        TOP_PAD +
        chartHeight -
        ((item.data.get(day) ?? 0) / maxValue) * chartHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    lines.push(
      `<polyline fill="none" stroke="${escapeHtml(item.color)}" stroke-width="2" points="${points.join(" ")}" />`,
    );
  }

  const legend: string[] = [];
  const legendStartY = axisY + 34;
  let legendX = LEFT_PAD;
  let legendRow = 0;
  for (const item of series) {
    const label = escapeHtml(item.label);
    const color = escapeHtml(item.color);
    const itemWidth = 24 + item.label.length * 6;
    if (legendX + itemWidth > width - RIGHT_PAD && legendX > LEFT_PAD) {
      legendX = LEFT_PAD;
      legendRow += 1;
    }
    const y = legendStartY + legendRow * 14;
    legend.push(
      `<rect x="${legendX}" y="${(y - 8).toFixed(2)}" width="10" height="10" rx="2" fill="${color}" />`,
    );
    legend.push(
      `<text x="${legendX + 14}" y="${y.toFixed(2)}" font-size="10" fill="#1d1d1f" font-family="system-ui,sans-serif">${label}</text>`,
    );
    legendX += itemWidth + 10;
  }

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
  ${gridLines.join("\n  ")}
  <line x1="${axisX}" y1="${TOP_PAD}" x2="${axisX}" y2="${axisY}" stroke="#d1d1d6" stroke-width="1" />
  <line x1="${axisX}" y1="${axisY}" x2="${(axisX + chartWidth).toFixed(2)}" y2="${axisY}" stroke="#d1d1d6" stroke-width="1" />
  ${yLabels.join("\n  ")}
  ${xLabels.join("\n  ")}
  ${lines.join("\n  ")}
  ${legend.join("\n  ")}
</svg>`;
}

export function buildStackedBarChartSvg(
  data: {
    label: string;
    stacks: { name: string; value: number; color: string }[];
  }[],
  opts: { width: number; height: number },
): string {
  const width = sanitizeChartSize(opts.width, 800);
  const height = sanitizeChartSize(opts.height, 300);

  if (data.length === 0) {
    return emptySvg(width, height, "No data");
  }

  const LEFT_PAD = 44;
  const RIGHT_PAD = 14;
  const TOP_PAD = 16;
  const BOTTOM_PAD = 80;
  const chartWidth = Math.max(1, width - LEFT_PAD - RIGHT_PAD);
  const chartHeight = Math.max(1, height - TOP_PAD - BOTTOM_PAD);
  const axisX = LEFT_PAD;
  const axisY = TOP_PAD + chartHeight;

  const totals = data.map((item) =>
    item.stacks.reduce((sum, stack) => sum + Math.max(0, stack.value), 0),
  );
  let maxValue = Math.max(...totals, 1);
  if (maxValue <= 0) maxValue = 1;

  const barCount = data.length;
  const barGap = barCount > 1 ? Math.min(14, chartWidth / (barCount * 3)) : 0;
  const barWidth = Math.max(
    1,
    (chartWidth - barGap * (barCount - 1)) / Math.max(1, barCount),
  );

  const gridLines: string[] = [];
  const yLabels: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const y = TOP_PAD + (i / 4) * chartHeight;
    const value = maxValue * (1 - i / 4);
    gridLines.push(
      `<line x1="${axisX}" y1="${y.toFixed(2)}" x2="${(axisX + chartWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#ececf0" stroke-width="1" />`,
    );
    yLabels.push(
      `<text x="${(axisX - 8).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-size="10" fill="#86868b" font-family="system-ui,sans-serif">${escapeHtml(formatAxisValue(value))}</text>`,
    );
  }

  const barRects: string[] = [];
  const xLabels: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const x = axisX + i * (barWidth + barGap);
    let yCursor = axisY;
    for (const stack of item.stacks) {
      const value = Math.max(0, stack.value);
      if (value === 0) continue;
      const h = (value / maxValue) * chartHeight;
      yCursor -= h;
      barRects.push(
        `<rect x="${x.toFixed(2)}" y="${yCursor.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${h.toFixed(2)}" fill="${escapeHtml(stack.color)}" />`,
      );
    }
    const cx = x + barWidth / 2;
    xLabels.push(
      `<text x="${cx.toFixed(2)}" y="${(axisY + 16).toFixed(2)}" text-anchor="middle" font-size="10" fill="#86868b" font-family="system-ui,sans-serif">${escapeHtml(item.label)}</text>`,
    );
  }

  const legendMap = new Map<string, string>();
  for (const item of data) {
    for (const stack of item.stacks) {
      if (!legendMap.has(stack.name)) legendMap.set(stack.name, stack.color);
    }
  }

  const legend: string[] = [];
  const legendStartY = axisY + 36;
  let legendX = LEFT_PAD;
  let legendRow = 0;
  for (const [name, color] of legendMap) {
    const itemWidth = 24 + name.length * 6;
    if (legendX + itemWidth > width - RIGHT_PAD && legendX > LEFT_PAD) {
      legendX = LEFT_PAD;
      legendRow += 1;
    }
    const y = legendStartY + legendRow * 14;
    legend.push(
      `<rect x="${legendX}" y="${(y - 8).toFixed(2)}" width="10" height="10" rx="2" fill="${escapeHtml(color)}" />`,
    );
    legend.push(
      `<text x="${legendX + 14}" y="${y.toFixed(2)}" font-size="10" fill="#1d1d1f" font-family="system-ui,sans-serif">${escapeHtml(name)}</text>`,
    );
    legendX += itemWidth + 10;
  }

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">
  ${gridLines.join("\n  ")}
  <line x1="${axisX}" y1="${TOP_PAD}" x2="${axisX}" y2="${axisY}" stroke="#d1d1d6" stroke-width="1" />
  <line x1="${axisX}" y1="${axisY}" x2="${(axisX + chartWidth).toFixed(2)}" y2="${axisY}" stroke="#d1d1d6" stroke-width="1" />
  ${yLabels.join("\n  ")}
  ${barRects.join("\n  ")}
  ${xLabels.join("\n  ")}
  ${legend.join("\n  ")}
</svg>`;
}
