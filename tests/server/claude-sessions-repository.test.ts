import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  findClaudeSessionFile,
  listClaudeSessionFiles,
  listClaudeSubagentSessionFiles,
} from "../../src/repositories/claude-sessions/claude-sessions.repository.js";

const tempDirs: string[] = [];
const originalClaudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR;

function makeProjectsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-projects-"));
  tempDirs.push(dir);
  process.env.CLAUDE_PROJECTS_DIR = dir;
  return dir;
}

afterEach(() => {
  if (originalClaudeProjectsDir === undefined) {
    delete process.env.CLAUDE_PROJECTS_DIR;
  } else {
    process.env.CLAUDE_PROJECTS_DIR = originalClaudeProjectsDir;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("claude sessions repository", () => {
  test("keeps subagent transcripts out of root listing and resolves them for detail links", () => {
    const projectsDir = makeProjectsDir();
    const projectDir = path.join(projectsDir, "project-a");
    const subagentsDir = path.join(projectDir, "parent-1", "subagents");
    fs.mkdirSync(subagentsDir, { recursive: true });

    fs.writeFileSync(path.join(projectDir, "parent-1.jsonl"), "{}\n");
    fs.writeFileSync(path.join(subagentsDir, "agent-child.jsonl"), "{}\n");
    fs.writeFileSync(
      path.join(subagentsDir, "agent-child.meta.json"),
      JSON.stringify({
        agentType: "Explore",
        description: "子調査",
        toolUseId: "tool-agent",
      }),
    );
    fs.writeFileSync(path.join(subagentsDir, "journal.jsonl"), "{}\n");

    expect(listClaudeSessionFiles().map((ref) => ref.id)).toEqual(["parent-1"]);

    const parent = findClaudeSessionFile("parent-1");
    expect(parent).toMatchObject({ id: "parent-1", parentId: null });
    if (!parent) throw new Error("parent session fixture was not found");
    expect(listClaudeSubagentSessionFiles(parent)).toMatchObject([
      {
        id: "agent-child",
        parentId: "parent-1",
        agentType: "Explore",
        description: "子調査",
        toolUseId: "tool-agent",
      },
    ]);
    expect(findClaudeSessionFile("agent-child")).toMatchObject({
      id: "agent-child",
      parentId: "parent-1",
    });
  });
});
