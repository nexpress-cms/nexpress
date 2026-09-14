import { npRequireAgentRunAdmissionPolicyRefsV1 } from "./canonical-run-admission.js";
import { npRequireAgentPolicyRulesV1 } from "./canonical-notification-policy.js";
import {
  npRequireAgentRuntimeStatusV1,
  type NpAgentRuntimeStatusV1,
  npRequireAgentRuntimeReadinessV1,
  type NpAgentRuntimeReadinessV1,
} from "./runtime-ops-contract.js";
import {
  npAgentScopes,
  npAgentRecipeIds,
  npAgentRecipeProviderModes,
  npAgentRecipeTriggerKinds,
  npAgentCapabilityIds,
  npAgentAutonomyModes,
  type NpAgentRecipeDefinitionCanonicalV1,
  type NpAgentScope,
  type NpAgentPolicyRulesV1,
  type NpAgentCapabilityId,
  type NpAgentAutonomyMode,
  type NpAgentRunAdmissionPolicyRefV1,
} from "./types.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { npRequireAgentBudgetV1, type NpAgentBudgetV1 } from "./wire-contract.js";
import { npRequireAgentBudgetSnapshotCountersV1 } from "./canonical-budget-snapshot.js";
import type { NpAgentBudgetSnapshotCountersV1 } from "./types.js";
import {
  analyzeCanonicalBody,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeText,
  cloneCanonicalRuntimeInput,
} from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npAgentRuntimeAdminOperationIdsV1,
  type NpAgentRuntimeAdminOperationIdV1,
} from "./runtime-admin-contract.js";
import {
  npAgentConfigurationStatusesV1,
  npAgentVersionStatusesV1,
  npRequireAgentConfigurationDefinitionV1,
  npRequireAgentPolicyDefinitionV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentConfigurationStatusV1,
  type NpAgentPolicyDefinitionV1,
  type NpAgentVersionStatusV1,
} from "./runtime-contract.js";
import { npRequireAgentTriggerV1, type NpAgentTrigger } from "./runtime-trigger-contract.js";
import { npAgentRecipeTemplates, type NpAgentRecipeTemplate } from "./types.js";
import { npAnalyzeAgentCursorPageV1, type NpAgentCursorPageV1 } from "./wire-contract.js";

export type NpAgentRuntimeStudioKindV1 = "configurations" | "policies" | "triggers";
export interface NpAgentRuntimeStudioQueryV1 {
  limit: number;
  cursor?: string;
  status?: NpAgentConfigurationStatusV1 | NpAgentVersionStatusV1;
  template?: NpAgentRecipeTemplate;
  connectionId?: string;
  triggerKind?: "manual" | "event" | "schedule";
  name?: string;
  agentId?: string;
}
export interface NpAgentRuntimeStudioConfigurationV1 {
  schemaVersion: "np.agent-configuration.v1";
  id: string;
  principalId: string;
  status: NpAgentConfigurationStatusV1;
  rowVersion: number;
  versionId: string;
  version: number;
  versionStatus: NpAgentVersionStatusV1;
  draftVersionId: string | null;
  activeVersion: { id: string; configHash: string } | null;
  manualRecipeIds: NpAgentRecipeDefinitionCanonicalV1["id"][];
  configHash: string;
  definition: NpAgentConfigurationDefinitionV1;
  availableActions: NpAgentRuntimeAdminOperationIdV1[];
  createdAt: string;
  updatedAt: string;
}
export interface NpAgentRuntimeStudioPolicyV1 {
  schemaVersion: "np.agent-policy-detail.v1";
  id: string;
  rowVersion: number;
  version: number;
  status: NpAgentVersionStatusV1;
  contentHash: string;
  definition: NpAgentPolicyDefinitionV1;
  availableActions: NpAgentRuntimeAdminOperationIdV1[];
  createdAt: string;
}
export interface NpAgentRuntimeStudioTriggerV1 {
  schemaVersion: "np.agent-trigger-detail.v1";
  agentId: string;
  agentVersionId: string;
  definition: NpAgentTrigger;
  enabled: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}
