import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {}

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-bg-elevated)]",
        className,
      )}
      {...props}
    />
  );
}

export type { SkeletonProps };
export { Skeleton };
