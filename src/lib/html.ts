import { homedir } from 'node:os';

const HOME_PREFIX = homedir();

/** Replace the home directory prefix with `~` for display. */
export function prettifyPath(dir: string): string {
  return dir.startsWith(HOME_PREFIX) ? '~' + dir.slice(HOME_PREFIX.length) : dir;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export const PAGE_SHELL_START = (title: string, opts?: { bodyClass?: string }) => `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - OpenCode Telemetry</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .breadcrumb { font-size: 0.85em; color: #86868b; margin-bottom: 16px; }
    .breadcrumb a { color: #0066cc; }
    .breadcrumb .sep { margin: 0 6px; }
    .card { background: white; border-radius: 12px; border: 1px solid #d2d2d7; padding: 20px 24px; margin-bottom: 16px; }
    .tag { font-size: 0.8em; padding: 3px 10px; border-radius: 6px; font-weight: 500; display: inline-block; }
    .tag-model { background: #e8e0f0; color: #6b3fa0; }
    .tag-agent { background: #dff0df; color: #2d6a2e; }
    .tag-dir { background: #f0f0f0; color: #666; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75em; }
  </style>
`;

export const PAGE_SHELL_END = `
</body>
</html>
`;

export const NAV_SEARCH = `
<div style="margin-bottom: 16px;">
  <a href="/" style="margin-right: 16px;">Home</a>
  <a href="/directories" style="margin-right: 16px;">Directories</a>
  <form action="/search" method="get" style="display: inline-block;">
    <input type="text" name="q" placeholder="Search sessions..." style="padding: 6px 12px; border-radius: 8px; border: 1px solid #d2d2d7; font-size: 0.9em; width: 240px;" />
  </form>
</div>
`;
