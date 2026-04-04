import type { DashboardBarItemContract } from "../../../../src/contracts/dashboard";
import { CssBarChart } from "../../../components/charts/css-bar-chart";

export function ErrorPatternsSection({
  patterns,
}: {
  patterns: DashboardBarItemContract[];
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
        Error Patterns
      </h2>
      <CssBarChart items={patterns} barColor="#d32f2f" />
    </section>
  );
}
