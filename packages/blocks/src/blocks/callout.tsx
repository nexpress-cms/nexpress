import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const TONES = ["info", "warning", "success"] as const;
type Tone = (typeof TONES)[number];

const readTone = (value: unknown): Tone => {
  if (typeof value === "string" && TONES.includes(value as Tone)) {
    return value as Tone;
  }
  return "info";
};

/**
 * Highlighted note / aside. The `tone` prop drives the colored
 * frame: info (default), warning, success.
 */
export const calloutBlock: NpBlockDefinition = {
  type: "callout",
  label: "Callout",
  description: "Highlighted aside for tips, warnings, or confirmations.",
  icon: "Lightbulb",
  iconKind: "lucide",
  docBodyKind: "callout",
  category: "Content",
  source: "built-in",
  keywords: ["callout", "note", "aside", "info", "warning"],
  summaryFields: ["text"],
  defaultProps: {
    text: "",
    tone: "info",
  },
  propsSchema: [
    {
      name: "tone",
      label: "Tone",
      type: "select",
      defaultValue: "info",
      options: [
        { label: "Info", value: "info" },
        { label: "Warning", value: "warning" },
        { label: "Success", value: "success" },
      ],
    },
    {
      name: "text",
      label: "Text",
      type: "textarea",
      defaultValue: "",
    },
  ],
  render: (props) => {
    const text = readString(props.text, "");
    const tone = readTone(props.tone);
    return (
      <aside className={`np-callout np-callout-${tone}`} data-tone={tone}>
        <p>{text}</p>
      </aside>
    );
  },
};
