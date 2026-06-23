import fs from "node:fs";
import type {
  HarnessDescriptorContract,
  HarnessSessionDetailContract,
  HarnessSessionSummaryContract,
} from "../../../contracts/harness.js";
import { isOperationalToolError } from "../../../contracts/question.js";
import type { SessionModelTokenBreakdown } from "../../../contracts/session.js";
import { calcActiveDurationFromTimeline } from "../../../lib/duration.js";
import {
  type ClaudeSessionFileRef,
  type ClaudeSubagentSessionFileRef,
  claudeProjectsDirExists,
  findClaudeSessionFile,
  listClaudeSessionFiles,
  listClaudeSubagentSessionFiles,
} from "../../../repositories/claude-sessions/claude-sessions.repository.js";
import {
  mergeModelTokenBreakdownRows,
  retargetModelTokenBreakdownRows,
  summarizeModelTokenBreakdown,
} from "../model-breakdown.js";
import type { HarnessAdapter, HarnessSessionList } from "../types.js";
import {
  attachClaudeSubagentLinks,
  buildClaudeMessages,
  type ClaudeTranscriptMeta,
  extractClaudeMeta,
  extractClaudeModelBreakdown,
  extractClaudeSubagentTranscriptDirs,
  extractClaudeTodos,
  extractClaudeUsageTotals,
  parseClaudeTranscript,
} from "./transcript-parser.js";

const descriptor: HarnessDescriptorContract = {
  id: "claude",
  label: "Claude Code",
  capabilities: {
    delete: false,
    livePrompt: false,
    resume: true,
  },
};

const UNTITLED = "無題のセッション";

function deriveTitle(meta: ClaudeTranscriptMeta): string {
  if (meta.title?.trim()) return meta.title.trim();
  if (meta.firstUserMessage.trim()) {
    const flat = meta.firstUserMessage.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
  }
  return UNTITLED;
}

function toSummary(
  ref: ClaudeSessionFileRef,
  meta: ClaudeTranscriptMeta,
): HarnessSessionSummaryContract {
  // Fall back to file mtime when the transcript carries no timestamps.
  const updatedAt =
    meta.updatedAt === new Date(0).toISOString()
      ? new Date(ref.mtimeMs).toISOString()
      : meta.updatedAt;

  return {
    harness: "claude",
    id: ref.id,
    title: deriveTitle(meta),
    directory: meta.cwd,
    gitBranch: meta.gitBranch,
    createdAt: meta.createdAt,
    updatedAt,
    model: meta.model,
    messageCount: meta.messageCount,
    totalTokens: meta.tokensUsed,
    subagentCount: null,
    detailAvailable: true,
  };
}

function toSubagentLink(
  ref: ClaudeSubagentSessionFileRef,
  meta: ClaudeTranscriptMeta | null,
): { id: string; title: string; durationMs: number } {
  const createdAtMs = meta ? Date.parse(meta.createdAt) : Number.NaN;
  const updatedAtMs = meta ? Date.parse(meta.updatedAt) : Number.NaN;
  const durationMs =
    Number.isFinite(createdAtMs) && Number.isFinite(updatedAtMs)
      ? Math.max(0, updatedAtMs - createdAtMs)
      : 0;

  return {
    id: ref.id,
    title:
      ref.description?.trim() ||
      ref.agentType?.trim() ||
      (meta ? deriveTitle(meta) : ref.id),
    durationMs,
  };
}

function readClaudeTranscript(
  ref: ClaudeSessionFileRef,
): ReturnType<typeof parseClaudeTranscript> | null {
  try {
    const content = fs.readFileSync(ref.filePath, "utf-8");
    return parseClaudeTranscript(content);
  } catch {
    return null;
  }
}

interface ClaudeSubagentDetail {
  ref: ClaudeSubagentSessionFileRef;
  parsed: ReturnType<typeof parseClaudeTranscript> | null;
  meta: ClaudeTranscriptMeta | null;
}

function loadClaudeSubagentDetails(
  parentRef: ClaudeSessionFileRef,
): ClaudeSubagentDetail[] {
  return listClaudeSubagentSessionFiles(parentRef).map((ref) => {
    const parsed = readClaudeTranscript(ref);
    return {
      ref,
      parsed,
      meta:
        parsed && parsed.records.length > 0
          ? extractClaudeMeta(parsed.records)
          : null,
    };
  });
}

function findWorkflowToolUseId(
  ref: ClaudeSubagentSessionFileRef,
  transcriptDirToolUseIds: Map<string, string>,
): string | null {
  let best: { dir: string; toolUseId: string } | null = null;
  for (const [dir, toolUseId] of transcriptDirToolUseIds) {
    if (!ref.filePath.startsWith(dir)) continue;
    if (!best || dir.length > best.dir.length) {
      best = { dir, toolUseId };
    }
  }
  return best?.toolUseId ?? null;
}