const filters = {
  configurations: ["limit", "cursor", "status", "template", "connectionId", "triggerKind", "name"],
  policies: ["limit", "cursor", "status", "agentId"],
  triggers: ["limit", "cursor", "agentId", "triggerKind"],
} as const;
const fields = {
  budget: [
    "schemaVersion",
    "rowVersion",
    "siteCeiling",
    "deploymentCeiling",
    "effectiveCeiling",
    "measurement",
    "usage",
  ],
  catalog: [
    "schemaVersion",
    "recipes",
    "scopes",
    "connections",
    "capabilities",
    "effectiveBudget",
    "defaultPolicyRules",
    "selfDelegation",
  ],
  effective: [
    "schemaVersion",
    "id",
    "rowVersion",
    "versionId",
    "configHash",
    "ready",
    "blockers",
    "policyRefs",
    "readiness",
  ],
  overview: ["schemaVersion", "status", "operations"],
  mutation: ["resourceId", "replayed"],

  configuration: [
    "schemaVersion",
    "id",
    "principalId",
    "status",
    "rowVersion",
    "versionId",
    "version",
    "versionStatus",
    "draftVersionId",
    "activeVersion",
    "manualRecipeIds",
    "configHash",
    "definition",
    "availableActions",
    "createdAt",
    "updatedAt",
  ],
  policy: [
    "schemaVersion",
    "id",
    "rowVersion",
    "version",
    "status",
    "contentHash",
    "definition",
    "availableActions",
    "createdAt",
  ],
  trigger: [
    "schemaVersion",
    "agentId",
    "agentVersionId",
    "definition",
    "enabled",
    "nextRunAt",
    "createdAt",
    "updatedAt",
  ],
} as const;
const exact = (value: unknown, keys: readonly string[]) =>
  canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, "agent.runtimeStudio", 1024 * 1024),
    "agent.runtimeStudio",
    keys,
    keys,
    { seen: new WeakSet() },
  );
