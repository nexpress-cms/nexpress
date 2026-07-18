import { npAnalyzeBlockProps } from "./content-contract.js";
import type { NpBlockMetadata, NpBlockPropField } from "./types.js";

export const npBlockPropFieldTypes = [
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "url",
  "richtext",
  "image",
  "color",
  "collection",
  "array",
] as const;

export type NpBlockPropFieldType = (typeof npBlockPropFieldTypes)[number];

export type NpBlockDefinitionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export type NpBlockDefinitionIssueCode = "invalid-list" | "invalid-definition" | "duplicate-type";

export interface NpBlockDefinitionIssue {
  readonly code: NpBlockDefinitionIssueCode;
  readonly message: string;
  readonly index?: number;
  readonly type?: string;
}

const blockDefinitionKeys = new Set([
  "type",
  "label",
  "description",
  "icon",
  "defaultProps",
  "propsSchema",
  "acceptsChildren",
  "summaryFields",
  "category",
  "keywords",
  "source",
  "allowedChildTypes",
  "minChildren",
  "maxChildren",
  "iconKind",
  "render",
]);

const commonPropFieldKeys = [
  "name",
  "label",
  "type",
  "required",
  "defaultValue",
  "description",
  "group",
  "hiddenWhen",
  "visibleWhen",
] as const;

const propFieldKeysByType: Record<NpBlockPropFieldType, ReadonlySet<string>> = {
  text: new Set([
    ...commonPropFieldKeys,
    "translatable",
    "placeholder",
    "pattern",
    "validationMessage",
  ]),
  textarea: new Set([...commonPropFieldKeys, "translatable", "placeholder", "rows"]),
  number: new Set([
    ...commonPropFieldKeys,
    "placeholder",
    "min",
    "max",
    "step",
    "validationMessage",
  ]),
  boolean: new Set(commonPropFieldKeys),
  select: new Set([...commonPropFieldKeys, "options"]),
  url: new Set([...commonPropFieldKeys, "placeholder", "pattern", "validationMessage"]),
  richtext: new Set([...commonPropFieldKeys, "translatable"]),
  image: new Set(commonPropFieldKeys),
  color: new Set(commonPropFieldKeys),
  collection: new Set(commonPropFieldKeys),
  array: new Set([...commonPropFieldKeys, "itemSchema", "itemDefault"]),
};

const optionKeys = new Set(["label", "value"]);
const propFieldTypeSet = new Set<string>(npBlockPropFieldTypes);
const blockTypePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const propNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/u;
const maxNestedSchemaDepth = 8;
const maxSerializableDepth = 64;
const maxSerializableNodes = 20_000;
const maxSerializableStringLength = 100_000;
const maxSerializableArrayItems = 2_000;
const maxSerializableObjectKeys = 2_000;
const maxSerializableKeyLength = 256;
const maxSchemaFields = 1_000;
const maxFieldOptions = 1_000;
const maxFieldConditions = 1_000;

function valid(): NpBlockDefinitionValidationResult {
  return { ok: true };
}

