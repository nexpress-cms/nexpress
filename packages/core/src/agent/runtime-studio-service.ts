import { createHash } from "node:crypto";
import { and, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgents,
  npAgentVersions,
  npAgentPolicies,
  npAgentTriggers,
  npAgentConnections,
  npAgentConnectionConfigVersions,
} from "../db/schema/agent.js";
import {
  npResolveAgentStaffSessionAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
} from "./admin-admission.js";
import { createAgentCursorCodecV1 } from "./cursor.js";
import {
  npWithAgentRuntimeControlTransactionV1,
  type NpAgentRuntimeControlsV1,
} from "./runtime-controls.js";
import { npRequireAgentRuntimeVersionV1, type NpAgentRuntimeServiceV1 } from "./runtime-service.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentPolicyCanonical,
  npDigestAgentPolicyCanonical,
} from "../agent-contract/canonical-notification-policy.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
import {
  npRequireAgentRuntimeStudioQueryV1,
  npRequireAgentRuntimeStudioConfigurationV1,
  npRequireAgentRuntimeStudioPolicyV1,
  npRequireAgentRuntimeStudioTriggerV1,
  npAnalyzeAgentRuntimeStudioConfigurationsPageV1,
  npAnalyzeAgentRuntimeStudioPoliciesPageV1,
  npAnalyzeAgentRuntimeStudioTriggersPageV1,
  npRequireAgentRuntimeStudioBudgetV1,
  npRequireAgentRuntimeStudioCatalogV1,
  npRequireAgentRuntimeStudioEffectiveV1,
  npAgentRuntimeStudioBlockerCodesV1,
  npRequireAgentRuntimeStudioOverviewV1,
  type NpAgentRuntimeStudioKindV1,
  type NpAgentRuntimeStudioConfigurationV1,
  type NpAgentRuntimeStudioPolicyV1,
  type NpAgentRuntimeStudioTriggerV1,
} from "../agent-contract/runtime-studio-contract.js";
import type { NpAgentRuntimeAdminOperationIdV1 } from "../agent-contract/runtime-admin-contract.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../agent-contract/runtime-contract.js";
import { npResolveAgentBudgetV1 } from "../agent-contract/runtime-budget.js";
import {
  npAgentAutonomyModes,
  npAgentScopeStaffCapability,
  type NpAgentCapabilityDescriptor,
} from "../agent-contract/types.js";
import { npAgentInstalledCapabilityDescriptorsV1 } from "../agent-contract/installed-capability-contract.js";
import {
  npMeasureAgentRuntimeBudgetV1,
  npRequireAgentRuntimeUsageKnownV1,
} from "./runtime-budget.js";
import { collectAgentRuntimeMaintenanceV1 } from "./runtime-maintenance.js";
import {
  npParseAgentStoredProviderConnectionConfigV1,
  type NpAgentConnectionAuthAdapterRegistryV1,
} from "./provider-auth-contract.js";

type Db = ReturnType<typeof getDb>;
type Staff = { siteId: string; actor: NpAgentAdminActorV1 };
type Agent = typeof npAgents.$inferSelect;
type Policy = typeof npAgentPolicies.$inferSelect;
type Trigger = typeof npAgentTriggers.$inferSelect;
const missing = () =>
  new NpAgentGatewayError(
    "RUNTIME_RESOURCE_UNAVAILABLE",
    404,
    "Agent runtime resource is unavailable.",
  );
const invalidCursor = () =>
  new NpAgentGatewayError("ACTIVITY_CURSOR_INVALID", 400, "Activity cursor is invalid.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface NpAgentRuntimeStudioServiceOptionsV1 {
  service: NpAgentRuntimeServiceV1;
  controls: NpAgentRuntimeControlsV1;
  cursorHmacKey: Uint8Array;
  providerRegistry?: NpAgentConnectionAuthAdapterRegistryV1;
  now?: () => Date;
}

