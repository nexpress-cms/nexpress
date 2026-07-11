import * as React from "react";
import type { NpBlockDefinition } from "@nexpress/blocks";

import { CopyButton } from "../copy-button-bridge.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CALLOUT_VARIANTS = ["default", "note", "warn", "danger"] as const;
type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

function readCalloutVariant(value: unknown): CalloutVariant {
  if (typeof value === "string") {
    for (const candidate of CALLOUT_VARIANTS) {
      if (candidate === value) return candidate;
    }
  }
  return "default";
}

function CalloutIcon({ variant }: { variant: CalloutVariant }): React.ReactElement {
  if (variant === "warn") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (variant === "danger") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

const docsCalloutBlock: NpBlockDefinition = {
  type: "docsCallout",
  label: "Callout",
  description: "Highlighted note / warning / danger panel with a leading icon.",
  icon: "Info",
  iconKind: "lucide",
  summaryFields: ["title"],
  category: "Content",
  source: "theme",
  keywords: ["note", "warning", "danger", "admonition", "info"],
  defaultProps: {
    variant: "default",
    title: "Heads up",
    body: "Add context that an operator should not miss when scanning the page.",
  },
  propsSchema: [
    {
      name: "variant",
      label: "Variant",
      type: "select",
      defaultValue: "default",
      options: [
        { label: "Default", value: "default" },
        { label: "Note", value: "note" },
        { label: "Warning", value: "warn" },
        { label: "Danger", value: "danger" },
      ],
    },
    {
      name: "title",
      label: "Title",
      type: "text",
      translatable: true,
      defaultValue: "Heads up",
    },
    {
      name: "body",
      label: "Body",
      type: "textarea",
      translatable: true,
      defaultValue: "Add context that an operator should not miss when scanning the page.",
    },
  ],
  render: (props) => {
    const variant = readCalloutVariant(props.variant);
    const title = readString(props.title, "Heads up");
    const body = readString(props.body, "");
    return (
      <aside className={`np-docs-callout np-docs-callout--${variant}`}>
        <CalloutIcon variant={variant} />
        <div>
          <div className="np-docs-callout-title">{title}</div>
          {body ? <p>{body}</p> : null}
        </div>
      </aside>
    );
  },
};

const docsCodePanelBlock: NpBlockDefinition = {
  type: "docsCodePanel",
  label: "Code panel",
  description: "Dark code surface with filename, language pill, and copy button.",
  icon: "Code2",
  iconKind: "lucide",
  summaryFields: ["filename", "language"],
  category: "Content",
  source: "theme",
  keywords: ["code", "snippet", "syntax", "block"],
  defaultProps: {
    filename: "example.ts",
    language: "ts",
    source: 'export const greeting = "hello";',
  },
  propsSchema: [
    {
      name: "filename",
      label: "Filename",
      type: "text",
      translatable: false,
      defaultValue: "example.ts",
    },
    {
      name: "language",
      label: "Language",
      type: "text",
      translatable: false,
      defaultValue: "ts",
    },
    {
      name: "source",
      label: "Source",
      type: "textarea",
      translatable: false,
      rows: 10,
      defaultValue: 'export const greeting = "hello";',
    },
  ],
  render: (props) => {
    const filename = readString(props.filename, "");
    const language = readString(props.language, "");
    const source = readString(props.source, "");
    return (
      <div className="np-docs-code">
        <div className="np-docs-code-head">
          <span className="np-docs-code-file">
            {filename ? <span>{filename}</span> : null}
            {language ? <span className="np-docs-brand-version">{language}</span> : null}
          </span>
          <CopyButton text={source} />
        </div>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  },
};

const docsShellCommandBlock: NpBlockDefinition = {
  type: "docsShellCommand",
  label: "Shell command",
  description: "Inline terminal-style command snippet with a copy button.",
  icon: "Terminal",
  iconKind: "lucide",
  summaryFields: ["command"],
  category: "Content",
  source: "theme",
  keywords: ["terminal", "shell", "bash", "command", "cli"],
  defaultProps: {
    prompt: "$",
    command: "pnpm install",
  },
  propsSchema: [
    {
      name: "prompt",
      label: "Prompt",
      type: "text",
      translatable: false,
      defaultValue: "$",
    },
    {
      name: "command",
      label: "Command",
      type: "text",
      translatable: false,
      defaultValue: "pnpm install",
    },
  ],
  render: (props) => {
    const prompt = readString(props.prompt, "$");
    const command = readString(props.command, "");
    return (
      <div className="np-docs-cmdline">
        <span className="np-docs-cmdline-prompt">{prompt}</span>
        <code className="np-docs-cmdline-cmd">{command}</code>
        <CopyButton text={command} className="np-docs-cmdline-copy" />
      </div>
    );
  },
};

interface StepItem {
  title: string;
  body: string;
}

function readSteps(value: unknown): StepItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    title: readString(item.title, "Step"),
    body: readString(item.body, ""),
  }));
}

