import React from "react";
import type { MessageFileDiffContract } from "../../../../src/contracts/session.js";
import { cn } from "../../../lib/cn";
import { DiffView } from "./diff-view";

export interface FileDiffsProps {
  diffs: MessageFileDiffContract[];
}

function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  return parts.length <= 3 ? filePath : parts.slice(-3).join("/");
}

function toolLabel(tool: string): string {
  switch (tool) {
    case "edit":
      return "edit";
    case "apply_patch":
      return "patch";
    case "write":
      return "write";
    default:
      return tool;
  }
}

/**
 * Per-message file diff section. Shows a collapsible summary of files
 * changed, with expandable unified diffs for each file.
 */
export const FileDiffs = React.memo(function FileDiffs({
  diffs,
}: FileDiffsProps) {
  const [open, setOpen] = React.useState(false);
  const [expandedFiles, setExpandedFiles] = React.useState<Set<number>>(
    () => new Set(),
  );

  if (diffs.length === 0) return null;

  const totalAdditions = diffs.reduce((s, d) => s + d.additions, 0);
  const totalDeletions = diffs.reduce((s, d) => s + d.deletions, 0);
  const fileCount = new Set(diffs.map((d) => d.filePath)).size;
  const hasSubagent = diffs.some((d) => d.fromSubagent);

  const toggleFile = (idx: number) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="mb-2">
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1.5",
          "text-[0.78em] font-medium",
          "px-2 py-0.5 rounded-[var(--radius-sm)]",
          "border border-[var(--color-border-default)]",
          "bg-[var(--color-bg-surface)]",
          "text-[var(--color-text-secondary)]",
          "cursor-pointer transition-all duration-[var(--transition-fast)]",
          "hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]",
          open && "border-[var(--color-accent)] text-[var(--color-text-primary)]",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={cn(
            "transition-transform duration-[var(--transition-fast)]",
            open && "rotate-90",
          )}
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span>
          {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
        {totalAdditions > 0 ? (
          <span className="text-[var(--color-diff-add)]">
            +{totalAdditions}
          </span>
        ) : null}
        {totalDeletions > 0 ? (
          <span className="text-[var(--color-diff-del)]">
            -{totalDeletions}
          </span>
        ) : null}
        {hasSubagent ? (
          <span className="text-[var(--color-agent-chip-text)] text-[0.9em]">
            +sub
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {diffs.map((d, idx) => {
            const isExpanded = expandedFiles.has(idx);
            return (
              <div
                key={`${d.filePath}-${idx}`}
                className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden"
              >
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 text-left",
                    "text-[0.8em] cursor-pointer",
                    "bg-transparent border-none",
                    "hover:bg-[var(--color-accent-light)]",
                    "transition-colors duration-[var(--transition-fast)]",
                  )}
                  onClick={() => toggleFile(idx)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn(
                      "shrink-0 transition-transform duration-[var(--transition-fast)]",
                      isExpanded && "rotate-90",
                    )}
                    aria-hidden="true"
                  >
                    <path d="M6 4l4 4-4 4" />
                  </svg>
                  <span
                    className="font-[var(--font-mono)] text-[var(--color-text-primary)] truncate min-w-0"
                    title={d.filePath}
                  >
                    {shortenPath(d.filePath)}
                  </span>
                  <span className="shrink-0 rounded-[3px] bg-[var(--color-bg-muted)] px-1 py-px text-[0.85em] text-[var(--color-text-tertiary)]">
                    {toolLabel(d.tool)}
                  </span>
                  {d.additions > 0 ? (
                    <span className="shrink-0 text-[var(--color-diff-add)] text-[0.9em]">
                      +{d.additions}
                    </span>
                  ) : null}
                  {d.deletions > 0 ? (
                    <span className="shrink-0 text-[var(--color-diff-del)] text-[0.9em]">
                      -{d.deletions}
                    </span>
                  ) : null}
                  {d.isNewFile ? (
                    <span className="shrink-0 rounded-[3px] bg-[var(--color-success-bg)] px-1 py-px text-[0.85em] text-[var(--color-success)]">
                      new
                    </span>
                  ) : null}
                  {d.fromSubagent ? (
                    <span className="shrink-0 rounded-[3px] bg-[var(--color-agent-chip-bg)] px-1 py-px text-[0.85em] text-[var(--color-agent-chip-text)]">
                      sub
                    </span>
                  ) : null}
                </button>
                {isExpanded && d.diff ? (
                  <div className="border-t border-[var(--color-border-subtle)]">
                    <DiffView diff={d.diff} />
                  </div>
                ) : isExpanded && !d.diff ? (
                  <div className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-[0.8em] text-[var(--color-text-tertiary)]">
                    {d.isNewFile
                      ? "\u65B0\u898F\u30D5\u30A1\u30A4\u30EB\uFF08\u5DEE\u5206\u306A\u3057\uFF09"
                      : "\u5DEE\u5206\u30C7\u30FC\u30BF\u306A\u3057"}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
