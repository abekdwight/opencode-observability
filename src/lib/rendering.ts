import { marked } from "marked";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSafeMarkdown(markdown: string): string {
  return sanitizeMarkedHtml(
    marked.parse(markdown, { gfm: true }) as string,
  );
}

export function renderSafeDiff(diffText: string): string {
  return escapeHtml(diffText);
}

function sanitizeMarkedHtml(html: string): string {
  return (
    html
      // Remove dangerous tags and their content
      .replace(
        /<(script|iframe|object|embed|form|style|link|meta|base)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        "",
      )
      // Remove self-closing/void dangerous tags
      .replace(
        /<(script|iframe|object|embed|form|style|link|meta|base)\b[^>]*\/?>/gi,
        "",
      )
      // Remove event handler attributes
      .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "")
      // Neutralize dangerous URL schemes
      .replace(/\b(href|src)="\s*javascript:[^"]*"/gi, '$1="#"')
      .replace(/\b(href|src)="\s*vbscript:[^"]*"/gi, '$1="#"')
      .replace(/\b(href|src)="\s*data:text\/html[^"]*"/gi, '$1="#"')
  );
}
