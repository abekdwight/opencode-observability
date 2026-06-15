import type { SessionQuestionContract, SessionToolStatus } from "./session.js";

/**
 * Canonical tool name for user-question interactions across all harnesses.
 * OpenCode emits "question"; Codex (`request_user_input`) and Claude
 * (`AskUserQuestion`) are normalized to this name by their parsers.
 */
export const QUESTION_TOOL = "question";

export function isQuestionTool(tool: string): boolean {
  return tool === QUESTION_TOOL;
}

/**
 * A tool call counts as an operational failure only when a real tool errored.
 * An unanswered/aborted question carries status "error" but is a user
 * interaction, not a tool failure, so it must never inflate error metrics.
 */
export function isOperationalToolError(call: {
  tool: string;
  status: SessionToolStatus;
}): boolean {
  return call.status === "error" && !isQuestionTool(call.tool);
}

/**
 * Canonical plain-text rendering of a question interaction. Used both as the
 * tool call's fallback text (raw/plain-copy mode) and anywhere a non-card
 * representation is needed, so every surface shows the same wording.
 */
export function questionToPlainText(question: SessionQuestionContract): string {
  const lines: string[] = [];
  question.questions.forEach((item, index) => {
    const head = item.header ? `${item.header}: ` : "";
    lines.push(`Q${index + 1}. ${head}${item.question}`);
    for (const option of item.options) {
      const mark = item.selected.includes(option.label) ? "●" : "○";
      lines.push(`  ${mark} ${option.label}`);
    }
    const custom = item.selected.filter(
      (value) => !item.options.some((option) => option.label === value),
    );
    for (const value of custom) {
      lines.push(`  ▸ ${value}`);
    }
    if (item.selected.length === 0) {
      lines.push("  (回答なし)");
    }
    if (item.note) {
      lines.push(`  備考: ${item.note}`);
    }
  });
  return lines.join("\n");
}
