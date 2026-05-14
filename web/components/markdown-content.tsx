import React from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isMermaidLanguage, normalizeLanguage } from "../lib/shiki";
import { CodeBlock } from "./code-block";
import { InlineCode } from "./inline-code";

// ---------------------------------------------------------------------------
// MarkdownContent — renders markdown text as React components
//
// Responsibility split:
//   - `pre`  handler: fenced code blocks (language-tagged OR not) → CodeBlock
//                     (with optional mermaid override before CodeBlock).
//                     Reads raw hast node data instead of rendered children
//                     so fenced code text is recovered verbatim, independent
//                     of any `code` handler override.
//   - `code` handler: inline `<code>` only → InlineCode.
//
// MarkdownContent does NOT carry visual presentation for code — it only
// routes markdown nodes to the appropriate self-contained component. All
// styling lives inside CodeBlock / InlineCode.
// ---------------------------------------------------------------------------

export interface MarkdownContentProps {
  children: string;
  /** Additional component overrides merged on top of the defaults. */
  components?: Components;
  /**
   * Custom renderer for mermaid fenced code blocks. When provided, mermaid
   * blocks are rendered via this callback instead of the default CodeBlock
   * path (which would display the source as plain text).
   */
  renderMermaidCode?: (code: string) => React.ReactNode;
}

export function MarkdownContent({
  children,
  components: extraComponents,
  renderMermaidCode,
}: MarkdownContentProps) {
  const mergedComponents: Components = React.useMemo(() => {
    const base: Components = {
      pre({ node }) {
        const extracted = extractFencedCode(node);
        if (!extracted) return null;
        const { code, lang } = extracted;
        if (
          lang !== null &&
          isMermaidLanguage(normalizeLanguage(lang)) &&
          renderMermaidCode
        ) {
          return <>{renderMermaidCode(code)}</>;
        }
        return <CodeBlock code={code} lang={lang} />;
      },
      code({ children, className }) {
        if (className?.startsWith("language-")) {
          return <>{children}</>;
        }
        return <InlineCode>{children}</InlineCode>;
      },
    };
    return extraComponents ? { ...base, ...extraComponents } : base;
  }, [extraComponents, renderMermaidCode]);

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mergedComponents}>
      {children}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Hast extraction helpers
// ---------------------------------------------------------------------------

interface MinimalHastElement {
  tagName?: string;
  properties?: { className?: unknown };
  children?: MinimalHastChild[];
}
type MinimalHastChild =
  | (MinimalHastElement & { type?: string })
  | { type: "text"; value?: string };

function extractFencedCode(
  preNode: unknown,
): { code: string; lang: string | null } | null {
  if (!isObject(preNode)) return null;
  const node = preNode as MinimalHastElement;
  if (node.tagName !== "pre") return null;
  const children = node.children ?? [];
  const codeChild = children.find(
    (c): c is MinimalHastElement =>
      isObject(c) && (c as MinimalHastElement).tagName === "code",
  );
  if (!codeChild) return null;

  return {
    code: flattenHastText(codeChild.children ?? []),
    lang: extractLanguageClass(codeChild.properties?.className),
  };
}

function extractLanguageClass(classProp: unknown): string | null {
  const candidates = Array.isArray(classProp)
    ? classProp
    : typeof classProp === "string"
      ? [classProp]
      : [];
  for (const cls of candidates) {
    if (typeof cls === "string" && cls.startsWith("language-")) {
      return cls.slice("language-".length);
    }
  }
  return null;
}

function flattenHastText(nodes: readonly MinimalHastChild[]): string {
  let out = "";
  for (const node of nodes) {
    if (!isObject(node)) continue;
    if ("value" in node && typeof node.value === "string") {
      out += node.value;
    } else if ("children" in node && Array.isArray(node.children)) {
      out += flattenHastText(node.children);
    }
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
