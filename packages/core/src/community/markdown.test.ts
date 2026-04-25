import { describe, expect, it } from "vitest";

import { renderCommentMarkdown } from "./markdown.js";

describe("renderCommentMarkdown", () => {
  it("escapes raw HTML so injected markup can't reach the DOM", () => {
    const html = renderCommentMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders bold, italic, and inline code", () => {
    expect(renderCommentMarkdown("**hi**")).toContain("<strong>hi</strong>");
    expect(renderCommentMarkdown("*emp*")).toContain("<em>emp</em>");
    expect(renderCommentMarkdown("`x`")).toContain("<code>x</code>");
  });

  it("renders fenced code blocks with escaped content", () => {
    const html = renderCommentMarkdown("```\n<div>raw</div>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("&lt;div&gt;raw&lt;/div&gt;");
    // Code block content must not be additionally inline-formatted.
    expect(html).not.toContain("<em>");
  });

  it("renders allow-listed links and refuses other URL schemes", () => {
    const ok = renderCommentMarkdown("see [docs](https://example.com)");
    expect(ok).toContain('<a href="https://example.com"');
    expect(ok).toContain('rel="nofollow ugc"');

    const javascript = renderCommentMarkdown("[bad](javascript:alert(1))");
    expect(javascript).not.toContain("<a ");
    // Falls back to literal text — escape was applied on the way in.
    expect(javascript).toContain("[bad](javascript:alert(1))");
  });

  it("splits paragraphs on blank lines and converts single \\n to <br/>", () => {
    const html = renderCommentMarkdown("first line\nsecond line\n\nnext para");
    expect(html).toContain("<p>first line<br/>second line</p>");
    expect(html).toContain("<p>next para</p>");
  });

  it("treats `*` adjacent to whitespace as literal (CommonMark-ish)", () => {
    const html = renderCommentMarkdown("* not italic *");
    // Should remain the literal asterisks (escaped by HTML escape if any).
    expect(html).toContain("* not italic *");
    expect(html).not.toContain("<em>");
  });

  it("leaves an empty input as an empty string", () => {
    expect(renderCommentMarkdown("")).toBe("");
  });
});
