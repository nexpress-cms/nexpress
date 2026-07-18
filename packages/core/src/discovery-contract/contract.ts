import { z } from "zod";

import { npValidateRichTextContent, type NpRichTextContent } from "../fields/rich-text.js";

import {
  npPluginDiscoveryProvideKeys,
  type NpBlockDiscoveryItem,
  type NpBlockDiscoveryPropField,
  type NpBlockDiscoveryResponse,
  type NpCollectionDiscoveryField,
  type NpCollectionDiscoveryItem,
  type NpCollectionDiscoveryResponse,
  type NpDiscoveryContractIssue,
  type NpDiscoveryContractResult,
  type NpDiscoveryJsonValue,
  type NpPluginDiscoveryItem,
  type NpPluginDiscoveryResponse,
} from "./types.js";

export const npDiscoveryContractLimits = {
  items: 1_000,
  fields: 1_000,
  textLength: 2_000,
  jsonStringLength: 100_000,
  identifierLength: 256,
  jsonDepth: 64,
  jsonNodes: 20_000,
  jsonArrayItems: 2_000,
  jsonObjectKeys: 2_000,
  jsonKeyLength: 256,
  blockSchemaDepth: 8,
} as const;

const INVALID = Symbol("invalid-discovery-value");

interface JsonState {
  nodes: number;
  readonly ancestors: Set<object>;
}

export class NpDiscoveryContractError extends TypeError {
  readonly issues: readonly NpDiscoveryContractIssue[];

  constructor(message: string, issues: readonly NpDiscoveryContractIssue[]) {
    const first = issues[0];
    super(first ? `${message}: ${first.path}: ${first.message}` : message);
    this.name = "NpDiscoveryContractError";
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(
  issues: NpDiscoveryContractIssue[],
  code: NpDiscoveryContractIssue["code"],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function setDataProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function hasUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function cloneJson(
  value: unknown,
  path: string,
  depth: number,
  state: JsonState,
  issues: NpDiscoveryContractIssue[],
): NpDiscoveryJsonValue | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > npDiscoveryContractLimits.jsonNodes) {
    issue(issues, "limit", path, "exceeds the discovery JSON node limit.");
    return INVALID;
  }
  if (depth > npDiscoveryContractLimits.jsonDepth) {
    issue(issues, "limit", path, "exceeds the discovery JSON depth limit.");
    return INVALID;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(issues, "invalid-field", path, "must be a finite JSON number.");
      return INVALID;
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (value.length > npDiscoveryContractLimits.jsonStringLength || hasUnsafeText(value)) {
      issue(issues, "invalid-field", path, "must be bounded well-formed text.");
      return INVALID;
    }
    return value;
  }
  if (typeof value !== "object" || value === null) {
    issue(issues, "invalid-field", path, "must contain only JSON values.");
    return INVALID;
  }
  if (state.ancestors.has(value)) {
    issue(issues, "invariant", path, "must not contain circular values.");
    return INVALID;
  }
  state.ancestors.add(value);

  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    state.ancestors.delete(value);
    issue(issues, "shape", path, "must be inspectable JSON data.");
    return INVALID;
  }

