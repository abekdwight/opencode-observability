import {
  QUESTION_TOOL,
  questionToPlainText,
} from "../../../contracts/question.js";
import type {
  SessionMessageContract,
  SessionMessageSubagentLinkContract,
  SessionModelTokenBreakdown,
  SessionQuestionContract,
  SessionQuestionItemContract,
  SessionTodoContract,
  SessionToolCallContract,
} from "../../../contracts/session.js";

// ---------------------------------------------------------------------------
// Claude Code transcript parser
//
// A transcript is a JSONL log at ~/.claude/projects/<encoded-cwd>/<id>.jsonl.
// Record types used: "user", "assistant" (message.content block arrays),
// "ai-title" (generated title). Assistant content blocks: text, thinking,
// tool_use; user messages carry tool_result blocks. Subagent (sidechain)
// turns live in the same file flagged with isSidechain=true.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTimestamp(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date(0).toISOString();
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

/**
 * Flatten a content value (string, or array of {type:"text",text} / raw
 * strings) into plain text. Used for both message bodies and tool_result
 * payloads, which Claude encodes either way depending on the tool.
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const chunks: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      chunks.push(block);
    } else if (isObject(block) && typeof block.text === "string") {
      chunks.push(block.text);
    }
  }
  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Record parsing
// ---------------------------------------------------------------------------

export interface ClaudeRecord {
  type: string;
  raw: Record<string, unknown>;
}

export interface ParsedClaudeTranscript {
  records: ClaudeRecord[];
  parseWarningCount: number;
}

export function parseClaudeTranscript(content: string): ParsedClaudeTranscript {
  const records: ClaudeRecord[] = [];
  let parseWarningCount = 0;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed) as unknown;
    } catch {
      parseWarningCount += 1;
      continue;
    }
    if (!isObject(row) || typeof row.type !== "string") continue;
    records.push({ type: row.type, raw: row });
  }

  return { records, parseWarningCount };
}

// ---------------------------------------------------------------------------
// Tool call resolution
// ---------------------------------------------------------------------------

interface ToolResult {
  output: string;
  isError: boolean;
  /**
   * The structured result Claude attaches at the user RECORD root (sibling of
   * `message`). For AskUserQuestion this carries the selected answers keyed by
   * question text; null for tools that have no structured result.
   */
  toolUseResult: Record<string, unknown> | null;
}

/** Map tool_use_id → its result, scanned from user tool_result blocks. */
function buildToolResultMap(records: ClaudeRecord[]): Map<string, ToolResult> {
  const map = new Map<string, ToolResult>();
  for (const record of records) {
    if (record.type !== "user") continue;
    const message = record.raw.message;
    if (!isObject(message) || !Array.isArray(message.content)) continue;
    // toolUseResult sits beside `message` at the record root and applies to the
    // tool_use this record answers (one tool_result block per such record).
    const toolUseResult = isObject(record.raw.toolUseResult)
      ? record.raw.toolUseResult
      : null;
    for (const block of message.content) {
      if (!isObject(block) || block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;
      map.set(block.tool_use_id, {
        output: contentToText(block.content),
        isError: block.is_error === true,
        toolUseResult,
      });
    }
  }
  return map;
}

/** Build a short one-line label for a tool call's collapsed row. */
function summarizeToolInput(input: unknown): string {
  if (typeof input === "string") return truncate(input, 120);
  if (!isObject(input)) return "";
  const preferredKeys = [
    "command",
    "file_path",
    "filePath",
    "path",
    "pattern",
    "query",
    "url",
    "description",
    "prompt",
  ];
  for (const key of preferredKeys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return truncate(value, 120);
    }
  }
  return truncate(safeJson(input), 120);
}

/**
 * An answer value in `toolUseResult.answers` is either a single selected label
 * (string) or several (array). Normalize both to a string array; a missing
 * value (unanswered) yields an empty array.
 */
function toAnswerArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

/**
 * Build the structured question payload for a Claude `AskUserQuestion` call.
 * The selected answers come from the record-level `toolUseResult.answers` map
 * (keyed by question text), NOT from the tool_result prose.
 */
function buildAskUserQuestion(
  input: unknown,
  toolUseResult: Record<string, unknown> | null,
): SessionQuestionContract {
  const rawQuestions =
    isObject(input) && Array.isArray(input.questions) ? input.questions : [];
  const answers =
    toolUseResult && isObject(toolUseResult.answers)
      ? toolUseResult.answers
      : {};
  const questions: SessionQuestionItemContract[] = [];
  for (const raw of rawQuestions) {
    if (!isObject(raw)) continue;
    const questionText = typeof raw.question === "string" ? raw.question : "";
    questions.push({
      header: typeof raw.header === "string" ? raw.header : "",
      question: questionText,
      multiSelect: Boolean(raw.multiSelect),
      options: Array.isArray(raw.options)
        ? raw.options.filter(isObject).map((option) => ({
            label: typeof option.label === "string" ? option.label : "",
            description:
              typeof option.description === "string" ? option.description : "",
          }))
        : [],
      selected: toAnswerArray(answers[questionText]),
      note: null,
    });
  }
  return { questions };
}

