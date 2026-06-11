import { describe, expect, test } from "vitest";
import {
  buildClaudeMessages,
  extractClaudeMeta,
  extractClaudeModelBreakdown,
  extractClaudeTodos,
  extractClaudeUsageTotals,
  parseClaudeTranscript,
} from "../../src/services/harness/claude/transcript-parser.js";

function transcript(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

const SAMPLE = transcript([
  {
    type: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/repo",
    gitBranch: "main",
    message: { role: "user", content: "こんにちは" },
  },
  {
    type: "assistant",
    timestamp: "2026-01-01T00:00:05.000Z",
    message: {
      id: "msg-1",
      model: "claude-fable-5",
      role: "assistant",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 20,
      },
      content: [
        { type: "thinking", thinking: "考える" },
        { type: "text", text: "やります" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
  },
  // Streamed continuation: same message.id, same usage — count once.
  {
    type: "assistant",
    timestamp: "2026-01-01T00:00:06.000Z",
    message: {
      id: "msg-1",
      model: "claude-fable-5",
      role: "assistant",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 20,
      },
      content: [{ type: "text", text: "続き" }],
    },
  },
  {
    type: "user",
    timestamp: "2026-01-01T00:00:07.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "file.txt",
          is_error: false,
        },
      ],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-01-01T00:00:08.000Z",
    isSidechain: true,
    message: {
      id: "msg-2",
      model: "claude-haiku",
      role: "assistant",
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "text", text: "サブ作業" }],
    },
  },
  {
    type: "assistant",
    timestamp: "2026-01-01T00:00:09.000Z",
    message: {
      id: "msg-3",
      model: "claude-fable-5",
      role: "assistant",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: "tool_use",
          id: "tool-2",
          name: "TodoWrite",
          input: {
            todos: [
              { content: "タスク1", status: "completed" },
              { content: "タスク2", status: "pending" },
            ],
          },
        },
      ],
    },
  },
  { type: "ai-title", aiTitle: "テストセッション" },
]);

describe("claude transcript parser", () => {
  test("deduplicates streamed usage by message id", () => {
    const { records } = parseClaudeTranscript(SAMPLE);
    expect(extractClaudeUsageTotals(records)).toEqual({
      input: 111,
      output: 56,
      cacheRead: 30,
      cacheWrite: 20,
      total: 217,
    });
  });

  test("builds model breakdown with main/subagent scopes", () => {
    const { records } = parseClaudeTranscript(SAMPLE);
    expect(extractClaudeModelBreakdown(records)).toEqual([
      {
        scope: "main",
        agent: "main",
        modelId: "claude-fable-5",
        providerId: "anthropic",
        messageCount: 2,
        inputTokens: 101,
        outputTokens: 51,
        reasoningTokens: 0,
        cacheReadTokens: 30,
        cacheWriteTokens: 20,
        totalTokens: 202,
        totalCost: 0,
      },
      {
        scope: "subagent",
        agent: "subagent",
        modelId: "claude-haiku",
        providerId: "anthropic",
        messageCount: 1,
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        totalCost: 0,
      },
    ]);
  });

  test("extracts the latest TodoWrite call as todos", () => {
    const { records } = parseClaudeTranscript(SAMPLE);
    expect(extractClaudeTodos(records)).toEqual([
      { content: "タスク1", status: "completed", priority: "" },
      { content: "タスク2", status: "pending", priority: "" },
    ]);
  });

  test("builds messages with thinking, tool results and sidechain labels", () => {
    const { records } = parseClaudeTranscript(SAMPLE);
    const messages = buildClaudeMessages(records, { includeThinking: true });

    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "こんにちは"],
      ["assistant", "やります"],
      ["assistant", "続き"],
      ["assistant", "サブ作業"],
      ["assistant", ""],
    ]);

    expect(messages[1].toolCalls.map((call) => call.tool)).toEqual([
      "🧠 thinking",
      "Bash",
    ]);
    expect(messages[1].toolCalls[1]).toMatchObject({
      input: "ls",
      status: "completed",
      fullOutput: "file.txt",
    });
    expect(messages[3].agent).toBe("subagent");
  });

  test("extracts session metadata with deduplicated token totals", () => {
    const { records } = parseClaudeTranscript(SAMPLE);
    expect(extractClaudeMeta(records)).toEqual({
      title: "テストセッション",
      cwd: "/repo",
      gitBranch: "main",
      model: "claude-fable-5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:09.000Z",
      tokensUsed: 217,
      messageCount: 6,
      firstUserMessage: "こんにちは",
    });
  });
});
