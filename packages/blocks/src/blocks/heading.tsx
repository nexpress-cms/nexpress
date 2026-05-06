import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const readLevel = (value: unknown): 1 | 2 | 3 => {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return 2;
};

/**
 * Heading atom block. Renders as `h1` / `h2` / `h3` per the
 * `level` prop. The in-page editor's Doc view picks the body
 * variant from `docBodyKind` — heading-1 keeps `"heading"`,
 * heading-2/3 carry their own kinds so the body picker can
 * render the right typographic treatment.
 */
export const headingBlock: NpBlockDefinition = {
  type: "heading",
  label: "Heading",
  description: "Section heading. Render level (h1 / h2 / h3) is configurable.",
  icon: "Heading1",
  iconKind: "lucide",
  docBodyKind: "heading",
  category: "Content",
  source: "built-in",
  keywords: ["heading", "title", "h1", "h2", "h3", "section"],
  summaryFields: ["text"],
  defaultProps: {
    text: "",
    level: 2,
  },
  propsSchema: [
    {
      name: "text",
      label: "Text",
      type: "text",
      defaultValue: "",
    },
    {
      name: "level",
      label: "Level",
      type: "select",
      defaultValue: 2,
      options: [
        { label: "H1", value: "1" },
        { label: "H2", value: "2" },
        { label: "H3", value: "3" },
      ],
    },
  ],
  render: (props) => {
    const text = readString(props.text, "");
    const level = readLevel(props.level);
    const Tag = (`h${level}` as "h1" | "h2" | "h3");
    return <Tag className={`np-heading np-heading-${level}`}>{text}</Tag>;
  },
};
