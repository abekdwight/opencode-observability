import React from "react";
import styles from "./DiffView.module.css";

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
    <pre className={styles.diffView}>
      {lines.map((line, i) => {
        let className: string | undefined;
        if (line.startsWith("+")) {
          className = styles.diffAdd;
        } else if (line.startsWith("-")) {
          className = styles.diffDel;
        } else if (line.startsWith("@@")) {
          className = styles.diffHunk;
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
