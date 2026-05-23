import React from "react";
import type { MonitorPromptEnqueueResponseContract } from "../../../../src/contracts/monitor-command.js";

type PromptSendState = "idle" | "sending" | "queued" | "error";

export function SessionPromptBar({
  sessionId,
}: {
  sessionId: string;
}): React.ReactElement {
  const [text, setText] = React.useState("");
  const [state, setState] = React.useState<PromptSendState>("idle");

  const normalizedText = text.trim();
  const canSend = normalizedText.length > 0 && state !== "sending";

  const sendPrompt = React.useCallback(async () => {
    if (!canSend) {
      return;
    }

    setState("sending");
    try {
      const response = await fetch(
        `/api/monitor/sessions/${encodeURIComponent(sessionId)}/prompt`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: normalizedText }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      (await response.json()) as MonitorPromptEnqueueResponseContract;
      setText("");
      setState("queued");
      window.setTimeout(() => setState("idle"), 1200);
    } catch {
      setState("error");
    }
  }, [canSend, normalizedText, sessionId]);

  return (
    <form
      className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[var(--space-lg)] py-[var(--space-md)]"
      onSubmit={(event) => {
        event.preventDefault();
        void sendPrompt();
      }}
      data-testid="session-prompt-form"
    >
      <div className="flex min-w-0 items-end gap-[var(--space-sm)]">
        <textarea
          className="min-h-10 max-h-32 flex-1 resize-y rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm leading-snug text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (state !== "sending") {
              setState("idle");
            }
          }}
          placeholder="Message"
          rows={2}
          data-testid="session-prompt-input"
        />
        <button
          type="submit"
          className="h-10 shrink-0 rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-text-inverse)] transition-all duration-[var(--transition-fast)] hover:brightness-105 disabled:cursor-not-allowed disabled:border-[var(--color-border-default)] disabled:bg-[var(--color-bg-elevated)] disabled:text-[var(--color-text-tertiary)]"
          disabled={!canSend}
          data-testid="session-prompt-send"
        >
          {state === "sending"
            ? "Sending"
            : state === "queued"
              ? "Queued"
              : "Send"}
        </button>
      </div>
      {state === "error" ? (
        <div className="mt-1 text-xs text-[var(--color-error)]">
          Failed to send
        </div>
      ) : null}
    </form>
  );
}
