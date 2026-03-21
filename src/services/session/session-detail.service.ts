import type { Database } from "better-sqlite3";
import type {
  SessionModelTokenBreakdown,
  SessionSubagentSummary,
} from "../../contracts/session.js";
import type { SignalLevel } from "../../contracts/shared.js";
import { calcSessionActiveDurations } from "../../lib/duration.js";
import {
  escapeHtml,
  formatDuration,
  prettifyPath,
} from "../../lib/text-format.js";
import {
  countSessionCompactionMessages,
  countSessionToolCalls,
  countSessionToolErrors,
  countSubagentSessions,
  getSessionRecord,
  getSessionTitleRecord,
  getSessionTokenStats,
  listChildSessionRecords,
  listSessionMessages,
  listSessionModelTokenBreakdown,
  listSessionRoleCounts,
  listSessionTitlesByIds,
  listSessionTodos,
  listSessionToolParts,
  type SessionMessageRecord,
  type SessionRecord,
  type SessionTodoRecord,
  type SessionTokenStatsRecord,
} from "../../repositories/session/session.repository.js";

export type ToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "unknown";

export interface ToolCallItem {
  tool: string;
  input: string;
  status: ToolStatus;
  error: string;
  fullInput: string;
  fullOutput: string;
  durationMs: number;
}

export interface SubagentInfo {
  id: string;
  title: string;
}

export interface SessionMessageSubagentLink extends SubagentInfo {
  durationMs: number;
}

export interface SessionMessageDetail {
  id: string;
  role: "user" | "assistant";
  text: string;
  model_id?: string;
  agent?: string;
  output_tps_label?: string;
  time_created: string | number;
  toolCalls: ToolCallItem[];
  subagentLinks: SessionMessageSubagentLink[];
}

export interface SessionRouteView {
  sessionInfo: SessionRecord;
  createdDate: string;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCallCount: number;
  subagentCount: number;
  tokenStats: SessionTokenStatsRecord;
  durationStr: string;
  parentInfo: { id: string; title: string } | null;
  messages: SessionViewMessage[];
  messageDetails: SessionMessageDetail[];
  messageToSubagentsMap: Map<string, SubagentInfo[]>;
  messageToolCalls: Map<string, ToolCallItem[]>;
  todos: SessionTodoRecord[];
  summaryDiffs: string | null;
  subagentDurations: Map<string, number>;
  safeSessionTitle: string;
  safeSessionIdForJs: string;
  safePrettyDirectory: string;
  costStr: string;
  fileChangesStr: string;
}

export interface SessionViewMessage extends SessionMessageRecord {
  output_tps_label?: string;
}

export interface SessionDetailSnapshot {
  sessionInfo: SessionRecord;
  tokens: SessionTokenStatsRecord;
  modelBreakdown: SessionModelTokenBreakdown[];
  compactions: {
    main: number;
    subagent: number;
    total: number;
  };
  subagents: SessionSubagentSummary[];
  toolErrorCount: number;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getSignalLevel(
  toolErrorCount: number,
  compactionCount: number,
): SignalLevel {
  if (toolErrorCount > 0) return "error";
  if (compactionCount > 0) return "warning";
  return "success";
}

function buildSessionModelBreakdown(
  db: Database,
  sessionId: string,
): SessionModelTokenBreakdown[] {
  return listSessionModelTokenBreakdown(db, sessionId).map((row) => ({
    modelId: row.model_id ?? "unknown",
    providerId: row.provider_id ?? "unknown",
    messageCount: asNumber(row.message_count),
    inputTokens: asNumber(row.input_tokens),
    outputTokens: asNumber(row.output_tokens),
    reasoningTokens: asNumber(row.reasoning_tokens),
    cacheReadTokens: asNumber(row.cache_read_tokens),
    cacheWriteTokens: asNumber(row.cache_write_tokens),
    totalTokens: asNumber(row.total_tokens),
    totalCost: asNumber(row.total_cost),
  }));
}

export function buildSessionDetailSnapshot(
  db: Database,
  sessionId: string,
): SessionDetailSnapshot | null {
  const sessionInfo = getSessionRecord(db, sessionId);
  if (!sessionInfo) return null;

  const tokens = getSessionTokenStats(db, sessionInfo.id);
  const modelBreakdown = buildSessionModelBreakdown(db, sessionInfo.id);
  const childSessions = listChildSessionRecords(db, sessionInfo.id);
  const childDurations = calcSessionActiveDurations(
    db,
    childSessions.map((child) => child.id),
  );
  const subagents = childSessions.map<SessionSubagentSummary>((child) => {
    const compactionCount = countSessionCompactionMessages(db, child.id);
    const toolErrorCount = countSessionToolErrors(db, child.id);

    return {
      id: child.id,
      title: child.title,
      updatedAt: toIso(child.time_updated),
      durationMs: Math.max(0, childDurations.get(child.id) ?? 0),
      compactionCount,
      signalLevel: getSignalLevel(toolErrorCount, compactionCount),
    };
  });

  const compactionsMain = countSessionCompactionMessages(db, sessionInfo.id);
  const compactionsSubagent = subagents.reduce(
    (sum, subagent) => sum + subagent.compactionCount,
    0,
  );

  return {
    sessionInfo,
    tokens,
    modelBreakdown,
    compactions: {
      main: compactionsMain,
      subagent: compactionsSubagent,
      total: compactionsMain + compactionsSubagent,
    },
    subagents,
    toolErrorCount: countSessionToolErrors(db, sessionInfo.id),
  };
}

function parseToolStatus(raw: unknown): ToolStatus {
  if (typeof raw !== "string") return "unknown";
  const normalized = raw.toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "completed" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return "unknown";
}

function parseToolError(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object" && "message" in raw) {
    const message = raw.message;
    if (typeof message === "string") return message.trim();
    if (typeof message === "number") return String(message);
  }
  return "";
}

