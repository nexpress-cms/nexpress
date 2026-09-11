import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgents,
  npAgentVersions,
  npAgentPrincipals,
  npAgentPolicies,
  npAgentRuns,
  npAgentInvocations,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import {
  npSessions,
  npSettings,
  npSiteMemberships,
  npUsers,
} from "../../../packages/core/src/db/schema/system.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import {
  npRequireAgentRuntimeAdminInputV1,
  npRequireAgentRuntimeDefinitionJsonV1,
} from "../../../packages/core/src/agent-contract/runtime-admin-contract.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../../../packages/core/src/agent-contract/runtime-contract.js";
import { npRequireAgentRunLimitsCanonical } from "../../../packages/core/src/agent-contract/canonical-bodies.js";
import type { NpAgentBudgetV1 } from "../../../packages/core/src/agent-contract/wire-contract.js";
import { runtimeFixture, runtimeBudget, siteId } from "./agent-runtime-service-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";

type RuntimeFixture = Awaited<ReturnType<typeof runtimeFixture>>;

async function mutationFootprint(f: RuntimeFixture) {
  const [agents, versions, principals, policies, runs, invocations, audit, settings] =
    await Promise.all([
      f.db
        .select({
          id: npAgents.id,
          status: npAgents.status,
          rowVersion: npAgents.rowVersion,
          activeVersionId: npAgents.activeVersionId,
          draftVersionId: npAgents.draftVersionId,
        })
        .from(npAgents)
        .where(eq(npAgents.siteId, siteId))
        .orderBy(npAgents.id),
      f.db
        .select({
          id: npAgentVersions.id,
          status: npAgentVersions.status,
          rowVersion: npAgentVersions.rowVersion,
          configHash: npAgentVersions.configHash,
        })
        .from(npAgentVersions)
        .where(eq(npAgentVersions.siteId, siteId))
        .orderBy(npAgentVersions.id),
      f.db
        .select({
          id: npAgentPrincipals.id,
          status: npAgentPrincipals.status,
          rowVersion: npAgentPrincipals.rowVersion,
          tokenVersion: npAgentPrincipals.tokenVersion,
          scopes: npAgentPrincipals.scopes,
        })
        .from(npAgentPrincipals)
        .where(eq(npAgentPrincipals.siteId, siteId))
        .orderBy(npAgentPrincipals.id),
      f.db
        .select({
          id: npAgentPolicies.id,
          status: npAgentPolicies.status,
          rowVersion: npAgentPolicies.rowVersion,
          contentHash: npAgentPolicies.contentHash,
        })
        .from(npAgentPolicies)
        .where(eq(npAgentPolicies.siteId, siteId))
        .orderBy(npAgentPolicies.id),
      f.db
        .select({ id: npAgentRuns.id, state: npAgentRuns.state })
        .from(npAgentRuns)
        .where(eq(npAgentRuns.siteId, siteId))
        .orderBy(npAgentRuns.id),
      f.db
        .select({
          id: npAgentInvocations.id,
          state: npAgentInvocations.state,
          operationId: npAgentInvocations.operationId,
        })
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.siteId, siteId))
        .orderBy(npAgentInvocations.id),
      f.db
        .select({ id: npAuditEvents.id, action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.siteId, siteId))
        .orderBy(npAuditEvents.id),
      f.db
        .select({ key: npSettings.key, value: npSettings.value })
        .from(npSettings)
        .where(eq(npSettings.siteId, siteId))
        .orderBy(npSettings.key),
    ]);
  return { agents, versions, principals, policies, runs, invocations, audit, settings };
}

async function updateSiteBudget(f: RuntimeFixture, budget: NpAgentBudgetV1) {
  const revision = await npWithAgentRuntimeControlTransactionV1(siteId, (context) =>
    Promise.resolve(context.revision),
  );
  await f.service.executeAdmin({
    siteId,
    actor: f.actor.actor,
    operationId: "agents.budgets.update",
    targetId: null,
    command: {
      expectedVersion: revision,
      idempotencyKey: randomUUID(),
      ...npBuildAgentRuntimeDefinitionInputV1(budget),
    },
  });
}

