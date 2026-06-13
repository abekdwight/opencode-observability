import type { HighlighterCore } from "shiki/core";

// ---------------------------------------------------------------------------
// Supported languages (must match Shiki language IDs)
// ---------------------------------------------------------------------------
export const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "rust",
  "go",
  "php",
  "ruby",
  "json",
  "jsonc",
  "css",
  "html",
  "bash",
  "yaml",
  "markdown",
  "sql",
  "diff",
  "text",
  "mermaid",
]);

// ---------------------------------------------------------------------------
// Language alias normalization
// ---------------------------------------------------------------------------
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  text: "text",
  plain: "text",
  txt: "text",
  mermaid: "mermaid",
};

/**
 * Normalize a language identifier from a fenced code block into a Shiki
 * language ID. Returns "text" for null, undefined, empty strings, and
 * unrecognized languages — unknown sources must render as plain text,
 * never as a forced highlight in some default grammar.
 *
 * Case-insensitive matching is applied.
 */
export function normalizeLanguage(lang: string | null | undefined): string {
  if (lang == null || lang === "") return "text";
  const lower = lang.toLowerCase();
  if (LANGUAGE_ALIASES[lower] !== undefined) return LANGUAGE_ALIASES[lower];
  if (SUPPORTED_LANGUAGES.has(lower)) return lower;
  return "text";
}

/** Returns true when the (already-normalized) language is "mermaid". */
export function isMermaidLanguage(lang: string | null | undefined): boolean {
  return lang === "mermaid";
}

// ---------------------------------------------------------------------------
// Shiki highlighter singleton (lazy-initialized)
// ---------------------------------------------------------------------------
let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/oniguruma"),
        ]);

      return createHighlighterCore({
        themes: [
          import("@shikijs/themes/github-light"),
          import("@shikijs/themes/github-dark"),
        ],
        langs: [
          import("@shikijs/langs/typescript"),
          import("@shikijs/langs/tsx"),
          import("@shikijs/langs/javascript"),
          import("@shikijs/langs/jsx"),
          import("@shikijs/langs/python"),
          import("@shikijs/langs/rust"),
          import("@shikijs/langs/go"),
          import("@shikijs/langs/php"),
          import("@shikijs/langs/ruby"),
          import("@shikijs/langs/json"),
          import("@shikijs/langs/jsonc"),
          import("@shikijs/langs/css"),
          import("@shikijs/langs/html"),
          import("@shikijs/langs/bash"),
          import("@shikijs/langs/yaml"),
          import("@shikijs/langs/markdown"),
          import("@shikijs/langs/sql"),
          import("@shikijs/langs/diff"),
        ],
        engine: createOnigurumaEngine(() => import("shiki/wasm")),
      });
    })();
  }
  return highlighterPromise;
}

// ---------------------------------------------------------------------------
// Highlighting API
// ---------------------------------------------------------------------------

export interface HighlightResult {
  html: string;
  language: string;
}

/**
 * Highlight code with Shiki using dual light/dark themes.
 *
 * - When `language` is "text" or "mermaid", returns escaped HTML without
 *   syntax tokens.
 * - When `language` is unrecognized, `normalizeLanguage` returns "text",
 *   so unknown sources fall through the plain-text path above.
 * - On Shiki failure, returns escaped plain text.
 */
export async function highlightCode(
  code: string,
  lang: string | null | undefined,
): Promise<HighlightResult> {
  const language = normalizeLanguage(lang);

  // No highlighting for plain text or mermaid (handled separately)
  if (language === "text" || language === "mermaid") {
    return { html: escapeHtml(code), language };
  }

  try {
    const highlighter = await getHighlighter();
    const html = highlighter.codeToHtml(code, {
      lang: language,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    });
    return { html, language };
  } catch {
    return { html: escapeHtml(code), language };
  }
}

/** Eagerly load the Shiki WASM engine in the background. */
export function prewarmHighlighter(): void {
  void getHighlighter();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
