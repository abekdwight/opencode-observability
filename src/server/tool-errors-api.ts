import { Hono } from "hono";
import type { ToolErrorsContract } from "../contracts/tool-errors.js";
import { buildToolErrorsView } from "../services/tool-errors/tool-errors.service.js";

export const toolErrorsApi = new Hono().get("/:tool", (c) => {
  const view = buildToolErrorsView(c.req.param("tool"));

  const response: ToolErrorsContract = {
    kind: "tool-errors.detail",
    generatedAt: new Date().toISOString(),
    tool: view.toolName,
    dailyErrorCounts: Array.from(view.timelineData.entries()).map(
      ([day, count]) => ({ day, count }),
    ),
    latestErrors: view.errors.map((row) => ({
      timeCreated: row.time_created,
      sessionId: row.session_id,
      error: row.error,
    })),
  };

  return c.json(response);
});
