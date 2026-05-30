import { Hono } from "hono";
import type {
  CodexSessionDetailContract,
  CodexSessionsContract,
} from "../contracts/codex-sessions.js";
import { buildCodexSessionDetailView } from "../services/codex-sessions/codex-session-detail.service.js";
import { buildCodexSessionsView } from "../services/codex-sessions/codex-session-list.service.js";

export const codexSessionsApi = new Hono()
  .get("/", (c) => {
    const view = buildCodexSessionsView();
    const contract: CodexSessionsContract = {
      kind: "codex.sessions",
      generatedAt: new Date().toISOString(),
      source: view.source,
      sessions: view.sessions,
    };
    return c.json(contract);
  })
  .get("/:id", (c) => {
    const id = c.req.param("id");
    const view = buildCodexSessionDetailView(id);
    if (!view) {
      return c.json(
        {
          kind: "codex.session.not-found",
          sessionId: id,
        },
        404,
      );
    }

    const contract: CodexSessionDetailContract = {
      kind: "codex.session.detail",
      generatedAt: new Date().toISOString(),
      session: view.session,
      rollout: view.rollout,
      messages: view.messages,
    };
    return c.json(contract);
  });
