import type {
  SessionMessageContract,
  SessionTodoContract,
  SessionToolCallContract,
  SessionToolEventContract,
} from "../../../contracts/session.js";

// ---------------------------------------------------------------------------
// Codex rollout parser
//
// A rollout file is a JSONL log of one Codex thread. Lines this parser uses:
//   session_meta                    — cwd, parent thread id (subagent spawns)
//   turn_context                    — model in effect for the next turn
//   response_item / message         — canonical user/assistant messages
//   response_item / reasoning       — thinking summaries
//   response_item / function_call   — tool calls (incl. update_plan → todos)
//   response_item / function_call_output — tool results, matched by call_id
//   event_msg / user_message        — the user's prompt as typed
//   event_msg / agent_message       — assistant text not present as response_item
//   event_msg / token_count         — cumulative token usage (last one wins)
// Everything else (ghost_snapshot, task lifecycle, rate limits) is ignored.
// ---------------------------------------------------------------------------

export interface CodexTokenUsage {
  input: number;
  cachedInput: number;
  output: number;
  reasoning: number;
  total: number;
}

export interface ParsedCodexRollout {
  messages: SessionMessageContract[];
  toolEvents: SessionToolEventContract[];
  todos: SessionTodoContract[];
  tokens: CodexTokenUsage | null;
  models: string[];
  cwd: string | null;
  parentThreadId: string | null;
  parseWarningCount: number;
}

