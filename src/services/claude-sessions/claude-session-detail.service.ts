import fs from "node:fs";
import type { ClaudeSessionSummaryContract } from "../../contracts/claude-sessions.js";
import type { SessionMessageContract } from "../../contracts/session.js";
import { findClaudeSessionFile } from "../../repositories/claude-sessions/claude-sessions.repository.js";
import { mapClaudeMetaToSummary } from "./claude-session-list.service.js";
import {
  buildClaudeMessages,
  extractClaudeMeta,
  parseClaudeTranscript,
} from "./claude-transcript-parser.js";

export interface ClaudeSessionDetailView {
  session: ClaudeSessionSummaryContract;
  transcript: {
    exists: boolean;
    parseWarningCount: number;
  };
  messages: SessionMessageContract[];
}

export function buildClaudeSessionDetailView(
  id: string,
): ClaudeSessionDetailView | null {
  const ref = findClaudeSessionFile(id);
  if (!ref) return null;

  let content: string;
  try {
    content = fs.readFileSync(ref.filePath, "utf-8");
  } catch {
    return null;
  }

  const { records, parseWarningCount } = parseClaudeTranscript(content);
  const meta = extractClaudeMeta(records);
  const session = mapClaudeMetaToSummary(ref, meta, true);
  const messages = buildClaudeMessages(records, { includeThinking: true });

  return {
    session,
    transcript: { exists: true, parseWarningCount },
    messages,
  };
}
