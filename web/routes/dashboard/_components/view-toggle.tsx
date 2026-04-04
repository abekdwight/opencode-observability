import type { DashboardViewContract } from "../../../../src/contracts/dashboard";
import { cn } from "../../../lib/cn";

export function ViewToggle({
  view,
  onToggle,
}: {
  view: DashboardViewContract;
  onToggle: (v: DashboardViewContract) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-0.5"
      role="tablist"
      aria-label="View mode"
    >
      <button
        type="button"
        className={cn(
          "rounded-md px-3 py-1 text-xs font-medium transition-colors",
          view === "daily"
            ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
        )}
        onClick={() => onToggle("daily")}
        aria-pressed={view === "daily"}
        data-testid="dashboard-view-toggle-daily"
      >
        Daily
      </button>
      <button
        type="button"
        className={cn(
          "rounded-md px-3 py-1 text-xs font-medium transition-colors",
          view === "hourly"
            ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
            : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
        )}
        onClick={() => onToggle("hourly")}
        aria-pressed={view === "hourly"}
        data-testid="dashboard-view-toggle-hourly"
      >
        Hourly
      </button>
    </div>
  );
}
