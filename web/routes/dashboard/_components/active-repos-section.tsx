import type { DashboardRepoBreakdownContract } from "../../../../src/contracts/dashboard";
import { cn } from "../../../lib/cn";
import { prettifyPath } from "../_lib/formatters";

export function ActiveReposSection({
  repos,
}: {
  repos: DashboardRepoBreakdownContract;
}) {
  if (repos.rows.length === 0) {
    return (
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
          Active Repositories
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          No repository data
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
        Active Repositories
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)]">
              <th className="pb-2 text-left text-xs font-semibold text-[var(--color-text-secondary)]">
                Repository
              </th>
              {repos.dayHeaders.map((day) => {
                const parts = day.split("-");
                return (
                  <th
                    key={day}
                    className="min-w-[54px] pb-2 text-center text-xs font-semibold text-[var(--color-text-secondary)]"
                  >
                    {parts[1]}/{parts[2]}
                  </th>
                );
              })}
              <th className="pb-2 text-right text-xs font-semibold text-[var(--color-text-secondary)]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {repos.rows.map((row) => (
              <tr
                key={row.repo}
                className="border-b border-[var(--color-border-faint)]"
              >
                <td
                  className="max-w-[200px] truncate py-1.5 pr-2 font-mono text-xs"
                  title={row.repo}
                >
                  {prettifyPath(row.repo)}
                </td>
                {row.dayCells.map((cell) => (
                  <td
                    key={cell.day}
                    className={cn(
                      "py-1.5 text-center text-xs",
                      cell.muted
                        ? "text-[var(--color-text-tertiary)]"
                        : "text-[var(--color-text-primary)]",
                    )}
                  >
                    {cell.label}
                  </td>
                ))}
                <td className="py-1.5 text-right text-xs font-semibold">
                  {row.totalLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
