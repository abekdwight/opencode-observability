import fs from "node:fs";
import { createRequire } from "node:module";
import type {
  DatabaseSync as DatabaseSyncInstance,
  SQLInputValue,
  StatementSync,
} from "node:sqlite";
import { suppressExperimentalSqliteWarning } from "./suppress-experimental-sqlite-warning.js";

// Thin better-sqlite3-compatible wrapper over Node's built-in node:sqlite.
//
// Why this exists: opencode installs plugin packages WITHOUT running npm
// lifecycle scripts, so better-sqlite3's native binary (fetched/built by its
// `install` script) never lands and `require()` fails with "Could not locate
// the bindings file". node:sqlite ships inside Node itself, so it needs no
// native build step and survives a script-less install. This wrapper keeps the
// rest of the codebase (queries, repositories, fixtures, tests) on the
// better-sqlite3 surface it already uses, so only the connection layer changes.
//
// node:sqlite is loaded through a CJS require rather than a static ESM import on
// purpose: an ESM `import` of a builtin experimental module emits the
// ExperimentalWarning during module *linking*, before any of our code (incl. the
// warning filter) can run, so it is impossible to silence. require() defers the
// sole warning to first construction, which the filter installed at the entry
// point catches.
// Install the warning filter BEFORE node:sqlite is loaded or used, so the
// construction-time ExperimentalWarning is caught in every context (server,
// worker thread, tests, scripts) without depending on entry-point import order.
suppressExperimentalSqliteWarning();
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire(
  "node:sqlite",
) as typeof import("node:sqlite");

export interface DatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

// node:sqlite returns integer columns as plain numbers (and changes/rowid as
// number | bigint); the bind side accepts SQLInputValue. The callers in this
// repo pass strings/numbers positionally or a single named-parameters object,
// both of which node:sqlite's overloads accept — we cast at this boundary so
// the existing query code stays untouched.
//
// NOTE: unlike better-sqlite3 (which silently ignores them), node:sqlite THROWS
// if a named-parameters object carries a key with no matching `@param` in the
// SQL, or if any bound value is `undefined`. Keep `.run({...})` objects to
// exactly the columns the statement references, and use `null` (never
// `undefined`) for absent values.
function toBind(params: unknown[]): SQLInputValue[] {
  return params as SQLInputValue[];
}

export class Statement {
  constructor(private readonly stmt: StatementSync) {}

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...toBind(params));
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...toBind(params));
  }

  run(...params: unknown[]): RunResult {
    const result = this.stmt.run(...toBind(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }
}

export class Database {
  private readonly db: DatabaseSyncInstance;

  constructor(path: string, options: DatabaseOptions = {}) {
    if (options.fileMustExist && !fs.existsSync(path)) {
      throw new Error(`unable to open database file: ${path}`);
    }
    this.db = new DatabaseSync(path, {
      readOnly: options.readonly ?? false,
      // Match better-sqlite3/SQLite default (foreign keys OFF) so code that
      // relies on an explicit `PRAGMA foreign_keys = ON` keeps its behavior.
      enableForeignKeyConstraints: false,
    });
  }

  // Mirrors better-sqlite3's `.open` boolean so existing idempotent-close
  // call sites keep working.
  get open(): boolean {
    return this.db.isOpen;
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(source: string): unknown[] {
    return this.db.prepare(`PRAGMA ${source}`).all();
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): (...args: Args) => Result {
    return (...args: Args): Result => {
      this.db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
  }

  close(): void {
    // node:sqlite throws if close() runs on an already-closed handle, whereas
    // better-sqlite3 treats it as a no-op; preserve the lenient behavior.
    if (this.db.isOpen) {
      this.db.close();
    }
  }
}

export default Database;
