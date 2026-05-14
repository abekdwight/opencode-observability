import React from "react";
import { CodeBlock } from "../../../components/code-block";
import { useMermaidPreferences } from "../../../components/mermaid-preferences-provider";
import {
  decodeHtmlEntities,
  getMermaidClient,
  nextMermaidRenderId,
  normalizeMermaidSvg,
} from "../_lib/mermaid-utils";
import { MermaidLightbox } from "./mermaid-lightbox";

// ---------------------------------------------------------------------------
// MermaidCodeBlock — mermaid diagram as a React component
//
// Replaces the imperative DOM query/replace approach previously used in
// message-row.tsx. Receives the mermaid source code as a string and renders
// either a preview button (with inline SVG) or falls back to a plain code
// block on error.
// ---------------------------------------------------------------------------

export interface MermaidCodeBlockProps {
  code: string;
  /** Index passed through to help generate unique render IDs. */
  msgIdx: number;
}

export const MermaidCodeBlock = React.memo(function MermaidCodeBlock({
  code,
  msgIdx,
}: MermaidCodeBlockProps) {
  const { mermaidPreference } = useMermaidPreferences();
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "svg"; svg: string } | { kind: "error" }
  >({ kind: "loading" });

  // Mermaid lightbox state
  const [zoomSource, setZoomSource] = React.useState<string | null>(null);

  const source = React.useMemo(() => decodeHtmlEntities(code), [code]);

  // Render mermaid diagram on mount / when preference changes
  React.useEffect(() => {
    let disposed = false;

    async function renderMermaid() {
      if (!source.trim()) {
        setState({ kind: "error" });
        return;
      }
      try {
        const mermaidClient = await getMermaidClient(mermaidPreference);
        if (disposed) return;
        const { svg } = await mermaidClient.render(
          nextMermaidRenderId(`session-mermaid-${msgIdx}`),
          source,
        );
        if (disposed) return;
        // Normalize SVG dimensions via a temporary container
        const temp = document.createElement("div");
        temp.innerHTML = svg;
        normalizeMermaidSvg(temp);
        setState({
          kind: "svg",
          svg: temp.querySelector("svg")?.outerHTML ?? svg,
        });
      } catch {
        if (!disposed) setState({ kind: "error" });
      }
    }

    void renderMermaid();
    return () => {
      disposed = true;
    };
  }, [source, msgIdx, mermaidPreference]);

  // Loading state: show plain code block
  if (state.kind === "loading") {
    return <CodeBlock code={code} lang="mermaid" />;
  }

  // Error state: show plain code block with error note
  if (state.kind === "error") {
    return (
      <div>
        <p className="mermaid-error-note my-2 text-[0.83em] font-medium text-[var(--color-error-text)]">
          Mermaid図の描画に失敗したため、ソースを表示しています。
        </p>
        <CodeBlock code={code} lang="mermaid" />
      </div>
    );
  }

  // SVG state: render preview button with inline SVG
  return (
    <>
      <button
        type="button"
        className="w-full rounded-xl border border-[var(--color-border-default)] bg-gradient-to-b from-[#fcfcfd] to-[#f5f5f7] p-3 text-left cursor-zoom-in transition-[border-color,box-shadow] duration-150 hover:border-[var(--color-accent)] hover:shadow-[0_0_0_2px_rgba(0,102,204,0.12)] dark:from-[var(--color-bg-elevated)] dark:to-[var(--color-bg-muted)]"
        aria-label="クリックで拡大表示"
        title="クリックで拡大"
        onClick={() => setZoomSource(source)}
      >
        <div
          className="overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2.5 flex justify-center items-start [&_svg]:block [&_svg]:max-w-full [&_svg]:w-auto [&_svg]:h-auto [&_svg]:m-0"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
        <span className="block mt-2 text-[var(--color-text-secondary)] text-xs tracking-[0.02em]">
          クリックで拡大
        </span>
      </button>
      {zoomSource ? (
        <MermaidLightbox
          source={zoomSource}
          returnFocusTo={null}
          onClose={() => setZoomSource(null)}
        />
      ) : null}
    </>
  );
});
