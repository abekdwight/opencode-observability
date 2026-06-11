import { expect, test } from "@playwright/test";

/**
 * Verify the main list pages render correctly with mocked API data
 * (Sessions, Search, ToolErrors).
 */

test("Sessions page renders unified list with filters", async ({ page }) => {
  const body = {
    kind: "harness.sessions",
    generatedAt: "2026-03-22T00:00:00.000Z",
    harnesses: [
      {
        descriptor: {
          id: "opencode",
          label: "OpenCode",
          capabilities: { delete: true, livePrompt: true, resume: true },
        },
        source: { available: true, reason: "ok" },
        sessionCount: 1,
      },
      {
        descriptor: {
          id: "codex",
          label: "Codex",
          capabilities: { delete: false, livePrompt: false, resume: true },
        },
        source: { available: true, reason: "ok" },
        sessionCount: 1,
      },
      {
        descriptor: {
          id: "claude",
          label: "Claude Code",
          capabilities: { delete: false, livePrompt: false, resume: true },
        },
        source: { available: false, reason: "missing-directory" },
        sessionCount: 0,
      },
    ],
    query: { harness: null, directory: null, q: "", sort: "updated" },
    directories: [
      { directory: "/workspace/repo-alpha", count: 1 },
      { directory: "/workspace/repo-beta", count: 1 },
    ],
    sessions: [
      {
        harness: "opencode",
        id: "ses_001",
        title: "Implement auth module",
        directory: "/workspace/repo-alpha",
        gitBranch: null,
        createdAt: "2026-03-22T08:00:00.000Z",
        updatedAt: "2026-03-22T08:30:00.000Z",
        model: null,
        messageCount: 42,
        totalTokens: 150000,
        subagentCount: 2,
        detailAvailable: true,
      },
      {
        harness: "codex",
        id: "thread-1",
        title: "Fix CI pipeline",
        directory: "/workspace/repo-beta",
        gitBranch: "main",
        createdAt: "2026-03-21T14:00:00.000Z",
        updatedAt: "2026-03-21T14:15:00.000Z",
        model: "gpt-5.5",
        messageCount: null,
        totalTokens: 45000,
        subagentCount: null,
        detailAvailable: true,
      },
    ],
  };
  await page.route("**/api/sessions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/sessions?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto("/sessions");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("sessions-page")).toBeVisible();

  // Harness chips with counts
  await expect(page.getByRole("button", { name: "OpenCode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Codex" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claude Code" })).toBeVisible();

  // Unavailable source is surfaced, not hidden
  await expect(
    page.getByText("Claude Code: ディレクトリが見つかりません"),
  ).toBeVisible();

  // Session rows show per-harness metadata
  const rows = page.getByTestId("session-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Implement auth module");
  await expect(rows.nth(0)).toContainText("42 msgs");
  await expect(rows.nth(0).getByTitle("OpenCode")).toBeVisible();
  await expect(rows.nth(1)).toContainText("Fix CI pipeline");
  await expect(rows.nth(1).getByTitle("Codex")).toBeVisible();
  // Codex rows have no message count — the chip is absent, not "0".
  await expect(rows.nth(1)).not.toContainText("msgs");

  // Controls
  await expect(page.getByTestId("sessions-filter-input")).toBeVisible();
  await expect(page.getByTestId("sessions-sort-select")).toBeVisible();

  // Directory combobox: open, search-filter, select → reflected in the URL
  const combobox = page.getByTestId("sessions-directory-combobox");
  await expect(combobox).toBeVisible();
  await combobox.click();
  await page.getByPlaceholder("ディレクトリを検索").fill("beta");
  await expect(page.getByRole("option", { name: /repo-beta/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /repo-alpha/ })).toHaveCount(0);
  await page.getByRole("option", { name: /repo-beta/ }).click();
  await expect(page).toHaveURL(/dir=%2Fworkspace%2Frepo-beta/);
  await expect(combobox).toContainText("/workspace/repo-beta");
});

test("Search page renders form and search results with highlights", async ({
  page,
}) => {
  await page.route("**/api/search**", async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q") || "";

    if (q === "auth") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "search.results",
          generatedAt: "2026-03-22T00:00:00.000Z",
          query: "auth",
          searchTerms: ["auth"],
          results: [
            {
              id: "ses_001",
              title: "Implement auth module",
              directory: "/workspace/repo-alpha",
              createdAt: "2026-03-22T08:00:00.000Z",
              snippet: "Added JWT authentication with refresh token support",
              messageCount: 42,
              totalTokens: 150000,
            },
            {
              id: "ses_003",
              title: "OAuth2 auth integration",
              directory: "/workspace/repo-beta",
              createdAt: "2026-03-20T10:00:00.000Z",
              snippet: "Set up OAuth2 auth flow with Google provider",
              messageCount: 28,
              totalTokens: 80000,
            },
          ],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "search.results",
          generatedAt: "2026-03-22T00:00:00.000Z",
          query: q,
          searchTerms: [],
          results: [],
        }),
      });
    }
  });

  // First visit: empty search form
  await page.goto("/search");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Search Sessions" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Search titles and chat history"),
  ).toBeVisible();

  // Perform a search
  await page.goto("/search?q=auth");
  const results = page.getByTestId("search-result");
  await expect(results).toHaveCount(2);

  // Verify result titles
  await expect(page.getByText("Implement auth module")).toBeVisible();
  await expect(page.getByText("OAuth2 auth integration")).toBeVisible();

  // Verify snippets visible
  await expect(page.getByText(/JWT authentication/)).toBeVisible();

  // Verify result count
  await expect(page.getByText(/2 results? for/)).toBeVisible();
});

test("ToolErrors page renders timeline chart and errors table", async ({
  page,
}) => {
  await page.route("**/api/tool-errors/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "tool-errors.detail",
        generatedAt: "2026-03-22T00:00:00.000Z",
        tool: "Bash",
        dailyErrorCounts: [
          { day: "2026-03-18", count: 3 },
          { day: "2026-03-19", count: 1 },
          { day: "2026-03-20", count: 5 },
          { day: "2026-03-21", count: 2 },
          { day: "2026-03-22", count: 4 },
        ],
        latestErrors: [
          {
            timeCreated: 1742630400000,
            sessionId: "ses_001",
            error: "Command failed with exit code 1",
          },
          {
            timeCreated: 1742544000000,
            sessionId: "ses_002",
            error: "Permission denied: /etc/shadow",
          },
          {
            timeCreated: 1742457600000,
            sessionId: "ses_003",
            error: "Timeout after 30s",
          },
        ],
      }),
    });
  });

  await page.goto("/tool-errors/Bash");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  // Title
  await expect(page.getByText("Tool Errors: Bash")).toBeVisible();

  // Chart subtitle
  await expect(
    page.getByText("Error timeline for the past 30 days"),
  ).toBeVisible();

  // Table header
  await expect(page.getByText("Latest 200 Errors")).toBeVisible();

  // Table rows
  await expect(page.getByText("Command failed with exit code 1")).toBeVisible();
  await expect(page.getByText("Permission denied: /etc/shadow")).toBeVisible();
  await expect(page.getByText("Timeout after 30s")).toBeVisible();

  // Session links in table
  await expect(page.getByRole("link", { name: "ses_001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ses_002" })).toBeVisible();
});
