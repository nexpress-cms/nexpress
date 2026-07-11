import { npValidateBlockContent, npValidateRichTextContent } from "@nexpress/core/fields";

import type { NpBlockInstance, NpBlockMetadata, NpBlockPropField } from "./types.js";

export type NpBlockContentIssueSeverity = "error" | "warning";

export type NpBlockContentIssueCode =
  | "invalid-content"
  | "unknown-block-type"
  | "missing-required-prop"
  | "invalid-prop"
  | "unknown-prop"
  | "unexpected-children"
  | "disallowed-child-type"
  | "too-many-children"
  | "too-few-children";

export interface NpBlockContentIssue {
  readonly code: NpBlockContentIssueCode;
  readonly severity: NpBlockContentIssueSeverity;
  readonly message: string;
  readonly path: string;
  readonly blockId?: string;
  readonly blockType?: string;
  readonly propName?: string;
}

export type NpBlockContentContractResult =
  | {
      readonly ok: true;
      readonly value: NpBlockInstance[];
      readonly warnings: NpBlockContentIssue[];
    }
  | { readonly ok: false; readonly issues: NpBlockContentIssue[] };

const STRING_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "url",
  "image",
  "color",
  "collection",
  "media",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isFieldHidden(field: NpBlockPropField, props: Record<string, unknown>): boolean {
  if (
    field.hiddenWhen?.length &&
    field.hiddenWhen.every(([name, expected]) => props[name] === expected)
  ) {
    return true;
  }
  return Boolean(
    field.visibleWhen?.length &&
    field.visibleWhen.some(([name, expected]) => props[name] !== expected),
  );
}

function issue(
  code: NpBlockContentIssueCode,
  severity: NpBlockContentIssueSeverity,
  message: string,
  path: string,
  block: NpBlockInstance,
  propName?: string,
): NpBlockContentIssue {
  return {
    code,
    severity,
    message,
    path,
    blockId: block.id,
    blockType: block.type,
    ...(propName ? { propName } : {}),
  };
}

function validatePattern(value: string, pattern: string): boolean {
  const sourceWithoutAnchors = pattern.replace(/^\^/u, "").replace(/\$$/u, "");
  return new RegExp(`^(?:${sourceWithoutAnchors})$`).test(value);
}

function isStepAligned(value: number, step: number, base: number): boolean {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-9;
}

function analyzeFieldValue(
  field: NpBlockPropField,
  rawValue: unknown,
  props: Record<string, unknown>,
  path: string,
  block: NpBlockInstance,
  issues: NpBlockContentIssue[],
): void {
  if (isFieldHidden(field, props)) return;

  if (rawValue === undefined) {
    if (field.defaultValue !== undefined) {
      analyzeFieldValue(field, field.defaultValue, props, path, block, issues);
      return;
    }
    if (field.required === true) {
      issues.push(
        issue(
          "missing-required-prop",
          "error",
          `Block "${block.type}" requires prop "${field.name}".`,
          path,
          block,
          field.name,
        ),
      );
    }
    return;
  }

  if (field.required === true && isMissing(rawValue)) {
    issues.push(
      issue(
        "missing-required-prop",
        "error",
        `Block "${block.type}" requires a non-empty "${field.name}" prop.`,
        path,
        block,
        field.name,
      ),
    );
    return;
  }

  let reason: string | null = null;
  if (STRING_FIELD_TYPES.has(field.type)) {
    if (typeof rawValue !== "string") reason = "must be a string";
    else if (
      (field.type === "text" || field.type === "url") &&
      field.pattern &&
      rawValue.length > 0 &&
      !validatePattern(rawValue, field.pattern)
    ) {
      reason = field.patternMessage ?? `must match pattern ${field.pattern}`;
    }
  } else if (field.type === "number") {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      reason = "must be a finite number";
    } else if (field.min !== undefined && rawValue < field.min) {
      reason = field.patternMessage ?? `must be greater than or equal to ${field.min.toString()}`;
    } else if (field.max !== undefined && rawValue > field.max) {
      reason = field.patternMessage ?? `must be less than or equal to ${field.max.toString()}`;
    } else if (field.step !== undefined && !isStepAligned(rawValue, field.step, field.min ?? 0)) {
      reason = `must align to step ${field.step.toString()}`;
    }
  } else if (field.type === "boolean") {
    if (typeof rawValue !== "boolean") reason = "must be a boolean";
  } else if (field.type === "select") {
    if (typeof rawValue !== "string") {
      reason = "must be a string";
    } else if (!field.options?.some((option) => option.value === rawValue)) {
      reason = "must be one of the registered option values";
    }
  } else if (field.type === "richtext") {
    const validation = npValidateRichTextContent(rawValue);
    if (!validation.ok) reason = validation.message;
  } else if (field.type === "array") {
    if (!Array.isArray(rawValue)) {
      reason = "must be an array";
    } else {
      for (const [index, itemValue] of rawValue.entries()) {
        const itemPath = `${path}[${index.toString()}]`;
        if (!isPlainRecord(itemValue)) {
          issues.push(
            issue(
              "invalid-prop",
              "error",
              `Block "${block.type}" prop "${field.name}" item ${index.toString()} must be an object.`,
              itemPath,
              block,
              field.name,
            ),
          );
          continue;
        }
        analyzePropSchema(field.itemSchema ?? [], itemValue, itemPath, block, issues);
      }
    }
  }

  if (reason) {
    issues.push(
      issue(
        "invalid-prop",
        "error",
        `Block "${block.type}" prop "${field.name}" ${reason}.`,
        path,
        block,
        field.name,
      ),
    );
  }
}

