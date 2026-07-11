import type { NpBlockInstance } from "@nexpress/blocks";
import { isNpRichTextContent } from "@nexpress/core/fields";

const TEXT_PROP_NAMES = ["text", "heading", "title", "label", "code", "caption"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countWordsInText(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) return 0;
  return normalized.split(/\s+/).filter(Boolean).length;
}

function collectLexicalText(value: unknown): string[] {
  if (isNpRichTextContent(value)) {
    return collectLexicalText(value.document.root);
  }
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectLexicalText(item));
  if (!isRecord(value)) return [];

  const out: string[] = [];
  const text = value.text;
  if (typeof text === "string") out.push(text);

  const children = value.children;
  if (Array.isArray(children)) {
    out.push(...children.flatMap((child) => collectLexicalText(child)));
  }

  return out;
}

function collectBlockText(block: NpBlockInstance): string[] {
  const out: string[] = [];

  for (const name of TEXT_PROP_NAMES) {
    const value = block.props[name];
    if (typeof value === "string") out.push(value);
  }

  const items = block.props.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item === "string") out.push(item);
    }
  }

  out.push(...collectLexicalText(block.props.content));

  if (block.children) {
    for (const child of block.children) {
      out.push(...collectBlockText(child));
    }
  }

  return out;
}

export function countBlockTreeWords(blocks: readonly NpBlockInstance[]): number {
  const text = blocks.flatMap((block) => collectBlockText(block)).join(" ");
  return countWordsInText(text);
}

export function estimateReadingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 220));
}
