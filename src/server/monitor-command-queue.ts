import type { MonitorPromptCommandContract } from "../contracts/monitor-command.js";

const PROMPT_COMMAND_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_COMMANDS = 500;

let nextPromptCommandSequence = 0;
let promptCommands: MonitorPromptCommandContract[] = [];

function normalizeNonEmptyString(value: string): string {
  return value.trim();
}

function toNonEmptyStringSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeNonEmptyString).filter(Boolean));
}

function isFreshCommand(
  command: MonitorPromptCommandContract,
  referenceMs: number,
): boolean {
  const createdAtMs = Date.parse(command.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return referenceMs - createdAtMs <= PROMPT_COMMAND_TTL_MS;
}

function prunePromptCommands(referenceMs = Date.now()): void {
  promptCommands = promptCommands.filter((command) =>
    isFreshCommand(command, referenceMs),
  );
}

export function enqueueMonitorPromptCommand(
  sessionId: string,
  text: string,
): MonitorPromptCommandContract {
  prunePromptCommands();

  nextPromptCommandSequence += 1;
  const command: MonitorPromptCommandContract = {
    id: `prompt-${Date.now().toString(36)}-${nextPromptCommandSequence.toString(36)}`,
    sessionId: normalizeNonEmptyString(sessionId),
    text,
    createdAt: new Date().toISOString(),
  };

  promptCommands.push(command);
  if (promptCommands.length > MAX_PROMPT_COMMANDS) {
    promptCommands = promptCommands.slice(-MAX_PROMPT_COMMANDS);
  }

  return command;
}

export function drainMonitorPromptCommands(
  sessionIds: string[],
): MonitorPromptCommandContract[] {
  prunePromptCommands();

  const targetSessionIds = toNonEmptyStringSet(sessionIds);
  if (targetSessionIds.size === 0) {
    return [];
  }

  const drained: MonitorPromptCommandContract[] = [];
  const retained: MonitorPromptCommandContract[] = [];

  for (const command of promptCommands) {
    if (targetSessionIds.has(command.sessionId)) {
      drained.push(command);
      continue;
    }
    retained.push(command);
  }

  promptCommands = retained;
  return drained;
}

export function listMonitorPromptCommands(
  sessionIds?: string[],
): MonitorPromptCommandContract[] {
  prunePromptCommands();

  if (!sessionIds) {
    return [...promptCommands];
  }

  const targetSessionIds = toNonEmptyStringSet(sessionIds);
  if (targetSessionIds.size === 0) {
    return [];
  }

  return promptCommands.filter((command) =>
    targetSessionIds.has(command.sessionId),
  );
}

export function acknowledgeMonitorPromptCommands(commandIds: string[]): number {
  prunePromptCommands();

  const targetCommandIds = toNonEmptyStringSet(commandIds);
  if (targetCommandIds.size === 0) {
    return 0;
  }

  const beforeCount = promptCommands.length;
  promptCommands = promptCommands.filter(
    (command) => !targetCommandIds.has(command.id),
  );
  return beforeCount - promptCommands.length;
}

export function resetMonitorPromptCommandQueueForTest(): void {
  nextPromptCommandSequence = 0;
  promptCommands = [];
}
