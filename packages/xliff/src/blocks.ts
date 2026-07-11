import {
  getRegisteredBlocks,
  type NpBlockDefinition,
  type NpBlockInstance,
  type NpBlockPropField,
} from "@nexpress/blocks";

import type { XliffTransUnit } from "./format.js";
import { applyRichTextXliffValue, createRichTextXliffValue } from "./rich-text.js";

const BLOCK_UNIT_PREFIX = "np:block:";

type PropPath = Array<string | number>;
type TextualField = NpBlockPropField & {
  type: "text" | "textarea" | "richtext";
  translatable: true;
};

interface BlockDescriptor {
  fieldName: string;
  blockId: string;
  blockType: string;
  path: PropPath;
}

interface TranslationSlot extends BlockDescriptor {
  field: TextualField;
  value: unknown;
}

export type BlockXliffApplyResult =
  { ok: true; value: NpBlockInstance[] } | { ok: false; reason: string; empty: boolean };

/**
 * Emit one protected XLIFF unit per schema-declared translatable block prop.
 * Block ids make nested block order irrelevant; array item paths stay
 * positional because block prop arrays do not carry framework-owned ids.
 */
export function createBlockXliffUnits(
  fieldName: string,
  sourceValue: unknown,
  targetValue: unknown,
): XliffTransUnit[] {
  if (fieldName.length === 0 || fieldName.length > 128) return [];
  const definitions = blockDefinitions();
  const source = indexBlocks(sourceValue);
  if (!source) return [];
  const target = indexBlocks(targetValue);
  const units: XliffTransUnit[] = [];

  for (const block of source.ordered) {
    if (!source.unique.has(block.id) || block.id.length > 512) continue;
    const definition = definitions.get(block.type);
    if (!definition) continue;
    const targetBlock = target?.unique.get(block.id);
    const compatibleTarget = targetBlock?.type === block.type ? targetBlock : null;

    for (const slot of collectSlots(fieldName, block, definition.propsSchema)) {
      const id = renderBlockUnitId(slot);
      const targetSlotValue = compatibleTarget
        ? valueAtPath(compatibleTarget.props, slot.path)
        : undefined;

      if (slot.field.type === "richtext") {
        const richText = createRichTextXliffValue(slot.value, targetSlotValue);
        if (!richText) continue;
        units.push({
          id,
          source: richText.source,
          target: richText.target,
          sourceInline: richText.sourceInline,
          targetInline: richText.targetInline,
        });
        continue;
      }

      if (typeof slot.value !== "string" || slot.value.length === 0) continue;
      units.push({
        id,
        source: slot.value,
        target: typeof targetSlotValue === "string" ? targetSlotValue : "",
      });
    }
  }

  return units;
}

export function parseBlockUnitId(id: string): BlockDescriptor | null {
  if (!id.startsWith(BLOCK_UNIT_PREFIX)) return null;
  const parts = id.slice(BLOCK_UNIT_PREFIX.length).split(":");
  if (parts.length !== 4) return null;
  try {
    const [fieldPart, blockPart, typePart, pathPart] = parts as [string, string, string, string];
    const fieldName = decodeURIComponent(fieldPart);
    const blockId = decodeURIComponent(blockPart);
    const blockType = decodeURIComponent(typePart);
    const parsedPath: unknown = JSON.parse(decodeURIComponent(pathPart));
    if (
      !fieldName ||
      fieldName.length > 128 ||
      !blockId ||
      blockId.length > 512 ||
      !blockType ||
      blockType.length > 128 ||
      !isPropPath(parsedPath)
    ) {
      return null;
    }
    return { fieldName, blockId, blockType, path: parsedPath };
  } catch {
    return null;
  }
}

/**
 * Validate a block unit against the live source tree and current registry,
 * then apply it to a cloned working target tree. Missing/ambiguous blocks,
 * stale source text, schema drift, and malformed inline codes fail closed.
 */
