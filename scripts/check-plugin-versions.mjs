#!/usr/bin/env node

import fs from "node:fs";

const PLUGINS = [
  {
    name: "codex",
    manifest: "plugins/codex/.codex-plugin/plugin.json",
  },
  {
    name: "claude-code",
    manifest: "plugins/claude-code/.claude-plugin/plugin.json",
  },
];

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const RELEASE_SYNC_PLUGIN =
  "./scripts/semantic-release-plugin-version-sync.mjs";
const RELEASE_GIT_PLUGIN = "@semantic-release/git";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function releasePluginName(pluginEntry) {
  return Array.isArray(pluginEntry) ? pluginEntry[0] : pluginEntry;
}

function releasePluginConfig(pluginEntry) {
  return Array.isArray(pluginEntry) ? (pluginEntry[1] ?? {}) : {};
}

function ensurePluginVersionsAreAligned() {
  const versions = new Map();

  for (const plugin of PLUGINS) {
    const manifest = readJson(plugin.manifest);
    const version = String(manifest.version ?? "");
    if (!SEMVER_PATTERN.test(version)) {
      fail(
        `${plugin.manifest} version must be a valid semver string, got ${JSON.stringify(
          version,
        )}`,
      );
    }
    versions.set(plugin.name, version);
  }

  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size > 1) {
    fail(
      `Plugin manifest versions must stay aligned: ${Array.from(
        versions.entries(),
      )
        .map(([name, version]) => `${name}=${version}`)
        .join(", ")}`,
    );
  }
}

function ensureReleaseSyncIsConfigured() {
  const releaseConfig = readJson(".releaserc.json");
  const plugins = releaseConfig.plugins ?? [];

  if (
    !plugins.some((plugin) => releasePluginName(plugin) === RELEASE_SYNC_PLUGIN)
  ) {
    fail(
      `.releaserc.json must include ${RELEASE_SYNC_PLUGIN} so semantic-release owns plugin manifest versions.`,
    );
  }

  const gitPlugin = plugins.find(
    (plugin) => releasePluginName(plugin) === RELEASE_GIT_PLUGIN,
  );
  if (!gitPlugin) {
    fail(
      `.releaserc.json must include ${RELEASE_GIT_PLUGIN} so synchronized plugin manifests are committed.`,
    );
    return;
  }

  const assets = releasePluginConfig(gitPlugin).assets ?? [];
  for (const plugin of PLUGINS) {
    if (!assets.includes(plugin.manifest)) {
      fail(
        `.releaserc.json ${RELEASE_GIT_PLUGIN} assets must include ${plugin.manifest}.`,
      );
    }
  }
}

ensurePluginVersionsAreAligned();
ensureReleaseSyncIsConfigured();
