import React from "react";
import { highlightCode, normalizeLanguage } from "../lib/shiki";

export interface CodeBlockProps {
  code: string;
  lang: string | null | undefined;
}

/**
 * Self-contained fenced code block. The outer wrapper owns the visual
 * presentation (background, border, padding, font, scroll); the inner
 * `<pre>` — whether the plain loading fallback or Shiki's highlighted
 * output — is reset to transparent via the `[data-code-block]` rules in
 * globals.css so layout and color never depend on Shiki's own styling.
 *
 * Loading and highlighted states share the same wrapper geometry, so no
 * layout shift occurs once the WASM engine finishes initializing.
 */

const WRAPPER_CLASS =
  "overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-code)] px-4 py-3 [font-family:var(--font-mono)] text-[0.88em] leading-[1.55] text-[var(--color-text-primary)]";

export const CodeBlock = React.memo(function CodeBlock({
  code,
  lang,
}: CodeBlockProps) {
  const normalized = normalizeLanguage(lang);
  const needsHighlight = normalized !== "text" && normalized !== "mermaid";

  const [highlightedHtml, setHighlightedHtml] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!needsHighlight) {
      setHighlightedHtml(null);
      return;
    }
    let cancelled = false;
    highlightCode(code, normalized).then((result) => {
      if (!cancelled) setHighlightedHtml(result.html);
    });
    return () => {
      cancelled = true;
    };
  }, [code, normalized, needsHighlight]);

  if (needsHighlight && highlightedHtml !== null) {
    return (
      <div
        data-code-block
        data-code-language={normalized}
        className={WRAPPER_CLASS}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    );
  }

  return (
    <div
      data-code-block
      data-code-language={normalized}
      className={WRAPPER_CLASS}
    >
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
});
