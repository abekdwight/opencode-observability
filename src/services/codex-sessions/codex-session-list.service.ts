import fs from "node:fs";
import type { CodexSessionSummaryContract } from "../../contracts/codex-sessions.js";
import { getCodexDb } from "../../lib/codex-db.js";
import {
  listCodexThreads,
  type CodexThreadRecord,
} from "../../repositories/codex-sessions/codex-sessions.repository.js";

export interface CodexSessionsView {
  source: {
    available: boolean;
    reason: "ok" | "missing-database";
  };
  sessions: CodexSessionSummaryContract[];
}

export function toIsoTimestamp(value: number): string {
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function mapCodexThreadToSummary(
  thread: CodexThreadRecord,
): CodexSessionSummaryContract {
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd,
    createdAt: toIsoTimestamp(thread.created_at),
    updatedAt: toIsoTimestamp(thread.updated_at),
    model: thread.model,
    tokensUsed: thread.tokens_used,
    firstUserMessage: thread.first_user_message,
    preview: thread.preview,
    cliVersion: thread.cli_version,
    agentNickname: thread.agent_nickname,
    agentRole: thread.agent_role,
    rolloutExists: fileExists(thread.rollout_path),
  };
}

export function buildCodexSessionsView(): CodexSessionsView {
  let db: ReturnType<typeof getCodexDb>;
  try {
    db = getCodexDb();
  } catch {
    return {
      source: { available: false, reason: "missing-database" },
      sessions: [],
    };
  }

  try {
    return {
      source: { available: true, reason: "ok" },
      sessions: listCodexThreads(db).map(mapCodexThreadToSummary),
    };
  } catch {
    return {
      source: { available: false, reason: "missing-database" },
      sessions: [],
    };
  } finally {
    db.close();
  }
}
