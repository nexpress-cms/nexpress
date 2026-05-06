import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/**
 * Single-paragraph atom block. Stores plain text — the in-page
 * editor's Doc view edits this through an auto-grow textarea.
 * For long-form prose with inline marks (bold, italic, links),
 * use the `rich-text` block instead.
 */
export const paragraphBlock: NpBlockDefinition = {
  type: "paragraph",
  label: "Paragraph",
  description: "Plain-text paragraph. Use for body prose without inline marks.",
  icon: "Pilcrow",
  iconKind: "lucide",
  docBodyKind: "paragraph",
  category: "Content",
  source: "built-in",
  keywords: ["paragraph", "text", "body", "prose"],
  summaryFields: ["text"],
  defaultProps: {
    text: "",
  },
  propsSchema: [
    {
      name: "text",
      label: "Text",
      type: "textarea",
      defaultValue: "",
    },
  ],
  render: (props) => {
    const text = readString(props.text, "");
    if (!text) return <p className="np-paragraph-empty" aria-hidden="true" />;
    return <p className="np-paragraph">{text}</p>;
  },
};
