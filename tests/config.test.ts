import { describe, expect, it } from "vitest";
import { getOpenCodeDbPath, getPort } from "../src/lib/config.js";

describe("config", () => {
  it("uses localhost-safe defaults when env vars are absent", () => {
    delete process.env.PORT;
    delete process.env.OPENCODE_DB_PATH;

    expect(getPort()).toBe(3737);
    expect(getOpenCodeDbPath()).toContain("opencode.db");
  });

  it("accepts explicit environment overrides", () => {
    process.env.PORT = "4000";
    process.env.OPENCODE_DB_PATH = "/tmp/opencode-test.db";

    expect(getPort()).toBe(4000);
    expect(getOpenCodeDbPath()).toBe("/tmp/opencode-test.db");
  });
});
