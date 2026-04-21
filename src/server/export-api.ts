import { Hono } from "hono";
import { getDb } from "../lib/db.js";
import {
  buildExportContextWindow,
  buildExportEventsContract,
  buildExportMessageBundleById,
  buildExportMessageBundlesBySession,
  buildExportPartById,
  buildExportSessionsContract,
} from "../services/export/export.service.js";

export const exportApi = new Hono()
  .get("/sessions", (c) => {
    const rawWorktree = c.req.query("worktree");
    const worktree = typeof rawWorktree === "string" ? rawWorktree.trim() : "";
    const db = getDb();
    try {
      return c.json(
        buildExportSessionsContract(db, worktree ? { worktree } : {}),
      );
    } finally {
      db.close();
    }
  })
  .get("/sessions/:sessionId/messages", (c) => {
    const sessionId = c.req.param("sessionId");
    const db = getDb();
    try {
      const contract = buildExportMessageBundlesBySession(db, sessionId);
      if (!contract) {
        return c.json({ kind: "export.session-not-found", sessionId }, 404);
      }
      return c.json(contract);
    } finally {
      db.close();
    }
  })
  .get("/messages/:messageId", (c) => {
    const messageId = c.req.param("messageId");
    const db = getDb();
    try {
      const contract = buildExportMessageBundleById(db, messageId);
      if (!contract) {
        return c.json({ kind: "export.message-not-found", messageId }, 404);
      }
      return c.json(contract);
    } finally {
      db.close();
    }
  })
  .get("/parts/:partId", (c) => {
    const partId = c.req.param("partId");
    const db = getDb();
    try {
      const contract = buildExportPartById(db, partId);
      if (!contract) {
        return c.json({ kind: "export.part-not-found", partId }, 404);
      }
      return c.json(contract);
    } finally {
      db.close();
    }
  })
  .get("/events", (c) => c.json(buildExportEventsContract()))
  .get("/sessions/:sessionId/context-window", (c) => {
    const sessionId = c.req.param("sessionId");
    const aroundMessageId = c.req.query("aroundMessageId") ?? "";
    const before = Number(c.req.query("before") ?? "1");
    const after = Number(c.req.query("after") ?? "1");
    const db = getDb();
    try {
      const contract = buildExportContextWindow(
        db,
        sessionId,
        aroundMessageId,
        Number.isFinite(before) ? before : 1,
        Number.isFinite(after) ? after : 1,
      );
      if (!contract) {
        return c.json(
          { kind: "export.message-not-found", messageId: aroundMessageId },
          404,
        );
      }
      return c.json(contract);
    } finally {
      db.close();
    }
  });
