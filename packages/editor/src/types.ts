import type { SerializedLexicalNode } from "lexical";

interface File extends Blob {
  readonly lastModified: number;
  readonly name: string;
  readonly webkitRelativePath: string;
}

export interface NxEditorConfig {
  features?: NxEditorFeature[];
  onUploadImage?: (file: File) => Promise<{ url: string; alt: string }>;
  placeholder?: string;
  readOnly?: boolean;
}

export type NxEditorFeature =
  | "heading"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "codeBlock"
  | "link"
  | "image"
  | "list"
  | "quote"
  | "horizontalRule"
  | "table"
  | "alignment";

export const DEFAULT_FEATURES: NxEditorFeature[] = [
  "heading",
  "bold",
  "italic",
  "underline",
  "code",
  "codeBlock",
  "link",
  "image",
  "list",
  "quote",
  "horizontalRule",
  "alignment",
];

export interface NxRichTextContent {
  root: {
    type: "root";
    children: SerializedLexicalNode[];
    direction: "ltr" | "rtl" | null;
    format: string;
    indent: number;
    version: number;
  };
}
