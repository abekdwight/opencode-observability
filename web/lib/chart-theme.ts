/**
 * Shared chart theme constants for recharts v3.
 * T7/T8/T9 will use these when building chart pages.
 */
export const CHART_THEME = {
  colors: {
    primary: "#0066cc",
    success: "#2e7d32",
    warning: "#8a5700",
    error: "#b71c1c",
    muted: "#86868b",
    border: "#d2d2d7",
    background: "#ffffff",
    canvas: "#f5f5f7",
  },
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  monoFont: '"SF Mono", "Fira Code", monospace',
  tooltip: {
    backgroundColor: "#1d1d1f",
    textColor: "#ffffff",
    borderRadius: 8,
    fontSize: 12,
    padding: [8, 12] as [number, number],
  },
  axis: {
    fontSize: 11,
    tickColor: "#86868b",
    gridColor: "#f0f0f0",
  },
} as const;