const version = (value: unknown) => canonicalBodyInteger(value, "version", 1, 2_147_483_647);
const nullableId = (value: unknown) => (value === null ? null : canonicalBodyUuid(value, "id"));
function actions(
  value: unknown,
  prefix: "configurations" | "policies",
): NpAgentRuntimeAdminOperationIdV1[] {
  if (!Array.isArray(value) || value.length > 15)
    failCanonicalBody("shape", "availableActions", "must be bounded");
  const allowed = new Set(
    npAgentRuntimeAdminOperationIdsV1.filter(
      (id) => id.startsWith(`agents.${prefix}.`) && !id.endsWith(".create"),
    ),
  );
  const result = value.map((id) =>
    canonicalBodyEnum<NpAgentRuntimeAdminOperationIdV1>(id, "availableActions", allowed),
  );
  if (result.some((id, index) => index > 0 && id <= result[index - 1]))
    failCanonicalBody("invalid-field", "availableActions", "must be sorted and unique");
  return result;
}
function times(created: unknown, updated: unknown) {
  const createdAt = canonicalBodyUtc(created, "createdAt");
  const updatedAt = canonicalBodyUtc(updated, "updatedAt");
  if (updatedAt < createdAt)
    failCanonicalBody("invalid-field", "updatedAt", "must not precede creation");
  return { createdAt, updatedAt };
}
export function npAnalyzeAgentRuntimeStudioQueryV1(
  kind: NpAgentRuntimeStudioKindV1,
  value: unknown,
) {
  return analyzeCanonicalBody("agent.runtimeStudio.query", (): NpAgentRuntimeStudioQueryV1 => {
    if (!Object.hasOwn(filters, kind))
      failCanonicalBody("invalid-field", "kind", "must be a known list");
    const r = canonicalBodyRecord(value, "agent.runtimeStudio.query", filters[kind], [], {
      seen: new WeakSet(),
    });
    const result: NpAgentRuntimeStudioQueryV1 = {
      limit: r.limit === undefined ? 25 : canonicalBodyInteger(r.limit, "limit", 1, 100),
    };
    if (r.cursor !== undefined)
      result.cursor = canonicalRuntimeText(r.cursor, "cursor", 2048, { requireTrimmed: true });
    if (r.status !== undefined)
      result.status = canonicalBodyEnum(
        r.status,
        "status",
        new Set(
          kind === "configurations" ? npAgentConfigurationStatusesV1 : npAgentVersionStatusesV1,
        ),
      );
    if (r.template !== undefined)
      result.template = canonicalBodyEnum(r.template, "template", new Set(npAgentRecipeTemplates));
    for (const key of ["agentId", "connectionId"] as const)
      if (r[key] !== undefined) result[key] = canonicalBodyUuid(r[key], key);
    if (r.triggerKind !== undefined)
      result.triggerKind = canonicalBodyEnum(
        r.triggerKind,
        "triggerKind",
        new Set(["manual", "event", "schedule"]),
      );
    if (r.name !== undefined)
      result.name = canonicalRuntimeText(r.name, "name", 120, { requireTrimmed: true });
    return result;
  });
}
export const npRequireAgentRuntimeStudioQueryV1 = (
  kind: NpAgentRuntimeStudioKindV1,
  value: unknown,
) => npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioQueryV1(kind, value));
export function npAnalyzeAgentRuntimeStudioConfigurationV1(value: unknown) {
  return analyzeCanonicalBody(
    "agent.runtimeStudio.configuration",
    (): NpAgentRuntimeStudioConfigurationV1 => {
      const r = exact(value, fields.configuration);
      const result: NpAgentRuntimeStudioConfigurationV1 = {
        schemaVersion: canonicalBodyEnum(
          r.schemaVersion,
          "schemaVersion",
          new Set(["np.agent-configuration.v1"]),
        ),
        id: canonicalBodyUuid(r.id, "id"),
        principalId: canonicalBodyUuid(r.principalId, "principalId"),
        status: canonicalBodyEnum(r.status, "status", new Set(npAgentConfigurationStatusesV1)),
        rowVersion: version(r.rowVersion),
        versionId: canonicalBodyUuid(r.versionId, "versionId"),
        version: version(r.version),
        versionStatus: canonicalBodyEnum(
          r.versionStatus,
          "versionStatus",
          new Set(npAgentVersionStatusesV1),
        ),
        draftVersionId: nullableId(r.draftVersionId),
        manualRecipeIds: enumList(r.manualRecipeIds, npAgentRecipeIds, 8),
        activeVersion:
          r.activeVersion === null
            ? null
            : (() => {
                const v = exact(r.activeVersion, ["id", "configHash"]);
                const id = canonicalBodyUuid(v.id, "activeVersion.id");
                return {
                  id,
                  configHash: canonicalBodySha256Digest(v.configHash, "activeVersion.configHash"),
                };
              })(),
        configHash: canonicalBodySha256Digest(r.configHash, "configHash"),
        definition: npRequireAgentConfigurationDefinitionV1(r.definition),
        availableActions: actions(r.availableActions, "configurations"),
        ...times(r.createdAt, r.updatedAt),
      };
      if (
        (result.status === "draft" && result.activeVersion !== null) ||
        (["active", "paused", "error"].includes(result.status) && result.activeVersion === null) ||
        (result.status === "archived" && result.draftVersionId !== null) ||
        (result.versionStatus === "draft" &&
          result.draftVersionId !== result.versionId &&
          !(
            result.status === "archived" &&
            result.activeVersion === null &&
            result.draftVersionId === null
          )) ||
        (result.versionStatus === "active" &&
          (result.activeVersion?.id !== result.versionId ||
            result.activeVersion.configHash !== result.configHash)) ||
        (result.activeVersion !== null && result.activeVersion.id === result.draftVersionId)
      )
        failCanonicalBody("invalid-field", "version", "must match the configuration lifecycle");
      return result;
    },
  );
}
export const npRequireAgentRuntimeStudioConfigurationV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioConfigurationV1(value));
export function npAnalyzeAgentRuntimeStudioPolicyV1(value: unknown) {
  return analyzeCanonicalBody("agent.runtimeStudio.policy", (): NpAgentRuntimeStudioPolicyV1 => {
    const r = exact(value, fields.policy);
    return {
      schemaVersion: canonicalBodyEnum(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-policy-detail.v1"]),
      ),
      id: canonicalBodyUuid(r.id, "id"),
      rowVersion: version(r.rowVersion),
      version: version(r.version),
      status: canonicalBodyEnum(r.status, "status", new Set(npAgentVersionStatusesV1)),
      contentHash: canonicalBodySha256Digest(r.contentHash, "contentHash"),
      definition: npRequireAgentPolicyDefinitionV1(r.definition),
      availableActions: actions(r.availableActions, "policies"),
      createdAt: canonicalBodyUtc(r.createdAt, "createdAt"),
    };
  });
}
export const npRequireAgentRuntimeStudioPolicyV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioPolicyV1(value));
export function npAnalyzeAgentRuntimeStudioTriggerV1(value: unknown) {
  return analyzeCanonicalBody("agent.runtimeStudio.trigger", (): NpAgentRuntimeStudioTriggerV1 => {
    const r = exact(value, fields.trigger);
    const definition = npRequireAgentTriggerV1(r.definition);
    if (typeof r.enabled !== "boolean")
      failCanonicalBody("invalid-field", "enabled", "must be boolean");
    const nextRunAt = r.nextRunAt === null ? null : canonicalBodyUtc(r.nextRunAt, "nextRunAt");
    if (definition.type !== "schedule" && nextRunAt !== null)
      failCanonicalBody("invalid-field", "nextRunAt", "requires a schedule trigger");
    return {
      schemaVersion: canonicalBodyEnum(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-trigger-detail.v1"]),
      ),
      agentId: canonicalBodyUuid(r.agentId, "agentId"),
      agentVersionId: canonicalBodyUuid(r.agentVersionId, "agentVersionId"),
      definition,
      enabled: r.enabled,
      nextRunAt,
      ...times(r.createdAt, r.updatedAt),
    };
  });
}
export const npRequireAgentRuntimeStudioTriggerV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioTriggerV1(value));
export type NpAgentRuntimeStudioConfigurationsPageV1 = NpAgentCursorPageV1<
  NpAgentRuntimeStudioConfigurationV1,
  "np.agent-configurations-page.v1"
