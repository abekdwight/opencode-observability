import { Hono } from "hono";
import type { SessionDetailContract } from "../contracts/session.js";
import { getDb } from "../lib/db.js";
import { buildSessionDetailContract } from "./contracts.js";

export function buildSessionDetail(
  sessionId: string,
): SessionDetailContract | null {
  const db = getDb();
  try {
    return buildSessionDetailContract(db, sessionId);
  } finally {
    db.close();
  }
}

export const sessionApi = new Hono().get("/:id", (c) => {
  const sessionId = c.req.param("id");
  const detail = buildSessionDetail(sessionId);
  if (!detail) {
    return c.json(
      {
        kind: "session.not-found",
        sessionId,
      },
      404,
    );
  }
  return c.json(detail);
});
