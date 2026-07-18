/** Parent-owned responsive placement metadata for a block instance. */
export interface NpBlockLayout {
  colSpan: number;
  mdColSpan?: number;
  lgColSpan?: number;
}

export interface NpBlockInstance {
  id: string;
  type: string;
  props: Record<string, unknown>;
  layout?: NpBlockLayout;
  children?: NpBlockInstance[];
}

/** Stable wire format stored by collection fields with `type: "blocks"`. */
export type NpBlockContent = NpBlockInstance[];

export type NpBlockContentValidationResult =
  { ok: true; value: NpBlockContent } | { ok: false; message: string };

type ValidationStatus = { ok: true } | { ok: false; message: string };

const BLOCK_KEYS = new Set(["id", "type", "props", "layout", "children"]);
const LAYOUT_KEYS = new Set(["colSpan", "mdColSpan", "lgColSpan"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_BLOCK_TREE_DEPTH = 32;
const MAX_PROP_DEPTH = 32;

function valid(): ValidationStatus {
  return { ok: true };
}

function invalid(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function validateIdentifier(value: unknown, path: string): ValidationStatus {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return invalid(
      `${path} must start with a letter or number, use only letters, numbers, dots, underscores, or hyphens, and contain at most ${MAX_IDENTIFIER_LENGTH.toString()} characters`,
    );
  }
  return valid();
}

function validateLayoutSpan(value: unknown, path: string): ValidationStatus {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12) {
    return invalid(`${path} must be an integer from 1 to 12`);
  }
  return valid();
}

function validateLayout(value: unknown, path: string): ValidationStatus {
  if (!isPlainRecord(value)) return invalid(`${path} must be an object`);

  const unsupportedKey = Object.keys(value).find((key) => !LAYOUT_KEYS.has(key));
  if (unsupportedKey) return invalid(`${path} has unsupported field "${unsupportedKey}"`);

  const baseResult = validateLayoutSpan(value.colSpan, `${path}.colSpan`);
  if (!baseResult.ok) return baseResult;
  if (Object.hasOwn(value, "mdColSpan")) {
    const mediumResult = validateLayoutSpan(value.mdColSpan, `${path}.mdColSpan`);
    if (!mediumResult.ok) return mediumResult;
  }
  if (Object.hasOwn(value, "lgColSpan")) {
    const largeResult = validateLayoutSpan(value.lgColSpan, `${path}.lgColSpan`);
    if (!largeResult.ok) return largeResult;
  }
  return valid();
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
  if (depth > MAX_PROP_DEPTH) {
    return invalid(`${path} exceeds the maximum block prop depth of ${MAX_PROP_DEPTH.toString()}`);
  }
  if (typeof value !== "object" || (!Array.isArray(value) && !isPlainRecord(value))) {
    return invalid(`${path} must contain only JSON values`);
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

function validateBlock(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  ids: Set<string>,
): ValidationStatus {
  if (!isPlainRecord(value)) return invalid(`${path} must be an object`);
  if (depth > MAX_BLOCK_TREE_DEPTH) {
    return invalid(
      `${path} exceeds the maximum block tree depth of ${MAX_BLOCK_TREE_DEPTH.toString()}`,
    );
  }
  if (ancestors.has(value)) return invalid(`${path} must not contain a circular block tree`);

  const unsupportedKey = Object.keys(value).find((key) => !BLOCK_KEYS.has(key));
  if (unsupportedKey) return invalid(`${path} has unsupported field "${unsupportedKey}"`);

  const idResult = validateIdentifier(value.id, `${path}.id`);
  if (!idResult.ok) return idResult;
  const typeResult = validateIdentifier(value.type, `${path}.type`);
  if (!typeResult.ok) return typeResult;
  if (ids.has(value.id as string)) {
    return invalid(`${path}.id duplicates block id "${String(value.id)}"`);
  }
  if (!isPlainRecord(value.props)) return invalid(`${path}.props must be an object`);

  const propsResult = validateJsonValue(value.props, `${path}.props`, 0, new WeakSet());
  if (!propsResult.ok) return propsResult;
  if (Object.hasOwn(value, "layout")) {
    const layoutResult = validateLayout(value.layout, `${path}.layout`);
    if (!layoutResult.ok) return layoutResult;
  }
  if (value.children !== undefined && !Array.isArray(value.children)) {
    return invalid(`${path}.children must be an array`);
  }

  ids.add(value.id as string);
  ancestors.add(value);
  if (Array.isArray(value.children)) {
    for (const [index, child] of value.children.entries()) {
      const childResult = validateBlock(
        child,
        `${path}.children[${index.toString()}]`,
        depth + 1,
        ancestors,
        ids,
      );
      if (!childResult.ok) {
        ancestors.delete(value);
        return childResult;
      }
    }
  }
  ancestors.delete(value);
  return valid();
}

export function npValidateBlockContent(value: unknown): NpBlockContentValidationResult {
  if (!Array.isArray(value)) return invalid("block content must be an array");

  const ancestors = new WeakSet<object>();
  const ids = new Set<string>();
  for (const [index, block] of value.entries()) {
    const result = validateBlock(block, `block content[${index.toString()}]`, 0, ancestors, ids);
    if (!result.ok) return result;
  }
  return { ok: true, value: value as NpBlockContent };
}

export function isNpBlockContent(value: unknown): value is NpBlockContent {
  return npValidateBlockContent(value).ok;
}
