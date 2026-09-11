import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { type getDb } from "../db/runtime.js";
import {
  npAgents,
  npAgentVersions,
  npAgentPolicies,
  npAgentPrincipals,
  npAgentTriggers,
  npAgentConnections,
  npAgentConnectionConfigVersions,
} from "../db/schema/agent.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { cloneCanonicalRuntimeInput } from "../agent-contract/canonical-runtime-primitives.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npDeriveAgentRuntimeAdmissionSourceRefsV1 } from "./runtime-admission-sources.js";
import { npMeasureAgentRuntimeBudgetV1 } from "./runtime-budget.js";
import {
  npRequireAgentConfigurationDefinitionV1,
  npRequireAgentPolicyDefinitionV1,
  type NpAgentConfigurationDefinitionV1,
  type NpAgentRuntimeSettingsV1,
  npRequireAgentRuntimeAdmissionSourcesV1,
  type NpAgentRuntimeAdmissionSourcesV1,
} from "../agent-contract/runtime-contract.js";
import {
  npRequireAgentRecipeRegistryCanonical,
  npDigestAgentRecipeRegistryCanonical,
} from "../agent-contract/canonical-recipe-registry.js";
import {
  npRequireAgentPolicyCanonical,
  npDigestAgentPolicyCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import {
  npResolveAgentPolicyV1,
  npMeetAgentAutonomyModesV1,
  type NpAgentResolvedPolicyV1,
} from "../agent-contract/runtime-policy.js";
import {
  npAgentScopeStaffCapability,
  type NpAgentScope,
  type NpAgentJsonObject,
  type NpAgentRecipeRegistryCanonicalV1,
  type NpAgentRunAdmissionPolicyRefV1,
  type NpAgentPolicyRulesV1,
  type NpAgentProviderDataClass,
} from "../agent-contract/types.js";
import { npRequireAgentProviderSchemaValueV1 } from "./provider-auth-contract.js";
import {
  createAgentAdminAdmissionV1,
  npResolveAgentStaffSessionAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminAdmissionOptionsV1,
  type NpAgentAdminActorV1,
  type NpAgentAdminExecutionResultV1,
} from "./admin-admission.js";
import {
  npWithAgentRuntimeControlTransactionV1,
  type NpAgentRuntimeControlsV1,
} from "./runtime-controls.js";
import {
  npRequireAgentRuntimeDefinitionJsonV1,
  npAgentRuntimeAdminOperationIdsV1,
  type NpAgentRuntimeAdminOperationIdV1,
} from "../agent-contract/runtime-admin-contract.js";
import { npRequireAgentBudgetV1, type NpAgentBudgetV1 } from "../agent-contract/wire-contract.js";
import {
  npResolveAgentBudgetV1,
  npRequireAgentBudgetNarrowingV1,
} from "../agent-contract/runtime-budget.js";

type Db = ReturnType<typeof getDb>;
type Agent = typeof npAgents.$inferSelect;
type Version = typeof npAgentVersions.$inferSelect;
type Principal = typeof npAgentPrincipals.$inferSelect;
type Policy = typeof npAgentPolicies.$inferSelect;

function safeError(code: string, status = 409): never {
  throw new NpAgentGatewayError(code, status, "Agent runtime operation is unavailable.");
}
function json(value: object): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}
function hash(purpose: string, value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(purpose).update("\0").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}

/** Private domain fingerprint; this does not add a canonical-purpose registry entry. */
export function npBuildAgentRuntimeDefinitionInputV1(value: unknown): {
  definitionJson: string;
  definitionHash: string;
} {
  value = cloneCanonicalRuntimeInput(value, "agent.runtime.definition", 1_048_576);
  const definition =
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion === "np.agent-policy-definition.v1"
      ? npRequireAgentPolicyDefinitionV1(value)
      : value &&
          typeof value === "object" &&
          "schemaVersion" in value &&
          value.schemaVersion === "np.agent-budget.v1"
        ? npRequireAgentBudgetV1(value)
        : npRequireAgentConfigurationDefinitionV1(value);
  return {
    definitionJson: serializeAgentCanonicalJson(definition),
    definitionHash: hash("np.agent-runtime-definition.v1", definition),
  };
}

export interface NpAgentRuntimeVersionEvidenceV1 {
  agent: Agent;
  version: Version;
  principal: Principal;
  definition: NpAgentConfigurationDefinitionV1;
  registry: NpAgentRecipeRegistryCanonicalV1;
}
export interface NpAgentRuntimePolicyEvidenceV1 {
  refs: NpAgentRunAdmissionPolicyRefV1[];
  /** Frozen, trusted operator instructions. Never an authority input or wire projection. */
  instructions: string[];
  frozenRules: NpAgentPolicyRulesV1[];
  effective: NpAgentResolvedPolicyV1;
}

