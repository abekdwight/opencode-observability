import { expect, type Route, test } from "@playwright/test";

const DASHBOARD_FIXTURE = {
  kind: "dashboard.snapshot",
  generatedAt: "2024-01-11T11:00:00.000Z",
  selection: {
    preset: "last7d",
    start: "2024-01-05",
    end: "2024-01-11",
    view: "daily",
    timezone: "Asia/Tokyo",
    refreshable: true,
    bounds: {
      startDayInclusive: "2024-01-05",
      endDayInclusive: "2024-01-11",
      endDayExclusive: "2024-01-12",
      dayCount: 7,
    },
  },
  summary: {
    totalSessions: 42,
    totalTokens: 125000,
    totalToolCalls: 156,
    toolErrors: 3,
    toolErrorRate: "1.9%",
    activeProjects: 5,
  },
  recentSessions: [],
  heatmapDays: [],
  errorTrendSeries: [],
  errorTrendHourlyBars: [],
  tokenTrend: {
    inputRatioPercent: 45.5,
    dailySeries: [],
    hourlyBars: [],
  },
  subagentTrend: {
    dailySeries: [],
    hourlyBars: [],
  },
  activeRepos: {
    dayHeaders: [],
    rows: [],
  },
  modelUsage: [],
  modelPerformance: [],
  modelPerformanceStats: [
    {
      model: "gpt-4.1-very-long-model-name-for-table-layout",
      provider: "openai",
      avgTps: 12.5,
      tpsP10: 9,
      tpsP50: null,
      tpsP90: 15,
      tpsP99: 18,
      latencyP50Ms: 1200,
      latencyP90Ms: 1800,
      latencyP99Ms: 2500,
      totalMessages: 2149,
      validTpsMessages: 2054,
      validLatencyMessages: 2020,
      validityRatio: 0.956,
      outputTokens: 80,
      reasoningTokens: 20,
      reasoningShare: 0.25,
    },
  ],
  modelTokenConsumption: [],
  toolUsage: [],
  agentDistribution: [],
  mcpUsage: [],
  toolReliabilityMatrix: [],
  errorPatterns: [],
};

async function fulfillDashboardRoute(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(DASHBOARD_FIXTURE),
  });
}

test.describe("Dashboard model performance table", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });

    await page.route("**/api/dashboard**", async (route) => {
      await fulfillDashboardRoute(route);
    });

    await page.goto("/dashboard");
  });

  test("shows the requested columns and keeps scrolling inside the table", async ({
    page,
  }) => {
    const tableHead = page.locator(".model-performance-table thead");
    await expect(
      page.locator(
        ".model-performance-table thead .model-performance-th-label",
      ),
    ).toHaveText([
      "Model",
      "TPS",
      "Deviation",
      "Latency",
      "Weighted TPS",
      "Validity",
      "Thinking",
    ]);

    await expect(tableHead).not.toContainText("Rank");
    await expect(tableHead).not.toContainText("Provider");
    await expect(tableHead).not.toContainText("Typical TPS");
    await expect(tableHead).not.toContainText("Speed band");
    await expect(tableHead).not.toContainText("Thinking/Output");

    await expect(
      page.locator(
        ".model-performance-table thead .model-performance-info-btn",
      ),
    ).toHaveCount(7);

    await expect(page.locator(".model-performance-help-row")).toHaveCount(0);
    await expect(page.locator(".model-performance-note")).toHaveCount(0);

    const firstRow = page.locator(".model-performance-table tbody tr").first();
    await expect(firstRow.locator("td")).toHaveCount(7);
    await expect(firstRow).toContainText(
      "gpt-4.1-very-long-model-name-for-table-layout · openai",
    );
    await expect(
      firstRow.locator(".model-performance-primary-value"),
    ).toHaveText("12.50");
    await expect(firstRow).toContainText("σ≈2.34");
    await expect(firstRow).toContainText("1.2s / 1.8s / 2.5s");
    await expect(firstRow).toContainText("95.6%");
    await expect(firstRow).toContainText("25.0%");
    await expect(firstRow.locator(".model-performance-fallback")).toHaveText(
      "*",
    );
    await expect(
      firstRow.locator(".model-performance-fallback"),
    ).toHaveAttribute("title", "P50 unavailable — showing weighted average");
    await expect(page.locator(".model-performance-table")).not.toContainText(
      "Sort: TPS ↓",
    );
    await expect(page.locator(".model-performance-table")).not.toContainText(
      "Deviation: σ≈(P90−P10)/2.56",
    );
    await expect(page.locator(".model-performance-table")).not.toContainText(
      "Chart: Top 10 models",
    );
    await expect(page.locator(".model-performance-table")).not.toContainText(
      "Outlier compressed:",
    );

    const scrollWrap = page.locator(".model-performance-table-scroll");
    await expect(scrollWrap).toBeVisible();

    const sizes = await scrollWrap.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);

    const pageSizes = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(pageSizes.scrollWidth).toBe(pageSizes.clientWidth);
  });

  test("shows the local help tooltip on hover, focus, and click", async ({
    page,
  }) => {
    const helpButton = page.getByRole("button", {
      name: "TPS help",
      exact: true,
    });
    const helpTooltip = helpButton.locator(".model-performance-tooltip");

    await helpButton.hover();
    await expect(helpTooltip).toBeVisible();
    await expect(helpTooltip).toContainText("P50 when available");

    await page.mouse.move(0, 0);
    await helpButton.focus();
    await expect(helpTooltip).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(helpTooltip).not.toBeVisible();

    await helpButton.click();
    await expect(helpTooltip).toBeVisible();
    await expect(helpTooltip).toContainText("weighted-average fallback");
  });
});
