export interface RichTextNode {
  type?: string;
  children?: RichTextNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  url?: string;
  src?: string;
  altText?: string;
  direction?: "ltr" | "rtl" | null;
}

export function richTextChildren(value: unknown): RichTextNode[] {
  return Array.isArray(value)
    ? value.filter((node): node is RichTextNode => typeof node === "object" && node !== null)
    : [];
}

export function richTextNodeText(node: RichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "linebreak") return "\n";
  return richTextChildren(node.children).map(richTextNodeText).join("");
}