  if (arrayValue) {
    let prototype: object | null;
    let ownKeys: readonly PropertyKey[];
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      prototype = Object.getPrototypeOf(value) as object | null;
      ownKeys = Reflect.ownKeys(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    } catch {
      state.ancestors.delete(value);
      issue(issues, "shape", path, "must be an inspectable plain array.");
      return INVALID;
    }
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
    if (
      prototype !== Array.prototype ||
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > npDiscoveryContractLimits.jsonArrayItems
    ) {
      state.ancestors.delete(value);
      issue(
        issues,
        prototype === Array.prototype && typeof length === "number" ? "limit" : "shape",
        path,
        "must be a bounded plain array.",
      );
      return INVALID;
    }
    const allowed = new Set(Array.from({ length }, (_, index) => index.toString()));
    if (ownKeys.some((key) => key !== "length" && (typeof key !== "string" || !allowed.has(key)))) {
      state.ancestors.delete(value);
      issue(issues, "unknown-field", path, "must not contain custom array properties.");
      return INVALID;
    }
    const result: NpDiscoveryJsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
      } catch {
        issue(issues, "shape", `${path}[${index.toString()}]`, "must be inspectable.");
        continue;
      }
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        issue(issues, "shape", `${path}[${index.toString()}]`, "must be a plain data element.");
        continue;
      }
      const entry = cloneJson(
        descriptor.value,
        `${path}[${index.toString()}]`,
        depth + 1,
        state,
        issues,
      );
      if (entry !== INVALID) result.push(entry);
    }
    state.ancestors.delete(value);
    return result;
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    ownKeys = Reflect.ownKeys(value);
  } catch {
    state.ancestors.delete(value);
    issue(issues, "shape", path, "must be an inspectable plain object.");
    return INVALID;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    state.ancestors.delete(value);
    issue(issues, "shape", path, "must be a plain object.");
    return INVALID;
  }
  if (ownKeys.length > npDiscoveryContractLimits.jsonObjectKeys) {
    state.ancestors.delete(value);
    issue(issues, "limit", path, "contains too many object fields.");
    return INVALID;
  }
  const result: Record<string, NpDiscoveryJsonValue> = {};
  for (const ownKey of ownKeys) {
    if (
      typeof ownKey !== "string" ||
      ownKey.length === 0 ||
      ownKey.length > npDiscoveryContractLimits.jsonKeyLength ||
      hasUnsafeText(ownKey)
    ) {
      issue(issues, "unknown-field", path, "contains an invalid object key.");
      continue;
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
    } catch {
      issue(issues, "shape", `${path}.${ownKey}`, "must be inspectable.");
      continue;
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      issue(issues, "shape", `${path}.${ownKey}`, "must be a plain data property.");
      continue;
    }
    const entry = cloneJson(descriptor.value, `${path}.${ownKey}`, depth + 1, state, issues);
    if (entry !== INVALID) setDataProperty(result, ownKey, entry);
  }
  state.ancestors.delete(value);
  return result;
}

const text = (maximum: number = npDiscoveryContractLimits.textLength) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !hasUnsafeText(value), "unsafe text");
const identifier = text(npDiscoveryContractLimits.identifierLength);
const stringList = z
  .array(identifier)
  .max(npDiscoveryContractLimits.fields)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `must not repeat "${item}"`,
        });
      }
      seen.add(item);
    }
  });
const optionSchema = z.strictObject({ label: identifier, value: identifier });
const optionListSchema = z
  .array(optionSchema)
  .max(npDiscoveryContractLimits.fields)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.value)) {
        context.addIssue({
          code: "custom",
          path: [index, "value"],
          message: `must not repeat "${item.value}"`,
        });
      }
      seen.add(item.value);
    }
  });

const jsonSchema: z.ZodType<NpDiscoveryJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

const collectionFieldTypes = [
  "text",
  "textarea",
  "number",
  "richText",
  "blocks",
  "checkbox",
  "date",
  "upload",
  "relationship",
  "select",
  "radio",
  "email",
  "json",
  "array",
  "group",
  "row",
  "collapsible",
] as const;

const collectionFieldSchema: z.ZodType<NpCollectionDiscoveryItem["fields"][number]> = z.lazy(() =>
  z
    .strictObject({
      name: identifier,
      type: z.enum(collectionFieldTypes),
      source: identifier,
      label: identifier.optional(),
      description: text().optional(),
      required: z.boolean().optional(),
      defaultValue: jsonSchema.optional(),
      options: optionListSchema.optional(),
      relationTo: z.union([identifier, stringList]).optional(),
      hasMany: z.boolean().optional(),
      integerOnly: z.boolean().optional(),
      fields: z.array(collectionFieldSchema).max(npDiscoveryContractLimits.fields).optional(),
    })
    .superRefine((field, context) => {
      const nested =
        field.type === "array" ||
        field.type === "group" ||
        field.type === "row" ||
        field.type === "collapsible";
      if (nested !== (field.fields !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["fields"],
          message: nested
            ? `is required for ${field.type} fields`
            : `is not supported for ${field.type} fields`,
        });
      }
      const optionField = field.type === "select" || field.type === "radio";
      if (optionField !== (field.options !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: optionField
            ? `is required for ${field.type} fields`
            : `is not supported for ${field.type} fields`,
        });
      }
      const relationField = field.type === "relationship" || field.type === "upload";
      if (relationField !== (field.relationTo !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["relationTo"],
          message: relationField
            ? `is required for ${field.type} fields`
            : `is not supported for ${field.type} fields`,
        });
      }
      if (field.hasMany !== undefined && field.type !== "select" && field.type !== "relationship") {
        context.addIssue({
          code: "custom",
          path: ["hasMany"],
          message: `is not supported for ${field.type} fields`,
        });
      }
      if (field.integerOnly !== undefined && field.type !== "number") {
        context.addIssue({
          code: "custom",
          path: ["integerOnly"],
          message: `is not supported for ${field.type} fields`,
        });
      }
      if (field.type === "collapsible" && field.label === undefined) {
        context.addIssue({
          code: "custom",
          path: ["label"],
          message: "is required for collapsible fields",
        });
      }
    }),
);

