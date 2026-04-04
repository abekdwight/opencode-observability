import React from "react";
import type {
  SessionDetailContract,
  SessionToolCallContract,
} from "../../../../src/contracts/session.js";
import { renderSafeMarkdown as renderSharedMarkdown } from "../../../../src/lib/rendering.js";
import {
  formatDuration,
  formatTimestamp,
  formatTokens,
} from "../../../lib/format";
import { DiffView } from "./DiffView";
import styles from "./SessionSidebar.module.css";

export interface SessionSidebarProps {
  data: SessionDetailContract;
  open: boolean;
  openDetails: Set<string>;
  onToggleDetail: (id: string) => void;
}

// ---------------------------------------------------------------------------
// SkillDetailContent (sidebar-local) -- renders skill input/output with markdown
// ---------------------------------------------------------------------------
function SkillDetailContent({
  fullInput,
  fullOutput,
  error,
}: {
  fullInput: string;
  fullOutput: string;
  error: string;
}) {
  const outputHtml = React.useMemo(
    () => (fullOutput ? renderSharedMarkdown(fullOutput) : ""),
    [fullOutput],
  );
  const outputRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (outputRef.current && outputHtml) {
      outputRef.current.innerHTML = outputHtml;
    }
  }, [outputHtml]);

  return (
    <div style={{ marginTop: 4 }}>
      {fullInput ? (
        <div style={{ marginBottom: 6 }}>
          <div
            style={{
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              fontSize: "0.85em",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              marginBottom: 2,
            }}
          >
            Input
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "0.95em",
              color: "#333",
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {fullInput}
          </pre>
        </div>
      ) : null}
      {fullOutput ? (
        <div style={{ marginBottom: 6 }}>
          <div
            style={{
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              fontSize: "0.85em",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              marginBottom: 2,
            }}
          >
            Output
          </div>
          <div ref={outputRef} />
        </div>
      ) : null}
      {error ? (
        <div>
          <div
            style={{
              fontWeight: 600,
              color: "var(--color-text-secondary)",
              fontSize: "0.85em",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              marginBottom: 2,
            }}
          >
            Error
          </div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "0.95em",
              color: "var(--color-error-text)",
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {error}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: Skill invocation type
// ---------------------------------------------------------------------------
interface SkillInvocation {
  name: string;
  tool: string;
  durationMs: number;
  status: SessionToolCallContract["status"];
  fullInput: string;
  fullOutput: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Resize handle hook — drag left edge to change sidebar width
// ---------------------------------------------------------------------------
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 360;
const SIDEBAR_WIDTH_KEY = "ot-sidebar-width";

function useSidebarResize() {
  const [width, setWidth] = React.useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) {
        const n = Number(saved);
        if (n >= SIDEBAR_MIN_WIDTH && n <= SIDEBAR_MAX_WIDTH) return n;
      }
    } catch { /* ignore */ }
    return SIDEBAR_DEFAULT_WIDTH;
  });

  const dragRef = React.useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startWidth: width };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Dragging left increases width (sidebar is on the right)
      const delta = drag.startX - e.clientX;
      const next = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, drag.startWidth + delta),
      );
      setWidth(next);
    },
    [],
  );

  const onPointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      } catch { /* ignore */ }
    },
    [width],
  );

  return { width, onPointerDown, onPointerMove, onPointerUp };
}

/**
 * Right sidebar panel with overview stats, models, skills, todos, and diffs.
 */
