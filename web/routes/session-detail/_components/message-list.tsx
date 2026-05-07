import React from "react";
import type { SessionMessageContract } from "../../../../src/contracts/session.js";
import type { FilterMode } from "../_lib/constants";
import { applyOmoFilter } from "../_lib/omo-filter";
import { cn } from "../../../lib/cn";
import { MessageRow } from "./message-row";

export interface MessageListProps {
  messages: SessionMessageContract[];
  filterMode: FilterMode;
  omoFilter: boolean;
  toolsVisible: boolean;
  plainMode: boolean;
  collapseEnabled: boolean;
  openDetails: Set<string>;
  onToggleToolDetail: (id: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Builds the visible message list with original indices preserved.
 * When omoFilter is enabled, synthetic OMO messages are removed and
 * OMO-prefixed user messages have their prefix stripped.
 */
function useFilteredMessages(
  messages: SessionMessageContract[],
  filterMode: FilterMode,
  omoFilter: boolean,
): Array<{ msg: SessionMessageContract; originalIdx: number }> {
  return React.useMemo(() => {
    const source = omoFilter ? applyOmoFilter(messages) : messages;
    return source
      .map((msg, idx) => ({ msg, originalIdx: idx }))
      .filter(
        ({ msg }) => filterMode === "all" || msg.role === filterMode,
      );
  }, [messages, filterMode, omoFilter]);
}

/**
 * Wrapper around the chat list that renders all visible messages.
 * Uses a plain div list for full browser text search and copy support.
 */
export function MessageList({
  messages,
  filterMode,
  omoFilter,
  toolsVisible,
  plainMode,
  collapseEnabled,
  openDetails,
  onToggleToolDetail,
  containerRef,
}: MessageListProps): React.ReactElement {
  const filteredMessages = useFilteredMessages(messages, filterMode, omoFilter);

  // Scroll to bottom on initial mount
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-auto overscroll-contain">
        <p className="py-10 px-[var(--space-xl)] text-center text-[var(--color-text-secondary)]">
          {"\u30E1\u30C3\u30BB\u30FC\u30B8\u306F\u3042\u308A\u307E\u305B\u3093"}
        </p>
      </div>
    );
  }

  if (filteredMessages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-auto overscroll-contain">
        <p className="py-10 px-[var(--space-xl)] text-center text-[var(--color-text-secondary)]">
          {"\u8868\u793A\u3059\u308B\u30E1\u30C3\u30BB\u30FC\u30B8\u304C\u3042\u308A\u307E\u305B\u3093"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden scroll-auto overscroll-contain"
      data-testid="chat-messages"
    >
      {filteredMessages.map((item) => (
        <div
          key={`${item.msg.createdAt}-${item.msg.role}-${item.msg.text.slice(0, 32)}`}
          className={cn(
            "px-[var(--space-2xl)] max-w-[960px] mx-auto w-full",
            item.msg.text.length > 0
              ? "py-[var(--space-sm)] pb-[var(--space-xl)]"
              : "py-[var(--space-xs)] pb-[var(--space-sm)]",
          )}
        >
          <MessageRow
            msg={item.msg}
            msgIdx={item.originalIdx}
            hidden={false}
            toolsVisible={toolsVisible}
            plainMode={plainMode}
            collapseEnabled={collapseEnabled}
            openDetails={openDetails}
            onToggleDetail={onToggleToolDetail}
          />
        </div>
      ))}
    </div>
  );
}
