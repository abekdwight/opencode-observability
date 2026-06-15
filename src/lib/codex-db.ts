import { getCodexStateDbPath } from "./config.js";
import { Database } from "./sqlite.js";

export function getCodexDb(): Database {
  return new Database(getCodexStateDbPath(), {
    readonly: true,
    fileMustExist: false,
  });
}
