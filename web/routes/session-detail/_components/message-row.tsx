import React from "react";
import { Link, useParams } from "react-router-dom";
import { isHarnessId } from "../../../../src/contracts/harness.js";
import type {
  SessionMessageContract,
  SessionToolCallContract,
} from "../../../../src/contracts/session.js";
import { MarkdownContent } from "../../../components/markdown-content";
import { cn } from "../../../lib/cn";
import { formatDurationShort, formatTimestampShort } from "../../../lib/format";
import { sessionPath } from "../../../lib/harness";
import { COLLAPSE_HEIGHT } from "../_lib/constants";
import { FileDiffs } from "./file-diffs";
import { MermaidCodeBlock } from "./mermaid-code-block";
import { QuestionCard } from "./question-card";
import { ToolTimeline } from "./tool-timeline";

/**
 * Walk `toolCalls` in source order, grouping consecutive ordinary tool calls
 * into a single ToolTimeline and rendering each question tool call as a
 * QuestionCard at its original position.
 *
 * Preserves the `compact` flag (ToolTimeline) and the `toolsVisible` gate
 * (the caller already checks this before invoking us).
 */
function renderToolsInOrder(
  calls: SessionToolCallContract[],
  msgIdx: number,
  openDetails: Set<string>,
  onToggleDetail: (id: string) => void,
  compact: boolean,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let run: SessionToolCallContract[] = [];
  let runStart = 0;

  const flushRun = () => {
    if (run.length === 0) return;
    nodes.push(
      <ToolTimeline
        key={`tool-run-${msgIdx}-${runStart}`}
        calls={run}
        msgIdx={msgIdx}
        openDetails={openDetails}
        onToggleDetail={onToggleDetail}
        compact={compact}
      />,
    );
    run = [];
  };

  calls.forEach((tc, callIdx) => {
    if (tc.question != null) {
      flushRun();
      // Use the first question's text as a stable content-derived key so the
      // key is semantically meaningful (not a bare index).
      const firstQ = tc.question.questions[0]?.question ?? "";
      const questionKey = `question-${msgIdx}-${tc.tool}-${firstQ.slice(0, 32)}`;
      nodes.push(<QuestionCard key={questionKey} question={tc.question} />);
      runStart = callIdx + 1;
    } else {
      if (run.length === 0) runStart = callIdx;
      run.push(tc);
    }
  });

  flushRun();

  return nodes;
}

export interface MessageRowProps {
  msg: SessionMessageContract;
  msgIdx: number;
  hidden: boolean;
  plainMode: boolean;
  collapseEnabled: boolean;
  openDetails: Set<string>;
  onToggleDetail: (id: string) => void;
  toolsVisible: boolean;
}

/**
 * Individual message row. Manages its own collapse/expand state
 * via a ResizeObserver-based overflow check.
 */
