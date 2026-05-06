import { renderRichText } from "@nexpress/editor/server";

import type { NpBlockDefinition } from "../types.js";

type RichTextContent = Parameters<typeof renderRichText>[0];

const isRichTextContent = (value: unknown): value is RichTextContent =>
  typeof value === "object" && value !== null;

export const richTextBlock: NpBlockDefinition = {
  type: "rich-text",
  label: "Rich Text",
  description: "Server-rendered Lexical content for long-form text, lists, and formatting.",
  icon: "FileText",
  iconKind: "lucide",
  docBodyKind: "rich-text",
  category: "Content",
  source: "built-in",
  keywords: ["text", "paragraph", "body", "long-form", "article"],
  defaultProps: {
    content: {
      root: {
        children: [
          {
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
                text: "Start writing rich content here.",
              },
            ],
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    },
  },
  propsSchema: [
    {
      name: "content",
      label: "Content",
      type: "richtext",
      defaultValue: {
        root: {
          children: [
            {
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
                  text: "Start writing rich content here.",
                },
              ],
            },
          ],
          direction: null,
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      },
    },
  ],
  render: (props) => {
    const content = props.content;

    return (
      <section className="np-block-rich-text" style={{ padding: "3rem 1.5rem", background: "#ffffff" }}>
        <div style={{ maxWidth: "48rem", margin: "0 auto", lineHeight: 1.8, color: "#1f2937" }}>
          {isRichTextContent(content) ? renderRichText(content) : null}
        </div>
      </section>
    );
  },
};
