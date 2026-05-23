import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type {
  MonitorPromptEnqueueResponseContract,
  MonitorPromptPollResponseContract,
} from "../../src/contracts/monitor-command.js";
import { createApiApp } from "../../src/server/app.js";
import { resetMonitorPromptCommandQueueForTest } from "../../src/server/monitor-command-queue.js";

describe("monitor prompt command api", () => {
  beforeEach(() => {
    resetMonitorPromptCommandQueueForTest();
  });

  afterEach(() => {
    resetMonitorPromptCommandQueueForTest();
  });

  test("POST /api/monitor/sessions/:sessionId/prompt enqueues a prompt command", async () => {
    const app = createApiApp();

    const enqueue = await app.request(
      "/api/monitor/sessions/ses-api-1/prompt",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: "continue from the current state",
        }),
      },
    );

    expect(enqueue.status).toBe(202);

    const enqueueBody =
      (await enqueue.json()) as MonitorPromptEnqueueResponseContract;
    expect(enqueueBody.accepted).toBe(true);
    expect(enqueueBody.sessionId).toBe("ses-api-1");
    expect(enqueueBody.commandId).toMatch(/^prompt-/);

    const poll = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionIds: ["ses-api-1"],
      }),
    });

    expect(poll.status).toBe(200);
    const pollBody = (await poll.json()) as MonitorPromptPollResponseContract;
    expect(pollBody.commands).toEqual([
      expect.objectContaining({
        id: enqueueBody.commandId,
        sessionId: "ses-api-1",
        text: "continue from the current state",
      }),
    ]);

    const secondPoll = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionIds: ["ses-api-1"],
      }),
    });
    const secondPollBody =
      (await secondPoll.json()) as MonitorPromptPollResponseContract;
    expect(secondPollBody.commands).toEqual([]);
  });

  test("POST /api/monitor/commands/poll only drains commands for active session ids", async () => {
    const app = createApiApp();

    await app.request("/api/monitor/sessions/ses-api-a/prompt", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "message a" }),
    });
    await app.request("/api/monitor/sessions/ses-api-b/prompt", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "message b" }),
    });

    const pollA = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionIds: ["ses-api-a"],
      }),
    });

    const pollABody = (await pollA.json()) as MonitorPromptPollResponseContract;
    expect(pollABody.commands.map((command) => command.sessionId)).toEqual([
      "ses-api-a",
    ]);

    const pollB = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionIds: ["ses-api-b"],
      }),
    });

    const pollBBody = (await pollB.json()) as MonitorPromptPollResponseContract;
    expect(pollBBody.commands.map((command) => command.sessionId)).toEqual([
      "ses-api-b",
    ]);
  });

  test("POST /api/monitor/commands/poll without session ids returns pending commands until acknowledged", async () => {
    const app = createApiApp();

    const enqueue = await app.request(
      "/api/monitor/sessions/ses-api-pending/prompt",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "pending message" }),
      },
    );
    const enqueueBody =
      (await enqueue.json()) as MonitorPromptEnqueueResponseContract;

    const poll = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const pollBody = (await poll.json()) as MonitorPromptPollResponseContract;
    expect(pollBody.commands.map((command) => command.id)).toEqual([
      enqueueBody.commandId,
    ]);

    const secondPoll = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const secondPollBody =
      (await secondPoll.json()) as MonitorPromptPollResponseContract;
    expect(secondPollBody.commands.map((command) => command.id)).toEqual([
      enqueueBody.commandId,
    ]);

    const ack = await app.request("/api/monitor/commands/ack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commandIds: [enqueueBody.commandId],
      }),
    });
    expect(ack.status).toBe(200);

    const finalPoll = await app.request("/api/monitor/commands/poll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const finalPollBody =
      (await finalPoll.json()) as MonitorPromptPollResponseContract;
    expect(finalPollBody.commands).toEqual([]);
  });

  test("POST /api/monitor/sessions/:sessionId/prompt rejects blank text", async () => {
    const app = createApiApp();

    const response = await app.request(
      "/api/monitor/sessions/ses-api-blank/prompt",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: "   ",
        }),
      },
    );

    expect(response.status).toBe(400);
  });
});
