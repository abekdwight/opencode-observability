import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SessionDetailContract } from "../../../src/contracts/session.js";
import { useJson } from "../../hooks/use-json";
import { useLayoutMode } from "../../lib/layout-context";
import { ControlBar } from "./_components/control-bar";
import { MessageList } from "./_components/message-list";
import { SessionSidebar } from "./_components/session-sidebar";
import { SessionTopBar } from "./_components/session-top-bar";
import { useOpenDetails } from "./_hooks/use-open-details";
import { useSessionPreferences } from "./_hooks/use-session-preferences";
import { buildCopyCommand } from "./_lib/copy-command";

// ---------------------------------------------------------------------------
// useScrollNavigation -- j/k navigation for a plain scrollable container
// ---------------------------------------------------------------------------
function useScrollNavigation(
  containerRef: React.RefObject<HTMLDivElement | null>,
  visibleCount: number,
): {
  navIndex: number;
  jump: (dir: number) => void;
} {
  const [navIndex, setNavIndex] = React.useState(() =>
    visibleCount > 0 ? visibleCount - 1 : 0,
  );

  // Initialize to last message when data first loads
  React.useEffect(() => {
    if (visibleCount > 0) {
      setNavIndex(visibleCount - 1);
    }
  }, [visibleCount]);

  const jump = React.useCallback(
    (dir: number) => {
      if (visibleCount === 0) return;
      setNavIndex((prev) => {
        const next = Math.max(0, Math.min(visibleCount - 1, prev + dir));
        // Scroll the target message into view
        const container = containerRef.current;
        if (container) {
          const children = container.children;
          const child = children[next] as HTMLElement | undefined;
          child?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return next;
      });
    },
    [visibleCount, containerRef],
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

  return { navIndex, jump };
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts for session detail (Ctrl/Cmd + key)
// ---------------------------------------------------------------------------
function useSessionShortcuts(actions: {
  toggleCollapse: () => void;
  cycleFilter: () => void;
  togglePlain: () => void;
  toggleTools: () => void;
  toggleSidebar: () => void;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only fire with Ctrl (Windows/Linux) or Cmd (Mac)
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case "e": // Expand/collapse
          e.preventDefault();
          actions.toggleCollapse();
          break;
        case "u": // User/Assistant filter
          e.preventDefault();
          actions.cycleFilter();
          break;
        case "m": // Markdown/plain toggle
          e.preventDefault();
          actions.togglePlain();
          break;
        case ".": // Tool visibility
          e.preventDefault();
          actions.toggleTools();
          break;
        case "b": // Sidebar toggle
          e.preventDefault();
          actions.toggleSidebar();
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [actions]);
}

// ---------------------------------------------------------------------------
// SessionDetailPage -- page-level orchestrator
// ---------------------------------------------------------------------------
export function SessionDetailPage(): React.ReactElement | null {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { setMode } = useLayoutMode();

  // Switch to IDE layout mode on mount, reset on unmount
  React.useEffect(() => {
    setMode("ide");
    return () => setMode("default");
  }, [setMode]);

  const { data, error, loading } = useJson<SessionDetailContract>(
    `/api/session/${encodeURIComponent(sessionId)}`,
  );

  // Scrollable container ref
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Copy state
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "error">(
    "idle",
  );

  // Tool detail open map
  const { openDetails, toggle: toggleToolDetail } = useOpenDetails();

  // Provide a no-op recheckOverflows since MessageRow now manages its own
  const recheckOverflowsNoop = React.useCallback(() => {}, []);

  // Provide no-op scroll anchor (no longer needed with plain list)
  const getAnchorNoop = React.useCallback(
    () => null as { el: HTMLElement; offset: number } | null,
    [],
  );
  const restoreAnchorNoop = React.useCallback(
    (_anchor: { el: HTMLElement; offset: number } | null) => {},
    [],
  );

  // View preferences
  const [
    { collapseEnabled, filterMode, plainMode, toolsVisible, sidebarOpen },
    { toggleCollapse, cycleFilter, togglePlain, toggleTools, toggleSidebar },
  ] = useSessionPreferences({
    getAnchor: getAnchorNoop,
    restoreAnchor: restoreAnchorNoop,
    recheckOverflows: recheckOverflowsNoop,
  });

  // Filtered messages count
  const messages = data?.messages ?? [];
  const visibleCount = React.useMemo(() => {
    if (filterMode === "all") return messages.length;
    return messages.filter((m) => m.role === filterMode).length;
  }, [messages, filterMode]);

  // Navigation
  const { navIndex, jump: jumpMessage } = useScrollNavigation(
    containerRef,
    visibleCount,
  );

  // Keyboard shortcuts
  useSessionShortcuts(
    React.useMemo(
      () => ({
        toggleCollapse,
        cycleFilter,
        togglePlain,
        toggleTools,
        toggleSidebar,
      }),
      [toggleCollapse, cycleFilter, togglePlain, toggleTools, toggleSidebar],
    ),
  );

  // Body class for plain mode
  React.useEffect(() => {
    document.body.classList.toggle("plain-mode", plainMode);
    return () => {
      document.body.classList.remove("plain-mode");
    };
  }, [plainMode]);

  // Copy command
  const handleCopy = React.useCallback(async () => {
    if (!data) return;
    const cmd = buildCopyCommand(data.session.id, data.session.directory);
    try {
      await navigator.clipboard.writeText(cmd);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  }, [data]);

  // Delete session
  const handleDelete = React.useCallback(async () => {
    if (!data) return;
    if (
      !window.confirm(
        "\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3068\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\n\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002",
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/session/${encodeURIComponent(data.session.id)}`,
        {
          method: "DELETE",
          headers: { "x-opencode-confirm-delete": data.session.id },
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        window.alert(
          `\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${err.error || res.statusText}`,
        );
        return;
      }
      navigate("/");
    } catch (e) {
      window.alert(
        `\u524A\u9664\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [data, navigate]);

  // --- Render ---

  if (loading) {
    return (
      <section className="grid gap-2.5">
        <p className="m-0 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]" data-testid="route-loading">
          Loading session detail...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="grid gap-2.5">
        <p className="m-0 rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]" data-testid="route-error">
          Session API unavailable: {error}
        </p>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section
      className="session-detail-page flex-1 flex flex-col overflow-hidden p-0"
      data-testid="session-detail"
    >
      <SessionTopBar
        session={data.session}
        copyState={copyState}
        onCopy={handleCopy}
        onDelete={handleDelete}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 w-full">
          <MessageList
            messages={data.messages}
            filterMode={filterMode}
            toolsVisible={toolsVisible}
            plainMode={plainMode}
            collapseEnabled={collapseEnabled}
            openDetails={openDetails}
            onToggleToolDetail={toggleToolDetail}
            containerRef={containerRef}
          />

          <ControlBar
            collapseEnabled={collapseEnabled}
            onToggleCollapse={toggleCollapse}
            filterMode={filterMode}
            onCycleFilter={cycleFilter}
            plainMode={plainMode}
            onTogglePlain={togglePlain}
            collapseDisabled={plainMode}
            toolsVisible={toolsVisible}
            onToggleTools={toggleTools}
            navIndex={navIndex}
            totalVisible={visibleCount}
            onJump={jumpMessage}
          />
        </div>

        <SessionSidebar
          data={data}
          open={sidebarOpen}
          openDetails={openDetails}
          onToggleDetail={toggleToolDetail}
        />
      </div>
    </section>
  );
}
