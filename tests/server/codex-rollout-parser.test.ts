import { describe, expect, test } from "vitest";
import { parseCodexRollout } from "../../src/services/harness/codex/rollout-parser.js";

function rollout(lines: unknown[]): string {
  return lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");
}

describe("parseCodexRollout", () => {
  test("parses messages, tool calls, reasoning, todos and tokens", () => {
    const content = rollout([
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "session_meta",
        payload: { id: "thread-1", cwd: "/repo", parent_thread_id: "parent-1" },
      },
      {
        timestamp: "2026-01-01T00:00:00.500Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", model: "gpt-5.5" },
      },
      {
        timestamp: "2026-01-01T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "最初の依頼" },
      },
      // Same prompt as response_item — must not duplicate.
      {
        timestamp: "2026-01-01T00:00:01.100Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "最初の依頼" }],
        },
      },
      // Injected context — must be dropped.
      {
        timestamp: "2026-01-01T00:00:01.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<environment_context>cwd: /repo</environment_context>",
            },
          ],
        },
      },
      {
        timestamp: "2026-01-01T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "考え中" }],
        },
      },
      {
        timestamp: "2026-01-01T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "ls -la" }),
          call_id: "call-1",
        },
      },
      {
        timestamp: "2026-01-01T00:00:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "Process exited with code 0\nfile.txt",
        },
      },
      {
        timestamp: "2026-01-01T00:00:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "false" }),
          call_id: "call-2",
        },
      },
      {
        timestamp: "2026-01-01T00:00:05.500Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-2",
          output: "Process exited with code 1",
        },
      },
      {
        timestamp: "2026-01-01T00:00:06.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "調査", status: "completed" },
              { step: "実装", status: "in_progress" },
            ],
          }),
          call_id: "call-3",
        },
      },
      {
        timestamp: "2026-01-01T00:00:06.100Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-3",
          output: "Plan updated",
        },
      },
      {
        timestamp: "2026-01-01T00:00:07.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "完了しました" }],
        },
      },
      // Duplicate of the response_item assistant text at the same second.
      {
        timestamp: "2026-01-01T00:00:07.500Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "完了しました" },
      },
      // Unique agent_message — kept.
      {
        timestamp: "2026-01-01T00:00:08.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "追加コメント" },
      },
      {
        timestamp: "2026-01-01T00:00:09.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 40,
              output_tokens: 50,
              reasoning_output_tokens: 10,
              total_tokens: 150,
            },
          },
        },
      },
      "{not json",
    ]);

    const parsed = parseCodexRollout(content);

    expect(parsed.parseWarningCount).toBe(1);
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.parentThreadId).toBe("parent-1");
    expect(parsed.models).toEqual(["gpt-5.5"]);
    expect(parsed.tokens).toEqual({
      input: 100,
      cachedInput: 40,
      output: 50,
      reasoning: 10,
      total: 150,
    });
    expect(parsed.todos).toEqual([
      { content: "調査", status: "completed", priority: "" },
      { content: "実装", status: "in_progress", priority: "" },
    ]);

    expect(
      parsed.messages.map((message) => [message.role, message.text]),
    ).toEqual([
      ["user", "最初の依頼"],
      ["assistant", ""],
      ["assistant", "完了しました"],
      ["assistant", "追加コメント"],
    ]);

    // Tool calls attach to the assistant shell preceding the final text.
    const shell = parsed.messages[1];
    expect(shell.modelId).toBe("gpt-5.5");
    expect(shell.toolCalls.map((call) => call.tool)).toEqual([
      "🧠 thinking",
      "exec_command",
      "exec_command",
      "update_plan",
    ]);
    expect(shell.toolCalls[0].fullOutput).toBe("考え中");
    expect(shell.toolCalls[1]).toMatchObject({
      input: "ls -la",
      status: "completed",
      error: "",
      durationMs: 1000,
    });
    expect(shell.toolCalls[1].fullOutput).toContain("file.txt");
    expect(shell.toolCalls[2]).toMatchObject({
      status: "error",
      error: "exit code 1",
    });

    expect(parsed.toolEvents.map((event) => event.tool)).toEqual([
      "exec_command",
      "exec_command",
      "update_plan",
    ]);
    expect(parsed.toolEvents[0].createdAt).toBe("2026-01-01T00:00:03.000Z");
  });

  test("builds a structured question tool call from request_user_input", () => {
    const content = rollout([
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "request_user_input",
          arguments: JSON.stringify({
            questions: [
              {
                id: "q1",
                header: "方針",
                question: "どちらにしますか？",
                options: [
                  { label: "案A", description: "速い" },
                  { label: "案B", description: "安全" },
                ],
              },
              {
                id: "q2",
                header: "確認",
                question: "進めてよいですか？",
                options: [{ label: "はい", description: "" }],
              },
            ],
          }),
          call_id: "call-q",
        },
      },
      {
        timestamp: "2026-01-01T00:00:10.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-q",
          output: JSON.stringify({
            answers: {
              q1: {
                answers: ["案A", "user_note: 補足", "None of the above"],
              },
              q2: { answers: ["はい"] },
            },
          }),
        },
      },
    ]);

    const parsed = parseCodexRollout(content);

    // No flattened assistant/user messages remain for the question — only the
    // assistant shell that carries the question tool call.
    expect(
      parsed.messages.map((message) => [message.role, message.text]),
    ).toEqual([["assistant", ""]]);

    const shell = parsed.messages[0];
    expect(shell.toolCalls).toHaveLength(1);
    const call = shell.toolCalls[0];
    expect(call.tool).toBe("question");
    expect(call.input).toBe("2件の質問");
    expect(call.status).toBe("completed");
    // Options are preserved; "None of the above" is dropped; the user_note is
    // stripped of its prefix and lands in note, not selected. multiSelect is
    // always false for Codex.
    expect(call.question).toEqual({
      questions: [
        {
          header: "方針",
          question: "どちらにしますか？",
          multiSelect: false,
          options: [
            { label: "案A", description: "速い" },
            { label: "案B", description: "安全" },
          ],
          selected: ["案A"],
          note: "補足",
        },
        {
          header: "確認",
          question: "進めてよいですか？",
          multiSelect: false,
          options: [{ label: "はい", description: "" }],
          selected: ["はい"],
          note: null,
        },
      ],
    });

    // The question tool call is also surfaced as a tool event, never an error.
    expect(parsed.toolEvents.map((event) => event.tool)).toEqual(["question"]);
    expect(parsed.toolEvents[0].status).toBe("completed");
  });

  test("marks unresolved calls as unknown at EOF", () => {
    const content = rollout([
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "sleep 100" }),
          call_id: "call-hang",
        },
      },
    ]);

    const parsed = parseCodexRollout(content);
    expect(parsed.messages[0].toolCalls[0].status).toBe("unknown");
  });
});