function analyzePropSchema(
  schema: readonly NpBlockPropField[],
  props: Record<string, unknown>,
  path: string,
  block: NpBlockInstance,
  issues: NpBlockContentIssue[],
): void {
  const knownProps = new Set(schema.map((field) => field.name));
  for (const propName of Object.keys(props)) {
    if (propName === "_layout" || knownProps.has(propName)) continue;
    issues.push(
      issue(
        "unknown-prop",
        "warning",
        `Block "${block.type}" has unregistered prop "${propName}"; it is preserved but ignored by the current schema.`,
        `${path}.${propName}`,
        block,
        propName,
      ),
    );
  }
  for (const field of schema) {
    analyzeFieldValue(field, props[field.name], props, `${path}.${field.name}`, block, issues);
  }
}

/** Checks one props object without applying container-child rules. */
export function npAnalyzeBlockProps(
  value: unknown,
  definition: NpBlockMetadata,
): NpBlockContentIssue[] {
  const synthetic = {
    id: "props-contract",
    type: definition.type,
    props: value,
  };
  const structural = npValidateBlockContent([synthetic]);
  if (!structural.ok) {
    return [
      {
        code: "invalid-content",
        severity: "error",
        message: structural.message,
        path: "block props",
        blockId: synthetic.id,
        blockType: synthetic.type,
      },
    ];
  }
  const issues: NpBlockContentIssue[] = [];
  analyzePropSchema(
    definition.propsSchema,
    structural.value[0].props,
    "block props",
    structural.value[0],
    issues,
  );
  return issues;
}

function analyzeBlock(
  block: NpBlockInstance,
  path: string,
  definitions: ReadonlyMap<string, NpBlockMetadata>,
  issues: NpBlockContentIssue[],
): void {
  const definition = definitions.get(block.type);
  if (!definition) {
    issues.push(
      issue(
        "unknown-block-type",
        "warning",
        `Block type "${block.type}" is not registered; its content is preserved.`,
        path,
        block,
      ),
    );
  } else {
    analyzePropSchema(definition.propsSchema, block.props, `${path}.props`, block, issues);

    const children = block.children ?? [];
    if (definition.acceptsChildren !== true && children.length > 0) {
      issues.push(
        issue(
          "unexpected-children",
          "error",
          `Leaf block "${block.type}" cannot contain child blocks.`,
          `${path}.children`,
          block,
        ),
      );
    }
    if (definition.minChildren !== undefined && children.length < definition.minChildren) {
      issues.push(
        issue(
          "too-few-children",
          "warning",
          `Block "${block.type}" recommends at least ${definition.minChildren.toString()} child blocks.`,
          `${path}.children`,
          block,
        ),
      );
    }
    if (definition.maxChildren !== undefined && children.length > definition.maxChildren) {
      issues.push(
        issue(
          "too-many-children",
          "error",
          `Block "${block.type}" allows at most ${definition.maxChildren.toString()} child blocks.`,
          `${path}.children`,
          block,
        ),
      );
    }
    const allowed = definition.allowedChildTypes;
    if (allowed?.length && !allowed.includes("*")) {
      for (const [index, child] of children.entries()) {
        if (allowed.includes(child.type)) continue;
        issues.push(
          issue(
            "disallowed-child-type",
            "error",
            `Block "${block.type}" does not allow child type "${child.type}".`,
            `${path}.children[${index.toString()}]`,
            block,
          ),
        );
      }
    }
  }

  for (const [index, child] of (block.children ?? []).entries()) {
    analyzeBlock(child, `${path}.children[${index.toString()}]`, definitions, issues);
  }
}

function toDefinitionMap(
  definitions: Iterable<NpBlockMetadata>,
): ReadonlyMap<string, NpBlockMetadata> {
  if (definitions instanceof Map) return definitions;
  return new Map(Array.from(definitions, (definition) => [definition.type, definition]));
}

/**
 * Checks structurally valid block content against the currently registered
 * block definitions. Unknown types and stale props are warnings so disabling
 * a plugin never destroys stored content; known schema/container mismatches
 * are errors and can be rejected before save or render.
 */
export function npAnalyzeBlockContent(
  value: unknown,
  definitions: Iterable<NpBlockMetadata>,
): NpBlockContentIssue[] {
  const structural = npValidateBlockContent(value);
  if (!structural.ok) {
    return [
      {
        code: "invalid-content",
        severity: "error",
        message: structural.message,
        path: "block content",
      },
    ];
  }

  const issues: NpBlockContentIssue[] = [];
  const byType = toDefinitionMap(definitions);
  for (const [index, block] of structural.value.entries()) {
    analyzeBlock(block, `block content[${index.toString()}]`, byType, issues);
  }
  return issues;
}

export function npValidateBlockContentAgainstDefinitions(
  value: unknown,
  definitions: Iterable<NpBlockMetadata>,
): NpBlockContentContractResult {
  const issues = npAnalyzeBlockContent(value, definitions);
  const errors = issues.filter((entry) => entry.severity === "error");
  if (errors.length > 0) return { ok: false, issues };

  const structural = npValidateBlockContent(value);
  if (!structural.ok) return { ok: false, issues };
  return {
    ok: true,
    value: structural.value,
    warnings: issues.filter((entry) => entry.severity === "warning"),
  };
}
