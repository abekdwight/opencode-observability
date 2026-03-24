import { expect, test } from "@playwright/test";

/**
 * Task 8 evidence: Verify all 4 ported React pages render correctly
 * with mocked API data (Directories, DirectorySessions, Search, ToolErrors).
 */

test("Directories page renders repo groups and directory links", async ({
  page,
}) => {
  await page.route("**/api/directories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "directories.list",
        generatedAt: "2026-03-22T00:00:00.000Z",
        repoGroups: [
          {
            name: "repo-alpha",
            rawWorktree: "/workspace/repo-alpha",
            prettyWorktree: "~/workspace/repo-alpha",
            iconColor: "#4caf50",
            totalCount: 12,
            latestTime: "2026-03-22T10:00:00.000Z",
            directories: [
              {
                rawDirectory: "/workspace/repo-alpha",
                prettyDirectory: "~/workspace/repo-alpha",
                sessionCount: 8,
              },
              {
                rawDirectory: "/workspace/repo-alpha/packages/core",
                prettyDirectory: "~/workspace/repo-alpha/packages/core",
                sessionCount: 4,
              },
            ],
          },
          {
            name: "repo-beta",
            rawWorktree: "/workspace/repo-beta",
            prettyWorktree: "~/workspace/repo-beta",
            iconColor: "#2196f3",
            totalCount: 5,
            latestTime: "2026-03-21T15:00:00.000Z",
            directories: [
              {
                rawDirectory: "/workspace/repo-beta",
                prettyDirectory: "~/workspace/repo-beta",
                sessionCount: 5,
              },
            ],
          },
        ],
      }),
    });
  });

  await page.goto("/directories");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  // Wait for repo sections to render
  const repoSections = page.getByTestId("repo-section");
  await expect(repoSections).toHaveCount(2);

  // Verify repo names appear
  await expect(repoSections.nth(0)).toContainText("repo-alpha");
  await expect(repoSections.nth(1)).toContainText("repo-beta");

  // Verify directory links are present
  await expect(page.getByText("8 sessions")).toBeVisible();
  await expect(page.getByText("4 sessions")).toBeVisible();
  await expect(page.getByText("5 sessions")).toBeVisible();
});

test("DirectorySessions page renders session list with controls", async ({
  page,
}) => {
  await page.route("**/api/dir/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "directory.sessions",
        generatedAt: "2026-03-22T00:00:00.000Z",
        directory: "~/workspace/repo-alpha",
        sort: {
          selected: "date",
          options: ["date", "tokens", "messages"],
        },
        filter: { query: "" },
        sessions: [
          {
            id: "ses_001",
            title: "Implement auth module",
            createdAt: "2026-03-22T08:00:00.000Z",
            updatedAt: "2026-03-22T08:30:00.000Z",
            messageCount: 42,
            totalTokens: 150000,
            subagentCount: 2,
            durationMs: 1800000,
            summary: { additions: 120, deletions: 30, files: 8 },
          },
          {
            id: "ses_002",
            title: "Fix CI pipeline",
            createdAt: "2026-03-21T14:00:00.000Z",
            updatedAt: "2026-03-21T14:15:00.000Z",
            messageCount: 15,
            totalTokens: 45000,
            subagentCount: 0,
            durationMs: 900000,
            summary: { additions: 5, deletions: 2, files: 1 },
          },
        ],
      }),
    });
  });

  await page.goto("/dir/%2Fworkspace%2Frepo-alpha");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  // Breadcrumb
  await expect(
    page.locator(".breadcrumb").getByText("Directories"),
  ).toBeVisible();

  // Sort buttons
  await expect(page.getByRole("button", { name: "日付" })).toBeVisible();
  await expect(page.getByRole("button", { name: "トークン" })).toBeVisible();
  await expect(page.getByRole("button", { name: "メッセージ" })).toBeVisible();

  // Filter input
  await expect(page.getByPlaceholder("Filter by title...")).toBeVisible();

  // Session cards
  await expect(page.getByText("Implement auth module")).toBeVisible();
  await expect(page.getByText("Fix CI pipeline")).toBeVisible();

  // Meta pills
  await expect(page.getByText("42 msgs")).toBeVisible();
  await expect(page.getByText("15 msgs")).toBeVisible();
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
