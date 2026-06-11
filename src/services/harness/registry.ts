import type { HarnessId } from "../../contracts/harness.js";
import { claudeAdapter } from "./claude/adapter.js";
import { codexAdapter } from "./codex/adapter.js";
import { opencodeAdapter } from "./opencode/adapter.js";
import type { HarnessAdapter } from "./types.js";

const adapters: Record<HarnessId, HarnessAdapter> = {
  opencode: opencodeAdapter,
  codex: codexAdapter,
  claude: claudeAdapter,
};

export function getHarnessAdapter(id: HarnessId): HarnessAdapter {
  return adapters[id];
}

export function listHarnessAdapters(): HarnessAdapter[] {
  return Object.values(adapters);
}
