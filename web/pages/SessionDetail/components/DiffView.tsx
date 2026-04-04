import React from "react";
import { cn } from "../../../lib/cn";

export interface DiffViewProps {
  diff: string;
}

/**
 * Renders a colored diff output.
 * Each line is classified by its prefix: `+` (add), `-` (del), `@@` (hunk).
 */
export const DiffView = React.memo(function DiffView({ diff }: DiffViewProps) {
  const lines = React.useMemo(() => diff.split("\n"), [diff]);

  return (
    <pre
      className={cn(
        "text-[0.8em] leading-relaxed overflow-x-auto",
        "bg-[#1e1e1e] text-[#d4d4d4]",
        "p-[var(--space-lg)] rounded-[var(--radius-md)]",
        "whitespace-pre-wrap break-words",
        "max-h-[500px] overflow-y-auto m-0",
      )}
    >
      {lines.map((line, i) => {
        let className: string | undefined;
        if (line.startsWith("+")) {
          className = "text-[var(--color-diff-add)]";
        } else if (line.startsWith("-")) {
          className = "text-[var(--color-diff-del)]";
        } else if (line.startsWith("@@")) {
          className = "text-[var(--color-diff-hunk)]";
        }

        return (
          <React.Fragment key={i}>
            {i > 0 ? "\n" : null}
            {className ? (
              <span className={className}>{line}</span>
            ) : (
              line
            )}
          </React.Fragment>
        );
      })}
    </pre>
  );
});
