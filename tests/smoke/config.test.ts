import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { getOpenCodeDbPath, getPort } from "../../src/lib/config.js";

describe("config defaults", () => {
  test("uses the documented default port", () => {
    expect(getPort()).toBe(3737);
  });

  test("uses the documented default db path", () => {
    const env = process.env.OPENCODE_DB_PATH;
    delete process.env.OPENCODE_DB_PATH;

    expect(getOpenCodeDbPath()).toBe(
      path.join(homedir(), ".local", "share", "opencode", "opencode.db"),
    );

    process.env.OPENCODE_DB_PATH = env;
  });

  test("prefers OPENCODE_DB_PATH when provided", () => {
    process.env.OPENCODE_DB_PATH = "/tmp/opencode.db";
    expect(getOpenCodeDbPath()).toBe("/tmp/opencode.db");
    delete process.env.OPENCODE_DB_PATH;
  });
});
