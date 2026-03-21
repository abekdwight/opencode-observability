import { execFileSync } from "node:child_process";
import path from "node:path";

const repoRootCache = new Map<string, string>();

export function resolveCanonicalRepoRoot(worktreePath: string): string {
  if (!worktreePath) return worktreePath;
  if (repoRootCache.has(worktreePath))
    return repoRootCache.get(worktreePath) as string;

  let canonical = worktreePath;
  try {
    const commonDir = execFileSync(
      "git",
      [
        "-C",
        worktreePath,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (commonDir) {
      const root = path.dirname(commonDir);
      if (root) canonical = root;
    }
  } catch {
    // Fallback to original path on failure or non-git directories.
  }

  repoRootCache.set(worktreePath, canonical);
  return canonical;
}

export function resolveRepoBucketKey(
  worktreePath: string,
  directoryPath: string,
): string {
  if (worktreePath === "/") {
    return directoryPath || worktreePath;
  }

  return resolveCanonicalRepoRoot(worktreePath || directoryPath);
}
