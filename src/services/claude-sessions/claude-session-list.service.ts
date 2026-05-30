import fs from "node:fs";
import type { ClaudeSessionSummaryContract } from "../../contracts/claude-sessions.js";
import {
  type ClaudeSessionFileRef,
  claudeProjectsDirExists,
  listClaudeSessionFiles,
} from "../../repositories/claude-sessions/claude-sessions.repository.js";
import {
  type ClaudeTranscriptMeta,
  extractClaudeMeta,
  parseClaudeTranscript,
} from "./claude-transcript-parser.js";

export interface ClaudeSessionsView {
  source: {
    available: boolean;
    reason: "ok" | "missing-directory";
  };
  sessions: ClaudeSessionSummaryContract[];
}

const UNTITLED = "無題のセッション";

function deriveTitle(meta: ClaudeTranscriptMeta): string {
  if (meta.title && meta.title.trim()) return meta.title.trim();
  if (meta.firstUserMessage.trim()) {
    const flat = meta.firstUserMessage.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
  }
  return UNTITLED;
}

export function mapClaudeMetaToSummary(
  ref: ClaudeSessionFileRef,
  meta: ClaudeTranscriptMeta,
  transcriptExists: boolean,
): ClaudeSessionSummaryContract {
  const preview = meta.firstUserMessage.replace(/\s+/g, " ").trim();
  // Fall back to file mtime when the transcript carries no timestamps.
  const updatedAt =
    meta.updatedAt === new Date(0).toISOString()
      ? new Date(ref.mtimeMs).toISOString()
      : meta.updatedAt;

  return {
    id: ref.id,
    title: deriveTitle(meta),
    cwd: meta.cwd,
    gitBranch: meta.gitBranch,
    createdAt: meta.createdAt,
    updatedAt,
    model: meta.model,
    tokensUsed: meta.tokensUsed,
    messageCount: meta.messageCount,
    firstUserMessage: meta.firstUserMessage,
    preview: preview.length > 160 ? `${preview.slice(0, 159)}…` : preview,
    transcriptExists,
  };
}

export function buildClaudeSessionsView(): ClaudeSessionsView {
  if (!claudeProjectsDirExists()) {
    return {
      source: { available: false, reason: "missing-directory" },
      sessions: [],
    };
  }

  const sessions: ClaudeSessionSummaryContract[] = [];
  for (const ref of listClaudeSessionFiles()) {
    let content: string;
    try {
      content = fs.readFileSync(ref.filePath, "utf-8");
    } catch {
      continue;
    }
    const { records } = parseClaudeTranscript(content);
    if (records.length === 0) continue;
    const meta = extractClaudeMeta(records);
    sessions.push(mapClaudeMetaToSummary(ref, meta, true));
  }

  return {
    source: { available: true, reason: "ok" },
    sessions,
  };
}
