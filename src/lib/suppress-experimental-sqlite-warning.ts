// node:sqlite is still flagged "experimental" and Node prints a one-time
// ExperimentalWarning to stderr the first time it is used. That noise would
// surface in opencode's plugin logs on every server/worker start, so we filter
// out ONLY that specific warning while leaving every other warning intact.
//
// The wrapper (./sqlite.ts) calls this immediately before it loads node:sqlite,
// which is the single chokepoint for every DB connection, so the hook is always
// in place before the first emission regardless of import ordering.

let installed = false;

export function suppressExperimentalSqliteWarning(): void {
  if (installed) return;
  installed = true;

  const original = process.emitWarning.bind(process) as (
    warning: string | Error,
    ...args: unknown[]
  ) => void;

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes("SQLite is an experimental feature")) {
      return;
    }
    original(warning, ...args);
  }) as typeof process.emitWarning;
}
