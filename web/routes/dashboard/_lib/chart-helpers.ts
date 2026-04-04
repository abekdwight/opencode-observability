import type {
  DashboardLineSeriesContract,
  DashboardStackBarContract,
} from "../../../../src/contracts/dashboard";

/* ── Recharts line series helper ── */

export interface FlatPoint {
  day: string;
  [seriesLabel: string]: string | number;
}

export function flattenLineSeries(
  series: DashboardLineSeriesContract[],
): FlatPoint[] {
  if (series.length === 0) return [];
  const allDays = new Set<string>();
  for (const s of series) for (const p of s.points) allDays.add(p.day);
  const days = [...allDays].sort();
  const lookup = new Map<string, Map<string, number>>();
  for (const s of series) {
    const m = new Map<string, number>();
    for (const p of s.points) m.set(p.day, p.value);
    lookup.set(s.label, m);
  }
  return days.map((day) => {
    const point: FlatPoint = { day };
    for (const s of series) {
      point[s.label] = lookup.get(s.label)?.get(day) ?? 0;
    }
    return point;
  });
}

/* ── Recharts stacked bar helper ── */

export interface FlatBar {
  label: string;
  [stackName: string]: string | number;
}

export function flattenStackBars(bars: DashboardStackBarContract[]): {
  data: FlatBar[];
  keys: { name: string; color: string }[];
} {
  const keySet = new Map<string, string>();
  for (const bar of bars) {
    for (const s of bar.stacks) {
      if (!keySet.has(s.name)) keySet.set(s.name, s.color);
    }
  }
  const keys = [...keySet.entries()].map(([name, color]) => ({ name, color }));
  const data: FlatBar[] = bars.map((bar) => {
    const row: FlatBar = { label: bar.label };
    for (const s of bar.stacks) row[s.name] = s.value;
    return row;
  });
  return { data, keys };
}
