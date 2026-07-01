import fs from "node:fs";

const PLUGIN_MANIFESTS = [
  "plugins/codex/.codex-plugin/plugin.json",
  "plugins/claude-code/.claude-plugin/plugin.json",
];
const RELEASE_VERSION_MARKER = ".semantic-release-next-version";

export async function prepare(_pluginConfig, context) {
  const version = context.nextRelease?.version;
  if (!version) {
    throw new Error("semantic-release did not provide nextRelease.version");
  }

  for (const manifestPath of PLUGIN_MANIFESTS) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = version;
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  fs.writeFileSync(RELEASE_VERSION_MARKER, `${version}\n`, "utf8");

  context.logger.log(
    `Synchronized plugin manifest versions to ${version}: ${PLUGIN_MANIFESTS.join(
      ", ",
    )}`,
  );
}