const strictWindowCeilings = {
  runsPerHour: 10,
  providerCallsPerHour: 20,
  inputTokensPerDay: 30,
  outputTokensPerDay: 40,
  inputTokensPerMonth: 300,
  outputTokensPerMonth: 400,
  costMicrosPerDay: 50,
  costMicrosPerMonth: 500,
} satisfies Partial<NpAgentBudgetV1>;

const narrowerWindowCeilings = {
  runsPerHour: 5,
  providerCallsPerHour: 10,
  inputTokensPerDay: 15,
  outputTokensPerDay: 20,
  inputTokensPerMonth: 150,
  outputTokensPerMonth: 200,
  costMicrosPerDay: 25,
  costMicrosPerMonth: 250,
} satisfies Partial<NpAgentBudgetV1>;

describe("Runtime definition builder boundaries", () => {
  it("preserves the existing character limit for multibyte policy instructions", () => {
    const definition = {
      schemaVersion: "np.agent-policy-definition.v1",
      agentId: null,
      name: "Bounded policy guidance",
      instructions: "정".repeat(100_000),
      rules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
    };
    const built = npBuildAgentRuntimeDefinitionInputV1(definition);
    expect(built.definitionJson.length).toBeLessThanOrEqual(262_144);
    expect(Buffer.byteLength(built.definitionJson)).toBeGreaterThan(262_144);
    expect(npRequireAgentRuntimeDefinitionJsonV1("policy", built.definitionJson)).toEqual(
      definition,
    );
    const command = npRequireAgentRuntimeAdminInputV1("agents.policies.create", {
      idempotencyKey: randomUUID(),
      ...built,
    });
    expect(command.definitionJson).toBe(built.definitionJson);
    expect(npBuildAgentRuntimeDefinitionInputV1(JSON.parse(built.definitionJson))).toEqual(built);
  });
});

