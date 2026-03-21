import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "../../src/server/app.js";
import {
  CHILD_SESSION_ID,
  FIXTURE_DB_PATH,
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

describe("delete route", () => {
  beforeAll(() => {
    useFixtureDb();
  });

  afterAll(() => {
    restoreDbPath();
  });

  test("rejects delete without matching confirmation header", async () => {
    const response = await app.request(`/api/session/${ROOT_SESSION_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "delete confirmation required",
      sessionId: ROOT_SESSION_ID,
    });
  });

  test("deletes root session and child session when confirmation matches", async () => {
    const response = await app.request(`/api/session/${ROOT_SESSION_ID}`, {
      method: "DELETE",
      headers: {
        "x-opencode-confirm-delete": ROOT_SESSION_ID,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deleted: 2,
    });

    const db = new Database(FIXTURE_DB_PATH, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT id FROM session WHERE id IN (?, ?)")
        .all(ROOT_SESSION_ID, CHILD_SESSION_ID) as Array<{ id: string }>;
      expect(rows).toEqual([]);
    } finally {
      db.close();
    }
  });
});
