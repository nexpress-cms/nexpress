export type NpPatternDefinitionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export type NpPatternDefinitionIssueCode =
  "invalid-list" | "invalid-definition" | "duplicate-id" | "unknown-block-type";

export interface NpPatternDefinitionIssue {
  readonly code: NpPatternDefinitionIssueCode;
  readonly message: string;
  readonly index?: number;
  readonly id?: string;
  readonly blockType?: string;
}

export interface NpPatternDefinitionAnalysisOptions {
  readonly knownBlockTypes?: ReadonlySet<string>;
}

const patternKeys = new Set([
  "id",
  "label",
  "description",
  "source",
  "blocks",
  "preview",
  "category",
]);
const blockInstanceKeys = new Set(["id", "type", "props", "children"]);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const maxBlockTreeDepth = 32;
const maxSerializableDepth = 32;

function valid(): NpPatternDefinitionValidationResult {
  return { ok: true };
}

function invalid(message: string): NpPatternDefinitionValidationResult {
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

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateOptionalString(
  value: unknown,
  path: string,
  maxLength: number,
): NpPatternDefinitionValidationResult {
  return value === undefined || isNonEmptyString(value, maxLength)
    ? valid()
    : invalid(
        `${path} must be a non-empty string with at most ${maxLength.toString()} characters.`,
      );
}

function validateSerializable(
  value: unknown,
  path: string,
  depth: number,
  activeValues: WeakSet<object>,
): NpPatternDefinitionValidationResult {
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

function validateBlockInstance(
  value: unknown,
  path: string,
  depth: number,
  activeBlocks: WeakSet<object>,
): NpPatternDefinitionValidationResult {
  if (!isPlainRecord(value)) return invalid(`${path} must be an object.`);
  if (depth > maxBlockTreeDepth) {
    return invalid(
      `${path} exceeds the maximum block tree depth of ${maxBlockTreeDepth.toString()}.`,
    );
  }
  if (activeBlocks.has(value)) return invalid(`${path} must not contain a circular block tree.`);
  activeBlocks.add(value);

  const extra = unsupportedKey(value, blockInstanceKeys);
  if (extra) {
    activeBlocks.delete(value);
    return invalid(`${path} has unsupported field "${extra}".`);
  }
  if (!isNonEmptyString(value.id, 128) || !identifierPattern.test(value.id)) {
    activeBlocks.delete(value);
    return invalid(
      `${path}.id must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  if (!isNonEmptyString(value.type, 128) || !identifierPattern.test(value.type)) {
    activeBlocks.delete(value);
    return invalid(
      `${path}.type must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  if (!isPlainRecord(value.props)) {
    activeBlocks.delete(value);
    return invalid(`${path}.props must be an object.`);
  }
  const propsResult = validateSerializable(value.props, `${path}.props`, 0, new WeakSet());
  if (!propsResult.ok) {
    activeBlocks.delete(value);
    return propsResult;
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) {
      activeBlocks.delete(value);
      return invalid(`${path}.children must be an array.`);
    }
    for (const [index, child] of value.children.entries()) {
      const childResult = validateBlockInstance(
        child,
        `${path}.children[${index.toString()}]`,
        depth + 1,
        activeBlocks,
      );
      if (!childResult.ok) {
        activeBlocks.delete(value);
        return childResult;
      }
    }
  }

  activeBlocks.delete(value);
  return valid();
}

function validatePattern(
  value: unknown,
  requireSource: boolean,
): NpPatternDefinitionValidationResult {
  if (!isPlainRecord(value)) return invalid("pattern definition must be an object.");
  const extra = unsupportedKey(value, patternKeys);
  if (extra) return invalid(`pattern definition has unsupported field "${extra}".`);
  if (!isNonEmptyString(value.id, 128) || !identifierPattern.test(value.id)) {
    return invalid(
      "pattern.id must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.",
    );
  }
  if (!isNonEmptyString(value.label, 100)) {
    return invalid("pattern.label must be a non-empty string with at most 100 characters.");
  }
  for (const [key, maxLength] of [
    ["description", 500],
    ["preview", 2_048],
    ["category", 100],
  ] as const) {
    const result = validateOptionalString(value[key], `pattern.${key}`, maxLength);
    if (!result.ok) return result;
  }
  if (requireSource && value.source === undefined) {
    return invalid("pattern.source must be assigned before registration.");
  }
  const sourceResult = validateOptionalString(value.source, "pattern.source", 200);
  if (!sourceResult.ok) return sourceResult;
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) {
    return invalid("pattern.blocks must contain at least one block instance.");
  }
  const activeBlocks = new WeakSet<object>();
  for (const [index, block] of value.blocks.entries()) {
    const result = validateBlockInstance(
      block,
      `pattern.blocks[${index.toString()}]`,
      0,
      activeBlocks,
    );
    if (!result.ok) return result;
  }
  return valid();
}

/** Validates an author contribution before bootstrap assigns its source. */
export function npValidatePatternDefinition(value: unknown): NpPatternDefinitionValidationResult {
  return validatePattern(value, false);
}

/** Validates the concrete runtime shape accepted by the shared registry. */
export function npValidatePattern(value: unknown): NpPatternDefinitionValidationResult {
  return validatePattern(value, true);
}

export function npAnalyzePatternDefinitions(
  value: unknown,
  options: NpPatternDefinitionAnalysisOptions = {},
): NpPatternDefinitionIssue[] {
  if (!Array.isArray(value)) {
    return [{ code: "invalid-list", message: "patterns must be an array." }];
  }
  const issues: NpPatternDefinitionIssue[] = [];
  const ids = new Set<string>();
  for (const [index, pattern] of value.entries()) {
    const validation = npValidatePatternDefinition(pattern);
    if (!validation.ok) {
      issues.push({
        code: "invalid-definition",
        index,
        message: `invalid pattern at index ${index.toString()}: ${validation.message}`,
      });
    }
    if (validation.ok && options.knownBlockTypes) {
      const blockTypes = new Set<string>();
      collectBlockTypes((pattern as Record<string, unknown>).blocks as unknown[], blockTypes);
      for (const blockType of blockTypes) {
        if (options.knownBlockTypes.has(blockType)) continue;
        const id = (pattern as Record<string, unknown>).id as string;
        issues.push({
          code: "unknown-block-type",
          index,
          id,
          blockType,
          message: `pattern "${id}" references unknown block type "${blockType}".`,
        });
      }
    }
    if (!isPlainRecord(pattern) || typeof pattern.id !== "string" || pattern.id.length === 0) {
      continue;
    }
    if (ids.has(pattern.id)) {
      issues.push({
        code: "duplicate-id",
        index,
        id: pattern.id,
        message: `duplicate pattern id "${pattern.id}".`,
      });
    }
    ids.add(pattern.id);
  }
  return issues;
}

function collectBlockTypes(blocks: unknown[], result: Set<string>): void {
  for (const block of blocks) {
    const record = block as Record<string, unknown>;
    result.add(record.type as string);
    if (Array.isArray(record.children)) collectBlockTypes(record.children, result);
  }
}
