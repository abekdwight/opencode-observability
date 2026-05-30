import { Hono } from "hono";
import type {
  ClaudeSessionDetailContract,
  ClaudeSessionsContract,
} from "../contracts/claude-sessions.js";
import { buildClaudeSessionDetailView } from "../services/claude-sessions/claude-session-detail.service.js";
import { buildClaudeSessionsView } from "../services/claude-sessions/claude-session-list.service.js";

export const claudeSessionsApi = new Hono()
  .get("/", (c) => {
    const view = buildClaudeSessionsView();
    const contract: ClaudeSessionsContract = {
      kind: "claude.sessions",
      generatedAt: new Date().toISOString(),
      source: view.source,
      sessions: view.sessions,
    };
    return c.json(contract);
  })
  .get("/:id", (c) => {
    const id = c.req.param("id");
    const view = buildClaudeSessionDetailView(id);
    if (!view) {
      return c.json(
        {
          kind: "claude.session.not-found",
          sessionId: id,
        },
        404,
      );
    }

    const contract: ClaudeSessionDetailContract = {
      kind: "claude.session.detail",
      generatedAt: new Date().toISOString(),
      session: view.session,
      transcript: view.transcript,
      messages: view.messages,
    };
    return c.json(contract);
  });
