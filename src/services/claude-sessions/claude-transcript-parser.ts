import type {
  SessionMessageContract,
  SessionToolCallContract,
} from "../../contracts/session.js";

// ---------------------------------------------------------------------------
// Low-level helpers
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
}

/** Map tool_use_id → its result, scanned from user tool_result blocks. */
function buildToolResultMap(records: ClaudeRecord[]): Map<string, ToolResult> {
  const map = new Map<string, ToolResult>();
  for (const record of records) {
    if (record.type !== "user") continue;
    const message = record.raw.message;
    if (!isObject(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isObject(block) || block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;
      map.set(block.tool_use_id, {
        output: contentToText(block.content),
        isError: block.is_error === true,
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

function buildToolCall(
  block: Record<string, unknown>,
  result: ToolResult | undefined,
): SessionToolCallContract {
  return {
    tool: typeof block.name === "string" ? block.name : "tool",
    input: summarizeToolInput(block.input),
    status: result ? (result.isError ? "error" : "completed") : "unknown",
    error: result?.isError ? result.output : "",
    fullInput: safeJson(block.input ?? {}),
    fullOutput: result ? result.output : "",
    durationMs: 0,
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

function usageTokens(usage: unknown): number {
  if (!isObject(usage)) return 0;
  const fields = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ];
  let total = 0;
  for (const field of fields) {
    const value = usage[field];
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
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
  let tokensUsed = 0;
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
      tokensUsed += usageTokens(raw.message.usage);
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
    tokensUsed,
    messageCount,
    firstUserMessage,
  };
}
