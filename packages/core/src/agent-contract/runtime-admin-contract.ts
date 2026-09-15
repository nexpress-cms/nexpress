import { npRequireAgentRunAdmissionPolicyRefsV1 } from "./canonical-run-admission.js";
import {
  npAgentPolicySimulationFixtureJsonV1,
  npRequireAgentPolicySimulationFixtureJsonV1,
} from "./runtime-policy-simulation.js";
import { npRequireAgentTriggerV1, type NpAgentTrigger } from "./runtime-trigger-contract.js";
import type { NpAgentRunAdmissionPolicyRefV1 } from "./types.js";
import {
  analyzeCanonicalBody,
  canonicalBodyInteger,
  canonicalBodyArray,
  canonicalBodyRecord,
  canonicalBodyUuid,
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
export interface NpAgentRuntimeConfigurationCreateAdminInputV1 extends NpAgentRuntimeDefinitionAdminInputV1 {
  authority?: { kind: "user"; userId: string };
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
export interface NpAgentRuntimeActivationAdminInputV1 extends NpAgentRuntimeVersionedAdminInputV1 {
  triggers?: Array<{ definition: NpAgentTrigger; enabled: boolean }>;
  reviewedPolicyRefs?: NpAgentRunAdmissionPolicyRefV1[];
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
  "agents.configurations.create": NpAgentRuntimeConfigurationCreateAdminInputV1;
  "agents.configurations.update": NpAgentRuntimeDefinitionUpdateAdminInputV1;
  "agents.configurations.activate": NpAgentRuntimeActivationAdminInputV1;
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
    const keys = Object.keys(
      npGetAgentAdminOperationV1(operationId).schemas.input.schema.properties ?? {},
    );
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, 1024 * 1024),
      path,
      keys,
      required,
      { seen: new WeakSet<object>() },
    );
    const output: Record<string, unknown> = {
      idempotencyKey: canonicalRuntimeIdempotencyKey(row.idempotencyKey, `${path}.idempotencyKey`),
    };
    for (const key of keys) {
      if (!Object.hasOwn(row, key)) continue;
      switch (key) {
        case "reviewedPolicyRefs":
          output[key] = npRequireAgentRunAdmissionPolicyRefsV1(row[key]);
          break;
        case "triggers": {
          const entries = canonicalBodyArray(row[key], `${path}.triggers`, 32, {
            seen: new WeakSet<object>(),
          });
          const ids = new Set<string>();
          output[key] = entries.map((entry) => {
            const trigger = canonicalBodyRecord(
              entry,
              `${path}.triggers`,
              ["definition", "enabled"],
              ["definition", "enabled"],
              { seen: new WeakSet<object>() },
            );
            const definition = npRequireAgentTriggerV1(trigger.definition);
            if (typeof trigger.enabled !== "boolean" || ids.has(definition.id))
              failCanonicalBody(
                "invalid-field",
                `${path}.triggers`,
                "requires unique triggers and explicit enabled state",
              );
            ids.add(definition.id);
            return { definition, enabled: trigger.enabled };
          });
          break;
        }
        case "authority": {
          if (operationId !== "agents.configurations.create")
            failCanonicalBody(
              "invalid-field",
              `${path}.authority`,
              "is only valid for configuration creation",
            );
          const authority = canonicalBodyRecord(
            row.authority,
            `${path}.authority`,
            ["kind", "userId"],
            ["kind", "userId"],
            { seen: new WeakSet<object>() },
          );
          if (authority.kind !== "user")
            failCanonicalBody("invalid-field", `${path}.authority.kind`, "must be user");
          output.authority = {
            kind: "user",
            userId: canonicalBodyUuid(authority.userId, `${path}.authority.userId`),
          };
          break;
        }
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
          output[key] = canonicalRuntimeText(row[key], `${path}.${key}`, 262_144);
          break;
        case "fixtureJson":
          npRequireAgentPolicySimulationFixtureJsonV1(row[key]);
          output[key] = npAgentPolicySimulationFixtureJsonV1;
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