const collectionItemSchema: z.ZodType<NpCollectionDiscoveryItem> = z
  .strictObject({
    slug: identifier,
    source: identifier,
    labels: z.strictObject({ singular: identifier, plural: identifier }),
    description: text().optional(),
    slug_auto: z.boolean(),
    i18n: z.boolean(),
    timestamps: z.boolean(),
    versions: z.strictObject({ drafts: z.boolean(), max: z.number().int().positive().optional() }),
    fields: z.array(collectionFieldSchema).max(npDiscoveryContractLimits.fields),
  })
  .superRefine((item, context) => {
    const visit = (
      fields: NpCollectionDiscoveryField[],
      path: Array<string | number>,
      names: Map<string, Array<string | number>>,
    ): void => {
      for (const [index, field] of fields.entries()) {
        const fieldPath = [...path, index];
        if (field.type === "row" || field.type === "collapsible") {
          visit(field.fields ?? [], [...fieldPath, "fields"], names);
          continue;
        }
        const previous = names.get(field.name);
        if (previous) {
          context.addIssue({
            code: "custom",
            path: [...fieldPath, "name"],
            message: `must not repeat "${field.name}"; first declared at ${previous.join(".")}`,
          });
        } else {
          names.set(field.name, [...fieldPath, "name"]);
        }
        if (field.type === "group" || field.type === "array") {
          visit(field.fields ?? [], [...fieldPath, "fields"], new Map());
        }
      }
    };
    visit(item.fields, ["fields"], new Map());
  });

const blockPropName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/u)
  .refine((value) => !hasUnsafeText(value), "unsafe text");
const blockText = (maximum: number) =>
  text(maximum).refine((value) => value.trim().length > 0, "must contain non-whitespace text");
const blockPropLabel = blockText(100);
const blockPropDescription = blockText(500);
const blockPropPlaceholder = blockText(200);
const blockPropValidationMessage = blockText(300);
const blockOptionListSchema = z
  .array(z.strictObject({ label: blockText(100), value: blockText(200) }))
  .min(1)
  .max(npDiscoveryContractLimits.fields)
  .superRefine((items, context) => {
    const values = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (values.has(item.value)) {
        context.addIssue({
          code: "custom",
          path: [index, "value"],
          message: `must not repeat "${item.value}"`,
        });
      }
      values.add(item.value);
    }
  });
const conditionValueSchema = z.union([
  z.string().max(npDiscoveryContractLimits.jsonStringLength),
  z.number().finite(),
  z.boolean(),
]);
const conditionSchema = z.tuple([blockPropName, conditionValueSchema]);
const conditionListSchema = z
  .array(conditionSchema)
  .min(1)
  .max(npDiscoveryContractLimits.fields)
  .superRefine((conditions, context) => {
    const names = new Set<string>();
    for (const [index, [name]] of conditions.entries()) {
      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          path: [index, 0],
          message: `must not repeat condition prop "${name}"`,
        });
      }
      names.add(name);
    }
  });

