import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import path from 'node:path';

const dbPath = path.join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

export function getDb(): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}
