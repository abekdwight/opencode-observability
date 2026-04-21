import { describe, expect, test } from "vitest";
import {
  EXPORT_FORBIDDEN_FIELDS,
  EXPORT_PART_TYPES,
  findForbiddenFieldPaths,
  isExportPartType,
} from "../../src/contracts/export.js";

describe("export contract helpers", () => {
  test("allowlists supported export part types", () => {
    expect(EXPORT_PART_TYPES).toEqual([
      "text",
      "tool",
      "reasoning",
      "attachment_ref",
      "system_meta",
    ]);
    expect(isExportPartType("tool")).toBe(true);
    expect(isExportPartType("unknown")).toBe(false);
  });

  test("finds forbidden fields recursively in nested payloads", () => {
    const paths = findForbiddenFieldPaths({
      tool: {
        output: {
          nested: {
            retrievalScore: 0.91,
            embeddingId: "emb-1",
          },
        },
      },
    });

    expect(paths).toEqual([
      "$.tool.output.nested.retrievalScore",
      "$.tool.output.nested.embeddingId",
    ]);
  });

  test("does not report safe nested payloads", () => {
    const paths = findForbiddenFieldPaths({
      tool: {
        output: {
          ok: true,
          bytes: 128,
        },
      },
    });

    expect(paths).toEqual([]);
  });

  test("forbidden field list includes key downstream-derived markers", () => {
    expect(EXPORT_FORBIDDEN_FIELDS).toContain("retrievalScore");
    expect(EXPORT_FORBIDDEN_FIELDS).toContain("embeddingId");
    expect(EXPORT_FORBIDDEN_FIELDS).toContain("memoryThreadId");
  });
});
