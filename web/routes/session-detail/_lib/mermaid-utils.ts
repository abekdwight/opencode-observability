import {
  buildMermaidInitConfig,
  getMermaidConfigCacheKey,
  type MermaidRenderPreference,
} from "../../../lib/mermaid-config";

// ---------------------------------------------------------------------------
// Mermaid-related module-level state and functions
// ---------------------------------------------------------------------------

let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null;
let mermaidConfigCacheKey: string | null = null;
let mermaidRenderCounter = 0;

export async function getMermaidClient(preference: MermaidRenderPreference) {
  if (!mermaidLoader) {
    mermaidLoader = Promise.all([
      import("mermaid").then((mod) => mod.default),
      import("@mermaid-js/layout-elk").then((mod) => mod.default),
    ]).then(async ([mermaidClient, elkLayouts]) => {
      await mermaidClient.registerLayoutLoaders(elkLayouts);
      return mermaidClient;
    });
  }

  const mermaidClient = await mermaidLoader;
  const configCacheKey = getMermaidConfigCacheKey(preference);
  if (mermaidConfigCacheKey !== configCacheKey) {
    mermaidClient.initialize(buildMermaidInitConfig(preference));
    mermaidConfigCacheKey = configCacheKey;
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
