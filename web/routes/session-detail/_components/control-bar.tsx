import React from "react";
import { cn } from "../../../lib/cn";
import type { FilterMode } from "../_lib/constants";
import { FILTER_LABELS } from "../_lib/constants";

export interface ControlBarProps {
  collapseEnabled: boolean;
  onToggleCollapse: () => void;
  filterMode: FilterMode;
  onCycleFilter: () => void;
  plainMode: boolean;
  onTogglePlain: () => void;
  toolsVisible: boolean;
  onToggleTools: () => void;
  navIndex: number;
  totalVisible: number;
  onJump: (dir: number) => void;
}

// ---------------------------------------------------------------------------
// HelpButton -- ? icon with tooltip showing keyboard shortcuts
// ---------------------------------------------------------------------------
function HelpButton() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={cn(
          "w-7 h-7 rounded-full",
          "border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]",
          "text-[var(--color-text-secondary)] cursor-pointer",
          "flex items-center justify-center p-0",
          "transition-all duration-[var(--transition-fast)]",
          "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        data-testid="btn-help"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" role="img" aria-hidden="true">
          <circle cx="8" cy="8" r="7" />
          <path d="M5.5 6a2.5 2.5 0 0 1 5 0c0 1.5-2.5 1.5-2.5 3" />
          <circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? (
        <div
          className={cn(
            "absolute bottom-[calc(100%+8px)] right-0",
            "bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]",
            "rounded-[var(--radius-md)] shadow-[0_4px_16px_rgba(0,0,0,0.12)]",
            "p-3 px-4 min-w-[280px] z-[100]",
            "animate-[helpFadeIn_0.12s_ease]",
          )}
        >
          <div className="text-[0.78em] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
            {"\u30AD\u30FC\u30DC\u30FC\u30C9\u30B7\u30E7\u30FC\u30C8\u30AB\u30C3\u30C8"}
          </div>
          <table className="w-full border-collapse text-[0.8em]">
            <tbody>
              <tr>
                <td className="whitespace-nowrap pr-4 py-0.5 align-middle text-[var(--color-text-secondary)]">
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">j</kbd>
                  {" / "}
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">k</kbd>
                </td>
                <td className="py-0.5 align-middle">{"\u6B21 / \u524D\u306E\u30E1\u30C3\u30BB\u30FC\u30B8\u3078\u30B8\u30E3\u30F3\u30D7"}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap pr-4 py-0.5 align-middle text-[var(--color-text-secondary)]">
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">Ctrl</kbd>
                  +
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">E</kbd>
                </td>
                <td className="py-0.5 align-middle">{"\u6298\u308A\u305F\u305F\u307F\u5207\u66FF"}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap pr-4 py-0.5 align-middle text-[var(--color-text-secondary)]">
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">Ctrl</kbd>
                  +
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">U</kbd>
                </td>
                <td className="py-0.5 align-middle">{"\u30D5\u30A3\u30EB\u30BF\u5207\u66FF\uFF08\u5168/User/Assistant\uFF09"}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap pr-4 py-0.5 align-middle text-[var(--color-text-secondary)]">
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">Ctrl</kbd>
                  +
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">M</kbd>
                </td>
                <td className="py-0.5 align-middle">{"Markdown / \u30D7\u30EC\u30FC\u30F3\u30C6\u30AD\u30B9\u30C8\u5207\u66FF"}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap pr-4 py-0.5 align-middle text-[var(--color-text-secondary)]">
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">Ctrl</kbd>
                  +
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">.</kbd>
                </td>
                <td className="py-0.5 align-middle">{"\u30C4\u30FC\u30EB\u547C\u51FA\u306E\u8868\u793A\u5207\u66FF"}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap pr-4 py-0.5 align-middle text-[var(--color-text-secondary)]">
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">Ctrl</kbd>
                  +
                  <kbd className="inline-block px-1.5 py-px text-[0.85em] font-[var(--font-mono)] bg-[var(--color-bg-page)] border border-[var(--color-border-default)] rounded-[3px] leading-snug">B</kbd>
                </td>
                <td className="py-0.5 align-middle">{"\u30B5\u30A4\u30C9\u30D0\u30FC\u5207\u66FF"}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-2 text-[0.72em] text-[var(--color-text-tertiary)]">
            {"Mac: "}
            <kbd className="font-[var(--font-mono)] text-[0.9em]">Ctrl</kbd>
            {" \u306E\u4EE3\u308F\u308A\u306B "}
            <kbd className="font-[var(--font-mono)] text-[0.9em]">Cmd</kbd>
            {" \u3092\u4F7F\u7528"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ctrlBtnBase = cn(
  "px-[var(--space-lg)] py-[var(--space-sm)]",
  "rounded-[var(--radius-md)]",
  "border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]",
  "text-[var(--color-text-primary)] text-[0.82em] font-medium",
  "cursor-pointer transition-all duration-[var(--transition-fast)]",
  "flex items-center gap-[var(--space-sm)]",
  "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
);

const ctrlBtnActive = cn(
  "bg-[var(--color-accent)] !text-[var(--color-text-inverse)]",
  "!border-[var(--color-accent)]",
);

/**
 * Bottom toolbar with collapse, filter, plain-mode, tools-toggle, and navigation controls.
 */
export const ControlBar = React.memo(function ControlBar({
  collapseEnabled,
  onToggleCollapse,
  filterMode,
  onCycleFilter,
  plainMode,
  onTogglePlain,
  toolsVisible,
  onToggleTools,
  navIndex,
  totalVisible,
  onJump,
}: ControlBarProps) {
  const navCounterText =
    totalVisible === 0 ? "- / -" : `${navIndex + 1} / ${totalVisible}`;

  const separator = (
    <div className="w-px h-5 bg-[var(--color-border-default)]" />
  );

  return (
    <div
      className={cn(
        "shrink-0",
        "bg-[var(--color-bg-surface-translucent)] backdrop-blur-[12px]",
        "border-t border-[var(--color-border-subtle)]",
        "px-[var(--space-lg)] py-[var(--space-sm)]",
        "z-[var(--z-control-bar)]",
      )}
      data-testid="control-bar"
    >
      <div className="flex gap-[var(--space-sm)] items-center justify-center flex-nowrap">
        <button
          type="button"
          className={cn(ctrlBtnBase, collapseEnabled && ctrlBtnActive)}
          onClick={onToggleCollapse}
          data-testid="btn-collapse"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            role="img"
            aria-hidden="true"
          >
            <title>Collapse</title>
            <path d="M4 6l4 4 4-4" />
          </svg>
          {"\u6298\u308A\u305F\u305F\u307F"}
        </button>

        {separator}

        <button
          type="button"
          className={cn(ctrlBtnBase, filterMode !== "all" && ctrlBtnActive)}
          onClick={onCycleFilter}
          data-testid="btn-filter"
        >
          {FILTER_LABELS[filterMode]}
        </button>

        {separator}

        <button
          type="button"
          className={cn(ctrlBtnBase, plainMode && ctrlBtnActive)}
          onClick={onTogglePlain}
          data-testid="btn-plain"
        >
          Aa
        </button>

        {separator}

        <button
          type="button"
          className={cn(ctrlBtnBase, toolsVisible && ctrlBtnActive)}
          onClick={onToggleTools}
          data-testid="btn-tools"
        >
          {"\u{1F527}"}
        </button>

        {separator}

        <button
          type="button"
          className={ctrlBtnBase}
          onClick={() => onJump(-1)}
          data-testid="btn-prev"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            role="img"
            aria-hidden="true"
          >
            <title>Previous</title>
            <path d="M12 10l-4-4-4 4" />
          </svg>
        </button>

        <span
          className="text-[0.8em] font-semibold text-[var(--color-text-secondary)] min-w-12 text-center tabular-nums"
          data-testid="nav-counter"
        >
          {navCounterText}
        </span>

        <button
          type="button"
          className={ctrlBtnBase}
          onClick={() => onJump(1)}
          data-testid="btn-next"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            role="img"
            aria-hidden="true"
          >
            <title>Next</title>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {separator}

        <HelpButton />
      </div>
    </div>
  );
});
