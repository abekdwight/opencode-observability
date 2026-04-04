import { Link } from "react-router-dom";
import type { DashboardToolReliabilityRowContract } from "../../../../src/contracts/dashboard";

export function ToolReliabilitySection({
  rows,
}: {
  rows: DashboardToolReliabilityRowContract[];
}) {
  return (
    <section
      className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4"
      id="tool-reliability"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-[var(--color-text-primary)]">
          Tool Reliability
        </h2>
        <Link
          to="/tool-errors"
          className="text-xs font-medium whitespace-nowrap"
        >
          View all tool errors &rarr;
        </Link>
      </div>
      {/* Header */}
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <span className="w-[140px]">Tool</span>
        <span className="w-[55px] text-right">OK</span>
        <span className="w-[45px] text-right">Error</span>
        <span className="flex-1">Error Rate</span>
        <span className="w-[45px]" />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">No data</p>
      ) : (
        rows.map((row) => {
          const pct = row.errorRate.toFixed(1);
          const barW = Math.max(1, row.errorRate);
          const color =
            row.errorRate > 20
              ? "#d32f2f"
              : row.errorRate > 5
                ? "#f57c00"
                : "#4caf50";
          const toolLabel =
            row.tool === "Other" ? (
              <span className="w-[140px] truncate text-[var(--color-text-tertiary)]">
                {row.tool}
              </span>
            ) : (
              <Link
                to={`/tool-errors/${encodeURIComponent(row.tool)}`}
                className="w-[140px] truncate font-mono"
              >
                {row.tool}
              </Link>
            );

          return (
            <div
              key={row.tool}
              className="flex items-center gap-2 border-t border-[var(--color-border-faint)] py-1.5 text-xs"
            >
              {toolLabel}
              <span className="w-[55px] text-right tabular-nums">
                {row.success.toLocaleString()}
              </span>
              <span className="w-[45px] text-right tabular-nums">
                {row.error.toLocaleString()}
              </span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                <div
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: `${barW}%`, background: color }}
                />
              </div>
              <span
                className="w-[45px] text-right font-semibold tabular-nums"
                style={{ color }}
              >
                {pct}%
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}