function buildClaudeSubagentLinkMap(
  parentRecords: ReturnType<typeof parseClaudeTranscript>["records"],
  subagents: ClaudeSubagentDetail[],
): Map<string, Array<{ id: string; title: string; durationMs: number }>> {
  const transcriptDirToolUseIds =
    extractClaudeSubagentTranscriptDirs(parentRecords);
  const linksByToolUseId = new Map<
    string,
    Array<{ id: string; title: string; durationMs: number }>
  >();

  for (const { ref, meta } of subagents) {
    const toolUseId =
      ref.toolUseId ?? findWorkflowToolUseId(ref, transcriptDirToolUseIds);
    if (!toolUseId) continue;

    const links = linksByToolUseId.get(toolUseId) ?? [];
    links.push(toSubagentLink(ref, meta));
    linksByToolUseId.set(toolUseId, links);
  }

  return linksByToolUseId;
}

function claudeSubagentAgentName(ref: ClaudeSubagentSessionFileRef): string {
  return ref.agentType?.trim() || ref.description?.trim() || "subagent";
}

function buildClaudeChildModelBreakdown(
  subagents: ClaudeSubagentDetail[],
): SessionModelTokenBreakdown[] {
  const rows: SessionModelTokenBreakdown[] = [];
  for (const { ref, parsed } of subagents) {
    if (!parsed) continue;
    rows.push(
      ...retargetModelTokenBreakdownRows(
        extractClaudeModelBreakdown(parsed.records),
        {
          scope: "subagent",
          agent: claudeSubagentAgentName(ref),
        },
      ),
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Summary cache — transcripts are parsed in full to derive list metadata,
// which is expensive across hundreds of files. Keyed by path + mtime so an
// unchanged file is never re-read.
// ---------------------------------------------------------------------------

interface SummaryCacheEntry {
  mtimeMs: number;
  summary: HarnessSessionSummaryContract;
}

const summaryCache = new Map<string, SummaryCacheEntry>();
const SUMMARY_CACHE_MAX = 1000;

function readSummary(
  ref: ClaudeSessionFileRef,
): HarnessSessionSummaryContract | null {
  const cached = summaryCache.get(ref.filePath);
  if (cached && cached.mtimeMs === ref.mtimeMs) return cached.summary;

  let content: string;
  try {
    content = fs.readFileSync(ref.filePath, "utf-8");
  } catch {
    return null;
  }
  const { records } = parseClaudeTranscript(content);
  if (records.length === 0) return null;
  const summary = toSummary(ref, extractClaudeMeta(records));

  if (summaryCache.size >= SUMMARY_CACHE_MAX) {
    const oldest = summaryCache.keys().next().value;
    if (oldest !== undefined) summaryCache.delete(oldest);
  }
  summaryCache.set(ref.filePath, { mtimeMs: ref.mtimeMs, summary });
  return summary;
}

function listSessions(): HarnessSessionList {
  if (!claudeProjectsDirExists()) {
    return {
      source: { available: false, reason: "missing-directory" },
      sessions: [],
    };
  }

  const sessions: HarnessSessionSummaryContract[] = [];
  for (const ref of listClaudeSessionFiles()) {
    const summary = readSummary(ref);
    if (summary) sessions.push(summary);
  }

  return { source: { available: true, reason: "ok" }, sessions };
}

function getSessionDetail(id: string): HarnessSessionDetailContract | null {
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
  const summary = toSummary(ref, meta);
  const messageOptions = { includeThinking: true };
  const messages = buildClaudeMessages(records, messageOptions);
  const subagentDetails = loadClaudeSubagentDetails(ref);
  attachClaudeSubagentLinks(
    records,
    messages,
    buildClaudeSubagentLinkMap(records, subagentDetails),
    messageOptions,
  );
  const usage = extractClaudeUsageTotals(records);
  const modelBreakdown = mergeModelTokenBreakdownRows([
    ...extractClaudeModelBreakdown(records),
    ...buildClaudeChildModelBreakdown(subagentDetails),
  ]);
  const todos = extractClaudeTodos(records);

  const durationMs = calcActiveDurationFromTimeline(
    messages.map((message) => ({
      role: message.role,
      timestampMs: Date.parse(message.createdAt),
    })),
  );

  const toolErrorCount = messages
    .flatMap((message) => message.toolCalls)
    .filter(isOperationalToolError).length;

  return {
    kind: "harness.session.detail",
    generatedAt: new Date().toISOString(),
    harness: descriptor,
    source: { ok: true, parseWarningCount },
    durationMs,
    session: {
      id: ref.id,
      title: summary.title,
      directory: meta.cwd,
      gitBranch: meta.gitBranch,
      parentId: ref.parentId,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      summary: null,
    },
    models: [...new Set(modelBreakdown.map((row) => row.modelId))],
    tokens:
      modelBreakdown.length > 0
        ? summarizeModelTokenBreakdown(modelBreakdown, {
            reasoning: false,
            cacheRead: true,
            cacheWrite: true,
            cost: false,
          })
        : {
            total: usage.total,
            input: usage.input,
            output: usage.output,
            reasoning: null,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            cost: null,
          },
    modelBreakdown,
    compactions: null,
    subagents: null,
    signalBadges: [
      {
        key: "tool-errors",
        label: "Tool errors",
        level: toolErrorCount > 0 ? "error" : "success",
        count: toolErrorCount,
      },
    ],
    messages,
    toolEvents: null,
    todos,
    summaryDiffs: null,
  };
}

export const claudeAdapter: HarnessAdapter = {
  descriptor,
  listSessions,
  getSessionDetail,
};
