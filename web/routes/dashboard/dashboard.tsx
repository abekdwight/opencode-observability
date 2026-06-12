import React from "react";
import { useSearchParams } from "react-router-dom";
import type {
  DashboardActivityContract,
  DashboardBarItemContract,
  DashboardModelsContract,
  DashboardToolsContract,
  DashboardViewContract,
} from "../../../src/contracts/dashboard";
import { ActivityHeatmap } from "../../components/charts/activity-heatmap";
import { CssBarChart } from "../../components/charts/css-bar-chart";
import {
  applyDashboardDraftSelection,
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
import { buildLastYearBounds } from "./_lib/formatters";
import { useDashboardData } from "./_lib/use-dashboard-data";

/* ── Building placeholder ── */

function BuildingPlaceholder({ progressPercent }: { progressPercent: number }) {
  const pct = Math.max(0, Math.min(100, progressPercent));
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-secondary)]">
          集計を構築中 {pct.toFixed(0)}%
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          しばらくお待ちください
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ── Section-level error banner ── */

function SectionError({ title, message }: { title: string; message: string }) {
  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <h2 className="mb-1 text-base font-bold text-[var(--color-text-primary)]">
        {title}
      </h2>
      <p className="text-sm text-[var(--color-error-text)]">
        データ取得エラー: {message}
      </p>
    </section>
  );
}

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

/* ── Tool summary cards (from tools endpoint) ── */

function ToolSummaryCards({
  totalToolCalls,
  toolErrors,
  toolErrorRate,
}: {
  totalToolCalls: number;
  toolErrors: number;
  toolErrorRate: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3">
        <p className="text-xs text-[var(--color-text-secondary)]">Tool Calls</p>
        <p className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">
          {totalToolCalls.toLocaleString()}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          all sessions
        </p>
      </div>
      <div className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-3">
        <p className="text-xs text-[var(--color-text-secondary)]">
          Tool Error Rate
        </p>
        <p className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">
          {toolErrorRate}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {toolErrors.toLocaleString()} errors
        </p>
      </div>
    </div>
  );
}

/* ── Activity section group ── */

