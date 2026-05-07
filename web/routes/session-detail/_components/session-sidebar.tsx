import React from "react";
import type {
  SessionDetailContract,
  SessionToolCallContract,
} from "../../../../src/contracts/session.js";
import { renderSafeMarkdown as renderSharedMarkdown } from "../../../../src/lib/rendering.js";
import { cn } from "../../../lib/cn";
import {
  formatDuration,
  formatTimestamp,
  formatTokens,
} from "../../../lib/format";
import { DiffView } from "./diff-view";

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
          <div ref={outputRef} data-message-content />
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
// Resize handle hook -- drag left edge to change sidebar width
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

// ---------------------------------------------------------------------------
// Sidebar accordion section title classes
// ---------------------------------------------------------------------------
const sectionTitleClasses = cn(
  "text-[0.7em] font-bold uppercase tracking-widest",
  "text-[var(--color-text-secondary)]",
  "mb-[var(--space-sm)] pb-[var(--space-xs)]",
  "border-b border-[var(--color-border-subtle)]",
);

const accordionSummaryClasses = cn(
  "text-[0.7em] font-bold uppercase tracking-widest",
  "text-[var(--color-text-secondary)]",
  "cursor-pointer py-[var(--space-sm)]",
  "border-b border-[var(--color-border-subtle)]",
  "list-none flex items-center gap-[var(--space-sm)]",
);

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
  const toolEvents = Array.isArray(data.toolEvents)
    ? data.toolEvents
    : data.messages.flatMap((message) => message.toolCalls);

  // Compute loaded skills
  const {
    loadedSkillNames,
    skillInvocations,
    loadedToolNames,
    toolInvocations,
  } = React.useMemo(() => {
    const invocations: SkillInvocation[] = [];
    const nonSkillInvocations: SkillInvocation[] = [];
    const names: string[] = [];
    const toolNames: string[] = [];
    const seen = new Set<string>();
    const seenTools = new Set<string>();
    for (const tc of toolEvents) {
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
        continue;
      }
      const toolName = tc.tool || "unknown";
      if (!seenTools.has(toolName)) {
        seenTools.add(toolName);
        toolNames.push(toolName);
      }
      nonSkillInvocations.push({
        name: toolName,
        tool: tc.tool,
        durationMs: tc.durationMs,
        status: tc.status,
        fullInput: tc.fullInput,
        fullOutput: tc.fullOutput,
        error: tc.error,
      });
    }
    return {
      loadedSkillNames: names,
      skillInvocations: invocations,
      loadedToolNames: toolNames,
      toolInvocations: nonSkillInvocations,
    };
  }, [toolEvents]);

  return (
    <aside
      className={cn(
        "absolute top-0 right-0 bottom-0 w-[360px]",
        "border-l border-[var(--color-border-subtle)]",
        "bg-[var(--color-bg-surface-translucent)] backdrop-blur-[12px]",
        "flex flex-col overflow-hidden",
        "z-[var(--z-sidebar)] shadow-[var(--shadow-sidebar)]",
        "translate-x-0 transition-[transform,opacity] duration-200",
        "max-[600px]:w-full max-[600px]:border-l-0",
        !open && "translate-x-full opacity-0 pointer-events-none",
      )}
      data-testid="session-sidebar"
      style={{ width: open ? resize.width : undefined }}
    >
      {/* Resize handle -- drag to change width */}
      <div
        className={cn(
          "absolute top-0 -left-[3px] bottom-0 w-1.5",
          "cursor-col-resize z-[1]",
          "bg-transparent transition-[background] duration-150",
          "hover:bg-[var(--color-accent)] hover:opacity-30",
          "active:bg-[var(--color-accent)] active:opacity-30",
        )}
        onPointerDown={resize.onPointerDown}
        onPointerMove={resize.onPointerMove}
        onPointerUp={resize.onPointerUp}
        onPointerCancel={resize.onPointerUp}
      />
      <div className="flex-1 overflow-y-auto px-[var(--space-xl)] py-[var(--space-lg)]">
        {/* Quick stats */}
        <div className="mb-[var(--space-lg)]">
          <div className={sectionTitleClasses}>Overview</div>
          <div className="flex flex-col gap-[var(--space-sm)]">
            <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)] border-b border-[var(--color-border-faint)]">
              <span className="text-[var(--color-text-secondary)] font-medium shrink-0">Duration</span>
              <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                {formatDuration(data.durationMs)}
              </span>
            </div>
            <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)] border-b border-[var(--color-border-faint)]">
              <span className="text-[var(--color-text-secondary)] font-medium shrink-0">Started</span>
              <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                {formatTimestamp(data.session.createdAt)}
              </span>
            </div>
            <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)] border-b border-[var(--color-border-faint)]">
              <span className="text-[var(--color-text-secondary)] font-medium shrink-0">Messages</span>
              <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                {data.messages.length}
                <span className="text-[0.85em] font-normal text-[var(--color-text-tertiary)]">
                  User{" "}
                  {data.messages.filter((m) => m.role === "user").length} /
                  Assistant{" "}
                  {data.messages.filter((m) => m.role === "assistant").length}
                </span>
              </span>
            </div>
            <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)] border-b border-[var(--color-border-faint)]">
              <span className="text-[var(--color-text-secondary)] font-medium shrink-0">Tool Calls</span>
              <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                {toolEvents.length}
                {data.subagents.length > 0 ? (
                  <span className="text-[0.85em] font-normal text-[var(--color-text-tertiary)]">
                    Subagents {data.subagents.length}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)] border-b border-[var(--color-border-faint)]">
              <span className="text-[var(--color-text-secondary)] font-medium shrink-0">Tokens</span>
              <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                {formatTokens(data.tokens.total)}
                <span className="text-[0.85em] font-normal text-[var(--color-text-tertiary)]">
                  In {formatTokens(data.tokens.input)} / Out{" "}
                  {formatTokens(data.tokens.output)}
                </span>
              </span>
            </div>
            <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)] border-b border-[var(--color-border-faint)] last:border-b-0">
              <span className="text-[var(--color-text-secondary)] font-medium shrink-0">Cost</span>
              <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                {data.tokens.cost > 0
                  ? `$${data.tokens.cost.toFixed(4)}`
                  : "$0.00"}
              </span>
            </div>
            {(data.session.summary?.files ?? 0) > 0 ? (
              <div className="flex justify-between items-baseline text-[0.82em] py-[var(--space-xs)]">
                <span className="text-[var(--color-text-secondary)] font-medium shrink-0">File Changes</span>
                <span className="font-semibold text-[var(--color-text-primary)] text-right flex flex-col items-end">
                  {data.session.summary.files} files
                  <span className="text-[0.85em] font-normal text-[var(--color-text-tertiary)]">
                    +{data.session.summary.additions} -{data.session.summary.deletions}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Directory */}
        <div className="mb-[var(--space-lg)]">
          <div className={sectionTitleClasses}>Directory</div>
          <div className="text-[0.75em] font-[var(--font-mono)] text-[var(--color-text-secondary)] break-all">
            {prettyDir}
          </div>
        </div>

        {/* Todos */}
        {todos.length > 0 ? (
          <details
            className="mb-[var(--space-lg)] border-none bg-transparent p-0 rounded-none"
            data-testid="todos-accordion"
          >
            <summary className={cn(accordionSummaryClasses, "[&::-webkit-details-marker]:hidden before:content-['\\25B6'] before:text-[0.7em] before:transition-transform before:duration-[var(--transition-fast)] [details[open]>&]:before:rotate-90")}>
              Todos{" "}
              <span className="bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[0.9em] font-semibold px-1.5 py-px rounded-[var(--radius-sm)]">
                {doneCount}/{todos.length}
              </span>
            </summary>
            <div className="py-[var(--space-sm)]">
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
                    className="text-[0.9em] py-[var(--space-xs)] flex gap-[var(--space-sm)] items-start"
                    style={dim ? { opacity: 0.6 } : undefined}
                  >
                    {icon} <span>{t.content}</span>
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}

        {/* Model Breakdown */}
        {data.modelBreakdown.length > 0 ? (
          <details
            className="mb-[var(--space-lg)] border-none bg-transparent p-0 rounded-none"
            data-testid="model-breakdown-accordion"
          >
            <summary className={cn(accordionSummaryClasses, "[&::-webkit-details-marker]:hidden before:content-['\\25B6'] before:text-[0.7em] before:transition-transform before:duration-[var(--transition-fast)] [details[open]>&]:before:rotate-90")}>
              Models{" "}
              <span className="bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[0.9em] font-semibold px-1.5 py-px rounded-[var(--radius-sm)]">
                {data.modelBreakdown.length}
              </span>
            </summary>
            <div className="py-[var(--space-sm)]">
              {data.modelBreakdown.map((model) => (
                <div
                  key={`${model.modelId}-${model.providerId}`}
                  className="py-[var(--space-sm)] border-b border-[var(--color-border-faint)] last:border-b-0"
                >
                  <div className="text-[0.82em] font-semibold text-[var(--color-text-primary)] mb-0.5">
                    {model.modelId}
                  </div>
                  <div className="flex flex-wrap gap-[var(--space-sm)] text-[0.72em] text-[var(--color-text-tertiary)]">
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

        {/* Loaded Skills -- always shown */}
        <details
          className="mb-[var(--space-lg)] border-none bg-transparent p-0 rounded-none"
          data-testid="loaded-skills-accordion"
        >
          <summary className={cn(accordionSummaryClasses, "[&::-webkit-details-marker]:hidden before:content-['\\25B6'] before:text-[0.7em] before:transition-transform before:duration-[var(--transition-fast)] [details[open]>&]:before:rotate-90")}>
            Skills{" "}
            <span className="bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[0.9em] font-semibold px-1.5 py-px rounded-[var(--radius-sm)]">
              {loadedSkillNames.length}
            </span>
          </summary>
          <div className="py-[var(--space-sm)]">
            {loadedSkillNames.length === 0 ? (
              <div className="text-[0.8em] text-[var(--color-text-tertiary)] py-[var(--space-xs)]">
                No skills loaded
              </div>
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
                  <div key={skillName} className="py-[var(--space-xs)]">
                    {hasDetail ? (
                      <button
                        type="button"
                        className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center gap-[var(--space-sm)]"
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

        {/* Tools -- always shown */}
        <details
          className="mb-[var(--space-lg)] border-none bg-transparent p-0 rounded-none"
          data-testid="loaded-tools-accordion"
        >
          <summary className={cn(accordionSummaryClasses, "[&::-webkit-details-marker]:hidden before:content-['\\25B6'] before:text-[0.7em] before:transition-transform before:duration-[var(--transition-fast)] [details[open]>&]:before:rotate-90")}>
            Tools{" "}
            <span className="bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-[0.9em] font-semibold px-1.5 py-px rounded-[var(--radius-sm)]">
              {loadedToolNames.length}
            </span>
          </summary>
          <div className="py-[var(--space-sm)]">
            {loadedToolNames.length === 0 ? (
              <div className="text-[0.8em] text-[var(--color-text-tertiary)] py-[var(--space-xs)]">
                No tools used
              </div>
            ) : null}
            {loadedToolNames.map((toolName) => {
                const invocations = toolInvocations.filter(
                  (t) => t.name === toolName,
                );
                const lastInvocation = invocations[invocations.length - 1];
                const hasDetail =
                  lastInvocation?.fullInput || lastInvocation?.fullOutput;
                const detailId = `tool-detail-${toolName}`;
                const isToolOpen = openDetails.has(detailId);
                const durStr =
                  lastInvocation.durationMs > 0
                    ? lastInvocation.durationMs < 1000
                      ? `${lastInvocation.durationMs}ms`
                      : `${(lastInvocation.durationMs / 1000).toFixed(1)}s`
                    : "";
                return (
                  <div key={toolName} className="py-[var(--space-xs)]">
                    {hasDetail ? (
                      <button
                        type="button"
                        className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center gap-[var(--space-sm)]"
                        onClick={() => onToggleDetail(detailId)}
                      >
                        {"\u{1F6E0}\uFE0F"} <span>{toolName}</span>
                        <span style={{ color: "#aaa", fontSize: "0.9em" }}>
                          {invocations.length}x
                        </span>
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
                        {"\u{1F6E0}\uFE0F"} <span>{toolName}</span>
                        <span style={{ color: "#aaa", fontSize: "0.9em" }}>
                          {invocations.length}x
                        </span>
                        {durStr ? (
                          <span style={{ color: "#aaa", fontSize: "0.9em" }}>
                            {durStr}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {hasDetail && isToolOpen ? (
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

        {/* Diffs */}
        {data.summaryDiffs ? (
          <details
            className="mb-[var(--space-lg)] border-none bg-transparent p-0 rounded-none"
            data-testid="diffs-card"
          >
            <summary className={cn(accordionSummaryClasses, "[&::-webkit-details-marker]:hidden before:content-['\\25B6'] before:text-[0.7em] before:transition-transform before:duration-[var(--transition-fast)] [details[open]>&]:before:rotate-90")}>
              Changes
            </summary>
            <div className="py-[var(--space-sm)]">
              <DiffView diff={data.summaryDiffs} />
            </div>
          </details>
        ) : null}
      </div>
    </aside>
  );
});
