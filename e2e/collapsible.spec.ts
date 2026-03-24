import { expect, test } from "@playwright/test";
import type { SessionDetailContract } from "../src/contracts/session.js";

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
      count: 1,
    },
    {
      key: "compacting",
      label: "Compacting sessions",
      count: 1,
    },
  ],
};

const SESSION_DETAIL: SessionDetailContract = {
  kind: "session.detail",
  generatedAt: "2024-01-11T11:00:00.000Z",
  durationMs: 33_000,
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
  messages: [],
  todos: [],
  summaryDiffs: null,
};

function stubApis(
  page: import("@playwright/test").Page,
  sessionDetail: SessionDetailContract = SESSION_DETAIL,
) {
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
        body: JSON.stringify(sessionDetail),
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

test.describe("session detail overview", () => {
  test("session detail metrics render from contract data", async ({ page }) => {
    await stubApis(page);
    await page.goto("/session/ses-root-1");

    // Session header is visible
    await expect(
      page.getByRole("heading", { name: "Root monitor session" }),
    ).toBeVisible();

    await expect(page.getByText("所要時間")).toBeVisible();
    await expect(page.getByText("トークン")).toBeVisible();
    await expect(page.getByText("サブエージェント 1")).toBeVisible();
  });

  test("message collapse toggle stays visible and markdown tables render as tables", async ({
    page,
  }) => {
    const longMarkdown = Array.from(
      { length: 80 },
      (_, i) =>
        `Paragraph ${i + 1}: This is a long message for overflow testing.`,
    ).join("\n\n");
    const sessionWithMessages: SessionDetailContract = {
      ...SESSION_DETAIL,
      messages: [
        {
          role: "assistant",
          text: longMarkdown,
          modelId: "gpt-4.1",
          agent: "Sisyphus",
          outputTpsLabel: "12.0 tok/s",
          createdAt: "2024-01-10T09:00:20.000Z",
          toolCalls: [],
          subagentLinks: [],
        },
        {
          role: "assistant",
          text: "| Col A | Col B |\n| --- | --- |\n| one | two |",
          modelId: "gpt-4.1",
          agent: "Sisyphus",
          outputTpsLabel: "12.0 tok/s",
          createdAt: "2024-01-10T09:00:30.000Z",
          toolCalls: [],
          subagentLinks: [],
        },
      ],
      todos: [],
      summaryDiffs: null,
    };

    await stubApis(page, sessionWithMessages);
    await page.goto("/session/ses-root-1");

    const firstMessageToggle = page
      .getByTestId("message-0")
      .locator(".expand-btn");
    await expect(firstMessageToggle).toBeVisible();
    await expect(firstMessageToggle).toHaveText("続きを表示");

    await firstMessageToggle.click();
    await expect(firstMessageToggle).toBeVisible();
    await expect(firstMessageToggle).toHaveText("折りたたむ");

    await firstMessageToggle.click();
    await expect(firstMessageToggle).toBeVisible();
    await expect(firstMessageToggle).toHaveText("続きを表示");

    const table = page
      .getByTestId("message-1")
      .locator(".message-content table");
    await expect(table).toBeVisible();
    await expect(table.locator("thead th")).toHaveCount(2);
    await expect(table.locator("tbody td")).toHaveCount(2);
  });
});
