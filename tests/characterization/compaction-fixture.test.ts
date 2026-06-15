import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Database } from "../../src/lib/sqlite.js";
import {
  FIXTURE_DB_PATH,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

describe("compaction fixture coverage", () => {
  beforeAll(() => {
    useFixtureDb();
  });

  afterAll(() => {
    restoreDbPath();
  });

  test("keeps stable raw-message counts for main vs subagent compaction derivation", () => {
    const db = new Database(FIXTURE_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const totals = db
        .prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN s.parent_id IS NULL THEN 1 ELSE 0 END) AS main_count,
            SUM(CASE WHEN s.parent_id IS NOT NULL THEN 1 ELSE 0 END) AS subagent_count
          FROM message m
          JOIN session s ON s.id = m.session_id
          WHERE json_extract(m.data, '$.mode') = 'compaction'
        `)
        .get() as { total: number; main_count: number; subagent_count: number };

      const bySession = db
        .prepare(`
          SELECT m.session_id AS session_id, COUNT(*) AS count
          FROM message m
          WHERE json_extract(m.data, '$.mode') = 'compaction'
          GROUP BY m.session_id
          ORDER BY m.session_id ASC
        `)
        .all() as { session_id: string; count: number }[];

      expect(totals).toEqual({
        total: 2,
        main_count: 1,
        subagent_count: 1,
      });
      expect(bySession).toEqual([
        { session_id: "ses-child-1", count: 1 },
        { session_id: "ses-root-2", count: 1 },
      ]);
    } finally {
      db.close();
    }
  });
});
