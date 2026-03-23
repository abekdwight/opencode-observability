import { expect, type Route, test } from "@playwright/test";

const DASHBOARD_FIXTURE = {
  kind: "dashboard",
  generatedAt: "2024-01-11T11:00:00.000Z",
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
    dailySeries: [],
    hourlyBars: [],
    inputRatioPercent: 45.5,
  },
  subagentTrend: {
    dailySeries: [],
    hourlyBars: [],
  },
  activeRepos: {
    dayHeaders: [],
    rows: [],
  },
  modelPerformance: [],
  modelTokenConsumption: [],
  modelUsage: [],
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

test.describe("Dashboard range selector", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the dashboard API
    await page.route("**/api/dashboard**", async (route) => {
      await fulfillDashboardRoute(route);
    });

    await page.goto("/dashboard");
  });

  test("has preset dropdown with required options", async ({ page }) => {
    const presetSelect = page.getByTestId("dashboard-time-preset");
    await expect(presetSelect).toBeVisible();

    // Check options exist (no "All" option)
    const options = await presetSelect.locator("option").allTextContents();
    expect(options).toContain("1 Month");
    expect(options).toContain("1 Week");
    expect(options).toContain("1 Day");
    expect(options).toContain("Custom Range");
    expect(options).not.toContain("All");
  });

  test("preset dropdown has correct data-testid", async ({ page }) => {
    await expect(page.getByTestId("dashboard-time-preset")).toBeVisible();
  });

  test("view toggle buttons have correct data-testids", async ({ page }) => {
    // Two view toggles now exist (Token I/O and Subagent sections) - check first one
    await expect(
      page.getByTestId("dashboard-view-toggle-daily").first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("dashboard-view-toggle-hourly").first(),
    ).toBeVisible();
  });

  test("timezone label is visible with correct data-testid", async ({
    page,
  }) => {
    const timezoneLabel = page.getByTestId("dashboard-timezone-label");
    await expect(timezoneLabel).toBeVisible();
    // Should show something (actual timezone depends on test environment)
    await expect(timezoneLabel).not.toBeEmpty();
  });

  test("selecting custom range shows date inputs and buttons", async ({
    page,
  }) => {
    // Select custom range
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");

    // Custom range trigger should appear
    const trigger = page.getByTestId("dashboard-custom-range-trigger");
    await expect(trigger).toBeVisible();

    // Click to open popover
    await trigger.click();

    // Check popover elements
    await expect(page.getByTestId("dashboard-range-start")).toBeVisible();
    await expect(page.getByTestId("dashboard-range-end")).toBeVisible();
    await expect(page.getByTestId("dashboard-range-apply")).toBeVisible();
    await expect(page.getByTestId("dashboard-range-cancel")).toBeVisible();
  });

  test("custom range dates can be set and applied", async ({ page }) => {
    // Select custom range
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");

    // Open popover
    await page.getByTestId("dashboard-custom-range-trigger").click();

    // Set dates
    await page.getByTestId("dashboard-range-start").fill("2024-01-01");
    await page.getByTestId("dashboard-range-end").fill("2024-01-10");

    // Apply
    await page.getByTestId("dashboard-range-apply").click();

    // Popover should close
    await expect(page.getByTestId("dashboard-range-start")).not.toBeVisible();

    // Trigger should show selected dates
    const trigger = page.getByTestId("dashboard-custom-range-trigger");
    await expect(trigger).toContainText("2024-01-01");
    await expect(trigger).toContainText("2024-01-10");
  });

  test("custom range cancel closes popover without applying", async ({
    page,
  }) => {
    // Select custom range
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");

    // Open popover
    await page.getByTestId("dashboard-custom-range-trigger").click();

    // Set dates
    await page.getByTestId("dashboard-range-start").fill("2024-01-01");
    await page.getByTestId("dashboard-range-end").fill("2024-01-10");

    // Cancel
    await page.getByTestId("dashboard-range-cancel").click();

    // Popover should close
    await expect(page.getByTestId("dashboard-range-start")).not.toBeVisible();
  });

  test("invalid custom range shows error", async ({ page }) => {
    // Select custom range
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");

    // Open popover
    await page.getByTestId("dashboard-custom-range-trigger").click();

    // Set invalid dates (start after end)
    await page.getByTestId("dashboard-range-start").fill("2024-01-10");
    await page.getByTestId("dashboard-range-end").fill("2024-01-01");

    // Apply
    await page.getByTestId("dashboard-range-apply").click();

    // Error should be visible
    const error = page.getByTestId("dashboard-range-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("start date must be on or before");
  });

  test("preset selection auto-applies and shows helper text", async ({
    page,
  }) => {
    // Select 1 Week
    await page.getByTestId("dashboard-time-preset").selectOption("1 Week");

    // Helper text should be visible
    const helper = page.getByTestId("dashboard-preset-helper");
    await expect(helper).toBeVisible();
    await expect(helper).toContainText("Last 7 days");

    // Select 1 Day
    await page.getByTestId("dashboard-time-preset").selectOption("1 Day");
    await expect(helper).toContainText("Today");

    // Select 1 Month
    await page.getByTestId("dashboard-time-preset").selectOption("1 Month");
    await expect(helper).toContainText("Last 30 days");
  });

  test("historical custom range does not auto-refresh", async ({ page }) => {
    test.setTimeout(40_000);
    let historicalCustomRangeRequests = 0;

    await page.unroute("**/api/dashboard**");
    await page.route("**/api/dashboard**", async (route, request) => {
      const url = new URL(request.url());
      if (
        url.searchParams.get("preset") === "custom" &&
        url.searchParams.get("start") === "2024-01-01" &&
        url.searchParams.get("end") === "2024-01-10"
      ) {
        historicalCustomRangeRequests += 1;
      }
      await fulfillDashboardRoute(route);
    });

    await page.goto("/dashboard");
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");
    await page.getByTestId("dashboard-custom-range-trigger").click();
    await page.getByTestId("dashboard-range-start").fill("2024-01-01");
    await page.getByTestId("dashboard-range-end").fill("2024-01-10");
    await page.getByTestId("dashboard-range-apply").click();

    await expect(
      page.getByTestId("dashboard-custom-range-trigger"),
    ).toContainText("2024-01-01");

    await page.waitForTimeout(2_000);
    const requestCountAfterApply = historicalCustomRangeRequests;

    await page.waitForTimeout(31_000);

    expect(historicalCustomRangeRequests).toBe(requestCountAfterApply);
  });

  test("unsupported URL params fall back to bounded default", async ({
    page,
  }) => {
    let dashboardRequestUrl = "";

    await page.unroute("**/api/dashboard**");
    await page.route("**/api/dashboard**", async (route, request) => {
      dashboardRequestUrl = request.url();
      await fulfillDashboardRoute(route);
    });

    await page.goto("/dashboard?range=all&foo=bar");

    await expect(page.getByTestId("dashboard-time-preset")).toHaveValue(
      "last7d",
    );
    await expect(page.getByTestId("dashboard-preset-helper")).toContainText(
      "Last 7 days",
    );

    const requestedUrl = new URL(dashboardRequestUrl);
    expect(requestedUrl.searchParams.get("preset")).toBe("last7d");
    expect(requestedUrl.searchParams.get("view")).toBe("daily");
    expect(requestedUrl.searchParams.has("range")).toBe(false);
    expect(requestedUrl.searchParams.has("foo")).toBe(false);
    expect(requestedUrl.searchParams.get("start")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(requestedUrl.searchParams.get("end")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("browser back and forward restore selection state", async ({ page }) => {
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");
    await page.getByTestId("dashboard-custom-range-trigger").click();
    await page.getByTestId("dashboard-range-start").fill("2024-01-01");
    await page.getByTestId("dashboard-range-end").fill("2024-01-10");
    await page.getByTestId("dashboard-range-apply").click();

    await expect(page).toHaveURL(/preset=custom/);
    await page.getByTestId("dashboard-time-preset").selectOption("1 Day");
    await expect(page).toHaveURL(/preset=today/);

    await page.goBack();

    await expect(page).toHaveURL(/preset=custom/);
    await expect(page.getByTestId("dashboard-time-preset")).toHaveValue(
      "custom",
    );
    await expect(
      page.getByTestId("dashboard-custom-range-trigger"),
    ).toContainText("2024-01-01");
    await expect(
      page.getByTestId("dashboard-custom-range-trigger"),
    ).toContainText("2024-01-10");

    await page.goForward();

    await expect(page).toHaveURL(/preset=today/);
    await expect(page.getByTestId("dashboard-time-preset")).toHaveValue(
      "today",
    );
    await expect(page.getByTestId("dashboard-preset-helper")).toContainText(
      "Today",
    );
  });

  test("view toggle switches between daily and hourly", async ({ page }) => {
    // Use first() since there are now two toggles (Token I/O and Subagent sections)
    // Both control the same global state, so testing one is sufficient
    const dailyBtn = page.getByTestId("dashboard-view-toggle-daily").first();
    const hourlyBtn = page.getByTestId("dashboard-view-toggle-hourly").first();

    // Daily should be active by default
    await expect(dailyBtn).toHaveAttribute("aria-pressed", "true");
    await expect(hourlyBtn).toHaveAttribute("aria-pressed", "false");

    // Click hourly
    await hourlyBtn.click();

    // Hourly should be active
    await expect(dailyBtn).toHaveAttribute("aria-pressed", "false");
    await expect(hourlyBtn).toHaveAttribute("aria-pressed", "true");

    // Click daily
    await dailyBtn.click();

    // Daily should be active again
    await expect(dailyBtn).toHaveAttribute("aria-pressed", "true");
    await expect(hourlyBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("custom range popover closes on escape key", async ({ page }) => {
    // Select custom range
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");

    // Open popover
    await page.getByTestId("dashboard-custom-range-trigger").click();

    // Press escape
    await page.keyboard.press("Escape");

    // Popover should close
    await expect(page.getByTestId("dashboard-range-start")).not.toBeVisible();
  });

  test("custom range popover closes on click outside", async ({ page }) => {
    // Select custom range
    await page
      .getByTestId("dashboard-time-preset")
      .selectOption("Custom Range");

    // Open popover
    await page.getByTestId("dashboard-custom-range-trigger").click();

    // Click outside on the dashboard
    await page.getByTestId("dashboard").click({ position: { x: 10, y: 10 } });

    // Popover should close
    await expect(page.getByTestId("dashboard-range-start")).not.toBeVisible();
  });
});
