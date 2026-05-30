import fs from "node:fs";
import type { SessionMessageContract } from "../../contracts/session.js";
import type {
  CodexSessionSummaryContract,
} from "../../contracts/codex-sessions.js";
import { getCodexDb } from "../../lib/codex-db.js";
import { getCodexThread } from "../../repositories/codex-sessions/codex-sessions.repository.js";
import { mapCodexThreadToSummary } from "./codex-session-list.service.js";
import { parseCodexRolloutContent } from "./codex-rollout-parser.js";

export interface CodexSessionDetailView {
  session: CodexSessionSummaryContract;
  rollout: {
    exists: boolean;
    parseWarningCount: number;
  };
  messages: SessionMessageContract[];
}

function roundsToMessages(
  rounds: ReturnType<typeof parseCodexRolloutContent>["rounds"],
): SessionMessageContract[] {
  const messages: SessionMessageContract[] = [];
  for (const round of rounds) {
    for (const um of round.userMessages) {
      messages.push({
        role: um.role,
        text: um.text,
        createdAt: um.createdAt,
        modelId: null,
        agent: null,
        outputTpsLabel: null,
        toolCalls: [],
        subagentLinks: [],
        fileDiffs: [],
      });
    }
    for (const am of round.assistantMessages) {
      messages.push({
        role: am.role,
        text: am.text,
        createdAt: am.createdAt,
        modelId: null,
        agent: null,
        outputTpsLabel: null,
        toolCalls: [],
        subagentLinks: [],
        fileDiffs: [],
      });
    }
  }
  return messages;
}

export function buildCodexSessionDetailView(
  id: string,
): CodexSessionDetailView | null {
  let db: ReturnType<typeof getCodexDb>;
  try {
    db = getCodexDb();
  } catch {
    return null;
  }

  try {
    const thread = getCodexThread(db, id);
    if (!thread) return null;

    const session = mapCodexThreadToSummary(thread);
    let content: string;
    try {
      content = fs.readFileSync(thread.rollout_path, "utf-8");
    } catch {
      return {
        session: { ...session, rolloutExists: false },
        rollout: { exists: false, parseWarningCount: 0 },
        messages: [],
      };
    }

    const parsed = parseCodexRolloutContent(content);
    return {
      session: { ...session, rolloutExists: true },
      rollout: { exists: true, parseWarningCount: parsed.parseWarningCount },
      messages: roundsToMessages(parsed.rounds),
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}
