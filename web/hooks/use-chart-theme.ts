/**
 * Hook that reads CSS variables to build a Recharts-compatible theme object.
 * Depends on the resolved theme (light/dark) so charts re-render on theme change.
 */
import { useMemo } from "react";
import { useTheme } from "./use-theme";

export interface ChartTheme {
  colors: {
    primary: string;
    success: string;
    warning: string;
    error: string;
    muted: string;
    border: string;
    background: string;
    canvas: string;
  };
  tooltip: {
    backgroundColor: string;
    textColor: string;
    borderRadius: number;
    fontSize: number;
  };
  axis: {
    fontSize: number;
    tickColor: string;
    gridColor: string;
  };
  fontFamily: string;
  monoFont: string;
}

function readVar(
  style: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  return style.getPropertyValue(name).trim() || fallback;
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();

  // biome-ignore lint/correctness/useExhaustiveDependencies: resolvedTheme is an intentional recompute trigger so the CSS-variable-derived theme refreshes on theme toggle
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);

    return {
      colors: {
        primary: readVar(style, "--color-accent", "#6366f1"),
        success: readVar(style, "--color-success", "#22c55e"),
        warning: readVar(style, "--color-warning", "#f59e0b"),
        error: readVar(style, "--color-error", "#ef4444"),
        muted: readVar(style, "--color-text-secondary", "#6e6e73"),
        border: readVar(style, "--color-border-default", "rgba(0,0,0,0.08)"),
        background: readVar(style, "--color-bg-surface", "#ffffff"),
        canvas: readVar(style, "--color-bg-root", "#fafafa"),
      },
      tooltip: {
        backgroundColor: readVar(style, "--color-bg-surface", "#ffffff"),
        textColor: readVar(style, "--color-text-primary", "#1d1d1f"),
        borderRadius: 8,
        fontSize: 12,
      },
      axis: {
        fontSize: 11,
        tickColor: readVar(style, "--color-text-secondary", "#6e6e73"),
        gridColor: readVar(style, "--color-border-faint", "rgba(0,0,0,0.03)"),
      },
      fontFamily: readVar(
        style,
        "--font-sans",
        'system-ui, -apple-system, "Segoe UI", sans-serif',
      ),
      monoFont: readVar(
        style,
        "--font-mono",
        '"SF Mono", "Fira Code", monospace',
      ),
    };
    // Re-compute when theme changes
  }, [resolvedTheme]);
}
