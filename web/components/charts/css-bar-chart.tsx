import React from "react";
import type { DashboardBarItemContract } from "../../../src/contracts/dashboard";

interface Props {
  items: DashboardBarItemContract[];
  barColor: string;
}

export const CssBarChart = React.memo(function CssBarChart({
  items,
  barColor,
}: Props) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">No data</p>
    );
  }

  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div>
      {items.map(({ label, count, annotation }) => {
        const pct = (count / maxCount) * 100;
        return (
          <div className="mb-2" key={`${label}-${annotation ?? ""}`}>
            <div className="mb-[3px] flex items-center justify-between">
              <span className="max-w-[70%] truncate text-[0.82em] font-medium text-[var(--color-text-primary)]">
                {label}
                {annotation ? (
                  <span className="text-[0.9em] font-medium text-[var(--color-text-secondary)]">
                    {" "}
                    · {annotation}
                  </span>
                ) : null}
              </span>
              <span className="ml-2 shrink-0 text-[0.8em] font-semibold text-[var(--color-text-secondary)]">
                {count.toLocaleString()}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-[var(--radius-sm)]"
              style={{ background: `${barColor}26` }}
            >
              <div
                className="h-full rounded-[var(--radius-sm)]"
                style={{
                  width: `${pct.toFixed(1)}%`,
                  background: barColor,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});
