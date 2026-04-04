import type { DashboardMcpUsageRowContract } from "../../../../src/contracts/dashboard";

export function McpUsageSection({
  rows,
}: {
  rows: DashboardMcpUsageRowContract[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
          MCP Tool Usage
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)]">No data</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
        MCP Tool Usage
      </h2>
      {/* Header */}
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
        <span className="w-[140px]">Server</span>
        <span className="w-[55px] text-right">Calls</span>
        <span className="w-[45px] text-right">Errors</span>
        <span className="flex-1">Error Rate</span>
        <span className="w-[45px]" />
      </div>
      {/* Rows */}
      {rows.map((row) => {
        const pct = row.errorRate.toFixed(1);
        const barW = Math.max(1, row.errorRate);
        const color =
          row.errorRate > 20
            ? "#d32f2f"
            : row.errorRate > 5
              ? "#f57c00"
              : "#4caf50";
        return (
          <div
            key={row.server}
            className="flex items-center gap-2 border-t border-[var(--color-border-faint)] py-1.5 text-xs"
          >
            <span className="w-[140px] truncate font-mono">
              {row.isBuiltin ? (
                <span className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
                  Builtin Tools
                </span>
              ) : (
                row.server
              )}
            </span>
            <span className="w-[55px] text-right tabular-nums">
              {row.calls.toLocaleString()}
            </span>
            <span className="w-[45px] text-right tabular-nums">
              {row.errors.toLocaleString()}
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
      })}
    </div>
  );
}