function definitionFromRow(agent: Agent, version: Version): NpAgentConfigurationDefinitionV1 {
  return npRequireAgentConfigurationDefinitionV1({
    schemaVersion: "np.agent-configuration-definition.v1",
    name: agent.name,
    template: agent.template,
    modelConnectionId: version.modelConnectionId,
    model: version.model,
    scopes: version.scopes,
    autonomy: version.autonomy,
    capabilityModes: version.capabilityModes,
    policyMode: version.policyMode,
    budget: version.budget,
    settings: version.settings,
  });
}

async function configEvidence(
  definition: NpAgentConfigurationDefinitionV1,
  registry: NpAgentRecipeRegistryCanonicalV1,
) {
  const selected = [];
  for (const branch of definition.settings) {
    const recipe = registry.recipes.find(
      (entry) => entry.id === branch.recipeId && entry.version === branch.recipeVersion,
    );
    if (!recipe || !recipe.allowedTemplates.includes(definition.template))
      safeError("RUNTIME_RECIPE_UNAVAILABLE");
    npRequireAgentProviderSchemaValueV1(
      recipe.settingsSchema,
      json(branch),
      "agent.runtime.settings",
    );
    selected.push({
      id: recipe.id,
      version: recipe.version,
      fingerprint: await npDigestAgentRecipeRegistryCanonical(
        { ...registry, projection: "definition", recipes: [recipe] },
        registry.recipes,
      ),
    });
  }
  const { name: _label, ...versionFields } = definition;
  return {
    configHash: hash("np.agent-runtime-config.v1", { definition: versionFields, selected }),
    recipeRegistryFingerprint: await npDigestAgentRecipeRegistryCanonical(
      registry,
      registry.recipes,
    ),
  };
}

/** Caller owns the per-site runtime-control transaction. All retained bytes are verified. */
export async function npRequireAgentRuntimeVersionV1(input: {
  db: Db;
  siteId: string;
  agentId: string;
  versionId?: string;
  active?: boolean;
}): Promise<NpAgentRuntimeVersionEvidenceV1> {
  const [agent] = await input.db
    .select()
    .from(npAgents)
    .where(and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, input.agentId)))
    .limit(1);
  if (!agent) safeError("RUNTIME_RESOURCE_UNAVAILABLE", 404);
  const [principal] = await input.db
    .select()
    .from(npAgentPrincipals)
    .where(
      and(eq(npAgentPrincipals.siteId, input.siteId), eq(npAgentPrincipals.id, agent.principalId)),
    )
    .for("update")
    .limit(1);
  const versionId = input.versionId ?? agent.activeVersionId;
  if (!versionId || !principal || principal.kind !== "runtime")
    safeError("RUNTIME_AUTHORITY_INVALID");
  const [version] = await input.db
    .select()
    .from(npAgentVersions)
    .where(
      and(
        eq(npAgentVersions.siteId, input.siteId),
        eq(npAgentVersions.agentId, agent.id),
        eq(npAgentVersions.id, versionId),
      ),
    )
    .limit(1);
  if (!version) safeError("RUNTIME_RESOURCE_UNAVAILABLE", 404);
  const definition = definitionFromRow(agent, version);
  const registry = npRequireAgentRecipeRegistryCanonical(version.recipeRegistryBody);
  if (registry.projection !== "registry") safeError("RUNTIME_DEFINITION_INVALID");
  const evidence = await configEvidence(definition, registry);
  if (
    evidence.configHash !== version.configHash ||
    evidence.recipeRegistryFingerprint !== version.recipeRegistryFingerprint
  )
    safeError("RUNTIME_DEFINITION_INVALID");
  if (
    input.active !== false &&
    (agent.status !== "active" ||
      agent.activeVersionId !== version.id ||
      version.status !== "active" ||
      principal.status !== "active" ||
      !version.scopes.includes("site:read") ||
      serializeAgentCanonicalJson(principal.scopes) !== serializeAgentCanonicalJson(version.scopes))
  )
    safeError("RUNTIME_AUTHORITY_CHANGED");
  return { agent, version, principal, definition, registry };
}

async function verifiedPolicy(row: Policy) {
  const canonical = npRequireAgentPolicyCanonical({
    schemaVersion: "np.agent-policy.v1",
    instructions: row.instructions,
    rules: row.rules,
  });
  if ((await npDigestAgentPolicyCanonical(canonical)) !== row.contentHash)
    safeError("RUNTIME_POLICY_INVALID");
  return canonical;
}