export function applyBlockXliffUnit(args: {
  sourceValue: unknown;
  targetValue: unknown;
  unit: XliffTransUnit;
}): BlockXliffApplyResult {
  const descriptor = parseBlockUnitId(args.unit.id);
  if (!descriptor) {
    return { ok: false, reason: "block unit id is malformed", empty: false };
  }

  const definitions = blockDefinitions();
  const definition = definitions.get(descriptor.blockType);
  if (!definition) {
    return {
      ok: false,
      reason: `block type "${descriptor.blockType}" is not registered`,
      empty: false,
    };
  }
  const field = fieldAtPath(definition.propsSchema, descriptor.path);
  if (!field || field.translatable !== true) {
    return {
      ok: false,
      reason: "block prop path is not declared translatable by the registered schema",
      empty: false,
    };
  }

  const source = indexBlocks(args.sourceValue);
  const sourceBlock = source?.unique.get(descriptor.blockId);
  if (!sourceBlock || sourceBlock.type !== descriptor.blockType) {
    return {
      ok: false,
      reason: "source block id is missing, duplicated, or has changed type",
      empty: false,
    };
  }
  const liveSource = valueAtPath(sourceBlock.props, descriptor.path);

  const target = cloneBlocks(args.targetValue);
  if (!target) {
    return { ok: false, reason: "target block field is not a valid array", empty: false };
  }
  const targetIndex = indexBlocks(target);
  const targetBlock = targetIndex?.unique.get(descriptor.blockId);
  if (!targetBlock || targetBlock.type !== descriptor.blockType) {
    return {
      ok: false,
      reason: "target block id is missing, duplicated, or has changed type",
      empty: false,
    };
  }
  const liveTarget = valueAtPath(targetBlock.props, descriptor.path);

  if (field.type === "richtext") {
    const result = applyRichTextXliffValue({
      sourceValue: liveSource,
      targetValue: liveTarget,
      sourceInline: args.unit.sourceInline,
      targetInline: args.unit.targetInline,
    });
    if (!result.ok) return result;
    if (!setValueAtPath(targetBlock.props, descriptor.path, result.value)) {
      return { ok: false, reason: "target block prop path no longer resolves", empty: false };
    }
    return { ok: true, value: target };
  }

  if (args.unit.sourceInline || args.unit.targetInline) {
    return { ok: false, reason: "atomic block prop contains rich-text inline codes", empty: false };
  }
  if (typeof liveSource !== "string" || liveSource.length === 0) {
    return { ok: false, reason: "source block prop has no translatable text", empty: false };
  }
  if (args.unit.source !== liveSource) {
    return {
      ok: false,
      reason: "source block prop text does not match the live document",
      empty: false,
    };
  }
  if (args.unit.target.length === 0) {
    return { ok: false, reason: "block prop target is empty", empty: true };
  }
  if (typeof liveTarget !== "string") {
    return { ok: false, reason: "target block prop path no longer resolves", empty: false };
  }
  if (!setValueAtPath(targetBlock.props, descriptor.path, args.unit.target)) {
    return { ok: false, reason: "target block prop path no longer resolves", empty: false };
  }
  return { ok: true, value: target };
}

export function createBlockImportBaseline(
  sourceValue: unknown,
  targetValue: unknown,
): NpBlockInstance[] | null {
  return cloneBlocks(Array.isArray(targetValue) ? targetValue : sourceValue);
}

function collectSlots(
  fieldName: string,
  block: NpBlockInstance,
  schema: readonly NpBlockPropField[],
  path: PropPath = [],
  value: unknown = block.props,
): TranslationSlot[] {
  if (!isRecord(value)) return [];
  const slots: TranslationSlot[] = [];
  for (const field of schema) {
    const fieldPath = [...path, field.name];
    const fieldValue = value[field.name];
    if (field.type === "array") {
      if (!Array.isArray(fieldValue) || !field.itemSchema) continue;
      for (const [index, item] of fieldValue.entries()) {
        slots.push(
          ...collectSlots(fieldName, block, field.itemSchema, [...fieldPath, index], item),
        );
      }
      continue;
    }
    if (
      field.translatable === true &&
      (field.type === "text" || field.type === "textarea" || field.type === "richtext")
    ) {
      slots.push({
        fieldName,
        blockId: block.id,
        blockType: block.type,
        path: fieldPath,
        field: field as TextualField,
        value: fieldValue,
      });
    }
  }
  return slots;
}

