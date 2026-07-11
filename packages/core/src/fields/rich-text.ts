export const NP_RICH_TEXT_CONTENT_VERSION = 1 as const;

export interface NpRichTextSerializedNode {
  [key: string]: unknown;
  type: string;
  version: number;
  children?: NpRichTextSerializedNode[];
  text?: string;
}

export interface NpRichTextDocumentV1 {
  root: {
    type: "root";
    children: NpRichTextSerializedNode[];
    direction: "ltr" | "rtl" | null;
    format: string;
    indent: number;
    version: number;
  };
}

/**
 * Stable NexPress rich-text wire format.
 *
 * `version` belongs to NexPress. The editor-specific serialized document is
 * deliberately nested so a future editor migration can add a new envelope
 * version without changing every collection, API, and plugin contract.
 */
export interface NpRichTextContent {
  version: typeof NP_RICH_TEXT_CONTENT_VERSION;
  document: NpRichTextDocumentV1;
}

export type NpRichTextContentValidationResult =
  { ok: true; value: NpRichTextContent } | { ok: false; message: string };

type ValidationStatus = { ok: true } | { ok: false; message: string };

const ROOT_KEYS = ["children", "direction", "format", "indent", "type", "version"];
const MAX_DOCUMENT_DEPTH = 100;

function invalid(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function valid(): ValidationStatus {
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateJsonValue(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
): ValidationStatus {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return valid();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? valid() : invalid(`${path} must contain a finite number`);
  }
  if (depth > MAX_DOCUMENT_DEPTH) {
    return invalid(`${path} exceeds the maximum rich-text depth`);
  }
  if (typeof value !== "object" || (!Array.isArray(value) && !isRecord(value))) {
    return invalid(`${path} must be JSON-serializable`);
  }
  if (ancestors.has(value)) {
    return invalid(`${path} must not contain circular references`);
  }

  ancestors.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, child] of entries) {
    const result = validateJsonValue(child, `${path}.${String(key)}`, depth + 1, ancestors);
    if (!result.ok) {
      ancestors.delete(value);
      return result;
    }
  }
  ancestors.delete(value);
  return valid();
}

function validateNode(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
): ValidationStatus {
  if (!isRecord(value)) {
    return invalid(`${path} must be an object`);
  }
  if (typeof value.type !== "string" || value.type.length === 0) {
    return invalid(`${path}.type must be a non-empty string`);
  }
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    return invalid(`${path}.version must be a positive integer`);
  }
  if (depth > MAX_DOCUMENT_DEPTH) {
    return invalid(`${path} exceeds the maximum rich-text depth`);
  }
  if (ancestors.has(value)) {
    return invalid(`${path} must not contain circular references`);
  }
  ancestors.add(value);
  if ("text" in value && typeof value.text !== "string") {
    ancestors.delete(value);
    return invalid(`${path}.text must be a string`);
  }
  if ("children" in value) {
    if (!Array.isArray(value.children)) {
      ancestors.delete(value);
      return invalid(`${path}.children must be an array`);
    }
    for (let index = 0; index < value.children.length; index++) {
      const result = validateNode(
        value.children[index],
        `${path}.children[${index}]`,
        depth + 1,
        ancestors,
      );
      if (!result.ok) {
        ancestors.delete(value);
        return result;
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "children") continue;
    const result = validateJsonValue(child, `${path}.${key}`, depth + 1, ancestors);
    if (!result.ok) {
      ancestors.delete(value);
      return result;
    }
  }
  ancestors.delete(value);
  return valid();
}

export function npValidateRichTextContent(value: unknown): NpRichTextContentValidationResult {
  if (!isRecord(value) || !hasExactKeys(value, ["document", "version"])) {
    return invalid('rich text must contain exactly "version" and "document"');
  }
  if (value.version !== NP_RICH_TEXT_CONTENT_VERSION) {
    return invalid(`rich text version must be ${NP_RICH_TEXT_CONTENT_VERSION}`);
  }
  if (!isRecord(value.document) || !hasExactKeys(value.document, ["root"])) {
    return invalid('rich text document must contain exactly "root"');
  }

  const root = value.document.root;
  if (!isRecord(root) || !hasExactKeys(root, ROOT_KEYS)) {
    return invalid(`rich text document.root must contain exactly ${ROOT_KEYS.join(", ")}`);
  }
  if (root.type !== "root") {
    return invalid('rich text document.root.type must be "root"');
  }
  if (!Array.isArray(root.children)) {
    return invalid("rich text document.root.children must be an array");
  }
  if (root.direction !== null && root.direction !== "ltr" && root.direction !== "rtl") {
    return invalid('rich text document.root.direction must be "ltr", "rtl", or null');
  }
  if (typeof root.format !== "string") {
    return invalid("rich text document.root.format must be a string");
  }
  if (!Number.isInteger(root.indent) || (root.indent as number) < 0) {
    return invalid("rich text document.root.indent must be a non-negative integer");
  }
  if (!Number.isInteger(root.version) || (root.version as number) < 1) {
    return invalid("rich text document.root.version must be a positive integer");
  }

  const ancestors = new WeakSet<object>();
  for (let index = 0; index < root.children.length; index++) {
    const result = validateNode(
      root.children[index],
      `rich text document.root.children[${index}]`,
      1,
      ancestors,
    );
    if (!result.ok) return result;
  }

  return { ok: true, value: value as unknown as NpRichTextContent };
}

export function isNpRichTextContent(value: unknown): value is NpRichTextContent {
  return npValidateRichTextContent(value).ok;
}

export function npCreateEmptyRichTextContent(): NpRichTextContent {
  return {
    version: NP_RICH_TEXT_CONTENT_VERSION,
    document: {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [],
            direction: null,
            format: "",
            indent: 0,
            version: 1,
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        version: 1,
      },
    },
  };
}
