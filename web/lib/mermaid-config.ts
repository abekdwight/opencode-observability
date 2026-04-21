export type MermaidThemeMode = "auto" | "readable";
export type MermaidResolvedTheme = "light" | "dark";

export interface MermaidRenderPreference {
  mode: MermaidThemeMode;
  resolvedTheme: MermaidResolvedTheme;
}

export const DEFAULT_MERMAID_THEME_MODE: MermaidThemeMode = "readable";

export function getMermaidConfigCacheKey(
  preference: MermaidRenderPreference,
): string {
  if (preference.mode === "readable") {
    return "readable";
  }

  return `auto:${preference.resolvedTheme}`;
}

export function buildMermaidInitConfig(preference: MermaidRenderPreference) {
  const baseConfig = {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
  };

  if (preference.mode === "readable") {
    return {
      ...baseConfig,
      theme: "default" as const,
      layout: "elk" as const,
      elk: {
        mergeEdges: true,
        forceNodeModelOrder: true,
      },
    };
  }

  return {
    ...baseConfig,
    theme:
      preference.resolvedTheme === "dark"
        ? ("dark" as const)
        : ("default" as const),
  };
}
