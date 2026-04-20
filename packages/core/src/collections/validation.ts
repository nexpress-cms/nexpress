import { z } from "zod";

import { type NxCollectionConfig, type NxFieldConfig } from "../config/types.js";

export function buildZodSchema(
  fields: NxFieldConfig[],
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

export function getCollectionZodSchema(config: NxCollectionConfig): z.ZodSchema {
  return buildZodSchema(config.fields);
}

function buildFieldSchema(field: Exclude<NxFieldConfig, { type: "row" | "collapsible" | "group" }>): z.ZodTypeAny {
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
