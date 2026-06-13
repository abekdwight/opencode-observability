import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const MONITOR_SNAPSHOT = {
  kind: "monitor.snapshot",
  generatedAt: "2024-01-11T11:00:00.000Z",
  activeRootSessions: [
    {
      id: "ses-alpha",
      title: "Investigate flaky test",
      directory: "/workspace/alpha",
      updatedAt: "2024-01-10T09:01:00.000Z",
      messageCount: 12,
      toolCallCount: 5,
      compactionCount: 1,
      subagentCount: 2,
    },
    {
      id: "ses-beta",
      title: "Refactor auth module",
      directory: "/workspace/beta",
      updatedAt: "2024-01-10T08:30:00.000Z",
      messageCount: 6,
      toolCallCount: 3,
      compactionCount: 0,
      subagentCount: 0,
    },
  ],
  compactionCounts: { main: 1, subagent: 0, total: 1 },
  signalBadges: [{ key: "alerts", label: "Alerts", count: 0 }],
};

/**
 * Build a minimal SSE stream body from an array of SSE frames.
 * Each frame is `event: <name>\ndata: <json>\n\n`.
 */
function buildSseBody(frames: Array<{ event: string; data: unknown }>): string {
  return frames
    .map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`)
    .join("");
}

function timelineEvent(
  overrides: Partial<{
    eventId: string;
    serverSeq: number;
    rootSessionId: string;
    sessionId: string;
    at: string;
    receivedAt: string;
    label: string;
    severity: string;
    kind: string;
    meta: Record<string, unknown>;
  }>,
) {
  return {
    eventId: overrides.eventId ?? "evt-1",
    serverSeq: overrides.serverSeq ?? 1,
    sourceId: "test-source",
    rootSessionId: overrides.rootSessionId ?? "ses-alpha",
    sessionId: overrides.sessionId ?? overrides.rootSessionId ?? "ses-alpha",
    at: overrides.at ?? "2024-01-10T09:01:00.000Z",
    receivedAt: overrides.receivedAt ?? "2024-01-10T09:01:01.000Z",
    label: overrides.label ?? "Status: busy",
    severity: overrides.severity ?? "info",
    kind: overrides.kind ?? "status-changed",
    meta: overrides.meta ?? { status: "busy" },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Set up all route mocks for the monitor page.
 * `timelineFrames` controls what the timeline SSE sends.
 * The monitor SSE (`/api/monitor/events`) just stays open with no data.
 */
async function setupMonitorMocks(
  page: import("@playwright/test").Page,
  opts?: {
    snapshot?: typeof MONITOR_SNAPSHOT;
    monitorFrames?: Array<{ event: string; data: unknown }>;
    timelineFrames?: Array<{ event: string; data: unknown }>;
    /** When true, abort the timeline SSE instead of fulfilling it */
    abortTimeline?: boolean;
  },
) {
  // Mock monitor snapshot
  const snapshot = opts?.snapshot ?? MONITOR_SNAPSHOT;
  await page.route("**/api/monitor/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
    });
  });

  // Mock monitor SSE — keep alive but emit nothing so the page shows "Live"
  const monitorFrames = opts?.monitorFrames ?? [
    {
      event: "heartbeat",
      data: { type: "heartbeat", at: "2024-01-11T11:00:00.000Z" },
    },
  ];
  await page.route("**/api/monitor/events", async (route) => {
    const body = buildSseBody(monitorFrames);
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body,
    });
  });

  // Mock timeline SSE
  const timelineFrames = opts?.timelineFrames ?? [];
  const abortTimeline = opts?.abortTimeline ?? false;
  await page.route("**/api/monitor/timeline/events", async (route) => {
    if (abortTimeline) {
      await route.abort("failed");
      return;
    }
    const body = timelineFrames.length > 0 ? buildSseBody(timelineFrames) : "";
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests — inline time-series chart per session card
// ---------------------------------------------------------------------------

test.describe("Monitor timeline inline chart", () => {
  test("renders an inline chart preview for each session card", async ({
    page,
  }) => {
    // Send some timeline events so the chart has data
    const events = [
      timelineEvent({
        eventId: "evt-1",
        serverSeq: 1,
        rootSessionId: "ses-alpha",
        label: "Status: busy",
        severity: "info",
      }),
    ];

    const frames = events.map((ev) => ({
      event: "timeline" as const,
      data: { type: "timeline.event", serverSeq: ev.serverSeq, event: ev },
    }));

    await setupMonitorMocks(page, { timelineFrames: frames });
    await page.goto("/monitor");

    // Both session cards should have their inline chart preview
    await expect(
      page.getByTestId("monitor-timeline-preview-ses-alpha"),
    ).toBeVisible();
    await expect(
      page.getByTestId("monitor-timeline-preview-ses-beta"),
    ).toBeVisible();
  });

  test("renders SVG chart with time-axis labels when feed is live", async ({
    page,
  }) => {
    const events = [
      timelineEvent({
        eventId: "evt-1",
        serverSeq: 1,
        rootSessionId: "ses-alpha",
        severity: "info",
      }),
    ];

    const frames = events.map((ev) => ({
      event: "timeline" as const,
      data: { type: "timeline.event", serverSeq: ev.serverSeq, event: ev },
    }));

    await setupMonitorMocks(page, { timelineFrames: frames });
    await page.goto("/monitor");

    const preview = page.getByTestId("monitor-timeline-preview-ses-alpha");
    await expect(preview).toBeVisible();

    // Should contain the SVG chart element
    const svg = preview.locator("svg.timeline-chart-svg");
    await expect(svg).toBeVisible();

    // SVG should have the aria-label for accessibility
    await expect(svg).toHaveAttribute(
      "aria-label",
      "Session activity timeline",
    );

    // Axis should explicitly show oldest on the left and newest on the right
    await expect(preview).toContainText("5m");
    await expect(preview).toContainText("Now");
  });

  test("shows pending state when no timeline events are cached", async ({
    page,
  }) => {
    // No timeline frames → empty cache → feed will cycle to disconnected
    await setupMonitorMocks(page, { timelineFrames: [] });
    await page.goto("/monitor");

    // Wait for sessions to render
    await expect(
      page.getByTestId("monitor-timeline-preview-ses-alpha"),
    ).toBeVisible();
    await expect(
      page.getByTestId("monitor-timeline-preview-ses-beta"),
    ).toBeVisible();

    // Both previews should show a non-live feed state via the stable
    // FEED_STATE selector — data-state carries the semantic value.
    const alphaFeedState = page
      .getByTestId("monitor-timeline-preview-ses-alpha")
      .getByTestId("monitor-timeline-feed-state");
    await expect(alphaFeedState).toBeVisible();
    await expect(alphaFeedState).toHaveAttribute(
      "data-state",
      /^(pending|reconnecting|disconnected)$/,
    );

    const betaFeedState = page
      .getByTestId("monitor-timeline-preview-ses-beta")
      .getByTestId("monitor-timeline-feed-state");
    await expect(betaFeedState).toBeVisible();
    await expect(betaFeedState).toHaveAttribute(
      "data-state",
      /^(pending|reconnecting|disconnected)$/,
    );
  });

  test("session title link navigates to /sessions/opencode/:id", async ({
    page,
  }) => {
    await setupMonitorMocks(page);
    await page.goto("/monitor");

    // The session title should be a link
    const titleLink = page.locator('a[href="/sessions/opencode/ses-alpha"]');
    await expect(titleLink).toBeVisible();
    await expect(titleLink).toContainText("Investigate flaky test");

    // Legacy selected-session controls should not exist anymore
    await expect(
      page.getByTestId("monitor-timeline-select-ses-alpha"),
    ).toHaveCount(0);
    await expect(page.getByTestId("monitor-timeline-panel")).toHaveCount(0);
  });

  test("prioritizes sessions with intervention signals and shows latest incident copy", async ({
    page,
  }) => {
    const frames = [
      {
        event: "timeline" as const,
        data: {
          type: "timeline.event",
          serverSeq: 1,
          event: timelineEvent({
            eventId: "evt-a1",
            serverSeq: 1,
            rootSessionId: "ses-alpha",
            kind: "status-changed",
            severity: "info",
            label: "Status: busy",
            meta: { status: "busy" },
          }),
        },
      },
      {
        event: "timeline" as const,
        data: {
          type: "timeline.event",
          serverSeq: 2,
          event: timelineEvent({
            eventId: "evt-b1",
            serverSeq: 2,
            rootSessionId: "ses-beta",
            kind: "alert",
            severity: "error",
            label: "Alert: network",
            meta: { category: "network", level: "error" },
          }),
        },
      },
    ];

    await setupMonitorMocks(page, { timelineFrames: frames });
    await page.goto("/monitor");

    const titles = page.locator(".recent-item .recent-title");
    await expect(titles.first()).toContainText("Refactor auth module");
    await expect(page.locator(".recent-item").first()).toContainText(
      "Alert: network",
    );
    await expect(
      page.getByText("Live-only timeline from this page load"),
    ).toBeVisible();
  });

  test("keeps a rendered real session visible after later snapshots drop it", async ({
    page,
  }) => {
    await setupMonitorMocks(page, {
      monitorFrames: [
        {
          event: "heartbeat",
          data: { type: "heartbeat", at: "2024-01-11T11:00:00.000Z" },
        },
        {
          event: "snapshot",
          data: {
            payload: {
              ...MONITOR_SNAPSHOT,
              activeRootSessions: [],
            },
          },
        },
      ],
    });

    await page.goto("/monitor");

    await expect(
      page.locator('a[href="/sessions/opencode/ses-alpha"]'),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/sessions/opencode/ses-beta"]'),
    ).toBeVisible();
    await expect(
      page.getByText("No sessions seen during this page load"),
    ).toHaveCount(0);
  });

  test("never renders legacy source placeholder sessions", async ({ page }) => {
    await setupMonitorMocks(page, {
      snapshot: {
        ...MONITOR_SNAPSHOT,
        activeRootSessions: [
          {
            id: "source:macbook-pro:7768",
            title: "source:macbook-pro:7768",
            directory: "(unknown)",
            updatedAt: "2024-01-10T09:01:00.000Z",
            messageCount: 0,
            toolCallCount: 0,
            compactionCount: 0,
            subagentCount: 0,
          },
        ],
      },
    });

    await page.goto("/monitor");

    await expect(
      page.getByText("source:macbook-pro:7768"),
    ).toHaveCount(0);
    await expect(
      page.getByText("No sessions seen during this page load"),
    ).toBeVisible();
  });

  test("preserves existing route test ids", async ({ page }) => {
    // Abort SSE to trigger degraded state
    await page.route("**/api/monitor/snapshot", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MONITOR_SNAPSHOT),
      });
    });

    await page.route("**/api/monitor/events", async (route) => {
      await route.abort("failed");
    });

    await page.route("**/api/monitor/timeline/events", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: "",
      });
    });

    await page.goto("/monitor");

    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("route-live-degraded")).toContainText(
      "Reconnecting to the observability stream",
    );
  });
});

// ---------------------------------------------------------------------------
// UX guardrail state tests
// ---------------------------------------------------------------------------

test.describe("Monitor timeline UX guardrails", () => {
  test("shows disconnected state in previews when timeline SSE is aborted", async ({
    page,
  }) => {
    // Abort the timeline SSE to trigger disconnected state.
    // The hook dispatches CONNECTING then the EventSource errors immediately,
    // cycling through reconnecting → another CONNECTING on retry.
    // With repeated aborts the hook stays in reconnecting/loading.
    await setupMonitorMocks(page, { abortTimeline: true });
    await page.goto("/monitor");

    // Wait for sessions to render
    await expect(
      page.getByTestId("monitor-timeline-preview-ses-alpha"),
    ).toBeVisible();

    // The preview should show a non-live feed state via the stable FEED_STATE
    // selector. With aborted SSE, the hook cycles through loading → reconnecting
    // (never reaches "live"), so data-state will be one of these non-live values.
    const alphaFeedState = page
      .getByTestId("monitor-timeline-preview-ses-alpha")
      .getByTestId("monitor-timeline-feed-state");
    await expect(alphaFeedState).toBeVisible();
    await expect(alphaFeedState).toHaveAttribute(
      "data-state",
      /^(reconnecting|disconnected|pending)$/,
    );
  });
});
