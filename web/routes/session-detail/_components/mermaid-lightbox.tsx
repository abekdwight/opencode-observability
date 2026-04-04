import React from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/cn";
import {
  getMermaidClient,
  nextMermaidRenderId,
  normalizeMermaidSvg,
  clampNumber,
  getMermaidSvgDimensions,
} from "../_lib/mermaid-utils";
import {
  MERMAID_MODAL_MIN_SCALE,
  MERMAID_MODAL_MAX_SCALE,
} from "../_lib/constants";

export interface MermaidLightboxProps {
  source: string;
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}

/**
 * Zoom/pan modal for mermaid diagrams. Renders as a portal on document.body.
 */
export const MermaidLightbox = React.memo(function MermaidLightbox({
  source,
  returnFocusTo,
  onClose,
}: MermaidLightboxProps) {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 24, y: 24 });
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [isRendering, setIsRendering] = React.useState(true);
  const [isDragging, setIsDragging] = React.useState(false);

  const resetViewport = React.useCallback(() => {
    const host = canvasRef.current;
    const viewport = viewportRef.current;
    if (!host || !viewport) {
      setZoom(1);
      setOffset({ x: 24, y: 24 });
      return;
    }

    const dimensions = getMermaidSvgDimensions(host);
    if (!dimensions) {
      setZoom(1);
      setOffset({ x: 24, y: 24 });
      return;
    }

    const padding = 36;
    const fitZoom = clampNumber(
      Math.min(
        (viewport.clientWidth - padding * 2) / dimensions.width,
        (viewport.clientHeight - padding * 2) / dimensions.height,
        1,
      ),
      MERMAID_MODAL_MIN_SCALE,
      MERMAID_MODAL_MAX_SCALE,
    );

    const fittedWidth = dimensions.width * fitZoom;
    const fittedHeight = dimensions.height * fitZoom;
    setZoom(fitZoom);
    setOffset({
      x: Math.max((viewport.clientWidth - fittedWidth) / 2, 8),
      y: Math.max((viewport.clientHeight - fittedHeight) / 2, 8),
    });
  }, []);

  const onBackdropMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const onDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        const focusableNodes = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusableNodes.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusableNodes[0];
        const last = focusableNodes[focusableNodes.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        resetViewport();
      }
    },
    [onClose, resetViewport],
  );

  const onDialogWheelCapture = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    [],
  );

  const onDialogDragStart = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    [],
  );

  const onViewportWheel = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const zoomFactor = Math.exp(-event.deltaY * 0.0018);

      setZoom((prevZoom) => {
        const nextZoom = clampNumber(
          prevZoom * zoomFactor,
          MERMAID_MODAL_MIN_SCALE,
          MERMAID_MODAL_MAX_SCALE,
        );
        if (nextZoom === prevZoom) {
          return prevZoom;
        }

        setOffset((prevOffset) => {
          const worldX = (cursorX - prevOffset.x) / prevZoom;
          const worldY = (cursorY - prevOffset.y) / prevZoom;
          return {
            x: cursorX - worldX * nextZoom,
            y: cursorY - worldY * nextZoom,
          };
        });

        return nextZoom;
      });
    },
    [],
  );

  const onViewportPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      const viewport = viewportRef.current;
      viewport?.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      };
      setIsDragging(true);
    },
    [offset.x, offset.y],
  );

  const onViewportPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      setOffset({
        x: dragState.originX + deltaX,
        y: dragState.originY + deltaY,
      });
    },
    [],
  );

  const finishDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const viewport = viewportRef.current;
      if (viewport?.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }

      dragRef.current = null;
      setIsDragging(false);
    },
    [],
  );

  // Focus close button on mount; restore focus on unmount
  React.useEffect(() => {
    closeButtonRef.current?.focus();

    return () => {
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  // Lock body scroll while lightbox is open
  React.useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.body.classList.add("mermaid-lightbox-open");
    document.documentElement.classList.add("mermaid-lightbox-open");

    return () => {
      document.body.classList.remove("mermaid-lightbox-open");
      document.documentElement.classList.remove("mermaid-lightbox-open");
    };
  }, []);

  // Render the mermaid diagram
  React.useEffect(() => {
    let disposed = false;
    setRenderError(null);
    setIsRendering(true);
    setIsDragging(false);
    dragRef.current = null;

    const host = canvasRef.current;
    if (!host) {
      setIsRendering(false);
      return () => {
        disposed = true;
      };
    }
    host.innerHTML = "";

    const renderExpandedDiagram = async () => {
      try {
        const mermaidClient = await getMermaidClient();
        if (disposed) return;
        const { svg } = await mermaidClient.render(
          nextMermaidRenderId("session-mermaid-modal"),
          source,
        );
        if (disposed) return;

        host.innerHTML = svg;
        normalizeMermaidSvg(host);
        requestAnimationFrame(() => {
          if (!disposed) {
            resetViewport();
          }
        });
        setIsRendering(false);
      } catch (error) {
        setRenderError(
          error instanceof Error ? error.message : "diagram render failed",
        );
        setIsRendering(false);
      }
    };

    void renderExpandedDiagram();

    return () => {
      disposed = true;
    };
  }, [resetViewport, source]);

  if (typeof document === "undefined") {
    return null;
  }

  const btnBase = cn(
    "border border-[var(--color-border-default)] rounded-[var(--radius-md)]",
    "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]",
    "text-[0.82em] font-semibold px-[var(--space-sm)] py-[var(--space-sm)]",
    "cursor-pointer",
    "transition-[border-color,color,background] duration-[var(--transition-fast)]",
    "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
  );

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[var(--z-lightbox)]",
        "flex items-stretch justify-stretch p-0",
        "bg-[rgba(8,11,20,0.58)] backdrop-blur-[5px]",
        "mermaid-lightbox",
      )}
      data-testid="mermaid-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid diagram preview"
      tabIndex={-1}
      onMouseDown={onBackdropMouseDown}
      onKeyDown={onDialogKeyDown}
      onWheelCapture={onDialogWheelCapture}
      onDragStart={onDialogDragStart}
    >
      <div
        className={cn(
          "w-full h-full bg-[var(--color-bg-surface)]",
          "rounded-none border-none shadow-none",
          "overflow-hidden flex flex-col",
          "mermaid-lightbox-card",
        )}
      >
        <div
          className={cn(
            "flex justify-between items-center gap-[var(--space-md)]",
            "px-[var(--space-lg)] py-[var(--space-md)]",
            "border-b border-[var(--color-border-subtle)]",
            "bg-[var(--color-bg-muted)]",
            "mermaid-lightbox-toolbar",
          )}
        >
          <div className="flex items-center gap-[var(--space-sm)] flex-wrap justify-start mermaid-lightbox-actions">
            <span className="text-[var(--color-text-secondary)] text-[0.78em] font-medium mermaid-lightbox-hint">
              {"\u30DB\u30A4\u30FC\u30EB\u3067\u62E1\u5927\u7E2E\u5C0F / \u30C9\u30E9\u30C3\u30B0\u3067\u79FB\u52D5"}
            </span>
            <span className="min-w-14 text-center font-[var(--font-mono)] text-[0.78em] text-[var(--color-text-secondary)] mermaid-lightbox-zoom">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className={cn(btnBase, "mermaid-lightbox-btn")}
              onClick={resetViewport}
            >
              {"\u8868\u793A\u3092\u30EA\u30BB\u30C3\u30C8"}
            </button>
          </div>
          <button
            type="button"
            className={cn(
              btnBase,
              "ml-auto",
              "bg-[var(--color-accent)] !text-[var(--color-text-inverse)] !border-[var(--color-accent)]",
              "hover:!bg-[var(--color-accent-hover)] hover:!text-[var(--color-text-inverse)]",
              "mermaid-lightbox-btn close",
            )}
            ref={closeButtonRef}
            onClick={onClose}
          >
            {"\u9589\u3058\u308B"}
          </button>
        </div>
        <div className="flex-1 min-h-0 flex mermaid-lightbox-body">
          {renderError ? (
            <div className="p-[var(--space-lg)] w-full mermaid-lightbox-error">
              <p className="m-0 mb-[var(--space-sm)] text-[var(--color-error-text)] font-semibold">
                Mermaid{"\u56F3\u306E\u63CF\u753B\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u3001\u30BD\u30FC\u30B9\u3092\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002"}
              </p>
              <pre
                className={cn(
                  "m-0 whitespace-pre-wrap break-words",
                  "bg-[var(--color-error-bg)] border border-[var(--color-error-border)]",
                  "rounded-[var(--radius-md)] p-[var(--space-md)]",
                )}
              >
                {source}
              </pre>
              <p className="mt-[var(--space-sm)] text-[0.78em] text-[var(--color-text-secondary)] mermaid-lightbox-error-detail">
                {renderError}
              </p>
            </div>
          ) : (
            <div
              className={cn(
                "flex-1 overflow-hidden relative",
                "bg-[var(--color-bg-page)] min-h-[280px]",
                "select-none touch-none",
                isDragging ? "cursor-grabbing" : "cursor-grab",
                "mermaid-lightbox-viewport",
                isDragging && "dragging",
              )}
              ref={viewportRef}
              onWheel={onViewportWheel}
              onPointerDown={onViewportPointerDown}
              onPointerMove={onViewportPointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              {isRendering ? (
                <p
                  className={cn(
                    "absolute top-3 left-3 m-0",
                    "text-[var(--color-text-secondary)] text-[0.82em] font-medium",
                    "bg-[var(--color-bg-surface-translucent)]",
                    "border border-[var(--color-border-subtle)]",
                    "rounded-[var(--radius-md)] px-[var(--space-sm)] py-[var(--space-xs)]",
                    "z-[2]",
                    "mermaid-lightbox-loading",
                  )}
                >
                  Mermaid{"\u56F3\u3092\u63CF\u753B\u4E2D..."}
                </p>
              ) : null}
              <div
                className="absolute top-0 left-0 origin-top-left transition-transform duration-[80ms] ease-out will-change-transform w-max mermaid-lightbox-canvas"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                }}
              >
                <div
                  className={cn(
                    "inline-block bg-[var(--color-bg-surface)]",
                    "border border-[var(--color-border-subtle)]",
                    "rounded-[var(--radius-lg)] p-[var(--space-lg)]",
                    "[&_svg]:block [&_svg]:max-w-none [&_svg]:w-auto [&_svg]:h-auto [&_svg]:pointer-events-none",
                  )}
                  ref={canvasRef}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
});