const blockPropFieldCommonShape = {
  name: blockPropName,
  label: blockPropLabel,
  required: z.boolean().optional(),
  description: blockPropDescription.optional(),
  group: blockText(100).optional(),
  hiddenWhen: conditionListSchema.optional(),
  visibleWhen: conditionListSchema.optional(),
} as const;

const patternShape = {
  pattern: blockText(npDiscoveryContractLimits.textLength).optional(),
  validationMessage: blockPropValidationMessage.optional(),
} as const;

const stringDefault = z.string().max(npDiscoveryContractLimits.jsonStringLength).optional();
const objectSchema = z.record(z.string(), jsonSchema);

const blockPropFieldSchema: z.ZodType<NpBlockDiscoveryPropField> = z.lazy(() =>
  z
    .discriminatedUnion("type", [
      z.strictObject({
        ...blockPropFieldCommonShape,
        ...patternShape,
        type: z.literal("text"),
        translatable: z.boolean(),
        defaultValue: stringDefault,
        placeholder: blockPropPlaceholder.optional(),
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("textarea"),
        translatable: z.boolean(),
        defaultValue: stringDefault,
        placeholder: blockPropPlaceholder.optional(),
        rows: z.number().int().positive().optional(),
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("number"),
        defaultValue: z.number().finite().optional(),
        placeholder: blockPropPlaceholder.optional(),
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        step: z.number().finite().positive().optional(),
        validationMessage: blockPropValidationMessage.optional(),
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("boolean"),
        defaultValue: z.boolean().optional(),
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("select"),
        defaultValue: stringDefault,
        options: blockOptionListSchema,
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        ...patternShape,
        type: z.literal("url"),
        defaultValue: stringDefault,
        placeholder: blockPropPlaceholder.optional(),
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("richtext"),
        translatable: z.boolean(),
        defaultValue: jsonSchema
          .refine((value) => npValidateRichTextContent(value).ok, "must be NexPress rich text v1")
          .transform((value) => value as unknown as NpRichTextContent)
          .optional(),
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("image"),
        defaultValue: stringDefault,
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("color"),
        defaultValue: stringDefault,
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("collection"),
        defaultValue: stringDefault,
      }),
      z.strictObject({
        ...blockPropFieldCommonShape,
        type: z.literal("array"),
        defaultValue: z
          .array(objectSchema)
          .max(npDiscoveryContractLimits.jsonArrayItems)
          .optional(),
        itemSchema: z.array(blockPropFieldSchema).max(npDiscoveryContractLimits.fields),
        itemDefault: objectSchema.optional(),
      }),
    ])
    .superRefine((field, context) => {
      if (field.type === "number") {
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
          context.addIssue({ code: "custom", path: ["min"], message: "must not exceed max" });
        }
        if (
          field.validationMessage !== undefined &&
          field.min === undefined &&
          field.max === undefined &&
          field.step === undefined
        ) {
          context.addIssue({
            code: "custom",
            path: ["validationMessage"],
            message: "requires min, max, or step",
          });
        }
      }
      if (field.type === "text" || field.type === "url") {
        if (field.validationMessage !== undefined && field.pattern === undefined) {
          context.addIssue({
            code: "custom",
            path: ["validationMessage"],
            message: "requires pattern",
          });
        }
        if (field.pattern !== undefined) {
          try {
            new RegExp(field.pattern);
          } catch {
            context.addIssue({ code: "custom", path: ["pattern"], message: "must be valid" });
          }
        }
      }
    }),
);

interface BlockRefinementContext {
  addIssue(issue: { code: "custom"; path: Array<string | number>; message: string }): void;
}

