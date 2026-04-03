// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSafeDiff(diff: string): string {
  const lines = escapeHtml(diff).split("\n");
  return lines
    .map((line) => {
      if (line.startsWith("+")) return `<span class="diff-add">${line}</span>`;
      if (line.startsWith("-")) return `<span class="diff-del">${line}</span>`;
      if (line.startsWith("@@"))
        return `<span class="diff-hunk">${line}</span>`;
      return line;
    })
    .join("\n");
}
