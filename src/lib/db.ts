import { getOpenCodeDbPath } from "./config.js";
import { Database } from "./sqlite.js";

export function getDb(): Database {
  return new Database(getOpenCodeDbPath(), {
    readonly: true,
    fileMustExist: true,
  });
}

export function getWritableDb(): Database {
  return new Database(getOpenCodeDbPath(), {
    readonly: false,
    fileMustExist: true,
  });
}
