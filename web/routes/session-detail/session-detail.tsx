import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { HarnessSessionDetailContract } from "../../../src/contracts/harness.js";
import { useJson } from "../../hooks/use-json";
import { buildResumeCommand } from "../../lib/harness";
import { useLayoutMode } from "../../lib/layout-context";
import { ControlBar } from "./_components/control-bar";
import { FooterPaneSwiper } from "./_components/footer-pane-swiper";
import { MessageList } from "./_components/message-list";
import { SessionPromptBar } from "./_components/session-prompt-bar";
import { SessionSidebar } from "./_components/session-sidebar";
import { SessionTopBar } from "./_components/session-top-bar";
import { useMessageNavigation } from "./_hooks/use-message-navigation";
import { useOpenDetails } from "./_hooks/use-open-details";
import { useSessionPreferences } from "./_hooks/use-session-preferences";
import { applyOmoFilter, detectOmoContent } from "./_lib/omo-filter";

// ---------------------------------------------------------------------------
// Keyboard shortcuts for session detail (Ctrl/Cmd + key)
// ---------------------------------------------------------------------------
function useSessionShortcuts(actions: {
  toggleCollapse: () => void;
  cycleFilter: () => void;
  togglePlain: () => void;
  toggleTools: () => void;
  toggleSidebar: () => void;
  toggleOmoFilter: () => void;
  cyclePanePrev: () => void;
  cyclePaneNext: () => void;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only fire with Ctrl (Windows/Linux) or Cmd (Mac)
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Pane cycle (Cmd/Ctrl + Shift + < / >)
      // Use e.code to be robust against keyboard layout differences
      // (< is Shift+Comma, > is Shift+Period)
      if (e.shiftKey) {
        if (e.code === "Comma") {
          e.preventDefault();
          actions.cyclePanePrev();
          return;
        }
        if (e.code === "Period") {
          e.preventDefault();
          actions.cyclePaneNext();
          return;
        }
      }

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
        case "o": // OMO filter toggle
          e.preventDefault();
          actions.toggleOmoFilter();
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [actions]);
}

// ---------------------------------------------------------------------------
// Page-wide horizontal swipe detection for Footer pane navigation
// ---------------------------------------------------------------------------
const SWIPE_DISTANCE_THRESHOLD_PX = 35;

interface SwipeDragState {
  startX: number;
  startY: number;
  pointerId: number;
}

function usePageSwipeNavigation(actions: {
  cyclePanePrev: () => void;
  cyclePaneNext: () => void;
}) {
  const dragRef = React.useRef<SwipeDragState | null>(null);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("textarea, input, [data-no-swipe]")) return;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
      };
    },
    [],
  );

  // pointerup と pointercancel の両方で同じ判定を行う
  // iOS Safari は縦スクロール開始時に pointercancel を発火し pointerup を送らないため、
  // cancel タイミングの clientX/Y（スクロール開始直前の座標）でも swipe を判定する
  const evaluateSwipe = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (event.pointerId !== drag.pointerId) return;
      dragRef.current = null;

      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaX) < SWIPE_DISTANCE_THRESHOLD_PX) return;
      // 縦ブレ許容: 横移動の 2 倍を超える縦移動があった場合のみ縦 swipe としてキャンセル
      // （許容角 ≈ ±63度。pointercancel 経由の判定とのバランスで誤発動を抑える）
      if (Math.abs(deltaY) > Math.abs(deltaX) * 2) return;

      if (deltaX < 0) {
        actions.cyclePaneNext();
      } else {
        actions.cyclePanePrev();
      }
    },
    [actions],
  );

  return {
    onPointerDown,
    onPointerUp: evaluateSwipe,
    onPointerCancel: evaluateSwipe,
  };
}

