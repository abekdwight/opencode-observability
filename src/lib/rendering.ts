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
    marked.parse(escapeHtml(markdown), { gfm: true }) as string,
  );
}

export function renderSafeDiff(diffText: string): string {
  return escapeHtml(diffText);
}

function sanitizeMarkedHtml(html: string): string {
  return html
    .replace(/\b(href|src)="\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/\b(href|src)="\s*vbscript:[^"]*"/gi, '$1="#"')
    .replace(/\b(href|src)="\s*data:text\/html[^"]*"/gi, '$1="#"');
}
