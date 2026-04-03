import { describe, expect, test } from "vitest";
import { renderSafeDiff, renderSafeMarkdown } from "../src/lib/rendering.js";

describe("safe rendering", () => {
  test("escapes hostile markdown html while preserving markdown structure", () => {
    const html = renderSafeMarkdown(
      "# Header\n<script>alert('xss')</script>\n\n**bold**",
    );

    expect(html).toContain("<h1>Header</h1>");
    expect(html).toContain("<strong>bold</strong>");
    // Script tags are stripped entirely by sanitizer
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert('xss')");
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

  test("renders gfm markdown tables as HTML table elements", () => {
    const html = renderSafeMarkdown(
      "| Col A | Col B |\n| --- | --- |\n| one | two |",
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<th>Col A</th>");
    expect(html).toContain("<td>one</td>");
  });
});