function clampText(value: string, maxLen = 120): string {
  const normalized = value.trim();
  return normalized.length <= maxLen
    ? normalized
    : `${normalized.slice(0, maxLen)}...`;
}

function toNumberOrNull(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function calcOutputTps(
  outputTokensRaw: unknown,
  startedRaw: unknown,
  completedRaw: unknown,
): number | null {
  const outputTokens = toNumberOrNull(outputTokensRaw);
  const started = toNumberOrNull(startedRaw);
  const completed = toNumberOrNull(completedRaw);
  if (outputTokens == null || started == null || completed == null) return null;
  const durationMs = completed - started;
  if (outputTokens <= 0 || durationMs <= 0) return null;
  return (outputTokens * 1000) / durationMs;
}

function formatTps(value: number): string {
  if (value >= 100) return `${value.toFixed(0)} tok/s`;
  if (value >= 10) return `${value.toFixed(1)} tok/s`;
  return `${value.toFixed(2)} tok/s`;
}

function summarizeToolInput(
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return "";
  if (typeof input.filePath === "string")
    return input.filePath.split("/").slice(-2).join("/");
  if (typeof input.command === "string") return input.command.substring(0, 60);
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.url === "string") return input.url.substring(0, 60);
  if (typeof input.query === "string") return input.query.substring(0, 60);
  if (typeof input.prompt === "string") return input.prompt.substring(0, 50);
  if (typeof input.description === "string")
    return input.description.substring(0, 50);
  return "";
}

