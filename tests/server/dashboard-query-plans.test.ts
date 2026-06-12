import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getDb } from "../../src/lib/db.js";
import { explainDashboardQueryPlans } from "../../src/repositories/dashboard/dashboard-queries.js";
import {
  ROOT_SESSION_ID,
  restoreDbPath,
  useFixtureDb,
} from "../helpers/fixture-db.js";

// A heap SCAN of message/part reads the ~5KB JSON blob of every row and is the
// access pattern that froze the dashboard on the 8GB DB. A covering-index scan
// still appears as "SCAN <table> USING COVERING INDEX ..." — also forbidden for
// the delta query, which must touch only appended rows — so we reject any step
// matching "SCAN message" / "SCAN part" regardless of suffix.
const FORBIDDEN_SCAN = /\bSCAN (message|part)\b/;

let db: Database.Database;

beforeEach(() => {
  useFixtureDb();
  db = getDb();
});

afterEach(() => {
  db.close();
  restoreDbPath();
});

describe("dashboard query plans never full-scan message/part", () => {
  test("stamps / delta / per-root source all use indexed access", () => {
    const plans = explainDashboardQueryPlans(db, ROOT_SESSION_ID);

    // Sanity: all five probed queries are present.
    expect(plans.map((plan) => plan.label).sort()).toEqual([
      "delta-message",
      "delta-part",
      "per-root-source-messages",
      "per-root-source-parts",
      "stamps",
    ]);

    for (const plan of plans) {
      const offenders = plan.steps.filter((step) => FORBIDDEN_SCAN.test(step));
      expect(
        offenders,
        `query "${plan.label}" must not SCAN message/part; plan was:\n${plan.steps.join("\n")}`,
      ).toEqual([]);
    }
  });

  test("stamps query searches the message/part session_id indexes", () => {
    const plans = explainDashboardQueryPlans(db, ROOT_SESSION_ID);
    const stamps = plans.find((plan) => plan.label === "stamps");
    expect(stamps).toBeDefined();
    const joined = stamps?.steps.join("\n") ?? "";
    // The per-session aggregation must drive from the session_id indexes.
    expect(joined).toMatch(
      /SEARCH m USING INDEX message_session_id_time_created_id_idx \(session_id=\?\)/,
    );
    expect(joined).toMatch(
      /SEARCH p USING INDEX part_session_id_idx \(session_id=\?\)/,
    );
  });

  test("delta queries use the rowid range search (appended rows only)", () => {
    const plans = explainDashboardQueryPlans(db, ROOT_SESSION_ID);
    for (const label of ["delta-message", "delta-part"]) {
      const plan = plans.find((entry) => entry.label === label);
      expect(plan, label).toBeDefined();
      const joined = plan?.steps.join("\n") ?? "";
      expect(joined).toMatch(/USING INTEGER PRIMARY KEY \(rowid>\?\)/);
    }
  });
});