describe.skipIf(skipIfNoTestDb())("Runtime admission and mutation boundaries", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("rejects deferred run/simulate operation IDs before any invocation or resource mutation", async () => {
    const f = await runtimeFixture();
    const draftPolicy = await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.policies.create",
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1({
          schemaVersion: "np.agent-policy-definition.v1",
          agentId: null,
          name: "Unactivated boundary policy",
          instructions: "",
          rules: structuredClone(f.settings.defaultPolicyRules),
        }),
      },
    });
    const commands = [
      {
        operationId: "agents.configurations.run" as const,
        targetId: f.created.resourceId,
        command: npRequireAgentRuntimeAdminInputV1("agents.configurations.run", {
          expectedVersion: f.current.output.rowVersion,
          configHash: f.current.output.configHash,
          idempotencyKey: randomUUID(),
          inputJson: "{}",
          triggerId: randomUUID(),
        }),
      },
      {
        operationId: "agents.policies.simulate" as const,
        targetId: draftPolicy.resourceId,
        command: npRequireAgentRuntimeAdminInputV1("agents.policies.simulate", {
          expectedVersion: draftPolicy.output.rowVersion,
          configHash: draftPolicy.output.contentHash,
          idempotencyKey: randomUUID(),
          fixtureJson: "{}",
          fixtureHash: draftPolicy.output.contentHash,
        }),
      },
    ];
    const before = await mutationFootprint(f);
    for (const command of commands) {
      // Type erasure represents a direct JavaScript caller of the server API.
      const forged = { siteId, actor: f.actor.actor, ...command } as unknown as Parameters<
        typeof f.service.executeAdmin
      >[0];
      await expect(f.service.executeAdmin(forged)).rejects.toMatchObject({
        code: "RUNTIME_OPERATION_UNAVAILABLE",
        status: 404,
      });
      expect(await mutationFootprint(f)).toEqual(before);
    }
  });

  it("closes root admission against caller authority fields, missing keys and unexecuted accessors", async () => {
    const f = await runtimeFixture();
    const before = await mutationFootprint(f);
    for (const extra of [
      { principalId: randomUUID() },
      { connectionId: randomUUID() },
      { scopes: ["changeset:apply"] },
      { inputJson: "{}" },
    ]) {
      await expect(
        (async () => f.admission.admit({ ...f.runInput, ...extra }))(),
      ).rejects.toBeDefined();
    }
    const { expectedVersionId: _version, ...missing } = f.runInput;
    await expect(
      (async () => f.admission.admit(missing as typeof f.runInput))(),
    ).rejects.toBeDefined();
    let reads = 0;
    for (const key of ["siteId", "recipeId", "idempotencyKey"] as const) {
      const hostile = { ...f.runInput };
      Object.defineProperty(hostile, key, {
        enumerable: true,
        get() {
          reads += 1;
          return f.runInput[key];
        },
      });
      await expect((async () => f.admission.admit(hostile))()).rejects.toBeDefined();
    }
    expect(reads).toBe(0);
    expect(await mutationFootprint(f)).toEqual(before);
  });

  it.each(["revoked-session", "stale-token", "removed-membership", "reduced-membership"] as const)(
    "rechecks %s through the common staff admission before a supported mutation",
    async (boundary) => {
      const f = await runtimeFixture();
      const userId = f.actor.actor.user.id;
      const membership = and(
        eq(npSiteMemberships.siteId, siteId),
        eq(npSiteMemberships.userId, userId),
      );
      if (boundary === "revoked-session")
        await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
      if (boundary === "stale-token")
        await f.db
          .update(npUsers)
          .set({ tokenVersion: f.actor.actor.user.tokenVersion + 1 })
          .where(eq(npUsers.id, userId));
      if (boundary === "removed-membership") await f.db.delete(npSiteMemberships).where(membership);
      if (boundary === "reduced-membership")
        await f.db.update(npSiteMemberships).set({ role: "viewer" }).where(membership);
      const before = await mutationFootprint(f);
      await expect(
        f.service.executeAdmin({
          siteId,
          actor: f.actor.actor,
          operationId: "agents.configurations.pause",
          targetId: f.created.resourceId,
          command: {
            idempotencyKey: randomUUID(),
            expectedVersion: f.current.output.rowVersion,
            reason: "Request containment",
          },
        }),
      ).rejects.toMatchObject(
        boundary === "revoked-session" || boundary === "stale-token"
          ? { code: "STAFF_AUTHORIZATION_REQUIRED", status: 401 }
          : { code: "SITE_ACCESS_DENIED", status: 403 },
      );
      expect(await mutationFootprint(f)).toEqual(before);
    },
  );

  it.each([false, true])(
    "rejects policy activation after its session expires during reauthentication (replay: %s)",
    async (replay) => {
      const f = await runtimeFixture();
      const policy = await f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.policies.create",
        targetId: null,
        command: {
          idempotencyKey: randomUUID(),
          ...npBuildAgentRuntimeDefinitionInputV1({
            schemaVersion: "np.agent-policy-definition.v1",
            agentId: null,
            name: "Session-bound activation",
            instructions: "",
            rules: structuredClone(f.settings.defaultPolicyRules),
          }),
        },
      });
      const request = {
        siteId,
        actor: f.actor.actor,
        operationId: "agents.policies.activate" as const,
        targetId: policy.resourceId,
        command: {
          idempotencyKey: randomUUID(),
          expectedVersion: policy.output.rowVersion,
          configHash: policy.output.contentHash,
        },
      };
      if (replay) await f.service.executeAdmin(request);
      await f.db
        .update(npSessions)
        .set({ accessExpiresAt: new Date(f.options.now().getTime() + 1_000) })
        .where(eq(npSessions.id, f.actor.actor.sessionId));
      let checks = 0;
      const service = createAgentRuntimeServiceV1({
        ...f.options,
        reauthentication: {
          verify: () => {
            checks += 1;
            f.advance(2);
            return true;
          },
        },
      });
      const before = await mutationFootprint(f);
      await expect(service.executeAdmin(request)).rejects.toMatchObject({
        code: "STAFF_AUTHORIZATION_REQUIRED",
        status: 401,
      });
      expect(checks).toBe(1);
      expect(await mutationFootprint(f)).toEqual(before);
    },
  );

  it.each(["activate", "resume"] as const)(
    "requires current worker readiness before per-Agent %s",
    async (operation) => {
      const f = await runtimeFixture(runtimeBudget(), operation === "resume");
      const current =
        operation === "resume"
          ? await f.service.executeAdmin({
              siteId,
              actor: f.actor.actor,
              operationId: "agents.configurations.pause",
              targetId: f.created.resourceId,
              command: {
                idempotencyKey: randomUUID(),
                expectedVersion: f.current.output.rowVersion,
                reason: "Prepare current-readiness review",
              },
            })
          : f.current;
      f.state.ready = false;
      const before = await mutationFootprint(f);
      await expect(
        f.service.executeAdmin({
          siteId,
          actor: f.actor.actor,
          operationId:
            operation === "activate"
              ? "agents.configurations.activate"
              : "agents.configurations.resume",
          targetId: f.created.resourceId,
          command: {
            idempotencyKey: randomUUID(),
            expectedVersion: current.output.rowVersion,
            configHash: current.output.configHash,
          },
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_READINESS_BLOCKED" });
      expect(await mutationFootprint(f)).toEqual(before);
    },
  );

  it("allows reviewed activation during global containment without reopening run admission", async () => {
    const f = await runtimeFixture(runtimeBudget(), false);
    await f.controls.pause({ siteId, reason: "Repair definitions under containment" });
    const settings = (await mutationFootprint(f)).settings;
    const active = await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.activate",
      targetId: f.created.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: f.current.output.rowVersion,
        configHash: f.current.output.configHash,
      },
    });
    expect(active.output.status).toBe("active");
    expect((await mutationFootprint(f)).settings).toEqual(settings);
    await expect(f.admission.admit(f.runInput)).rejects.toMatchObject({ code: "RUNTIME_PAUSED" });
    expect(await f.db.select({ id: npAgentRuns.id }).from(npAgentRuns)).toEqual([]);
  });

  it("preserves the canonical run idempotency bound and rejects changed replay inputs", async () => {
    const f = await runtimeFixture();
    const key = `r${"a".repeat(127)}`;
    const input = { ...f.runInput, idempotencyKey: key };
    const admitted = await f.admission.admit(input);
    const beforeReplay = await mutationFootprint(f);
    expect(await f.admission.admit(input)).toEqual({ ...admitted, replayed: true });
    await expect(
      f.admission.admit({ ...input, recipeId: "guardian.agent-abuse" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      (async () => f.admission.admit({ ...input, scopes: [] } as typeof input))(),
    ).rejects.toBeDefined();
    // The general invocation key parser accepts 256; the existing run owner remains capped at 128.
    for (const idempotencyKey of [
      "",
      "-invalid",
      "invalid key",
      "r".repeat(129),
      "r".repeat(256),
      "r".repeat(257),
      "키",
    ])
      await expect(
        (async () => f.admission.admit({ ...input, idempotencyKey }))(),
      ).rejects.toBeDefined();
    expect(await mutationFootprint(f)).toEqual(beforeReplay);
    const [stored] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, admitted.runId));
    expect(stored.idempotencyKey).toBe(key);
  });

  it("preserves frozen site hourly, daily and monthly ceilings while applying current reductions", async () => {
    const f = await runtimeFixture();
    const strict = runtimeBudget(strictWindowCeilings);
    await updateSiteBudget(f, strict);
    const admitted = await f.admission.admit(f.runInput);
    const [stored] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, admitted.runId));
    await updateSiteBudget(f, runtimeBudget());
    await f.admission.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
      expect(context.settings.budgetCeiling.inputTokensPerDay).toBe(1_000);
      expect(context.siteBudget).toMatchObject(strictWindowCeilings);
      expect(context.agentBudget).toMatchObject(strictWindowCeilings);
      expect(context.run.runtimeAdmissionSources?.siteBudget).toEqual(strict);
      return Promise.resolve();
    });
    await updateSiteBudget(f, runtimeBudget(narrowerWindowCeilings));
    await f.admission.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
      expect(context.siteBudget).toMatchObject(narrowerWindowCeilings);
      expect(context.agentBudget).toMatchObject(narrowerWindowCeilings);
      return Promise.resolve();
    });
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, admitted.runId)))[0],
    ).toEqual(stored);
  });

  it("preserves frozen deployment window ceilings across explicit host reconfiguration", async () => {
    const f = await runtimeFixture(runtimeBudget(strictWindowCeilings));
    const admitted = await f.admission.admit(f.runInput);
    const [stored] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, admitted.runId));
    for (const [deploymentBudget, expected] of [
      [runtimeBudget(), strictWindowCeilings],
      [runtimeBudget(narrowerWindowCeilings), narrowerWindowCeilings],
    ] as const) {
      const currentHost = createAgentRuntimeAdmissionV1({
        ...f.options,
        deploymentBudget,
        runLimits: npRequireAgentRunLimitsCanonical(stored.runLimits),
      });
      await currentHost.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
        expect(context.siteBudget).toMatchObject(expected);
        expect(context.agentBudget).toMatchObject(expected);
        return Promise.resolve();
      });
    }
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, admitted.runId)))[0],
    ).toEqual(stored);
  });

  it("narrows current per-run attempt and capability ceilings and treats zero as denial", async () => {
    const f = await runtimeFixture();
    await updateSiteBudget(
      f,
      runtimeBudget({ attemptsPerRun: 2, capabilityCallsPerRun: 2, providerCallsPerRun: 0 }),
    );
    const admitted = await f.admission.admit(f.runInput);
    const [stored] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, admitted.runId));
    expect(stored.runLimits).toMatchObject({
      maxAttempts: 2,
      maxCapabilityCalls: 2,
      maxProviderCalls: 1,
    });
    expect(stored.connectionId).toBeNull();
    await updateSiteBudget(
      f,
      runtimeBudget({ attemptsPerRun: 1, capabilityCallsPerRun: 1, providerCallsPerRun: 0 }),
    );
    await f.admission.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
      expect(context.limits).toMatchObject({
        maxAttempts: 1,
        maxCapabilityCalls: 1,
        maxProviderCalls: 1,
        maxInputTokens: 0,
        maxOutputTokens: 0,
      });
      expect(context.agentBudget.providerCallsPerRun).toBe(0);
      expect(context.connection).toBeNull();
      return Promise.resolve();
    });
    let callbacks = 0;
    for (const budget of [
      runtimeBudget({ attemptsPerRun: 0, capabilityCallsPerRun: 1, providerCallsPerRun: 0 }),
      runtimeBudget({ attemptsPerRun: 1, capabilityCallsPerRun: 0, providerCallsPerRun: 0 }),
    ]) {
      await updateSiteBudget(f, budget);
      await expect(
        f.admission.withCurrentRun({ siteId, runId: admitted.runId }, () => {
          callbacks += 1;
          return Promise.resolve();
        }),
      ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_EXHAUSTED" });
    }
    expect(callbacks).toBe(0);
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, admitted.runId)))[0],
    ).toEqual(stored);
  });

  it("keeps frozen per-run limits when both budget and host limits expand", async () => {
    const f = await runtimeFixture();
    await updateSiteBudget(
      f,
      runtimeBudget({ ...strictWindowCeilings, attemptsPerRun: 1, capabilityCallsPerRun: 1 }),
    );
    const admitted = await f.admission.admit(f.runInput);
    const [stored] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, admitted.runId));
    const frozenLimits = npRequireAgentRunLimitsCanonical(stored.runLimits);
    await updateSiteBudget(f, runtimeBudget());
    const broadHost = createAgentRuntimeAdmissionV1({
      ...f.options,
      runLimits: {
        ...frozenLimits,
        maxAttempts: 50,
        maxCapabilityCalls: 50,
        maxWallClockSeconds: 600,
      },
    });
    await broadHost.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
      expect(context.settings.budgetCeiling.attemptsPerRun).toBe(1_000);
      expect(context.limits).toEqual(frozenLimits);
      expect(context.siteBudget).toMatchObject(strictWindowCeilings);
      expect(context.agentBudget).toMatchObject({ attemptsPerRun: 1, capabilityCallsPerRun: 1 });
      return Promise.resolve();
    });
    const shorterHost = createAgentRuntimeAdmissionV1({
      ...f.options,
      runLimits: { ...frozenLimits, maxWallClockSeconds: 60 },
    });
    await shorterHost.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
      expect(context.limits.maxWallClockSeconds).toBe(60);
      return Promise.resolve();
    });
    f.advance(61);
    await expect(
      shorterHost.withCurrentRun({ siteId, runId: admitted.runId }, () => Promise.resolve(true)),
    ).rejects.toMatchObject({ code: "RUNTIME_ADMISSION_DENIED" });
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, admitted.runId)))[0],
    ).toEqual(stored);
  });

  it("applies newly stricter framework rules without rewriting the frozen framework evidence", async () => {
    const f = await runtimeFixture();
    const admitted = await f.admission.admit(f.runInput);
    const [stored] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, admitted.runId));
    const stricter = structuredClone(f.options.frameworkPolicy.rules);
    stricter.resources.collections = [];
    stricter.capabilityModes = [];
    const currentHost = createAgentRuntimeAdmissionV1({
      ...f.options,
      frameworkPolicy: { version: 2, rules: stricter },
      runLimits: npRequireAgentRunLimitsCanonical(stored.runLimits),
    });
    await currentHost.withCurrentRun({ siteId, runId: admitted.runId }, (context) => {
      expect(context.policy.effective.resources.collections).toEqual([]);
      expect(context.policy.effective.capabilityModes).toEqual([]);
      expect(context.policy.refs.find((ref) => ref.kind === "framework")?.version).toBe(1);
      expect(context.run.runtimeAdmissionSources?.frameworkPolicyVersion).toBe(1);
      return Promise.resolve();
    });
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, admitted.runId)))[0],
    ).toEqual(stored);
  });

  it("keeps a frozen framework denial after later framework expansion", async () => {
    const f = await runtimeFixture();
    const first = await f.admission.admit(f.runInput);
    const [firstRun] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, first.runId));
    const strictRules = structuredClone(f.options.frameworkPolicy.rules);
    strictRules.resources.collections = [];
    const strictHost = createAgentRuntimeAdmissionV1({
      ...f.options,
      frameworkPolicy: { version: 2, rules: strictRules },
      runLimits: npRequireAgentRunLimitsCanonical(firstRun.runLimits),
    });
    const strictRun = await strictHost.admit({ ...f.runInput, idempotencyKey: randomUUID() });
    const broadHost = createAgentRuntimeAdmissionV1({
      ...f.options,
      frameworkPolicy: { version: 3, rules: structuredClone(f.options.frameworkPolicy.rules) },
      runLimits: npRequireAgentRunLimitsCanonical(firstRun.runLimits),
    });
    await broadHost.withCurrentRun({ siteId, runId: strictRun.runId }, (context) => {
      expect(context.policy.effective.resources.collections).toEqual([]);
      expect(context.run.runtimeAdmissionSources?.frameworkPolicyVersion).toBe(2);
      return Promise.resolve();
    });
    await broadHost.withCurrentRun({ siteId, runId: first.runId }, (context) => {
      expect(context.policy.effective.resources.collections).toBeNull();
      return Promise.resolve();
    });
  });
});
