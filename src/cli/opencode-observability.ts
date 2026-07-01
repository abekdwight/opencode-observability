#!/usr/bin/env node

import { startObservabilityServer } from "../server/start.js";
import { runMonitorHook } from "./monitor-hook.js";

const [command, harness] = process.argv.slice(2);

if (command === "hook") {
  if (harness !== "codex" && harness !== "claude") {
    console.error("Usage: opencode-observability hook <codex|claude>");
    process.exit(2);
  }

  process.exitCode = await runMonitorHook(harness);
} else {
  startObservabilityServer();
}
