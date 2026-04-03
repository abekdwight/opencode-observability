import React from "react";
import { Link } from "react-router-dom";
import type { SessionDetailContract } from "../../../../src/contracts/session.js";
import styles from "./SessionTopBar.module.css";

export interface SessionTopBarProps {
  session: SessionDetailContract["session"];
  copyState: "idle" | "copied" | "error";
  onCopy: () => void;
  onDelete: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

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
}: SessionTopBarProps) {
  const copyBtnClass = [
    styles.sessionCopyBtn,
    copyState === "copied" ? styles.sessionCopyBtnCopied : "",
    copyState === "error" ? styles.sessionCopyBtnError : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sidebarToggleClass = sidebarOpen
    ? `${styles.sidebarToggleBtn} ${styles.sidebarToggleBtnActive}`
    : styles.sidebarToggleBtn;

  return (
    <div className={styles.sessionTopbar}>
      <div className={styles.sessionHeaderCompact}>
        <div className={styles.headerCompactLeft}>
          {session.parentId ? (
            <Link
              to={`/session/${encodeURIComponent(session.parentId)}`}
              className={styles.headerParentLink}
            >
              {"\u21B3"} parent
            </Link>
          ) : null}
          <h1 className={styles.sessionTitle}>{session.title}</h1>
        </div>

        <div className={styles.sessionHeaderActions}>
          <button
            type="button"
            className={copyBtnClass}
            onClick={onCopy}
            aria-label={`${session.id} \u306E\u30B3\u30DE\u30F3\u30C9\u3092\u30B3\u30D4\u30FC`}
            title={"\u30B3\u30DE\u30F3\u30C9\u3092\u30B3\u30D4\u30FC"}
            data-testid="copy-command-btn"
          >
            {copyState === "copied" ? (
              <span className={styles.sessionCopyIconCheck} aria-hidden="true">
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
                  <title>Copied</title>
                  <polyline points="20 6 10 18 4 12" />
                </svg>
              </span>
            ) : (
              <span className={styles.sessionCopyIconCopy} aria-hidden="true">
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
                  <title>Copy</title>
                  <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </span>
            )}
            <span className={styles.sessionCopyId}>{session.id}</span>
          </button>

          <button
            type="button"
            className={`${styles.sessionCopyBtn} ${styles.btnDelete}`}
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
            className={sidebarToggleClass}
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
