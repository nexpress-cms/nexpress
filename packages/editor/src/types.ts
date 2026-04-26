import type { SerializedLexicalNode } from "lexical";

export interface NxEditorConfig {
  features?: NxEditorFeature[];
  /**
   * Async upload callback. The toolbar's Insert Image dialog
   * (Phase 9.7j) calls this with the user-selected file and uses
   * the returned URL as the `ImageNode` src. `alt` is optional —
   * when omitted the dialog's alt-text input is the source of
   * truth (the user may want to override an auto-generated alt
   * anyway).
   */
  onUploadImage?: (file: File) => Promise<{ url: string; alt?: string }>;
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
