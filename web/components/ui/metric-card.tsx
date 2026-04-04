import { cn } from "../../lib/cn";

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}

function MetricCard({ label, value, sub, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3",
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
          {sub}
        </p>
      )}
    </div>
  );
}

export type { MetricCardProps };
export { MetricCard };