const docsStepsBlock: NpBlockDefinition = {
  type: "docsSteps",
  label: "Steps",
  description: "Numbered checklist of ordered steps.",
  icon: "ListOrdered",
  iconKind: "lucide",
  category: "Content",
  source: "theme",
  keywords: ["steps", "checklist", "ordered", "numbered", "tutorial"],
  defaultProps: {
    items: [
      { title: "Install", body: "Add the package to your workspace." },
      { title: "Configure", body: "Wire it into the bootstrap." },
      { title: "Run", body: "Boot the dev server and verify." },
    ],
  },
  propsSchema: [
    {
      name: "items",
      label: "Steps",
      type: "array",
      defaultValue: [
        { title: "Install", body: "Add the package to your workspace." },
        { title: "Configure", body: "Wire it into the bootstrap." },
        { title: "Run", body: "Boot the dev server and verify." },
      ],
      itemDefault: { title: "New step", body: "" },
      itemSchema: [
        {
          name: "title",
          label: "Title",
          type: "text",
          translatable: true,
          defaultValue: "New step",
        },
        {
          name: "body",
          label: "Body",
          type: "textarea",
          translatable: true,
          defaultValue: "",
        },
      ],
    },
  ],
  render: (props) => {
    const items = readSteps(props.items);
    if (items.length === 0) return <ol className="np-docs-steps" />;
    return (
      <ol className="np-docs-steps">
        {items.map((step, index) => (
          <li key={`step-${index.toString()}`}>
            <div className="np-docs-step-title">{step.title}</div>
            {step.body ? <p className="np-docs-step-body">{step.body}</p> : null}
          </li>
        ))}
      </ol>
    );
  },
};

interface ApiRow {
  cells: string[];
  required: boolean;
}

const docsApiTableBlock: NpBlockDefinition = {
  type: "docsApiTable",
  label: "API table",
  description: "Reference table with uppercase mono headers and a required pill.",
  icon: "Table",
  iconKind: "lucide",
  category: "Content",
  source: "theme",
  keywords: ["api", "reference", "table", "schema", "props"],
  defaultProps: {
    columns: ["Name", "Type", "Description"],
    rows: [
      { cells: ["slug", "string", "Unique URL fragment."], required: true },
      { cells: ["title", "string", "Document title."], required: true },
      { cells: ["body", "RichText", "Lexical body content."], required: false },
    ],
  },
  propsSchema: [
    {
      name: "columns",
      label: "Columns",
      type: "array",
      defaultValue: ["Name", "Type", "Description"],
      itemDefault: { value: "Column" },
      itemSchema: [
        {
          name: "value",
          label: "Header",
          type: "text",
          translatable: true,
          defaultValue: "Column",
        },
      ],
    },
    {
      name: "rows",
      label: "Rows",
      type: "array",
      defaultValue: [{ cells: ["slug", "string", "Unique URL fragment."], required: true }],
      itemDefault: { cells: [], required: false },
      itemSchema: [
        {
          name: "cells",
          label: "Cells",
          type: "array",
          defaultValue: [],
          itemDefault: { value: "" },
          itemSchema: [
            {
              name: "value",
              label: "Cell",
              type: "text",
              translatable: true,
              defaultValue: "",
            },
          ],
        },
        {
          name: "required",
          label: "Required",
          type: "boolean",
          defaultValue: false,
        },
      ],
    },
  ],
  render: (props) => {
    // The propsSchema `array.itemSchema` UI nests cell objects with a
    // `{ value }` shape; runtime / seed data ships flat string arrays.
    // Normalise both shapes back to `string[]` so the seeded fixtures
    // and the admin-authored data render identically.
    const rawColumns: unknown = props.columns;
    const columns = Array.isArray(rawColumns)
      ? rawColumns.map((entry) => {
          if (typeof entry === "string") return entry;
          if (isRecord(entry) && typeof entry.value === "string") return entry.value;
          return "";
        })
      : [];
    const rawRows = Array.isArray(props.rows) ? props.rows : [];
    const rows: ApiRow[] = rawRows.filter(isRecord).map((row) => {
      const cellsRaw: unknown = row.cells;
      const cells = Array.isArray(cellsRaw)
        ? cellsRaw.map((entry) => {
            if (typeof entry === "string") return entry;
            if (isRecord(entry) && typeof entry.value === "string") return entry.value;
            return "";
          })
        : [];
      return { cells, required: row.required === true };
    });
    if (columns.length === 0 && rows.length === 0) {
      return <table className="np-docs-table" />;
    }
    return (
      <table className="np-docs-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={`col-${i.toString()}`}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`row-${i.toString()}`}>
              {row.cells.map((cell, j) => {
                const isFirst = j === 0;
                return (
                  <td key={`cell-${i.toString()}-${j.toString()}`}>
                    {isFirst ? <code>{cell}</code> : cell}
                    {isFirst && row.required ? (
                      <span className="np-docs-table-required">required</span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
};

export const docsBlocks: NpBlockDefinition[] = [
  docsCalloutBlock,
  docsCodePanelBlock,
  docsShellCommandBlock,
  docsStepsBlock,
  docsApiTableBlock,
];

void (0 as React.ReactNode | undefined);