export function buildSessionRouteView(
  db: Database,
  sessionId: string,
): SessionRouteView | null {
  const sessionInfo = getSessionRecord(db, sessionId);
  if (!sessionInfo) return null;

  const createdDate = new Date(Number(sessionInfo.time_created)).toLocaleString(
    "ja-JP",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  const roleCounts = listSessionRoleCounts(db, sessionId);
  const roleCountMap = new Map(roleCounts.map((r) => [r.role, r.cnt]));
  const totalMessages = roleCounts.reduce((sum, r) => sum + r.cnt, 0);
  const userMessages = roleCountMap.get("user") || 0;
  const assistantMessages = roleCountMap.get("assistant") || 0;

  const toolCallCount = countSessionToolCalls(db, sessionId);
  const subagentCount = countSubagentSessions(db, sessionId);
  const tokenStats = getSessionTokenStats(db, sessionId);
  const activeDurations = calcSessionActiveDurations(db, [sessionId]);
  const durationMs = activeDurations.get(sessionId) || 0;
  const durationStr = formatDuration(durationMs);
  const parentInfo = sessionInfo.parent_id
    ? getSessionTitleRecord(db, sessionInfo.parent_id)
    : null;

  const messages = listSessionMessages(db, sessionId);
  const allToolParts = listSessionToolParts(db, sessionId);
  const todos = listSessionTodos(db, sessionId);

  const messageToSubagentIdsMap = new Map<string, string[]>();
  const messageToolCalls = new Map<string, ToolCallItem[]>();
  const subagentIds = new Set<string>();

  for (const { message_id, data } of allToolParts) {
    try {
      const parsedData = JSON.parse(data) as {
        type?: string;
        tool?: string;
        status?: unknown;
        error?: unknown;
        state?: {
          status?: unknown;
          error?: unknown;
          input?: Record<string, unknown>;
          output?: unknown;
          metadata?: { sessionId?: string };
          time?: { start?: number; end?: number };
        };
      };
      if (parsedData.type !== "tool") continue;

      const subagentSessionId = parsedData.state?.metadata?.sessionId;
      if (subagentSessionId) {
        subagentIds.add(subagentSessionId);
        const existing = messageToSubagentIdsMap.get(message_id) || [];
        if (!existing.includes(subagentSessionId)) {
          existing.push(subagentSessionId);
          messageToSubagentIdsMap.set(message_id, existing);
        }
      }

      const toolName =
        typeof parsedData.tool === "string" ? parsedData.tool : "unknown";
      const inputSummary = summarizeToolInput(parsedData.state?.input);
      const fullInput = parsedData.state?.input
        ? JSON.stringify(parsedData.state.input, null, 2)
        : "";
      const rawOutput = parsedData.state?.output;
      const fullOutput =
        rawOutput != null
          ? (typeof rawOutput === "string"
              ? rawOutput
              : JSON.stringify(rawOutput, null, 2)
            ).substring(0, 2000)
          : "";
      const timings = parsedData.state?.time;
      const toolDurationMs =
        timings?.start && timings?.end ? timings.end - timings.start : 0;

      const calls = messageToolCalls.get(message_id) || [];
      calls.push({
        tool: toolName,
        input: inputSummary,
        status: parseToolStatus(parsedData.state?.status ?? parsedData.status),
        error: clampText(
          parseToolError(parsedData.state?.error ?? parsedData.error),
        ),
        fullInput,
        fullOutput,
        durationMs: toolDurationMs,
      });
      messageToolCalls.set(message_id, calls);
    } catch {
      /* skip malformed tool rows */
    }
  }

  const subagentInfoRows = listSessionTitlesByIds(db, Array.from(subagentIds));
  const subagentInfoMap = new Map(
    subagentInfoRows.map((row) => [row.id, { id: row.id, title: row.title }]),
  );
  const subagentDurations = calcSessionActiveDurations(
    db,
    Array.from(subagentIds),
  );
  const messageToSubagentsMap = new Map<string, SubagentInfo[]>();
  for (const [messageId, ids] of messageToSubagentIdsMap) {
    const subagents = ids
      .map((id) => subagentInfoMap.get(id))
      .filter((item): item is SubagentInfo => item != null);
    if (subagents.length > 0) {
      messageToSubagentsMap.set(messageId, subagents);
    }
  }

  const viewMessages = messages.map<SessionViewMessage>((message) => {
    if (message.role !== "assistant") return message;
    const outputTps = calcOutputTps(
      message.output_tokens,
      message.response_started,
      message.response_completed,
    );
    if (outputTps == null) return message;
    return { ...message, output_tps_label: formatTps(outputTps) };
  });

  const messageDetails = viewMessages.map<SessionMessageDetail>((message) => {
    const subagentLinks = (messageToSubagentsMap.get(message.id) ?? []).map(
      (subagent) => ({
        id: subagent.id,
        title: subagent.title,
        durationMs: Math.max(0, subagentDurations.get(subagent.id) ?? 0),
      }),
    );

    return {
      id: message.id,
      role: message.role,
      text: message.text,
      model_id: message.model_id,
      agent: message.agent,
      output_tps_label: message.output_tps_label,
      time_created: message.time_created,
      toolCalls: messageToolCalls.get(message.id) ?? [],
      subagentLinks,
    };
  });

  const sessionTitle = sessionInfo.title;
  const safeSessionIdForJs = JSON.stringify(sessionInfo.id);
  const prettyDirectory = prettifyPath(sessionInfo.directory);
  const costStr =
    tokenStats.total_cost > 0
      ? `$${tokenStats.total_cost.toFixed(4)}`
      : "$0.00";
  const fileChangesStr =
    sessionInfo.summary_files > 0
      ? `${sessionInfo.summary_files} files (+${sessionInfo.summary_additions} -${sessionInfo.summary_deletions})`
      : "なし";

  return {
    sessionInfo,
    createdDate,
    totalMessages,
    userMessages,
    assistantMessages,
    toolCallCount,
    subagentCount,
    tokenStats,
    durationStr,
    parentInfo,
    messages: viewMessages,
    messageDetails,
    messageToSubagentsMap,
    messageToolCalls,
    todos,
    summaryDiffs: sessionInfo.summary_diffs,
    subagentDurations,
    safeSessionTitle: escapeHtml(sessionTitle),
    safeSessionIdForJs,
    safePrettyDirectory: escapeHtml(prettyDirectory),
    costStr,
    fileChangesStr,
  };
}
