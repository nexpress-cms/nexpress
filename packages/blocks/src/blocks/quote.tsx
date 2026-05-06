import { renderInlineMarks } from "../inline-marks.js";
import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/**
 * Pull-quote / citation atom block. The optional `cite` prop
 * surfaces beneath the quote text as the attribution line.
 */
export const quoteBlock: NpBlockDefinition = {
  type: "quote",
  label: "Quote",
  description: "Pull-quote with optional attribution.",
  icon: "Quote",
  iconKind: "lucide",
  docBodyKind: "quote",
  category: "Content",
  source: "built-in",
  keywords: ["quote", "blockquote", "citation", "pull quote"],
  summaryFields: ["text"],
  defaultProps: {
    text: "",
    cite: "",
  },
  propsSchema: [
    {
      name: "text",
      label: "Quote",
      type: "textarea",
      defaultValue: "",
    },
    {
      name: "cite",
      label: "Attribution",
      type: "text",
      defaultValue: "",
    },
  ],
  render: (props) => {
    const text = readString(props.text, "");
    const cite = readString(props.cite, "");
    return (
      <blockquote className="np-quote">
        <p>{renderInlineMarks(text)}</p>
        {cite ? <cite className="np-quote-cite">— {cite}</cite> : null}
      </blockquote>
    );
  },
};