export const MessageRow = React.memo(function MessageRow({
  msg,
  msgIdx,
  hidden,
  plainMode,
  collapseEnabled,
  openDetails,
  onToggleDetail,
  toolsVisible,
}: MessageRowProps) {
  const { harness: rawHarness = "" } = useParams();
  const harness = isHarnessId(rawHarness) ? rawHarness : "opencode";
  const isUser = msg.role === "user";
  const roleLabel = isUser ? "User" : "Assistant";
  const dateStr = formatTimestampShort(msg.createdAt);
  const hasMessageText = msg.text.length > 0;

  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Local collapse state
  const [isOverflowing, setIsOverflowing] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(collapseEnabled);

  // Sync collapse state when collapseEnabled preference changes
  React.useEffect(() => {
    if (collapseEnabled && isOverflowing) {
      setIsCollapsed(true);
    } else if (!collapseEnabled) {
      setIsCollapsed(false);
    }
  }, [collapseEnabled, isOverflowing]);

  // Overflow detection via ResizeObserver
  React.useEffect(() => {
    if (!hasMessageText) {
      setIsOverflowing(false);
      setIsCollapsed(false);
      return;
    }

    const body = bodyRef.current;
    if (!body) return;

    const checkOverflow = () => {
      const contentEl = plainMode
        ? body.querySelector<HTMLElement>("[data-message-raw]")
        : body.querySelector<HTMLElement>("[data-message-content]");
      if (!contentEl) {
        setIsOverflowing(false);
        return;
      }
      const overflows = contentEl.scrollHeight > COLLAPSE_HEIGHT;
      setIsOverflowing(overflows);
    };

    // Initial check after content renders
    const rafId = requestAnimationFrame(checkOverflow);

    // Watch for size changes (e.g. mermaid rendering, image loads)
    const observer = new ResizeObserver(() => {
      checkOverflow();
    });
    const contentEl = plainMode
      ? body.querySelector<HTMLElement>("[data-message-raw]")
      : body.querySelector<HTMLElement>("[data-message-content]");
    if (contentEl) {
      observer.observe(contentEl);
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [hasMessageText, plainMode]);

  // Toggle collapse for this message
  const handleToggle = React.useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Meta chips (assistant only)
  const metaChips: React.ReactNode[] = [];
  if (!isUser) {
    if (msg.modelId) {
      metaChips.push(
        <span
          key="model"
          className="rounded-[var(--radius-sm)] bg-[var(--color-model-chip-bg)] px-2 py-[2px] text-[0.82em] font-medium text-[var(--color-model-chip-text)]"
        >
          {msg.modelId}
        </span>,
      );
    }
    if (msg.agent) {
      metaChips.push(
        <span
          key="agent"
          className="rounded-[var(--radius-sm)] bg-[var(--color-agent-chip-bg)] px-2 py-[2px] text-[0.82em] font-medium text-[var(--color-agent-chip-text)]"
        >
          {msg.agent}
        </span>,
      );
    }
    metaChips.push(
      <span
        key="tps"
        className="rounded-[var(--radius-sm)] bg-[var(--color-tps-chip-bg)] px-2 py-[2px] text-[0.82em] font-medium text-[var(--color-tps-chip-text)]"
      >
        TPS {msg.outputTpsLabel || "\u2014"}
      </span>,
    );
  }

  // Subagent links
  const subagentLinks = !isUser && msg.subagentLinks.length > 0 && (
    <div className="mb-2 flex flex-col gap-1">
      {msg.subagentLinks.map((link) => (
        <Link
          key={link.id}
          to={sessionPath(harness, link.id)}
          className="inline-block rounded-lg border-l-[3px] border-l-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-2 py-1 text-[0.82em] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)] hover:no-underline"
        >
          {"\u2192"} {link.title}
          {link.durationMs > 0
            ? ` (${formatDurationShort(link.durationMs)})`
            : ""}
        </Link>
      ))}
    </div>
  );

  // In plain mode, suppress all collapse UI (plain mode is for copying)
  const effectiveCollapsed = plainMode ? false : isCollapsed;
  const showFade = effectiveCollapsed && isOverflowing;
  const showExpandBtn = !plainMode && isOverflowing;
  const expandText = effectiveCollapsed
    ? "\u7D9A\u304D\u3092\u8868\u793A"
    : "\u6298\u308A\u305F\u305F\u3080";

  return (
    <div
      className={cn(
        hasMessageText ? "my-3.5 flex flex-col" : "my-1 flex flex-col",
        isUser ? "items-stretch [&_.msg-header]:justify-end" : "items-stretch",
        hidden && "!hidden",
      )}
      data-role={msg.role}
      data-testid={`message-${msgIdx}`}
      data-message-role={msg.role}
      {...(hidden ? { "data-hidden": "" } : {})}
    >
      {/* Header */}
      {hasMessageText ? (
        <div className="msg-header mb-2 flex flex-wrap items-center gap-2 text-[0.8em] text-[var(--color-text-secondary)]">
          <span
            className={cn(
              "rounded-[var(--radius-sm)] px-2.5 py-[2px] text-[0.85em] font-semibold",
              isUser
                ? "bg-[var(--color-user-bg)] text-[var(--color-user-badge)]"
                : "bg-[var(--color-assistant-badge-bg)] text-[var(--color-text-inverse)]",
            )}
          >
            {roleLabel}
          </span>
          <span>{dateStr}</span>
          {metaChips}
        </div>
      ) : null}
      {subagentLinks}
      {/* Tool timeline + question cards — rendered in source order */}
      {toolsVisible && msg.toolCalls.length > 0
        ? renderToolsInOrder(
            msg.toolCalls,
            msgIdx,
            openDetails,
            onToggleDetail,
            !hasMessageText,
          )
        : null}
      {/* File diffs */}
      {msg.fileDiffs?.length > 0 ? <FileDiffs diffs={msg.fileDiffs} /> : null}
      {hasMessageText ? (
        <div className="relative w-full" ref={bodyRef}>
          {/* Rendered markdown content */}
          <div
            data-message-content
            className={cn(
              /* message-content base */
              "w-full rounded-xl px-[18px] py-3.5 text-[0.95em] leading-[1.7] [&_img]:max-w-full [&_img]:h-auto",
              /* message-content prose spacing (pre/code intentionally absent: CodeBlock/InlineCode own their presentation) */
              "[&_p]:my-2",
              /* message-content tables */
              "[&_table]:w-full [&_table]:border-collapse [&_table]:my-2",
              "[&_th]:border [&_th]:border-[var(--color-border-default)] [&_th]:bg-[var(--color-bg-root)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
              "[&_td]:border [&_td]:border-[var(--color-border-default)] [&_td]:px-3 [&_td]:py-2 [&_td]:text-left",
              /* role-specific */
              isUser
                ? "border border-[var(--color-user-border)] bg-[var(--color-user-bg)]"
                : "border border-[var(--color-assistant-border)] bg-[var(--color-assistant-bg)]",
              effectiveCollapsed && "max-h-[300px] overflow-hidden",
            )}
          >
            <MarkdownContent
              renderMermaidCode={(code) => (
                <MermaidCodeBlock code={code} msgIdx={msgIdx} />
              )}
            >
              {msg.text}
            </MarkdownContent>
          </div>
          {/* Raw / plain text content */}
          <div
            data-message-raw
            className={cn(
              "hidden whitespace-pre-wrap break-words font-[var(--font-sans)] text-[0.93em] leading-relaxed",
              effectiveCollapsed && "max-h-[300px] overflow-hidden",
            )}
          >
            <span className="font-bold text-[var(--color-text-primary)]">
              {roleLabel} ({dateStr})
            </span>
            {"\n"}
            {msg.text}
          </div>
          {/* Fade overlay for collapsed state */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-8 h-[60px] rounded-b-xl",
              isUser
                ? "bg-gradient-to-b from-transparent to-[var(--color-user-bg)]"
                : "bg-gradient-to-b from-transparent to-[var(--color-assistant-bg)]",
              !showFade && "!hidden",
            )}
          />
          {/* Expand/collapse button */}
          <button
            type="button"
            className={cn(
              "block w-full rounded-b-xl border-none bg-transparent p-2 text-center text-[0.82em] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-light)]",
              !showExpandBtn && "!hidden",
              !isCollapsed &&
                isOverflowing &&
                "!block text-[var(--color-text-secondary)]",
            )}
            onClick={handleToggle}
          >
            {expandText}
          </button>
        </div>
      ) : null}
      {/* Plain mode separator */}
      <hr
        className="mx-0 my-3 hidden border-t border-dashed border-[#c0c0c0] border-b-0 border-l-0 border-r-0"
        data-plain-sep
      />
    </div>
  );
});