/** Frozen instructions stay separate; current hard rules can only narrow frozen layers. */
export async function npResolveAgentRuntimePolicyV1(input: {
  db: Db;
  siteId: string;
  evidence: NpAgentRuntimeVersionEvidenceV1;
  settings: NpAgentRuntimeSettingsV1;
  settingsRevision: number;
  frameworkPolicy: { version: number; rules: NpAgentPolicyRulesV1 };
  frozenRefs?: readonly NpAgentRunAdmissionPolicyRefV1[];
  frozenSources?: NpAgentRuntimeAdmissionSourcesV1;
  providerDataMaximum?: NpAgentProviderDataClass;
}): Promise<NpAgentRuntimePolicyEvidenceV1> {
  const { definition, agent } = input.evidence;
  if (agent.siteId !== input.siteId || input.evidence.version.siteId !== input.siteId)
    safeError("RUNTIME_POLICY_INVALID");
  const rows = await input.db
    .select()
    .from(npAgentPolicies)
    .where(
      and(
        eq(npAgentPolicies.siteId, input.siteId),
        eq(npAgentPolicies.status, "active"),
        definition.policyMode === "site_and_agent"
          ? or(isNull(npAgentPolicies.agentId), eq(npAgentPolicies.agentId, agent.id))
          : isNull(npAgentPolicies.agentId),
      ),
    )
    .orderBy(asc(npAgentPolicies.id))
    .limit(3);
  if (
    rows.filter((row) => row.agentId === null).length > 1 ||
    rows.filter((row) => row.agentId !== null).length > 1
  )
    safeError("RUNTIME_POLICY_INVALID");
  const current = await Promise.all(rows.map(verifiedPolicy));
  const refs: NpAgentRunAdmissionPolicyRefV1[] = rows.map((row) => ({
    kind: row.agentId === null ? "site-policy" : "agent-policy",
    id: row.id,
    version: row.version,
    digest: row.contentHash,
  }));
  refs.push({
    kind: "feature-setting",
    id: null,
    version: input.settingsRevision,
    digest: await npDigestAgentPolicyCanonical({
      schemaVersion: "np.agent-policy.v1",
      instructions: "",
      rules: input.settings.defaultPolicyRules,
    }),
  });
  refs.push({
    kind: "framework",
    id: null,
    version: input.frameworkPolicy.version,
    digest: await npDigestAgentPolicyCanonical({
      schemaVersion: "np.agent-policy.v1",
      instructions: "",
      rules: input.frameworkPolicy.rules,
    }),
  });
  refs.sort((a, b) => a.kind.localeCompare(b.kind) || (a.id ?? "").localeCompare(b.id ?? ""));
  let instructions = current.map((policy) => policy.instructions);
  const currentRules = [
    input.frameworkPolicy.rules,
    input.settings.defaultPolicyRules,
    ...current.map((policy) => policy.rules),
  ];
  let frozenRules = currentRules;
  if (input.frozenRefs !== undefined) {
    if (
      input.frozenRefs.length < 2 ||
      input.frozenRefs.length > 4 ||
      !input.frozenSources ||
      new Set(input.frozenRefs.map((ref) => ref.kind)).size !== input.frozenRefs.length
    )
      safeError("RUNTIME_POLICY_INVALID");
    const sources = npRequireAgentRuntimeAdmissionSourcesV1(input.frozenSources);
    const feature = input.frozenRefs.find((ref) => ref.kind === "feature-setting");
    if (!feature) safeError("RUNTIME_POLICY_INVALID");
    const derived = await npDeriveAgentRuntimeAdmissionSourceRefsV1({
      sources,
      settingsRevision: feature.version,
    });
    for (const source of derived.policyRefs) {
      if (
        !input.frozenRefs.some(
          (ref) => serializeAgentCanonicalJson(ref) === serializeAgentCanonicalJson(source),
        )
      )
        safeError("RUNTIME_POLICY_INVALID");
    }
    frozenRules = [sources.frameworkPolicy.rules, sources.sitePolicy.rules];
    instructions = [];
    for (const ref of input.frozenRefs) {
      if (ref.kind === "feature-setting" || ref.kind === "framework") continue;
      const [row] = ref.id
        ? await input.db
            .select()
            .from(npAgentPolicies)
            .where(and(eq(npAgentPolicies.siteId, input.siteId), eq(npAgentPolicies.id, ref.id)))
            .limit(1)
        : [];
      if (
        !row ||
        row.version !== ref.version ||
        row.contentHash !== ref.digest ||
        row.status === "draft" ||
        (ref.kind === "site-policy"
          ? row.agentId !== null
          : ref.kind !== "agent-policy" ||
            row.agentId !== agent.id ||
            definition.policyMode !== "site_and_agent")
      )
        safeError("RUNTIME_POLICY_INVALID");
      const frozen = await verifiedPolicy(row);
      instructions.push(frozen.instructions);
      frozenRules.push(frozen.rules);
    }
  }
  return {
    refs: input.frozenRefs ? [...input.frozenRefs] : refs,
    instructions,
    frozenRules,
    effective: npResolveAgentPolicyV1({
      autonomy: definition.autonomy,
      capabilityModes: definition.capabilityModes,
      layers: input.frozenRefs ? [...frozenRules, ...currentRules] : currentRules,
      providerDataMaximum: input.providerDataMaximum,
    }),
  };
}