export const SessionSidebar = React.memo(function SessionSidebar({
  data,
  open,
  openDetails,
  onToggleDetail,
}: SessionSidebarProps) {
  const resize = useSidebarResize();
  const prettyDir = data.session.directory;
  const todos = data.todos ?? [];
  const doneCount = todos.filter((t) => t.status === "completed").length;

  // Compute loaded skills
  const { loadedSkillNames, skillInvocations } = React.useMemo(() => {
    const invocations: SkillInvocation[] = [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const msg of data.messages) {
      for (const tc of msg.toolCalls) {
        if ((tc.tool === "skill" || tc.tool === "skill_mcp") && tc.input) {
          if (!seen.has(tc.input)) {
            seen.add(tc.input);
            names.push(tc.input);
          }
          invocations.push({
            name: tc.input,
            tool: tc.tool,
            durationMs: tc.durationMs,
            status: tc.status,
            fullInput: tc.fullInput,
            fullOutput: tc.fullOutput,
            error: tc.error,
          });
        }
      }
    }
    return { loadedSkillNames: names, skillInvocations: invocations };
  }, [data.messages]);

  const sidebarClass = open
    ? styles.sessionSidebar
    : `${styles.sessionSidebar} ${styles.sessionSidebarCollapsed}`;

  return (
    <aside
      className={sidebarClass}
      data-testid="session-sidebar"
      style={{ width: open ? resize.width : undefined }}
    >
      {/* Resize handle — drag to change width */}
      <div
        className={styles.resizeHandle}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onPointerCancel={resize.onPointerUp}
      />
      <div className={styles.sidebarScroll}>
        {/* Quick stats */}
        <div className={styles.sidebarSection}>
          <div className={styles.sidebarSectionTitle}>Overview</div>
          <div className={styles.sidebarStats}>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatLabel}>Duration</span>
              <span className={styles.sidebarStatValue}>
                {formatDuration(data.durationMs)}
              </span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatLabel}>Started</span>
              <span className={styles.sidebarStatValue}>
                {formatTimestamp(data.session.createdAt)}
              </span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatLabel}>Messages</span>
              <span className={styles.sidebarStatValue}>
                {data.messages.length}
                <span className={styles.sidebarStatSub}>
                  User{" "}
                  {data.messages.filter((m) => m.role === "user").length} /
                  Assistant{" "}
                  {data.messages.filter((m) => m.role === "assistant").length}
                </span>
              </span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatLabel}>Tool Calls</span>
              <span className={styles.sidebarStatValue}>
                {data.messages.reduce(
                  (sum, m) => sum + m.toolCalls.length,
                  0,
                )}
                {data.subagents.length > 0 ? (
                  <span className={styles.sidebarStatSub}>
                    Subagents {data.subagents.length}
                  </span>
                ) : null}
              </span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatLabel}>Tokens</span>
              <span className={styles.sidebarStatValue}>
                {formatTokens(data.tokens.total)}
                <span className={styles.sidebarStatSub}>
                  In {formatTokens(data.tokens.input)} / Out{" "}
                  {formatTokens(data.tokens.output)}
                </span>
              </span>
            </div>
            <div className={styles.sidebarStat}>
              <span className={styles.sidebarStatLabel}>Cost</span>
              <span className={styles.sidebarStatValue}>
                {data.tokens.cost > 0
                  ? `$${data.tokens.cost.toFixed(4)}`
                  : "$0.00"}
              </span>
            </div>
            {(data.session.summary?.files ?? 0) > 0 ? (
              <div className={styles.sidebarStat}>
                <span className={styles.sidebarStatLabel}>File Changes</span>
                <span className={styles.sidebarStatValue}>
                  {data.session.summary.files} files
                  <span className={styles.sidebarStatSub}>
                    +{data.session.summary.additions} -{data.session.summary.deletions}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Directory */}
        <div className={styles.sidebarSection}>
          <div className={styles.sidebarSectionTitle}>Directory</div>
          <div className={styles.sidebarDir}>{prettyDir}</div>
        </div>

        {/* Model Breakdown */}
        {data.modelBreakdown.length > 0 ? (
          <details
            className={`${styles.sidebarSection} ${styles.sidebarAccordion}`}
            data-testid="model-breakdown-accordion"
          >
            <summary className={styles.sidebarAccordionSummary}>
              Models{" "}
              <span className={styles.sidebarBadge}>
                {data.modelBreakdown.length}
              </span>
            </summary>
            <div className={styles.sidebarAccordionBody}>
              {data.modelBreakdown.map((model) => (
                <div
                  key={`${model.modelId}-${model.providerId}`}
                  className={styles.sidebarModelRow}
                >
                  <div className={styles.sidebarModelName}>
                    {model.modelId}
                  </div>
                  <div className={styles.sidebarModelMeta}>
                    <span>{model.providerId}</span>
                    <span>{model.messageCount} msgs</span>
                    <span>{formatTokens(model.totalTokens)} tokens</span>
                    <span>
                      {model.totalCost > 0
                        ? `$${model.totalCost.toFixed(4)}`
                        : "$0.00"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {/* Loaded Skills — always shown */}
        <details
          className={`${styles.sidebarSection} ${styles.sidebarAccordion}`}
          data-testid="loaded-skills-accordion"
        >
          <summary className={styles.sidebarAccordionSummary}>
            Skills{" "}
            <span className={styles.sidebarBadge}>
              {loadedSkillNames.length}
            </span>
          </summary>
          <div className={styles.sidebarAccordionBody}>
            {loadedSkillNames.length === 0 ? (
              <div className={styles.sidebarEmpty}>No skills loaded</div>
            ) : null}
            {loadedSkillNames.map((skillName) => {
                const invocations = skillInvocations.filter(
                  (s) => s.name === skillName,
                );
                const lastInvocation = invocations[invocations.length - 1];
                const hasDetail =
                  lastInvocation?.fullInput || lastInvocation?.fullOutput;
                const detailId = `skill-detail-${skillName}`;
                const isSkillOpen = openDetails.has(detailId);
                const durStr =
                  lastInvocation.durationMs > 0
                    ? lastInvocation.durationMs < 1000
                      ? `${lastInvocation.durationMs}ms`
                      : `${(lastInvocation.durationMs / 1000).toFixed(1)}s`
                    : "";
                return (
                  <div key={skillName} className={styles.sidebarSkillRow}>
                    {hasDetail ? (
                      <button
                        type="button"
                        className={styles.skillLineButton}
                        onClick={() => onToggleDetail(detailId)}
                      >
                        {"\u2699\uFE0F"} <span>{skillName}</span>
                        {durStr ? (
                          <span style={{ color: "#aaa", fontSize: "0.9em" }}>
                            {durStr}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {"\u2699\uFE0F"} <span>{skillName}</span>
                        {durStr ? (
                          <span style={{ color: "#aaa", fontSize: "0.9em" }}>
                            {durStr}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {hasDetail && isSkillOpen ? (
                      <SkillDetailContent
                        fullInput={lastInvocation.fullInput}
                        fullOutput={lastInvocation.fullOutput}
                        error={lastInvocation.error}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>

        {/* Todos */}
        {todos.length > 0 ? (
          <details
            className={`${styles.sidebarSection} ${styles.sidebarAccordion}`}
            data-testid="todos-accordion"
          >
            <summary className={styles.sidebarAccordionSummary}>
              Todos{" "}
              <span className={styles.sidebarBadge}>
                {doneCount}/{todos.length}
              </span>
            </summary>
            <div className={styles.sidebarAccordionBody}>
              {todos.map((t) => {
                const icon =
                  t.status === "completed"
                    ? "\u2705"
                    : t.status === "in_progress"
                      ? "\u{1F504}"
                      : t.status === "cancelled"
                        ? "\u274C"
                        : "\u2B1C";
                const dim =
                  t.status === "completed" || t.status === "cancelled";
                return (
                  <div
                    key={`${t.content}-${t.status}-${t.priority}`}
                    className={styles.todoItem}
                    style={dim ? { opacity: 0.6 } : undefined}
                  >
                    {icon} <span>{t.content}</span>
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}

        {/* Diffs */}
        {data.summaryDiffs ? (
          <details
            className={`${styles.sidebarSection} ${styles.sidebarAccordion}`}
            data-testid="diffs-card"
          >
            <summary className={styles.sidebarAccordionSummary}>
              Changes
            </summary>
            <div className={styles.sidebarAccordionBody}>
              <DiffView diff={data.summaryDiffs} />
            </div>
          </details>
        ) : null}
      </div>
    </aside>
  );
});
