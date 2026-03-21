import React from "react";

interface SessionCopyButtonProps {
  sessionId: string;
  directory: string;
}

function buildCommand(sessionId: string, directory: string): string {
  const platformHint =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    "";
  const isWindows =
    /Win/i.test(platformHint) || /Windows/i.test(navigator.userAgent || "");

  const quoteForShell = isWindows
    ? (v: string) => `'${v.replace(/'/g, "''")}'`
    : (v: string) => `'${v.replace(/'/g, "'\\\"'\\\"'")}'`;

  const quotedDir = quoteForShell(directory);
  const quotedSessionId = quoteForShell(sessionId);

  return isWindows
    ? `Set-Location -LiteralPath ${quotedDir}; if ($?) { opencode -s ${quotedSessionId} }`
    : `cd ${quotedDir} && opencode -s ${quotedSessionId}`;
}

export function SessionCopyButton({
  sessionId,
  directory,
}: SessionCopyButtonProps) {
  const [state, setState] = React.useState<"idle" | "copied" | "error">("idle");
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCopy = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const command = buildCommand(sessionId, directory);

      (async () => {
        let copied = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(command);
            copied = true;
          } else {
            const textarea = document.createElement("textarea");
            textarea.value = command;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "absolute";
            textarea.style.left = "-9999px";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
              copied = document.execCommand("copy");
            } finally {
              document.body.removeChild(textarea);
            }
          }
        } catch {
          copied = false;
        }

        setState(copied ? "copied" : "error");

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setState("idle"), 1200);
      })();
    },
    [sessionId, directory],
  );

  React.useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const className = [
    "session-copy-btn",
    state === "copied" ? "copied" : "",
    state === "error" ? "copy-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const label =
    state === "copied"
      ? `${sessionId} のコマンドをコピーしました`
      : state === "error"
        ? `${sessionId} のコピーに失敗しました`
        : `${sessionId} のコマンドをコピー`;

  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      title={label}
      onClick={handleCopy}
    >
      <span className="session-copy-icon-copy" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          role="presentation"
        >
          <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </span>
      <span className="session-copy-icon-check" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          role="presentation"
        >
          <polyline points="20 6 10 18 4 12" />
        </svg>
      </span>
      <span className="session-copy-id">{sessionId}</span>
    </button>
  );
}
