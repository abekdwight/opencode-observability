import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type KbdProps = HTMLAttributes<HTMLElement>;

const Kbd = forwardRef<HTMLElement, KbdProps>(
  ({ className, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-sm border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]",
          className,
        )}
        {...props}
      />
    );
  },
);

Kbd.displayName = "Kbd";

export type { KbdProps };
export { Kbd };