function addBlockValueIssue(
  field: NpBlockDiscoveryPropField,
  value: unknown,
  path: Array<string | number>,
  context: BlockRefinementContext,
): void {
  let message: string | null = null;
  if (
    field.type === "text" ||
    field.type === "textarea" ||
    field.type === "url" ||
    field.type === "image" ||
    field.type === "color" ||
    field.type === "collection"
  ) {
    if (typeof value !== "string") {
      message = "must be a string";
    } else if ((field.type === "text" || field.type === "url") && field.pattern !== undefined) {
      try {
        if (!new RegExp(`^(?:${field.pattern})$`).test(value)) message = "must satisfy pattern";
      } catch {
        message = "must use a valid pattern";
      }
    }
  } else if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      message = "must be a finite number";
    } else if (field.min !== undefined && value < field.min) {
      message = `must be greater than or equal to ${field.min.toString()}`;
    } else if (field.max !== undefined && value > field.max) {
      message = `must be less than or equal to ${field.max.toString()}`;
    } else if (field.step !== undefined) {
      const quotient = (value - (field.min ?? 0)) / field.step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        message = `must align to step ${field.step.toString()}`;
      }
    }
  } else if (field.type === "boolean") {
    if (typeof value !== "boolean") message = "must be boolean";
  } else if (field.type === "select") {
    if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
      message = "must be one of the declared option values";
    }
  } else if (field.type === "richtext") {
    if (!npValidateRichTextContent(value).ok) message = "must be NexPress rich text v1";
  } else if (field.type === "array") {
    if (!Array.isArray(value)) {
      message = "must be an array";
    } else {
      for (const [index, item] of value.entries()) {
        if (
          typeof item !== "object" ||
          item === null ||
          Array.isArray(item) ||
          (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        ) {
          context.addIssue({
            code: "custom",
            path: [...path, index],
            message: "must be an object",
          });
          continue;
        }
        addBlockPropsIssues(
          field.itemSchema,
          item as Record<string, unknown>,
          [...path, index],
          context,
        );
      }
    }
  } else {
    const exhaustive: never = field;
    return exhaustive;
  }
  if (message) context.addIssue({ code: "custom", path, message });
}

function addBlockPropsIssues(
  schema: readonly NpBlockDiscoveryPropField[],
  props: Record<string, unknown>,
  path: Array<string | number>,
  context: BlockRefinementContext,
): void {
  const fields = new Map(schema.map((field) => [field.name, field]));
  for (const key of Object.keys(props)) {
    if (!fields.has(key)) {
      context.addIssue({ code: "custom", path: [...path, key], message: "is not declared" });
    }
  }
  for (const field of schema) {
    if (Object.hasOwn(props, field.name)) {
      addBlockValueIssue(field, props[field.name], [...path, field.name], context);
    }
  }
}

function addBlockPropSchemaIssues(
  schema: readonly NpBlockDiscoveryPropField[],
  path: Array<string | number>,
  context: BlockRefinementContext,
  depth = 0,
): void {
  if (depth > npDiscoveryContractLimits.blockSchemaDepth) {
    context.addIssue({
      code: "custom",
      path,
      message: `exceeds the maximum nesting depth of ${npDiscoveryContractLimits.blockSchemaDepth.toString()}`,
    });
    return;
  }
  const fields = new Map<string, NpBlockDiscoveryPropField>();
  for (const [index, field] of schema.entries()) {
    const fieldPath = [...path, index];
    if (fields.has(field.name)) {
      context.addIssue({
        code: "custom",
        path: [...fieldPath, "name"],
        message: `must not repeat "${field.name}"`,
      });
    }
    fields.set(field.name, field);
    if (field.defaultValue !== undefined) {
      addBlockValueIssue(field, field.defaultValue, [...fieldPath, "defaultValue"], context);
    }
    if (field.type === "array") {
      addBlockPropSchemaIssues(field.itemSchema, [...fieldPath, "itemSchema"], context, depth + 1);
      if (field.itemDefault !== undefined) {
        addBlockPropsIssues(
          field.itemSchema,
          field.itemDefault,
          [...fieldPath, "itemDefault"],
          context,
        );
      }
    }
  }

  for (const [index, field] of schema.entries()) {
    for (const key of ["hiddenWhen", "visibleWhen"] as const) {
      for (const [conditionIndex, [name, expected]] of (field[key] ?? []).entries()) {
        const conditionPath = [...path, index, key, conditionIndex];
        const target = fields.get(name);
        if (!target) {
          context.addIssue({
            code: "custom",
            path: [...conditionPath, 0],
            message: `references unknown sibling prop "${name}"`,
          });
        } else if (target === field) {
          context.addIssue({
            code: "custom",
            path: [...conditionPath, 0],
            message: "must not reference its own field",
          });
        } else if (target.type === "array" || target.type === "richtext") {
          context.addIssue({
            code: "custom",
            path: [...conditionPath, 0],
            message: `cannot reference ${target.type}; conditions support scalar fields only`,
          });
        } else {
          addBlockValueIssue(target, expected, [...conditionPath, 1], context);
        }
      }
    }
  }
}

