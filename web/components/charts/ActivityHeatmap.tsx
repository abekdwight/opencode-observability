import React from "react";
import type { DashboardHeatmapDayContract } from "../../../src/contracts/dashboard";

const CELL = 13;
const GAP = 2;
const STEP = CELL + GAP;
const LEFT_PAD = 28;
const TOP_PAD = 20;

function getColor(cnt: number, maxCount: number): string {
  if (cnt === 0) return "#ebedf0";
  const ratio = cnt / maxCount;
  if (ratio < 0.25) return "#9be9a8";
  if (ratio < 0.5) return "#40c463";
  if (ratio < 0.75) return "#30a14e";
  return "#216e39";
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getDaysBetween(startStr: string, endStr: string): Date[] {
  const start = parseDateStr(startStr);
  const end = parseDateStr(endStr);
  const days: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

interface HeatmapDay {
  date: Date;
  dateStr: string;
}

interface Props {
  days: DashboardHeatmapDayContract[];
  startDay: string;
  endDay: string;
}

export const ActivityHeatmap = React.memo(function ActivityHeatmap({
  days: dayCounts,
  startDay,
  endDay,
}: Props) {
  const dayMap = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const { day, count } of dayCounts) m.set(day, count);
    return m;
  }, [dayCounts]);

  const { heatmapDays, startDow, maxCount, totalDays } = React.useMemo(() => {
    const days = getDaysBetween(startDay, endDay);
    const result: HeatmapDay[] = days.map((d) => ({
      date: d,
      dateStr: toDateStr(d),
    }));
    const counts = result.map((d) => dayMap.get(d.dateStr) ?? 0);
    return {
      heatmapDays: result,
      startDow: result[0]?.date.getDay() ?? 0,
      maxCount: Math.max(...counts, 1),
      totalDays: result.length,
    };
  }, [dayMap, startDay, endDay]);

  const totalCols = Math.ceil((totalDays + startDow) / 7);
  const svgWidth = LEFT_PAD + totalCols * STEP;
  const svgHeight = TOP_PAD + 7 * STEP;

  const monthLabels = React.useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let i = 0; i < heatmapDays.length; i++) {
      const month = heatmapDays[i].date.getMonth();
      if (month !== lastMonth) {
        labels.push({
          col: Math.floor((i + startDow) / 7),
          label: heatmapDays[i].date.toLocaleString("en-US", {
            month: "short",
          }),
        });
        lastMonth = month;
      }
    }
    return labels;
  }, [heatmapDays, startDow]);

  const [tooltip, setTooltip] = React.useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  return (
    <div className="heatmap-scroll">
      <svg
        width={svgWidth}
        height={svgHeight}
        role="img"
        aria-label={`Activity heatmap showing sessions from ${startDay} to ${endDay}`}
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* weekday labels */}
        {[
          { row: 1, label: "Mon" },
          { row: 3, label: "Wed" },
          { row: 5, label: "Fri" },
        ].map(({ row, label }) => (
          <text
            key={label}
            x={0}
            y={TOP_PAD + row * STEP + CELL - 2}
            fontSize={9}
            fill="#86868b"
            fontFamily="system-ui,sans-serif"
          >
            {label}
          </text>
        ))}

        {/* month labels */}
        {monthLabels.map(({ col, label }) => (
          <text
            key={`${label}-${col}`}
            x={LEFT_PAD + col * STEP}
            y={TOP_PAD - 6}
            fontSize={10}
            fill="#86868b"
            fontFamily="system-ui,sans-serif"
          >
            {label}
          </text>
        ))}

        {/* day rects */}
        {heatmapDays.map(({ date, dateStr }, i) => {
          const col = Math.floor((i + startDow) / 7);
          const row = (i + startDow) % 7;
          const cnt = dayMap.get(dateStr) ?? 0;
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

          return (
            <rect
              key={dateStr}
              x={x}
              y={y}
              width={CELL}
              height={CELL}
              rx={2}
              fill={getColor(cnt, maxCount)}
              onPointerEnter={() =>
                setTooltip({ x: x + CELL / 2, y, text: title })
              }
              onPointerLeave={() => setTooltip(null)}
            >
              <title>{title}</title>
            </rect>
          );
        })}

        {/* tooltip */}
        {tooltip ? (
          <g>
            <rect
              x={tooltip.x - 70}
              y={tooltip.y - 28}
              width={140}
              height={22}
              rx={4}
              fill="#1d1d1f"
            />
            <text
              x={tooltip.x}
              y={tooltip.y - 14}
              textAnchor="middle"
              fontSize={11}
              fill="#fff"
              fontFamily="system-ui,sans-serif"
            >
              {tooltip.text}
            </text>
          </g>
        ) : null}
      </svg>

      <div className="heatmap-legend">
        <span>Less</span>
        <svg
          width={68}
          height={12}
          role="img"
          aria-label="Heatmap color legend"
        >
          <title>Legend</title>
          <rect x={0} y={0} width={12} height={12} rx={2} fill="#ebedf0" />
          <rect x={14} y={0} width={12} height={12} rx={2} fill="#9be9a8" />
          <rect x={28} y={0} width={12} height={12} rx={2} fill="#40c463" />
          <rect x={42} y={0} width={12} height={12} rx={2} fill="#30a14e" />
          <rect x={56} y={0} width={12} height={12} rx={2} fill="#216e39" />
        </svg>
        <span>More</span>
      </div>
    </div>
  );
});