function buildToolCall(
  block: Record<string, unknown>,
  result: ToolResult | undefined,
): SessionToolCallContract {
  const rawName = typeof block.name === "string" ? block.name : "tool";
  // AskUserQuestion is a user interaction, not an ordinary tool. Normalize it
  // to the shared "question" contract and carry the structured payload.
  if (rawName === "AskUserQuestion") {
    const question = buildAskUserQuestion(
      block.input,
      result?.toolUseResult ?? null,
    );
    return {
      tool: QUESTION_TOOL,
      input: `${question.questions.length}件の質問`,
      status: result ? (result.isError ? "error" : "completed") : "unknown",
      error: "",
      fullInput: "",
      fullOutput: questionToPlainText(question),
      durationMs: 0,
      question,
    };
  }
  // Claude records a Skill invocation as the tool "Skill" with the skill name
  // in input.skill. Normalize it to the shared lowercase "skill" contract with
  // the skill name as the label so the sidebar's skill aggregation recognizes
  // it (other harnesses already emit "skill" / input.name).
  const skillName =
    rawName === "Skill" &&
    isObject(block.input) &&
    typeof block.input.skill === "string" &&
    block.input.skill.trim() !== ""
      ? block.input.skill
      : null;

  return {
    tool: skillName ? "skill" : rawName,
    input: skillName ?? summarizeToolInput(block.input),
    status: result ? (result.isError ? "error" : "completed") : "unknown",
    error: result?.isError ? result.output : "",
    fullInput: safeJson(block.input ?? {}),
    fullOutput: result ? result.output : "",
    durationMs: 0,
    question: null,
  };
}

/**
 * Represent a `thinking` block as a collapsed timeline entry: the row shows
 * the opening words, and the full reasoning is revealed on demand. This reuses
 * the tool-call disclosure UI so thinking stays optional and unobtrusive.
 */
function buildThinkingCall(thinking: string): SessionToolCallContract {
  return {
    tool: "🧠 thinking",
    input: truncate(thinking, 80),
    status: "unknown",
    error: "",
    fullInput: "",
    fullOutput: thinking.trim(),
    durationMs: 0,
    question: null,
  };
}

// ---------------------------------------------------------------------------
// Message building
// ---------------------------------------------------------------------------

function makeMessage(
  role: "user" | "assistant",
  text: string,
  createdAt: string,
  options: {
    modelId?: string | null;
    agent?: string | null;
    toolCalls?: SessionToolCallContract[];
  } = {},
): SessionMessageContract {
  return {
    role,
    text,
    modelId: options.modelId ?? null,
    agent: options.agent ?? null,
    outputTpsLabel: null,
    createdAt,
    toolCalls: options.toolCalls ?? [],
    subagentLinks: [],
    fileDiffs: [],
  };
}

export interface BuildMessagesOptions {
  includeThinking: boolean;
}

export function buildClaudeMessages(
  records: ClaudeRecord[],
  options: BuildMessagesOptions,
): SessionMessageContract[] {
  const toolResults = buildToolResultMap(records);
  const messages: SessionMessageContract[] = [];

  for (const record of records) {
    if (record.type !== "user" && record.type !== "assistant") continue;
    const message = record.raw.message;
    if (!isObject(message)) continue;
    const createdAt = parseTimestamp(record.raw.timestamp);
    const agent = record.raw.isSidechain === true ? "subagent" : null;

    if (record.type === "assistant") {
      const textParts: string[] = [];
      const toolCalls: SessionToolCallContract[] = [];
      const content = Array.isArray(message.content) ? message.content : [];

      for (const block of content) {
        if (!isObject(block)) continue;
        if (block.type === "thinking") {
          if (
            options.includeThinking &&
            typeof block.thinking === "string" &&
            block.thinking.trim()
          ) {
            toolCalls.push(buildThinkingCall(block.thinking));
          }
        } else if (block.type === "text") {
          if (typeof block.text === "string" && block.text.trim()) {
            textParts.push(block.text);
          }
        } else if (block.type === "tool_use") {
          const id = typeof block.id === "string" ? block.id : "";
          toolCalls.push(buildToolCall(block, toolResults.get(id)));
        }
      }

      if (textParts.length === 0 && toolCalls.length === 0) continue;
      messages.push(
        makeMessage("assistant", textParts.join("\n\n"), createdAt, {
          modelId: typeof message.model === "string" ? message.model : null,
          agent,
          toolCalls,
        }),
      );
      continue;
    }

    // record.type === "user": keep genuine prompts, drop tool_result-only turns.
    const content = message.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter(
          (block): block is Record<string, unknown> =>
            isObject(block) && block.type === "text",
        )
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("\n\n");
    }
    if (!text.trim()) continue;
    messages.push(makeMessage("user", text, createdAt, { agent }));
  }

  return messages;
}

