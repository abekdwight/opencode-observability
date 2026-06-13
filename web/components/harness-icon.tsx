import type React from "react";
import type { HarnessId } from "../../src/contracts/harness.js";
import claudeLogo from "../assets/claude.png";
import codexLogo from "../assets/codex.png";
import opencodeLogo from "../assets/opencode.png";
import { cn } from "../lib/cn";
import { HARNESS_LABELS } from "../lib/harness";

/**
 * Logo assets per harness (official favicons / org avatars). Harnesses
 * without an entry fall back to a two-letter mark.
 */
const HARNESS_ICON_SRC: Partial<Record<HarnessId, string>> = {
  opencode: opencodeLogo,
  codex: codexLogo,
  claude: claudeLogo,
};

const HARNESS_MARKS: Record<HarnessId, string> = {
  opencode: "oc",
  codex: "cx",
  claude: "cc",
};

export function HarnessIcon({
  harness,
  className,
}: {
  harness: HarnessId;
  className?: string;
}): React.ReactElement {
  const src = HARNESS_ICON_SRC[harness];
  const label = HARNESS_LABELS[harness];

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        title={label}
        className={cn("h-[18px] w-[18px] shrink-0 rounded-[4px]", className)}
      />
    );
  }

  return (
    <span
      role="img"
      title={label}
      aria-label={label}
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center",
        "rounded-[4px] bg-[var(--color-bg-elevated)]",
        "font-[var(--font-mono)] text-[0.58em] leading-none",
        "text-[var(--color-text-secondary)] select-none",
        className,
      )}
    >
      {HARNESS_MARKS[harness]}
    </span>
  );
}
