import { expect, test } from "@playwright/test";

test("app shell persists across monitor and session routes", async ({
  page,
}) => {
  await page.route("**/api/monitor/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "monitor.snapshot",
        generatedAt: "2024-01-11T11:00:00.000Z",
        activeRootSessions: [
          {
            id: "ses-root-1",
            title: "Root monitor session",
            directory: "/workspace/repo-alpha",
            createdAt: "2024-01-10T09:00:00.000Z",
            updatedAt: "2024-01-10T09:01:00.000Z",
            messageCount: 3,
            toolCallCount: 2,
            compactionCount: 1,
            subagentCount: 1,
            totalTokens: 222,
            inputTokens: 114,
            outputTokens: 108,
            inputRatioPercent: 51.4,
            cacheReadTokens: 40,
            cacheWriteTokens: 5,
            tokenUsage: [
              {
                scope: "main",
                agent: "planner",
                modelId: "gpt-4.1",
                providerId: "openai",
                messageCount: 2,
                inputTokens: 100,
                outputTokens: 80,
                cacheReadTokens: 40,
                cacheWriteTokens: 5,
                totalTokens: 180,
                inputRatioPercent: 55.6,
              },
              {
                scope: "subagent",
                agent: "subagent-code",
                modelId: "gpt-4.1-mini",
                providerId: "openai",
                messageCount: 1,
                inputTokens: 10,
                outputTokens: 20,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 30,
                inputRatioPercent: 33.3,
              },
              {
                scope: "subagent",
                agent: "compaction",
                modelId: "gpt-5.3-codex-spark",
                providerId: "openai",
                messageCount: 1,
                inputTokens: 4,
                outputTokens: 8,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 12,
                inputRatioPercent: 33.3,
              },
            ],
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
          {
            key: "subagent",
            label: "Subagent sessions",
            count: 1,
          },
          { key: "todos", label: "Open todos", count: 1 },
        ],
      }),
    });
  });
  await page.route("**/api/monitor/events", async (route) => {
    await route.abort("failed");
  });
  await page.route("**/api/session/ses-root-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
          summary: {
            additions: 10,
            deletions: 4,
            files: 2,
          },
        },
        tokens: {
          total: 222,
          input: 114,
          output: 108,
          reasoning: 20,
          cacheRead: 40,
          cacheWrite: 5,
          cost: 0.21,
        },
        compactions: {
          main: 0,
          subagent: 1,
          total: 1,
        },
        modelBreakdown: [
          {
            scope: "main",
            agent: "planner",
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
          {
            scope: "subagent",
            agent: "subagent-code",
            modelId: "gpt-4.1-mini",
            providerId: "openai",
            messageCount: 1,
            inputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 30,
            totalCost: 0.03,
          },
          {
            scope: "subagent",
            agent: "compaction",
            modelId: "gpt-5.3-codex-spark",
            providerId: "openai",
            messageCount: 1,
            inputTokens: 4,
            outputTokens: 8,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 12,
            totalCost: 0.01,
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
          {
            key: "tool-errors",
            label: "Tool errors",
            level: "error",
            count: 1,
          },
          { key: "subagents", label: "Subagents", level: "info", count: 1 },
          {
            key: "compactions",
            label: "Compactions",
            level: "warning",
            count: 1,
          },
        ],
        messages: [],
        toolEvents: [],
        todos: [],
        summaryDiffs: null,
      }),
    });
  });

  await page.goto("/session/ses-root-1");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Root monitor session" }),
  ).toBeVisible();

  await page.goto("/monitor");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent Sessions" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Root monitor session" }).click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Root monitor session" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Home" }).first().click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent Sessions" }),
  ).toBeVisible();
});