function ActivitySections({
  activityState,
  view,
  dayCount,
  onToggleView,
}: {
  activityState: ReturnType<typeof useDashboardData>["activity"];
  view: DashboardViewContract;
  dayCount: number;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  const { data, error, initialLoading } = activityState;

  if (initialLoading && !data) {
    return <BuildingPlaceholder progressPercent={0} />;
  }

  if (error && !data) {
    return <SectionError title="Activity" message={error} />;
  }

  if (!data) return null;

  if (data.state === "building") {
    return <BuildingPlaceholder progressPercent={data.progressPercent} />;
  }

  const activityData = (
    data as Extract<DashboardActivityContract, { state: "ready" }>
  ).data;

  return (
    <>
      {/* Error Daily Trend is sourced from tools, rendered in ToolsSections.
          Token and Subagent trends come from activity. */}
      <TokenTrendSection
        tokenTrend={activityData.tokenTrend}
        view={view}
        dayCount={dayCount}
        onToggleView={onToggleView}
      />
      <SubagentTrendSection
        subagentTrend={activityData.subagentTrend}
        view={view}
        dayCount={dayCount}
        onToggleView={onToggleView}
      />
      <ActiveReposSection repos={activityData.activeRepos} />
    </>
  );
}

/* ── Models section group ── */

function ModelsSections({
  modelsState,
}: {
  modelsState: ReturnType<typeof useDashboardData>["models"];
}) {
  const { data, error, initialLoading } = modelsState;

  if (initialLoading && !data) {
    return <BuildingPlaceholder progressPercent={0} />;
  }

  if (error && !data) {
    return <SectionError title="モデル" message={error} />;
  }

  if (!data) return null;

  if (data.state === "building") {
    return <BuildingPlaceholder progressPercent={data.progressPercent} />;
  }

  const modelsData = (
    data as Extract<DashboardModelsContract, { state: "ready" }>
  ).data;

  return (
    <>
      <ModelPerformanceSection rows={modelsData.modelPerformanceStats} />
      <ModelTokenConsumptionSection rows={modelsData.modelTokenConsumption} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BarChartCard
          title="Model Usage"
          items={modelsData.modelUsage}
          barColor="var(--color-accent)"
        />
      </div>
    </>
  );
}

/* ── Tools section group ── */

function ToolsSections({
  toolsState,
  view,
  onToggleView,
}: {
  toolsState: ReturnType<typeof useDashboardData>["tools"];
  view: DashboardViewContract;
  onToggleView: (v: DashboardViewContract) => void;
}) {
  const { data, error, initialLoading } = toolsState;

  if (initialLoading && !data) {
    return <BuildingPlaceholder progressPercent={0} />;
  }

  if (error && !data) {
    return <SectionError title="ツール" message={error} />;
  }

  if (!data) return null;

  if (data.state === "building") {
    return <BuildingPlaceholder progressPercent={data.progressPercent} />;
  }

  const toolsData = (
    data as Extract<DashboardToolsContract, { state: "ready" }>
  ).data;

  return (
    <>
      <ToolSummaryCards
        totalToolCalls={toolsData.totalToolCalls}
        toolErrors={toolsData.toolErrors}
        toolErrorRate={toolsData.toolErrorRate}
      />
      <ErrorTrendSection
        series={toolsData.errorTrendSeries}
        hourlyBars={toolsData.errorTrendHourlyBars}
        view={view}
        onToggleView={onToggleView}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BarChartCard
          title="Top Tools"
          items={toolsData.toolUsage}
          barColor="var(--color-accent)"
        />
        <McpUsageSection rows={toolsData.mcpUsage} />
      </div>
      <ToolReliabilitySection rows={toolsData.toolReliabilityMatrix} />
      <ErrorPatternsSection patterns={toolsData.errorPatterns} />
    </>
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

  const { appliedSelection, apiUrls } = selectionController;
  const view = appliedSelection.view;

  const { overview, activity, models, tools } = useDashboardData(
    apiUrls,
    appliedSelection.refreshable,
  );

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

  // Overview-level fetch error: show a full-page error (overview is instant;
  // if it fails there's nothing meaningful to show at all)
  if (overview.error && !overview.data) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-6">
        <p
          className="text-sm text-[var(--color-error-text)]"
          data-testid="route-error"
        >
          Dashboard API unavailable: {overview.error}
        </p>
      </section>
    );
  }

  // Overview initial load: show a minimal skeleton immediately in DOM
  // (no blank flash — the skeleton IS the first paint)
  if (overview.initialLoading && !overview.data) {
    return (
      <section
        className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6"
        data-testid="dashboard"
      >
        {/* Range selector stays interactive immediately */}
        <div>
          <TimeRangeSelector
            controller={selectionController}
            onApply={applyController}
            onCancel={applyController}
          />
        </div>
        <div
          role="status"
          className="h-24 animate-pulse rounded-xl bg-[var(--color-bg-elevated)]"
          data-testid="route-loading"
        />
        <BuildingPlaceholder progressPercent={0} />
        <BuildingPlaceholder progressPercent={0} />
        <BuildingPlaceholder progressPercent={0} />
      </section>
    );
  }

  if (!overview.data) return null;

  const activityBounds = buildLastYearBounds();
  const overviewData = overview.data;

  return (
    <section
      className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6"
      data-testid="dashboard"
    >
      {/* 1. Summary Metrics (overview — always instant) */}
      <SummaryMetrics summary={overviewData.summary} />

      {/* 2. Range Selector */}
      <div>
        <TimeRangeSelector
          controller={selectionController}
          onApply={applyController}
          onCancel={applyController}
        />
      </div>

      {/* 3. Recent Sessions (overview) */}
      <RecentSessions sessions={overviewData.recentSessions} />

      {/* 4. Activity Heatmap (overview — 365-day, session-table sourced) */}
      <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
        <h2 className="mb-3 text-base font-bold text-[var(--color-text-primary)]">
          Activity (last 1 year)
        </h2>
        <ActivityHeatmap
          days={overviewData.heatmapDays}
          startDay={activityBounds.startDayInclusive}
          endDay={activityBounds.endDayInclusive}
        />
      </section>

      {/* 5-6. Token and Subagent Trends (activity endpoint) */}
      <ActivitySections
        activityState={activity}
        view={view}
        dayCount={appliedSelection.bounds.dayCount}
        onToggleView={handleViewToggle}
      />

      {/* 7-9. Models (models endpoint) */}
      <ModelsSections modelsState={models} />

      {/* 10-14. Tools, reliability, MCP, error patterns (tools endpoint) */}
      <ToolsSections
        toolsState={tools}
        view={view}
        onToggleView={handleViewToggle}
      />
    </section>
  );
}
