import { z } from "zod";

import { type NpCollectionConfig, type NpFieldConfig } from "../config/types.js";

export function buildZodSchema(
  fields: NpFieldConfig[],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    if (field.type === "row" || field.type === "collapsible") {
      Object.assign(shape, buildZodSchema(field.fields).shape);
      continue;
    }

    if (field.type === "group") {
      const schema = buildZodSchema(field.fields);
      shape[field.name] = applyOptionality(schema, field.required);
      continue;
    }

    shape[field.name] = applyOptionality(buildFieldSchema(field), field.required);
  }

  return z.object(shape);
}

export function getCollectionZodSchema(config: NpCollectionConfig): z.ZodSchema {
  const base = buildZodSchema(config.fields).extend({
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

function buildFieldSchema(field: Exclude<NpFieldConfig, { type: "row" | "collapsible" | "group" }>): z.ZodTypeAny {
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
    case "blocks":
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
