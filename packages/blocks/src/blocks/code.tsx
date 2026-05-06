import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/**
 * Fenced code block. Stores the snippet plus an optional
 * `language` hint used for syntax-highlighting at render time
 * (the runtime renderer can hand the language to the host's
 * highlighter — the editor itself just shows it as monospace
 * text in the Doc view).
 */
export const codeBlock: NpBlockDefinition = {
  type: "code",
  label: "Code",
  description: "Fenced code snippet with optional language tag.",
  icon: "Code",
  iconKind: "lucide",
  docBodyKind: "code",
  category: "Content",
  source: "built-in",
  keywords: ["code", "snippet", "pre", "monospace", "fenced"],
  summaryFields: ["language", "code"],
  defaultProps: {
    code: "",
    language: "ts",
  },
  propsSchema: [
    {
      name: "language",
      label: "Language",
      type: "select",
      defaultValue: "ts",
      options: [
        { label: "TypeScript", value: "ts" },
        { label: "JavaScript", value: "js" },
        { label: "TSX", value: "tsx" },
        { label: "JSON", value: "json" },
        { label: "Bash", value: "bash" },
        { label: "SQL", value: "sql" },
        { label: "Plain text", value: "text" },
      ],
    },
    {
      name: "code",
      label: "Code",
      type: "textarea",
      rows: 8,
      defaultValue: "",
    },
  ],
  render: (props) => {
    const code = readString(props.code, "");
    const language = readString(props.language, "text");
    return (
      <pre className={`np-code np-code-${language}`}>
        <code data-language={language}>{code}</code>
      </pre>
    );
  },
};
