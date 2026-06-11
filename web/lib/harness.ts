import type { HarnessId } from "../../src/contracts/harness.js";

export const HARNESS_LABELS: Record<HarnessId, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude Code",
};

export function sessionPath(harness: HarnessId, id: string): string {
  return `/sessions/${harness}/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Resume command — `cd <dir> && <cli resume>` per harness, platform-quoted
// ---------------------------------------------------------------------------

const RESUME_TEMPLATES: Record<HarnessId, (id: string) => string> = {
  opencode: (id) => `opencode -s ${id}`,
  codex: (id) => `codex resume ${id}`,
  claude: (id) => `claude --resume ${id}`,
};

export function buildResumeCommand(
  harness: HarnessId,
  sessionId: string,
  directory: string,
): string {
  const ua =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  const isWindows = /Win/i.test(ua) || /Windows/i.test(navigator.userAgent);
  const quote = isWindows
    ? (v: string) => `'${v.replace(/'/g, "''")}'`
    : (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
  const resume = RESUME_TEMPLATES[harness](quote(sessionId));
  if (!directory) return resume;
  const d = quote(directory);
  return isWindows
    ? `Set-Location -LiteralPath ${d}; if ($?) { ${resume} }`
    : `cd ${d} && ${resume}`;
}
