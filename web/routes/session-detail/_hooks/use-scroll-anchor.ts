import React from "react";

// ---------------------------------------------------------------------------
// useScrollAnchor — anchor-based scroll preservation
// ---------------------------------------------------------------------------
export function useScrollAnchor(
  containerRef: React.RefObject<HTMLDivElement | null>,
): {
  getAnchor: () => { el: HTMLElement; offset: number } | null;
  restoreAnchor: (anchor: { el: HTMLElement; offset: number } | null) => void;
} {
  const getAnchor = React.useCallback(() => {
    const container = containerRef.current;
    const nodes = container?.querySelectorAll<HTMLElement>(
      "[data-message-role]:not([data-hidden])",
    );
    if (!nodes || !container) return null;
    const containerTop = container.getBoundingClientRect().top;
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (r.bottom > containerTop) return { el: node, offset: r.top };
    }
    return null;
  }, [containerRef]);

  const restoreAnchor = React.useCallback(
    (anchor: { el: HTMLElement; offset: number } | null) => {
      if (!anchor || !containerRef.current) return;
      containerRef.current.scrollBy(
        0,
        anchor.el.getBoundingClientRect().top - anchor.offset,
      );
    },
    [containerRef],
  );

  return { getAnchor, restoreAnchor };
}
