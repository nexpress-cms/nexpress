import {
  analyzeCanonicalBody,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeIdempotencyKey,
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
  parseCanonicalAscii,
} from "./canonical-runtime-primitives.js";
import {
  npGetAgentAdminOperationV1,
  npAgentAdminOperationRouteInventoryV1,
  type NpAgentAdminOperationIdV1,
} from "./admin-operation-registry.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npRequireAgentConfigurationDefinitionV1,
  npRequireAgentPolicyDefinitionV1,
  npRequireAgentRuntimeSettingsV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentPolicyDefinitionV1,
  type NpAgentRuntimeSettingsV1,
} from "./runtime-contract.js";
import type { NpAgentContractResult } from "./types.js";
import { npRequireAgentBudgetV1, type NpAgentBudgetV1 } from "./wire-contract.js";

/** Subset of the existing Admin operation registry; this does not install routes. */
export type NpAgentRuntimeAdminOperationIdV1 = Extract<
  NpAgentAdminOperationIdV1,
  | `agents.configurations.${string}`
  | `agents.policies.${string}`
  | "agents.budgets.update"
  | "agents.runtime.pause"
  | "agents.runtime.resume"
>;
export const npAgentRuntimeAdminOperationIdsV1 = Object.freeze(
  npAgentAdminOperationRouteInventoryV1
    .map(({ id }) => id)
    .filter(
      (id): id is NpAgentRuntimeAdminOperationIdV1 =>
        id.startsWith("agents.configurations.") ||
        id.startsWith("agents.policies.") ||
        id === "agents.budgets.update" ||
        id === "agents.runtime.pause" ||
        id === "agents.runtime.resume",
    ),
);
const OPERATION_IDS = new Set<string>(npAgentRuntimeAdminOperationIdsV1);

export interface NpAgentRuntimeDefinitionAdminInputV1 {
  idempotencyKey: string;
  definitionJson: string;
  definitionHash: string;
}
export interface NpAgentRuntimeVersionedAdminInputV1 {
  idempotencyKey: string;
  expectedVersion: number;
  configHash: string;
}
export interface NpAgentRuntimeDefinitionUpdateAdminInputV1 extends NpAgentRuntimeDefinitionAdminInputV1 {
  expectedVersion: number;
  configHash: string;
}
export interface NpAgentRuntimeReasonAdminInputV1 {
  idempotencyKey: string;
  expectedVersion: number;
  reason: string;
}
export interface NpAgentRuntimeManualAdminInputV1 extends NpAgentRuntimeVersionedAdminInputV1 {
  inputJson: string;
  triggerId: string;
}
export interface NpAgentRuntimeSimulationAdminInputV1 extends NpAgentRuntimeVersionedAdminInputV1 {
  fixtureJson: string;
  fixtureHash: string;
}
export interface NpAgentRuntimeBudgetAdminInputV1 extends NpAgentRuntimeDefinitionAdminInputV1 {
  expectedVersion: number;
}
export interface NpAgentRuntimeAdminInputMapV1 {
  "agents.configurations.create": NpAgentRuntimeDefinitionAdminInputV1;
  "agents.configurations.update": NpAgentRuntimeDefinitionUpdateAdminInputV1;
  "agents.configurations.activate": NpAgentRuntimeVersionedAdminInputV1;
  "agents.configurations.pause": NpAgentRuntimeReasonAdminInputV1;
  "agents.configurations.resume": NpAgentRuntimeVersionedAdminInputV1;
  "agents.configurations.run": NpAgentRuntimeManualAdminInputV1;
  "agents.configurations.archive": NpAgentRuntimeReasonAdminInputV1;
  "agents.policies.create": NpAgentRuntimeDefinitionAdminInputV1;
  "agents.policies.update": NpAgentRuntimeDefinitionUpdateAdminInputV1;
  "agents.policies.validate": NpAgentRuntimeVersionedAdminInputV1;
  "agents.policies.simulate": NpAgentRuntimeSimulationAdminInputV1;
  "agents.policies.activate": NpAgentRuntimeVersionedAdminInputV1;
  "agents.budgets.update": NpAgentRuntimeBudgetAdminInputV1;
  "agents.runtime.pause": NpAgentRuntimeReasonAdminInputV1;
  "agents.runtime.resume": NpAgentRuntimeReasonAdminInputV1;
}

