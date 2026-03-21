import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function candidateDistDirectories(metaUrl: string): string[] {
  const fromEnv =
    process.env.OPENCODE_OBSERVABILITY_APP_DIST_DIR?.trim() ||
    process.env.OPENCODE_TELEMETRY_APP_DIST_DIR?.trim();
  const moduleDir = path.dirname(fileURLToPath(metaUrl));
  return unique(
    [
      fromEnv,
      path.resolve(moduleDir, "../../app"),
      path.resolve(moduleDir, "../../dist/app"),
      path.resolve(process.cwd(), "dist/app"),
    ].filter((value): value is string => Boolean(value && value.length > 0)),
  );
}

export function resolveAppDistDir(metaUrl: string): string {
  const candidates = candidateDistDirectories(metaUrl);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), "dist/app");
}

export function resolveAppIndexPath(metaUrl: string): string {
  return path.join(resolveAppDistDir(metaUrl), "index.html");
}
