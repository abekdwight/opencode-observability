import { describe, expect, test } from "vitest";
import { calcModelTps } from "../../src/lib/model-tps.js";

describe("calcModelTps", () => {
  test("includes reasoning tokens in the numerator", () => {
    // Given 10 output + 30 reasoning over 500ms of generation
    // When TPS is computed
    // Then 40 tokens / 0.5s = 80
    expect(calcModelTps(10, 30, 500)).toBe(80);
  });

  test("counts reasoning-only turns", () => {
    expect(calcModelTps(0, 40, 500)).toBe(80);
  });

  test("returns null when there is no generation time", () => {
    expect(calcModelTps(10, 30, 0)).toBeNull();
  });

  test("returns null when no tokens were generated", () => {
    expect(calcModelTps(0, 0, 500)).toBeNull();
  });
});
