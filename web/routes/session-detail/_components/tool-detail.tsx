import React from "react";
import { cn } from "../../../lib/cn";

export interface ToolDetailProps {
  fullInput: string;
  fullOutput: string;
  error: string;
  open: boolean;
}

/**
 * Renders expandable tool detail panel showing input, output, and error sections.
 */
export const ToolDetail = React.memo(function ToolDetail({
  fullInput,
  fullOutput,
  error,
  open,
}: ToolDetailProps) {
  if (!open) return null;

  return (
    <div
      className={cn(
        "block w-full",
        "bg-[var(--color-bg-muted)] border border-[var(--color-border-subtle)]",
        "rounded-[var(--radius-md)] px-[var(--space-md)] py-[var(--space-sm)]",
        "my-0.5 text-[0.75em]",
      )}
    >
      {fullInput ? (
        <div className="mb-[var(--space-sm)] last:mb-0">
          <div className="font-semibold text-[var(--color-text-secondary)] text-[0.85em] uppercase tracking-wide mb-0.5">
            Input
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words text-[0.95em] text-[var(--color-text-primary)] max-h-[200px] overflow-y-auto">
            {fullInput}
          </pre>
        </div>
      ) : null}
      {fullOutput ? (
        <div className="mb-[var(--space-sm)] last:mb-0">
          <div className="font-semibold text-[var(--color-text-secondary)] text-[0.85em] uppercase tracking-wide mb-0.5">
            Output
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words text-[0.95em] text-[var(--color-text-primary)] max-h-[200px] overflow-y-auto">
            {fullOutput}
          </pre>
        </div>
      ) : null}
      {error ? (
        <div className="mb-[var(--space-sm)] last:mb-0">
          <div className="font-semibold text-[var(--color-text-secondary)] text-[0.85em] uppercase tracking-wide mb-0.5">
            Error
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words text-[0.95em] text-[var(--color-error-text)] max-h-[200px] overflow-y-auto">
            {error}
          </pre>
        </div>
      ) : null}
    </div>
  );
});
