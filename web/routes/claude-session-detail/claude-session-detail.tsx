import React from "react";
import { Link, useParams } from "react-router-dom";
import type { ClaudeSessionDetailContract } from "../../../src/contracts/claude-sessions";
import { useJson } from "../../hooks/use-json";
import { cn } from "../../lib/cn";
import { useLayoutMode } from "../../lib/layout-context";
import { MessageList } from "../session-detail/_components/message-list";

const ctrlBtnBase = cn(
  "px-[var(--space-lg)] py-[var(--space-sm)]",
  "rounded-[var(--radius-md)]",
  "border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]",
  "text-[var(--color-text-primary)] text-[0.82em] font-medium whitespace-nowrap",
  "cursor-pointer transition-all duration-[var(--transition-fast)]",
  "flex shrink-0 items-center gap-[var(--space-sm)]",
  "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
);

const ctrlBtnActive = cn(
  "bg-[var(--color-accent)] !text-[var(--color-text-inverse)]",
  "!border-[var(--color-accent)]",
);

export function ClaudeSessionDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { setMode } = useLayoutMode();

  React.useEffect(() => {
    setMode("ide");
    return () => setMode("default");
  }, [setMode]);

  const { data, error, loading } = useJson<ClaudeSessionDetailContract>(
    `/api/claude-sessions/${encodeURIComponent(id)}`,
  );

  React.useEffect(() => {
    if (data) {
      document.title = `${data.session.title} — Claude Sessions`;
    }
    return () => {
      document.title = "OpenCode Telemetry";
    };
  }, [data]);

  const containerRef = React.useRef<HTMLDivElement>(null);

  // Per-tool / per-thinking disclosure state (functional, unlike Codex which
  // has no expandable entries).
  const [openDetails, setOpenDetails] = React.useState<Set<string>>(
    () => new Set(),
  );
  const handleToggleDetail = React.useCallback((detailId: string) => {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detailId)) {
        next.delete(detailId);
      } else {
        next.add(detailId);
      }
      return next;
    });
  }, []);

  const [collapseEnabled, setCollapseEnabled] = React.useState(true);
  const [plainMode, setPlainMode] = React.useState(false);
  const [toolsVisible, setToolsVisible] = React.useState(true);

  React.useEffect(() => {
    document.body.classList.toggle("plain-mode", plainMode);
    return () => {
      document.body.classList.remove("plain-mode");
    };
  }, [plainMode]);

  const notFound = error === "HTTP 404";

  if (loading) {
    return (
      <section className="grid gap-2.5">
        <p
          className="m-0 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading Claude session...
        </p>
      </section>
    );
  }

  if (error && !notFound) {
    return (
      <section className="grid gap-2.5">
        <p
          className="m-0 rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Failed to load Claude session: {error}
        </p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="grid gap-2.5">
        <p
          className="m-0 rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Claude session not found.
        </p>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="session-detail-page flex-1 flex flex-col overflow-hidden p-0">
      {/* Header — matches SessionTopBar visual structure */}
      <div className="h-9 flex items-center px-[var(--space-lg)] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
        <div className="flex items-center justify-between gap-[var(--space-md)] w-full min-h-0">
          <div className="flex items-center gap-[var(--space-sm)] min-w-0 flex-1">
            <Link
              to="/claude-sessions"
              className="text-[0.75em] whitespace-nowrap text-[var(--color-text-secondary)]"
            >
              ← Claude
            </Link>
            <h1 className="text-[0.88em] font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis m-0">
              {data.session.title}
            </h1>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 w-full">
          <MessageList
            messages={data.messages}
            filterMode={"all"}
            omoFilter={false}
            toolsVisible={toolsVisible}
            plainMode={plainMode}
            collapseEnabled={collapseEnabled}
            openDetails={openDetails}
            onToggleToolDetail={handleToggleDetail}
            containerRef={containerRef}
          />

          {/* Bottom bar — matches ControlBar structure */}
          <div
            className={cn(
              "shrink-0",
              "bg-[var(--color-bg-surface-translucent)] backdrop-blur-[12px]",
              "border-t border-[var(--color-border-subtle)]",
              "control-bar-safe-area px-[var(--space-lg)] pt-[var(--space-sm)]",
              "z-[var(--z-control-bar)]",
            )}
            data-testid="control-bar"
          >
            <div className="flex gap-[var(--space-sm)] items-center justify-start md:justify-center flex-nowrap overflow-x-auto overscroll-x-contain">
              <button
                type="button"
                className={cn(
                  ctrlBtnBase,
                  collapseEnabled && !plainMode && ctrlBtnActive,
                  plainMode && "opacity-40 cursor-not-allowed",
                )}
                onClick={() => setCollapseEnabled((p) => !p)}
                disabled={plainMode}
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
                折りたたみ
              </button>

              <div className="w-px h-5 bg-[var(--color-border-default)]" />

              <button
                type="button"
                className={cn(ctrlBtnBase, plainMode && ctrlBtnActive)}
                onClick={() => setPlainMode((p) => !p)}
                data-testid="btn-plain"
              >
                Aa
              </button>

              <div className="w-px h-5 bg-[var(--color-border-default)]" />

              <button
                type="button"
                className={cn(ctrlBtnBase, toolsVisible && ctrlBtnActive)}
                onClick={() => setToolsVisible((p) => !p)}
                data-testid="btn-tools"
              >
                {"\u{1F527}"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
