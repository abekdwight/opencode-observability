export function getTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "Local time";
  }
}

export function toModelProviderLabel(model: string, provider: string): string {
  return `${model} · ${provider}`;
}

export function formatLocalDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildLastYearBounds(): {
  startDayInclusive: string;
  endDayInclusive: string;
} {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  return {
    startDayInclusive: formatLocalDay(start),
    endDayInclusive: formatLocalDay(end),
  };
}

export function formatAxisCount(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString();
}

export function formatAxisTps(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric >= 100 ? numeric.toFixed(0) : numeric.toFixed(1);
}

export function formatModelTickLabel(value: string, max = 16): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function quantileNumber(values: number[], quantile: number): number {
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

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatNullableMetric(
  value: number | null,
  digits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return value.toFixed(digits);
}

export function formatLatencySeconds(valueMs: number | null): string {
  if (valueMs == null || !Number.isFinite(valueMs)) return "\u2014";
  const sec = valueMs / 1000;
  return sec >= 100 ? `${sec.toFixed(0)}s` : `${sec.toFixed(1)}s`;
}

export function formatPercentRatio(
  value: number | null,
  digits = 1,
): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDeviation(
  p10: number | null,
  p90: number | null,
  digits = 2,
): string {
  if (p10 == null || p90 == null) return "\u2014";
  const sigma = Math.abs(p90 - p10) / 2.56;
  return `σ≈${sigma.toFixed(digits)}`;
}

export function prettifyPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
