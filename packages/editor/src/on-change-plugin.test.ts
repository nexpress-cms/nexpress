import { describe, expect, it } from "vitest";

import { createRichTextContent } from "./on-change-plugin.js";

describe("createRichTextContent", () => {
  it("normalizes editor JSON before enforcing the exact wire contract", () => {
    const content = createRichTextContent({
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [],
        textFormat: undefined,
      },
    });

    expect(content).toEqual({
      version: 1,
      document: {
        root: {
          type: "root",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [],
        },
      },
    });
  });

  it("still rejects malformed normalized editor JSON", () => {
    expect(() => createRichTextContent({ root: { type: "root" } })).toThrow(
      "Lexical emitted invalid NexPress rich-text content",
    );
  });
});
