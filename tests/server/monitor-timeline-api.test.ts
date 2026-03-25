import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  MonitorTimelineFeedEventContract,
  MonitorTimelineFeedHeartbeatContract,
} from "../../src/contracts/monitor-timeline.js";
import { createApiApp } from "../../src/server/app.js";
import { MONITOR_SSE_HEARTBEAT_INTERVAL_MS } from "../../src/server/monitor-api.js";
import {
  getMonitorRuntimeSubscriberSnapshotForTests,
  resetMonitorRuntimeStoreForTest,
} from "../../src/server/monitor-runtime-store.js";

type SseMessage = {
  event: string;
  data: string;
};

function parseSseMessage(block: string): SseMessage | null {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!event || dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

async function readSseMessages(
  response: Response,
  expectedCount: number,
): Promise<SseMessage[]> {
  const body = response.body;
  if (!body) {
    throw new Error("expected response body to be present for SSE stream");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const messages: SseMessage[] = [];
  let buffer = "";

  while (messages.length < expectedCount) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const message = parseSseMessage(block);
      if (message) {
        messages.push(message);
        if (messages.length >= expectedCount) {
          await reader.cancel();
          return messages;
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  await reader.cancel();
  throw new Error(
    `expected ${expectedCount} SSE messages, received ${messages.length}`,
  );
}

describe("monitor timeline SSE api", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));
  });

  beforeEach(() => {
    resetMonitorRuntimeStoreForTest();
  });

  afterAll(() => {
    resetMonitorRuntimeStoreForTest();
    vi.useRealTimers();
  });

  test("GET /api/monitor/timeline/events relays live timeline events only", async () => {
    const app = createApiApp();
    const response = await app.request("/api/monitor/timeline/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const messagesPromise = readSseMessages(response, 1);
    const ingest = await app.request("/api/monitor/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: {
          instanceId: "timeline-source-api-1",
        },
        events: [
          {
            type: "session.created",
            session: {
              id: "ses-root-api-1",
              title: "Timeline root",
              directory: "/workspace/repo-alpha",
              updatedAt: "2026-03-25T12:00:01.000Z",
            },
          },
        ],
      }),
    });

    expect(ingest.status).toBe(202);

    const [message] = await messagesPromise;
    expect(message.event).toBe("timeline");

    const envelope = JSON.parse(
      message.data,
    ) as MonitorTimelineFeedEventContract;
    expect(envelope).toMatchObject({
      type: "timeline.event",
      serverSeq: 1,
      event: {
        serverSeq: 1,
        sourceId: "timeline-source-api-1",
        rootSessionId: "ses-root-api-1",
        sessionId: "ses-root-api-1",
        kind: "session-created",
        label: "Session created",
      },
    });

    expect(message.data).not.toContain('"type":"timeline.heartbeat"');
    expect(message.data).not.toContain('"kind":"monitor.snapshot"');
  });

  test("GET /api/monitor/timeline/events emits heartbeat while idle", async () => {
    const app = createApiApp();
    const response = await app.request("/api/monitor/timeline/events");

    const messagesPromise = readSseMessages(response, 1);
    await vi.advanceTimersByTimeAsync(MONITOR_SSE_HEARTBEAT_INTERVAL_MS);
    const [message] = await messagesPromise;

    expect(message.event).toBe("heartbeat");

    const heartbeat = JSON.parse(
      message.data,
    ) as MonitorTimelineFeedHeartbeatContract;
    expect(heartbeat.type).toBe("timeline.heartbeat");
    expect(heartbeat.serverSeq).toBe(1);
    expect(heartbeat.at).toBe("2026-03-25T12:00:15.000Z");
    expect(message.data).not.toContain("monitor.snapshot");
  });

  test("GET /api/monitor/timeline/events cleans up subscriber on disconnect", async () => {
    const app = createApiApp();
    const response = await app.request("/api/monitor/timeline/events");
    const reader = response.body?.getReader();

    expect(reader).toBeDefined();
    expect(getMonitorRuntimeSubscriberSnapshotForTests().timeline).toBe(1);

    await reader?.cancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(getMonitorRuntimeSubscriberSnapshotForTests().timeline).toBe(0);
  });
});
