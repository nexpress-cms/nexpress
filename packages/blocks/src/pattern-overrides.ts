import { npValidateBlockContent, type NpBlockContent } from "@nexpress/core/fields";
import {
  npParseBuildJsonV1,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
} from "@nexpress/core/agent-contract";

import { npValidateBlockDefinition } from "./block-contract.js";
import { npAnalyzeBlockContent } from "./content-contract.js";
import type { NpBlockInstance, NpBlockMetadata } from "./types.js";

export interface NpPatternOverridesV1 {
  schemaVersion: "np.pattern-overrides.v1";
  blocks: Array<{ id: string; props: NpAgentJsonObject }>;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const encoder = new TextEncoder();

function fail(message: string): never {
  throw new Error(`Invalid pattern overrides: ${message}`);
}

/** Inspect descriptors before serialization: JSON.stringify itself invokes getters/toJSON. */
function cloneJson(value: unknown): NpAgentJsonValue {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;
  const claim = (size: number): void => {
    bytes += size;
    if (bytes > 4 * 1024 * 1024) fail("JSON exceeds 4 MiB.");
  };
  const string = (entry: string): string => {
    if (entry.length > 512 * 1024) fail("JSON string is too long.");
    claim(encoder.encode(JSON.stringify(entry)).length);
    return entry;
  };
  const visit = (entry: unknown, depth: number): NpAgentJsonValue => {
    if (++nodes > 100_000 || depth > 16) fail("JSON exceeds its depth/node bounds.");
    if (entry === null || typeof entry === "boolean") {
      claim(JSON.stringify(entry).length);
      return entry;
    }
    if (typeof entry === "string") return string(entry);
    if (typeof entry === "number" && Number.isFinite(entry)) {
      claim(JSON.stringify(entry).length);
      return entry;
    }
    if (typeof entry !== "object" || entry === null) fail("only JSON data is accepted.");
    if (ancestors.has(entry)) fail("JSON must not contain cycles.");
    ancestors.add(entry);
    const keys = Reflect.ownKeys(entry);
    let result: NpAgentJsonValue;
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype) fail("array prototype is invalid.");
      const length = Object.getOwnPropertyDescriptor(entry, "length")?.value as unknown;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length > 10_000) {
        fail("array length is invalid.");
      }
      if (keys.length !== length + 1) fail("arrays must be dense and have no extra properties.");
      claim(2 + Math.max(0, length - 1));
      const array: NpAgentJsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, index.toString());
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail("arrays must contain ordinary data elements.");
        }
        array.push(visit(descriptor.value, depth + 1));
      }
      result = array;
    } else {
      if (Object.getPrototypeOf(entry) !== Object.prototype) fail("object prototype is invalid.");
      if (keys.length > 1_024) fail("JSON has too many object properties.");
      claim(2 + Math.max(0, keys.length - 1) + keys.length);
      const object: NpAgentJsonObject = {};
      for (const key of keys) {
        if (typeof key !== "string") fail("JSON cannot contain symbol properties.");
        string(key);
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail("JSON must contain ordinary enumerable data properties.");
        }
        Object.defineProperty(object, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      result = object;
    }
    ancestors.delete(entry);
    return result;
  };
  const inspected = visit(value, 0);
  // Reuse the Core Build JSON owner for Unicode, safe-number and exact byte bounds.
  return npParseBuildJsonV1(JSON.stringify(inspected));
}

function record(value: NpAgentJsonValue, keys?: readonly string[]): NpAgentJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("expected an object.");
  }
  if (
    keys &&
    (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
  ) {
    fail("object has missing or unsupported properties.");
  }
  return value;
}

function compareUtf8(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function cloneDefinitions(definitions: readonly NpBlockMetadata[]): NpBlockMetadata[] {
  if (
    !Array.isArray(definitions) ||
    Object.getPrototypeOf(definitions) !== Array.prototype ||
    definitions.length > 1_000
  ) {
    fail("definitions must be an ordinary array of at most 1,000 entries.");
  }
  const copied: unknown[] = [];
  if (Reflect.ownKeys(definitions).length !== definitions.length + 1) {
    fail("definitions must be a dense array without extra properties.");
  }
  for (let index = 0; index < definitions.length; index += 1) {
    const element = Object.getOwnPropertyDescriptor(definitions, index.toString());
    if (!element?.enumerable || !("value" in element)) fail("invalid definition element.");
    const entry: unknown = element.value;
    if (
      typeof entry !== "object" ||
      entry === null ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      fail("definition must be an ordinary object.");
    }
    const metadata: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) {
        fail("definition must contain ordinary enumerable data properties.");
      }
      if (key === "render") {
        if (typeof descriptor.value !== "function") fail("definition renderer must be a function.");
        continue;
      }
      Object.defineProperty(metadata, key, {
        value: descriptor.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    copied.push(metadata);
  }
  const values = cloneJson(copied);
  if (!Array.isArray(values)) fail("invalid definitions.");
  const types = new Set<string>();
  return values.map((value) => {
    const definition = record(value);
    const validation = npValidateBlockDefinition({
      ...definition,
      render: () => fail("validation must never invoke a renderer."),
    });
    if (!validation.ok) fail(validation.message);
    const metadata = definition as unknown as NpBlockMetadata;
    if (types.has(metadata.type)) fail("duplicate block definition type.");
    types.add(metadata.type);
    return metadata;
  });
}

/**
 * Materialize a pattern's complete props replacements against actual block schemas.
 * `{}` is the no-override shorthand. This does not render, register, merge defaults,
 * or change block ids, types, layout, children or ordering. Every content warning is
 * rejected because Build must resolve exact installed definitions before rendering.
 */
export function npApplyPatternOverridesV1(
  pattern: NpBlockContent,
  overrides: unknown,
  definitions: readonly NpBlockMetadata[],
): NpBlockContent {
  const content = npValidateBlockContent(cloneJson(pattern));
  if (!content.ok) fail(content.message);
  const metadata = cloneDefinitions(definitions);
  const before = npAnalyzeBlockContent(content.value, metadata);
  if (before.length > 0) fail(before[0].message);

  const input = record(cloneJson(overrides));
  if (Object.keys(input).length === 0) return content.value;
  record(input, ["schemaVersion", "blocks"]);
  if (
    input.schemaVersion !== "np.pattern-overrides.v1" ||
    !Array.isArray(input.blocks) ||
    input.blocks.length > 1_000
  ) {
    fail("expected np.pattern-overrides.v1 with at most 1,000 block patches.");
  }
  const byId = new Map<string, NpBlockInstance>();
  const collect = (blocks: NpBlockContent): void => {
    for (const block of blocks) {
      byId.set(block.id, block);
      if (block.children) collect(block.children);
    }
  };
  collect(content.value);
  let previous: string | null = null;
  for (const value of input.blocks) {
    const patch = record(value, ["id", "props"]);
    if (typeof patch.id !== "string" || !identifier.test(patch.id)) fail("invalid block patch id.");
    if (previous !== null && compareUtf8(previous, patch.id) >= 0) {
      fail("block patch ids must be unique and sorted by UTF-8 bytes.");
    }
    const block = byId.get(patch.id);
    if (!block) fail("block patch id does not exist in the pattern.");
    block.props = record(patch.props);
    previous = patch.id;
  }
  const issues = npAnalyzeBlockContent(content.value, metadata);
  if (issues.length > 0) fail(issues[0].message);
  const result = npValidateBlockContent(cloneJson(content.value));
  if (!result.ok) fail(result.message);
  return result.value;
}
