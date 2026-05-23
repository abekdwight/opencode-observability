import React from "react";
import { cn } from "../../../lib/cn";

const TRANSITION_MS = 200;

export interface FooterPane {
  key: string;
  node: React.ReactNode;
}

interface FooterPaneSwiperProps {
  panes: FooterPane[];
  activeIndex: number;
}

/**
 * Footer 領域の複数 pane を 1 枠で表示し、`activeIndex` に応じてスライド遷移するコンテナ。
 *
 * pane 切替の入力検出（swipe / keyboard など）は本コンポーネント外で行い、
 * 結果として確定した `activeIndex` を props で受け取る表示専門コンポーネント。
 *
 * 描画方式: 各 pane を absolute で重ね合わせ、`translateX((index - activeIndex) * 100%)` で
 * 水平に並べる。CSS transition で 200ms のスライド遷移。
 * 非アクティブ pane は DOM に残し pointer-events: none / aria-hidden で操作不可にする
 * （React state を保持し、textarea 入力等が pane 切替で失われないようにするため）。
 * Slot 高さは active pane の offsetHeight に追従（ResizeObserver）。
 */
export function FooterPaneSwiper({
  panes,
  activeIndex,
}: FooterPaneSwiperProps): React.ReactElement {
  const [activePaneHeight, setActivePaneHeight] = React.useState<
    number | undefined
  >(undefined);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  React.useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // active pane の切替時、active pane 外に focus がある場合は blur する
  // （textarea にフォーカスを残したまま画面が切り替わる違和感とキーボード残留を防ぐ）
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || !container.contains(focused)) return;
    const activePane = container.children[activeIndex] as
      | HTMLElement
      | undefined;
    if (activePane && !activePane.contains(focused)) {
      focused.blur();
    }
  }, [activeIndex]);

  const attachActivePaneRef = React.useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    setActivePaneHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => {
      setActivePaneHeight(el.offsetHeight);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  const clampedIndex = Math.max(0, Math.min(panes.length - 1, activeIndex));

  return (
    <div
      ref={containerRef}
      className={cn("shrink-0 relative overflow-hidden")}
      style={{
        height: activePaneHeight,
        transition:
          activePaneHeight !== undefined
            ? `height ${TRANSITION_MS}ms ease-out`
            : undefined,
      }}
      data-testid="footer-pane-swiper"
      data-active-index={clampedIndex}
    >
      {panes.map((pane, index) => {
        const isActive = index === clampedIndex;
        return (
          <div
            key={pane.key}
            ref={isActive ? attachActivePaneRef : undefined}
            aria-hidden={!isActive}
            className="absolute top-0 left-0 w-full"
            style={{
              transform: `translateX(${(index - clampedIndex) * 100}%)`,
              transition: `transform ${TRANSITION_MS}ms ease-out`,
              pointerEvents: isActive ? "auto" : "none",
            }}
          >
            {pane.node}
          </div>
        );
      })}
    </div>
  );
}
