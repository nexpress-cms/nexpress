import type {
  NpBlockInstance,
  NpBlockMetadata,
  NpBlockPropField,
} from "@nexpress/blocks";

import type { FieldGroupSection } from "./types.js";

/**
 * Type guard for "plain JSON object" — non-null, non-array.
 * Common enough that the engine exports it for shared UI to
 * import too.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resolves the rendered value for a field given its raw stored
 * value. Applies defaults: `field.defaultValue` when set,
 * otherwise type-appropriate fallback (`false` / `0` / `""`).
 *
 * The required-missing check intentionally reads the RAW value
 * (`block.props[field.name]`) instead of the post-default value,
 * so e.g. a required number with no default still flags
 * undefined as missing.
 */
export const getFieldValue = (
  field: NpBlockPropField,
  value: unknown,
): unknown => {
  if (value !== undefined) return value;
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  return "";
};

/**
 * Parses a raw input value (string/boolean from a DOM event) into
 * the wire shape for the given field type. Handles richtext JSON
 * round-trip + number coercion fallbacks.
 */
export const parseFieldInput = (
  field: NpBlockPropField,
  rawValue: string | boolean,
): unknown => {
  if (field.type === "boolean") return Boolean(rawValue);
  if (field.type === "number") {
    if (typeof rawValue === "string") {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : (field.defaultValue ?? 0);
    }
    return field.defaultValue ?? 0;
  }
  if (field.type === "richtext") {
    if (typeof rawValue !== "string") return field.defaultValue ?? {};
    try {
      const parsed: unknown = JSON.parse(rawValue);
      return isRecord(parsed) ? parsed : (field.defaultValue ?? {});
    } catch {
      return rawValue;
    }
  }
  return rawValue;
};

/**
 * Returns true when every `[propName, expected]` predicate in
 * `field.hiddenWhen` matches the block's current `props`. Used by
 * the props form to skip rendering conditionally hidden fields —
 * a schema can express "show ctaUrl only when showCta is true"
 * without the block author writing UI logic.
 */
export function isFieldHidden(
  field: NpBlockPropField,
  blockProps: Record<string, unknown>,
): boolean {
  const predicates = field.hiddenWhen;
  if (!predicates || predicates.length === 0) return false;
  for (const [name, expected] of predicates) {
    if (blockProps[name] !== expected) return false;
  }
  return true;
}

/**
 * Soft client-side validation for a single field value. Returns
 * null when the value is OK, otherwise a human-readable warning.
 * Server-side validation still has the final say — this surface
 * helps operators spot issues before save.
 *
 * `pattern` is anchored (`^(?:…)$`) to match HTML5 `<input
 * pattern>` semantics so the soft warning and the native browser
 * validation agree on whether a value passes.
 */
export function lintFieldValue(
  field: NpBlockPropField,
  value: unknown,
): string | null {
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (typeof field.min === "number" && value < field.min) {
      return field.patternMessage ?? `Must be ≥ ${field.min}`;
    }
    if (typeof field.max === "number" && value > field.max) {
      return field.patternMessage ?? `Must be ≤ ${field.max}`;
    }
    return null;
  }
  if ((field.type === "text" || field.type === "url") && field.pattern) {
    if (typeof value !== "string" || value.length === 0) return null;
    const sourceWithoutAnchors = field.pattern
      .replace(/^\^/, "")
      .replace(/\$$/, "");
    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${sourceWithoutAnchors})$`);
    } catch {
      return null;
    }
    if (!regex.test(value)) {
      return field.patternMessage ?? `Doesn't match pattern \`${field.pattern}\``;
    }
  }
  return null;
}

/**
 * Walks `propsSchema` and partitions visible (non-`hiddenWhen`)
 * fields into groups in declaration order. Fields without a
 * `group` go into the leading "ungrouped" bucket so existing
 * schemas stay flat. Within each bucket, declaration order is
 * preserved.
 */
export function groupVisibleFields(
  schema: readonly NpBlockPropField[],
  blockProps: Record<string, unknown>,
): FieldGroupSection<NpBlockPropField>[] {
  const sections: FieldGroupSection<NpBlockPropField>[] = [];
  const indexByGroup = new Map<string, number>();

  for (const field of schema) {
    if (isFieldHidden(field, blockProps)) continue;
    const groupKey = field.group ?? null;
    const lookupKey = groupKey ?? "__np_ungrouped__";
    let index = indexByGroup.get(lookupKey);
    if (index === undefined) {
      index = sections.length;
      sections.push({ group: groupKey, fields: [] });
      indexByGroup.set(lookupKey, index);
    }
    sections[index].fields.push(field);
  }
  return sections;
}

/**
 * Decides whether a delete should ask for confirmation. We
 * confirm when the operator might lose work — block has children
 * or has any prop that diverges from the registered defaults.
 * Plain rows whose props still match `defaultProps` delete in
 * one click.
 */
export function deleteNeedsConfirmation(
  definition: NpBlockMetadata | undefined,
  block: NpBlockInstance,
): boolean {
  if (block.children && block.children.length > 0) return true;
  const defaults = definition?.defaultProps ?? {};
  const propKeys = new Set([
    ...Object.keys(defaults),
    ...Object.keys(block.props),
  ]);
  for (const key of propKeys) {
    if (key === "_layout") continue; // grid-child layout meta is structural
    const next = block.props[key];
    const prev = defaults[key];
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      return true;
    }
  }
  return false;
}
