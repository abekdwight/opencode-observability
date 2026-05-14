/**
 * Tests for hasVisibleMessageContent — a pure function that determines whether
 * a session message should be rendered in the session detail view.
 *
 * These tests run in Node (vitest environment: "node") and exercise ONLY the
 * exported pure function — no React, no DOM, no browser globals.
 */

import { describe, expect, test } from "vitest";
import { hasVisibleMessageContent } from "../../web/routes/session-detail/_lib/message-visibility.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function visible(
  overrides: Partial<Parameters<typeof hasVisibleMessageContent>[0]> = {},
) {
  return hasVisibleMessageContent({
    text: "",
    toolsVisible: false,
    toolCallsCount: 0,
    fileDiffsCount: 0,
    subagentLinksCount: 0,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Text-based visibility
// ---------------------------------------------------------------------------

describe("hasVisibleMessageContent — text rules", () => {
  test("non-empty text is always visible regardless of other fields", () => {
    expect(
      visible({
        text: "Hello, world!",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(true);
  });

  test("text overrides hidden tools — visible even when tools are not visible", () => {
    expect(
      visible({
        text: "I have content",
        toolsVisible: false,
        toolCallsCount: 5,
      }),
    ).toBe(true);
  });

  test("text overrides hidden tools and zero diffs/links — visible", () => {
    expect(
      visible({
        text: "Standalone text",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(true);
  });

  test("empty string is treated as no text", () => {
    expect(visible({ text: "" })).toBe(false);
  });

  test("whitespace-only text is treated as empty and not visible", () => {
    expect(visible({ text: "   " })).toBe(false);
  });

  test("tab-only text is treated as empty", () => {
    expect(visible({ text: "\t" })).toBe(false);
  });

  test("newline-only text is treated as empty", () => {
    expect(visible({ text: "\n" })).toBe(false);
  });

  test("mixed whitespace text is treated as empty", () => {
    expect(visible({ text: " \t \n  " })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool-based visibility (empty text)
// ---------------------------------------------------------------------------

describe("hasVisibleMessageContent — tool visibility (empty text)", () => {
  test("empty text with visible tools and tool calls — visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: true,
        toolCallsCount: 3,
      }),
    ).toBe(true);
  });

  test("empty text with hidden tools and tool calls — NOT visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 3,
      }),
    ).toBe(false);
  });

  test("empty text with visible tools but zero tool calls — NOT visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: true,
        toolCallsCount: 0,
      }),
    ).toBe(false);
  });

  test("empty text with hidden tools and zero tool calls — NOT visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// File diff visibility (empty text, no tools)
// ---------------------------------------------------------------------------

describe("hasVisibleMessageContent — file diffs (empty text, no tools)", () => {
  test("empty text, no tools, has file diffs — visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 2,
      }),
    ).toBe(true);
  });

  test("empty text, no tools, zero diffs — NOT visible (no other content)", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Subagent link visibility (empty text, no tools, no diffs)
// ---------------------------------------------------------------------------

describe("hasVisibleMessageContent — subagent links (empty text, no tools, no diffs)", () => {
  test("empty text, no tools, no diffs, has subagent links — visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 1,
      }),
    ).toBe(true);
  });

  test("empty text, no tools, no diffs, multiple subagent links — visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 5,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined / edge cases
// ---------------------------------------------------------------------------

describe("hasVisibleMessageContent — combined scenarios", () => {
  test("empty text with all content types zero and no visible tools — NOT visible", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(false);
  });

  test("visible with only tool calls (tools visible) but everything else zero", () => {
    expect(
      visible({
        text: "",
        toolsVisible: true,
        toolCallsCount: 1,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(true);
  });

  test("visible with only file diffs but everything else zero", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 1,
        subagentLinksCount: 0,
      }),
    ).toBe(true);
  });

  test("visible with only subagent links but everything else zero", () => {
    expect(
      visible({
        text: "",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 1,
      }),
    ).toBe(true);
  });

  test("visible when text is non-empty and all other fields are zero with hidden tools", () => {
    expect(
      visible({
        text: "Just text, nothing else",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(true);
  });

  test("whitespace-only text with visible tools — visible (tools win)", () => {
    expect(
      visible({
        text: "   ",
        toolsVisible: true,
        toolCallsCount: 2,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(true);
  });

  test("whitespace-only text with hidden tools and no other content — NOT visible", () => {
    expect(
      visible({
        text: "   ",
        toolsVisible: false,
        toolCallsCount: 0,
        fileDiffsCount: 0,
        subagentLinksCount: 0,
      }),
    ).toBe(false);
  });
});
