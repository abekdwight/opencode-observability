import { marked } from "marked";
import { escapeHtml } from "./text-format.js";

export function renderSafeMarkdown(markdown: string): string {
  return sanitizeMarkedHtml(marked.parse(escapeHtml(markdown)) as string);
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
