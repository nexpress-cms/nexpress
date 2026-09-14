import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { npBuildAgentRuntimeDefinitionInputV1 } from "../../../packages/core/src/agent/runtime-service.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  ensureMigrated,
  registerTestCollections,
  truncateAll,
  closeTestDb,
  skipIfNoTestDb,
} from "./harness.js";
import {
  runtimeFixture,
  runtimeRecipes,
  runtimeBudget,
  runtimeDefinition,
  siteId,
} from "./agent-runtime-service-fixture.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  npAgentRuns,
  npAgentEvents,
  npAgentTriggers,
} from "../../../packages/core/src/db/schema/agent.js";
import type { NpAgentEventCanonicalV1 } from "../../../packages/core/src/agent-contract/types.js";
async function setup(budget = runtimeBudget()) {
  const recipes = runtimeRecipes();
  recipes.recipes[0]!.triggerKinds = ["event", "manual", "schedule"];
  const f = await runtimeFixture(budget, true, { recipes });
  const events = createAgentRuntimeEventServiceV1({
    admission: f.admission,
    deploymentAuthority: f.options.deploymentAuthority,
    now: f.options.now,
    enqueueRun: async () => {
      throw new Error("unavailable");
    },
  });
  const trigger = {
    type: "event" as const,
    id: randomUUID(),
    eventKind: "ops.check.changed" as const,
    filter: { op: "eq" as const, field: "source.kind" as const, value: "ops" },
    coalesceSeconds: 60,
  };
  await events.registerTrigger({
    siteId,
    agentId: f.runInput.agentId,
    expectedVersionId: f.runInput.expectedVersionId,
    trigger,
    enabled: true,
  });
  function event(key = randomUUID()): NpAgentEventCanonicalV1 {
    return {
      version: "np.agent-event.v1",
      siteId,
      kind: "ops.check.changed",
      occurredAt: f.options.now().toISOString(),
      source: { kind: "ops", component: "doctor" },
      subject: null,
      actor: null,
      causation: null,
      correlationId: null,
      deduplicationKey: key,
      privacy: "internal",
      payload: {
        kind: "ops.check.changed",
        checkId: "jobs.worker",
        previousStatus: "pass",
        currentStatus: "fail",
      },
    };
  }
  return { ...f, events, trigger, event };
}
describe.skipIf(skipIfNoTestDb())("Runtime durable event dispatch", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(truncateAll);
  afterAll(closeTestDb);
  it("deduplicates exact events and rejects conflicting payloads and foreign sites", async () => {
    const f = await setup();
    const event = f.event();
    const first = await f.events.record({ siteId, event });
    expect(await f.events.record({ siteId, event })).toEqual({ ...first, replayed: true });
    await expect(
      f.events.record({
        siteId,
        event: {
          ...event,
          payload: {
            kind: "ops.check.changed",
            checkId: "jobs.worker",
            previousStatus: "pass",
            currentStatus: "warn",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(f.events.record({ siteId: "foreign", event })).rejects.toMatchObject({
      code: "RUNTIME_EVENT_INVALID",
    });
  });
  it("atomically freezes trigger/event and coalesces replay despite failed queue delivery", async () => {
    const f = await setup();
    const first = await f.events.record({ siteId, event: f.event() });
    const result = await f.events.dispatch({ siteId, eventId: first.eventId });
    expect(result.enqueued).toBe(0);
    expect(result.runIds).toHaveLength(1);
    const second = await f.events.record({ siteId, event: f.event() });
    expect((await f.events.dispatch({ siteId, eventId: second.eventId })).runIds).toEqual(
      result.runIds,
    );
    const [run] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, result.runIds[0]!));
    expect(run?.triggerId).toBe(f.trigger.id);
    expect(run?.eventRef?.eventId).toBe(first.eventId);
    expect((await f.events.dispatch({ siteId, eventId: first.eventId })).replayed).toBe(true);
  });
  it("leaves dispatch pending when live admission pauses", async () => {
    const f = await setup();
    const recorded = await f.events.record({ siteId, event: f.event() });
    f.state.ready = false;
    await expect(f.events.dispatch({ siteId, eventId: recorded.eventId })).rejects.toBeDefined();
    const [event] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, recorded.eventId));
    expect(event?.dispatchedAt).toBeNull();
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
  it("rejects made-up causal lineage before recording evidence", async () => {
    const f = await setup();
    await expect(
      f.events.record({
        siteId,
        event: {
          ...f.event(),
          causation: {
            rootRunId: randomUUID(),
            sourceRunId: randomUUID(),
            sourceActionId: randomUUID(),
            depth: 0,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_EVENT_LINEAGE_INVALID" });
  });
  it("uses atomic schedule Run outbox and advances missed once occurrences without duplication", async () => {
    const f = await setup();
    const trigger = {
      type: "schedule" as const,
      id: randomUUID(),
      cron: "* * * * *",
      catchUp: "once" as const,
    };
    await f.events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger,
      enabled: true,
    });
    f.advance(180);
    const result = await f.events.schedule({ siteId });
    expect(result.runIds).toHaveLength(1);
    expect((await f.events.schedule({ siteId })).runIds).toEqual([]);
    const [row] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, trigger.id));
    expect(row?.nextRunAt!.getTime()).toBeGreaterThan(f.options.now().getTime());
    const [run] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, result.runIds[0]!));
    expect(run?.eventRef?.scheduledFor).toBeTypeOf("string");
  });
  it("serializes concurrent records and dispatches into one durable Run", async () => {
    const f = await setup();
    const event = f.event();
    const records = await Promise.all([
      f.events.record({ siteId, event }),
      f.events.record({ siteId, event }),
    ]);
    expect(records[0]!.eventId).toBe(records[1]!.eventId);
    const dispatches = await Promise.all(
      records.map((row) => f.events.dispatch({ siteId, eventId: row.eventId })),
    );
    expect(new Set(dispatches.flatMap((row) => row.runIds)).size).toBe(1);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(1);
  });
  it("rejects direct source mismatch before creating a Run", async () => {
    const f = await setup();
    const record = await f.events.record({ siteId, event: f.event() });
    await expect(
      f.admission.admit({
        ...f.runInput,
        source: { triggerId: randomUUID(), eventId: record.eventId },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_TRIGGER_UNAVAILABLE" });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
  it("fails closed on tampered event evidence without marking dispatch complete", async () => {
    const f = await setup();
    const record = await f.events.record({ siteId, event: f.event() });
    await f.db
      .update(npAgentEvents)
      .set({ eventHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentEvents.id, record.eventId));
    await expect(f.events.dispatch({ siteId, eventId: record.eventId })).rejects.toMatchObject({
      code: "RUNTIME_EVENT_INVALID",
    });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
  it("executes the current minute after a two-minute schedule revisit", async () => {
    const f = await setup();
    await f.events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger: { type: "schedule", id: randomUUID(), cron: "* * * * *", catchUp: "skip" },
      enabled: true,
    });
    f.advance(120);
    expect((await f.events.schedule({ siteId })).runIds).toHaveLength(1);
    expect((await f.events.schedule({ siteId })).runIds).toHaveLength(0);
  });
  it("does not extend event retention on replay and rejects expired dispatch", async () => {
    const f = await setup();
    const record = await f.events.record({
      siteId,
      event: f.event(),
      expiresAt: new Date(f.options.now().getTime() + 1000),
    });
    f.advance(2);
    await expect(f.events.dispatch({ siteId, eventId: record.eventId })).rejects.toMatchObject({
      code: "RUNTIME_EVENT_INVALID",
    });
  });
  it("advances healthy schedules past a poisoned row without consuming the failed occurrence", async () => {
    const f = await setup();
    const broken = randomUUID(),
      healthy = randomUUID();
    for (const [id, cron] of [
      [broken, "* * * * *"],
      [healthy, "*/1 * * * *"],
    ] as const)
      await f.events.registerTrigger({
        siteId,
        agentId: f.runInput.agentId,
        expectedVersionId: f.runInput.expectedVersionId,
        trigger: { type: "schedule", id, cron, catchUp: "once" },
        enabled: true,
      });
    await f.db
      .update(npAgentTriggers)
      .set({ filterHash: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentTriggers.id, broken));
    f.advance(180);
    const result = await f.events.schedule({ siteId });
    expect(result.failed).toBe(1);
    expect(result.runIds).toHaveLength(1);
    const [row] = await f.db.select().from(npAgentTriggers).where(eq(npAgentTriggers.id, broken));
    expect(row!.nextRunAt!.getTime()).toBeLessThan(f.options.now().getTime());
  });
  it("retains the first Agent Run while a sibling waits for the concurrency budget", async () => {
    const f = await setup(runtimeBudget({ maxConcurrentRuns: 1 }));
    const created = await f.service.executeAdmin({
      siteId,
      actor: f.actor.actor,
      operationId: "agents.configurations.create",
      targetId: null,
      command: {
        idempotencyKey: randomUUID(),
        ...npBuildAgentRuntimeDefinitionInputV1(f.definition),
      },
    });
    const active = await f.service.executeAdmin({
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
    await f.events.registerTrigger({
      siteId,
      agentId: created.resourceId,
      expectedVersionId: active.output.versionId as string,
      trigger: { ...f.trigger, id: randomUUID() },
      enabled: true,
    });
    const event = await f.events.record({ siteId, event: f.event() });
    await expect(f.events.dispatch({ siteId, eventId: event.eventId })).rejects.toMatchObject({
      code: "RUNTIME_EVENT_PENDING",
    });
    const first = await f.db.select().from(npAgentRuns);
    expect(first).toHaveLength(1);
    const store = createAgentRuntimeExecutionStoreV1({
      admission: f.admission,
      now: f.options.now,
    });
    const input = { siteId, runId: first[0]!.id };
    const acquired = await store.claim(input);
    expect(acquired.claim).not.toBeNull();
    await store.transition({ ...input, claim: acquired.claim!, state: "failed" });
    await f.events.dispatch({ siteId, eventId: event.eventId });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(2);
    const [row] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, event.eventId));
    expect(row!.dispatchedAt).not.toBeNull();
  });
  it("skips old sparse cron occurrences when the current minute does not match", async () => {
    const f = await setup();
    const triggerId = randomUUID();
    await f.events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger: { type: "schedule", id: triggerId, cron: "0 0 1 1 *", catchUp: "skip" },
      enabled: true,
    });
    await f.db
      .update(npAgentTriggers)
      .set({ nextRunAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(npAgentTriggers.id, triggerId));
    expect((await f.events.schedule({ siteId })).runIds).toHaveLength(0);
  });
  it("rejects unknown outer keys and accessor inputs before database admission", async () => {
    const f = await setup();
    const input = { siteId, event: f.event(), authority: "forbidden" };
    await expect(f.events.record(input)).rejects.toBeDefined();
    let invoked = false;
    const dispatch = Object.defineProperty({ siteId, eventId: randomUUID() }, "eventId", {
      enumerable: true,
      get() {
        invoked = true;
        return randomUUID();
      },
    });
    await expect(f.events.dispatch(dispatch)).rejects.toBeDefined();
    expect(invoked).toBe(false);
    await expect(f.events.schedule({ siteId, cursor: "invalid" })).rejects.toBeDefined();
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
  });
  it("retains one schedule occurrence across two recipes and a concurrent Run limit of one", async () => {
    const definition = runtimeDefinition();
    const branch = {
      recipeId: "guardian.agent-abuse" as const,
      recipeVersion: 1 as const,
      windowSeconds: 60,
      deniedScopeThreshold: 1,
      repeatedProposalThreshold: 1,
      costVelocityMicros: 100,
      actionThreshold: 1,
    };
    definition.settings.push(branch);
    definition.settings.sort((a, b) => a.recipeId.localeCompare(b.recipeId));
    const recipes = runtimeRecipes();
    recipes.recipes[0]!.triggerKinds = ["event", "manual", "schedule"];
    const second = structuredClone(recipes.recipes[0]!);
    second.id = "guardian.agent-abuse";
    second.settingsSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        recipeId: { type: "string", const: "guardian.agent-abuse", maxLength: 128 },
        recipeVersion: { type: "integer", const: 1, minimum: 1, maximum: 1 },
        ...Object.fromEntries(
          [
            "windowSeconds",
            "deniedScopeThreshold",
            "repeatedProposalThreshold",
            "costVelocityMicros",
            "actionThreshold",
          ].map((key) => [key, { type: "integer", minimum: 0, maximum: 100000 }]),
        ),
      },
      required: Object.keys(branch).sort(),
    };
    recipes.recipes.push(second);
    recipes.recipes.sort((a, b) => a.id.localeCompare(b.id));
    const f = await runtimeFixture(runtimeBudget({ maxConcurrentRuns: 1 }), true, {
      definition,
      recipes,
    });
    const events = createAgentRuntimeEventServiceV1({
      admission: f.admission,
      deploymentAuthority: f.options.deploymentAuthority,
      now: f.options.now,
    });
    const triggerId = randomUUID();
    await events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger: { type: "schedule", id: triggerId, cron: "* * * * *", catchUp: "skip" },
      enabled: true,
    });
    f.advance(120);
    const first = await events.schedule({ siteId });
    expect(first.failed).toBe(1);
    expect(first.runIds).toHaveLength(1);
    const [before] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, triggerId));
    const store = createAgentRuntimeExecutionStoreV1({
      admission: f.admission,
      now: f.options.now,
    });
    const input = { siteId, runId: first.runIds[0]! };
    const acquired = await store.claim(input);
    await store.transition({ ...input, claim: acquired.claim!, state: "failed" });
    f.advance(120);
    const secondTick = await events.schedule({ siteId });
    expect(secondTick.failed).toBe(0);
    const runs = await f.db.select().from(npAgentRuns);
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((run) => run.eventRef?.scheduledFor))).toEqual(
      new Set([before!.nextRunAt!.toISOString()]),
    );
    const [after] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, triggerId));
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(f.options.now().getTime());
  });
  it("rejects extraneous event ids on manual and schedule sources even when no event exists", async () => {
    const f = await setup();
    const manual = randomUUID(),
      schedule = randomUUID();
    await f.events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger: { type: "manual", id: manual },
      enabled: true,
    });
    await f.events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger: { type: "schedule", id: schedule, cron: "* * * * *", catchUp: "once" },
      enabled: true,
    });
    f.advance(120);
    const [row] = await f.db.select().from(npAgentTriggers).where(eq(npAgentTriggers.id, schedule));
    for (const source of [
      { triggerId: manual, eventId: randomUUID() },
      { triggerId: schedule, eventId: randomUUID(), scheduledFor: row!.nextRunAt!.toISOString() },
      { triggerId: manual, scheduledFor: "" },
    ])
      await expect(
        f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID(), source }),
      ).rejects.toMatchObject({ code: "RUNTIME_TRIGGER_UNAVAILABLE" });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
});