function invalid(message: string): NpBlockDefinitionValidationResult {
  return { ok: false, message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
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

function unsupportedKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

function validateDataRecord(
  value: Record<string, unknown>,
  path: string,
): NpBlockDefinitionValidationResult {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return invalid(`${path} must not contain symbol properties.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return invalid(`${path}.${key} must be an enumerable data property.`);
    }
  }
  return valid();
}

function validateDataArray(value: unknown[], path: string): NpBlockDefinitionValidationResult {
  const extra = Reflect.ownKeys(value).find((key) => {
    if (typeof key !== "string") return true;
    if (key === "length") return false;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
    return Number(key) >= value.length;
  });
  if (extra !== undefined) {
    return invalid(
      typeof extra === "symbol"
        ? `${path} must not contain symbol properties.`
        : `${path} has unsupported array property "${extra}".`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      return invalid(`${path}[${index.toString()}] must be an enumerable data property.`);
    }
  }
  return valid();
}

function isNonEmptyString(value: unknown, maxLength = 500): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !hasUnsafeText(value)
  );
}

function validateOptionalString(
  value: unknown,
  path: string,
  maxLength = 500,
): NpBlockDefinitionValidationResult {
  return isNonEmptyString(value, maxLength)
    ? valid()
    : invalid(
        `${path} must be a non-empty string with at most ${maxLength.toString()} characters.`,
      );
}

function validateStringArray(
  value: unknown,
  path: string,
  itemPattern?: RegExp,
): NpBlockDefinitionValidationResult {
  if (!Array.isArray(value)) return invalid(`${path} must be an array.`);
  const arrayShape = validateDataArray(value, path);
  if (!arrayShape.ok) return arrayShape;
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item, 128) || (itemPattern && !itemPattern.test(item))) {
      return invalid(`${path}[${index.toString()}] must be a supported non-empty string.`);
    }
    if (seen.has(item)) return invalid(`${path} must not repeat "${item}".`);
    seen.add(item);
  }
  return valid();
}

function validateConditions(value: unknown, path: string): NpBlockDefinitionValidationResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxFieldConditions) {
    return invalid(
      `${path} must contain between 1 and ${maxFieldConditions.toString()} [propName, value] pairs.`,
    );
  }
  const arrayShape = validateDataArray(value, path);
  if (!arrayShape.ok) return arrayShape;
  const names = new Set<string>();
  for (const [index, condition] of value.entries()) {
    if (!Array.isArray(condition) || condition.length !== 2) {
      return invalid(`${path}[${index.toString()}] must be a [propName, value] pair.`);
    }
    const conditionShape = validateDataArray(condition, `${path}[${index.toString()}]`);
    if (!conditionShape.ok) return conditionShape;
    if (
      typeof condition[0] !== "string" ||
      condition[0].length > 128 ||
      !propNamePattern.test(condition[0])
    ) {
      return invalid(`${path}[${index.toString()}] must be a [propName, value] pair.`);
    }
    if (names.has(condition[0])) {
      return invalid(`${path} must not repeat condition prop "${condition[0]}".`);
    }
    names.add(condition[0]);
    if (
      typeof condition[1] !== "string" &&
      typeof condition[1] !== "boolean" &&
      (typeof condition[1] !== "number" || !Number.isFinite(condition[1]))
    ) {
      return invalid(
        `${path}[${index.toString()}][1] must be a string, finite number, or boolean.`,
      );
    }
    if (
      typeof condition[1] === "string" &&
      (condition[1].length > maxSerializableStringLength || hasUnsafeText(condition[1]))
    ) {
      return invalid(`${path}[${index.toString()}][1] must contain bounded well-formed text.`);
    }
  }
  return valid();
}

function validateSerializable(
  value: unknown,
  path: string,
  depth: number,
  activeValues: WeakSet<object>,
  state: { nodes: number } = { nodes: 0 },
): NpBlockDefinitionValidationResult {
  state.nodes += 1;
  if (state.nodes > maxSerializableNodes) {
    return invalid(`${path} exceeds the maximum of ${maxSerializableNodes.toString()} values.`);
  }
  if (value === null || typeof value === "boolean") {
    return valid();
  }
  if (typeof value === "string") {
    if (value.length > maxSerializableStringLength) {
      return invalid(
        `${path} must contain strings with at most ${maxSerializableStringLength.toString()} characters.`,
      );
    }
    return hasUnsafeText(value) ? invalid(`${path} must contain well-formed text.`) : valid();
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? valid()
      : invalid(`${path} must not contain a non-finite number.`);
  }
  if (typeof value !== "object") return invalid(`${path} must contain only serializable values.`);
  if (depth > maxSerializableDepth) {
    return invalid(
      `${path} exceeds the maximum serializable depth of ${maxSerializableDepth.toString()}.`,
    );
  }
  if (activeValues.has(value)) return invalid(`${path} must not contain circular values.`);
  activeValues.add(value);
  if (Array.isArray(value)) {
    if (value.length > maxSerializableArrayItems) {
      activeValues.delete(value);
      return invalid(
        `${path} must contain at most ${maxSerializableArrayItems.toString()} array items.`,
      );
    }
    const arrayShape = validateDataArray(value, path);
    if (!arrayShape.ok) {
      activeValues.delete(value);
      return arrayShape;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
      const item = descriptor && "value" in descriptor ? descriptor.value : undefined;
      const result = validateSerializable(
        item,
        `${path}[${index.toString()}]`,
        depth + 1,
        activeValues,
        state,
      );
      if (!result.ok) {
        activeValues.delete(value);
        return result;
      }
    }
    activeValues.delete(value);
    return valid();
  }
  if (!isPlainRecord(value)) {
    activeValues.delete(value);
    return invalid(`${path} must contain only arrays and plain objects.`);
  }
  const recordShape = validateDataRecord(value, path);
  if (!recordShape.ok) {
    activeValues.delete(value);
    return recordShape;
  }
  const keys = Object.keys(value);
  if (keys.length > maxSerializableObjectKeys) {
    activeValues.delete(value);
    return invalid(
      `${path} must contain at most ${maxSerializableObjectKeys.toString()} object keys.`,
    );
  }
  for (const key of keys) {
    if (key.length === 0 || key.length > maxSerializableKeyLength || hasUnsafeText(key)) {
      activeValues.delete(value);
      return invalid(
        `${path} keys must contain between 1 and ${maxSerializableKeyLength.toString()} characters.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const item = descriptor && "value" in descriptor ? descriptor.value : undefined;
    const result = validateSerializable(item, `${path}.${key}`, depth + 1, activeValues, state);
    if (!result.ok) {
      activeValues.delete(value);
      return result;
    }
  }
  activeValues.delete(value);
  return valid();
}

function validateOptions(value: unknown, path: string): NpBlockDefinitionValidationResult {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxFieldOptions) {
    return invalid(`${path} must contain between 1 and ${maxFieldOptions.toString()} options.`);
  }
  const arrayShape = validateDataArray(value, path);
  if (!arrayShape.ok) return arrayShape;
  const values = new Set<string>();
  for (const [index, option] of value.entries()) {
    if (!isPlainRecord(option)) return invalid(`${path}[${index.toString()}] must be an object.`);
    const recordShape = validateDataRecord(option, `${path}[${index.toString()}]`);
    if (!recordShape.ok) return recordShape;
    const extra = unsupportedKey(option, optionKeys);
    if (extra) return invalid(`${path}[${index.toString()}] has unsupported field "${extra}".`);
    if (!isNonEmptyString(option.label, 100)) {
      return invalid(`${path}[${index.toString()}].label must be a non-empty string.`);
    }
    if (!isNonEmptyString(option.value, 200)) {
      return invalid(`${path}[${index.toString()}].value must be a non-empty string.`);
    }
    if (values.has(option.value)) {
      return invalid(`${path} must not repeat option value "${option.value}".`);
    }
    values.add(option.value);
  }
  return valid();
}

function validateFiniteNumber(value: unknown, path: string): NpBlockDefinitionValidationResult {
  return typeof value === "number" && Number.isFinite(value)
    ? valid()
    : invalid(`${path} must be a finite number.`);
}

function validatePropField(
  value: unknown,
  path: string,
  depth: number,
  activeSchemas: WeakSet<object>,
): NpBlockDefinitionValidationResult {
  if (!isPlainRecord(value)) return invalid(`${path} must be an object.`);
  const recordShape = validateDataRecord(value, path);
  if (!recordShape.ok) return recordShape;
  if (!isNonEmptyString(value.name, 128) || !propNamePattern.test(value.name)) {
    return invalid(
      `${path}.name must be an identifier using letters, numbers, underscores, or hyphens.`,
    );
  }
  if (!isNonEmptyString(value.label, 100)) {
    return invalid(`${path}.label must be a non-empty string.`);
  }
  if (typeof value.type !== "string" || !propFieldTypeSet.has(value.type)) {
    return invalid(`${path}.type must be one of ${npBlockPropFieldTypes.join(", ")}.`);
  }
  const type = value.type as NpBlockPropFieldType;
  const extra = unsupportedKey(value, propFieldKeysByType[type]);
  if (extra) return invalid(`${path}.${extra} is not supported for ${type} fields.`);

  const textual = value.type === "text" || value.type === "textarea" || value.type === "richtext";
  if (textual && typeof value.translatable !== "boolean") {
    return invalid(`${path}.translatable must be boolean for ${value.type} fields.`);
  }
  if (Object.hasOwn(value, "required") && typeof value.required !== "boolean") {
    return invalid(`${path}.required must be boolean.`);
  }
  if (Object.hasOwn(value, "defaultValue")) {
    const result = validateSerializable(
      value.defaultValue,
      `${path}.defaultValue`,
      0,
      new WeakSet(),
    );
    if (!result.ok) return result;
  }
  for (const [key, maxLength] of [
    ["description", 500],
    ["placeholder", 200],
    ["validationMessage", 300],
    ["group", 100],
  ] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const result = validateOptionalString(value[key], `${path}.${key}`, maxLength);
    if (!result.ok) return result;
  }

  if (value.type === "select") {
    const result = validateOptions(value.options, `${path}.options`);
    if (!result.ok) return result;
  }

  const numericKeys = ["min", "max", "step"] as const;
  for (const key of numericKeys) {
    if (!Object.hasOwn(value, key)) continue;
    const result = validateFiniteNumber(value[key], `${path}.${key}`);
    if (!result.ok) return result;
  }
  if (typeof value.step === "number" && value.step <= 0) {
    return invalid(`${path}.step must be greater than 0.`);
  }
  if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) {
    return invalid(`${path}.min must be less than or equal to max.`);
  }

  if (Object.hasOwn(value, "pattern")) {
    if (!isNonEmptyString(value.pattern, 2_000)) {
      return invalid(`${path}.pattern must be a non-empty string with at most 2000 characters.`);
    }
    try {
      new RegExp(value.pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return invalid(`${path}.pattern is not a valid regular expression: ${reason}`);
    }
  }
  if (
    Object.hasOwn(value, "validationMessage") &&
    value.type !== "number" &&
    !Object.hasOwn(value, "pattern")
  ) {
    return invalid(`${path}.validationMessage requires pattern.`);
  }
  if (
    Object.hasOwn(value, "validationMessage") &&
    value.type === "number" &&
    !Object.hasOwn(value, "min") &&
    !Object.hasOwn(value, "max") &&
    !Object.hasOwn(value, "step")
  ) {
    return invalid(`${path}.validationMessage requires min, max, or step.`);
  }

  if (Object.hasOwn(value, "rows")) {
    if (!Number.isInteger(value.rows) || (value.rows as number) <= 0) {
      return invalid(`${path}.rows must be a positive integer.`);
    }
  }

  for (const key of ["hiddenWhen", "visibleWhen"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const result = validateConditions(value[key], `${path}.${key}`);
    if (!result.ok) return result;
  }

  if (value.type === "array") {
    if (!Object.hasOwn(value, "itemSchema"))
      return invalid(`${path}.itemSchema is required for array fields.`);
    const result = validatePropSchema(
      value.itemSchema,
      `${path}.itemSchema`,
      depth + 1,
      activeSchemas,
    );
    if (!result.ok) return result;
    if (Object.hasOwn(value, "itemDefault") && !isPlainRecord(value.itemDefault)) {
      return invalid(`${path}.itemDefault must be an object.`);
    }
    if (Object.hasOwn(value, "itemDefault")) {
      const serializable = validateSerializable(
        value.itemDefault,
        `${path}.itemDefault`,
        0,
        new WeakSet(),
      );
      if (!serializable.ok) return serializable;
    }
  }
  return valid();
}

function validateConditionValue(
  field: NpBlockPropField,
  value: unknown,
  path: string,
): NpBlockDefinitionValidationResult {
  if (
    field.type === "text" ||
    field.type === "textarea" ||
    field.type === "url" ||
    field.type === "image" ||
    field.type === "color" ||
    field.type === "collection"
  ) {
    if (typeof value !== "string") return invalid(`${path} must be a string.`);
    if (
      (field.type === "text" || field.type === "url") &&
      field.pattern &&
      !new RegExp(`^(?:${field.pattern})$`).test(value)
    ) {
      return invalid(`${path} must satisfy the referenced field pattern.`);
    }
    return valid();
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return invalid(`${path} must be a finite number.`);
    }
    if (field.min !== undefined && value < field.min) {
      return invalid(`${path} must be greater than or equal to ${field.min.toString()}.`);
    }
    if (field.max !== undefined && value > field.max) {
      return invalid(`${path} must be less than or equal to ${field.max.toString()}.`);
    }
    if (field.step !== undefined) {
      const quotient = (value - (field.min ?? 0)) / field.step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        return invalid(`${path} must align to step ${field.step.toString()}.`);
      }
    }
    return valid();
  }
  if (field.type === "boolean") {
    return typeof value === "boolean" ? valid() : invalid(`${path} must be boolean.`);
  }
  if (field.type === "select") {
    return typeof value === "string" && field.options.some((option) => option.value === value)
      ? valid()
      : invalid(`${path} must be one of the referenced select option values.`);
  }
  return invalid(`${path} cannot reference ${field.type}; conditions support scalar fields only.`);
}

