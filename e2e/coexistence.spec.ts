import { expect, test } from "@playwright/test";

test("deep links render app shell on every React route", async ({ page }) => {
  await page.route("**/api/dashboard**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "dashboard.snapshot",
        generatedAt: "2024-01-11T11:00:00.000Z",
        selection: {
          preset: "last30d",
          start: "2024-01-11",
          end: "2024-01-11",
          view: "daily",
          timezone: "Asia/Tokyo",
          refreshable: false,
          bounds: {
            startDayInclusive: "2024-01-11",
            endDayInclusive: "2024-01-11",
            endDayExclusive: "2024-01-12",
            dayCount: 1,
          },
        },
        summary: {
          totalSessions: 2,
          totalTokens: 327,
          totalToolCalls: 4,
          toolErrors: 2,
          toolErrorRate: "50.0%",
          activeProjects: 2,
        },
        recentSessions: [
          {
            id: "ses-root-1",
            title: "Root monitor session",
            directory: "/workspace/repo-alpha",
            timeUpdated: 1704877260000,
            totalTokens: 180,
          },
        ],
        heatmapDays: [{ day: "2024-01-11", count: 2 }],
        errorTrendSeries: [
          {
            label: "github_search",
            color: "#d32f2f",
            points: [{ day: "2024-01-11", value: 1 }],
          },
        ],
        errorTrendHourlyBars: [],
        tokenTrend: {
          inputRatioPercent: 55.6,
          dailySeries: [
            {
              label: "input",
              color: "#2563eb",
              points: [{ day: "2024-01-11", value: 100 }],
            },
            {
              label: "output",
              color: "#16a34a",
              points: [{ day: "2024-01-11", value: 80 }],
            },
          ],
          hourlyBars: [],
        },
        subagentTrend: {
          dailySeries: [
            {
              label: "subagent",
              color: "#7c3aed",
              points: [{ day: "2024-01-11", value: 1 }],
            },
          ],
          hourlyBars: [],
        },
        activeRepos: {
          dayHeaders: ["2024-01-11"],
          rows: [
            {
              repo: "/workspace/repo-alpha",
              dayCells: [{ day: "2024-01-11", label: "1", muted: false }],
              totalLabel: "1",
            },
          ],
        },
        modelPerformanceStats: [
          {
            model: "gpt-4.1",
            provider: "openai",
            avgTps: 12.5,
            tpsP10: null,
            tpsP50: null,
            tpsP90: null,
            tpsP99: null,
            latencyP50Ms: null,
            latencyP90Ms: null,
            latencyP99Ms: null,
            totalMessages: 2,
            validTpsMessages: 2,
            validLatencyMessages: 2,
            validityRatio: 1,
            outputTokens: 80,
            reasoningTokens: 20,
            reasoningShare: 0.25,
          },
        ],
        modelTokenConsumption: [
          {
            model: "gpt-4.1",
            provider: "openai",
            inputTokens: 100,
            outputTokens: 80,
            cacheReadTokens: 40,
            cacheWriteTokens: 5,
            nonCacheInputTokens: 100,
            inputTotalTokens: 145,
            totalTokens: 225,
          },
        ],
        modelUsage: [{ label: "gpt-4.1", count: 2 }],
        toolUsage: [{ label: "read", count: 3 }],
        agentDistribution: [{ label: "main", count: 2 }],
        mcpUsage: [
          {
            server: "Builtin Tools",
            calls: 3,
            errors: 1,
            errorRate: 33.3,
            isBuiltin: true,
          },
        ],
        toolReliabilityMatrix: [
          {
            tool: "github_search",
            success: 1,
            error: 1,
            total: 2,
            errorRate: 50,
          },
        ],
        errorPatterns: [{ label: "Network/HTTP error", count: 1 }],
      }),
    });
  });

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
            key: "active",
            label: "Active sessions",
            count: 1,
          },
        ],
      }),
    });
  });
  await page.route("**/api/monitor/events", async (route) => {
    await route.abort("failed");
  });

  const sessionsListBody = {
    kind: "harness.sessions",
    generatedAt: "2024-01-11T11:00:00.000Z",
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
        source: { available: false, reason: "missing-database" },
        sessionCount: 0,
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
    directories: [{ directory: "/workspace/repo-alpha", count: 1 }],
    sessions: [
      {
        harness: "opencode",
        id: "ses-root-1",
        title: "Root monitor session",
        directory: "/workspace/repo-alpha",
        gitBranch: null,
        createdAt: "2024-01-10T09:00:00.000Z",
        updatedAt: "2024-01-10T09:01:00.000Z",
        model: null,
        messageCount: 3,
        totalTokens: 180,
        subagentCount: 1,
        detailAvailable: true,
      },
    ],
  };
  await page.route("**/api/sessions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionsListBody),
    });
  });
  await page.route("**/api/sessions?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionsListBody),
    });
  });

  await page.route("**/api/search**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const query = requestUrl.searchParams.get("q") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "search.results",
        generatedAt: "2024-01-11T11:00:00.000Z",
        query,
        searchTerms: query ? [query] : [],
        results: query
          ? [
              {
                id: "ses-root-1",
                title: "Root monitor session",
                directory: "/workspace/repo-alpha",
                createdAt: "2024-01-10T09:00:00.000Z",
                snippet: "Investigate monitor boundary behavior",
                messageCount: 3,
                totalTokens: 180,
              },
            ]
          : [],
      }),
    });
  });

  await page.route("**/api/sessions/opencode/ses-root-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "harness.session.detail",
        generatedAt: "2024-01-11T11:00:00.000Z",
        harness: {
          id: "opencode",
          label: "OpenCode",
          capabilities: { delete: true, livePrompt: true, resume: true },
        },
        source: { ok: true, parseWarningCount: 0 },
        models: ["gpt-4.1", "gpt-4.1-mini", "gpt-5.3-codex-spark"],
        durationMs: 33_000,
        session: {
          id: "ses-root-1",
          title: "Root monitor session",
          directory: "/workspace/repo-alpha",
          gitBranch: null,
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
        ],
        messages: [],
        toolEvents: [],
        todos: [],
        summaryDiffs: null,
      }),
    });
  });

  await page.route("**/api/tool-errors/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "tool-errors.detail",
        generatedAt: "2024-01-11T11:00:00.000Z",
        tool: "github_search",
        dailyErrorCounts: [{ day: "2024-01-11", count: 1 }],
        latestErrors: [
          {
            timeCreated: 1704877260000,
            sessionId: "ses-root-1",
            error: "HTTP 500 upstream",
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent Sessions" }),
  ).toBeVisible();

  await page.goto("/sessions");
  await expect(page.getByTestId("sessions-page")).toBeVisible();
  await expect(page.getByText("Root monitor session").first()).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("dashboard")).toBeVisible();

  await page.goto("/search?q=monitor");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByText("Root monitor session").first()).toBeVisible();

  await page.goto("/sessions/opencode/ses-root-1");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Root monitor session" }),
  ).toBeVisible();

  await page.goto("/tool-errors/github_search");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByText("Tool Errors: github_search")).toBeVisible();

  await page.goto("/monitor");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent Sessions" }),
  ).toBeVisible();
});
