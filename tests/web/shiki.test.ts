import { describe, expect, test } from "vitest";
import { isMermaidLanguage, normalizeLanguage } from "../../web/lib/shiki.js";

describe("normalizeLanguage", () => {
  describe("fallback to text", () => {
    test("returns text for null", () => {
      expect(normalizeLanguage(null)).toBe("text");
    });

    test("returns text for undefined", () => {
      expect(normalizeLanguage(undefined)).toBe("text");
    });

    test("returns text for empty string", () => {
      expect(normalizeLanguage("")).toBe("text");
    });
  });

  describe("alias resolution", () => {
    test.each([
      ["ts", "typescript"],
      ["js", "javascript"],
      ["jsx", "jsx"],
      ["py", "python"],
      ["rb", "ruby"],
      ["sh", "bash"],
      ["zsh", "bash"],
      ["yml", "yaml"],
      ["md", "markdown"],
    ])("resolves '%s' to '%s'", (input, expected) => {
      expect(normalizeLanguage(input)).toBe(expected);
    });

    test.each([
      ["text", "text"],
      ["plain", "text"],
      ["txt", "text"],
    ])("resolves '%s' to 'text'", (input) => {
      expect(normalizeLanguage(input)).toBe("text");
    });

    test("resolves mermaid to mermaid", () => {
      expect(normalizeLanguage("mermaid")).toBe("mermaid");
    });
  });

  describe("supported language passthrough", () => {
    const supported = [
      "typescript",
      "tsx",
      "javascript",
      "jsx",
      "python",
      "rust",
      "go",
      "php",
      "ruby",
      "json",
      "css",
      "html",
      "bash",
      "yaml",
      "markdown",
      "sql",
      "diff",
      "text",
      "mermaid",
    ];

    test.each(supported)("passes through '%s' unchanged", (lang) => {
      expect(normalizeLanguage(lang)).toBe(lang);
    });
  });

  describe("unknown language fallback", () => {
    test.each([
      "coffeescript",
      "kotlin",
      "java",
      "unknown",
      "foobar",
    ])("falls back to text for '%s'", (lang) => {
      expect(normalizeLanguage(lang)).toBe("text");
    });
  });

  describe("case insensitivity", () => {
    test.each([
      ["TypeScript", "typescript"],
      ["TYPESCRIPT", "typescript"],
      ["Python", "python"],
      ["JS", "javascript"],
      ["Py", "python"],
      ["TS", "typescript"],
      ["Md", "markdown"],
      ["TXT", "text"],
      ["MERMAID", "mermaid"],
      ["Coffeescript", "text"],
    ])("normalizes '%s' to '%s'", (input, expected) => {
      expect(normalizeLanguage(input)).toBe(expected);
    });
  });
});

describe("isMermaidLanguage", () => {
  test("returns true for 'mermaid'", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true);
  });

  test("returns false for null", () => {
    expect(isMermaidLanguage(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isMermaidLanguage(undefined)).toBe(false);
  });

  test.each([
    "typescript",
    "javascript",
    "python",
    "ts",
    "js",
    "text",
    "plain",
    "markdown",
    "yaml",
    "bash",
    "Mermaid",
    "MERMAID",
    "",
    "unknown",
  ])("returns false for '%s'", (lang) => {
    expect(isMermaidLanguage(lang)).toBe(false);
  });
});
