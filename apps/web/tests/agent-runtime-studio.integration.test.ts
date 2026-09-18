import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgents,
  npAgentPrincipals,
  npAgentRuns,
  npAgentTriggers,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions, npSiteMemberships } from "../../../packages/core/src/db/schema/system.js";
import { createAgentRuntimeStudioServiceV1 } from "../../../packages/core/src/agent/runtime-studio-service.js";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import {
  runtimeFixture,
  runtimeRecipes,
  runtimeBudget,
  siteId,
} from "./agent-runtime-service-fixture.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof runtimeFixture>>;
function studio(f: Fixture, service = f.service) {
  return createAgentRuntimeStudioServiceV1({
    service,
    controls: f.controls,
    cursorHmacKey: new Uint8Array(32).fill(84),
    now: f.options.now,
  });
}
function staff(f: Fixture) {
  return { siteId, actor: f.actor.actor };
}
async function create(f: Fixture, targetSite = siteId, name = "Additional observer") {
  return f.service.executeAdmin({
    siteId: targetSite,
    actor: f.actor.actor,
    operationId: "agents.configurations.create",
    targetId: null,
    command: {
      idempotencyKey: randomUUID(),
      ...npBuildAgentRuntimeDefinitionInputV1({ ...f.definition, name }),
    },
  });
}

