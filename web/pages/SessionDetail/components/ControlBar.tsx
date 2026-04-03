import React from "react";
import type { FilterMode } from "../lib/constants";
import { FILTER_LABELS } from "../lib/constants";
import styles from "./ControlBar.module.css";

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

  return (
    <div className={styles.controlBar} data-testid="control-bar">
      <div className={styles.controlBarInner}>
        <button
          type="button"
          className={`${styles.ctrlBtn}${collapseEnabled ? ` ${styles.ctrlBtnActive}` : ""}`}
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

        <div className={styles.ctrlSep} />

        <button
          type="button"
          className={`${styles.ctrlBtn}${filterMode !== "all" ? ` ${styles.ctrlBtnActive}` : ""}`}
          onClick={onCycleFilter}
          data-testid="btn-filter"
        >
          {FILTER_LABELS[filterMode]}
        </button>

        <div className={styles.ctrlSep} />

        <button
          type="button"
          className={`${styles.ctrlBtn}${plainMode ? ` ${styles.ctrlBtnActive}` : ""}`}
          onClick={onTogglePlain}
          data-testid="btn-plain"
        >
          Aa
        </button>

        <div className={styles.ctrlSep} />

        <button
          type="button"
          className={`${styles.ctrlBtn}${toolsVisible ? ` ${styles.ctrlBtnActive}` : ""}`}
          onClick={onToggleTools}
          data-testid="btn-tools"
        >
          {"\u{1F527}"}
        </button>

        <div className={styles.ctrlSep} />

        <button
          type="button"
          className={styles.ctrlBtn}
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

        <span className={styles.navCounter} data-testid="nav-counter">
          {navCounterText}
        </span>

        <button
          type="button"
          className={styles.ctrlBtn}
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
      </div>
    </div>
  );
});
