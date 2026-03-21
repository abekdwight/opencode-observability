import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getOpenCodeDbPath } from "../src/lib/config.js";

const ROOT_SESSION_IDS = [
  "ses_2f6922df2ffeFyt7qS5W74Tm5Z",
  "ses_2f6575852ffeLRE8jordztg819",
] as const;

const TARGET_PATH = path.resolve("tests/fixtures/opencode-telemetry.sqlite");
const TABLES = ["project", "session", "message", "part", "todo"] as const;

function collectSessionIds(source: Database.Database): string[] {
  const queue = [...ROOT_SESSION_IDS];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const sessionId = queue.shift();
    if (!sessionId || visited.has(sessionId)) {
      continue;
    }

    visited.add(sessionId);

    const children = source
      .prepare(
        "SELECT id FROM session WHERE parent_id = ? ORDER BY time_created ASC",
      )
      .all(sessionId) as { id: string }[];

    for (const child of children) {
      if (!visited.has(child.id)) {
        queue.push(child.id);
      }
    }
  }

  return [...visited];
}

function createTables(source: Database.Database, target: Database.Database) {
  for (const table of TABLES) {
    const row = source
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table) as { sql: string } | undefined;

    if (!row?.sql) {
      throw new Error(`Missing schema for table: ${table}`);
    }

    target.exec(row.sql);
  }
}

function copyRows(
  source: Database.Database,
  target: Database.Database,
  table: (typeof TABLES)[number],
  whereClause: string,
  params: unknown[],
) {
  const columns = (
    source.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[]
  ).map((column) => column.name);

  const rows = source
    .prepare(`SELECT ${columns.join(", ")} FROM ${table} ${whereClause}`)
    .all(...params) as Record<string, unknown>[];

  if (rows.length === 0) {
    return 0;
  }

  const placeholders = columns.map((column) => `@${column}`).join(", ");
  const insert = target.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
  );
  const insertMany = target.transaction((items: Record<string, unknown>[]) => {
    for (const item of items) {
      insert.run(item);
    }
  });
  insertMany(rows);
  return rows.length;
}

function main() {
  const sourcePath = getOpenCodeDbPath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source DB not found: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
  fs.rmSync(TARGET_PATH, { force: true });

  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });
  const target = new Database(TARGET_PATH);

  try {
    target.pragma("foreign_keys = OFF");
    createTables(source, target);

    const sessionIds = collectSessionIds(source);
    const sessionPlaceholders = sessionIds.map(() => "?").join(", ");

    const projectIds = (
      source
        .prepare(
          `SELECT DISTINCT project_id FROM session WHERE id IN (${sessionPlaceholders})`,
        )
        .all(...sessionIds) as { project_id: string }[]
    ).map((row) => row.project_id);
    const projectPlaceholders = projectIds.map(() => "?").join(", ");

    const copied = {
      project: copyRows(
        source,
        target,
        "project",
        `WHERE id IN (${projectPlaceholders})`,
        projectIds,
      ),
      session: copyRows(
        source,
        target,
        "session",
        `WHERE id IN (${sessionPlaceholders})`,
        sessionIds,
      ),
      message: copyRows(
        source,
        target,
        "message",
        `WHERE session_id IN (${sessionPlaceholders})`,
        sessionIds,
      ),
      part: copyRows(
        source,
        target,
        "part",
        `WHERE session_id IN (${sessionPlaceholders})`,
        sessionIds,
      ),
      todo: copyRows(
        source,
        target,
        "todo",
        `WHERE session_id IN (${sessionPlaceholders})`,
        sessionIds,
      ),
    };

    target.pragma("foreign_keys = ON");

    console.log(
      JSON.stringify(
        { sourcePath, targetPath: TARGET_PATH, sessionIds, copied },
        null,
        2,
      ),
    );
  } finally {
    source.close();
    target.close();
  }
}

main();
