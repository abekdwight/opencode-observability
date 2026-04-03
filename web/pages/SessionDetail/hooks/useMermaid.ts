import React from "react";
import {
  getMermaidClient,
  nextMermaidRenderId,
  normalizeMermaidSvg,
} from "../lib/mermaid-utils";

// ---------------------------------------------------------------------------
// useMermaid — lazy mermaid loading + rendering
// ---------------------------------------------------------------------------
export function useMermaid(source: string): {
  svg: string | null;
  error: string | null;
  loading: boolean;
} {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let disposed = false;
    setSvg(null);
    setError(null);
    setLoading(true);

    if (!source.trim()) {
      setLoading(false);
      return;
    }

    const renderDiagram = async () => {
      try {
        const mermaidClient = await getMermaidClient();
        if (disposed) return;
        const result = await mermaidClient.render(
          nextMermaidRenderId("hook-mermaid"),
          source,
        );
        if (disposed) return;

        // Normalize the SVG via a temporary container
        const container = document.createElement("div");
        container.innerHTML = result.svg;
        const normalizedSvg = normalizeMermaidSvg(container);

        setSvg(normalizedSvg || result.svg);
        setLoading(false);
      } catch (err) {
        if (disposed) return;
        setError(
          err instanceof Error ? err.message : "diagram render failed",
        );
        setLoading(false);
      }
    };

    void renderDiagram();

    return () => {
      disposed = true;
    };
  }, [source]);

  return { svg, error, loading };
}
