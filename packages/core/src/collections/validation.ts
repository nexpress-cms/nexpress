import { z } from "zod";

import {
  type NpCollectionConfig,
  type NpFieldCondition,
  type NpFieldConditionExpr,
  type NpFieldConfig,
} from "../config/types.js";
import { npValidateRichTextContent } from "../fields/rich-text.js";
import { npValidateBlockContent } from "../fields/block-content.js";

/**
 * Evaluate a field condition — handles both the legacy function
 * form (`NpFieldCondition`, server-side only) and the serializable
 * expression form (`NpFieldConditionExpr`, works in both env).
 * Unset → returns true (field shows / required holds).
 *
 * Used by `collectHiddenFieldNames` server-side and by the admin
 * editor's `passesCondition` client-side. The same evaluator runs
 * both places so server validation + client visibility never
 * disagree.
 */
export function evaluateFieldCondition(
  condition: NpFieldCondition | NpFieldConditionExpr | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  if (typeof condition === "function") {
    try {
      return condition(data, data);
    } catch {
      // Buggy condition: treat as "field visible" — surface a
      // required error is more recoverable than silently dropping.
      return true;
    }
  }
  return evaluateExpr(condition, data);
}

function evaluateExpr(expr: NpFieldConditionExpr, data: Record<string, unknown>): boolean {
  if ("all" in expr) return expr.all.every((e) => evaluateExpr(e, data));
  if ("any" in expr) return expr.any.some((e) => evaluateExpr(e, data));
  const value = data[expr.when];
  if ("equals" in expr) return value === expr.equals;
  if ("notEquals" in expr) return value !== expr.notEquals;
  if ("in" in expr) return expr.in.includes(value);
  if ("notIn" in expr) return !expr.notIn.includes(value);
  if ("exists" in expr) {
    const present =
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0);
    return expr.exists ? present : !present;
  }
  // Exhaustiveness — unknown shape fails open (field visible)
  // so a malformed config doesn't silently hide an entire group.
  return true;
}

export function buildZodSchema(
  fields: NpFieldConfig[],
  /**
   * Field names whose `admin.condition` returned false against
   * the current document data. `required` is dropped for these
   * — a hidden field can't be filled in by the operator, so
   * enforcing required on save would block writes the operator
   * can't fix. Pass an empty set (the default) for static
   * contexts that don't have current data to evaluate
   * conditions against; the schema then enforces every `required`
   * verbatim, matching pre-#759 behavior.
   */
  hiddenByCondition: ReadonlySet<string> = new Set(),
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(shape, buildZodSchema(field.fields, hiddenByCondition).shape);
      continue;
    }

    if (field.type === "group") {
      const schema = buildZodSchema(field.fields, hiddenByCondition);
      const effectiveRequired = field.required && !hiddenByCondition.has(field.name);
      shape[field.name] = applyFieldDefault(applyOptionality(schema, effectiveRequired), field);
      continue;
    }

    const effectiveRequired = field.required && !hiddenByCondition.has(field.name);
    shape[field.name] = applyFieldDefault(
      applyOptionality(buildFieldSchema(field), effectiveRequired),
      field,
    );
  }

  return z.object(shape);
}

/**
 * Chain `.default(field.defaultValue)` onto a Zod schema when the field
 * declares one. Without this, a field like `posts.kind` (required + select
 * with a single option + `defaultValue: "article"`) rejects API callers who
 * omit the field — even though the framework expected the default to fill
 * in. Drizzle column defaults run at INSERT time and don't help the Zod
 * parse step that runs first; this is the validation-layer pair.
 *
 * Applies to every leaf field type that carries a `defaultValue` AND to
 * `group` fields (a group default is an object literal merged in when the
 * caller omits the whole group). `row` / `collapsible` are pure
 * admin-layout containers with no value of their own — their nested
 * fields each carry their own default — so the function returns the
 * schema unchanged for those two.
 *
 * Only applies when `defaultValue !== undefined`. `null` is a legit
 * default for nullable text/json fields and gets forwarded as-is.
 */
function applyFieldDefault(schema: z.ZodTypeAny, field: NpFieldConfig): z.ZodTypeAny {
  if (field.type === "row" || field.type === "collapsible") return schema;
  if (!("defaultValue" in field)) return schema;
  if (field.defaultValue === undefined) return schema;
  return schema.default(field.defaultValue as never);
}

/**
 * Walk fields recursively, evaluating `admin.condition` against
 * `data` and collecting the names of fields the condition would
 * hide. Used by the pipeline + admin client to drop required
 * checks for fields the operator can't see / set.
 *
 * When a `group` field's own condition hides the group, every
 * nested name is added too — operators can't see the inner
 * fields, so requiring them would block save with an invisible
 * error. Nested fields with their own conditions are evaluated
 * normally when the group is visible.
 */
