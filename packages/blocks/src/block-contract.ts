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
  "media",
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

const propFieldKeys = new Set([
  "name",
  "label",
  "type",
  "required",
  "defaultValue",
  "options",
  "description",
  "placeholder",
  "min",
  "max",
  "step",
  "pattern",
  "patternMessage",
  "rows",
  "group",
  "hiddenWhen",
  "visibleWhen",
  "itemSchema",
  "itemDefault",
  "accept",
]);

const optionKeys = new Set(["label", "value"]);
const propFieldTypeSet = new Set<string>(npBlockPropFieldTypes);
const blockTypePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const propNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/u;
const maxNestedSchemaDepth = 8;
const maxSerializableDepth = 32;

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

function unsupportedKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

function isNonEmptyString(value: unknown, maxLength = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateOptionalString(
  value: unknown,
  path: string,
  maxLength = 500,
): NpBlockDefinitionValidationResult {
  return value === undefined || isNonEmptyString(value, maxLength)
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
  if (!Array.isArray(value)) return invalid(`${path} must be an array of [propName, value] pairs.`);
  for (const [index, condition] of value.entries()) {
    if (
      !Array.isArray(condition) ||
      condition.length !== 2 ||
      typeof condition[0] !== "string" ||
      !propNamePattern.test(condition[0])
    ) {
      return invalid(`${path}[${index.toString()}] must be a [propName, value] pair.`);
    }
    const serializable = validateSerializable(
      condition[1],
      `${path}[${index.toString()}][1]`,
      0,
      new WeakSet(),
    );
    if (!serializable.ok) return serializable;
  }
  return valid();
}

function validateSerializable(
  value: unknown,
  path: string,
  depth: number,
  activeValues: WeakSet<object>,
): NpBlockDefinitionValidationResult {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return valid();
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
    for (const [index, item] of value.entries()) {
      const result = validateSerializable(
        item,
        `${path}[${index.toString()}]`,
        depth + 1,
        activeValues,
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
  for (const [key, item] of Object.entries(value)) {
    const result = validateSerializable(item, `${path}.${key}`, depth + 1, activeValues);
    if (!result.ok) {
      activeValues.delete(value);
      return result;
    }
  }
  activeValues.delete(value);
  return valid();
}

function validateOptions(value: unknown, path: string): NpBlockDefinitionValidationResult {
  if (!Array.isArray(value) || value.length === 0) {
    return invalid(`${path} must contain at least one option.`);
  }
  const values = new Set<string>();
  for (const [index, option] of value.entries()) {
    if (!isPlainRecord(option)) return invalid(`${path}[${index.toString()}] must be an object.`);
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
  const extra = unsupportedKey(value, propFieldKeys);
  if (extra) return invalid(`${path} has unsupported field "${extra}".`);
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
  if (value.required !== undefined && typeof value.required !== "boolean") {
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
    ["patternMessage", 300],
    ["group", 100],
  ] as const) {
    const result = validateOptionalString(value[key], `${path}.${key}`, maxLength);
    if (!result.ok) return result;
  }

  if (value.options !== undefined || value.type === "select") {
    if (value.type !== "select")
      return invalid(`${path}.options is supported only for select fields.`);
    const result = validateOptions(value.options, `${path}.options`);
    if (!result.ok) return result;
  }

  const numericKeys = ["min", "max", "step"] as const;
  for (const key of numericKeys) {
    if (value[key] === undefined) continue;
    if (value.type !== "number")
      return invalid(`${path}.${key} is supported only for number fields.`);
    const result = validateFiniteNumber(value[key], `${path}.${key}`);
    if (!result.ok) return result;
  }
  if (typeof value.step === "number" && value.step <= 0) {
    return invalid(`${path}.step must be greater than 0.`);
  }
  if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) {
    return invalid(`${path}.min must be less than or equal to max.`);
  }

  if (value.pattern !== undefined) {
    if (value.type !== "text" && value.type !== "url") {
      return invalid(`${path}.pattern is supported only for text and url fields.`);
    }
    if (typeof value.pattern !== "string") return invalid(`${path}.pattern must be a string.`);
    try {
      new RegExp(value.pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return invalid(`${path}.pattern is not a valid regular expression: ${reason}`);
    }
  }
  if (value.patternMessage !== undefined && value.pattern === undefined) {
    return invalid(`${path}.patternMessage requires pattern.`);
  }

  if (value.rows !== undefined) {
    if (value.type !== "textarea")
      return invalid(`${path}.rows is supported only for textarea fields.`);
    if (!Number.isInteger(value.rows) || (value.rows as number) <= 0) {
      return invalid(`${path}.rows must be a positive integer.`);
    }
  }

  if (value.placeholder !== undefined) {
    const supported = new Set(["text", "textarea", "url", "number"]);
    if (!supported.has(value.type)) {
      return invalid(`${path}.placeholder is not supported for ${value.type} fields.`);
    }
  }

  for (const key of ["hiddenWhen", "visibleWhen"] as const) {
    if (value[key] === undefined) continue;
    const result = validateConditions(value[key], `${path}.${key}`);
    if (!result.ok) return result;
  }

  if (value.type === "array") {
    if (value.itemSchema === undefined)
      return invalid(`${path}.itemSchema is required for array fields.`);
    const result = validatePropSchema(
      value.itemSchema,
      `${path}.itemSchema`,
      depth + 1,
      activeSchemas,
    );
    if (!result.ok) return result;
    if (value.itemDefault !== undefined && !isPlainRecord(value.itemDefault)) {
      return invalid(`${path}.itemDefault must be an object.`);
    }
    if (value.itemDefault !== undefined) {
      const serializable = validateSerializable(
        value.itemDefault,
        `${path}.itemDefault`,
        0,
        new WeakSet(),
      );
      if (!serializable.ok) return serializable;
    }
  } else if (value.itemSchema !== undefined || value.itemDefault !== undefined) {
    return invalid(`${path}.itemSchema and itemDefault are supported only for array fields.`);
  }

  if (value.accept !== undefined) {
    if (value.type !== "media")
      return invalid(`${path}.accept is supported only for media fields.`);
    const result = validateStringArray(value.accept, `${path}.accept`);
    if (!result.ok) return result;
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
  if (value.acceptsChildren !== undefined && typeof value.acceptsChildren !== "boolean") {
    return invalid("block.acceptsChildren must be boolean.");
  }
  if (value.iconKind !== undefined && value.iconKind !== "lucide" && value.iconKind !== "emoji") {
    return invalid('block.iconKind must be "lucide" or "emoji".');
  }

  const propNames = new Set(
    (value.propsSchema as Array<{ name: string }>).map((field) => field.name),
  );
  if (value.summaryFields !== undefined) {
    const result = validateStringArray(value.summaryFields, "block.summaryFields", propNamePattern);
    if (!result.ok) return result;
    const missing = (value.summaryFields as string[]).find((field) => !propNames.has(field));
    if (missing) return invalid(`block.summaryFields references unknown prop "${missing}".`);
  }
  if (value.keywords !== undefined) {
    const result = validateStringArray(value.keywords, "block.keywords");
    if (!result.ok) return result;
  }
  if (value.allowedChildTypes !== undefined) {
    const result = validateStringArray(value.allowedChildTypes, "block.allowedChildTypes");
    if (!result.ok) return result;
    const invalidType = (value.allowedChildTypes as string[]).find(
      (type) => type !== "*" && !blockTypePattern.test(type),
    );
    if (invalidType)
      return invalid(`block.allowedChildTypes contains invalid type "${invalidType}".`);
  }
  for (const key of ["minChildren", "maxChildren"] as const) {
    if (value[key] === undefined) continue;
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
  return valid();
}

export function npAnalyzeBlockDefinitions(value: unknown): NpBlockDefinitionIssue[] {
  if (!Array.isArray(value)) {
    return [{ code: "invalid-list", message: "blocks must be an array." }];
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
    if (!isPlainRecord(block) || typeof block.type !== "string" || block.type.length === 0) {
      continue;
    }
    if (types.has(block.type)) {
      issues.push({
        code: "duplicate-type",
        index,
        type: block.type,
        message: `duplicate block type "${block.type}".`,
      });
    }
    types.add(block.type);
  }
  return issues;
}
