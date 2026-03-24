import { expect, test } from "@playwright/test";

test("monitor route degrades safely when the observability stream fails", async ({
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
        ],
      }),
    });
  });

  await page.route("**/api/monitor/events", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/monitor");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("route-live-degraded")).toContainText(
    "Reconnecting to the observability stream",
  );
});