function withoutConditions(field: NpBlockPropField): NpBlockPropField {
  const { hiddenWhen: _hiddenWhen, visibleWhen: _visibleWhen, ...unconditional } = field;
  if (field.type === "array") {
    return {
      ...unconditional,
      itemSchema: field.itemSchema.map((nested) => withoutConditions(nested)),
    } as NpBlockPropField;
  }
  return unconditional;
}

function withoutSchemaConditions(schema: readonly NpBlockPropField[]): NpBlockPropField[] {
  return schema.map((field) => withoutConditions(field));
}

function validateSchemaSemantics(
  schema: readonly NpBlockPropField[],
  path: string,
): NpBlockDefinitionValidationResult {
  const fields = new Map(schema.map((field) => [field.name, field]));
  for (const [index, field] of schema.entries()) {
    const fieldPath = `${path}[${index.toString()}]`;
    for (const key of ["hiddenWhen", "visibleWhen"] as const) {
      for (const [conditionIndex, [name, expected]] of (field[key] ?? []).entries()) {
        const conditionPath = `${fieldPath}.${key}[${conditionIndex.toString()}]`;
        const target = fields.get(name);
        if (!target) return invalid(`${conditionPath} references unknown sibling prop "${name}".`);
        if (target === field) return invalid(`${conditionPath} must not reference its own field.`);
        const result = validateConditionValue(target, expected, `${conditionPath}[1]`);
        if (!result.ok) return result;
      }
    }

    if (Object.hasOwn(field, "defaultValue")) {
      const defaultIssue = npAnalyzeBlockProps(
        { [field.name]: field.defaultValue },
        {
          type: "prop-default-contract",
          label: "Prop default contract",
          defaultProps: {},
          propsSchema: [withoutConditions(field)],
        },
      ).find((issue) => issue.code !== "missing-required-prop");
      if (defaultIssue) {
        return invalid(
          `${fieldPath}.defaultValue violates its field contract: ${defaultIssue.message}`,
        );
      }
    }

    if (field.type === "array" && field.itemDefault !== undefined) {
      const itemIssue = npAnalyzeBlockProps(field.itemDefault, {
        type: "array-item-default-contract",
        label: "Array item default contract",
        defaultProps: {},
        propsSchema: withoutSchemaConditions(field.itemSchema),
      }).find((issue) => issue.code !== "missing-required-prop");
      if (itemIssue) {
        return invalid(`${fieldPath}.itemDefault violates itemSchema: ${itemIssue.message}`);
      }
    }
  }
  return valid();
}

