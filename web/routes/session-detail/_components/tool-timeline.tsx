import React from "react";
import type { SessionToolCallContract } from "../../../../src/contracts/session.js";
import { cn } from "../../../lib/cn";
import { TOOL_ICONS } from "../_lib/constants";
import { ToolDetail } from "./tool-detail";

export interface ToolTimelineProps {
  calls: SessionToolCallContract[];
  msgIdx: number;
  visible: boolean;
  openDetails: Set<string>;
  onToggleDetail: (id: string) => void;
  compact?: boolean;
}

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
  compact,
}: ToolTimelineProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-[var(--space-xs)]",
        compact
          ? "mb-[var(--space-xs)] px-[var(--space-sm)] py-[var(--space-xs)]"
          : "mb-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-sm)]",
        "bg-[var(--color-tool-bg)] rounded-[var(--radius-md)]",
        "border border-dashed border-[var(--color-tool-border)]",
        !visible && "hidden",
      )}
    >
      {calls.map((tc) => {
        const icon = TOOL_ICONS[tc.tool] || "\u{1F527}";
        const hasDetail = tc.fullInput || tc.fullOutput || tc.error;
        const detailId = buildDetailId(msgIdx, tc);
        const isOpen = openDetails.has(detailId);
        const durStr = formatToolDuration(tc.durationMs);
        const isSkillTool = tc.tool === "skill" || tc.tool === "skill_mcp";
        const isError = tc.status === "error";

        const toolKey = [
          tc.tool,
          tc.status,
          tc.input ?? "",
          tc.error ?? "",
          String(tc.durationMs),
        ].join("-");

        const displayName =
          isSkillTool && tc.input ? `skill ${tc.input}` : tc.tool;

        const lineClasses = cn(
          "text-[0.75em] px-[var(--space-sm)] py-0.5",
          "border rounded-[var(--radius-sm)]",
          "whitespace-nowrap inline-flex items-center gap-[var(--space-xs)]",
          "font-[inherit] leading-[inherit]",
          isError
            ? "bg-[var(--color-error-bg)] border-[var(--color-error-border)] text-[var(--color-error-text)]"
            : "bg-[var(--color-tool-pill-bg)] border-[var(--color-tool-pill-border)] text-[var(--color-tool-pill-text)]",
        );

        const content = (
          <>
            {icon}{" "}
            <span className="font-semibold text-[var(--color-tool-pill-strong-text)]">
              {displayName}
            </span>
            {!isSkillTool && tc.input ? (
              <span className="text-[var(--color-tool-pill-text)] max-w-[200px] overflow-hidden text-ellipsis">
                {tc.input}
              </span>
            ) : null}
            {durStr ? (
              <span className="text-[var(--color-tool-pill-muted-text)] text-[0.9em]">
                {durStr}
              </span>
            ) : null}
            {tc.status === "error" && tc.error ? (
              <span className="text-[var(--color-error)] font-medium inline-flex max-w-[260px] whitespace-nowrap overflow-hidden text-ellipsis">
                {tc.error}
              </span>
            ) : null}
          </>
        );

        return (
          <React.Fragment key={toolKey}>
            {hasDetail ? (
              <button
                type="button"
                className={cn(lineClasses, "cursor-pointer hover:border-[var(--color-tool-pill-hover-border)]")}
                onClick={() => onToggleDetail(detailId)}
              >
                {content}
              </button>
            ) : (
              <span className={lineClasses}>{content}</span>
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
