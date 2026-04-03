// ---------------------------------------------------------------------------
// Mermaid-related module-level state and functions
// ---------------------------------------------------------------------------

let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null;
let mermaidThemeCache: "default" | "dark" | null = null;
let mermaidRenderCounter = 0;

export function resolveMermaidTheme(): "default" | "dark" {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "default";
}

export async function getMermaidClient() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((mod) => mod.default);
  }

  const mermaidClient = await mermaidLoader;
  const theme = resolveMermaidTheme();
  if (mermaidThemeCache !== theme) {
    mermaidClient.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
    });
    mermaidThemeCache = theme;
  }

  return mermaidClient;
}

export function nextMermaidRenderId(prefix: string): string {
  mermaidRenderCounter += 1;
  return `${prefix}-${mermaidRenderCounter}`;
}

export function decodeHtmlEntities(raw: string): string {
  if (typeof document === "undefined") {
    return raw;
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = raw;
  return textarea.value;
}

export function normalizeMermaidSvg(container: ParentNode): string {
  const svgEl = container.querySelector("svg");
  if (!svgEl) return "";

  const viewBox = svgEl.getAttribute("viewBox")?.trim();
  if (viewBox) {
    const values = viewBox
      .split(/[,\s]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (values.length >= 4) {
      const vbWidth = values[2];
      const vbHeight = values[3];
      if (vbWidth > 0 && vbHeight > 0) {
        const widthAttr = svgEl.getAttribute("width")?.trim();
        if (!widthAttr || widthAttr.endsWith("%")) {
          svgEl.setAttribute("width", String(Math.round(vbWidth)));
        }
        if (!svgEl.getAttribute("height")) {
          svgEl.setAttribute("height", String(Math.round(vbHeight)));
        }
      }
    }
  }

  svgEl.setAttribute("role", "img");
  svgEl.setAttribute("aria-label", "Mermaid diagram");
  svgEl.style.display = "block";
  svgEl.style.visibility = "visible";
  return svgEl.outerHTML;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getMermaidSvgDimensions(container: ParentNode): {
  width: number;
  height: number;
} | null {
  const svgEl = container.querySelector("svg");
  if (!svgEl) return null;

  const parseSize = (value: string | null): number | null => {
    if (!value) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const width = parseSize(svgEl.getAttribute("width"));
  const height = parseSize(svgEl.getAttribute("height"));
  if (width && height) {
    return { width, height };
  }

  const viewBox = svgEl.getAttribute("viewBox")?.trim();
  if (!viewBox) return null;
  const values = viewBox
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (values.length < 4) return null;

  const vbWidth = values[2];
  const vbHeight = values[3];
  if (!(vbWidth > 0) || !(vbHeight > 0)) return null;
  return { width: vbWidth, height: vbHeight };
}