function validatePropSchema(
  value: unknown,
  path: string,
  depth: number,
  activeSchemas: WeakSet<object>,
): NpBlockDefinitionValidationResult {
  if (!Array.isArray(value)) return invalid(`${path} must be an array.`);
  const arrayShape = validateDataArray(value, path);
  if (!arrayShape.ok) return arrayShape;
  if (value.length > maxSchemaFields) {
    return invalid(`${path} must contain at most ${maxSchemaFields.toString()} fields.`);
  }
  if (depth > maxNestedSchemaDepth) {
    return invalid(
      `${path} exceeds the maximum nesting depth of ${maxNestedSchemaDepth.toString()}.`,
    );
  }
  if (activeSchemas.has(value)) return invalid(`${path} must not contain a circular schema.`);
  activeSchemas.add(value);
  const names = new Set<string>();
  for (const [index, field] of value.entries()) {
    const result = validatePropField(field, `${path}[${index.toString()}]`, depth, activeSchemas);
    if (!result.ok) {
      activeSchemas.delete(value);
      return result;
    }
    const name = (field as { name: string }).name;
    if (names.has(name)) {
      activeSchemas.delete(value);
      return invalid(`${path} must not repeat field name "${name}".`);
    }
    names.add(name);
  }
  const semanticResult = validateSchemaSemantics(value as NpBlockPropField[], path);
  if (!semanticResult.ok) {
    activeSchemas.delete(value);
    return semanticResult;
  }
  activeSchemas.delete(value);
  return valid();
}

