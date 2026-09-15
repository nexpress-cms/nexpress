import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  createAgentRuntimeServiceV1,
  npBuildAgentRuntimeDefinitionInputV1,
} from "../../../packages/core/src/agent/runtime-service.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentRuntimeControlsV1,
  npWithAgentRuntimeControlTransactionV1,
} from "../../../packages/core/src/agent/runtime-controls.js";
import {
  npAgents,
  npAgentTriggers,
  npAgentRuns,
  npAgentInvocations,
} from "../../../packages/core/src/db/schema/agent.js";
import { runtimeFixture, runtimeBudget, siteId } from "./agent-runtime-service-fixture.js";
import {
  ensureMigrated,
  truncateAll,
  registerTestCollections,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";

async function fixture() {
  const f = await runtimeFixture(runtimeBudget(), false);
  const events = createAgentRuntimeEventServiceV1({
    admission: f.admission,
    deploymentAuthority: f.options.deploymentAuthority,
    now: f.options.now,
  });
  const service = createAgentRuntimeServiceV1({ ...f.options, admission: f.admission, events });
  const review = await service.reviewEffective({
    siteId,
    actor: f.actor.actor,
    agentId: f.created.resourceId,
  });
  const triggerId = randomUUID();
  const command = {
    idempotencyKey: randomUUID(),
    expectedVersion: 1,
    configHash: f.created.output.configHash,
    reviewedPolicyRefs: review.policyRefs,
    triggers: [{ definition: { type: "manual" as const, id: triggerId }, enabled: true }],
  };
  return { ...f, service, events, review, triggerId, command };
}

describe.skipIf(skipIfNoTestDb())("Runtime Studio mutations reuse audited lifecycle", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("activates reviewed triggers atomically and admits one frozen manual goal with audited replay", async () => {
    const f = await fixture();
    const input = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.activate" as const,
      targetId: f.created.resourceId,
      command: f.command,
    };
    await f.service.executeAdmin(input);
    await f.service.executeAdmin(input);
    expect(await f.db.select().from(npAgentTriggers)).toHaveLength(1);
    const manual = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.run" as const,
      targetId: f.created.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 2,
        configHash: f.created.output.configHash,
        triggerId: f.triggerId,
        inputJson: JSON.stringify({
          recipeId: "operator.worker-not-draining",
          goal: "Inspect current worker health",
        }),
      },
    };
    const result = await f.service.executeAdmin(manual);
    const replay = await f.service.executeAdmin(manual);
    expect(replay.resourceId).toBe(result.resourceId);
    const [run] = await f.db.select().from(npAgentRuns);
    expect(run).toMatchObject({
      id: result.resourceId,
      goal: "Inspect current worker health",
      triggerId: f.triggerId,
      state: "queued",
    });
    const invocations = await f.db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, siteId),
          eq(npAgentInvocations.operationId, "agents.configurations.run"),
        ),
      );
    expect(invocations).toHaveLength(1);
    expect(run.idempotencyKey).toBe(invocations[0].id);
    await expect(
      f.service.executeAdmin({
        ...manual,
        command: {
          ...manual.command,
          inputJson: JSON.stringify({ recipeId: "operator.worker-not-draining", goal: "Changed" }),
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });
  it("rolls back activation and trigger writes for unsupported or duplicate trigger plans", async () => {
    const f = await fixture();
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.configurations.activate",
        targetId: f.created.resourceId,
        command: {
          ...f.command,
          triggers: [
            ...f.command.triggers,
            {
              definition: {
                type: "schedule",
                id: randomUUID(),
                cron: "* * * * *",
                catchUp: "skip",
              },
              enabled: true,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_RECIPE_UNAVAILABLE" });
    expect((await f.db.select().from(npAgents))[0].status).toBe("draft");
    expect(await f.db.select().from(npAgentTriggers)).toHaveLength(0);
  });
  it("rejects stale reviewed policy evidence and foreign configuration reads", async () => {
    const f = await fixture();
    const stale = structuredClone(f.command);
    stale.reviewedPolicyRefs[0].version++;
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.configurations.activate",
        targetId: f.created.resourceId,
        command: stale,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_POLICY_CHANGED" });
    await expect(
      f.service.reviewEffective({ siteId, actor: f.actor.actor, agentId: randomUUID() }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE" });
    expect((await f.db.select().from(npAgents))[0].status).toBe("draft");
  });
  it("rejects extra manual prompt authority, absent installation, and disabled triggers", async () => {
    const f = await fixture();
    await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.activate",
      targetId: f.created.resourceId,
      command: f.command,
    });
    const manual = {
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.run" as const,
      targetId: f.created.resourceId,
      command: {
        idempotencyKey: randomUUID(),
        expectedVersion: 2,
        configHash: f.created.output.configHash,
        triggerId: f.triggerId,
        inputJson: JSON.stringify({
          recipeId: "operator.worker-not-draining",
          goal: "Inspect",
          prompt: "override",
        }),
      },
    };
    await expect(f.service.executeAdmin(manual)).rejects.toThrow();
    await expect(
      createAgentRuntimeServiceV1(f.options).executeAdmin({
        ...manual,
        command: {
          ...manual.command,
          inputJson: JSON.stringify({ recipeId: "operator.worker-not-draining", goal: "Inspect" }),
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_OPERATION_UNAVAILABLE" });
    await f.db
      .update(npAgentTriggers)
      .set({ enabled: false })
      .where(eq(npAgentTriggers.id, f.triggerId));
    await expect(
      f.service.executeAdmin({
        ...manual,
        command: {
          ...manual.command,
          inputJson: JSON.stringify({ recipeId: "operator.worker-not-draining", goal: "Inspect" }),
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_TRIGGER_UNAVAILABLE" });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
  it("resumes the immutable active version even when a newer replacement draft exists", async () => {
    const f = await fixture();
    await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.activate",
      targetId: f.created.resourceId,
      command: f.command,
    });
    await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.pause",
      targetId: f.created.resourceId,
      command: { expectedVersion: 2, reason: "Review replacement", idempotencyKey: randomUUID() },
    });
    const replacement = structuredClone(f.definition);
    replacement.name = "Replacement draft";
    replacement.budget.runsPerHour = 1;
    const draft = await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.update",
      targetId: f.created.resourceId,
      command: {
        expectedVersion: 3,
        configHash: f.created.output.configHash,
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1(replacement),
      },
    });
    await expect(
      f.service.executeAdmin({
        siteId,
        actor: f.actor.actor,
        operationId: "agents.configurations.resume",
        targetId: f.created.resourceId,
        command: {
          expectedVersion: 4,
          configHash: draft.output.configHash,
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_VERSION_CONFLICT" });
    const resumed = await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.resume",
      targetId: f.created.resourceId,
      command: {
        expectedVersion: 4,
        configHash: f.created.output.configHash,
        idempotencyKey: randomUUID(),
      },
    });
    expect(resumed.output.versionId).toBe(f.created.output.versionId);
    expect((await f.db.select().from(npAgents))[0]).toMatchObject({
      status: "active",
      draftVersionId: draft.output.versionId,
      activeVersionId: f.created.output.versionId,
    });
    const inventory = f.service.getDefinitionInventory();
    expect(inventory).toMatchObject({
      manualAdmissionAvailable: true,
      triggerRegistrationAvailable: true,
    });
    inventory.scopes.length = 0;
    expect(f.service.getDefinitionInventory().scopes).toEqual(["site:read"]);
  });
  it("reads staff-authorized status seam without inventing local deployment authority", async () => {
    const f = await fixture();
    const controls = createAgentRuntimeControlsV1({});
    expect(() => controls.status({ siteId })).toThrow("RUNTIME_AUTHORITY_REQUIRED");
    const result = await npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
      controls.statusInTransaction({ db, siteId }),
    );
    expect(result).toMatchObject({ enabled: true });
  });
});
