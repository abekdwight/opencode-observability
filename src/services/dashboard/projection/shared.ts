import type {
  DashboardDayValueContract,
  DashboardSelectionBoundsContract,
} from "../../../contracts/dashboard.js";
import { fillMissingDays } from "../../../lib/analytics.js";
import type {
  DashboardDayContribution,
  DashboardSessionAtom,
} from "../aggregator/types.js";

// Series colors are shared across activity/tools trend charts. The first five
// entries identify the top-N series; index 5 (gray) is the "Other" fold.
export const SERIES_COLORS = [
  "#0066cc",
  "#d32f2f",
  "#2e7d32",
  "#e65100",
  "#6a1b9a",
  "#86868b",
] as const;

// Error-trend palette (distinct from SERIES_COLORS for visual separation).
export const ERROR_TREND_COLORS = [
  "#d32f2f",
  "#1565c0",
  "#2e7d32",
  "#e65100",
  "#6a1b9a",
  "#86868b",
] as const;

// Token I/O daily series colors (input=blue, output=green).
export const TOKEN_INPUT_COLOR = "#1565c0";
export const TOKEN_OUTPUT_COLOR = "#2e7d32";

// Percentile statistics require a minimum sample size to be meaningful; below
// the threshold the statistic is reported as null rather than a noisy estimate.
// The thresholds scale with how far into the tail a percentile reaches: the
// deeper the quantile, the more samples are needed before the estimate is
// stable. These gates apply identically to the TPS and Latency distributions
// (both are per-(model, provider) sample arrays of the same nature).
//
//   avg  : 5   — an average over a handful of turns is already informative.
//   P10  : 20  — same as the median gate; a low-tail estimate needs a body.
//   P50  : 20  — established median gate (kept unchanged for back-compat).
//   P90  : 20  — one-in-ten tail; usable once there are ~20 samples.
//   P99  : 100 — one-in-a-hundred tail; needs ~100 samples to not be a single
//                outlier masquerading as a percentile.
export const TPS_AVG_MIN_SAMPLES = 5;
export const PERCENTILE_P10_MIN_SAMPLES = 20;
export const TPS_P50_MIN_SAMPLES = 20;
export const PERCENTILE_P50_MIN_SAMPLES = 20;
export const PERCENTILE_P90_MIN_SAMPLES = 20;
export const PERCENTILE_P99_MIN_SAMPLES = 100;

export function isDayWithinSelection(
  day: string,
  selection: DashboardSelectionBoundsContract,
): boolean {
  return day >= selection.startDayInclusive && day <= selection.endDayInclusive;
}

// Atoms whose contributing days intersect the selection. A pure filter over the
// atom set — no day-rollup layer is consulted.
export function selectAtomsForWindow(
  atoms: Iterable<DashboardSessionAtom>,
  selection: DashboardSelectionBoundsContract,
): DashboardSessionAtom[] {
  const selected: DashboardSessionAtom[] = [];
  for (const atom of atoms) {
    for (const day of atom.days.keys()) {
      if (isDayWithinSelection(day, selection)) {
        selected.push(atom);
        break;
      }
    }
  }
  return selected;
}

// Iterate the day contributions of the selected atoms that fall in-window.
export function* selectedDayContributions(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionBoundsContract,
): Generator<DashboardDayContribution> {
  for (const atom of atoms) {
    for (const contribution of atom.days.values()) {
      if (isDayWithinSelection(contribution.day, selection)) {
        yield contribution;
      }
    }
  }
}

export function mergeCountInto(
  target: Map<string, number>,
  source: Map<string, number>,
): void {
  for (const [key, value] of source) {
    if (value === 0) continue;
    target.set(key, (target.get(key) ?? 0) + value);
  }
}

export function toDayValues(
  map: Map<string, number>,
): DashboardDayValueContract[] {
  return Array.from(map.entries())
    .map(([day, value]) => ({ day, value }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// Build a continuous daily series (gaps filled with 0) across the selection.
export function buildDailyPoints(
  dayMap: Map<string, number>,
  selection: DashboardSelectionBoundsContract,
): DashboardDayValueContract[] {
  return toDayValues(
    fillMissingDays(
      dayMap,
      selection.startDayInclusive,
      selection.endDayInclusive,
    ),
  );
}

// Ordered list of every day in the selection window (inclusive). Used for axis
// headers such as the active-repositories cross-table.
export function buildSelectedDays(
  selection: DashboardSelectionBoundsContract,
): string[] {
  return Array.from(
    fillMissingDays(
      new Map(),
      selection.startDayInclusive,
      selection.endDayInclusive,
    ).keys(),
  ).sort();
}

// Linear-interpolated quantile (matches the prior service exactly).
export function interpolateQuantile(
  values: number[],
  quantile: number,
): number {
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

export function quantileOrNull(
  values: number[],
  quantile: number,
  minSamples: number,
): number | null {
  if (values.length < minSamples) return null;
  return Number(interpolateQuantile(values, quantile).toFixed(2));
}

// Top-N labels by descending count over a label->count map.
export function topNLabels(map: Map<string, number>, n: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label]) => label);
}