>;
export type NpAgentRuntimeStudioPoliciesPageV1 = NpAgentCursorPageV1<
  NpAgentRuntimeStudioPolicyV1,
  "np.agent-policies-page.v1"
>;
export type NpAgentRuntimeStudioTriggersPageV1 = NpAgentCursorPageV1<
  NpAgentRuntimeStudioTriggerV1,
  "np.agent-triggers-page.v1"
>;
export const npAnalyzeAgentRuntimeStudioConfigurationsPageV1 = (value: unknown) =>
  npAnalyzeAgentCursorPageV1(value, {
    schemaVersion: "np.agent-configurations-page.v1" as const,
    analyzeItem: npAnalyzeAgentRuntimeStudioConfigurationV1,
    itemIssueRoot: "configuration",
    maximumItems: 100,
    maximumBytes: 8 * 1024 * 1024,
  });
export const npAnalyzeAgentRuntimeStudioPoliciesPageV1 = (value: unknown) =>
  npAnalyzeAgentCursorPageV1(value, {
    schemaVersion: "np.agent-policies-page.v1" as const,
    analyzeItem: npAnalyzeAgentRuntimeStudioPolicyV1,
    itemIssueRoot: "policy",
    maximumItems: 100,
    maximumBytes: 8 * 1024 * 1024,
  });
export const npAnalyzeAgentRuntimeStudioTriggersPageV1 = (value: unknown) =>
  npAnalyzeAgentCursorPageV1(value, {
    schemaVersion: "np.agent-triggers-page.v1" as const,
    analyzeItem: npAnalyzeAgentRuntimeStudioTriggerV1,
    itemIssueRoot: "trigger",
    maximumItems: 100,
  });
