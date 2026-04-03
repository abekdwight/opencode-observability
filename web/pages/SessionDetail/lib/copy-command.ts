// ---------------------------------------------------------------------------
// Copy command logic  (ported from legacy SESSION_COPY_SCRIPT)
// ---------------------------------------------------------------------------
export function buildCopyCommand(sessionId: string, directory: string): string {
  const ua =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  const isWindows = /Win/i.test(ua) || /Windows/i.test(navigator.userAgent);
  const quote = isWindows
    ? (v: string) => `'${v.replace(/'/g, "''")}'`
    : (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
  const d = quote(directory);
  const s = quote(sessionId);
  return isWindows
    ? `Set-Location -LiteralPath ${d}; if ($?) { opencode -s ${s} }`
    : `cd ${d} && opencode -s ${s}`;
}
