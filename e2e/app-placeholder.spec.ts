import { expect, test } from "@playwright/test";

test("monitor shell survives a failed snapshot request", async ({ page }) => {
  await page.route("**/api/monitor/snapshot", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "snapshot unavailable" }),
    });
  });
  await page.route("**/api/monitor/events", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/monitor");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("route-error")).toContainText(
    "Monitor API unavailable",
  );
});
