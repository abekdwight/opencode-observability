import React from "react";

// ---------------------------------------------------------------------------
// useMessageNavigation — j/k keyboard nav + scroll sync for message counter
// ---------------------------------------------------------------------------
export function useMessageNavigation(options: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  visibleCount: number;
}): {
  navIndex: number;
  jump: (dir: number) => void;
} {
  const { containerRef, visibleCount } = options;

  const [navIndex, setNavIndex] = React.useState(-1);

  const syncNavToView = React.useCallback(() => {
    if (visibleCount === 0) {
      setNavIndex(-1);
      return;
    }
    const container = containerRef.current;
    const nodes = container?.querySelectorAll<HTMLElement>(
      "[data-message-role]:not([data-hidden])",
    );
    if (!nodes || !container) return;
    const containerRect = container.getBoundingClientRect();
    const threshold = containerRect.top + containerRect.height / 3;
    let best = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].getBoundingClientRect().top <= threshold) best = i;
    }
    setNavIndex(best);
  }, [visibleCount, containerRef]);

  const jump = React.useCallback(
    (dir: number) => {
      const container = containerRef.current;
      const nodes = container?.querySelectorAll<HTMLElement>(
        "[data-message-role]:not([data-hidden])",
      );
      if (!nodes || nodes.length === 0 || !container) return;
      setNavIndex((prev) => {
        const cur = prev < 0 ? 0 : prev;
        const next = Math.max(0, Math.min(nodes.length - 1, cur + dir));
        const nodeTop = nodes[next].offsetTop;
        container.scrollTo({ top: nodeTop - 12, behavior: "smooth" });
        nodes[next].classList.add("nav-highlight");
        setTimeout(() => nodes[next]?.classList.remove("nav-highlight"), 800);
        return next;
      });
    },
    [containerRef],
  );

  // Keyboard navigation (j/k)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j" || (e.key === "ArrowDown" && e.altKey)) {
        e.preventDefault();
        jump(1);
      }
      if (e.key === "k" || (e.key === "ArrowUp" && e.altKey)) {
        e.preventDefault();
        jump(-1);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [jump]);

  // Scroll sync for nav counter (on chat container)
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(syncNavToView, 150);
    };
    container.addEventListener("scroll", handler, { passive: true });
    return () => {
      clearTimeout(timer);
      container.removeEventListener("scroll", handler);
    };
  }, [syncNavToView, containerRef]);

  return { navIndex, jump };
}
