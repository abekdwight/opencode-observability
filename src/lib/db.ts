import Database from "better-sqlite3";
import { getOpenCodeDbPath } from "./config.js";

export function getDb(): Database.Database {
  return new Database(getOpenCodeDbPath(), {
    readonly: true,
    fileMustExist: true,
  });
}

export function getWritableDb(): Database.Database {
  return new Database(getOpenCodeDbPath(), {
    readonly: false,
    fileMustExist: true,
  });
}
