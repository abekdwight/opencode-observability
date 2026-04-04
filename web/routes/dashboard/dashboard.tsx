import React from "react";
import { useSearchParams } from "react-router-dom";
import type {
  DashboardBarItemContract,
  DashboardContract,
  DashboardViewContract,
} from "../../../src/contracts/dashboard";
import { ActivityHeatmap } from "../../components/charts/activity-heatmap";
import { CssBarChart } from "../../components/charts/css-bar-chart";
import {
  applyDashboardDraftSelection,
  createDashboardRequestVersionTracker,
  createDashboardSelectionController,
  serializeAppliedDashboardSelection,
  setDashboardDraftView,
} from "../../lib/dashboard-selection";
import { ActiveReposSection } from "./_components/active-repos-section";
import { ErrorPatternsSection } from "./_components/error-patterns-section";
import { ErrorTrendSection } from "./_components/error-trend-section";
import { McpUsageSection } from "./_components/mcp-usage-section";
import { ModelPerformanceSection } from "./_components/model-performance-section";
import { ModelTokenConsumptionSection } from "./_components/model-token-consumption-section";
import { RecentSessions } from "./_components/recent-sessions";
import { SubagentTrendSection } from "./_components/subagent-trend-section";
import { SummaryMetrics } from "./_components/summary-metrics";
import { TimeRangeSelector } from "./_components/time-range-selector";
import { TokenTrendSection } from "./_components/token-trend-section";
import { ToolReliabilitySection } from "./_components/tool-reliability-section";
import { REFRESH_INTERVAL } from "./_lib/constants";
import { buildLastYearBounds } from "./_lib/formatters";

/* ── Inline bar chart section (used in 2-col grid) ── */

function BarChartCard({
  title,
  items,
  barColor,
}: {
  title: string;
  items: DashboardBarItemContract[];
  barColor: string;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
        {title}
      </h2>
      <CssBarChart items={items} barColor={barColor} />
    </section>
  );
}

/* ── Main Dashboard ── */

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const controllerFromUrl = React.useMemo(
    () => createDashboardSelectionController(searchParams),
    [searchParams],
  );
  const [selectionController, setSelectionController] =
    React.useState(controllerFromUrl);
  const requestVersionTrackerRef = React.useRef(
    createDashboardRequestVersionTracker(),
  );

  React.useEffect(() => {
    const currentApplied = serializeAppliedDashboardSelection(
      selectionController.appliedSelection,
    ).toString();
    const nextApplied = serializeAppliedDashboardSelection(
      controllerFromUrl.appliedSelection,
    ).toString();
    if (currentApplied !== nextApplied) {
      setSelectionController(controllerFromUrl);
    }
  }, [controllerFromUrl, selectionController.appliedSelection]);

  const { appliedSelection, apiUrl } = selectionController;
  const view = appliedSelection.view;
  const [data, setData] = React.useState<DashboardContract | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  /* Fetch + periodic refresh */
  React.useEffect(() => {
    let cancelled = false;
    const controllers = new Set<AbortController>();

    async function load() {
      const requestVersion = requestVersionTrackerRef.current.start();
      const controller = new AbortController();
      controllers.add(controller);
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(apiUrl, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as DashboardContract;
        if (
          !cancelled &&
          requestVersionTrackerRef.current.isCurrent(requestVersion)
        ) {
          setData(json);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (
          !cancelled &&
          requestVersionTrackerRef.current.isCurrent(requestVersion)
        )
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        controllers.delete(controller);
        if (
          !cancelled &&
          requestVersionTrackerRef.current.isCurrent(requestVersion)
        ) {
          setLoading(false);
        }
      }
    }

    load();

    const timer = appliedSelection.refreshable
      ? setInterval(() => {
          if (!cancelled) load();
        }, REFRESH_INTERVAL)
      : null;

    return () => {
      cancelled = true;
      for (const controller of controllers) {
        controller.abort();
      }
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [apiUrl, appliedSelection.refreshable]);

  const applyController = React.useCallback(
    (nextController: typeof selectionController) => {
      setSelectionController(nextController);
      setSearchParams(
        serializeAppliedDashboardSelection(nextController.appliedSelection),
      );
    },
    [setSearchParams],
  );

  const handleViewToggle = React.useCallback(
    (v: DashboardViewContract) => {
      applyController(
        applyDashboardDraftSelection(
          setDashboardDraftView(selectionController, v),
        ),
      );
    },
    [applyController, selectionController],
  );

  if (loading && !data) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-6">
        <p
          className="text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading dashboard...
        </p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-6">
        <p
          className="text-sm text-[var(--color-error-text)]"
          data-testid="route-error"
        >
          Dashboard API unavailable: {error}
        </p>
      </section>
    );
  }

  if (!data) return null;

  const activityBounds = buildLastYearBounds();

  return (
    <section
      className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6"
      data-testid="dashboard"
    >
      {/* 1. Summary Metrics */}
      <SummaryMetrics data={data} />

      {/* 2. Range Selector */}
      <div>
        <TimeRangeSelector
          controller={selectionController}
          onApply={(nextController) => {
            applyController(nextController);
          }}
          onCancel={(nextController) => {
            applyController(nextController);
          }}
        />
      </div>

      {/* 3. Recent Sessions */}
      <RecentSessions sessions={data.recentSessions} />

      {/* 4. Activity Heatmap */}
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
          Activity (last 1 year)
        </h2>
        <ActivityHeatmap
          days={data.heatmapDays}
          startDay={activityBounds.startDayInclusive}
          endDay={activityBounds.endDayInclusive}
        />
      </section>

      {/* 5. Error Daily Trend */}
      <ErrorTrendSection
        series={data.errorTrendSeries}
        hourlyBars={data.errorTrendHourlyBars}
        view={view}
        onToggleView={handleViewToggle}
      />

      {/* 6. Token I/O Trend */}
      <TokenTrendSection
        tokenTrend={data.tokenTrend}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 7. Subagent Activity */}
      <SubagentTrendSection
        subagentTrend={data.subagentTrend}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 8. Active Repositories */}
      <ActiveReposSection repos={data.activeRepos} />

      {/* 9. Model Performance (full width) */}
      <ModelPerformanceSection rows={data.modelPerformanceStats ?? []} />

      {/* 10. Model Token Consumption (full width) */}
      <ModelTokenConsumptionSection rows={data.modelTokenConsumption} />

      {/* 11-14. Model views, usage, tools, MCP (2-column grid) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BarChartCard
          title="Model Usage"
          items={data.modelUsage}
          barColor="#0066cc"
        />
        <BarChartCard
          title="Top Tools"
          items={data.toolUsage}
          barColor="#0066cc"
        />
        <BarChartCard
          title="Agent Distribution"
          items={data.agentDistribution}
          barColor="#0066cc"
        />
        <McpUsageSection rows={data.mcpUsage} />
      </div>

      {/* 13. Tool Reliability Matrix */}
      <ToolReliabilitySection rows={data.toolReliabilityMatrix} />

      {/* 14. Error Patterns */}
      <ErrorPatternsSection patterns={data.errorPatterns} />
    </section>
  );
}
