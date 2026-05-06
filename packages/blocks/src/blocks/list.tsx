import type { NpBlockDefinition } from "../types.js";

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [""];
  return value.filter((v): v is string => typeof v === "string");
};

/**
 * Bulleted / numbered list atom block. Each entry is a plain
 * string. The in-page editor's Doc view edits items line-by-line
 * with Enter inserting a new entry, Backspace at empty merging
 * back into the previous one.
 */
export const listBlock: NpBlockDefinition = {
  type: "list",
  label: "List",
  description: "Bulleted or numbered list of plain-text items.",
  icon: "List",
  iconKind: "lucide",
  docBodyKind: "list",
  category: "Content",
  source: "built-in",
  keywords: ["list", "bullet", "ordered", "numbered", "ul", "ol"],
  defaultProps: {
    items: [""],
    ordered: false,
  },
  // Wire format: `items: string[]`. Page builder edits only the
  // `ordered` toggle — list items themselves are Doc-view-only.
  // The `array` field type stores `{ text: string }[]`, which
  // would round-trip incorrectly against the runtime renderer; we
  // surface the count via `summaryFields` instead and let
  // operators flip to Doc view to edit the entries.
  propsSchema: [
    {
      name: "ordered",
      label: "Ordered (numbered)",
      type: "boolean",
      defaultValue: false,
    },
  ],
  render: (props) => {
    const items = readStringArray(props.items);
    const ordered = props.ordered === true;
    const Tag = ordered ? "ol" : "ul";
    return (
      <Tag className={`np-list np-list-${ordered ? "ordered" : "bullet"}`}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </Tag>
    );
  },
};
