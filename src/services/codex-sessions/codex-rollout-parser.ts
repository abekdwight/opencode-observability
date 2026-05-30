interface ParsedMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

interface ParsedRound {
  id: string;
  startedAt: string;
  userMessages: ParsedMessage[];
  assistantMessages: ParsedMessage[];
}

interface ParsedRollout {
  rounds: ParsedRound[];
  parseWarningCount: number;
}

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

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";

  const chunks: string[] = [];
  for (const entry of content) {
    if (!isObject(entry)) continue;
    if (entry.type !== "input_text" && entry.type !== "output_text") continue;
    if (typeof entry.text === "string") {
      chunks.push(entry.text);
    }
  }
  return chunks.join("");
}

function extractRequestUserInputQuestions(argumentsStr: unknown): string[] {
  if (typeof argumentsStr !== "string") return [];
  try {
    const parsed = JSON.parse(argumentsStr);
    if (!isObject(parsed) || !Array.isArray(parsed.questions)) return [];
    return parsed.questions
      .filter(
        (q: unknown): q is Record<string, unknown> =>
          isObject(q) && typeof q.question === "string",
      )
      .map((q) => q.question as string);
  } catch {
    return [];
  }
}

function extractFunctionCallOutputAnswers(outputStr: unknown): string[] {
  if (typeof outputStr !== "string") return [];
  try {
    const parsed = JSON.parse(outputStr);
    if (!isObject(parsed) || !isObject(parsed.answers)) return [];
    const answers: string[] = [];
    for (const questionAnswers of Object.values(parsed.answers)) {
      if (!isObject(questionAnswers) || !Array.isArray(questionAnswers.answers))
        continue;
      for (const entry of questionAnswers.answers) {
        if (typeof entry === "string" && entry.length > 0) {
          // Strip "None of the above" option placeholder
          if (entry === "None of the above") continue;
          // Strip "user_note: " prefix
          const cleaned = entry.startsWith("user_note: ")
            ? entry.slice("user_note: ".length)
            : entry;
          answers.push(cleaned);
        }
      }
    }
    return answers;
  } catch {
    return [];
  }
}

/**
 * Track response_item messages to deduplicate agent_message events
 * that contain the same text at the same timestamp.
 */
/** Truncate ISO timestamp to second precision for fuzzy dedup matching. */
function toSecondKey(iso: string): string {
  // "2026-05-27T15:36:52.994Z" → "2026-05-27T15:36:52"
  const dot = iso.indexOf(".");
  if (dot === -1) return iso;
  return iso.slice(0, dot);
}

function buildAssistantTextSet(
  lines: string[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: unknown;
    try {
      row = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!isObject(row)) continue;
    if (row.type !== "response_item") continue;
    const payload = row.payload;
    if (!isObject(payload)) continue;
    if (payload.type !== "message") continue;
    if (payload.role !== "assistant") continue;
    const text = extractMessageText(payload.content);
    if (!text) continue;
    const ts = toSecondKey(parseTimestamp(row.timestamp));
    let set = map.get(ts);
    if (!set) {
      set = new Set<string>();
      map.set(ts, set);
    }
    set.add(text);
  }
  return map;
}

export function parseCodexRolloutContent(fileContent: string): ParsedRollout {
  const rounds: ParsedRound[] = [];
  let parseWarningCount = 0;
  let currentRound: ParsedRound | null = null;

  const lines = fileContent.split(/\r?\n/);

  // Pre-compute dedup set for agent_message events
  const assistantTextByTs = buildAssistantTextSet(lines);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row: unknown;
    try {
      row = JSON.parse(trimmed) as unknown;
    } catch {
      parseWarningCount += 1;
      continue;
    }

    if (!isObject(row)) continue;

    // ── response_item > message ──
    if (row.type === "response_item") {
      const payload = row.payload;
      if (!isObject(payload)) continue;
      if (payload.type === "message") {
        if (payload.role !== "user" && payload.role !== "assistant") continue;
        const createdAt = parseTimestamp(row.timestamp);
        const message: ParsedMessage = {
          role: payload.role,
          text: extractMessageText(payload.content),
          createdAt,
        };
        if (message.role === "user") {
          currentRound = {
            id: `round-${rounds.length + 1}`,
            startedAt: createdAt,
            userMessages: [message],
            assistantMessages: [],
          };
          rounds.push(currentRound);
          continue;
        }
        if (!currentRound) {
          currentRound = {
            id: `round-${rounds.length + 1}`,
            startedAt: createdAt,
            userMessages: [],
            assistantMessages: [],
          };
          rounds.push(currentRound);
        }
        currentRound.assistantMessages.push(message);
        continue;
      }

      // ── response_item > function_call (request_user_input) ──
      // The AI is asking a question → assistant message
      if (payload.type === "function_call") {
        if (payload.name !== "request_user_input") continue;
        const questions = extractRequestUserInputQuestions(payload.arguments);
        if (questions.length === 0) continue;
        const createdAt = parseTimestamp(row.timestamp);
        if (!currentRound) {
          currentRound = {
            id: `round-${rounds.length + 1}`,
            startedAt: createdAt,
            userMessages: [],
            assistantMessages: [],
          };
          rounds.push(currentRound);
        }
        for (const question of questions) {
          currentRound.assistantMessages.push({
            role: "assistant",
            text: question,
            createdAt,
          });
        }
        continue;
      }

      // ── response_item > function_call_output (answer to request_user_input) ──
      // The user's answer → user message (starts a new round)
      if (payload.type === "function_call_output") {
        const answers = extractFunctionCallOutputAnswers(payload.output);
        if (answers.length === 0) continue;
        const createdAt = parseTimestamp(row.timestamp);
        for (const answer of answers) {
          const message: ParsedMessage = {
            role: "user",
            text: answer,
            createdAt,
          };
          currentRound = {
            id: `round-${rounds.length + 1}`,
            startedAt: createdAt,
            userMessages: [message],
            assistantMessages: [],
          };
          rounds.push(currentRound);
        }
        continue;
      }

      continue;
    }

    // ── event_msg > agent_message ──
    if (row.type === "event_msg") {
      const payload = row.payload;
      if (!isObject(payload)) continue;
      if (payload.type !== "agent_message") continue;
      if (typeof payload.message !== "string" || !payload.message.trim())
        continue;

      const createdAt = parseTimestamp(row.timestamp);

      // Deduplicate: skip if same text already exists as response_item message at same second
      const dedupSet = assistantTextByTs.get(toSecondKey(createdAt));
      if (dedupSet?.has(payload.message)) continue;

      const message: ParsedMessage = {
        role: "assistant",
        text: payload.message,
        createdAt,
      };

      if (!currentRound) {
        currentRound = {
          id: `round-${rounds.length + 1}`,
          startedAt: createdAt,
          userMessages: [],
          assistantMessages: [],
        };
        rounds.push(currentRound);
      }
      currentRound.assistantMessages.push(message);
    }
  }

  return { rounds, parseWarningCount };
}
