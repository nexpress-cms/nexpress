import { describe, expect, it } from "vitest";

import {
  NP_RICH_TEXT_CONTENT_VERSION,
  isNpRichTextContent,
  npCreateEmptyRichTextContent,
  npValidateRichTextContent,
} from "./rich-text.js";

describe("NexPress rich-text v1 contract", () => {
  it("creates a valid empty document", () => {
    const value = npCreateEmptyRichTextContent();

    expect(value.version).toBe(NP_RICH_TEXT_CONTENT_VERSION);
    expect(value.document.root.children[0]?.type).toBe("paragraph");
    expect(isNpRichTextContent(value)).toBe(true);
  });

  it("accepts extensible serialized nodes inside the stable envelope", () => {
    const value = npCreateEmptyRichTextContent();
    value.document.root.children = [
      {
        type: "image",
        version: 1,
        src: "/hero.jpg",
        altText: "Hero",
      },
    ];

    expect(npValidateRichTextContent(value)).toEqual({ ok: true, value });
  });

  it.each([
    [{ root: { children: [] } }, 'exactly "version" and "document"'],
    [{ version: 2, document: { root: {} } }, "version must be 1"],
    [{ ...npCreateEmptyRichTextContent(), extra: true }, 'exactly "version" and "document"'],
    [
      {
        version: 1,
        document: {
          root: {
            type: "root",
            children: [{ type: "paragraph", version: 1, children: "nope" }],
            direction: null,
            format: "",
            indent: 0,
            version: 1,
          },
        },
      },
      "children must be an array",
    ],
  ])("rejects malformed content %#", (value, message) => {
    const result = npValidateRichTextContent(value);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  it("rejects circular node properties instead of recursing forever", () => {
    const value = npCreateEmptyRichTextContent();
    const node = value.document.root.children[0];
    if (!node) throw new Error("empty document must contain a paragraph");
    node.circular = node;

    const result = npValidateRichTextContent(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("circular references");
  });
});