describe.skipIf(skipIfNoTestDb())("Runtime Studio current staff projections", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("lists only the current site with stable bounded pages and rejects cursor filter/session reuse", async () => {
    const f = await runtimeFixture();
    await create(f);
    const foreign = await create(f, "draft-other", "Foreign observer");
    const service = studio(f);
    const page = await service.listConfigurations({ ...staff(f), query: { limit: 1 } });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));
    const next = await service.listConfigurations({
      ...staff(f),
      query: { limit: 1, cursor: page.nextCursor },
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect(next.nextCursor).toBeNull();
    expect([page.items[0].id, next.items[0].id]).not.toContain(foreign.resourceId);
    await expect(
      service.listConfigurations({
        ...staff(f),
        query: { limit: 1, status: "draft", cursor: page.nextCursor },
      }),
    ).rejects.toMatchObject({ code: "ACTIVITY_CURSOR_INVALID" });
    const [session] = await f.db
      .select()
      .from(npSessions)
      .where(eq(npSessions.id, f.actor.actor.sessionId));
    const secondSession = {
      ...session,
      id: randomUUID(),
      accessTokenHash: randomUUID(),
      refreshTokenHash: randomUUID(),
    };
    await f.db.insert(npSessions).values(secondSession);
    await expect(
      service.listConfigurations({
        ...staff(f),
        actor: { ...f.actor.actor, sessionId: secondSession.id },
        query: { limit: 1, cursor: page.nextCursor },
      }),
    ).rejects.toMatchObject({ code: "ACTIVITY_CURSOR_INVALID" });
    await expect(
      service.getConfiguration({ ...staff(f), id: foreign.resourceId }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE", statusCode: 404 });
    await expect(service.getConfiguration({ ...staff(f), id: randomUUID() })).rejects.toMatchObject(
      { code: "RUNTIME_RESOURCE_UNAVAILABLE", statusCode: 404 },
    );
    expect((await service.listConfigurations({ ...staff(f), query: { name: "%" } })).items).toEqual(
      [],
    );
    f.advance(901);
    await expect(
      service.listConfigurations({ ...staff(f), query: { limit: 1, cursor: page.nextCursor } }),
    ).rejects.toMatchObject({ code: "ACTIVITY_CURSOR_INVALID" });
  });

  it("projects verified policy versions with bounded simulation", async () => {
    const f = await runtimeFixture();
    const definition = {
      schemaVersion: "np.agent-policy-definition.v1",
      agentId: null,
      name: "Site rules",
      instructions: "Editorial guidance is not a scope grant.",
      rules: f.settings.defaultPolicyRules,
    };
    const created = await f.service.executeAdmin({
      ...staff(f),
      operationId: "agents.policies.create",
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1(definition),
      },
    });
    const foreign = await f.service.executeAdmin({
      ...staff(f),
      siteId: "draft-other",
      operationId: "agents.policies.create",
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1(definition),
      },
    });
    const service = studio(f);
    const detail = await service.getPolicy({ ...staff(f), id: created.resourceId });
    expect(detail.definition).toEqual(definition);
    expect(detail.availableActions).toContain("agents.policies.simulate");
    const page = await service.listPolicies({ ...staff(f), query: { status: "draft" } });
    expect(page.items.map((entry) => entry.id)).toEqual([created.resourceId]);
    await expect(service.getPolicy({ ...staff(f), id: foreign.resourceId })).rejects.toMatchObject({
      code: "RUNTIME_RESOURCE_UNAVAILABLE",
    });
    await f.service.executeAdmin({
      ...staff(f),
      operationId: "agents.policies.activate",
      targetId: created.resourceId,
      command: { expectedVersion: 1, configHash: detail.contentHash, idempotencyKey: randomUUID() },
    });
    const active = await service.getPolicy({ ...staff(f), id: created.resourceId });
    expect(active.status).toBe("active");
    expect(active.availableActions).not.toContain("agents.policies.update");
  });

  it("retains an archived draft as verified read-only history without breaking healthy list rows", async () => {
    const f = await runtimeFixture();
    const draft = await create(f, siteId, "Archived before activation");
    await f.service.executeAdmin({
      ...staff(f),
      operationId: "agents.configurations.archive",
      targetId: draft.resourceId,
      command: { expectedVersion: 1, reason: "No longer needed", idempotencyKey: randomUUID() },
    });
    const service = studio(f);
    const archived = await service.getConfiguration({ ...staff(f), id: draft.resourceId });
    expect(archived).toMatchObject({
      status: "archived",
      versionId: draft.output.versionId,
      versionStatus: "draft",
      activeVersion: null,
      draftVersionId: null,
      availableActions: [],
      manualRecipeIds: [],
    });
    expect(archived.definition.name).toBe("Archived before activation");
    const page = await service.listConfigurations(staff(f));
    expect(page.items.map((entry) => entry.id).sort()).toEqual(
      [f.created.resourceId, draft.resourceId].sort(),
    );
    const retained = await service.listConfigurations({
      ...staff(f),
      query: { status: "archived" },
    });
    expect(retained.items).toHaveLength(1);
    await expect(
      service.getConfiguration({ ...staff(f), siteId: "draft-other", id: draft.resourceId }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE" });
  });

  it("reauthorizes current staff membership and session for every retained read", async () => {
    const f = await runtimeFixture();
    const service = studio(f);
    const input = { ...staff(f), id: f.created.resourceId };
    expect((await service.getConfiguration(input)).id).toBe(f.created.resourceId);
    await f.db
      .delete(npSiteMemberships)
      .where(
        and(
          eq(npSiteMemberships.siteId, siteId),
          eq(npSiteMemberships.userId, f.actor.actor.user.id),
        ),
      );
    await expect(service.getConfiguration(input)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getBudget(staff(f))).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getCatalog(staff(f))).rejects.toMatchObject({ statusCode: 403 });
    await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
    await expect(service.getStatus({ ...staff(f), siteId: "draft-other" })).rejects.toMatchObject({
      code: "STAFF_AUTHORIZATION_REQUIRED",
    });
  });

  it("rejects principal divergence and malformed query fields rather than synthesizing healthy configuration", async () => {
    const f = await runtimeFixture();
    const service = studio(f);
    await expect(
      service.listConfigurations({ ...staff(f), query: { siteId: "draft-other" } }),
    ).rejects.toThrow();
    await expect(
      service.listConfigurations({ ...staff(f), query: { limit: 101 } }),
    ).rejects.toThrow();
    await expect(
      service.listConfigurations({ ...staff(f), query: { status: "running" } }),
    ).rejects.toThrow();
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "suspended" })
      .where(
        eq(
          npAgentPrincipals.id,
          (await service.getConfiguration({ ...staff(f), id: f.created.resourceId })).principalId,
        ),
      );
    await expect(
      service.getConfiguration({ ...staff(f), id: f.created.resourceId }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE" });
    await expect(service.listConfigurations(staff(f))).rejects.toMatchObject({
      code: "RUNTIME_RESOURCE_UNAVAILABLE",
    });
  });

  it("keeps effective readiness blocked and separates draft review from active resume review", async () => {
    const f = await runtimeFixture();
    const service = studio(f);
    const initial = await service.getEffective({ ...staff(f), id: f.created.resourceId });
    expect(initial).toMatchObject({
      ready: true,
      versionId: f.current.output.versionId,
      blockers: [],
    });
    const replacement = { ...f.definition, budget: { ...f.definition.budget, runsPerHour: 1 } };
    const draft = await f.service.executeAdmin({
      ...staff(f),
      operationId: "agents.configurations.update",
      targetId: f.created.resourceId,
      command: {
        expectedVersion: 2,
        configHash: f.current.output.configHash,
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1(replacement),
      },
    });
    expect((await service.getEffective({ ...staff(f), id: f.created.resourceId })).versionId).toBe(
      draft.output.versionId,
    );
    expect(
      (await service.getEffective({ ...staff(f), id: f.created.resourceId, version: "active" }))
        .versionId,
    ).toBe(f.current.output.versionId);
    f.state.ready = false;
    const blocked = await service.getEffective({ ...staff(f), id: f.created.resourceId });
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(0);
    expect(blocked.readiness.worker).toBe("blocked");
    expect((await service.getStatus(staff(f))).status.readiness.worker).toBe("blocked");
  });

  it("offers the existing recovery command for an errored active version", async () => {
    const f = await runtimeFixture();
    await f.service.executeAdmin({
      ...staff(f),
      operationId: "agents.configurations.pause",
      targetId: f.created.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 2,
        reason: "Review recovery behavior",
      },
    });
    await f.db
      .update(npAgents)
      .set({ status: "error" })
      .where(and(eq(npAgents.siteId, siteId), eq(npAgents.id, f.created.resourceId)));
    const detail = await studio(f).getConfiguration({ ...staff(f), id: f.created.resourceId });
    expect(detail.availableActions).toContain("agents.configurations.resume");
    expect(detail.availableActions).not.toContain("agents.configurations.run");
  });

  it("advertises Run only with installed admission and an enabled current manual trigger", async () => {
    const f = await runtimeFixture();
    const events = createAgentRuntimeEventServiceV1({
      admission: f.admission,
      deploymentAuthority: f.options.deploymentAuthority,
      now: f.options.now,
    });
    const runtime = createAgentRuntimeServiceV1({ ...f.options, admission: f.admission, events });
    const service = studio(f, runtime);
    expect(
      (await service.getConfiguration({ ...staff(f), id: f.created.resourceId })).availableActions,
    ).not.toContain("agents.configurations.run");
    const triggerId = randomUUID();
    await events.registerTrigger({
      siteId,
      agentId: f.created.resourceId,
      expectedVersionId: f.current.output.versionId as string,
      trigger: { type: "manual", id: triggerId },
      enabled: true,
    });
    const available = await service.getConfiguration({ ...staff(f), id: f.created.resourceId });
    expect(available.availableActions).toContain("agents.configurations.run");
    expect(available.manualRecipeIds).toEqual(["operator.worker-not-draining"]);
    expect(
      (await studio(f).getConfiguration({ ...staff(f), id: f.created.resourceId }))
        .availableActions,
    ).not.toContain("agents.configurations.run");
    await f.db
      .update(npAgentTriggers)
      .set({ enabled: false })
      .where(eq(npAgentTriggers.id, triggerId));
    expect(
      (await service.getConfiguration({ ...staff(f), id: f.created.resourceId })).availableActions,
    ).not.toContain("agents.configurations.run");
    const catalog = await service.getCatalog(staff(f));
    expect(catalog.scopes).toEqual(["site:read"]);
    expect(catalog.capabilities.map((entry) => entry.id)).toEqual(["site.inspect"]);
    expect(catalog.connections).toEqual([]);
    expect(catalog.recipes.map((entry) => entry.id)).toEqual(["operator.worker-not-draining"]);
  });

  it("does not offer manual inputs that the existing executor cannot consume", async () => {
    const recipes = runtimeRecipes();
    recipes.recipes[0].manualInputSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    };
    const f = await runtimeFixture(runtimeBudget(), true, { recipes });
    const events = createAgentRuntimeEventServiceV1({
      admission: f.admission,
      deploymentAuthority: f.options.deploymentAuthority,
      now: f.options.now,
    });
    await events.registerTrigger({
      siteId,
      agentId: f.created.resourceId,
      expectedVersionId: f.current.output.versionId as string,
      trigger: { type: "manual", id: randomUUID() },
      enabled: true,
    });
    const runtime = createAgentRuntimeServiceV1({ ...f.options, admission: f.admission, events });
    const detail = await studio(f, runtime).getConfiguration({
      ...staff(f),
      id: f.created.resourceId,
    });
    expect(detail.availableActions).not.toContain("agents.configurations.run");
    expect(detail.manualRecipeIds).toEqual([]);
  });

  it("keeps archived draft history discoverable under its actual connection filter", async () => {
    const f = await runtimeUsageFixture();
    try {
      const service = studio(f);
      const original = await service.getConfiguration({ ...staff(f), id: f.agentId });
      const runtime = createAgentRuntimeServiceV1(f.runtimeOptions);
      const draft = await runtime.executeAdmin({
        ...staff(f),
        operationId: "agents.configurations.create",
        targetId: null,
        command: {
          idempotencyKey: randomUUID(),
          ...npBuildAgentRuntimeDefinitionInputV1({
            ...original.definition,
            name: "Archived provider draft",
          }),
        },
      });
      await runtime.executeAdmin({
        ...staff(f),
        operationId: "agents.configurations.archive",
        targetId: draft.resourceId,
        command: {
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          reason: "Retain draft history",
        },
      });
      const filtered = await service.listConfigurations({
        ...staff(f),
        query: { status: "archived", connectionId: f.connectionId },
      });
      expect(filtered.items.map((entry) => entry.id)).toEqual([draft.resourceId]);
      expect(
        (
          await service.listConfigurations({
            ...staff(f),
            query: { status: "archived", connectionId: randomUUID() },
          })
        ).items,
      ).toEqual([]);
    } finally {
      await f.dispose();
    }
  });

  it("keeps real unresolved provider usage unknown in budgets and Activity without revealing private evidence", async () => {
    const f = await runtimeUsageFixture();
    try {
      const request = await f.request();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      await f.usage.beginDispatch({ siteId, runId: f.runId, request });
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, {
          schemaVersion: "np.agent-provider-invoke-outcome.v1",
          status: "ambiguous",
          provider: request.provider,
          model: request.model,
          providerRequestId: null,
          output: null,
          errorClass: "timeout",
          safeCode: "PROVIDER_TIMEOUT",
          retryable: false,
          dispatchState: "unknown",
          usage: null,
          finishReason: null,
          latencyMs: 30000,
        }),
      });
      const service = studio(f);
      const budget = await service.getBudget(staff(f));
      expect(budget).toMatchObject({ measurement: "unavailable", usage: null });
      const activity = createAgentActivityServiceV1({
        cursorHmacKey: new Uint8Array(32).fill(85),
        now: f.options.now,
      });
      const detail = await activity.getRun({ ...staff(f), id: f.runId });
      if (detail.schemaVersion !== "np.agent-activity-run.v1") throw new Error("Expected live Run");
      expect(detail.run.usage).toBeNull();
      expect(detail.run.goal).toBe("[redacted]");
      const serialized = JSON.stringify({ budget, detail });
      expect(serialized).not.toContain(request.instruction.text);
      expect(serialized).not.toContain(request.connection.secretVersionId);
      expect(serialized).not.toContain(request.classificationManifestDigest);
      await f.db
        .update(npAgentRuns)
        .set({ usage: { inputTokens: -1 } })
        .where(eq(npAgentRuns.id, f.runId));
      await expect(activity.getRun({ ...staff(f), id: f.runId })).rejects.toMatchObject({
        code: "ACTIVITY_NOT_FOUND",
      });
    } finally {
      await f.dispose();
    }
  });
});
