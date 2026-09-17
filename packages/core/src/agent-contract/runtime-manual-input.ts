import { canonicalBodyRecord, failCanonicalBody } from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import type {
  NpAgentJsonObject,
  NpAgentJsonSchema,
  NpAgentRecipeDefinitionCanonicalV1,
} from "./types.js";

export type NpAgentRuntimeManualFieldV1 = {
  type: "string" | "integer" | "boolean";
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number | boolean>;
};
export type NpAgentRuntimeManualSchemaV1 = NpAgentJsonSchema & {
  properties: Record<string, NpAgentRuntimeManualFieldV1>;
  required: string[];
};
const denied = new Set([
  "prompt",
  "scope",
  "scopes",
  "model",
  "target",
  "targets",
  "provider",
  "instruction",
  "instructions",
  "capability",
  "capabilities",
  "tool",
  "tools",
  "system",
  "authority",
  "connection",
  "connectionid",
  "policy",
  "policies",
]);
function invalid(): never {
  return failCanonicalBody(
    "invalid-field",
    "manualInput",
    "must match the supported bounded manual input contract",
  );
}
const record = (value: unknown, keys: string[], required = keys) =>
  canonicalBodyRecord(value, "manualInput", keys, required, { seen: new WeakSet() });
function scalar(field: NpAgentRuntimeManualFieldV1, value: unknown): boolean {
  return field.type === "string"
    ? typeof value === "string" && Array.from(value).length <= field.maxLength!
    : field.type === "boolean"
      ? typeof value === "boolean"
      : typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= field.minimum! &&
        value <= field.maximum!;
}
/** Deliberately small schema subset that the interactive executor can consume as untrusted evidence. */
export function npRequireAgentRuntimeManualSchemaV1(value: unknown): NpAgentRuntimeManualSchemaV1 {
  const r = record(cloneCanonicalRuntimeInput(value, "manualInputSchema", 32768), [
    "$schema",
    "type",
    "additionalProperties",
    "properties",
    "required",
  ]);
  if (
    r.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    r.type !== "object" ||
    r.additionalProperties !== false
  )
    invalid();
  if (!r.properties || typeof r.properties !== "object" || Array.isArray(r.properties)) invalid();
  const keys = Object.keys(r.properties);
  if (
    keys.length > 16 ||
    keys.some(
      (key) =>
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
        denied.has(key.replaceAll("_", "").toLowerCase()) ||
        /^(prompt|scopes?|model|targets?|provider|instructions?|capabilit|tools?|system|authority|connection|polic)/i.test(
          key.replaceAll("_", ""),
        ),
    )
  )
    invalid();
  const properties: Record<string, NpAgentRuntimeManualFieldV1> = {};
  for (const key of keys) {
    const raw = record(
      (r.properties as Record<string, unknown>)[key],
      ["type", "maxLength", "minimum", "maximum", "enum"],
      ["type"],
    );
    const field: NpAgentRuntimeManualFieldV1 = {
      type: raw.type as NpAgentRuntimeManualFieldV1["type"],
    };
    if (raw.type === "string") {
      if (
        !Number.isSafeInteger(raw.maxLength) ||
        Number(raw.maxLength) < 1 ||
        Number(raw.maxLength) > 2000 ||
        raw.minimum !== undefined ||
        raw.maximum !== undefined
      )
        invalid();
      field.maxLength = Number(raw.maxLength);
    } else if (raw.type === "integer") {
      if (
        !Number.isSafeInteger(raw.minimum) ||
        !Number.isSafeInteger(raw.maximum) ||
        Number(raw.minimum) > Number(raw.maximum) ||
        raw.maxLength !== undefined
      )
        invalid();
      field.minimum = Number(raw.minimum);
      field.maximum = Number(raw.maximum);
    } else if (
      raw.type !== "boolean" ||
      raw.maxLength !== undefined ||
      raw.minimum !== undefined ||
      raw.maximum !== undefined
    )
      invalid();
    if (raw.enum !== undefined) {
      if (
        !Array.isArray(raw.enum) ||
        raw.enum.length < 1 ||
        raw.enum.length > 32 ||
        raw.enum.some((value) => !scalar(field, value)) ||
        new Set(raw.enum).size !== raw.enum.length
      )
        invalid();
      field.enum = raw.enum as Array<string | number | boolean>;
    }
    properties[key] = field;
  }
  if (
    !Array.isArray(r.required) ||
    r.required.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    new Set(r.required).size !== r.required.length
  )
    invalid();
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties,
    required: r.required as string[],
  };
}
export function npIsAgentRuntimeManualRecipeSupportedV1(
  recipe: NpAgentRecipeDefinitionCanonicalV1,
): boolean {
  if (recipe.task !== "interactive-capability" || !recipe.triggerKinds.includes("manual"))
    return false;
  if (recipe.manualInputSchema === null) return true;
  if (recipe.providerMode === "forbidden" || !recipe.instruction) return false;
  try {
    npRequireAgentRuntimeManualSchemaV1(recipe.manualInputSchema);
    return true;
  } catch {
    return false;
  }
}
export function npRequireAgentRuntimeManualInputV1(
  recipe: NpAgentRecipeDefinitionCanonicalV1,
  input: unknown,
): NpAgentJsonObject {
  if (!npIsAgentRuntimeManualRecipeSupportedV1(recipe) || recipe.manualInputSchema === null)
    invalid();
  const schema = npRequireAgentRuntimeManualSchemaV1(recipe.manualInputSchema);
  const r = record(
    cloneCanonicalRuntimeInput(input, "manualInput", 8192),
    Object.keys(schema.properties),
    schema.required,
  );
  for (const [key, value] of Object.entries(r)) {
    const field = schema.properties[key];
    if (
      !scalar(field, value) ||
      (field.enum && !field.enum.includes(value as string | number | boolean))
    )
      invalid();
  }
  return r as NpAgentJsonObject;
}
export async function npDigestAgentRuntimeManualInputV1(input: NpAgentJsonObject): Promise<string> {
  const value = cloneCanonicalRuntimeInput(input, "manualInput", 8192);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 16 ||
    Object.values(value).some(
      (item) =>
        typeof item !== "string" &&
        typeof item !== "boolean" &&
        !(typeof item === "number" && Number.isSafeInteger(item)),
    )
  )
    invalid();
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-runtime-manual-input.v1\0${serializeAgentCanonicalJson(value)}`,
    ),
  );
}
