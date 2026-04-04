import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "outline";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]",
  success: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]",
  error: "bg-[var(--color-error-bg)] text-[var(--color-error-text)]",
  info: "bg-[var(--color-accent-bg)] text-[var(--color-info)]",
  outline:
    "bg-transparent border border-[var(--color-border-default)] text-[var(--color-text-secondary)]",
};

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "default", className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          variantStyles[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Badge.displayName = "Badge";

export type { BadgeProps, BadgeVariant };
export { Badge };