const blockItemSchema: z.ZodType<NpBlockDiscoveryItem> = z
  .strictObject({
    type: identifier,
    label: identifier,
    source: identifier,
    description: text().optional(),
    icon: identifier.optional(),
    iconKind: z.enum(["lucide", "emoji"]).optional(),
    category: identifier.optional(),
    keywords: stringList,
    defaultProps: z.record(z.string(), jsonSchema),
    propsSchema: z.array(blockPropFieldSchema).max(npDiscoveryContractLimits.fields),
    acceptsChildren: z.boolean(),
    summaryFields: stringList,
    allowedChildTypes: stringList,
    minChildren: z.number().int().nonnegative().optional(),
    maxChildren: z.number().int().nonnegative().optional(),
  })
  .superRefine((item, context) => {
    if (
      item.minChildren !== undefined &&
      item.maxChildren !== undefined &&
      item.minChildren > item.maxChildren
    ) {
      context.addIssue({
        code: "custom",
        path: ["minChildren"],
        message: "must not exceed maxChildren",
      });
    }
    if (
      !item.acceptsChildren &&
      (item.allowedChildTypes.length > 0 ||
        item.minChildren !== undefined ||
        item.maxChildren !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptsChildren"],
        message: "must be true when child constraints are present",
      });
    }
    const propNames = new Set(item.propsSchema.map((field) => field.name));
    addBlockPropSchemaIssues(item.propsSchema, ["propsSchema"], context);
    addBlockPropsIssues(item.propsSchema, item.defaultProps, ["defaultProps"], context);
    for (const [index, name] of item.summaryFields.entries()) {
      if (!propNames.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["summaryFields", index],
          message: `references unknown prop "${name}"`,
        });
      }
    }
  });

const providesShape = Object.fromEntries(
  npPluginDiscoveryProvideKeys.map((key) => [key, stringList]),
) as Record<(typeof npPluginDiscoveryProvideKeys)[number], typeof stringList>;

const pluginItemSchema: z.ZodType<NpPluginDiscoveryItem> = z
  .strictObject({
    apiVersion: z.union([z.literal("1"), z.null()]),
    legacy: z.boolean(),
    id: identifier,
    name: identifier,
    version: z.union([identifier, z.null()]),
    description: z.union([text(), z.null()]),
    author: z.union([
      z.strictObject({
        name: identifier,
        url: z.url().max(npDiscoveryContractLimits.textLength).optional(),
      }),
      z.null(),
    ]),
    license: z.union([identifier, z.null()]),
    nexpress: z.union([
      z.strictObject({ minVersion: identifier, maxVersion: z.union([identifier, z.null()]) }),
      z.null(),
    ]),
    capabilities: stringList,
    allowedHosts: stringList,
    requires: stringList,
    provides: z.strictObject(providesShape),
    agent: z.strictObject({
      description: z.string().max(npDiscoveryContractLimits.textLength),
      category: z.union([identifier, z.null()]),
      tags: stringList,
      configSchema: z.record(z.string(), jsonSchema).optional(),
    }),
    usesTokens: stringList,
    styleSlots: z.record(identifier, text()),
    hooks: stringList,
    routes: z
      .array(
        z.strictObject({
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
          path: identifier,
          description: text().optional(),
          auth: z.boolean(),
        }),
      )
      .max(npDiscoveryContractLimits.fields),
    pageRoutes: z
      .array(
        z.strictObject({
          pattern: identifier,
          surface: z.enum(["site", "member"]),
          locale: z.enum(["auto", "none"]),
        }),
      )
      .max(npDiscoveryContractLimits.fields),
    scheduledTasks: z
      .array(
        z.strictObject({
          id: identifier,
          cron: identifier,
          description: text().optional(),
        }),
      )
      .max(npDiscoveryContractLimits.fields),
    actions: z
      .array(
        z.strictObject({
          id: identifier,
          kind: z.enum(["action", "metric", "status", "table"]),
          source: z.enum(["definition", "setup"]),
          description: text().optional(),
        }),
      )
      .max(npDiscoveryContractLimits.fields),
  })
  .superRefine((item, context) => {
    if (item.legacy !== (item.apiVersion === null)) {
      context.addIssue({
        code: "custom",
        path: ["legacy"],
        message: "must be true exactly when apiVersion is null",
      });
    }
    for (const [path, values] of [
      ["routes", item.routes.map((route) => `${route.method} ${route.path}`)],
      ["pageRoutes", item.pageRoutes.map((route) => route.pattern)],
      ["scheduledTasks", item.scheduledTasks.map((task) => task.id)],
      ["actions", item.actions.map((action) => action.id)],
    ] as const) {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          context.addIssue({
            code: "custom",
            path: [path, index],
            message: `must not repeat "${value}"`,
          });
        }
        seen.add(value);
      }
    }
  });