/** Explicit staff projection over the existing Runtime services and same-site tables. */
export function createAgentRuntimeStudioServiceV1(options: NpAgentRuntimeStudioServiceOptionsV1) {
  const now = options.now ?? (() => new Date());
  const cursor = createAgentCursorCodecV1(options.cursorHmacKey, "np.agent-runtime-studio.cursor");
  async function staff(db: Db, input: Staff) {
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      input.siteId,
      input.actor,
      now(),
    );
    if (!auth.authority.capabilities.includes("admin.manage"))
      throw new NpAgentGatewayError("ACTIVITY_FORBIDDEN", 403, "Activity permission is required.");
    return auth;
  }
  async function read<T>(
    input: Staff,
    fn: (db: Db, auth: Awaited<ReturnType<typeof staff>>) => Promise<T>,
  ): Promise<T> {
    return npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
      const auth = await staff(db, input);
      const result = await fn(db, auth);
      if (serializeAgentCanonicalJson(await staff(db, input)) !== serializeAgentCanonicalJson(auth))
        throw new NpAgentGatewayError(
          "ACTIVITY_FORBIDDEN",
          403,
          "Activity permission is required.",
        );
      return result;
    });
  }
  async function configuration(db: Db, row: Agent): Promise<NpAgentRuntimeStudioConfigurationV1> {
    let versionId = row.draftVersionId ?? row.activeVersionId;
    // Archiving a never-activated Agent clears its editable pointer while retaining
    // the immutable source row. Read that bounded history without reviving a draft.
    if (!versionId && row.status === "archived") {
      const [retained] = await db
        .select({ id: npAgentVersions.id })
        .from(npAgentVersions)
        .where(and(eq(npAgentVersions.siteId, row.siteId), eq(npAgentVersions.agentId, row.id)))
        .orderBy(desc(npAgentVersions.version), desc(npAgentVersions.id))
        .limit(1);
      versionId = retained?.id ?? null;
    }
    if (!versionId) throw missing();
    const evidence = await npRequireAgentRuntimeVersionV1({
      db,
      siteId: row.siteId,
      agentId: row.id,
      versionId,
      active: false,
    });
    const principal = evidence.principal;
    const expectedStatus =
      row.status === "active" ? "active" : row.status === "archived" ? "revoked" : "suspended";
    if (principal.status !== expectedStatus || (row.status === "draft" && principal.scopes.length))
      throw missing();
    let activeVersion: { id: string; configHash: string } | null = null;
    let manualRecipeIds: (typeof evidence.definition.settings)[number]["recipeId"][] = [];
    if (row.draftVersionId === versionId && evidence.version.status !== "draft") throw missing();
    if (row.activeVersionId) {
      const active =
        row.activeVersionId === evidence.version.id
          ? evidence
          : await npRequireAgentRuntimeVersionV1({
              db,
              siteId: row.siteId,
              agentId: row.id,
              versionId: row.activeVersionId,
              active: false,
            });
      if (active.version.status !== "active") throw missing();
      activeVersion = { id: active.version.id, configHash: active.version.configHash };
      if (
        row.status === "active" &&
        options.service.getDefinitionInventory().manualAdmissionAvailable
      ) {
        const [manual] = await db
          .select({ id: npAgentTriggers.id })
          .from(npAgentTriggers)
          .where(
            and(
              eq(npAgentTriggers.siteId, row.siteId),
              eq(npAgentTriggers.agentId, row.id),
              eq(npAgentTriggers.agentVersionId, active.version.id),
              eq(npAgentTriggers.kind, "manual"),
              eq(npAgentTriggers.enabled, true),
            ),
          )
          .limit(1);
        if (manual)
          manualRecipeIds = active.definition.settings
            .filter((branch) =>
              active.registry.recipes.some(
                (recipe) =>
                  recipe.id === branch.recipeId &&
                  recipe.triggerKinds.includes("manual") &&
                  recipe.manualInputSchema === null &&
                  recipe.task === "interactive-capability",
              ),
            )
            .map((branch) => branch.recipeId);
      }
      if (
        serializeAgentCanonicalJson(principal.scopes) !==
        serializeAgentCanonicalJson(active.version.scopes)
      )
        throw missing();
    }
    const availableActions: NpAgentRuntimeAdminOperationIdV1[] = [];
    if (row.status !== "archived") {
      availableActions.push("agents.configurations.update", "agents.configurations.archive");
      if (row.draftVersionId) availableActions.push("agents.configurations.activate");
      if (row.status === "active") availableActions.push("agents.configurations.pause");
      if (manualRecipeIds.length) availableActions.push("agents.configurations.run");
      if (row.status === "paused" || row.status === "error")
        availableActions.push("agents.configurations.resume");
    }
    return npRequireAgentRuntimeStudioConfigurationV1({
      schemaVersion: "np.agent-configuration.v1",
      id: row.id,
      principalId: row.principalId,
      status: row.status,
      rowVersion: row.rowVersion,
      versionId,
      version: evidence.version.version,
      versionStatus: evidence.version.status,
      activeVersion,
      manualRecipeIds,
      draftVersionId: row.draftVersionId,
      configHash: evidence.version.configHash,
      definition: evidence.definition,
      availableActions: availableActions.sort(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async function policy(row: Policy): Promise<NpAgentRuntimeStudioPolicyV1> {
    const canonical = npRequireAgentPolicyCanonical({
      schemaVersion: "np.agent-policy.v1",
      instructions: row.instructions,
      rules: row.rules,
    });
    if ((await npDigestAgentPolicyCanonical(canonical)) !== row.contentHash) throw missing();
    return npRequireAgentRuntimeStudioPolicyV1({
      schemaVersion: "np.agent-policy-detail.v1",
      id: row.id,
      rowVersion: row.rowVersion,
      version: row.version,
      status: row.status,
      contentHash: row.contentHash,
      definition: {
        schemaVersion: "np.agent-policy-definition.v1",
        agentId: row.agentId,
        name: row.name,
        instructions: canonical.instructions,
        rules: canonical.rules,
      },
      availableActions:
        row.status === "draft"
          ? ["agents.policies.activate", "agents.policies.update", "agents.policies.validate"]
          : ["agents.policies.validate"],
      createdAt: row.createdAt.toISOString(),
    });
  }
  function trigger(row: Trigger): NpAgentRuntimeStudioTriggerV1 {
    const hash = `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(row.filter)).digest("base64url")}`;
    if (hash !== row.filterHash) throw missing();
    return npRequireAgentRuntimeStudioTriggerV1({
      schemaVersion: "np.agent-trigger-detail.v1",
      agentId: row.agentId,
      agentVersionId: row.agentVersionId,
      definition:
        row.kind === "event"
          ? {
              type: row.kind,
              id: row.id,
              eventKind: row.eventType,
              filter: row.filter,
              coalesceSeconds: row.coalesceSeconds,
            }
          : row.kind === "schedule"
            ? { type: row.kind, id: row.id, cron: row.cron, catchUp: row.catchUp }
            : { type: row.kind, id: row.id },
      enabled: row.enabled,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async function getConfiguration(input: Staff & { id: string }) {
    if (!uuid.test(input.id)) throw missing();
    return read(input, async (db) => {
      const [row] = await db
        .select()
        .from(npAgents)
        .where(and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, input.id)))
        .limit(1);
      if (!row) throw missing();
      return configuration(db, row);
    });
  }
  async function getPolicy(input: Staff & { id: string }) {
    if (!uuid.test(input.id)) throw missing();
    return read(input, async (db) => {
      const [row] = await db
        .select()
        .from(npAgentPolicies)
        .where(and(eq(npAgentPolicies.siteId, input.siteId), eq(npAgentPolicies.id, input.id)))
        .limit(1);
      if (!row) throw missing();
      return policy(row);
    });
  }
  async function list(kind: NpAgentRuntimeStudioKindV1, input: Staff & { query?: unknown }) {
    const query = npRequireAgentRuntimeStudioQueryV1(kind, input.query ?? {});
    return read(input, async (db, auth) => {
      const { cursor: suppliedCursor, ...filters } = query;
      const binding = cursor.mac(
        serializeAgentCanonicalJson({
          siteId: input.siteId,
          sessionId: input.actor.sessionId,
          auth,
          kind,
          filters,
        }),
      );
      let position: { id: string; time: string } | null = null;
      if (suppliedCursor) {
        try {
          const data = cursor.open(suppliedCursor) as {
            binding: string;
            expires: number;
            position: { id: string; time: string };
          };
          if (
            data.binding !== binding ||
            !Number.isSafeInteger(data.expires) ||
            data.expires <= now().getTime() ||
            !uuid.test(data.position.id) ||
            new Date(data.position.time).toISOString() !== data.position.time
          )
            throw invalidCursor();
          position = data.position;
        } catch {
          throw invalidCursor();
        }
      }
      const table =
        kind === "configurations"
          ? npAgents
          : kind === "policies"
            ? npAgentPolicies
            : npAgentTriggers;
      const clauses: (SQL | undefined)[] = [
        eq(table.siteId, input.siteId),
        position
          ? or(
              lt(table.createdAt, new Date(position.time)),
              and(eq(table.createdAt, new Date(position.time)), lt(table.id, position.id)),
            )
          : undefined,
      ];
      if (kind === "configurations") {
        if (query.status) clauses.push(eq(npAgents.status, query.status));
        if (query.template) clauses.push(eq(npAgents.template, query.template));
        if (query.name)
          clauses.push(ilike(npAgents.name, `%${query.name.replace(/[\\%_]/gu, "\\$&")}%`));
        if (query.connectionId)
          clauses.push(
            sql`exists (select 1 from ${npAgentVersions} v where v.site_id=${npAgents.siteId} and v.agent_id=${npAgents.id} and v.id=coalesce(${npAgents.draftVersionId},${npAgents.activeVersionId},case when ${npAgents.status}='archived' then (select retained.id from ${npAgentVersions} retained where retained.site_id=${npAgents.siteId} and retained.agent_id=${npAgents.id} order by retained.version desc, retained.id desc limit 1) else null end) and v.model_connection_id=${query.connectionId})`,
          );
        if (query.triggerKind)
          clauses.push(
            sql`exists (select 1 from ${npAgentTriggers} t where t.site_id=${npAgents.siteId} and t.agent_id=${npAgents.id} and t.agent_version_id=${npAgents.activeVersionId} and t.kind=${query.triggerKind})`,
          );
      } else if (kind === "policies") {
        if (query.status) clauses.push(eq(npAgentPolicies.status, query.status));
        if (query.agentId) clauses.push(eq(npAgentPolicies.agentId, query.agentId));
      } else {
        if (query.agentId) clauses.push(eq(npAgentTriggers.agentId, query.agentId));
        if (query.triggerKind) clauses.push(eq(npAgentTriggers.kind, query.triggerKind));
      }
      const rows = await db
        .select({ id: table.id, createdAt: table.createdAt })
        .from(table)
        .where(and(...clauses))
        .orderBy(desc(table.createdAt), desc(table.id))
        .limit(query.limit + 1);
      const selected = rows.slice(0, query.limit);
      const items: Array<
        | NpAgentRuntimeStudioConfigurationV1
        | NpAgentRuntimeStudioPolicyV1
        | NpAgentRuntimeStudioTriggerV1
      > = [];
      for (const row of selected) {
        if (kind === "configurations") {
          const [value] = await db
            .select()
            .from(npAgents)
            .where(and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, row.id)))
            .limit(1);
          if (!value) throw missing();
          items.push(await configuration(db, value));
        } else if (kind === "policies") {
          const [value] = await db
            .select()
            .from(npAgentPolicies)
            .where(and(eq(npAgentPolicies.siteId, input.siteId), eq(npAgentPolicies.id, row.id)))
            .limit(1);
          if (!value) throw missing();
          items.push(await policy(value));
        } else {
          const [value] = await db
            .select()
            .from(npAgentTriggers)
            .where(and(eq(npAgentTriggers.siteId, input.siteId), eq(npAgentTriggers.id, row.id)))
            .limit(1);
          if (!value) throw missing();
          items.push(trigger(value));
        }
      }
      const last = selected.at(-1);
      const nextCursor =
        rows.length > query.limit && last
          ? cursor.seal({
              binding,
              expires: now().getTime() + 900_000,
              position: { id: last.id, time: last.createdAt.toISOString() },
            })
          : null;
      const schemaVersion =
        kind === "configurations"
          ? "np.agent-configurations-page.v1"
          : kind === "policies"
            ? "np.agent-policies-page.v1"
            : "np.agent-triggers-page.v1";
      const page = { schemaVersion, items, nextCursor };
      if (kind === "configurations")
        return npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioConfigurationsPageV1(page));
      if (kind === "policies")
        return npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioPoliciesPageV1(page));
      return npRequireAgentContractResult(npAnalyzeAgentRuntimeStudioTriggersPageV1(page));
    });
  }
  async function getBudget(input: Staff) {
    return read(input, (db) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ settings, revision }) => {
          let usage = null;
          try {
            await npRequireAgentRuntimeUsageKnownV1({ db, siteId: input.siteId });
            usage = await npMeasureAgentRuntimeBudgetV1({ db, siteId: input.siteId, now: now() });
          } catch {
            /* Unknown stays unavailable. */
          }
          return npRequireAgentRuntimeStudioBudgetV1({
            schemaVersion: "np.agent-runtime-budget.v1",
            rowVersion: revision,
            siteCeiling: settings.budgetCeiling,
            deploymentCeiling: options.service.getDefinitionInventory().deploymentBudget,
            effectiveCeiling: npResolveAgentBudgetV1(
              options.service.getDefinitionInventory().deploymentBudget,
              [settings.budgetCeiling],
            ),
            measurement: usage ? "available" : "unavailable",
            usage,
          });
        },
        db,
      ),
    );
  }
  async function getStatus(input: Staff) {
    return read(input, async (db) => {
      const status = await options.controls.statusInTransaction({ db, siteId: input.siteId });
      let operations = null;
      try {
        operations = await collectAgentRuntimeMaintenanceV1(
          { siteId: input.siteId, now: now() },
          db,
        );
      } catch {
        /* No guessed aggregates. */
      }
      return npRequireAgentRuntimeStudioOverviewV1({
        schemaVersion: "np.agent-runtime-overview.v1",
        status,
        operations,
      });
    });
  }
  async function getEffective(input: Staff & { id: string; version?: "active" }) {
    if (!uuid.test(input.id)) throw missing();
    return read(input, async (db) => {
      const [row] = await db
        .select()
        .from(npAgents)
        .where(and(eq(npAgents.siteId, input.siteId), eq(npAgents.id, input.id)))
        .limit(1);
      if (!row) throw missing();
      const detail = await configuration(db, row);
      const selectedVersion =
        input.version === "active"
          ? detail.activeVersion
          : { id: detail.versionId, configHash: detail.configHash };
      if (!selectedVersion) throw missing();
      const status = await options.controls.statusInTransaction({ db, siteId: input.siteId });
      let policyRefs: Awaited<
        ReturnType<NpAgentRuntimeServiceV1["reviewEffective"]>
      >["policyRefs"] = [];
      const blockers: Array<(typeof npAgentRuntimeStudioBlockerCodesV1)[number]> = [];
      try {
        const review = await options.service.reviewEffective({
          ...input,
          agentId: input.id,
          versionId: selectedVersion.id,
          db,
        });
        policyRefs = review.policyRefs;
      } catch (error) {
        const code =
          error instanceof NpAgentGatewayError
            ? npAgentRuntimeStudioBlockerCodesV1.find((code) => code === error.code)
            : undefined;
        blockers.push(code ?? "RUNTIME_CONFIGURATION_INVALID");
      }
      return npRequireAgentRuntimeStudioEffectiveV1({
        schemaVersion: "np.agent-effective-config.v1",
        id: detail.id,
        rowVersion: detail.rowVersion,
        versionId: selectedVersion.id,
        configHash: selectedVersion.configHash,
        ready: blockers.length === 0,
        blockers,
        policyRefs,
        readiness: status.readiness,
      });
    });
  }
  async function getCatalog(input: Staff) {
    return read(input, (db, auth) =>
      npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ settings }) => {
          const inventory = options.service.getDefinitionInventory();
          const scopes = inventory.scopes.filter((scope) =>
            auth.authority.capabilities.includes(npAgentScopeStaffCapability[scope]),
          );
          const descriptors: NpAgentCapabilityDescriptor[] = Object.values(
            npAgentInstalledCapabilityDescriptorsV1,
          );
          const capabilities = descriptors
            .filter(
              (descriptor) =>
                descriptor.requiredScopes.every((scope) => scopes.includes(scope)) &&
                inventory.recipes.recipes.some((recipe) =>
                  recipe.capabilityIds.includes(descriptor.id),
                ),
            )
            .map((descriptor) => ({
              id: descriptor.id,
              modes: npAgentAutonomyModes.filter(
                (mode) =>
                  descriptor.risk === "read" ||
                  (descriptor.approval === "human"
                    ? mode === "approved" || mode === "advise"
                    : mode !== "observe"),
              ),
            }));
          const recipes = inventory.recipes.recipes
            .filter((recipe) =>
              recipe.capabilityIds.every((id) =>
                capabilities.some((capability) => capability.id === id),
              ),
            )
            .map(
              ({ id, version, allowedTemplates, providerMode, triggerKinds, capabilityIds }) => ({
                id,
                version,
                allowedTemplates,
                providerMode,
                triggerKinds,
                capabilityIds,
              }),
            );
          const connections: Array<{ id: string; alias: string; models: string[] }> = [];
          if (options.providerRegistry) {
            const rows = await db
              .select()
              .from(npAgentConnections)
              .where(
                and(
                  eq(npAgentConnections.siteId, input.siteId),
                  eq(npAgentConnections.kind, "model"),
                  eq(npAgentConnections.status, "ready"),
                ),
              )
              .orderBy(npAgentConnections.id)
              .limit(100);
            for (const connection of rows) {
              if (
                !connection.activeSecretVersionId ||
                !settings.allowedProviderIds.includes(connection.provider) ||
                connection.lastVerifiedConfigVersion !== connection.configVersion ||
                connection.lastVerifiedCredentialVersion !== connection.credentialVersion
              )
                continue;
              const [snapshot] = await db
                .select()
                .from(npAgentConnectionConfigVersions)
                .where(
                  and(
                    eq(npAgentConnectionConfigVersions.siteId, input.siteId),
                    eq(npAgentConnectionConfigVersions.connectionId, connection.id),
                    eq(npAgentConnectionConfigVersions.id, connection.activeConfigSnapshotId),
                  ),
                )
                .limit(1);
              if (
                !snapshot ||
                snapshot.state !== "active" ||
                snapshot.configHash !== connection.configHash
              )
                continue;
              try {
                const { parsed } = await npParseAgentStoredProviderConnectionConfigV1({
                  registry: options.providerRegistry,
                  connection,
                  snapshot,
                });
                const at = now();
                const prices = parsed.pricingCatalog.filter(
                  (price) =>
                    new Date(price.effectiveFrom) <= at &&
                    (price.effectiveUntil === null || at < new Date(price.effectiveUntil)),
                );
                const models = [...new Set(prices.map((price) => price.modelId))]
                  .filter((model) => prices.filter((price) => price.modelId === model).length === 1)
                  .sort();
                if (models.length)
                  connections.push({ id: connection.id, alias: connection.name, models });
              } catch {
                /* Invalid retained adapter evidence is not a selectable model. */
              }
            }
          }
          return npRequireAgentRuntimeStudioCatalogV1({
            schemaVersion: "np.agent-runtime-catalog.v1",
            recipes,
            scopes,
            capabilities,
            connections,
            selfDelegation: { userId: input.actor.user.id },
            effectiveBudget: npResolveAgentBudgetV1(inventory.deploymentBudget, [
              settings.budgetCeiling,
            ]),
            defaultPolicyRules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
          });
        },
        db,
      ),
    );
  }
  return {
    getConfiguration,
    getPolicy,
    getBudget,
    getStatus,
    getEffective,
    getCatalog,
    listConfigurations: (input: Staff & { query?: unknown }) => list("configurations", input),
    listPolicies: (input: Staff & { query?: unknown }) => list("policies", input),
    listTriggers: (input: Staff & { query?: unknown }) => list("triggers", input),
    executeAdmin: (input: Parameters<NpAgentRuntimeServiceV1["executeAdmin"]>[0]) =>
      options.service.executeAdmin(input),
  };
}
export type NpAgentRuntimeStudioServiceV1 = ReturnType<typeof createAgentRuntimeStudioServiceV1>;
