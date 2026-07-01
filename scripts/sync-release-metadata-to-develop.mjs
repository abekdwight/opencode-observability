#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEASE_VERSION_MARKER = ".semantic-release-next-version";
const RELEASE_FILES = [
  "package.json",
  "package-lock.json",
  "plugins/codex/.codex-plugin/plugin.json",
  "plugins/claude-code/.claude-plugin/plugin.json",
];
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function runInherited(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function replaceVersionOccurrences(filePath, version, expectedCount) {
  let replacementCount = 0;
  const content = fs.readFileSync(filePath, "utf8");
  const nextContent = content.replace(/"version":\s*"[^"]+"/gu, (matched) => {
    if (replacementCount >= expectedCount) {
      return matched;
    }
    replacementCount += 1;
    return `"version": "${version}"`;
  });

  if (replacementCount !== expectedCount) {
    throw new Error(
      `Expected to update ${expectedCount} version field(s) in ${filePath}, updated ${replacementCount}.`,
    );
  }

  fs.writeFileSync(filePath, nextContent, "utf8");
}

function syncJsonVersion(filePath, logicalPath, version) {
  replaceVersionOccurrences(
    filePath,
    version,
    logicalPath === "package-lock.json" ? 2 : 1,
  );

  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (json.version !== version) {
    throw new Error(`${logicalPath} top-level version did not update.`);
  }
  if (
    logicalPath === "package-lock.json" &&
    json.packages?.[""]?.version !== version
  ) {
    throw new Error("package-lock.json root package version did not update.");
  }
}

function ensureGitIdentity(cwd) {
  runInherited(
    "git",
    [
      "config",
      "user.name",
      process.env.GIT_AUTHOR_NAME || "github-actions[bot]",
    ],
    { cwd },
  );
  runInherited(
    "git",
    [
      "config",
      "user.email",
      process.env.GIT_AUTHOR_EMAIL ||
        "41898282+github-actions[bot]@users.noreply.github.com",
    ],
    { cwd },
  );
}

function main() {
  if (!fs.existsSync(RELEASE_VERSION_MARKER)) {
    console.log(
      "No semantic-release version marker found; skipping develop sync.",
    );
    return;
  }

  const version = fs.readFileSync(RELEASE_VERSION_MARKER, "utf8").trim();
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(
      `Invalid release version marker: ${JSON.stringify(version)}`,
    );
  }

  runInherited("git", ["fetch", "origin", "develop"]);
  const worktreePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencode-release-develop-"),
  );
  let worktreeAdded = false;

  try {
    runInherited("git", [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      "origin/develop",
    ]);
    worktreeAdded = true;
    ensureGitIdentity(worktreePath);

    for (const filePath of RELEASE_FILES) {
      syncJsonVersion(path.join(worktreePath, filePath), filePath, version);
    }

    runInherited("git", ["add", ...RELEASE_FILES], { cwd: worktreePath });
    try {
      run("git", ["diff", "--cached", "--quiet"], { cwd: worktreePath });
      console.log(`Develop already has release metadata for ${version}.`);
      return;
    } catch {
      // git diff --quiet exits with 1 when there are staged changes.
    }

    runInherited(
      "git",
      [
        "commit",
        "-m",
        `chore(release): sync package metadata to v${version} [skip ci]`,
      ],
      { cwd: worktreePath },
    );
    runInherited("git", ["push", "origin", "HEAD:develop"], {
      cwd: worktreePath,
    });
    console.log(`Synced release metadata for ${version} back to develop.`);
  } finally {
    if (worktreeAdded) {
      try {
        runInherited("git", ["worktree", "remove", "--force", worktreePath]);
      } catch (error) {
        console.warn(
          `Failed to remove temporary worktree ${worktreePath}: ${String(
            error,
          )}`,
        );
      }
    }
  }
}

main();
