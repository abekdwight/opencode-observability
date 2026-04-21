import { describe, expect, test } from "vitest";
import {
  buildMermaidInitConfig,
  getMermaidConfigCacheKey,
} from "../../web/lib/mermaid-config.js";

describe("mermaid config", () => {
  test("builds the readable preset with the ELK layout overrides", () => {
    expect(
      buildMermaidInitConfig({
        mode: "readable",
        resolvedTheme: "dark",
      }),
    ).toMatchObject({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "default",
      layout: "elk",
      elk: {
        mergeEdges: true,
        forceNodeModelOrder: true,
      },
    });
  });

  test("keeps auto mode aligned with the resolved application theme", () => {
    expect(
      buildMermaidInitConfig({
        mode: "auto",
        resolvedTheme: "dark",
      }),
    ).toMatchObject({
      theme: "dark",
    });

    expect(
      buildMermaidInitConfig({
        mode: "auto",
        resolvedTheme: "light",
      }),
    ).toMatchObject({
      theme: "default",
    });
  });

  test("changes the cache key when either mode or theme changes", () => {
    expect(
      getMermaidConfigCacheKey({
        mode: "readable",
        resolvedTheme: "dark",
      }),
    ).toBe("readable");
    expect(
      getMermaidConfigCacheKey({
        mode: "auto",
        resolvedTheme: "light",
      }),
    ).toBe("auto:light");
  });
});
