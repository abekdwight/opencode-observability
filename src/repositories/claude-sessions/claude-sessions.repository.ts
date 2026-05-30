import fs from "node:fs";
import path from "node:path";
import { getClaudeProjectsDir } from "../../lib/config.js";

export interface ClaudeSessionFileRef {
  id: string;
  filePath: string;
  projectDir: string;
  mtimeMs: number;
}

const JSONL_SUFFIX = ".jsonl";

function listProjectDirNames(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Whether the Claude projects directory is present and readable.
 * Used to distinguish "no sessions yet" from "feature unavailable".
 */
export function claudeProjectsDirExists(): boolean {
  try {
    return fs.statSync(getClaudeProjectsDir()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Enumerate session transcript files across every project directory,
 * newest first (by file mtime), capped at {@link limit}.
 *
 * Claude Code stores one JSONL transcript per session at
 * `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. There is no
 * metadata index, so the file system is the source of truth.
 */
export function listClaudeSessionFiles(limit = 200): ClaudeSessionFileRef[] {
  const root = getClaudeProjectsDir();
  const refs: ClaudeSessionFileRef[] = [];

  for (const dirName of listProjectDirNames(root)) {
    const projectDir = path.join(root, dirName);
    let entries: string[];
    try {
      entries = fs.readdirSync(projectDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(JSONL_SUFFIX)) continue;
      const filePath = path.join(projectDir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        refs.push({
          id: entry.slice(0, -JSONL_SUFFIX.length),
          filePath,
          projectDir,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // Skip unreadable entries.
      }
    }
  }

  refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return refs.slice(0, limit);
}

/**
 * Locate a single session transcript by its id (the file's UUID stem).
 * Session UUIDs are globally unique, so the first match wins.
 */
export function findClaudeSessionFile(id: string): ClaudeSessionFileRef | null {
  // Guard against path traversal: ids are UUID-like stems only.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;

  const root = getClaudeProjectsDir();
  for (const dirName of listProjectDirNames(root)) {
    const projectDir = path.join(root, dirName);
    const filePath = path.join(projectDir, `${id}${JSONL_SUFFIX}`);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        return { id, filePath, projectDir, mtimeMs: stat.mtimeMs };
      }
    } catch {
      // Not in this project dir; keep looking.
    }
  }
  return null;
}