function isDisplayableUserRecord(record: ClaudeRecord): boolean {
  const message = record.raw.message;
  if (!isObject(message)) return false;
  const content = message.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      isObject(block) &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.trim().length > 0,
  );
}

function extractAssistantToolUseIds(record: ClaudeRecord): string[] {
  const message = record.raw.message;
  if (!isObject(message) || !Array.isArray(message.content)) return [];
  const ids: string[] = [];
  for (const block of message.content) {
    if (!isObject(block) || block.type !== "tool_use") continue;
    if (typeof block.id === "string") ids.push(block.id);
  }
  return ids;
}

function isDisplayableAssistantRecord(
  record: ClaudeRecord,
  options: BuildMessagesOptions,
): boolean {
  const message = record.raw.message;
  if (!isObject(message) || !Array.isArray(message.content)) return false;

  for (const block of message.content) {
    if (!isObject(block)) continue;
    if (block.type === "tool_use") return true;
    if (
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.trim()
    ) {
      return true;
    }
    if (
      block.type === "thinking" &&
      options.includeThinking &&
      typeof block.thinking === "string" &&
      block.thinking.trim()
    ) {
      return true;
    }
  }
  return false;
}

export function attachClaudeSubagentLinks(
  records: ClaudeRecord[],
  messages: SessionMessageContract[],
  linksByToolUseId: Map<string, SessionMessageSubagentLinkContract[]>,
  options: BuildMessagesOptions,
): void {
  let messageIndex = 0;

  for (const record of records) {
    if (record.type === "assistant") {
      if (!isDisplayableAssistantRecord(record, options)) continue;
      const message = messages[messageIndex];
      messageIndex += 1;
      if (!message) continue;

      for (const toolUseId of extractAssistantToolUseIds(record)) {
        const links = linksByToolUseId.get(toolUseId);
        if (!links) continue;
        for (const link of links) {
          if (message.subagentLinks.some((item) => item.id === link.id)) {
            continue;
          }
          message.subagentLinks.push(link);
        }
      }
      continue;
    }

    if (record.type === "user" && isDisplayableUserRecord(record)) {
      messageIndex += 1;
    }
  }
}

