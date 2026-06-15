import React from "react";
import { questionToPlainText } from "../../../../src/contracts/question.js";
import type { SessionQuestionContract } from "../../../../src/contracts/session.js";
import { cn } from "../../../lib/cn";

export interface QuestionCardProps {
  question: SessionQuestionContract;
}

/**
 * Renders a user-question interaction inline in the message stream.
 *
 * Plain-mode duality mirrors message-row.tsx:
 *   - [data-message-content] rich card — hidden in plain mode
 *   - [data-message-raw]     plain text — shown only in plain mode
 * Both are keyed off the same CSS selectors in globals.css so no new
 * global rules are required.
 */
export const QuestionCard = React.memo(function QuestionCard({
  question,
}: QuestionCardProps) {
  const plainText = questionToPlainText(question);

  return (
    <div className="my-[var(--space-sm)]">
      {/* ── Rich card — hidden in plain mode ── */}
      <div
        data-message-content
        className={cn(
          "rounded-[var(--radius-lg)]",
          "border border-[var(--color-border-default)]",
          "bg-[var(--color-bg-elevated)]",
          "px-[var(--space-lg)] py-[var(--space-md)]",
          "shadow-[var(--shadow-sm)]",
        )}
      >
        {/* Card header */}
        <div className="mb-[var(--space-md)] flex items-center gap-[var(--space-sm)]">
          <span
            className={cn(
              "text-[0.75em] font-semibold leading-none",
              "rounded-[var(--radius-sm)]",
              "bg-[var(--color-tool-pill-bg)]",
              "border border-[var(--color-tool-pill-border)]",
              "px-[var(--space-sm)] py-[3px]",
              "text-[var(--color-tool-pill-strong-text)]",
            )}
          >
            🗳 質問
          </span>
        </div>

        {/* Question items */}
        <div className="flex flex-col gap-[var(--space-lg)]">
          {question.questions.map((item, index) => {
            // Free-text answers: selected values not matching any option label
            const optionLabels = new Set(item.options.map((o) => o.label));
            const freeTextAnswers = item.selected.filter(
              (value) => !optionLabels.has(value),
            );
            const isUnanswered = item.selected.length === 0;
            // Use question text + index for a stable, collision-resistant key.
            // Pure index keys are intentionally avoided (biome noArrayIndexKey).
            const itemKey = `q-${index}-${item.question.slice(0, 40)}`;

            return (
              <div
                key={itemKey}
                className={cn(
                  index > 0 &&
                    "border-t border-[var(--color-border-subtle)] pt-[var(--space-lg)]",
                )}
              >
                {/* Header chip + question text */}
                <div className="mb-[var(--space-sm)] flex flex-col gap-[var(--space-xs)]">
                  {item.header ? (
                    <span
                      className={cn(
                        "inline-block self-start",
                        "text-[0.72em] font-semibold uppercase tracking-wide",
                        "text-[var(--color-text-secondary)]",
                      )}
                    >
                      {item.header}
                    </span>
                  ) : null}
                  <p
                    className={cn(
                      "m-0 text-[0.93em] font-medium leading-snug",
                      "text-[var(--color-text-primary)]",
                    )}
                  >
                    {item.question}
                  </p>
                  {item.multiSelect ? (
                    <span className="text-[0.72em] text-[var(--color-text-tertiary)]">
                      複数選択可
                    </span>
                  ) : null}
                </div>

                {/* Options list */}
                {item.options.length > 0 ? (
                  <ul className="m-0 list-none p-0 flex flex-col gap-[var(--space-xs)]">
                    {item.options.map((option) => {
                      const isSelected = item.selected.includes(option.label);
                      return (
                        <li
                          key={option.label}
                          className={cn(
                            "flex items-start gap-[var(--space-sm)]",
                            "rounded-[var(--radius-sm)]",
                            "px-[var(--space-sm)] py-[var(--space-xs)]",
                            isSelected
                              ? "bg-[var(--color-success-bg)] border border-transparent"
                              : "border border-transparent",
                          )}
                        >
                          {/* Selection marker */}
                          <span
                            className={cn(
                              "mt-[1px] shrink-0 text-[0.85em] leading-none",
                              isSelected
                                ? "text-[var(--color-success)]"
                                : "text-[var(--color-text-tertiary)]",
                            )}
                            aria-hidden="true"
                          >
                            {isSelected ? "●" : "○"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "text-[0.88em] leading-snug",
                                isSelected
                                  ? "font-semibold text-[var(--color-text-primary)]"
                                  : "text-[var(--color-text-secondary)]",
                              )}
                            >
                              {option.label}
                            </span>
                            {option.description ? (
                              <span
                                className={cn(
                                  "ml-[var(--space-xs)] text-[0.8em]",
                                  "text-[var(--color-text-tertiary)]",
                                )}
                              >
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {/* Free-text answers (answers not matching any option) */}
                {freeTextAnswers.length > 0 ? (
                  <div
                    className={cn(
                      "mt-[var(--space-xs)]",
                      "flex flex-col gap-[var(--space-xs)]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[0.72em] font-semibold uppercase tracking-wide",
                        "text-[var(--color-text-tertiary)]",
                      )}
                    >
                      自由記述
                    </span>
                    {freeTextAnswers.map((value) => (
                      <div
                        key={value}
                        className={cn(
                          "flex items-start gap-[var(--space-sm)]",
                          "rounded-[var(--radius-sm)]",
                          "border border-[var(--color-border-subtle)]",
                          "bg-[var(--color-bg-surface)]",
                          "px-[var(--space-sm)] py-[var(--space-xs)]",
                        )}
                      >
                        <span
                          className="mt-[1px] shrink-0 text-[0.85em] leading-none text-[var(--color-text-tertiary)]"
                          aria-hidden="true"
                        >
                          ▸
                        </span>
                        <span className="text-[0.88em] text-[var(--color-text-primary)]">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Unanswered state */}
                {isUnanswered ? (
                  <div
                    className={cn(
                      "mt-[var(--space-xs)]",
                      "rounded-[var(--radius-sm)]",
                      "border border-dashed border-[var(--color-border-subtle)]",
                      "px-[var(--space-sm)] py-[var(--space-xs)]",
                    )}
                  >
                    <span className="text-[0.82em] text-[var(--color-text-tertiary)]">
                      回答なし
                    </span>
                  </div>
                ) : null}

                {/* Note */}
                {item.note ? (
                  <div
                    className={cn(
                      "mt-[var(--space-sm)]",
                      "flex items-start gap-[var(--space-sm)]",
                      "rounded-[var(--radius-sm)]",
                      "border-l-[3px] border-l-[var(--color-border-default)]",
                      "bg-[var(--color-bg-surface)]",
                      "px-[var(--space-sm)] py-[var(--space-xs)]",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 text-[0.72em] font-semibold uppercase tracking-wide",
                        "text-[var(--color-text-secondary)]",
                        "mt-[2px]",
                      )}
                    >
                      備考
                    </span>
                    <span className="text-[0.85em] text-[var(--color-text-primary)]">
                      {item.note}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Plain-text fallback — shown only in plain mode ── */}
      <div
        data-message-raw
        className="hidden whitespace-pre-wrap break-words font-[var(--font-sans)] text-[0.93em] leading-relaxed"
      >
        {plainText}
      </div>
    </div>
  );
});
