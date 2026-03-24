import { Hono } from "hono";
import type {
  ToolErrorsContract,
  ToolErrorsOverviewContract,
} from "../contracts/tool-errors.js";
import {
  buildToolErrorsOverviewView,
  buildToolErrorsView,
} from "../services/tool-errors/tool-errors.service.js";

export const toolErrorsApi = new Hono()
  .get("/", (c) => {
    const view = buildToolErrorsOverviewView();

    const response: ToolErrorsOverviewContract = {
      kind: "tool-errors.overview",
      generatedAt: new Date().toISOString(),
      windowDays: view.windowDays,
      summary: {
        totalErrors: view.totalErrors,
        distinctTools: view.distinctTools,
        affectedSessions: view.affectedSessions,
      },
      insights: view.insights,
      topTools: view.topTools,
      errorPatterns: view.errorPatterns,
      latestErrors: view.latestErrors.map((row) => ({
        timeCreated: row.time_created,
        sessionId: row.session_id,
        tool: row.tool,
        error: row.error,
      })),
    };

    return c.json(response);
  })
  .get("/:tool", (c) => {
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
