import fs from "node:fs";
import path from "node:path";
import { getClaudeProjectsDir } from "../../lib/config.js";

export interface ClaudeSessionFileRef {
  id: string;
  filePath: string;
  projectDir: string;
  mtimeMs: number;
  parentId: string | null;
}

export interface ClaudeSubagentSessionFileRef extends ClaudeSessionFileRef {
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
}

const JSONL_SUFFIX = ".jsonl";
const META_SUFFIX = ".meta.json";

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

function toRef(
  filePath: string,
  projectDir: string,
  parentId: string | null,
): ClaudeSessionFileRef | null {
  const entry = path.basename(filePath);
  if (!entry.endsWith(JSONL_SUFFIX)) return null;

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return {
      id: entry.slice(0, -JSONL_SUFFIX.length),
      filePath,
      projectDir,
      mtimeMs: stat.mtimeMs,
      parentId,
    };
  } catch {
    return null;
  }
}

function readSubagentMeta(
  filePath: string,
): Pick<
  ClaudeSubagentSessionFileRef,
  "agentType" | "description" | "toolUseId"
> {
  const metaPath = filePath.slice(0, -JSONL_SUFFIX.length) + META_SUFFIX;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { agentType: null, description: null, toolUseId: null };
    }
    const meta = parsed as Record<string, unknown>;
    return {
      agentType: typeof meta.agentType === "string" ? meta.agentType : null,
      description:
        typeof meta.description === "string" ? meta.description : null,
      toolUseId: typeof meta.toolUseId === "string" ? meta.toolUseId : null,
    };
  } catch {
    return { agentType: null, description: null, toolUseId: null };
  }
}

function toSubagentRef(
  filePath: string,
  projectDir: string,
  parentId: string,
): ClaudeSubagentSessionFileRef | null {
  const ref = toRef(filePath, projectDir, parentId);
  if (!ref || ref.id === "journal") return null;
  return { ...ref, ...readSubagentMeta(filePath) };
}

function listJsonlRefsRecursively(
  dir: string,
  projectDir: string,
  parentId: string,
): ClaudeSubagentSessionFileRef[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const refs: ClaudeSubagentSessionFileRef[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      refs.push(...listJsonlRefsRecursively(filePath, projectDir, parentId));
      continue;
    }
    const ref = toSubagentRef(filePath, projectDir, parentId);
    if (ref) refs.push(ref);
  }
  return refs;
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
      const ref = toRef(filePath, projectDir, null);
      if (ref) refs.push(ref);
    }
  }

  refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return refs.slice(0, limit);
}

export function listClaudeSubagentSessionFiles(
  parentRef: ClaudeSessionFileRef,
): ClaudeSubagentSessionFileRef[] {
  const subagentsDir = path.join(
    parentRef.projectDir,
    parentRef.id,
    "subagents",
  );
  const refs = listJsonlRefsRecursively(
    subagentsDir,
    parentRef.projectDir,
    parentRef.id,
  );
  refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return refs;
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
        return {
          id,
          filePath,
          projectDir,
          mtimeMs: stat.mtimeMs,
          parentId: null,
        };
      }
    } catch {
      // Not in this project dir; keep looking.
    }

    let parentEntries: fs.Dirent[];
    try {
      parentEntries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of parentEntries) {
      if (!entry.isDirectory()) continue;
      const subagentsDir = path.join(projectDir, entry.name, "subagents");
      const found = listJsonlRefsRecursively(
        subagentsDir,
        projectDir,
        entry.name,
      ).find((ref) => ref.id === id);
      if (found) return found;
    }
  }
  return null;
}
