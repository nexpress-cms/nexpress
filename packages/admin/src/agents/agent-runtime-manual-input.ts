import type {
  NpAgentJsonObject,
  NpAgentRuntimeManualSchemaV1,
} from "@nexpress/core/agent-contract";

/** Preserve untouched optional fields and the empty value permitted by required string schemas. */
export function runtimeManualInput(
  schema: NpAgentRuntimeManualSchemaV1,
  values: Record<string, string>,
): NpAgentJsonObject {
  const input: NpAgentJsonObject = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const raw =
      values[name] ??
      (field.type === "string" && !field.enum && schema.required.includes(name) ? "" : undefined);
    if (raw === undefined || (raw === "" && field.type !== "string")) continue;
    input[name] =
      field.type === "integer" ? Number(raw) : field.type === "boolean" ? raw === "true" : raw;
  }
  return input;
}
