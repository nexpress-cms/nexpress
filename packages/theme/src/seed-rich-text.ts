import type { NpRichTextContent } from "@nexpress/core/fields";

/** Build seed prose without loading the editor runtime. */
export function npCreateSeedRichText(paragraphs: readonly string[]): NpRichTextContent {
  return {
    version: 1,
    document: {
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: paragraphs.map((text) => ({
          type: "paragraph",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              version: 1,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
            },
          ],
        })),
      },
    },
  };
}
