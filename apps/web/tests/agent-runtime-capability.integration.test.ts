import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentPrincipals,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  runtimeFixture,
  runtimeDefinition,
  runtimeBudget,
  siteId,
} from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function fixture() {
  const f = await runtimeFixture(runtimeBudget(), false);
  const definition = runtimeDefinition();
  definition.scopes = ["content:read", "site:read"];
  definition.capabilityModes = [{ capabilityId: "content.query", mode: "observe" }];
  const recipes = structuredClone(f.options.recipes);
  recipes.recipes[0].capabilityIds = ["content.query"];
  const settings = structuredClone(f.settings);
  settings.defaultPolicyRules.capabilityModes = definition.capabilityModes;
  await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision }) =>
    f.controls.updateInTransaction({
      db,
      siteId,
      expectedRevision: revision,
      actorFingerprint: f.options.deploymentAuthority.fingerprint,
      settings,
    }),
  );
  const options = {
    ...f.options,
    recipes,
    deploymentAuthority: { ...f.options.deploymentAuthority, scopes: definition.scopes },
    frameworkPolicy: { version: 1, rules: settings.defaultPolicyRules },
  };
  const service = createAgentRuntimeServiceV1(options);
  const created = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.create",
    targetId: null,
    command: { idempotencyKey: randomUUID(), ...npBuildAgentRuntimeDefinitionInputV1(definition) },
  });
  const active = await service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.configurations.activate",
    targetId: created.resourceId,
    command: {
      expectedVersion: 1,
      configHash: created.output.configHash,
      idempotencyKey: randomUUID(),
    },
  });
  const admission = createAgentRuntimeAdmissionV1({
    ...options,
    runLimits: {
      schemaVersion: "np.agent-run-limits.v1",
      maxAttempts: 2,
      maxProviderCalls: 2,
      maxCapabilityCalls: 2,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxCostMicros: 100,
      maxWallClockSeconds: 120,
    },
  });
  const runInput = {
    ...f.runInput,
    agentId: created.resourceId,
    expectedVersionId: active.output.versionId as string,
  };
  const executors = createAgentCoreReadCapabilityExecutorsV1({
    cursorHmacKey: { id: "runtime-test", key: new Uint8Array(32).fill(7) },
    resolveUser: () => null,
    resolveBlockSchemas: () => [],
  });
  const readState = { fail: false };
  executors["content.query"] = async (input) => {
    if (readState.fail) throw new Error("private-runtime-read-failure");
    return {
      schemaVersion: "np.agent-content-query.v1",
      collection: input.collection,
      items: [],
      nextCursor: null,
    };
  };
  const registry = await createAgentReadCapabilityRegistryV1(executors);
  const capability = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: admission,
    resolveGatewaySettings: () => ({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: "disabled",
      mcpHttp: "disabled",
      agentHttp: "disabled",
    }),
    now: f.options.now,
  });
  const { runId } = await admission.admit(runInput);
  const store = createAgentRuntimeExecutionStoreV1({ admission, now: f.options.now });
  const acquired = await store.claim({ siteId, runId });
  if (!acquired.claim) throw new Error("Expected runtime claim");
  const input = {
    siteId,
    runId,
    claim: acquired.claim,
    sequence: 1,
    request: {
      schemaVersion: "np.agent-invocation-request.v1" as const,
      capabilityId: "content.query" as const,
      arguments: {
        input: {
          collection: "posts",
          filter: null,
          fields: [],
          audience: "public" as const,
          status: "published" as const,
          sort: [],
          limit: 10,
          cursor: null,
        },
        idempotencyKey: null,
      },
    },
  };
  return { ...f, admission, registry, capability, store, input, readState };
}
describe.skipIf(skipIfNoTestDb())("Runtime capability admission", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(closeTestDb);
  it("shares exact read descriptors and journals honest runtime authority with all Gateway transports disabled", async () => {
    const f = await fixture();
    const result = await f.capability.invokeRuntime(f.input);
    const [action] = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.id, result.actionId));
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, result.invocationId));
    expect(action).toMatchObject({ runId: f.input.runId, sequence: 1, state: "succeeded" });
    expect(invocation).toMatchObject({
      transport: "runtime",
      state: "completed",
      authorityRef: { kind: "runtime-run", runId: f.input.runId },
    });
    expect(invocation.authorizationContextBody).toMatchObject({
      transport: "runtime",
      gatewayExposure: null,
    });
    const replay = await f.capability.invokeRuntime(f.input);
    expect(replay.invocationId).toBe(result.invocationId);
    expect(replay.actionId).toBe(result.actionId);
    await f.admission.withCurrentRun(
      { siteId, runId: f.input.runId, claim: f.input.claim },
      async (context) => {
        expect(
          f.capability.sourceEntries(context).map((entry) => entry.canonical.descriptor.id),
        ).toEqual(["content.query"]);
        expect(await f.capability.runtimeActionOutcomes(context)).toEqual([
          { capabilityId: "content.query", state: "succeeded", safeCode: null },
        ]);
      },
    );
  });
  it("blocks wrong site/run/lease and stale principal scopes before invocation", async () => {
    const f = await fixture();
    for (const input of [
      { ...f.input, siteId: "another-site" },
      { ...f.input, runId: randomUUID() },
      { ...f.input, claim: { ...f.input.claim, attempt: f.input.claim.attempt + 1 } },
    ])
      await expect(f.capability.invokeRuntime(input)).rejects.toBeDefined();
    const principalId = await f.admission.withCurrentRun(
      { siteId, runId: f.input.runId, claim: f.input.claim },
      async (context) => context.evidence.principal.id,
    );
    await f.db
      .update(npAgentPrincipals)
      .set({ scopes: ["site:read"] })
      .where(eq(npAgentPrincipals.id, principalId));
    await expect(f.capability.invokeRuntime(f.input)).rejects.toBeDefined();
    expect(
      await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.input.runId)),
    ).toHaveLength(0);
  });
  it("does not project or directly invoke uninstalled deployment ChangeSet authority", async () => {
    const f = await fixture();
    await expect(
      f.capability.invokeRuntime({
        ...f.input,
        request: {
          schemaVersion: "np.agent-invocation-request.v1",
          capabilityId: "changeset.get",
          arguments: { idempotencyKey: null, input: { changeSetId: randomUUID() } },
        },
      }),
    ).rejects.toBeDefined();
  });
  it("binds sequence idempotency and filters expired or tampered metadata", async () => {
    const f = await fixture();
    const result = await f.capability.invokeRuntime(f.input);
    await f.db
      .update(npAgentActions)
      .set({ outputHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentActions.id, result.actionId));
    await expect(f.capability.invokeRuntime(f.input)).rejects.toBeDefined();
    f.advance(2);
    await f.db
      .update(npAgentInvocations)
      .set({ expiresAt: new Date(f.options.now().getTime() - 1) })
      .where(
        and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, result.invocationId)),
      );
    await f.admission.withCurrentRun(
      { siteId, runId: f.input.runId, claim: f.input.claim },
      async (context) => expect(await f.capability.runtimeActionOutcomes(context)).toEqual([]),
    );
  });
  it("counts actual actions instead of provider turn sequence toward the capability ceiling", async () => {
    const f = await fixture();
    await f.capability.invokeRuntime({ ...f.input, sequence: 3 });
    await f.capability.invokeRuntime({ ...f.input, sequence: 5 });
    await expect(f.capability.invokeRuntime({ ...f.input, sequence: 7 })).rejects.toMatchObject({
      code: "RUNTIME_BUDGET_EXCEEDED",
    });
  });
  it("commits failed read evidence before returning the safe error", async () => {
    const f = await fixture();
    f.readState.fail = true;
    await expect(f.capability.invokeRuntime(f.input)).rejects.toBeDefined();
    const actions = await f.db
      .select()
      .from(npAgentActions)
      .where(eq(npAgentActions.runId, f.input.runId));
    expect(actions).toHaveLength(1);
    expect(actions[0].state).toBe("failed");
    const [invocation] = await f.db
      .select()
      .from(npAgentInvocations)
      .where(eq(npAgentInvocations.id, actions[0].invocationId!));
    expect(invocation.state).toBe("failed");
    expect(JSON.stringify({ actions, invocation })).not.toContain("private-runtime-read-failure");
  });
});