export function extractClaudeSubagentTranscriptDirs(
  records: ClaudeRecord[],
): Map<string, string> {
  const map = new Map<string, string>();

  for (const record of records) {
    if (record.type !== "user") continue;
    const message = record.raw.message;
    if (!isObject(message) || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (!isObject(block) || block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;

      const result = isObject(record.raw.toolUseResult)
        ? record.raw.toolUseResult
        : null;
      const transcriptDir = result?.transcriptDir;
      if (typeof transcriptDir === "string" && transcriptDir) {
        map.set(transcriptDir, block.tool_use_id);
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Todos — the last TodoWrite call is the session's final task list
// ---------------------------------------------------------------------------

export function extractClaudeTodos(
  records: ClaudeRecord[],
): SessionTodoContract[] {
  let todos: SessionTodoContract[] = [];
  for (const record of records) {
    if (record.type !== "assistant") continue;
    const message = record.raw.message;
    if (!isObject(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isObject(block) || block.type !== "tool_use") continue;
      if (block.name !== "TodoWrite") continue;
      const input = block.input;
      if (!isObject(input) || !Array.isArray(input.todos)) continue;
      const next: SessionTodoContract[] = [];
      for (const item of input.todos) {
        if (!isObject(item) || typeof item.content !== "string") continue;
        next.push({
          content: item.content,
          status: typeof item.status === "string" ? item.status : "pending",
          priority: typeof item.priority === "string" ? item.priority : "",
        });
      }
      todos = next;
    }
  }
  return todos;
}

// ---------------------------------------------------------------------------
// Token usage
//
// Streamed assistant turns are split into several records sharing one
// message.id, each repeating the same usage object — sum once per id.
// ---------------------------------------------------------------------------

export interface ClaudeUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

interface UsageEntry {
  scope: "main" | "subagent";
  modelId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function usageNumber(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function collectUsageEntries(records: ClaudeRecord[]): UsageEntry[] {
  const byMessageId = new Map<string, UsageEntry>();
  let syntheticId = 0;
  for (const record of records) {
    if (record.type !== "assistant") continue;
    const message = record.raw.message;
    if (!isObject(message) || !isObject(message.usage)) continue;
    const id =
      typeof message.id === "string" && message.id
        ? message.id
        : `synthetic-${syntheticId++}`;
    if (byMessageId.has(id)) continue;
    const entry: UsageEntry = {
      scope: record.raw.isSidechain === true ? "subagent" : "main",
      modelId: typeof message.model === "string" ? message.model : "unknown",
      input: usageNumber(message.usage, "input_tokens"),
      output: usageNumber(message.usage, "output_tokens"),
      cacheRead: usageNumber(message.usage, "cache_read_input_tokens"),
      cacheWrite: usageNumber(message.usage, "cache_creation_input_tokens"),
    };
    // Skip zero-usage records (e.g. "<synthetic>" error placeholders) so
    // they don't pollute the model breakdown.
    if (entry.input + entry.output + entry.cacheRead + entry.cacheWrite === 0) {
      continue;
    }
    byMessageId.set(id, entry);
  }
  return [...byMessageId.values()];
}

export function extractClaudeUsageTotals(
  records: ClaudeRecord[],
): ClaudeUsageTotals {
  const totals: ClaudeUsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  for (const entry of collectUsageEntries(records)) {
    totals.input += entry.input;
    totals.output += entry.output;
    totals.cacheRead += entry.cacheRead;
    totals.cacheWrite += entry.cacheWrite;
  }
  totals.total =
    totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  return totals;
}

export function extractClaudeModelBreakdown(
  records: ClaudeRecord[],
): SessionModelTokenBreakdown[] {
  const grouped = new Map<string, SessionModelTokenBreakdown>();
  for (const entry of collectUsageEntries(records)) {
    const key = `${entry.scope}::${entry.modelId}`;
    const current = grouped.get(key) ?? {
      scope: entry.scope,
      agent: entry.scope === "main" ? "main" : "subagent",
      modelId: entry.modelId,
      providerId: "anthropic",
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    };
    current.messageCount += 1;
    current.inputTokens += entry.input;
    current.outputTokens += entry.output;
    current.cacheReadTokens += entry.cacheRead;
    current.cacheWriteTokens += entry.cacheWrite;
    current.totalTokens +=
      entry.input + entry.output + entry.cacheRead + entry.cacheWrite;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

// ---------------------------------------------------------------------------
// Metadata extraction (used by both list and detail summaries)
// ---------------------------------------------------------------------------

export interface ClaudeTranscriptMeta {
  title: string | null;
  cwd: string;
  gitBranch: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  tokensUsed: number;
  messageCount: number;
  firstUserMessage: string;
}

function firstUserText(message: unknown): string {
  if (!isObject(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // A genuine prompt has text blocks; tool_result-only turns have none.
  return content
    .filter(
      (block): block is Record<string, unknown> =>
        isObject(block) && block.type === "text",
    )
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

export function extractClaudeMeta(
  records: ClaudeRecord[],
): ClaudeTranscriptMeta {
  let aiTitle: string | null = null;
  let cwd = "";
  let gitBranch: string | null = null;
  let model: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let messageCount = 0;
  let firstUserMessage = "";

  for (const record of records) {
    const raw = record.raw;

    if (record.type === "ai-title" && typeof raw.aiTitle === "string") {
      aiTitle = raw.aiTitle;
    }

    if (typeof raw.cwd === "string" && raw.cwd && !cwd) cwd = raw.cwd;
    if (typeof raw.gitBranch === "string" && raw.gitBranch && !gitBranch) {
      gitBranch = raw.gitBranch;
    }

    if (record.type === "user" || record.type === "assistant") {
      messageCount += 1;
      if (typeof raw.timestamp === "string") {
        if (!firstTimestamp) firstTimestamp = raw.timestamp;
        lastTimestamp = raw.timestamp;
      }
    }

    if (record.type === "assistant" && isObject(raw.message)) {
      if (typeof raw.message.model === "string") model = raw.message.model;
    }

    if (record.type === "user" && !firstUserMessage) {
      const text = firstUserText(raw.message);
      if (text.trim()) firstUserMessage = text.trim();
    }
  }

  return {
    title: aiTitle,
    cwd,
    gitBranch,
    model,
    createdAt: parseTimestamp(firstTimestamp),
    updatedAt: parseTimestamp(lastTimestamp),
    tokensUsed: extractClaudeUsageTotals(records).total,
    messageCount,
    firstUserMessage,
  };
}
