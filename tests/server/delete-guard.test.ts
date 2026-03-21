import { describe, expect, test } from "vitest";
import { requireDeleteConfirmation } from "../../src/server/delete-guard.js";

describe("delete guard", () => {
  test("rejects destructive action without matching confirmation", () => {
    expect(requireDeleteConfirmation("ses-root-1", undefined)).toBe(false);
    expect(requireDeleteConfirmation("ses-root-1", "wrong-id")).toBe(false);
  });

  test("accepts destructive action only when confirmation matches", () => {
    expect(requireDeleteConfirmation("ses-root-1", "ses-root-1")).toBe(true);
  });
});
