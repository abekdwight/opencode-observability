import Database from "better-sqlite3";
import { getCodexStateDbPath } from "./config.js";

export function getCodexDb(): Database.Database {
  return new Database(getCodexStateDbPath(), {
    readonly: true,
    fileMustExist: false,
  });
}
