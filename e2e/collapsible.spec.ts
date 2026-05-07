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
  toolEvents: [],
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

    const sidebar = page.getByTestId("session-sidebar");
    await expect(sidebar.getByText("Duration", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Tokens", { exact: true })).toBeVisible();
    await expect(sidebar.getByText(/Subagents\s+1/)).toBeVisible();
  });

  test("empty-text message shells show tools without a message body", async ({
    page,
  }) => {
    const sessionWithToolOnlyMessage: SessionDetailContract = {
      ...SESSION_DETAIL,
      messages: [
        {
          role: "assistant",
          text: "",
          modelId: "gpt-4.1",
          agent: "Sisyphus",
          outputTpsLabel: null,
          createdAt: "2024-01-10T09:00:20.000Z",
          toolCalls: [
            {
              tool: "skill",
              input: "create-skill",
              status: "completed",
              error: "",
              fullInput: '{"name":"create-skill"}',
              fullOutput: "skill loaded",
              durationMs: 50,
            },
          ],
          subagentLinks: [],
          fileDiffs: [],
        },
      ],
      toolEvents: [],
      todos: [],
      summaryDiffs: null,
    };

    await stubApis(page, sessionWithToolOnlyMessage);
    await page.goto("/session/ses-root-1");

    const message = page.getByTestId("message-0");
    await expect(message.getByText("skill create-skill")).toBeVisible();
    await expect(message.locator("[data-message-content]")).toHaveCount(0);
    await expect(message.locator("[data-message-raw]")).toHaveCount(0);
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

  test("mermaid fenced blocks render as diagrams and open in zoom lightbox", async ({
    page,
  }) => {
    const sessionWithMermaid: SessionDetailContract = {
      ...SESSION_DETAIL,
      messages: [
        {
          role: "assistant",
          text: [
            "```mermaid",
            "sequenceDiagram",
            "  participant X as 共有端末X",
            "  participant A as スタッフA",
            "  participant B as スタッフB",
            "  participant API as /api/device-infos/",
            "  participant DB as DeviceInfo",
            "  A->>API: token=A用, device_id=端末X",
            "  API->>DB: AのDeviceInfoを作成",
            "  B->>API: token=B用, device_id=端末X",
            "  API->>DB: device_id=端末X の既存レコードを検索",
            "  API->>DB: AのDeviceInfoを削除",
            "  API->>DB: BのDeviceInfoを新規作成",
            "```",
          ].join("\n"),
          modelId: "gpt-4.1",
          agent: "Sisyphus",
          outputTpsLabel: "12.0 tok/s",
          createdAt: "2024-01-10T09:00:40.000Z",
          toolCalls: [],
          subagentLinks: [],
        },
      ],
      todos: [],
      summaryDiffs: null,
    };

    await stubApis(page, sessionWithMermaid);
    await page.goto("/session/ses-root-1");

    const mermaidPreview = page
      .getByTestId("message-0")
      .locator(".message-content .mermaid-preview");
    await expect(mermaidPreview).toBeVisible();
    await expect(mermaidPreview.locator("svg")).toBeVisible();

    const inlineCanvas = mermaidPreview.locator(".mermaid-preview-canvas");
    await expect(inlineCanvas).toBeVisible();
    const inlineOverflowPx = await inlineCanvas.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(inlineOverflowPx).toBeLessThanOrEqual(2);

    const inlineCanvasBox = await inlineCanvas.boundingBox();
    const inlineSvgBox = await mermaidPreview.locator("svg").boundingBox();
    expect(inlineCanvasBox).not.toBeNull();
    expect(inlineSvgBox).not.toBeNull();
    if (inlineCanvasBox && inlineSvgBox) {
      expect(inlineSvgBox.width).toBeLessThanOrEqual(inlineCanvasBox.width + 1);
    }

    // Trigger a parent re-render and verify diagram does not revert to text.
    await page.getByTestId("btn-tools").click();
    await expect(mermaidPreview).toBeVisible();
    await expect(mermaidPreview.locator("svg")).toBeVisible();
    await expect(
      page
        .getByTestId("message-0")
        .locator(".message-content code.language-mermaid"),
    ).toHaveCount(0);

    await mermaidPreview.click();

    const lightbox = page.getByTestId("mermaid-lightbox");
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator(".mermaid-lightbox-title")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.body.classList.contains("mermaid-lightbox-open"),
        ),
      )
      .toBe(true);

    const actionsBox = await lightbox
      .locator(".mermaid-lightbox-actions")
      .boundingBox();
    const closeButton = lightbox.getByRole("button", { name: "閉じる" });
    const closeBox = await closeButton.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    if (actionsBox && closeBox) {
      expect(closeBox.x).toBeGreaterThan(actionsBox.x + actionsBox.width - 4);
    }

    const viewportSize = page.viewportSize();
    const cardBox = await lightbox
      .locator(".mermaid-lightbox-card")
      .boundingBox();
    expect(cardBox?.width ?? 0).toBeGreaterThan(
      (viewportSize?.width ?? 0) * 0.85,
    );
    expect(cardBox?.height ?? 0).toBeGreaterThan(
      (viewportSize?.height ?? 0) * 0.82,
    );

    await expect(
      lightbox.locator(".mermaid-lightbox-canvas svg"),
    ).toHaveAttribute("id", /session-mermaid/);
    const modalSvg = lightbox.locator(".mermaid-lightbox-canvas svg");
    await expect(modalSvg).toBeVisible();
    const box = await modalSvg.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(180);
    expect(box?.height ?? 0).toBeGreaterThan(100);
    await expect(closeButton).toBeFocused();

    const zoomText = lightbox.locator(".mermaid-lightbox-zoom");
    const initialZoomLabel = (await zoomText.textContent())?.trim() ?? "";
    expect(initialZoomLabel.endsWith("%")).toBe(true);

    const viewport = lightbox.locator(".mermaid-lightbox-viewport");
    const scrollBeforeWheel = await page.evaluate(() => window.scrollY);
    await viewport.hover();
    await page.mouse.wheel(0, 480);
    await expect
      .poll(async () => (await zoomText.textContent())?.trim() ?? "")
      .not.toBe(initialZoomLabel);
    const scrollAfterWheel = await page.evaluate(() => window.scrollY);
    expect(scrollAfterWheel).toBe(scrollBeforeWheel);

    const canvas = lightbox.locator(".mermaid-lightbox-canvas");
    const transformBeforeDrag = await canvas.evaluate(
      (el) => (el as HTMLElement).style.transform,
    );
    const viewportBox = await viewport.boundingBox();
    expect(viewportBox).not.toBeNull();
    if (viewportBox) {
      await page.mouse.move(
        viewportBox.x + viewportBox.width * 0.5,
        viewportBox.y + viewportBox.height * 0.5,
      );
      await page.mouse.down();
      await page.mouse.move(
        viewportBox.x + viewportBox.width * 0.5 + 120,
        viewportBox.y + viewportBox.height * 0.5 + 70,
      );
      await page.mouse.up();
    }

    await expect
      .poll(
        async () =>
          await canvas.evaluate((el) => (el as HTMLElement).style.transform),
      )
      .not.toBe(transformBeforeDrag);

    await page.keyboard.press("Escape");
    await expect(lightbox).not.toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.body.classList.contains("mermaid-lightbox-open"),
        ),
      )
      .toBe(false);
    await expect(mermaidPreview).toBeVisible();

    await mermaidPreview.click();
    await expect(lightbox).toBeVisible();

    await page.mouse.click(5, 5);
    await expect(lightbox).not.toBeVisible();
  });
});