export function collectHiddenFieldNames(
  fields: NpFieldConfig[],
  data: Record<string, unknown>,
): Set<string> {
  const out = new Set<string>();
  const addAllNames = (fs: NpFieldConfig[]): void => {
    for (const field of fs) {
      if (field.type === "row" || field.type === "collapsible") {
        addAllNames(field.fields);
        continue;
      }
      if (field.type === "group") {
        out.add(field.name);
        addAllNames(field.fields);
        continue;
      }
      out.add(field.name);
    }
  };
  const walk = (fs: NpFieldConfig[]): void => {
    for (const field of fs) {
      if (field.type === "row" || field.type === "collapsible") {
        walk(field.fields);
        continue;
      }
      if (field.type === "group") {
        const condition = field.admin?.condition;
        if (condition && !evaluateFieldCondition(condition, data)) {
          out.add(field.name);
          addAllNames(field.fields);
          continue;
        }
        walk(field.fields);
        continue;
      }
      const condition = field.admin?.condition;
      if (!condition) continue;
      if (!evaluateFieldCondition(condition, data)) {
        out.add(field.name);
      }
    }
  };
  walk(fields);
  return out;
}

export function getCollectionZodSchema(
  config: NpCollectionConfig,
  /**
   * Current document data. When provided, `admin.condition` is
   * evaluated against it and `required` is dropped for fields
   * the condition hides — mirrors the admin client's
   * condition-aware resolver so a hidden field can't bypass
   * the editor and still fail server validation.
   *
   * Pass `undefined` (or omit) for code paths that need the
   * unconditional schema — pre-#759 behavior.
   */
  forData?: Record<string, unknown>,
): z.ZodSchema {
  const hidden = forData ? collectHiddenFieldNames(config.fields, forData) : new Set<string>();
  const base = buildZodSchema(config.fields, hidden).extend({
    // Phase 21.17 — per-doc visibility flag. Optional on writes;
    // the pipeline lets the column default to "public" when the
    // caller doesn't specify. Allowed values are the same
    // codegen enum from `getBaseColumns`.
    visibility: z.enum(["public", "private"]).optional(),
  });
  // Phase 12.1 — i18n collections accept `locale` and an
  // optional `translationGroupId` on writes. zod's default
  // strip behavior would otherwise drop them before the
  // pipeline could read them. Validation of `locale` against
  // the configured locales list happens later in the pipeline
  // (we don't have the parent NpConfig here).
  if (config.i18n) {
    return base.extend({
      locale: z.string().min(1).optional(),
      translationGroupId: z.string().uuid().optional(),
    });
  }
  return base;
}

function buildFieldSchema(
  field: Exclude<NpFieldConfig, { type: "row" | "collapsible" | "group" }>,
): z.ZodTypeAny {
  switch (field.type) {
    case "text": {
      let schema = z.string();
      if (field.minLength !== undefined) schema = schema.min(field.minLength);
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
      return schema;
    }
    case "textarea": {
      let schema = z.string();
      if (field.minLength !== undefined) schema = schema.min(field.minLength);
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
      return schema;
    }
    case "email":
      return z.string().email();
    case "number": {
      let schema = z.number();
      if (field.integerOnly) schema = schema.int();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case "checkbox":
      return z.boolean();
    case "select":
      return createEnumSchema(field.options.map((option) => option.value));
    case "radio":
      return createEnumSchema(field.options.map((option) => option.value));
    case "relationship":
      return field.hasMany ? z.array(z.string().uuid()) : z.string().uuid();
    case "upload":
      return z.string().uuid();
    case "date":
      return z.coerce.date();
    case "richText":
      return z.unknown().superRefine((value, ctx) => {
        const result = npValidateRichTextContent(value);
        if (!result.ok) {
          ctx.addIssue({ code: "custom", message: result.message });
        }
      });
    case "blocks":
      return z.unknown().superRefine((value, ctx) => {
        const result = npValidateBlockContent(value);
        if (!result.ok) {
          ctx.addIssue({ code: "custom", message: result.message });
        }
      });
    case "json":
      return z.unknown();
    case "array": {
      let schema = z.array(buildZodSchema(field.fields));
      if (field.minRows !== undefined) schema = schema.min(field.minRows);
      if (field.maxRows !== undefined) schema = schema.max(field.maxRows);
      return schema;
    }
    default:
      return z.unknown();
  }
}

function applyOptionality(schema: z.ZodTypeAny, required?: boolean): z.ZodTypeAny {
  return required ? schema : schema.optional().nullable();
}

function createEnumSchema(values: string[]): z.ZodType<string> {
  const [first, ...rest] = values;
  if (!first) {
    return z.string();
  }

  return z.enum([first, ...rest]);
}
