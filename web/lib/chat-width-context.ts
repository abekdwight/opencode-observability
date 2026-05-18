export type ChatWidth = "default" | "wide" | "full";

const STORAGE_KEY = "ot-chat-width";
const CYCLE: ChatWidth[] = ["default", "wide", "full"];

export function getChatWidth(): ChatWidth {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "wide" || v === "full") return v;
  } catch {
    /* ignore */
  }
  return "default";
}

export function cycleChatWidth(): ChatWidth {
  const current = getChatWidth();
  const idx = CYCLE.indexOf(current);
  const next = CYCLE[(idx + 1) % CYCLE.length];
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}
