import React from "react";
import { Link } from "react-router-dom";
import type { SessionMessageContract } from "../../../../src/contracts/session.js";
import { renderSafeMarkdown as renderSharedMarkdown } from "../../../../src/lib/rendering.js";
import { cn } from "../../../lib/cn";
import { formatDurationShort, formatTimestampShort } from "../../../lib/format";
import { COLLAPSE_HEIGHT, MERMAID_SELECTOR } from "../_lib/constants";
import {
  getMermaidClient,
  nextMermaidRenderId,
  decodeHtmlEntities,
  normalizeMermaidSvg,
} from "../_lib/mermaid-utils";
import { ToolTimeline } from "./tool-timeline";
import { MermaidLightbox } from "./mermaid-lightbox";

export interface MessageRowProps {
  msg: SessionMessageContract;
  msgIdx: number;
  hidden: boolean;
  toolsVisible: boolean;
  plainMode: boolean;
  collapseEnabled: boolean;
  openDetails: Set<string>;
  onToggleDetail: (id: string) => void;
}

/**
 * Individual message row. Manages its own collapse/expand state
 * via a ResizeObserver-based overflow check.
 */
export const MessageRow = React.memo(function MessageRow({
  msg,
  msgIdx,
  hidden,
  toolsVisible,
  plainMode,
  collapseEnabled,
  openDetails,
  onToggleDetail,
}: MessageRowProps) {
  const isUser = msg.role === "user";
  const roleLabel = isUser ? "User" : "Assistant";
  const dateStr = formatTimestampShort(msg.createdAt);

  const markdownHtml = React.useMemo(
    () => renderSharedMarkdown(msg.text),
    [msg.text],
  );

  const contentRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Local collapse state
  const [isOverflowing, setIsOverflowing] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(collapseEnabled);

  // Mermaid lightbox state
  const [zoomState, setZoomState] = React.useState<{
    source: string;
    trigger: HTMLElement | null;
  } | null>(null);

  // Set innerHTML via layout effect -- React won't manage these children,
  // so imperative DOM modifications (mermaid enhancement) survive re-renders.
  React.useLayoutEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = markdownHtml;
    }
  }, [markdownHtml]);

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
  }, [markdownHtml, plainMode]);

  // Toggle collapse for this message
  const handleToggle = React.useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Mermaid enhancement effect
  React.useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    if (!msg.text.includes("```mermaid")) return;

    const mermaidCodeNodes = Array.from(
      root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR),
    );
    if (mermaidCodeNodes.length === 0) return;

    const detachHandlers: Array<() => void> = [];
    let disposed = false;

    const enhanceMermaidBlocks = async () => {
      const mermaidClient = await getMermaidClient();
      if (disposed) return;

      // Re-query DOM after await -- nodes captured before the await may have
      // been detached by React reconciliation.
      const freshRoot = contentRef.current;
      if (!freshRoot) return;
      const freshCodeNodes = Array.from(
        freshRoot.querySelectorAll<HTMLElement>(MERMAID_SELECTOR),
      );
      if (freshCodeNodes.length === 0) return;

      for (const codeNode of freshCodeNodes) {
        const pre = codeNode.closest("pre");
        if (!pre || pre.dataset.mermaidEnhanced === "true") continue;

        const source = decodeHtmlEntities(codeNode.textContent ?? "");
        if (!source.trim()) continue;

        pre.dataset.mermaidEnhanced = "true";

        try {
          const previewButton = document.createElement("button");
          previewButton.type = "button";
          previewButton.className = "w-full rounded-xl border border-[var(--color-border-default)] bg-gradient-to-b from-[#fcfcfd] to-[#f5f5f7] p-3 text-left cursor-zoom-in transition-[border-color,box-shadow] duration-150 hover:border-[var(--color-accent)] hover:shadow-[0_0_0_2px_rgba(0,102,204,0.12)] dark:from-[var(--color-bg-elevated)] dark:to-[var(--color-bg-muted)]";
          previewButton.setAttribute("aria-label", "\u{30AF}\u{30EA}\u{30C3}\u{30AF}\u{3067}\u{62E1}\u{5927}\u{8868}\u{793A}");
          previewButton.setAttribute("title", "\u{30AF}\u{30EA}\u{30C3}\u{30AF}\u{3067}\u{62E1}\u{5927}");

          const previewCanvas = document.createElement("div");
          previewCanvas.className = "overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2.5 flex justify-center items-start [&_svg]:block [&_svg]:max-w-full [&_svg]:w-auto [&_svg]:h-auto [&_svg]:m-0";

          const previewHint = document.createElement("span");
          previewHint.className = "block mt-2 text-[var(--color-text-secondary)] text-xs tracking-[0.02em]";
          previewHint.textContent = "\u{30AF}\u{30EA}\u{30C3}\u{30AF}\u{3067}\u{62E1}\u{5927}";

          const { svg } = await mermaidClient.render(
            nextMermaidRenderId(`session-mermaid-${msgIdx}`),
            source,
          );
          if (disposed) return;

          previewCanvas.innerHTML = svg;
          normalizeMermaidSvg(previewCanvas);

          previewButton.append(previewCanvas, previewHint);

          const handleOpen = () => {
            setZoomState({
              source,
              trigger: previewButton,
            });
          };
          previewButton.addEventListener("click", handleOpen);
          detachHandlers.push(() => {
            previewButton.removeEventListener("click", handleOpen);
          });

          pre.replaceWith(previewButton);
        } catch {
          pre.dataset.mermaidEnhanced = "false";
          if (
            !pre.previousElementSibling?.classList.contains(
              "mermaid-error-note",
            )
          ) {
            const errorNote = document.createElement("p");
            errorNote.className = "mermaid-error-note my-2 text-[0.83em] font-medium text-[var(--color-error-text)]";
            errorNote.textContent =
              "Mermaid\u56F3\u306E\u63CF\u753B\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u3001\u30BD\u30FC\u30B9\u3092\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002";
            pre.before(errorNote);
          }
        }
      }
    };

    void enhanceMermaidBlocks();

    return () => {
      disposed = true;
      for (const detach of detachHandlers) {
        detach();
      }
    };
  }, [msg.text, msgIdx]);

  // Meta chips (assistant only)
  const metaChips: React.ReactNode[] = [];
  if (!isUser) {
    if (msg.modelId) {
      metaChips.push(
        <span key="model" className="rounded-[var(--radius-sm)] bg-[var(--color-model-chip-bg)] px-2 py-[2px] text-[0.82em] font-medium text-[var(--color-model-chip-text)]">
          {msg.modelId}
        </span>,
      );
    }
    if (msg.agent) {
      metaChips.push(
        <span key="agent" className="rounded-[var(--radius-sm)] bg-[var(--color-agent-chip-bg)] px-2 py-[2px] text-[0.82em] font-medium text-[var(--color-agent-chip-text)]">
          {msg.agent}
        </span>,
      );
    }
    metaChips.push(
      <span key="tps" className="rounded-[var(--radius-sm)] bg-[var(--color-tps-chip-bg)] px-2 py-[2px] text-[0.82em] font-medium text-[var(--color-tps-chip-text)]">
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
          to={`/session/${encodeURIComponent(link.id)}`}
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
        "my-3.5 flex flex-col",
        isUser ? "items-stretch [&_.msg-header]:justify-end" : "items-stretch",
        hidden && "!hidden",
      )}
      data-role={msg.role}
      data-testid={`message-${msgIdx}`}
      data-message-role={msg.role}
      {...(hidden ? { "data-hidden": "" } : {})}
    >
      {/* Header */}
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
      {subagentLinks}
      {/* Tool timeline */}
      {msg.toolCalls.length > 0 ? (
        <ToolTimeline
          calls={msg.toolCalls}
          msgIdx={msgIdx}
          visible={toolsVisible}
          openDetails={openDetails}
          onToggleDetail={onToggleDetail}
        />
      ) : null}
      <div className="relative w-full" ref={bodyRef}>
        {/* Rendered markdown content */}
        <div
          data-message-content
          className={cn(
            /* message-content base */
            "w-full rounded-xl px-[18px] py-3.5 text-[0.95em] leading-[1.7] [&_img]:max-w-full [&_img]:h-auto",
            /* message-content typography */
            "[&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[var(--color-border-subtle)] [&_pre]:bg-[var(--color-bg-code)] [&_pre]:p-3.5",
            "[&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--color-bg-code)] [&_code]:px-2 [&_code]:py-[2px] [&_code]:font-[var(--font-mono)] [&_code]:text-[0.88em]",
            "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
            /* message-content tables */
            "[&_table]:w-full [&_table]:border-collapse [&_table]:my-2",
            "[&_th]:border [&_th]:border-[var(--color-border-default)] [&_th]:bg-[var(--color-bg-root)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
            "[&_td]:border [&_td]:border-[var(--color-border-default)] [&_td]:px-3 [&_td]:py-2 [&_td]:text-left",
            /* role-specific */
            isUser
              ? "border border-[var(--color-user-border)] bg-[var(--color-bg-elevated)]"
              : "border border-[var(--color-border-faint)] bg-[var(--color-bg-surface)]",
            effectiveCollapsed && "max-h-[300px] overflow-hidden",
          )}
          ref={contentRef}
        />
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
              ? "bg-gradient-to-b from-transparent to-[var(--color-bg-elevated)]"
              : "bg-gradient-to-b from-transparent to-[var(--color-bg-surface)]",
            !showFade && "!hidden",
          )}
        />
        {/* Expand/collapse button */}
        <button
          type="button"
          className={cn(
            "block w-full rounded-b-xl border-none bg-transparent p-2 text-center text-[0.82em] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-light)]",
            !showExpandBtn && "!hidden",
            !isCollapsed && isOverflowing && "!block text-[var(--color-text-secondary)]",
          )}
          onClick={handleToggle}
        >
          {expandText}
        </button>
      </div>
      {zoomState ? (
        <MermaidLightbox
          source={zoomState.source}
          returnFocusTo={zoomState.trigger}
          onClose={() => setZoomState(null)}
        />
      ) : null}
      {/* Plain mode separator */}
      <hr className="mx-0 my-3 hidden border-t border-dashed border-[#c0c0c0] border-b-0 border-l-0 border-r-0" data-plain-sep />
    </div>
  );
});