function fieldAtPath(schema: readonly NpBlockPropField[], path: PropPath): TextualField | null {
  let currentSchema = schema;
  for (let index = 0; index < path.length; index++) {
    const name = path[index];
    if (typeof name !== "string") return null;
    const field = currentSchema.find((candidate) => candidate.name === name);
    if (!field) return null;
    if (index === path.length - 1) {
      return field.type === "text" || field.type === "textarea" || field.type === "richtext"
        ? (field as TextualField)
        : null;
    }
    if (field.type !== "array" || !field.itemSchema) return null;
    const itemIndex = path[++index];
    if (typeof itemIndex !== "number") return null;
    currentSchema = field.itemSchema;
  }
  return null;
}

function renderBlockUnitId(descriptor: BlockDescriptor): string {
  return `${BLOCK_UNIT_PREFIX}${encodeURIComponent(descriptor.fieldName)}:${encodeURIComponent(descriptor.blockId)}:${encodeURIComponent(descriptor.blockType)}:${encodeURIComponent(JSON.stringify(descriptor.path))}`;
}

function blockDefinitions(): Map<string, NpBlockDefinition> {
  return new Map(getRegisteredBlocks().map((definition) => [definition.type, definition]));
}

function indexBlocks(value: unknown): {
  ordered: NpBlockInstance[];
  unique: Map<string, NpBlockInstance>;
} | null {
  if (!Array.isArray(value)) return null;
  const ordered: NpBlockInstance[] = [];
  const counts = new Map<string, number>();
  const visit = (candidate: unknown): void => {
    if (!isBlockInstance(candidate)) return;
    ordered.push(candidate);
    counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
    if (Array.isArray(candidate.children)) {
      for (const child of candidate.children) visit(child);
    }
  };
  for (const candidate of value) visit(candidate);
  const unique = new Map<string, NpBlockInstance>();
  for (const block of ordered) {
    if (counts.get(block.id) === 1) unique.set(block.id, block);
  }
  return { ordered, unique };
}

function valueAtPath(root: unknown, path: PropPath): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

function setValueAtPath(root: unknown, path: PropPath, value: unknown): boolean {
  if (path.length === 0) return false;
  let current = root;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index];
    if (typeof segment === "number") {
      if (!Array.isArray(current) || current[segment] === undefined) return false;
      current = current[segment];
    } else {
      if (!isRecord(current) || !(segment in current)) return false;
      current = current[segment];
    }
  }
  const final = path[path.length - 1];
  if (typeof final === "number") {
    if (!Array.isArray(current) || current[final] === undefined) return false;
    current[final] = value;
    return true;
  }
  if (!isRecord(current) || !(final in current)) return false;
  current[final] = value;
  return true;
}

function cloneBlocks(value: unknown): NpBlockInstance[] | null {
  if (!Array.isArray(value)) return null;
  try {
    const cloned: unknown = structuredClone(value);
    return Array.isArray(cloned) ? (cloned as NpBlockInstance[]) : null;
  } catch {
    return null;
  }
}

function isBlockInstance(value: unknown): value is NpBlockInstance {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    isRecord(value.props)
  );
}

function isPropPath(value: unknown): value is PropPath {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 17 &&
    value.every(
      (segment) =>
        (typeof segment === "string" && segment.length > 0 && segment.length <= 128) ||
        (Number.isInteger(segment) && (segment as number) >= 0 && (segment as number) <= 1_000_000),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
