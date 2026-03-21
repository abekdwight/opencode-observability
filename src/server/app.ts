import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { resolveAppDistDir } from "../lib/app-dist-path.js";
import { getWritableDb } from "../lib/db.js";
import { renderAppShell } from "./app-shell.js";
import { dashboardApi } from "./dashboard-api.js";
import { requireDeleteConfirmation } from "./delete-guard.js";
import { directoriesApi } from "./directories-api.js";
import { monitorApi } from "./monitor-api.js";
import { searchApi } from "./search-api.js";
import { sessionApi } from "./session-api.js";
import { toolErrorsApi } from "./tool-errors-api.js";

export function createApiApp() {
  const apiApp = new Hono().basePath("/api");

  apiApp.route("/monitor", monitorApi);
  apiApp.route("/session", sessionApi);
  apiApp.route("/dashboard", dashboardApi);
  apiApp.route("/", directoriesApi);
  apiApp.route("/", searchApi);
  apiApp.route("/tool-errors", toolErrorsApi);

  apiApp.delete("/session/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const confirmation = c.req.header("x-opencode-confirm-delete");

    if (!requireDeleteConfirmation(sessionId, confirmation)) {
      return c.json(
        {
          error: "delete confirmation required",
          sessionId,
        },
        400,
      );
    }

    const db = getWritableDb();
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const deleteStmt = db.prepare(
        "DELETE FROM session WHERE id = ? OR parent_id = ?",
      );
      const result = deleteStmt.run(sessionId, sessionId);
      return c.json({ deleted: result.changes });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    } finally {
      db.close();
    }
  });

  apiApp.notFound((c) =>
    c.json(
      {
        kind: "api.not-found",
        path: c.req.path,
      },
      404,
    ),
  );

  apiApp.onError((err, c) =>
    c.json(
      {
        kind: "api.error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    ),
  );

  return apiApp;
}

export const app = new Hono();
const apiApp = createApiApp();
const APP_DIST_DIR = resolveAppDistDir(import.meta.url);

app.route("/", apiApp);

app.use("/assets/*", serveStatic({ root: APP_DIST_DIR }));

app.get("*", (c) => {
  const path = c.req.path;
  if (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/assets" ||
    path.startsWith("/assets/")
  ) {
    return c.notFound();
  }
  return c.html(renderAppShell());
});

app.notFound((c) =>
  c.json(
    {
      kind: "app.not-found",
      path: c.req.path,
      host: getConnInfo(c).remote.address,
    },
    404,
  ),
);

app.onError((err, c) =>
  c.json(
    {
      kind: "app.error",
      message: err instanceof Error ? err.message : String(err),
    },
    500,
  ),
);
