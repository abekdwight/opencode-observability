import { expect, test } from "@playwright/test";

const MONITOR_SNAPSHOT = {
  kind: "monitor.snapshot",
  generatedAt: "2024-01-11T11:00:00.000Z",
  activeRootSessions: [
    {
      id: "ses-root-1",
      title: "Root monitor session",
      directory: "/workspace/repo-alpha",
      updatedAt: "2024-01-10T09:01:00.000Z",
      messageCount: 3,
      toolCallCount: 2,
      compactionCount: 1,
      subagentCount: 1,
      signalLevel: "error",
    },
  ],
  compactionCounts: {
    main: 1,
    subagent: 1,
    total: 2,
  },
  signalBadges: [
    {
      key: "alerting",
      label: "Alerting sessions",
      level: "error",
      count: 1,
    },
    {
      key: "compacting",
      label: "Compacting sessions",
      level: "warning",
      count: 1,
    },
  ],
};

const SESSION_DETAIL = {
  kind: "session.detail",
  generatedAt: "2024-01-11T11:00:00.000Z",
  session: {
    id: "ses-root-1",
    title: "Root monitor session",
    directory: "/workspace/repo-alpha",
    parentId: null,
    createdAt: "2024-01-10T09:00:00.000Z",
    updatedAt: "2024-01-10T09:01:00.000Z",
    summary: { additions: 10, deletions: 4, files: 2 },
  },
  tokens: {
    total: 180,
    input: 100,
    output: 80,
    reasoning: 20,
    cacheRead: 40,
    cacheWrite: 5,
    cost: 0.17,
  },
  compactions: { main: 0, subagent: 1, total: 1 },
  modelBreakdown: [
    {
      modelId: "gpt-4.1",
      providerId: "openai",
      messageCount: 2,
      inputTokens: 100,
      outputTokens: 80,
      reasoningTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      totalTokens: 180,
      totalCost: 0.17,
    },
  ],
  subagents: [
    {
      id: "ses-child-1",
      title: "Subagent follow-up",
      updatedAt: "2024-01-10T09:01:50.000Z",
      durationMs: 20_000,
      compactionCount: 1,
      signalLevel: "warning",
    },
  ],
  signalBadges: [
    { key: "tool-errors", label: "Tool errors", level: "error", count: 1 },
    { key: "subagents", label: "Subagents", level: "info", count: 1 },
    { key: "compactions", label: "Compactions", level: "warning", count: 1 },
  ],
};

function stubApis(page: import("@playwright/test").Page) {
  return Promise.all([
    page.route("**/api/monitor/snapshot", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MONITOR_SNAPSHOT),
      });
    }),
    page.route("**/api/monitor/events", async (route) => {
      await route.abort("failed");
    }),
    page.route("**/api/session/ses-root-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SESSION_DETAIL),
      });
    }),
  ]);
}

test.describe("monitor secondary details disclosure", () => {
  test("secondary details are collapsed by default and can be expanded", async ({
    page,
  }) => {
    await stubApis(page);
    await page.goto("/monitor");

    // Primary content is visible
    await expect(
      page.getByRole("heading", { name: "Recent Sessions" }),
    ).toBeVisible();

    // Secondary disclosure exists but content is hidden
    const disclosure = page.getByTestId("monitor-secondary-details");
    await expect(disclosure).toBeVisible();
    const content = page.getByTestId("monitor-secondary-details-content");
    await expect(content).not.toBeVisible();

    // Expand it
    const toggle = page.getByTestId("monitor-secondary-details-toggle");
    await toggle.click();
    await expect(content).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Monitor Signals" }),
    ).toBeVisible();

    // Collapse it again
    await toggle.click();
    await expect(content).not.toBeVisible();
  });

  test("secondary details do not dominate on narrow viewport", async ({
    page,
  }) => {
    await stubApis(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/monitor");

    // Primary content remains visible at narrow width
    await expect(
      page.getByRole("heading", { name: "Recent Sessions" }),
    ).toBeVisible();

    // Secondary content stays collapsed
    const content = page.getByTestId("monitor-secondary-details-content");
    await expect(content).not.toBeVisible();

    // Toggle still works
    const toggle = page.getByTestId("monitor-secondary-details-toggle");
    await toggle.click();
    await expect(content).toBeVisible();
  });
});

test.describe("session model breakdown disclosure", () => {
  test("model breakdown is collapsed by default and can be expanded", async ({
    page,
  }) => {
    await stubApis(page);
    await page.goto("/session/ses-root-1");

    // Session header is visible
    await expect(
      page.getByRole("heading", { name: "Root monitor session" }),
    ).toBeVisible();

    // Model breakdown disclosure exists but content is hidden
    const disclosure = page.getByTestId("session-model-breakdown");
    await expect(disclosure).toBeVisible();
    const content = page.getByTestId("session-model-breakdown-content");
    await expect(content).not.toBeVisible();

    // Expand it
    const toggle = page.getByTestId("session-model-breakdown-toggle");
    await toggle.click();
    await expect(content).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Model Token Breakdown" }),
    ).toBeVisible();
    // Verify model data is rendered
    await expect(page.getByText("gpt-4.1")).toBeVisible();

    // Collapse it again
    await toggle.click();
    await expect(content).not.toBeVisible();
  });
});
