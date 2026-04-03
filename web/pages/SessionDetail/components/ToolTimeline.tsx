import React from "react";
import type { SessionToolCallContract } from "../../../../src/contracts/session.js";
import { TOOL_ICONS } from "../lib/constants";
import { ToolDetail } from "./ToolDetail";
import styles from "./ToolTimeline.module.css";

export interface ToolTimelineProps {
  calls: SessionToolCallContract[];
  msgIdx: number;
  visible: boolean;
  openDetails: Set<string>;
  onToggleDetail: (id: string) => void;
}

/** Status to CSS module class mapping. */
const STATUS_CLASS: Record<string, string> = {
  pending: styles.statusPending,
  running: styles.statusRunning,
  completed: styles.statusCompleted,
  unknown: styles.statusUnknown,
  error: styles.statusError,
};

function buildDetailId(
  msgIdx: number,
  tc: SessionToolCallContract,
): string {
  return [
    `tool-detail-${msgIdx}`,
    tc.tool,
    tc.status,
    tc.input ?? "",
    tc.error ?? "",
    String(tc.durationMs),
  ].join("-");
}

function formatToolDuration(ms: number): string {
  if (ms <= 0) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Renders tool call pills for a single message.
 */
export const ToolTimeline = React.memo(function ToolTimeline({
  calls,
  msgIdx,
  visible,
  openDetails,
  onToggleDetail,
}: ToolTimelineProps) {
  const containerClass = visible
    ? styles.toolTimeline
    : `${styles.toolTimeline} ${styles.hidden}`;

  return (
    <div className={containerClass}>
      {calls.map((tc) => {
        const icon = TOOL_ICONS[tc.tool] || "\u{1F527}";
        const hasDetail = tc.fullInput || tc.fullOutput || tc.error;
        const detailId = buildDetailId(msgIdx, tc);
        const isOpen = openDetails.has(detailId);
        const durStr = formatToolDuration(tc.durationMs);
        const isSkillTool = tc.tool === "skill" || tc.tool === "skill_mcp";
        const statusClass = STATUS_CLASS[tc.status] ?? "";
        const lineBase = `${styles.toolLine} ${statusClass}`;

        const toolKey = [
          tc.tool,
          tc.status,
          tc.input ?? "",
          tc.error ?? "",
          String(tc.durationMs),
        ].join("-");

        const displayName =
          isSkillTool && tc.input ? `skill ${tc.input}` : tc.tool;

        const content = (
          <>
            {icon}{" "}
            <span className={styles.toolName}>{displayName}</span>
            {!isSkillTool && tc.input ? (
              <span className={styles.toolInput}>{tc.input}</span>
            ) : null}
            {durStr ? (
              <span className={styles.toolDur}>{durStr}</span>
            ) : null}
            {tc.status === "error" && tc.error ? (
              <span className={styles.toolError}>{tc.error}</span>
            ) : null}
          </>
        );

        return (
          <React.Fragment key={toolKey}>
            {hasDetail ? (
              <button
                type="button"
                className={`${lineBase} ${styles.toolLineClickable}`}
                onClick={() => onToggleDetail(detailId)}
              >
                {content}
              </button>
            ) : (
              <span className={lineBase}>{content}</span>
            )}
            {hasDetail ? (
              <ToolDetail
                fullInput={tc.fullInput}
                fullOutput={tc.fullOutput}
                error={tc.error}
                open={isOpen}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
});