function analyze<T>(
  value: unknown,
  itemSchema: z.ZodType<T>,
  identity: (item: T) => string,
): NpDiscoveryContractResult<{ items: T[] }> {
  const issues: NpDiscoveryContractIssue[] = [];
  const cloned = cloneJson(value, "$", 0, { nodes: 0, ancestors: new Set() }, issues);
  if (cloned === INVALID || issues.length > 0) {
    return { ok: false, value: null, issues: Object.freeze(issues) };
  }
  const schema = z.strictObject({
    items: z.array(itemSchema).max(npDiscoveryContractLimits.items),
  });
  const parsed = schema.safeParse(cloned);
  if (!parsed.success) {
    for (const entry of parsed.error.issues) {
      issue(
        issues,
        entry.code === "unrecognized_keys"
          ? "unknown-field"
          : entry.code === "too_big"
            ? "limit"
            : "invalid-field",
        entry.path.length === 0 ? "$" : `$.${entry.path.join(".")}`,
        entry.message,
      );
    }
  }
  if (parsed.success) {
    const seen = new Set<string>();
    for (const [index, item] of parsed.data.items.entries()) {
      const id = identity(item);
      if (seen.has(id))
        issue(
          issues,
          "duplicate",
          `$.items[${index.toString()}]`,
          `duplicates discovery identity "${id}".`,
        );
      seen.add(id);
    }
    if (issues.length === 0) return { ok: true, value: parsed.data, issues: [] };
  }
  return { ok: false, value: null, issues: Object.freeze(issues) };
}

function requireResult<T>(result: NpDiscoveryContractResult<T>, message: string): T {
  if (result.ok) return result.value;
  throw new NpDiscoveryContractError(message, result.issues);
}

export function npAnalyzeCollectionDiscoveryResponse(
  value: unknown,
): NpDiscoveryContractResult<NpCollectionDiscoveryResponse> {
  return analyze(value, collectionItemSchema, (item) => item.slug);
}

export function npRequireCollectionDiscoveryResponse(
  value: unknown,
): NpCollectionDiscoveryResponse {
  return requireResult(
    npAnalyzeCollectionDiscoveryResponse(value),
    "Invalid collection discovery response",
  );
}

export function npAnalyzeBlockDiscoveryResponse(
  value: unknown,
): NpDiscoveryContractResult<NpBlockDiscoveryResponse> {
  return analyze(value, blockItemSchema, (item) => item.type);
}

export function npRequireBlockDiscoveryResponse(value: unknown): NpBlockDiscoveryResponse {
  return requireResult(npAnalyzeBlockDiscoveryResponse(value), "Invalid block discovery response");
}

export function npAnalyzePluginDiscoveryResponse(
  value: unknown,
): NpDiscoveryContractResult<NpPluginDiscoveryResponse> {
  return analyze(value, pluginItemSchema, (item) => item.id);
}

export function npRequirePluginDiscoveryResponse(value: unknown): NpPluginDiscoveryResponse {
  return requireResult(
    npAnalyzePluginDiscoveryResponse(value),
    "Invalid plugin discovery response",
  );
}
