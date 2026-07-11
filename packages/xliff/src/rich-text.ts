import type { XliffInlinePart } from "./format.js";

export const NP_XLIFF_LEXICAL_CTYPE = "x-nexpress-lexical";
export const NP_XLIFF_BREAK_CTYPE = "lb";

interface RichTextLeaf {
  id: string;
  path: number[];
  text: string;
  blockKey: string;
}

interface RichTextAnalysis {
  parts: XliffInlinePart[];
  pathById: Map<string, number[]>;
}

export interface RichTextXliffValue {
  source: string;
  target: string;
  sourceInline: XliffInlinePart[];
  targetInline: XliffInlinePart[];
}

export type RichTextXliffApplyResult =
  | { ok: true; value: Record<string, unknown>; translatedFragmentCount: number }
  | { ok: false; reason: string; empty: boolean };

const BLOCK_NODE_TYPES = new Set([
  "code",
  "heading",
  "listitem",
  "paragraph",
  "quote",
  "tablecell",
]);

/**
 * Convert a Lexical document into the inline-code subset emitted by NexPress.
 * Every text leaf receives a deterministic path id, while block boundaries are
 * represented as protected line-break placeholders for translator context.
 */
export function createRichTextXliffValue(
  sourceValue: unknown,
  targetValue: unknown,
): RichTextXliffValue | null {
  const source = analyzeRichText(sourceValue);
  if (!source || !hasNonEmptyGroup(source.parts)) return null;

  const target = analyzeRichText(targetValue);
  const targetInline =
    target && hasSameInlineShape(source.parts, target.parts)
      ? target.parts
      : blankInlineGroups(source.parts);

  return {
    source: inlinePlainText(source.parts),
    target: inlinePlainText(targetInline),
    sourceInline: source.parts,
    targetInline,
  };
}

/**
 * Validate an incoming rich-text unit against the live source document, then
 * overlay non-empty translated fragments onto a compatible target structure.
 * Empty fragments retain the current target text (or source text on create),
 * matching the atomic-string contract that empty targets never blank content.
 */
export function applyRichTextXliffValue(args: {
  sourceValue: unknown;
  targetValue: unknown;
  sourceInline: XliffInlinePart[] | undefined;
  targetInline: XliffInlinePart[] | undefined;
}): RichTextXliffApplyResult {
  const canonical = analyzeRichText(args.sourceValue);
  if (!canonical || !hasNonEmptyGroup(canonical.parts)) {
    return { ok: false, reason: "source rich-text value has no translatable text", empty: false };
  }
  if (!args.sourceInline || !args.targetInline) {
    return {
      ok: false,
      reason: "rich-text unit is missing inline source or target codes",
      empty: false,
    };
  }
  if (!hasSameInlineShape(canonical.parts, args.sourceInline)) {
    return {
      ok: false,
      reason: "source inline-code structure does not match the live document",
      empty: false,
    };
  }
  if (!hasSameInlineText(canonical.parts, args.sourceInline)) {
    return {
      ok: false,
      reason: "source inline text does not match the live document",
      empty: false,
    };
  }
  if (!hasSameInlineShape(canonical.parts, args.targetInline)) {
    return {
      ok: false,
      reason: "target inline-code structure is missing, reordered, or invalid",
      empty: false,
    };
  }

  const translated = args.targetInline.filter(
    (part): part is Extract<XliffInlinePart, { type: "group" }> =>
      part.type === "group" && part.text.length > 0,
  );
  if (translated.length === 0) {
    return { ok: false, reason: "all rich-text target fragments are empty", empty: true };
  }

  const existing = analyzeRichText(args.targetValue);
  const baselineValue =
    existing && hasSameInlineShape(canonical.parts, existing.parts)
      ? args.targetValue
      : args.sourceValue;
  const cloned = cloneRichText(baselineValue);
  if (!cloned) {
    return { ok: false, reason: "rich-text value could not be cloned", empty: false };
  }

  for (const part of translated) {
    const path = canonical.pathById.get(part.id);
    if (!path || !setTextAtPath(cloned, path, part.text)) {
      return { ok: false, reason: `inline code "${part.id}" no longer resolves`, empty: false };
    }
  }

  return {
    ok: true,
    value: cloned,
    translatedFragmentCount: translated.length,
  };
}

function analyzeRichText(value: unknown): RichTextAnalysis | null {
  if (!isRecord(value)) return null;
  const root = value.root;
  if (!isRecord(root) || !Array.isArray(root.children)) return null;

  const leaves: RichTextLeaf[] = [];
  walkNodes(root.children, [], null, leaves);
  if (leaves.length === 0) return null;

  const parts: XliffInlinePart[] = [];
  const pathById = new Map<string, number[]>();
  let breakIndex = 0;
  for (let index = 0; index < leaves.length; index++) {
    const leaf = leaves[index];
    const previous = leaves[index - 1];
    if (previous && previous.blockKey !== leaf.blockKey) {
      parts.push({
        type: "placeholder",
        id: `b-${breakIndex++}`,
        ctype: NP_XLIFF_BREAK_CTYPE,
      });
    }
    parts.push({
      type: "group",
      id: leaf.id,
      ctype: NP_XLIFF_LEXICAL_CTYPE,
      text: leaf.text,
    });
    pathById.set(leaf.id, leaf.path);
  }

  return { parts, pathById };
}

function walkNodes(
  nodes: unknown[],
  parentPath: number[],
  inheritedBlockKey: string | null,
  leaves: RichTextLeaf[],
): void {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!isRecord(node)) continue;
    const path = [...parentPath, index];
    const type = typeof node.type === "string" ? node.type : "";
    const blockKey =
      parentPath.length === 0 || BLOCK_NODE_TYPES.has(type)
        ? path.join("-")
        : (inheritedBlockKey ?? path.join("-"));

    if (typeof node.text === "string") {
      const id = `n-${path.join("-")}`;
      leaves.push({ id, path, text: node.text, blockKey });
    }
    if (Array.isArray(node.children)) {
      walkNodes(node.children, path, blockKey, leaves);
    }
  }
}

function hasSameInlineShape(expected: XliffInlinePart[], actual: XliffInlinePart[]): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((part, index) => {
    const candidate = actual[index];
    return (
      candidate !== undefined &&
      candidate.type === part.type &&
      candidate.id === part.id &&
      candidate.ctype === part.ctype
    );
  });
}

function hasSameInlineText(expected: XliffInlinePart[], actual: XliffInlinePart[]): boolean {
  return expected.every((part, index) => {
    const candidate = actual[index];
    if (part.type === "placeholder") return candidate?.type === "placeholder";
    return candidate?.type === "group" && candidate.text === part.text;
  });
}

function blankInlineGroups(parts: XliffInlinePart[]): XliffInlinePart[] {
  return parts.map((part) => (part.type === "group" ? { ...part, text: "" } : { ...part }));
}

function inlinePlainText(parts: XliffInlinePart[]): string {
  return parts.map((part) => (part.type === "group" ? part.text : "\n")).join("");
}

function hasNonEmptyGroup(parts: XliffInlinePart[]): boolean {
  return parts.some((part) => part.type === "group" && part.text.length > 0);
}

function cloneRichText(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

function setTextAtPath(content: Record<string, unknown>, path: number[], text: string): boolean {
  let current: unknown = content.root;
  for (const index of path) {
    if (!isRecord(current) || !Array.isArray(current.children)) return false;
    current = current.children[index];
  }
  if (!isRecord(current) || typeof current.text !== "string") return false;
  current.text = text;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