const MAX_TOOL_TEXT_LENGTH = 16_000;
const TOOL_INPUT_SUMMARY_LENGTH = 120;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function truncateFlat(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function capToolText(text: string): string {
  if (text.length <= MAX_TOOL_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_TOOL_TEXT_LENGTH)}\n… (truncated)`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const chunks: string[] = [];
  for (const entry of content) {
    if (!isObject(entry)) continue;
    if (entry.type !== "input_text" && entry.type !== "output_text") continue;
    if (typeof entry.text === "string") chunks.push(entry.text);
  }
  return chunks.join("");
}

/**
 * Codex injects context blocks (`<permissions instructions>`,
 * `<environment_context>`, `<user_instructions>`, …) as user/developer
 * messages. They are not conversation and are dropped from the viewer.
 */
function isInjectedContext(text: string): boolean {
  return /^<[a-zA-Z][\w .-]*>/.test(text.trimStart());
}

/** Short one-line label for a tool call's collapsed row. */
function summarizeToolInput(args: unknown): string {
  if (typeof args === "string")
    return truncateFlat(args, TOOL_INPUT_SUMMARY_LENGTH);
  if (!isObject(args)) return "";
  const preferredKeys = [
    "cmd",
    "command",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "input",
    "name",
    "explanation",
  ];
  for (const key of preferredKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return truncateFlat(value, TOOL_INPUT_SUMMARY_LENGTH);
    }
  }
  return truncateFlat(safeJson(args), TOOL_INPUT_SUMMARY_LENGTH);
}

function parseArguments(argumentsStr: unknown): unknown {
  if (typeof argumentsStr !== "string") return argumentsStr;
  try {
    return JSON.parse(argumentsStr);
  } catch {
    return argumentsStr;
  }
}

function extractRequestUserInputQuestions(args: unknown): string[] {
  if (!isObject(args) || !Array.isArray(args.questions)) return [];
  return args.questions
    .filter(
      (q: unknown): q is Record<string, unknown> =>
        isObject(q) && typeof q.question === "string",
    )
    .map((q) => q.question as string);
}

function extractFunctionCallOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (isObject(output) && typeof output.output === "string") {
    return output.output;
  }
  return "";
}

function extractRequestUserInputAnswers(outputText: string): string[] {
  try {
    const parsed = JSON.parse(outputText);
    if (!isObject(parsed) || !isObject(parsed.answers)) return [];
    const answers: string[] = [];
    for (const questionAnswers of Object.values(parsed.answers)) {
      if (!isObject(questionAnswers) || !Array.isArray(questionAnswers.answers))
        continue;
      for (const entry of questionAnswers.answers) {
        if (typeof entry !== "string" || entry.length === 0) continue;
        if (entry === "None of the above") continue;
        answers.push(
          entry.startsWith("user_note: ")
            ? entry.slice("user_note: ".length)
            : entry,
        );
      }
    }
    return answers;
  } catch {
    return [];
  }
}

/** exec_command outputs embed "Process exited with code N". */
function detectExitCodeError(outputText: string): string | null {
  const match = /(?:Process )?exited with code (\d+)/.exec(outputText);
  if (!match) return null;
  return match[1] === "0" ? null : `exit code ${match[1]}`;
}

function extractPlanTodos(args: unknown): SessionTodoContract[] | null {
  if (!isObject(args) || !Array.isArray(args.plan)) return null;
  const todos: SessionTodoContract[] = [];
  for (const item of args.plan) {
    if (!isObject(item) || typeof item.step !== "string") continue;
    todos.push({
      content: item.step,
      status: typeof item.status === "string" ? item.status : "pending",
      priority: "",
    });
  }
  return todos;
}

function extractTokenUsage(info: unknown): CodexTokenUsage | null {
  if (!isObject(info)) return null;
  const usage = info.total_token_usage;
  if (!isObject(usage)) return null;
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    input: num(usage.input_tokens),
    cachedInput: num(usage.cached_input_tokens),
    output: num(usage.output_tokens),
    reasoning: num(usage.reasoning_output_tokens),
    total: num(usage.total_tokens),
  };
}

// ---------------------------------------------------------------------------
// Dedup helpers — agent_message events repeat response_item assistant text
// ---------------------------------------------------------------------------

/** Truncate ISO timestamp to second precision for fuzzy dedup matching. */
function toSecondKey(iso: string): string {
  const dot = iso.indexOf(".");
  return dot === -1 ? iso : iso.slice(0, dot);
}

interface RolloutLine {
  type: string;
  payload: Record<string, unknown>;
  timestampMs: number;
}

function parseLines(fileContent: string): {
  lines: RolloutLine[];
  parseWarningCount: number;
} {
  const lines: RolloutLine[] = [];
  let parseWarningCount = 0;
  for (const raw of fileContent.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      parseWarningCount += 1;
      continue;
    }
    if (!isObject(row) || typeof row.type !== "string") continue;
    const payload = isObject(row.payload) ? row.payload : {};
    lines.push({
      type: row.type,
      payload,
      timestampMs: parseTimestampMs(row.timestamp),
    });
  }
  return { lines, parseWarningCount };
}

function buildAssistantTextIndex(
  lines: RolloutLine[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.type !== "response_item") continue;
    if (line.payload.type !== "message") continue;
    if (line.payload.role !== "assistant") continue;
    const text = extractMessageText(line.payload.content);
    if (!text) continue;
    const key = toSecondKey(toIso(line.timestampMs));
    const set = map.get(key) ?? new Set<string>();
    set.add(text);
    map.set(key, set);
  }
  return map;
}

function buildEventUserTextSet(lines: RolloutLine[]): Set<string> {
  const set = new Set<string>();
  for (const line of lines) {
    if (line.type !== "event_msg") continue;
    if (line.payload.type !== "user_message") continue;
    if (typeof line.payload.message === "string") {
      set.add(line.payload.message.trim());
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

interface PendingToolCall {
  call: SessionToolCallContract;
  event: SessionToolEventContract;
  startedAtMs: number;
}

export function parseCodexRollout(fileContent: string): ParsedCodexRollout {
  const { lines, parseWarningCount } = parseLines(fileContent);
  const assistantTextIndex = buildAssistantTextIndex(lines);
  const eventUserTexts = buildEventUserTextSet(lines);

  const messages: SessionMessageContract[] = [];
  const toolEvents: SessionToolEventContract[] = [];
  const pendingCalls = new Map<string, PendingToolCall>();
  const models: string[] = [];

  let todos: SessionTodoContract[] = [];
  let tokens: CodexTokenUsage | null = null;
  let cwd: string | null = null;
  let parentThreadId: string | null = null;
  let currentModel: string | null = null;
  let currentAssistant: SessionMessageContract | null = null;

  const pushUser = (text: string, timestampMs: number): void => {
    messages.push({
      role: "user",
      text,
      modelId: null,
      agent: null,
      outputTpsLabel: null,
      createdAt: toIso(timestampMs),
      toolCalls: [],
      subagentLinks: [],
      fileDiffs: [],
    });
    currentAssistant = null;
  };

  const pushAssistant = (
    text: string,
    timestampMs: number,
  ): SessionMessageContract => {
    const message: SessionMessageContract = {
      role: "assistant",
      text,
      modelId: currentModel,
      agent: null,
      outputTpsLabel: null,
      createdAt: toIso(timestampMs),
      toolCalls: [],
      subagentLinks: [],
      fileDiffs: [],
    };
    messages.push(message);
    currentAssistant = message;
    return message;
  };

  /** Tool calls / reasoning that arrive before any assistant text attach to
   * an empty assistant shell so they keep their position in the timeline. */
  const ensureAssistant = (timestampMs: number): SessionMessageContract =>
    currentAssistant ?? pushAssistant("", timestampMs);

  for (const line of lines) {
    if (line.type === "session_meta") {
      if (typeof line.payload.cwd === "string" && line.payload.cwd) {
        cwd = line.payload.cwd;
      }
      if (
        typeof line.payload.parent_thread_id === "string" &&
        line.payload.parent_thread_id
      ) {
        parentThreadId = line.payload.parent_thread_id;
      }
      continue;
    }

    if (line.type === "turn_context") {
      if (typeof line.payload.model === "string" && line.payload.model) {
        currentModel = line.payload.model;
        if (!models.includes(currentModel)) models.push(currentModel);
      }
      continue;
    }

    if (line.type === "response_item") {
      const payload = line.payload;

      if (payload.type === "message") {
        const text = extractMessageText(payload.content);
        if (!text) continue;
        if (payload.role === "assistant") {
          pushAssistant(text, line.timestampMs);
          continue;
        }
        if (payload.role === "user") {
          if (isInjectedContext(text)) continue;
          // The same prompt arrives as an event_msg/user_message; let that
          // (already-clean) representation win to avoid duplicates.
          if (eventUserTexts.has(text.trim())) continue;
          pushUser(text, line.timestampMs);
        }
        continue;
      }

      if (payload.type === "reasoning") {
        const summary = Array.isArray(payload.summary) ? payload.summary : [];
        const text = summary
          .filter(
            (entry): entry is Record<string, unknown> =>
              isObject(entry) && typeof entry.text === "string",
          )
          .map((entry) => entry.text as string)
          .join("\n\n")
          .trim();
        if (!text) continue;
        ensureAssistant(line.timestampMs).toolCalls.push({
          tool: "🧠 thinking",
          input: truncateFlat(text, 80),
          status: "unknown",
          error: "",
          fullInput: "",
          fullOutput: text,
          durationMs: 0,
        });
        continue;
      }

      if (payload.type === "function_call") {
        const name = typeof payload.name === "string" ? payload.name : "tool";
        const args = parseArguments(payload.arguments);

        if (name === "request_user_input") {
          for (const question of extractRequestUserInputQuestions(args)) {
            pushAssistant(question, line.timestampMs);
          }
          continue;
        }

        if (name === "update_plan") {
          const plan = extractPlanTodos(args);
          if (plan) todos = plan;
        }

        const call: SessionToolCallContract = {
          tool: name,
          input: summarizeToolInput(args),
          status: "pending",
          error: "",
          fullInput: capToolText(
            typeof args === "string" ? args : safeJson(args),
          ),
          fullOutput: "",
          durationMs: 0,
        };
        const event: SessionToolEventContract = {
          ...call,
          createdAt: toIso(line.timestampMs),
        };
        ensureAssistant(line.timestampMs).toolCalls.push(call);
        toolEvents.push(event);
        if (typeof payload.call_id === "string") {
          pendingCalls.set(payload.call_id, {
            call,
            event,
            startedAtMs: line.timestampMs,
          });
        }
        continue;
      }

      if (payload.type === "function_call_output") {
        const outputText = extractFunctionCallOutputText(payload.output);
        const callId =
          typeof payload.call_id === "string" ? payload.call_id : "";
        const pending = pendingCalls.get(callId);

        if (!pending) {
          // request_user_input answers come back as outputs without a
          // tracked call: surface them as the user messages they are.
          for (const answer of extractRequestUserInputAnswers(outputText)) {
            pushUser(answer, line.timestampMs);
          }
          continue;
        }

        pendingCalls.delete(callId);
        const exitError = detectExitCodeError(outputText);
        const resolved: Pick<
          SessionToolCallContract,
          "status" | "error" | "fullOutput" | "durationMs"
        > = {
          status: exitError ? "error" : "completed",
          error: exitError ?? "",
          fullOutput: capToolText(outputText),
          durationMs: Math.max(0, line.timestampMs - pending.startedAtMs),
        };
        Object.assign(pending.call, resolved);
        Object.assign(pending.event, resolved);
        continue;
      }

      continue;
    }

    if (line.type === "event_msg") {
      const payload = line.payload;

      if (payload.type === "user_message") {
        if (typeof payload.message !== "string") continue;
        const text = payload.message.trim();
        if (!text || isInjectedContext(text)) continue;
        pushUser(payload.message, line.timestampMs);
        continue;
      }

      if (payload.type === "agent_message") {
        if (typeof payload.message !== "string" || !payload.message.trim())
          continue;
        const key = toSecondKey(toIso(line.timestampMs));
        if (assistantTextIndex.get(key)?.has(payload.message)) continue;
        pushAssistant(payload.message, line.timestampMs);
        continue;
      }

      if (payload.type === "token_count") {
        const usage = extractTokenUsage(payload.info);
        if (usage) tokens = usage;
      }
    }
  }

  // Unresolved calls at EOF: the session ended mid-flight.
  for (const pending of pendingCalls.values()) {
    pending.call.status = "unknown";
    pending.event.status = "unknown";
  }

  return {
    messages: messages.filter(
      (message) => message.text.trim() !== "" || message.toolCalls.length > 0,
    ),
    toolEvents,
    todos,
    tokens,
    models,
    cwd,
    parentThreadId,
    parseWarningCount,
  };
}
