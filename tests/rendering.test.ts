import { describe, expect, test } from "vitest";
import { renderSafeDiff, renderSafeMarkdown } from "../src/lib/rendering.js";

describe("safe rendering", () => {
  test("escapes hostile markdown html while preserving markdown structure", () => {
    const html = renderSafeMarkdown(
      "# Header\n<script>alert('xss')</script>\n\n**bold**",
    );

    expect(html).toContain("<h1>Header</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).not.toContain("<script>");
  });

  test("escapes hostile diff content", () => {
    const html = renderSafeDiff("<img src=x onerror=alert(1)>");

    expect(html).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("rewrites unsafe markdown href schemes", () => {
    const html = renderSafeMarkdown("[x](javascript:alert(1))");

    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:alert");
  });
});
