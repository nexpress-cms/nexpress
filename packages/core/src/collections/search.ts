import { type NxCollectionConfig, type NxRichTextContent } from "../config/types.js";

export function buildSearchVector(
  config: NxCollectionConfig,
  data: Record<string, unknown>,
): string {
  const parts: string[] = [];

  for (const field of config.fields) {
    if (field.type === "text" || field.type === "textarea") {
      const value = data[field.name];
      if (typeof value === "string") parts.push(value);
    }
    if (field.type === "richText") {
      const value = data[field.name];
      if (value) parts.push(extractPlainText(value as NxRichTextContent));
    }
  }

  return parts.join(" ");
}

function extractPlainText(content: NxRichTextContent): string {
  if (!content || typeof content !== "object") return "";

  const root = content.root as { children?: unknown[] } | undefined;
  if (!root?.children) return "";

  const parts: string[] = [];
  walkNodes(root.children, parts);
  return parts.join(" ");
}

function walkNodes(nodes: unknown[], parts: string[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;

    if (typeof n.text === "string") {
      parts.push(n.text);
    }

    if (Array.isArray(n.children)) {
      walkNodes(n.children, parts);
    }
  }
}