export const npAgentRuntimeStudioReadRoutesV1 = [
  {
    method: "GET",
    path: "/api/admin/agents/configurations/{id}/effective",
    kind: "effective",
    detail: true,
  },
  { method: "GET", path: "/api/admin/agents/capabilities", kind: "catalog", detail: false },
  {
    method: "GET",
    path: "/api/admin/agents/configurations",
    kind: "configurations",
    detail: false,
  },
  {
    method: "GET",
    path: "/api/admin/agents/configurations/{id}",
    kind: "configurations",
    detail: true,
  },
  { method: "GET", path: "/api/admin/agents/policies", kind: "policies", detail: false },
  { method: "GET", path: "/api/admin/agents/policies/{id}", kind: "policies", detail: true },
  { method: "GET", path: "/api/admin/agents/triggers", kind: "triggers", detail: false },
  { method: "GET", path: "/api/admin/agents/budgets", kind: "budgets", detail: false },
  {
    method: "GET",
    path: "/api/admin/agents/runtime-status",
    kind: "runtime-status",
    detail: false,
  },
] as const;

/** The synchronous server builder and browser digest share these exact bytes. */
export function npBuildAgentRuntimeDefinitionBytesV1(value: unknown): {
  definitionJson: string;
  bytes: Uint8Array;
} {
  const input = cloneCanonicalRuntimeInput(value, "agent.runtime.definition", 1_048_576);
  const schema =
    input && typeof input === "object" && "schemaVersion" in input
      ? input.schemaVersion
      : undefined;
  const definition =
    schema === "np.agent-policy-definition.v1"
      ? npRequireAgentPolicyDefinitionV1(input)
      : schema === "np.agent-budget.v1"
        ? npRequireAgentBudgetV1(input)
        : npRequireAgentConfigurationDefinitionV1(input);
  const definitionJson = serializeAgentCanonicalJson(definition);
  return {
    definitionJson,
    bytes: new TextEncoder().encode(`np.agent-runtime-definition.v1\0${definitionJson}`),
  };
}
export async function npBuildAgentRuntimeStudioDefinitionInputV1(
  value: unknown,
): Promise<{ definitionJson: string; definitionHash: string }> {
  const { definitionJson, bytes } = npBuildAgentRuntimeDefinitionBytesV1(value);
  return { definitionJson, definitionHash: await digestAgentCanonicalSha256(bytes) };
}
export interface NpAgentRuntimeStudioBudgetV1 {
  schemaVersion: "np.agent-runtime-budget.v1";
  rowVersion: number;
  siteCeiling: NpAgentBudgetV1;
  deploymentCeiling: NpAgentBudgetV1;
  effectiveCeiling: NpAgentBudgetV1;
  measurement: "available" | "unavailable";
  usage: NpAgentBudgetSnapshotCountersV1 | null;
}
export function npAnalyzeAgentRuntimeStudioBudgetV1(value: unknown) {
  return analyzeCanonicalBody("agent.runtimeStudio.budget", (): NpAgentRuntimeStudioBudgetV1 => {
    const r = exact(value, fields.budget);
    const measurement = canonicalBodyEnum<"available" | "unavailable">(
      r.measurement,
      "measurement",
      new Set(["available", "unavailable"]),
    );
    if ((measurement === "unavailable") !== (r.usage === null))
      failCanonicalBody("invalid-field", "usage", "must match measurement availability");
    return {
      schemaVersion: canonicalBodyEnum(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-runtime-budget.v1"]),
      ),
      rowVersion: version(r.rowVersion),
      siteCeiling: npRequireAgentBudgetV1(r.siteCeiling),
      deploymentCeiling: npRequireAgentBudgetV1(r.deploymentCeiling),
      effectiveCeiling: npRequireAgentBudgetV1(r.effectiveCeiling),
      measurement,
      usage: r.usage === null ? null : npRequireAgentBudgetSnapshotCountersV1(r.usage),
    };
  });
}
export const npRequireAgentRuntimeStudioBudgetV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioBudgetV1(value));

