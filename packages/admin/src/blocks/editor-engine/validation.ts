import {
  npAnalyzeBlockContent,
  npIsBlockPropFieldHidden,
  type NpBlockInstance,
  type NpBlockMetadata,
  type NpBlockPropField,
} from "@nexpress/blocks";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";

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
export const getFieldValue = (field: NpBlockPropField, value: unknown): unknown => {
  if (value !== undefined) return value;
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  if (field.type === "array") return [];
  if (field.type === "richtext") return npCreateEmptyRichTextContent();
  return "";
};

/**
 * Parses a raw input value (string/boolean from a DOM event) into
 * the wire shape for the given field type. Rich-text and array controls
 * emit their exact object shapes directly and do not pass through here.
 */
export const parseFieldInput = (field: NpBlockPropField, rawValue: string | boolean): unknown => {
  if (field.type === "boolean") return Boolean(rawValue);
  if (field.type === "number") {
    if (typeof rawValue === "string") {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : (field.defaultValue ?? 0);
    }
    return field.defaultValue ?? 0;
  }
  return rawValue;
};

/**
 * Returns true when the field should be hidden in the form. A
 * schema can express conditional visibility two ways:
 *
 * - `hiddenWhen`: hide when every predicate matches.
 * - `visibleWhen`: show only when every predicate matches (i.e.
 *   hide when any predicate doesn't match).
 *
 * Both can coexist on the same field. The field is hidden if
 * either rule fires.
 */
export function isFieldHidden(
  field: NpBlockPropField,
  blockProps: Record<string, unknown>,
): boolean {
  return npIsBlockPropFieldHidden(field, blockProps);
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
export function lintFieldValue(field: NpBlockPropField, value: unknown): string | null {
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (typeof field.min === "number" && value < field.min) {
      return field.validationMessage ?? `Must be ≥ ${field.min}`;
    }
    if (typeof field.max === "number" && value > field.max) {
      return field.validationMessage ?? `Must be ≤ ${field.max}`;
    }
    if (typeof field.step === "number") {
      const quotient = (value - (field.min ?? 0)) / field.step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        return field.validationMessage ?? `Must align to step ${field.step}`;
      }
    }
    return null;
  }
  if ((field.type === "text" || field.type === "url") && field.pattern) {
    if (typeof value !== "string" || value.length === 0) return null;
    let regex: RegExp;
    try {
      regex = new RegExp(`^(?:${field.pattern})$`);
    } catch {
      return null;
    }
    if (!regex.test(value)) {
      return field.validationMessage ?? `Doesn't match pattern \`${field.pattern}\``;
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
 * Quickly summarizes a block's validation status for collapsed-
 * row badges. Returns:
 *
 * - `"error"` when any required prop is missing on the raw value.
 * - `"warning"` when no required-missing but at least one
 *   `lintFieldValue` warning fires (pattern / min / max).
 * - `null` when everything looks clean.
 *
 * Skips fields hidden by `hiddenWhen` / `visibleWhen` so the
 * badge doesn't fire on a field the operator can't see anyway.
 */
export function getRowValidationStatus(
  definition: NpBlockMetadata | undefined,
  block: NpBlockInstance,
  definitions: Iterable<NpBlockMetadata> = definition ? [definition] : [],
): "error" | "warning" | null {
  if (!definition) return null;
  const issues = npAnalyzeBlockContent([block], definitions);
  if (issues.some((issue) => issue.severity === "error")) return "error";
  return issues.some((issue) => issue.severity === "warning") ? "warning" : null;
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
  const propKeys = new Set([...Object.keys(defaults), ...Object.keys(block.props)]);
  for (const key of propKeys) {
    const next = block.props[key];
    const prev = defaults[key];
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      return true;
    }
  }
  return false;
}
