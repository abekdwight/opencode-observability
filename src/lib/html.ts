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

/** Format milliseconds as human-readable duration (e.g. "2h 47m 12s", "3m 5s", "12s") */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format milliseconds as short duration for lists (e.g. "2h47m", "3m", "<1m") */
export function formatDurationShort(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  if (totalMin > 0) return `${totalMin}m`;
  return '<1m';
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
    <input type="text" name="q" placeholder="Search titles and chat history" style="padding: 6px 12px; border-radius: 8px; border: 1px solid #d2d2d7; font-size: 0.9em; width: 240px;" />
  </form>
</div>
`;

export function renderSessionCopyButton(sessionId: string, directory: string): string {
  const safeSessionId = escapeHtml(sessionId);
  const safeDirectory = escapeHtml(directory);
  const defaultLabel = 'コマンドをコピー';
  const defaultAriaLabel = `${sessionId} のコマンドをコピー`;
  return `<button class="session-copy-btn" type="button" data-session-id="${safeSessionId}" data-session-dir="${safeDirectory}" data-default-label="${escapeHtml(defaultLabel)}" aria-label="${escapeHtml(defaultAriaLabel)}" title="${escapeHtml(defaultAriaLabel)}" onclick="copySessionCommand(this)">
    <span class="session-copy-icon-copy" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="12" height="12" rx="2" ry="2"></rect>
        <path d="M5 15V5a2 2 0 0 1 2-2h10"></path>
      </svg>
    </span>
    <span class="session-copy-icon-check" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="20 6 10 18 4 12"></polyline>
      </svg>
    </span>
    <span class="session-copy-id">${safeSessionId}</span>
  </button>`;
}

export const SESSION_COPY_STYLES = `
.session-copy-btn {
  border: 1px solid #d2d2d7;
  background: #fff;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 0.8em;
  color: #1d1d1f;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.session-copy-icon-copy,
.session-copy-icon-check {
  width: 0.95em;
  height: 0.95em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.session-copy-icon-copy svg,
.session-copy-icon-check svg {
  display: block;
  width: 100%;
  height: 100%;
}

.session-copy-icon-check {
  display: none;
}

.session-copy-id {
  font-size: 0.8em;
  font-family: 'SF Mono', 'Fira Code', monospace;
  white-space: nowrap;
}

.session-copy-btn:hover {
  background: #f2f7ff;
}

.session-copy-btn:disabled {
  opacity: 0.72;
  cursor: default;
}

.session-copy-btn.copied {
  background: #e8f4ec;
  border-color: #4caf50;
  color: #2e7d32;
}

.session-copy-btn.copied .session-copy-icon-copy {
  display: none;
}

.session-copy-btn.copied .session-copy-icon-check {
  display: inline-flex;
}

.session-copy-btn.copy-error {
  background: #fbe9e7;
  border-color: #e53935;
  color: #b71c1c;
}
`;

export const SESSION_COPY_SCRIPT = `
function copySessionCommand(button) {
  if (!button || button.disabled) return;

  const sessionId = button?.dataset?.sessionId || '';
  const directory = button?.dataset?.sessionDir || '';
  const defaultLabel = button?.dataset?.defaultLabel || 'コマンドをコピー';
  const failureLabel = 'コピーに失敗しました';
  const platformHint = navigator.userAgentData?.platform || navigator.platform || '';
  const isWindows = /Win/i.test(platformHint) || /Windows/i.test(navigator.userAgent || '');
  const quotePosixShell = (value) => "'" + value.replace(/'/g, "'\\\"'\\\"'") + "'";
  const quotePowerShell = (value) => "'" + value.replace(/'/g, "''") + "'";
  const quoteForShell = isWindows ? quotePowerShell : quotePosixShell;
  const quotedDir = quoteForShell(directory);
  const quotedSessionId = quoteForShell(sessionId);
  const command = isWindows
    ? 'Set-Location -LiteralPath ' + quotedDir + '; if ($?) { opencode -s ' + quotedSessionId + ' }'
    : 'cd ' + quotedDir + ' && opencode -s ' + quotedSessionId;
  let copied = false;

  const setState = (state) => {
    button.classList.remove('copied', 'copy-error');
    if (state === 'copied') {
      button.classList.add('copied');
      button.setAttribute('aria-label', sessionId + ' のコマンドをコピーしました');
      button.setAttribute('title', sessionId + ' のコマンドをコピーしました');
      return;
    }

    if (state === 'error') {
      button.classList.add('copy-error');
      button.setAttribute('aria-label', sessionId + ' の' + failureLabel);
      button.setAttribute('title', sessionId + ' の' + failureLabel);
      return;
    }

    button.setAttribute('aria-label', sessionId + ' の' + defaultLabel);
    button.setAttribute('title', sessionId + ' の' + defaultLabel);
  };

  const restore = () => {
    setState('idle');
    button.classList.remove('copied');
    button.disabled = false;
  };

  button.disabled = true;
  setState('copying');

  (async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(command);
        copied = true;
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = command;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          copied = document.execCommand('copy');
        } finally {
          document.body.removeChild(textarea);
        }
      }
    } catch {
      copied = false;
    }

    setState(copied ? 'copied' : 'error');

    const previousId = Number(button.dataset.copyTimeoutId);
    if (previousId) {
      clearTimeout(previousId);
    }
    button.dataset.copyTimeoutId = String(window.setTimeout(restore, 1200));
  })();
}
`;
