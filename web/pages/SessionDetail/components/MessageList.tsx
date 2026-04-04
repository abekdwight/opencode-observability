import React from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { SessionMessageContract } from "../../../../src/contracts/session.js";
import type { FilterMode } from "../lib/constants";
import { MessageRow } from "./MessageRow";

export interface MessageListProps {
  messages: SessionMessageContract[];
  filterMode: FilterMode;
  toolsVisible: boolean;
  plainMode: boolean;
  collapseEnabled: boolean;
  openDetails: Set<string>;
  onToggleToolDetail: (id: string) => void;
  listRef: React.RefObject<VirtuosoHandle | null>;
  onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
}

/**
 * Builds the visible message list with original indices preserved.
 */
function useFilteredMessages(
  messages: SessionMessageContract[],
  filterMode: FilterMode,
): Array<{ msg: SessionMessageContract; originalIdx: number }> {
  return React.useMemo(
    () =>
      messages
        .map((msg, idx) => ({ msg, originalIdx: idx }))
        .filter(
          ({ msg }) => filterMode === "all" || msg.role === filterMode,
        ),
    [messages, filterMode],
  );
}

/**
 * Wrapper around the chat list that renders all visible messages.
 * Uses react-virtuoso for virtual scrolling.
 */
export function MessageList({
  messages,
  filterMode,
  toolsVisible,
  plainMode,
  collapseEnabled,
  openDetails,
  onToggleToolDetail,
  listRef,
  onRangeChanged,
}: MessageListProps): React.ReactElement {
  const filteredMessages = useFilteredMessages(messages, filterMode);

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
    <Virtuoso
      ref={listRef}
      className="flex-1 overflow-y-auto overflow-x-hidden scroll-auto overscroll-contain"
      data={filteredMessages}
      initialTopMostItemIndex={filteredMessages.length - 1}
      overscan={200}
      rangeChanged={onRangeChanged}
      itemContent={(_index, item) => (
        <div className="py-[var(--space-sm)] px-[var(--space-2xl)] pb-[var(--space-xl)] max-w-[960px] mx-auto w-full">
          <MessageRow
            key={`${item.msg.createdAt}-${item.msg.role}-${item.msg.text.slice(0, 32)}`}
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
      )}
      data-testid="chat-messages"
    />
  );
}
