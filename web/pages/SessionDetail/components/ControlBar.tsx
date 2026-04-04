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

// ---------------------------------------------------------------------------
// HelpButton — ? icon with tooltip showing keyboard shortcuts
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
    <div className={styles.helpWrap} ref={ref}>
      <button
        type="button"
        className={styles.helpBtn}
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
        <div className={styles.helpTooltip}>
          <div className={styles.helpTitle}>キーボードショートカット</div>
          <table className={styles.helpTable}>
            <tbody>
              <tr><td className={styles.helpKey}><kbd>j</kbd> / <kbd>k</kbd></td><td>次 / 前のメッセージへジャンプ</td></tr>
              <tr><td className={styles.helpKey}><kbd>Ctrl</kbd>+<kbd>E</kbd></td><td>折りたたみ切替</td></tr>
              <tr><td className={styles.helpKey}><kbd>Ctrl</kbd>+<kbd>U</kbd></td><td>フィルタ切替（全/User/Assistant）</td></tr>
              <tr><td className={styles.helpKey}><kbd>Ctrl</kbd>+<kbd>M</kbd></td><td>Markdown / プレーンテキスト切替</td></tr>
              <tr><td className={styles.helpKey}><kbd>Ctrl</kbd>+<kbd>.</kbd></td><td>ツール呼出の表示切替</td></tr>
              <tr><td className={styles.helpKey}><kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>サイドバー切替</td></tr>
            </tbody>
          </table>
          <div className={styles.helpNote}>Mac: <kbd>Ctrl</kbd> の代わりに <kbd>Cmd</kbd> を使用</div>
        </div>
      ) : null}
    </div>
  );
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

        <div className={styles.ctrlSep} />

        <HelpButton />
      </div>
    </div>
  );
});
