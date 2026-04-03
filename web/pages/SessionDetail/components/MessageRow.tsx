import React from "react";
import { Link } from "react-router-dom";
import type { SessionMessageContract } from "../../../../src/contracts/session.js";
import { renderSafeMarkdown as renderSharedMarkdown } from "../../../../src/lib/rendering.js";
import { formatDurationShort, formatTimestampShort } from "../../../lib/format";
import { COLLAPSE_HEIGHT, MERMAID_SELECTOR } from "../lib/constants";
import {
  getMermaidClient,
  nextMermaidRenderId,
  decodeHtmlEntities,
  normalizeMermaidSvg,
} from "../lib/mermaid-utils";
import { ToolTimeline } from "./ToolTimeline";
import { MermaidLightbox } from "./MermaidLightbox";
import css from "./MessageRow.module.css";

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
  const roleClass = isUser ? "message-user" : "message-assistant";
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

  // Set innerHTML via layout effect — React won't manage these children,
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
        ? body.querySelector<HTMLElement>(".message-raw")
        : body.querySelector<HTMLElement>(".message-content");
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
      ? body.querySelector<HTMLElement>(".message-raw")
      : body.querySelector<HTMLElement>(".message-content");
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

      // Re-query DOM after await — nodes captured before the await may have
      // been detached by React reconciliation (e.g. Virtuoso re-mount).
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
          previewButton.className = "mermaid-preview";
          previewButton.setAttribute("aria-label", "\u{30AF}\u{30EA}\u{30C3}\u{30AF}\u{3067}\u{62E1}\u{5927}\u{8868}\u{793A}");
          previewButton.setAttribute("title", "\u{30AF}\u{30EA}\u{30C3}\u{30AF}\u{3067}\u{62E1}\u{5927}");

          const previewCanvas = document.createElement("div");
          previewCanvas.className = "mermaid-preview-canvas";

          const previewHint = document.createElement("span");
          previewHint.className = "mermaid-preview-hint";
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
            errorNote.className = "mermaid-error-note";
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
        <span key="model" className="meta-chip chip-model">
          {msg.modelId}
        </span>,
      );
    }
    if (msg.agent) {
      metaChips.push(
        <span key="agent" className="meta-chip chip-agent">
          {msg.agent}
        </span>,
      );
    }
    metaChips.push(
      <span key="tps" className="meta-chip chip-tps">
        TPS {msg.outputTpsLabel || "\u2014"}
      </span>,
    );
  }

  // Subagent links
  const subagentLinks = !isUser && msg.subagentLinks.length > 0 && (
    <div className="subagent-links">
      {msg.subagentLinks.map((link) => (
        <Link
          key={link.id}
          to={`/session/${encodeURIComponent(link.id)}`}
          className="subagent-link"
        >
          {"\u2192"} {link.title}
          {link.durationMs > 0
            ? ` (${formatDurationShort(link.durationMs)})`
            : ""}
        </Link>
      ))}
    </div>
  );

  // Compose body classes using CSS module for collapse state
  const bodyClasses = [
    "message-body",
    isCollapsed ? css.bodyCollapsed : css.bodyNotCollapsed,
    isOverflowing ? css.bodyOverflows : css.bodyNotOverflows,
  ].join(" ");

  // Expand button text
  const expandText = isCollapsed
    ? "\u7D9A\u304D\u3092\u8868\u793A"
    : "\u6298\u308A\u305F\u305F\u3080";

  return (
    <div
      className={`message ${roleClass}${hidden ? " hidden" : ""}`}
      data-role={msg.role}
      data-testid={`message-${msgIdx}`}
    >
      <div className="message-header">
        <span className="message-role">{roleLabel}</span>
        <span className="message-time">{dateStr}</span>
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
      <div className={bodyClasses} ref={bodyRef}>
        <div
          className="message-content"
          ref={contentRef}
        />
        <div className="message-raw">
          <span className="raw-label">
            {roleLabel} ({dateStr})
          </span>
          {"\n"}
          {msg.text}
        </div>
        <div className="content-fade" />
        <button
          type="button"
          className="expand-btn"
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
      <hr className="plain-sep" />
    </div>
  );
});