export interface NpAgentRuntimeStudioCatalogV1 {
  schemaVersion: "np.agent-runtime-catalog.v1";
  recipes: Array<
    Pick<
      NpAgentRecipeDefinitionCanonicalV1,
      "id" | "version" | "allowedTemplates" | "providerMode" | "triggerKinds" | "capabilityIds"
    >
  >;
  scopes: NpAgentScope[];
  connections: Array<{ id: string; alias: string; models: string[] }>;
  capabilities: Array<{ id: NpAgentCapabilityId; modes: NpAgentAutonomyMode[] }>;
  effectiveBudget: NpAgentBudgetV1;
  defaultPolicyRules: NpAgentPolicyRulesV1;
  selfDelegation: { userId: string } | null;
}
function boundedArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    failCanonicalBody("shape", "items", "must be bounded");
  return value;
}
function enumList<T extends string>(value: unknown, allowed: readonly T[], maximum: number): T[] {
  const result = boundedArray(value, maximum).map((item) =>
    canonicalBodyEnum<T>(item, "items", new Set(allowed)),
  );
  if (new Set(result).size !== result.length)
    failCanonicalBody("invalid-field", "items", "must be unique");
  return result;
}
export function npAnalyzeAgentRuntimeStudioCatalogV1(value: unknown) {
  return analyzeCanonicalBody("agent.runtimeStudio.catalog", (): NpAgentRuntimeStudioCatalogV1 => {
    const r = exact(value, fields.catalog);
    const recipes: NpAgentRuntimeStudioCatalogV1["recipes"] = boundedArray(r.recipes, 8).map(
      (value): NpAgentRuntimeStudioCatalogV1["recipes"][number] => {
        const recipe = exact(value, [
          "id",
          "version",
          "allowedTemplates",
          "providerMode",
          "triggerKinds",
          "capabilityIds",
        ]);
        return {
          id: canonicalBodyEnum(recipe.id, "id", new Set(npAgentRecipeIds)),
          version: canonicalBodyInteger(recipe.version, "version", 1, 1) as 1,
          allowedTemplates: enumList(recipe.allowedTemplates, npAgentRecipeTemplates, 5),
          providerMode: canonicalBodyEnum(
            recipe.providerMode,
            "providerMode",
            new Set(npAgentRecipeProviderModes),
          ),
          triggerKinds: enumList(recipe.triggerKinds, npAgentRecipeTriggerKinds, 3),
          capabilityIds: enumList(recipe.capabilityIds, npAgentCapabilityIds, 21),
        };
      },
    );
    const connections = boundedArray(r.connections, 100).map((value) => {
      const row = exact(value, ["id", "alias", "models"]);
      const models = boundedArray(row.models, 100).map((model) =>
        canonicalRuntimeText(model, "model", 128, { requireTrimmed: true }),
      );
      if (new Set(models).size !== models.length)
        failCanonicalBody("invalid-field", "models", "must be unique");
      return {
        id: canonicalBodyUuid(row.id, "id"),
        alias: canonicalRuntimeText(row.alias, "alias", 120, { requireTrimmed: true }),
        models,
      };
    });
    const capabilities: NpAgentRuntimeStudioCatalogV1["capabilities"] = boundedArray(
      r.capabilities,
      21,
    ).map((value): NpAgentRuntimeStudioCatalogV1["capabilities"][number] => {
      const row = exact(value, ["id", "modes"]);
      return {
        id: canonicalBodyEnum(row.id, "id", new Set(npAgentCapabilityIds)),
        modes: enumList(row.modes, npAgentAutonomyModes, 4),
      };
    });
    for (const items of [recipes, connections, capabilities])
      if (new Set(items.map(({ id }) => id)).size !== items.length)
        failCanonicalBody("invalid-field", "items", "must have unique ids");
    return {
      schemaVersion: canonicalBodyEnum(
        r.schemaVersion,
        "schemaVersion",
        new Set(["np.agent-runtime-catalog.v1"]),
      ),
      recipes,
      scopes: enumList(r.scopes, npAgentScopes, 64),
      connections,
      capabilities,
      effectiveBudget: npRequireAgentBudgetV1(r.effectiveBudget),
      defaultPolicyRules: npRequireAgentPolicyRulesV1(r.defaultPolicyRules),
      selfDelegation:
        r.selfDelegation === null
          ? null
          : {
              userId: canonicalBodyUuid(
                exact(r.selfDelegation, ["userId"]).userId,
                "selfDelegation.userId",
              ),
            },
    };
  });
}
export const npRequireAgentRuntimeStudioCatalogV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioCatalogV1(value));
export const npAgentRuntimeStudioBlockerCodesV1 = [
  "RUNTIME_CONFIGURATION_INVALID",
  "RUNTIME_READINESS_BLOCKED",
  "RUNTIME_BUDGET_UNAVAILABLE",
  "RUNTIME_USAGE_UNKNOWN",
  "RUNTIME_AUTHORITY_INVALID",
  "RUNTIME_AUTHORITY_CHANGED",
  "RUNTIME_DEFINITION_STALE",
  "RUNTIME_MODE_INVALID",
  "RUNTIME_PROVIDER_UNAVAILABLE",
  "RUNTIME_PRICING_UNAVAILABLE",
  "RUNTIME_POLICY_INVALID",
  "RUNTIME_RESOURCE_UNAVAILABLE",
  "SITE_ACCESS_DENIED",
] as const;
export interface NpAgentRuntimeStudioEffectiveV1 {
  schemaVersion: "np.agent-effective-config.v1";
  id: string;
  rowVersion: number;
  versionId: string;
  configHash: string;
  ready: boolean;
  blockers: Array<(typeof npAgentRuntimeStudioBlockerCodesV1)[number]>;
  policyRefs: NpAgentRunAdmissionPolicyRefV1[];
  readiness: NpAgentRuntimeReadinessV1;
}
export function npAnalyzeAgentRuntimeStudioEffectiveV1(value: unknown) {
  return analyzeCanonicalBody(
    "agent.runtimeStudio.effective",
    (): NpAgentRuntimeStudioEffectiveV1 => {
      const r = exact(value, fields.effective);
      if (typeof r.ready !== "boolean")
        failCanonicalBody("invalid-field", "ready", "must be boolean");
      const blockers = enumList(r.blockers, npAgentRuntimeStudioBlockerCodesV1, 13);
      const readiness = npRequireAgentRuntimeReadinessV1(r.readiness);
      if (
        r.ready &&
        Object.values(readiness).some((state) => state !== "ready" && state !== "not-required")
      )
        failCanonicalBody("invalid-field", "ready", "requires complete readiness");
      if (r.ready !== (blockers.length === 0))
        failCanonicalBody("invalid-field", "blockers", "must match readiness");
      return {
        schemaVersion: canonicalBodyEnum(
          r.schemaVersion,
          "schemaVersion",
          new Set(["np.agent-effective-config.v1"]),
        ),
        id: canonicalBodyUuid(r.id, "id"),
        rowVersion: version(r.rowVersion),
        versionId: canonicalBodyUuid(r.versionId, "versionId"),
        configHash: canonicalBodySha256Digest(r.configHash, "configHash"),
        ready: r.ready,
        blockers,
        policyRefs: npRequireAgentRunAdmissionPolicyRefsV1(r.policyRefs),
        readiness,
      };
    },
  );
}
export const npRequireAgentRuntimeStudioEffectiveV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioEffectiveV1(value));

