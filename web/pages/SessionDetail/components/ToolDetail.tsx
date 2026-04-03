import React from "react";
import styles from "./ToolDetail.module.css";

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
    <div className={`${styles.toolDetail} ${styles.open}`}>
      {fullInput ? (
        <div className={styles.toolDetailSection}>
          <div className={styles.toolDetailLabel}>Input</div>
          <pre className={styles.toolDetailPre}>{fullInput}</pre>
        </div>
      ) : null}
      {fullOutput ? (
        <div className={styles.toolDetailSection}>
          <div className={styles.toolDetailLabel}>Output</div>
          <pre className={styles.toolDetailPre}>{fullOutput}</pre>
        </div>
      ) : null}
      {error ? (
        <div className={styles.toolDetailSection}>
          <div className={styles.toolDetailLabel}>Error</div>
          <pre className={`${styles.toolDetailPre} ${styles.toolDetailError}`}>
            {error}
          </pre>
        </div>
      ) : null}
    </div>
  );
});
