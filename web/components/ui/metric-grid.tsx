import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface MetricGridProps {
  children: ReactNode;
  columns?: number;
  className?: string;
}

function MetricGrid({ children, className }: MetricGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type { MetricGridProps };
export { MetricGrid };