export interface NpAgentRuntimeServiceOptionsV1 extends NpAgentAdminAdmissionOptionsV1 {
  /** Explicit framework-owned complete installed set. No registry or worker is auto-installed. */
  recipes: NpAgentRecipeRegistryCanonicalV1;
  deploymentAuthority: { policyId: string; fingerprint: string; scopes: NpAgentScope[] };
  controls: NpAgentRuntimeControlsV1;
  deploymentBudget: NpAgentBudgetV1;
  frameworkPolicy: { version: number; rules: NpAgentPolicyRulesV1 };
}
export type NpAgentRuntimeDefinitionOperationV1 = Exclude<
  NpAgentRuntimeAdminOperationIdV1,
  "agents.configurations.run" | "agents.policies.simulate"
>;
export interface NpAgentRuntimeServiceV1 {
  executeAdmin(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    operationId: NpAgentRuntimeDefinitionOperationV1;
    targetId: string | null;
    command: unknown;
  }): Promise<NpAgentAdminExecutionResultV1<NpAgentJsonObject>>;
}

/** Explicit definition/policy service. It neither starts runs nor calls providers. */
export function createAgentRuntimeServiceV1(
  options: NpAgentRuntimeServiceOptionsV1,
): NpAgentRuntimeServiceV1 {
  const registry = npRequireAgentRecipeRegistryCanonical(options.recipes);
  const authority = structuredClone(options.deploymentAuthority);
  if (
    registry.projection !== "registry" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(authority.policyId) ||
    !/^cj1:sha256:[A-Za-z0-9_-]{43}$/.test(authority.fingerprint) ||
    !authority.scopes.includes("site:read") ||
    authority.scopes.some((scope) => !(scope in npAgentScopeStaffCapability)) ||
    [...new Set(authority.scopes)].sort().join(",") !== authority.scopes.join(",")
  )
    safeError("RUNTIME_CONFIGURATION_INVALID");
  const deploymentBudget = npResolveAgentBudgetV1(options.deploymentBudget);
  const frameworkPolicy = structuredClone(options.frameworkPolicy);
  npRequireAgentPolicyCanonical({
    schemaVersion: "np.agent-policy.v1",
    instructions: "",
    rules: frameworkPolicy.rules,
  });
  if (!Number.isSafeInteger(frameworkPolicy.version) || frameworkPolicy.version < 1)
    safeError("RUNTIME_CONFIGURATION_INVALID");
  const executableOperations = new Set<string>(
    npAgentRuntimeAdminOperationIdsV1.filter(
      (id) => id !== "agents.configurations.run" && id !== "agents.policies.simulate",
    ),
  );
  const admit = createAgentAdminAdmissionV1(options);
  const nowFn = options.now ?? (() => new Date());
  async function validateActivation(
    db: Db,
    siteId: string,
    actor: NpAgentAdminActorV1,
    agent: Agent,
    version: Version,
    settings: NpAgentRuntimeSettingsV1,
  ) {
    await options.controls.requireDependenciesReadyInTransaction({ db, siteId });
    await npMeasureAgentRuntimeBudgetV1({ db, siteId, now: nowFn() });
    await npMeasureAgentRuntimeBudgetV1({ db, siteId, agentId: agent.id, now: nowFn() });
    const definition = definitionFromRow(agent, version);
    npRequireAgentBudgetNarrowingV1(
      npResolveAgentBudgetV1(deploymentBudget, [settings.budgetCeiling]),
      definition.budget,
    );
    const calculated = await configEvidence(definition, registry);
    if (calculated.configHash !== version.configHash || !definition.scopes.includes("site:read"))
      safeError("RUNTIME_DEFINITION_STALE");
    const authorization = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      siteId,
      actor,
      nowFn(),
    );
    if (
      definition.scopes.some(
        (scope) =>
          !authority.scopes.includes(scope) ||
          !authorization.authority.capabilities.includes(npAgentScopeStaffCapability[scope]),
      )
    )
      safeError("SITE_ACCESS_DENIED", 403);
    for (const mode of definition.capabilityModes) {
      if (
        npMeetAgentAutonomyModesV1(mode.mode, definition.autonomy) !== mode.mode ||
        !definition.settings.some((branch) =>
          registry.recipes
            .find((recipe) => recipe.id === branch.recipeId)
            ?.capabilityIds.includes(mode.capabilityId),
        )
      )
        safeError("RUNTIME_MODE_INVALID");
    }
    const selected = definition.settings.map((branch) =>
      registry.recipes.find((recipe) => recipe.id === branch.recipeId)!,
    );
    if (
      selected.some((recipe) => recipe.providerMode === "required") &&
      !definition.modelConnectionId
    )
      safeError("RUNTIME_PROVIDER_UNAVAILABLE");
    if (definition.modelConnectionId) {
      const [connection] = await db
        .select()
        .from(npAgentConnections)
        .where(
          and(
            eq(npAgentConnections.siteId, siteId),
            eq(npAgentConnections.id, definition.modelConnectionId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !connection ||
        connection.kind !== "model" ||
        connection.status !== "ready" ||
        !connection.activeSecretVersionId ||
        !settings.allowedProviderIds.includes(connection.provider) ||
        connection.lastVerifiedConfigVersion !== connection.configVersion ||
        connection.lastVerifiedCredentialVersion !== connection.credentialVersion
      )
        safeError("RUNTIME_PROVIDER_UNAVAILABLE");
      const [snapshot] = await db
        .select()
        .from(npAgentConnectionConfigVersions)
        .where(
          and(
            eq(npAgentConnectionConfigVersions.siteId, siteId),
            eq(npAgentConnectionConfigVersions.connectionId, connection.id),
            eq(npAgentConnectionConfigVersions.id, connection.activeConfigSnapshotId),
          ),
        )
        .limit(1);
      const now = nowFn();
      if (
        !snapshot ||
        snapshot.state !== "active" ||
        snapshot.configHash !== connection.configHash ||
        snapshot.pricingCatalog.filter(
          (price) =>
            price.modelId === definition.model &&
            new Date(price.effectiveFrom) <= now &&
            (price.effectiveUntil === null || now < new Date(price.effectiveUntil)),
        ).length !== 1
      )
        safeError("RUNTIME_PRICING_UNAVAILABLE");
    }
    const evidence = await npRequireAgentRuntimeVersionV1({
      db,
      siteId,
      agentId: agent.id,
      versionId: version.id,
      active: false,
    });
    await npResolveAgentRuntimePolicyV1({
      db,
      siteId,
      evidence,
      settings,
      settingsRevision: 1,
      frameworkPolicy,
    });
  }
  function versionValues(definition: NpAgentConfigurationDefinitionV1) {
    return {
      modelConnectionId: definition.modelConnectionId,
      model: definition.model,
      scopes: definition.scopes,
      autonomy: definition.autonomy,
      capabilityModes: definition.capabilityModes,
      policyMode: definition.policyMode,
      budget: definition.budget,
      settings: definition.settings,
      recipeRegistryBody: registry,
    };
  }
  function result(resourceId: string, output: NpAgentJsonObject) {
    return { resourceId, output };
  }
  return {
    async executeAdmin(input) {
      npAssertAgentPreviewEffectsAllowed();
      if (!executableOperations.has(input.operationId))
        safeError("RUNTIME_OPERATION_UNAVAILABLE", 404);
      if (
        input.targetId !== null &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          input.targetId,
        )
      )
        safeError("RUNTIME_RESOURCE_UNAVAILABLE", 404);
      return npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db: tx, settings, revision }) => {
          const db = tx;
          return admit({
            ...input,
            db,
            mutate: async ({ command, now, invocationId }) => {
              const operation = input.operationId;
              const raw = command as unknown as Record<string, unknown>;
              if (
                operation === "agents.budgets.update" ||
                operation === "agents.runtime.pause" ||
                operation === "agents.runtime.resume"
              ) {
                const actorFingerprint = hash("np.agent-staff-actor.v1", {
                  siteId: input.siteId,
                  userId: input.actor.user.id,
                });
                if (raw.expectedVersion !== revision) safeError("RUNTIME_VERSION_CONFLICT");
                if (operation === "agents.runtime.pause")
                  return result(
                    invocationId,
                    json(
                      await options.controls.pauseInTransaction({
                        db: tx,
                        siteId: input.siteId,
                        expectedRevision: revision,
                        actorFingerprint,
                        reason: raw.reason as string,
                      }),
                    ),
                  );
                if (operation === "agents.runtime.resume")
                  return result(
                    invocationId,
                    json(
                      await options.controls.resumeAfterStaffAdmissionInTransaction({
                        db: tx,
                        siteId: input.siteId,
                        expectedRevision: revision,
                        actorFingerprint,
                        reason: raw.reason as string,
                      }),
                    ),
                  );
                const budget = npRequireAgentRuntimeDefinitionJsonV1(
                  "budget",
                  raw.definitionJson as string,
                );
                if (
                  npBuildAgentRuntimeDefinitionInputV1(budget).definitionHash !== raw.definitionHash
                )
                  safeError("RUNTIME_DEFINITION_INVALID");
                npRequireAgentBudgetNarrowingV1(deploymentBudget, budget);
                return result(
                  invocationId,
                  json(
                    await options.controls.updateInTransaction({
                      db: tx,
                      siteId: input.siteId,
                      expectedRevision: revision,
                      actorFingerprint,
                      settings: { ...settings, budgetCeiling: budget },
                    }),
                  ),
                );
              }
              if (operation.startsWith("agents.policies.")) {
                const [row] = input.targetId
                  ? await db
                      .select()
                      .from(npAgentPolicies)
                      .where(
                        and(
                          eq(npAgentPolicies.siteId, input.siteId),
                          eq(npAgentPolicies.id, input.targetId),
                        ),
                      )
                      .for("update")
                      .limit(1)
                  : [];
                if (
                  operation !== "agents.policies.create" &&
                  (!row ||
                    row.rowVersion !== raw.expectedVersion ||
                    row.contentHash !== raw.configHash)
                )
                  safeError(
                    row ? "RUNTIME_VERSION_CONFLICT" : "RUNTIME_RESOURCE_UNAVAILABLE",
                    row ? 409 : 404,
                  );
                if (
                  operation === "agents.policies.create" ||
                  operation === "agents.policies.update"
                ) {
                  const definition = npRequireAgentRuntimeDefinitionJsonV1(
                    "policy",
                    raw.definitionJson as string,
                  );
                  if (
                    npBuildAgentRuntimeDefinitionInputV1(definition).definitionHash !==
                      raw.definitionHash ||
                    (row && (row.status !== "draft" || row.agentId !== definition.agentId))
                  )
                    safeError("RUNTIME_DEFINITION_INVALID");
                  if (definition.agentId) {
                    const [agent] = await db
                      .select()
                      .from(npAgents)
                      .where(
                        and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, definition.agentId)),
                      )
                      .limit(1);
                    if (!agent || agent.status === "archived")
                      safeError("RUNTIME_RESOURCE_UNAVAILABLE", 404);
                  }
                  const canonical = npRequireAgentPolicyCanonical({
                    schemaVersion: "np.agent-policy.v1",
                    instructions: definition.instructions,
                    rules: definition.rules,
                  });
                  const contentHash = await npDigestAgentPolicyCanonical(canonical);
                  const values = {
                    name: definition.name,
                    instructions: canonical.instructions,
                    rules: canonical.rules,
                    contentHash,
                  };
                  let id = row?.id;
                  if (row)
                    await db
                      .update(npAgentPolicies)
                      .set({ ...values, rowVersion: row.rowVersion + 1 })
                      .where(eq(npAgentPolicies.id, row.id));
                  else {
                    const [latest] = await db
                      .select({ version: npAgentPolicies.version })
                      .from(npAgentPolicies)
                      .where(
                        and(
                          eq(npAgentPolicies.siteId, input.siteId),
                          definition.agentId === null
                            ? isNull(npAgentPolicies.agentId)
                            : eq(npAgentPolicies.agentId, definition.agentId),
                        ),
                      )
                      .orderBy(desc(npAgentPolicies.version))
                      .limit(1);
                    id = randomUUID();
                    await db.insert(npAgentPolicies).values({
                      id,
                      siteId: input.siteId,
                      agentId: definition.agentId,
                      version: (latest?.version ?? 0) + 1,
                      status: "draft",
                      createdBy: input.actor.user.id,
                      createdAt: now,
                      ...values,
                    });
                  }
                  return result(id, {
                    id: id,
                    rowVersion: row ? row.rowVersion + 1 : 1,
                    contentHash,
                    status: "draft",
                  });
                }
                if (!row) safeError("RUNTIME_RESOURCE_UNAVAILABLE", 404);
                await verifiedPolicy(row);
                if (operation === "agents.policies.validate")
                  return result(row.id, { id: row.id, valid: true, contentHash: row.contentHash });
                if (operation !== "agents.policies.activate")
                  safeError("RUNTIME_OPERATION_UNAVAILABLE", 404);
                if (row.status !== "draft") safeError("RUNTIME_VERSION_CONFLICT");
                await db
                  .update(npAgentPolicies)
                  .set({ status: "retired", rowVersion: sql`${npAgentPolicies.rowVersion} + 1` })
                  .where(
                    and(
                      eq(npAgentPolicies.siteId, input.siteId),
                      eq(npAgentPolicies.status, "active"),
                      row.agentId === null
                        ? isNull(npAgentPolicies.agentId)
                        : eq(npAgentPolicies.agentId, row.agentId),
                    ),
                  );
                await db
                  .update(npAgentPolicies)
                  .set({ status: "active", activatedAt: now, rowVersion: row.rowVersion + 1 })
                  .where(eq(npAgentPolicies.id, row.id));
                return result(row.id, {
                  id: row.id,
                  rowVersion: row.rowVersion + 1,
                  contentHash: row.contentHash,
                  status: "active",
                });
              }
              if (operation === "agents.configurations.create") {
                const definition = npRequireAgentRuntimeDefinitionJsonV1(
                  "configuration",
                  raw.definitionJson as string,
                );
                if (
                  npBuildAgentRuntimeDefinitionInputV1(definition).definitionHash !==
                  raw.definitionHash
                )
                  safeError("RUNTIME_DEFINITION_INVALID");
                const evidence = await configEvidence(definition, registry);
                const id = randomUUID(),
                  versionId = randomUUID(),
                  principalId = randomUUID();
                await db.insert(npAgentPrincipals).values({
                  id: principalId,
                  siteId: input.siteId,
                  kind: "runtime",
                  name: definition.name,
                  status: "suspended",
                  scopes: [],
                  authorityKind: "deployment",
                  authorityPolicyId: authority.policyId,
                  authorityFingerprint: authority.fingerprint,
                  ownerUserId: input.actor.user.id,
                  createdAt: now,
                  updatedAt: now,
                });
                await db.insert(npAgents).values({
                  id,
                  siteId: input.siteId,
                  principalId,
                  name: definition.name,
                  template: definition.template,
                  status: "draft",
                  draftVersionId: versionId,
                  createdBy: input.actor.user.id,
                  createdAt: now,
                  updatedAt: now,
                });
                await db.insert(npAgentVersions).values({
                  id: versionId,
                  siteId: input.siteId,
                  agentId: id,
                  version: 1,
                  status: "draft",
                  createdBy: input.actor.user.id,
                  createdAt: now,
                  ...versionValues(definition),
                  ...evidence,
                });
                return result(id, {
                  id,
                  rowVersion: 1,
                  status: "draft",
                  versionId,
                  configHash: evidence.configHash,
                });
              }
              const [agent] = input.targetId
                ? await db
                    .select()
                    .from(npAgents)
                    .where(and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, input.targetId)))
                    .limit(1)
                : [];
              if (!agent) safeError("RUNTIME_RESOURCE_UNAVAILABLE", 404);
              const [principal] = await db
                .select()
                .from(npAgentPrincipals)
                .where(
                  and(
                    eq(npAgentPrincipals.siteId, input.siteId),
                    eq(npAgentPrincipals.id, agent.principalId),
                  ),
                )
                .for("update")
                .limit(1);
              if (
                !principal ||
                principal.kind !== "runtime" ||
                principal.authorityKind !== "deployment" ||
                principal.authorityPolicyId !== authority.policyId ||
                principal.authorityFingerprint !== authority.fingerprint ||
                agent.status === "archived" ||
                principal.status === "revoked"
              )
                safeError("RUNTIME_AUTHORITY_CHANGED");
              if (agent.rowVersion !== raw.expectedVersion) safeError("RUNTIME_VERSION_CONFLICT");
              const versionId =
                operation === "agents.configurations.activate" ||
                operation === "agents.configurations.update"
                  ? (agent.draftVersionId ?? agent.activeVersionId)
                  : agent.activeVersionId;
              const [version] = versionId
                ? await db
                    .select()
                    .from(npAgentVersions)
                    .where(
                      and(
                        eq(npAgentVersions.siteId, input.siteId),
                        eq(npAgentVersions.agentId, agent.id),
                        eq(npAgentVersions.id, versionId),
                      ),
                    )
                    .limit(1)
                : [];
              if ("configHash" in raw && (!version || version.configHash !== raw.configHash))
                safeError("RUNTIME_VERSION_CONFLICT");
              if (operation === "agents.configurations.update") {
                const definition = npRequireAgentRuntimeDefinitionJsonV1(
                  "configuration",
                  raw.definitionJson as string,
                );
                if (
                  definition.template !== agent.template ||
                  npBuildAgentRuntimeDefinitionInputV1(definition).definitionHash !==
                    raw.definitionHash
                )
                  safeError("RUNTIME_DEFINITION_INVALID");
                const evidence = await configEvidence(definition, registry);
                let draftVersionId = agent.draftVersionId;
                if (draftVersionId && version?.status === "draft")
                  await db
                    .update(npAgentVersions)
                    .set({
                      ...versionValues(definition),
                      ...evidence,
                      rowVersion: version.rowVersion + 1,
                    })
                    .where(eq(npAgentVersions.id, draftVersionId));
                else {
                  const [latest] = await db
                    .select({ version: npAgentVersions.version })
                    .from(npAgentVersions)
                    .where(
                      and(
                        eq(npAgentVersions.siteId, input.siteId),
                        eq(npAgentVersions.agentId, agent.id),
                      ),
                    )
                    .orderBy(desc(npAgentVersions.version))
                    .limit(1);
                  draftVersionId = randomUUID();
                  await db.insert(npAgentVersions).values({
                    id: draftVersionId,
                    siteId: input.siteId,
                    agentId: agent.id,
                    version: (latest?.version ?? 0) + 1,
                    status: "draft",
                    createdBy: input.actor.user.id,
                    createdAt: now,
                    ...versionValues(definition),
                    ...evidence,
                  });
                }
                await db
                  .update(npAgents)
                  .set({
                    name: definition.name,
                    draftVersionId,
                    rowVersion: agent.rowVersion + 1,
                    updatedAt: now,
                  })
                  .where(eq(npAgents.id, agent.id));
                await db
                  .update(npAgentPrincipals)
                  .set({
                    name: definition.name,
                    rowVersion: principal.rowVersion + 1,
                    updatedAt: now,
                  })
                  .where(eq(npAgentPrincipals.id, principal.id));
                return result(agent.id, {
                  id: agent.id,
                  rowVersion: agent.rowVersion + 1,
                  status: agent.status,
                  versionId: draftVersionId,
                  configHash: evidence.configHash,
                });
              }
              let status: string;
              if (
                operation === "agents.configurations.activate" ||
                operation === "agents.configurations.resume"
              ) {
                if (
                  !version ||
                  (operation === "agents.configurations.activate"
                    ? version.status !== "draft"
                    : !["paused", "error"].includes(agent.status) || version.status !== "active")
                )
                  safeError("RUNTIME_VERSION_CONFLICT");
                await validateActivation(db, input.siteId, input.actor, agent, version, settings);
                if (operation === "agents.configurations.activate") {
                  if (agent.activeVersionId)
                    await db
                      .update(npAgentVersions)
                      .set({
                        status: "retired",
                        retiredAt: now,
                        rowVersion: sql`${npAgentVersions.rowVersion} + 1`,
                      })
                      .where(eq(npAgentVersions.id, agent.activeVersionId));
                  await db
                    .update(npAgentVersions)
                    .set({ status: "active", activatedAt: now, rowVersion: version.rowVersion + 1 })
                    .where(eq(npAgentVersions.id, version.id));
                }
                status = "active";
              } else if (operation === "agents.configurations.pause") {
                if (!agent.activeVersionId || !["active", "paused", "error"].includes(agent.status))
                  safeError("RUNTIME_VERSION_CONFLICT");
                status = "paused";
              } else if (operation === "agents.configurations.archive") status = "archived";
              else safeError("RUNTIME_OPERATION_UNAVAILABLE", 404);
              if (status === "archived" && agent.draftVersionId) {
                await db
                  .update(npAgents)
                  .set({ draftVersionId: null })
                  .where(eq(npAgents.id, agent.id));
              }
              await db
                .update(npAgents)
                .set({
                  status,
                  ...(operation === "agents.configurations.activate"
                    ? { activeVersionId: version.id, draftVersionId: null }
                    : {}),
                  rowVersion: agent.rowVersion + 1,
                  updatedAt: now,
                })
                .where(eq(npAgents.id, agent.id));
              await db
                .update(npAgentPrincipals)
                .set({
                  status:
                    status === "active"
                      ? "active"
                      : status === "archived"
                        ? "revoked"
                        : "suspended",
                  scopes: status === "active" ? version.scopes : principal.scopes,
                  revokedAt: status === "archived" ? now : null,
                  rowVersion: principal.rowVersion + 1,
                  tokenVersion: principal.tokenVersion + 1,
                  updatedAt: now,
                })
                .where(eq(npAgentPrincipals.id, principal.id));
              // Dispatch registration is AP-503. Existing rows can only remain enabled for this exact version.
              if (status === "archived" || operation === "agents.configurations.activate")
                await db
                  .update(npAgentTriggers)
                  .set({ enabled: false, updatedAt: now })
                  .where(
                    and(
                      eq(npAgentTriggers.siteId, input.siteId),
                      eq(npAgentTriggers.agentId, agent.id),
                    ),
                  );
              return result(agent.id, {
                id: agent.id,
                rowVersion: agent.rowVersion + 1,
                status,
                versionId: status === "active" ? version.id : agent.activeVersionId,
                configHash: version?.configHash ?? null,
              });
            },
          });
        },
      );
    },
  };
}