function validateChildCount(value: unknown, path: string): NpBlockDefinitionValidationResult {
  return Number.isInteger(value) && (value as number) >= 0
    ? valid()
    : invalid(`${path} must be a non-negative integer.`);
}

export function npValidateBlockDefinition(value: unknown): NpBlockDefinitionValidationResult {
  if (!isPlainRecord(value)) return invalid("block definition must be an object.");
  const recordShape = validateDataRecord(value, "block");
  if (!recordShape.ok) return recordShape;
  const extra = unsupportedKey(value, blockDefinitionKeys);
  if (extra) return invalid(`block definition has unsupported field "${extra}".`);
  if (!isNonEmptyString(value.type, 128) || !blockTypePattern.test(value.type)) {
    return invalid(
      "block.type must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.",
    );
  }
  if (!isNonEmptyString(value.label, 100)) {
    return invalid("block.label must be a non-empty string.");
  }
  for (const [key, maxLength] of [
    ["description", 500],
    ["icon", 100],
    ["category", 100],
    ["source", 200],
  ] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const result = validateOptionalString(value[key], `block.${key}`, maxLength);
    if (!result.ok) return result;
  }
  if (!isPlainRecord(value.defaultProps)) {
    return invalid("block.defaultProps must be an object.");
  }
  const defaultsResult = validateSerializable(
    value.defaultProps,
    "block.defaultProps",
    0,
    new WeakSet(),
  );
  if (!defaultsResult.ok) return defaultsResult;
  const schemaResult = validatePropSchema(value.propsSchema, "block.propsSchema", 0, new WeakSet());
  if (!schemaResult.ok) return schemaResult;
  if (typeof value.render !== "function") return invalid("block.render must be a function.");
  if (Object.hasOwn(value, "acceptsChildren") && typeof value.acceptsChildren !== "boolean") {
    return invalid("block.acceptsChildren must be boolean.");
  }
  if (
    Object.hasOwn(value, "iconKind") &&
    value.iconKind !== "lucide" &&
    value.iconKind !== "emoji"
  ) {
    return invalid('block.iconKind must be "lucide" or "emoji".');
  }

  const propNames = new Set(
    (value.propsSchema as Array<{ name: string }>).map((field) => field.name),
  );
  if (Object.hasOwn(value, "summaryFields")) {
    const result = validateStringArray(value.summaryFields, "block.summaryFields", propNamePattern);
    if (!result.ok) return result;
    const missing = (value.summaryFields as string[]).find((field) => !propNames.has(field));
    if (missing) return invalid(`block.summaryFields references unknown prop "${missing}".`);
  }
  if (Object.hasOwn(value, "keywords")) {
    const result = validateStringArray(value.keywords, "block.keywords");
    if (!result.ok) return result;
  }
  if (Object.hasOwn(value, "allowedChildTypes")) {
    const result = validateStringArray(value.allowedChildTypes, "block.allowedChildTypes");
    if (!result.ok) return result;
    const invalidType = (value.allowedChildTypes as string[]).find(
      (type) => type !== "*" && !blockTypePattern.test(type),
    );
    if (invalidType)
      return invalid(`block.allowedChildTypes contains invalid type "${invalidType}".`);
  }
  for (const key of ["minChildren", "maxChildren"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const result = validateChildCount(value[key], `block.${key}`);
    if (!result.ok) return result;
  }
  if (
    (value.allowedChildTypes !== undefined ||
      value.minChildren !== undefined ||
      value.maxChildren !== undefined) &&
    value.acceptsChildren !== true
  ) {
    return invalid(
      "block.allowedChildTypes, minChildren, and maxChildren require acceptsChildren: true.",
    );
  }
  if (
    typeof value.minChildren === "number" &&
    typeof value.maxChildren === "number" &&
    value.minChildren > value.maxChildren
  ) {
    return invalid("block.minChildren must be less than or equal to maxChildren.");
  }
  const defaultIssue = npAnalyzeBlockProps(value.defaultProps, {
    ...(value as unknown as NpBlockMetadata),
    propsSchema: withoutSchemaConditions(value.propsSchema as NpBlockPropField[]),
  }).find((issue) => issue.code !== "missing-required-prop");
  if (defaultIssue) {
    return invalid(`block.defaultProps violates propsSchema: ${defaultIssue.message}`);
  }
  return valid();
}

export function npAnalyzeBlockDefinitions(value: unknown): NpBlockDefinitionIssue[] {
  if (!Array.isArray(value)) {
    return [{ code: "invalid-list", message: "blocks must be an array." }];
  }
  const listShape = validateDataArray(value, "blocks");
  if (!listShape.ok) {
    return [{ code: "invalid-list", message: listShape.message }];
  }
  const issues: NpBlockDefinitionIssue[] = [];
  const types = new Set<string>();
  for (const [index, block] of value.entries()) {
    const validation = npValidateBlockDefinition(block);
    if (!validation.ok) {
      issues.push({
        code: "invalid-definition",
        index,
        message: `invalid block at index ${index.toString()}: ${validation.message}`,
      });
    }
    if (!isPlainRecord(block)) {
      continue;
    }
    const typeDescriptor = Object.getOwnPropertyDescriptor(block, "type");
    if (
      !typeDescriptor ||
      !("value" in typeDescriptor) ||
      typeof typeDescriptor.value !== "string" ||
      typeDescriptor.value.length === 0
    ) {
      continue;
    }
    const type = typeDescriptor.value;
    if (types.has(type)) {
      issues.push({
        code: "duplicate-type",
        index,
        type,
        message: `duplicate block type "${type}".`,
      });
    }
    types.add(type);
  }
  return issues;
}

export {
  npAnalyzePatternDefinitions,
  npValidatePattern,
  npValidatePatternDefinition,
} from "./pattern-contract.js";
export type {
  NpPatternDefinitionAnalysisOptions,
  NpPatternDefinitionIssue,
  NpPatternDefinitionIssueCode,
  NpPatternDefinitionValidationResult,
} from "./pattern-contract.js";