// ---------------------------------------------------------------------------
// SessionDetailPage -- page-level orchestrator
// ---------------------------------------------------------------------------
export function SessionDetailPage(): React.ReactElement | null {
  const { harness: rawHarness = "", id: sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { setMode } = useLayoutMode();

  // Switch to IDE layout mode on mount, reset on unmount
  React.useEffect(() => {
    setMode("ide");
    return () => setMode("default");
  }, [setMode]);

  const { data, error, loading } = useJson<HarnessSessionDetailContract>(
    `/api/sessions/${encodeURIComponent(rawHarness)}/${encodeURIComponent(sessionId)}`,
  );

  // Set document title to session title
  React.useEffect(() => {
    if (data) {
      document.title = `${data.session.title} \u2014 ${data.harness.label}`;
    }
    return () => {
      document.title = "OpenCode Observability";
    };
  }, [data]);

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
    {
      collapseEnabled,
      filterMode,
      plainMode,
      toolsVisible,
      sidebarOpen,
      omoFilter,
    },
    {
      toggleCollapse,
      cycleFilter,
      togglePlain,
      toggleTools,
      toggleSidebar,
      toggleOmoFilter,
    },
  ] = useSessionPreferences({
    getAnchor: getAnchorNoop,
    restoreAnchor: restoreAnchorNoop,
    recheckOverflows: recheckOverflowsNoop,
  });

  // OMO detection (memoised — runs once per message set)
  const messages = data?.messages ?? [];
  const hasOmoContent = React.useMemo(
    () => detectOmoContent(messages),
    [messages],
  );

  // Filtered messages count (accounts for omo + role filter)
  const visibleCount = React.useMemo(() => {
    const list =
      omoFilter && hasOmoContent ? applyOmoFilter(messages) : messages;
    if (filterMode === "all") return list.length;
    return list.filter((m) => m.role === filterMode).length;
  }, [messages, filterMode, omoFilter, hasOmoContent]);

  // Navigation
  const { navIndex, jump: jumpMessage } = useMessageNavigation({
    containerRef,
    visibleCount,
    filterMode,
  });

  // Footer pane navigation state — the prompt pane exists only when the
  // harness supports dispatching follow-up prompts.
  const paneCount = data?.harness.capabilities.livePrompt ? 2 : 1;
  const [activePaneIndex, setActivePaneIndex] = React.useState(0);
  const cyclePanePrev = React.useCallback(() => {
    setActivePaneIndex((i) => Math.max(0, i - 1));
  }, []);
  const cyclePaneNext = React.useCallback(() => {
    setActivePaneIndex((i) => Math.min(paneCount - 1, i + 1));
  }, [paneCount]);

  // Keyboard shortcuts
  useSessionShortcuts(
    React.useMemo(
      () => ({
        toggleCollapse,
        cycleFilter,
        togglePlain,
        toggleTools,
        toggleSidebar,
        toggleOmoFilter,
        cyclePanePrev,
        cyclePaneNext,
      }),
      [
        toggleCollapse,
        cycleFilter,
        togglePlain,
        toggleTools,
        toggleSidebar,
        toggleOmoFilter,
        cyclePanePrev,
        cyclePaneNext,
      ],
    ),
  );

  // Page-wide horizontal swipe -> footer pane navigation
  const pageSwipe = usePageSwipeNavigation(
    React.useMemo(
      () => ({ cyclePanePrev, cyclePaneNext }),
      [cyclePanePrev, cyclePaneNext],
    ),
  );

  // Command palette -> footer pane navigation
  React.useEffect(() => {
    const handlePrev = () => cyclePanePrev();
    const handleNext = () => cyclePaneNext();
    window.addEventListener("ot-footer-pane-cycle-prev", handlePrev);
    window.addEventListener("ot-footer-pane-cycle-next", handleNext);
    return () => {
      window.removeEventListener("ot-footer-pane-cycle-prev", handlePrev);
      window.removeEventListener("ot-footer-pane-cycle-next", handleNext);
    };
  }, [cyclePanePrev, cyclePaneNext]);

  // Body class for plain mode
  React.useEffect(() => {
    document.body.classList.toggle("plain-mode", plainMode);
    return () => {
      document.body.classList.remove("plain-mode");
    };
  }, [plainMode]);

  // Copy resume command
  const handleCopy = React.useCallback(async () => {
    if (!data) return;
    const cmd = buildResumeCommand(
      data.harness.id,
      data.session.id,
      data.session.directory,
    );
    try {
      await navigator.clipboard.writeText(cmd);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  }, [data]);

  // Delete session (capability-gated)
  const handleDelete = React.useCallback(async () => {
    if (!data || !data.harness.capabilities.delete) return;
    if (
      !window.confirm(
        "\u3053\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u3068\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F\n\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002",
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/sessions/${data.harness.id}/${encodeURIComponent(data.session.id)}`,
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
      navigate("/sessions");
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
        <p
          className="m-0 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading session detail...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="grid gap-2.5">
        <p
          className="m-0 rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
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
      onPointerDown={pageSwipe.onPointerDown}
      onPointerUp={pageSwipe.onPointerUp}
      onPointerCancel={pageSwipe.onPointerCancel}
    >
      <SessionTopBar
        harness={data.harness}
        session={data.session}
        copyState={copyState}
        onCopy={handleCopy}
        onDelete={handleDelete}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        hasOmoContent={hasOmoContent}
        omoFilter={omoFilter}
        onToggleOmoFilter={toggleOmoFilter}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 w-full">
          <MessageList
            messages={data.messages}
            filterMode={filterMode}
            omoFilter={omoFilter && hasOmoContent}
            toolsVisible={toolsVisible}
            plainMode={plainMode}
            collapseEnabled={collapseEnabled}
            openDetails={openDetails}
            onToggleToolDetail={toggleToolDetail}
            containerRef={containerRef}
          />

          <FooterPaneSwiper
            activeIndex={activePaneIndex}
            panes={[
              {
                key: "main",
                node: (
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
                ),
              },
              ...(data.harness.capabilities.livePrompt
                ? [
                    {
                      key: "prompt",
                      node: <SessionPromptBar sessionId={data.session.id} />,
                    },
                  ]
                : []),
            ]}
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