export function npAnalyzeAgentRuntimeAdminInputV1<K extends NpAgentRuntimeAdminOperationIdV1>(
  operationId: K,
  value: unknown,
): NpAgentContractResult<NpAgentRuntimeAdminInputMapV1[K]> {
  const path = "agent.runtimeAdmin.input";
  return analyzeCanonicalBody(path, () => {
    if (!OPERATION_IDS.has(operationId))
      failCanonicalBody(
        "invalid-field",
        `${path}.operationId`,
        "must be an existing Runtime Admin operation",
      );
    const required = npGetAgentAdminOperationV1(operationId).schemas.input.schema.required;
    if (
      !Array.isArray(required) ||
      !required.every((key): key is string => typeof key === "string")
    )
      failCanonicalBody("shape", path, "requires the installed exact Admin schema");
    const keys = required;
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, 1024 * 1024),
      path,
      keys,
      keys,
      { seen: new WeakSet<object>() },
    );
    const output: Record<string, unknown> = {
      idempotencyKey: canonicalRuntimeIdempotencyKey(row.idempotencyKey, `${path}.idempotencyKey`),
    };
    for (const key of keys) {
      switch (key) {
        case "idempotencyKey":
          break;
        case "expectedVersion":
          output[key] = canonicalBodyInteger(row[key], `${path}.${key}`, 1, 2_147_483_647);
          break;
        case "definitionHash":
        case "configHash":
        case "fixtureHash":
          output[key] = canonicalBodySha256Digest(row[key], `${path}.${key}`);
          break;
        case "definitionJson":
        case "inputJson":
        case "fixtureJson":
          output[key] = canonicalRuntimeText(row[key], `${path}.${key}`, 262_144);
          break;
        case "reason":
          output[key] = canonicalRuntimeText(row[key], `${path}.${key}`, 2_000, {
            allowEmpty: true,
            requireTrimmed: true,
          });
          break;
        case "triggerId": {
          const id = parseCanonicalAscii(row[key], `${path}.${key}`, 128);
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(id))
            failCanonicalBody("invalid-field", `${path}.${key}`, "must be a bounded identifier");
          output[key] = id;
          break;
        }
        default:
          failCanonicalBody(
            "invalid-field",
            path,
            "the installed Admin field has no exact Runtime parser",
          );
      }
    }
    return output as unknown as NpAgentRuntimeAdminInputMapV1[K];
  });
}

export function npRequireAgentRuntimeAdminInputV1<K extends NpAgentRuntimeAdminOperationIdV1>(
  operationId: K,
  value: unknown,
): NpAgentRuntimeAdminInputMapV1[K] {
  return npRequireAgentContractResult(
    npAnalyzeAgentRuntimeAdminInputV1(operationId, value),
    "Invalid Runtime Admin input",
  );
}

export interface NpAgentRuntimeDefinitionMapV1 {
  configuration: NpAgentConfigurationDefinitionV1;
  policy: NpAgentPolicyDefinitionV1;
  budget: NpAgentBudgetV1;
  "runtime-settings": NpAgentRuntimeSettingsV1;
}

/** Hash verification is performed by the same owning service that generated the expected hash. */
export function npRequireAgentRuntimeDefinitionJsonV1<
  K extends keyof NpAgentRuntimeDefinitionMapV1,
>(kind: K, json: string): NpAgentRuntimeDefinitionMapV1[K] {
  const text = canonicalRuntimeText(json, "agent.runtimeAdmin.definitionJson", 262_144);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    failCanonicalBody(
      "invalid-field",
      "agent.runtimeAdmin.definitionJson",
      "must contain valid JSON",
    );
  }
  let definition: NpAgentRuntimeDefinitionMapV1[keyof NpAgentRuntimeDefinitionMapV1];
  switch (kind) {
    case "configuration":
      definition = npRequireAgentConfigurationDefinitionV1(value);
      break;
    case "policy":
      definition = npRequireAgentPolicyDefinitionV1(value);
      break;
    case "budget":
      definition = npRequireAgentBudgetV1(value);
      break;
    case "runtime-settings":
      definition = npRequireAgentRuntimeSettingsV1(value);
      break;
    default:
      failCanonicalBody(
        "invalid-field",
        "agent.runtimeAdmin.definitionKind",
        "must be a known definition kind",
      );
  }
  return definition as NpAgentRuntimeDefinitionMapV1[K];
}

export function npSerializeAgentRuntimeDefinitionV1<K extends keyof NpAgentRuntimeDefinitionMapV1>(
  kind: K,
  value: NpAgentRuntimeDefinitionMapV1[K],
): string {
  const json = serializeAgentCanonicalJson(value);
  return serializeAgentCanonicalJson(npRequireAgentRuntimeDefinitionJsonV1(kind, json));
}
