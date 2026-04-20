import React from "react";
import type { FilterMode } from "../_lib/constants";

interface MessageNode {
  element: HTMLElement;
  role: "user" | "assistant";
  absoluteIndex: number;
}

function collectVisibleMessageNodes(
  container: HTMLDivElement | null,
  filterMode: FilterMode,
): MessageNode[] {
  if (!container) return [];
  const selector =
    filterMode === "assistant"
      ? "[data-message-role='assistant']:not([data-hidden])"
      : filterMode === "user"
        ? "[data-message-role='user']:not([data-hidden])"
        : "[data-message-role]:not([data-hidden])";
  const nodeList = container.querySelectorAll<HTMLElement>(selector);
  return Array.from(nodeList).map((element, absoluteIndex) => ({
    element,
    role: element.dataset.messageRole === "user" ? "user" : "assistant",
    absoluteIndex,
  }));
}

function findAnchorIndex(
  nodes: MessageNode[],
  container: HTMLDivElement | null,
): number {
  if (!container || nodes.length === 0) return -1;
  const containerTop = container.getBoundingClientRect().top + 12;
  let anchorIndex = nodes[nodes.length - 1]?.absoluteIndex ?? -1;
  for (const node of nodes) {
    if (node.element.getBoundingClientRect().bottom > containerTop) {
      anchorIndex = node.absoluteIndex;
      break;
    }
  }
  return anchorIndex;
}

function selectJumpTargets(
  nodes: MessageNode[],
  filterMode: FilterMode,
): MessageNode[] {
  if (filterMode === "assistant") {
    return nodes.filter((node) => node.role === "assistant");
  }
  const userNodes = nodes.filter((node) => node.role === "user");
  return userNodes.length > 0 ? userNodes : nodes;
}

// ---------------------------------------------------------------------------
// useMessageNavigation — j/k keyboard nav + scroll sync for message counter
// ---------------------------------------------------------------------------
export function useMessageNavigation(options: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  visibleCount: number;
  filterMode: FilterMode;
}): {
  navIndex: number;
  jump: (dir: number) => void;
} {
  const { containerRef, visibleCount, filterMode } = options;

  const [navIndex, setNavIndex] = React.useState(() =>
    visibleCount > 0 ? visibleCount - 1 : -1,
  );

  React.useEffect(() => {
    if (visibleCount === 0) {
      setNavIndex(-1);
      return;
    }
    setNavIndex((prev) => {
      if (prev < 0 || prev >= visibleCount) return visibleCount - 1;
      return prev;
    });
  }, [visibleCount]);

  const syncNavToView = React.useCallback(() => {
    if (visibleCount === 0) {
      setNavIndex(-1);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const nodes = collectVisibleMessageNodes(container, filterMode);
    const anchorIndex = findAnchorIndex(nodes, container);
    setNavIndex(anchorIndex);
  }, [visibleCount, containerRef, filterMode]);

  const jump = React.useCallback(
    (dir: number) => {
      const container = containerRef.current;
      if (!container) return;

      const nodes = collectVisibleMessageNodes(container, filterMode);
      if (nodes.length === 0) return;

      const targets = selectJumpTargets(nodes, filterMode);
      if (targets.length === 0) return;

      const current =
        navIndex >= 0 ? navIndex : findAnchorIndex(nodes, container);
      const clampedCurrent = Math.max(0, Math.min(nodes.length - 1, current));

      const target =
        dir > 0
          ? targets.find((node) => node.absoluteIndex > clampedCurrent)
          : [...targets]
              .reverse()
              .find((node) => node.absoluteIndex < clampedCurrent);
      if (!target) return;

      container.scrollTo({
        top: target.element.offsetTop - 12,
        behavior: "instant",
      });
      target.element.classList.add("nav-highlight");
      setTimeout(() => target.element.classList.remove("nav-highlight"), 800);
      setNavIndex(target.absoluteIndex);
    },
    [containerRef, filterMode, navIndex],
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
    let rafId = 0;
    const handler = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncNavToView);
    };
    container.addEventListener("scroll", handler, { passive: true });
    syncNavToView();
    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("scroll", handler);
    };
  }, [syncNavToView, containerRef]);

  React.useEffect(() => {
    syncNavToView();
  }, [syncNavToView]);

  return { navIndex, jump };
}
