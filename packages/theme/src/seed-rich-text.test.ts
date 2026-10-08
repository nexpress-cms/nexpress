import { describe, expect, it } from "vitest";
import { npValidateRichTextContent } from "@nexpress/core/fields";

import { npCreateSeedRichText } from "./seed-rich-text.js";

describe("theme seed prose", () => {
  it("preserves paragraph order and literal text in the canonical rich-text envelope", () => {
    const paragraphs = ["첫 문단 🌿", "", "<b>Plain text</b>\nSecond line"];
    const content = npCreateSeedRichText(paragraphs);

    expect(npValidateRichTextContent(content).ok).toBe(true);
    expect(content.document.root.children.map((node) => node.children?.[0]?.text)).toEqual(
      paragraphs,
    );
    expect(npValidateRichTextContent(npCreateSeedRichText([])).ok).toBe(true);
  });

  it("does not share mutable nodes between paragraphs or calls", () => {
    const content = npCreateSeedRichText(["First", "Second"]);
    const children = content.document.root.children[0].children;
    if (!children) throw new Error("Expected a paragraph with text.");
    children[0].text = "Edited";

    expect(content.document.root.children[1]?.children?.[0]?.text).toBe("Second");
    expect(npCreateSeedRichText(["First"]).document.root.children[0]?.children?.[0]?.text).toBe(
      "First",
    );
  });
});