/** A mutation acknowledgement carries no retained invocation body. Refetch authorized reads. */
export interface NpAgentRuntimeStudioMutationResultV1 {
  resourceId: string;
  replayed: boolean;
}
export function npAnalyzeAgentRuntimeStudioMutationResultV1(value: unknown) {
  return analyzeCanonicalBody(
    "agent.runtimeStudio.mutation",
    (): NpAgentRuntimeStudioMutationResultV1 => {
      const row = exact(value, fields.mutation);
      if (typeof row.replayed !== "boolean")
        failCanonicalBody("invalid-field", "replayed", "must be boolean");
      return {
        resourceId: canonicalBodyUuid(row.resourceId, "resourceId"),
        replayed: row.replayed,
      };
    },
  );
}
export const npRequireAgentRuntimeStudioMutationResultV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioMutationResultV1(value));
export interface NpAgentRuntimeStudioOperationsV1 {
  runtime: {
    enabled: boolean;
    paused: boolean;
    total: number;
    active: number;
    queued: number;
    waitingApproval: number;
    oldestQueuedAgeSeconds: number | null;
  };
  events: {
    total: number;
    pending: number;
    expired: number;
    expiredPending: number;
    oldestPendingAgeSeconds: number | null;
  };
  triggers: { total: number; enabled: number; due: number; oldestDueAgeSeconds: number | null };
}
export interface NpAgentRuntimeStudioOverviewV1 {
  schemaVersion: "np.agent-runtime-overview.v1";
  status: NpAgentRuntimeStatusV1;
  operations: NpAgentRuntimeStudioOperationsV1 | null;
}
const operationFields = {
  runtime: [
    "enabled",
    "paused",
    "total",
    "active",
    "queued",
    "waitingApproval",
    "oldestQueuedAgeSeconds",
  ],
  events: ["total", "pending", "expired", "expiredPending", "oldestPendingAgeSeconds"],
  triggers: ["total", "enabled", "due", "oldestDueAgeSeconds"],
} as const;
function operations(value: unknown): NpAgentRuntimeStudioOperationsV1 {
  const r = exact(value, ["runtime", "events", "triggers"]);
  const result: Record<string, Record<string, number | boolean | null>> = {};
  for (const kind of ["runtime", "events", "triggers"] as const) {
    const row = exact(r[kind], operationFields[kind]);
    const output: Record<string, number | boolean | null> = {};
    for (const key of operationFields[kind]) {
      if (kind === "runtime" && (key === "enabled" || key === "paused")) {
        if (typeof row[key] !== "boolean")
          failCanonicalBody("invalid-field", key, "must be boolean");
        output[key] = row[key];
      } else
        output[key] =
          key.startsWith("oldest") && row[key] === null
            ? null
            : canonicalBodyInteger(row[key], key, 0, Number.MAX_SAFE_INTEGER);
    }
    result[kind] = output;
  }
  return result as unknown as NpAgentRuntimeStudioOperationsV1;
}
export function npAnalyzeAgentRuntimeStudioOverviewV1(value: unknown) {
  return analyzeCanonicalBody(
    "agent.runtimeStudio.overview",
    (): NpAgentRuntimeStudioOverviewV1 => {
      const r = exact(value, fields.overview);
      const status = npRequireAgentRuntimeStatusV1(r.status);
      const ops = r.operations === null ? null : operations(r.operations);
      if (ops && (ops.runtime.enabled !== status.enabled || ops.runtime.paused !== status.paused))
        failCanonicalBody("invalid-field", "operations", "must match runtime status");
      return {
        schemaVersion: canonicalBodyEnum(
          r.schemaVersion,
          "schemaVersion",
          new Set(["np.agent-runtime-overview.v1"]),
        ),
        status,
        operations: ops,
      };
    },
  );
}
export const npRequireAgentRuntimeStudioOverviewV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioOverviewV1(value));

export const npAgentRuntimeStudioContractV1 = {
  schemaVersion: "np.agent-runtime-studio-contract.v1",
  filters,
  effectiveQuery: { version: ["active"] },
  fields,
  defaultLimit: 25,
  maximumItems: 100,
  order: "created-desc-id-desc",
  operations: operationFields,
  blockers: npAgentRuntimeStudioBlockerCodesV1,
  routes: npAgentRuntimeStudioReadRoutesV1,
} as const;

export interface NpAgentRuntimeStudioEffectiveQueryV1 {
  version?: "active";
}
export function npAnalyzeAgentRuntimeStudioEffectiveQueryV1(value: unknown) {
  return analyzeCanonicalBody(
    "agent.runtimeStudio.effectiveQuery",
    (): NpAgentRuntimeStudioEffectiveQueryV1 => {
      const row = canonicalBodyRecord(
        value,
        "agent.runtimeStudio.effectiveQuery",
        ["version"],
        [],
        { seen: new WeakSet() },
      );
      return row.version === undefined
        ? {}
        : { version: canonicalBodyEnum(row.version, "version", new Set(["active"])) };
    },
  );
}
export const npRequireAgentRuntimeStudioEffectiveQueryV1 = (value: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioEffectiveQueryV1(value));
