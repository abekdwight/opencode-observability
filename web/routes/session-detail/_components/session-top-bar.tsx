import React from "react";
import { Link } from "react-router-dom";
import type { SessionDetailContract } from "../../../../src/contracts/session.js";
import { cn } from "../../../lib/cn";

export interface SessionTopBarProps {
  session: SessionDetailContract["session"];
  copyState: "idle" | "copied" | "error";
  onCopy: () => void;
  onDelete: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasOmoContent: boolean;
  omoFilter: boolean;
  onToggleOmoFilter: () => void;
}

const copyBtnBase = cn(
  "border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]",
  "rounded-full px-[var(--space-sm)] py-[var(--space-sm)]",
  "text-[0.8em] text-[var(--color-text-primary)]",
  "inline-flex items-center gap-[var(--space-sm)]",
  "cursor-pointer transition-all duration-[var(--transition-medium)]",
  "hover:bg-[var(--color-accent-bg)]",
);

/**
 * Compact sub-header below the main app header showing session title + actions.
 */
export const SessionTopBar = React.memo(function SessionTopBar({
  session,
  copyState,
  onCopy,
  onDelete,
  sidebarOpen,
  onToggleSidebar,
  hasOmoContent,
  omoFilter,
  onToggleOmoFilter,
}: SessionTopBarProps) {
  const copyBtnClass = cn(
    copyBtnBase,
    copyState === "copied" && "bg-[var(--color-agent-chip-bg)] border-[#4caf50] text-[var(--color-agent-chip-text)]",
    copyState === "error" && "bg-[var(--color-error-bg)] border-[var(--color-error-border)] text-[var(--color-error)]",
  );

  return (
    <div className="h-9 flex items-center px-[var(--space-lg)] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
      <div className="flex items-center justify-between gap-[var(--space-md)] w-full min-h-0">
        <div className="flex items-center gap-[var(--space-sm)] min-w-0 flex-1">
          {session.parentId ? (
            <Link
              to={`/session/${encodeURIComponent(session.parentId)}`}
              className="text-[0.75em] whitespace-nowrap text-[var(--color-text-secondary)]"
            >
              {"\u21B3"} parent
            </Link>
          ) : null}
          <h1 className="text-[0.88em] font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis m-0">
            {session.title}
          </h1>
        </div>

        <div className="flex gap-[var(--space-sm)] items-center shrink-0">
          {hasOmoContent ? (
            <button
              type="button"
              className={cn(
                "h-[22px] px-1.5",
                "rounded-[var(--radius-sm)]",
                "border",
                "text-[0.7em] font-medium tracking-[0.02em]",
                "inline-flex items-center gap-1",
                "cursor-pointer transition-all duration-[var(--transition-fast)]",
                "select-none",
                omoFilter
                  ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)] border-[var(--color-accent)]"
                  : "bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)] border-[var(--color-border-default)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-secondary)]",
              )}
              onClick={onToggleOmoFilter}
              title={omoFilter ? "OMO\u30D5\u30A3\u30EB\u30BF ON\uFF08\u81EA\u52D5\u633F\u5165\u30B3\u30E1\u30F3\u30C8\u3092\u975E\u8868\u793A\uFF09" : "OMO\u30D5\u30A3\u30EB\u30BF OFF\uFF08\u3059\u3079\u3066\u8868\u793A\uFF09"}
              data-testid="btn-omo-filter"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M1.5 3h13M3.5 6.5h9M5.5 10h5M7 13.5h2" />
                {!omoFilter ? <path d="M13 3L3 13" strokeWidth="2" /> : null}
              </svg>
              <span className="font-[var(--font-mono)] leading-none">OMO</span>
            </button>
          ) : null}

          <button
            type="button"
            className={copyBtnClass}
            onClick={onCopy}
            aria-label={`${session.id} \u306E\u30B3\u30DE\u30F3\u30C9\u3092\u30B3\u30D4\u30FC`}
            title={"\u30B3\u30DE\u30F3\u30C9\u3092\u30B3\u30D4\u30FC"}
            data-testid="copy-command-btn"
          >
            {copyState === "copied" ? (
              <span className="w-[0.95em] h-[0.95em] inline-flex items-center justify-center shrink-0" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="block w-full h-full"
                  role="img"
                  aria-hidden="true"
                >
                  <title>Copied</title>
                  <polyline points="20 6 10 18 4 12" />
                </svg>
              </span>
            ) : (
              <span className="w-[0.95em] h-[0.95em] inline-flex items-center justify-center shrink-0" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="block w-full h-full"
                  role="img"
                  aria-hidden="true"
                >
                  <title>Copy</title>
                  <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </span>
            )}
            <span className="text-[0.8em] font-[var(--font-mono)] whitespace-nowrap">
              {session.id}
            </span>
          </button>

          <button
            type="button"
            className={cn(copyBtnBase, "hover:border-[var(--color-delete-hover)] hover:text-[var(--color-delete-hover)]")}
            onClick={onDelete}
            title={"\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u524A\u9664"}
            data-testid="delete-btn"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-hidden="true"
            >
              <title>Delete</title>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>

          <button
            type="button"
            className={cn(
              "px-[var(--space-lg)] py-[var(--space-sm)]",
              "rounded-[var(--radius-md)]",
              "border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]",
              "text-[var(--color-text-primary)] text-[0.82em] font-medium",
              "cursor-pointer transition-all duration-[var(--transition-fast)]",
              "flex items-center gap-1.5",
              "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
              sidebarOpen && "bg-[var(--color-accent)] !text-[var(--color-text-inverse)] !border-[var(--color-accent)]",
            )}
            onClick={onToggleSidebar}
            title={
              sidebarOpen
                ? "\u30B5\u30A4\u30C9\u30D0\u30FC\u3092\u9589\u3058\u308B"
                : "\u30B5\u30A4\u30C9\u30D0\u30FC\u3092\u958B\u304F"
            }
            data-testid="btn-sidebar-toggle"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="block"
              role="img"
              aria-hidden="true"
            >
              <title>Sidebar</title>
              <rect x="1" y="2" width="14" height="12" rx="2" />
              <line x1="10" y1="2" x2="10" y2="14" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
