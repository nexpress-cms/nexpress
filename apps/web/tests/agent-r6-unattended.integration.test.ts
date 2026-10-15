import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npCreateAgentOperatorAppHostV1 } from "../../../packages/app/src/lib/agents/operator-host.js";
import { npAgentOperatorRecipeSetupV1 } from "../../../packages/core/src/agent-contract/operator-recipe-contract.js";
import {
  npCreateAgentR6UnattendedRecipeRegistryV1,
  npCreateAgentR6UnattendedRecipeRegistryV2,
} from "../../../packages/core/src/agent-contract/r6-recipe-registry.js";
import {
  npAgentDisabledGatewaySettingsV1,
  type NpAgentJsonObject,
  type NpAgentProviderInvokeOutcomeV1,
  type NpAgentRecipeId,
} from "../../../packages/core/src/agent-contract/types.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import type { NpAgentModeratorCombinedContentCollectorV1 } from "../../../packages/core/src/agent/moderator-combined-collector.js";
import {
  createAgentOperatorCapabilityFacadeV1,
  type NpAgentOperatorCapabilityFacadeV1,
} from "../../../packages/core/src/agent/operator-capability.js";
import { createAgentOperatorServiceV1 } from "../../../packages/core/src/agent/operator-service.js";
import type { NpAgentProviderInferenceFacetV1 } from "../../../packages/core/src/agent/provider-auth-contract.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import { updateComment } from "../../../packages/core/src/community/comments.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentChangesets,
  npAgentContainments,
  npAgentEvents,
  npAgentOperatorExecutions,
  npAgentPrincipals,
  npAgentProviderCalls,
  npAgentRuns,
  npAgentSignals,
  npAgentTriggers,
  npAgentVersions,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments } from "../../../packages/core/src/db/schema/community.js";
import { postsTable } from "../../../packages/core/src/integration/fixtures.js";
import { setJobsPauseState } from "../../../packages/core/src/jobs/pause-state.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { moderatorRecipeFixture } from "./agent-moderator-recipe-fixture.js";
import { publisherRuntimeFixture } from "./agent-publisher-recipe-runtime-fixture.js";
import { runtimeDefinition, runtimeFingerprint, siteId } from "./agent-runtime-service-fixture.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type RuntimeFixture = Pick<
  Awaited<ReturnType<typeof runtimeUsageFixture>>,
  "admission" | "runtimeOptions" | "options" | "runInput" | "advance" | "agentId"
>;
type Events = ReturnType<typeof createAgentRuntimeEventServiceV1>;
const active: Array<{ dispose(): Promise<void> }> = [];

async function recipe(id: NpAgentRecipeId, profile: 1 | 2 = 1) {
  const registry = await (profile === 2
    ? npCreateAgentR6UnattendedRecipeRegistryV2()
    : npCreateAgentR6UnattendedRecipeRegistryV1());
  const selected = registry.recipes.find((entry) => entry.id === id);
  if (!selected) throw new Error("Expected the installed R6 recipe");
  return { recipe: selected, recipeRegistry: registry };
}

function advance(f: RuntimeFixture, seconds: number) {
  f.advance(seconds);
  vi.setSystemTime(f.options.now());
}

function eventService(
  f: RuntimeFixture,
  moderatorCollector?: NpAgentModeratorCombinedContentCollectorV1,
) {
  const enqueue = vi.fn(() => Promise.resolve(randomUUID()));
  const events = createAgentRuntimeEventServiceV1({
    admission: f.admission,
    deploymentAuthority: f.runtimeOptions.deploymentAuthority,
    now: f.options.now,
    enqueueRun: enqueue,
    ...(moderatorCollector ? { moderatorCollector } : {}),
  });
  return { events, enqueue };
}

async function registerSchedule(f: RuntimeFixture, events: Events) {
  const trigger = {
    type: "schedule" as const,
    id: randomUUID(),
    cron: "* * * * *",
    catchUp: "once" as const,
  };
  await events.registerTrigger({
    siteId,
    agentId: f.agentId,
    expectedVersionId: f.runInput.expectedVersionId,
    trigger,
    enabled: true,
  });
  return trigger;
}

async function scheduledRun(f: RuntimeFixture, events: Events) {
  advance(f, 60);
  const result = await events.schedule({ siteId });
  expect(result.failed).toBe(0);
  expect(result.runIds).toHaveLength(1);
  return result.runIds[0];
}

function outcome(decision: NpAgentJsonObject): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: "fake-provider",
    model: "fake-model",
    providerRequestId: null,
    output: { task: "interactive-capability", decision },
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      tokenSource: "provider",
      costMicros: 3,
      costSource: "adapter-estimate",
    },
    finishReason: "stop",
    latencyMs: 0,
  };
}

async function operatorFixture() {
  const { recipe: selected, recipeRegistry } = await recipe("operator.worker-not-draining");
  const definition = {
    ...runtimeDefinition(),
    scopes: structuredClone(npAgentOperatorRecipeSetupV1.scopes),
    autonomy: npAgentOperatorRecipeSetupV1.autonomy,
    capabilityModes: structuredClone(npAgentOperatorRecipeSetupV1.capabilityModes),
    settings: [structuredClone(npAgentOperatorRecipeSetupV1.settings)],
  };
  const invoke = vi
    .fn<NpAgentProviderInferenceFacetV1["invoke"]>()
    .mockResolvedValueOnce(
      outcome({
        kind: "propose-capability",
        capabilityId: "ops.status",
        rationale: "Observe the explicit pause owner.",
        arguments: { families: ["jobs"] },
      }),
    )
    .mockImplementationOnce((request) => {
      expect(
        request.trustedContext.some((entry) => entry.text.includes("Deployment snapshot: paused")),
      ).toBe(true);
      expect(request.tools.map((entry) => entry.capabilityId)).not.toContain("ops.execute");
      return Promise.resolve(
        outcome({
          kind: "propose-capability",
          capabilityId: "ops.plan",
          rationale: "Prepare a local operator review handoff.",
          arguments: {
            action: "queue.global.plan",
            target: { kind: "queue", operation: "drain", jobName: null },
          },
        }),
      );
    })
    .mockResolvedValue(
      outcome({
        kind: "complete",
        summary: "Paused evidence and the local review plan are retained.",
      }),
    );
  const f = await runtimeUsageFixture({
    delegated: true,
    definition,
    recipe: selected,
    recipeRegistry,
    responseSchema: selected.responseSchema,
    dataClassCeiling: "internal-redacted",
    providerInference: { invoke },
    limits: { maxProviderCalls: 4, maxCapabilityCalls: 3 },
  });
  const plan = vi.fn(() =>
    Promise.resolve({
      artifact: { schemaVersion: "fixture.operator-review.v1", check: "bounded-owner-plan" },
      contractId: "fixture.queue.review.v1",
      projectCommand: "Review deployment queue runbook with the host operator",
      checks: [{ id: "owner", status: "pass" as const }],
    }),
  );
  const host = npCreateAgentOperatorAppHostV1({
    authorize: () => Promise.resolve(),
    authorizeDeployment: () => Promise.resolve(true),
    workerDiagnostics: "pg-boss",
    planOwners: { "queue.global.plan": plan },
  });
  const registry = await createAgentReadCapabilityRegistryV1(
    createAgentCoreReadCapabilityExecutorsV1({
      cursorHmacKey: { id: "r6-unattended", key: new Uint8Array(32).fill(73) },
      resolveBlockSchemas: () => [],
      resolveUser: () => f.actor.actor.user,
      opsStatus: (input, request) => host.status(input, request),
    }),
  );
  let facade: NpAgentOperatorCapabilityFacadeV1 | null = null;
  const capabilities = createAgentCapabilityAdmissionServiceV1({
    registry,
    runtimeAdmission: f.admission,
    resolveOperatorCapabilities: () => facade,
    resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
    now: f.options.now,
  });
  const service = createAgentOperatorServiceV1({
    admission: capabilities,
    runtimeAdmission: f.admission,
    resolveTransportAudience: () => Promise.resolve("https://unused.example"),
    host,
    now: f.options.now,
  });
  facade = createAgentOperatorCapabilityFacadeV1(service);
  const store = createAgentRuntimeExecutionStoreV1({
    admission: f.admission,
    approval: capabilities,
    now: f.options.now,
  });
  const context = createAgentRuntimeContextV1({
    admission: f.admission,
    capabilities: {
      list: (request) => capabilities.sourceEntries(request),
      actionOutcomes: (request) => capabilities.runtimeActionOutcomes(request),
    },
  });
  const usage = createAgentRuntimeUsageV1({
    admission: f.admission,
    ambiguityWindowSeconds: 300,
    verifyRequest: (run, request, transaction) => context.verifyRequest(run, request, transaction),
    now: f.options.now,
  });
  const provider = createAgentProviderInferenceRuntimeV1({
    registry: f.providerRegistry,
    now: f.options.now,
  });
  const breakers = createAgentRuntimeBreakersV1({
    failureThreshold: 3,
    windowSeconds: 60,
    cooldownSeconds: 30,
    now: f.options.now,
  });
  const executor = createAgentRuntimeExecutorV1({
    store,
    context,
    usage,
    provider,
    providerRegistry: f.providerRegistry,
    vault: f.vault,
    capabilities,
    breakers,
    now: f.options.now,
  });
  return {
    ...f,
    store,
    executor,
    invoke,
    plan,
    async dispose() {
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await f.dispose();
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Explicit R6 unattended recipe journeys", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(async () => {
    for (const f of active.splice(0)) await f.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it.each([1, 2] as const)(
    "schedules Publisher profile %i into an exact draft and ready preview, preserving public content and same-base cooldown",
    async (profile) => {
      const f = await publisherRuntimeFixture(await recipe("publisher.stale-content", profile));
      active.push(f);
      await f.store.cancel({ siteId, runId: f.runId });
      const id = await f.document();
      const before = await f.db.select().from(postsTable).where(eq(postsTable.id, id));
      const { events, enqueue } = eventService(f);
      const trigger = await registerSchedule(f, events);
      const runId = await scheduledRun(f, events);
      expect(enqueue).toHaveBeenCalledWith({ siteId, runId });
      expect(f.invoke).not.toHaveBeenCalled();
      expect(await f.executor.process({ siteId, runId })).toEqual({ state: "succeeded" });
      expect(await f.previews()).toEqual([expect.objectContaining({ state: "ready" })]);
      expect(await f.db.select().from(postsTable).where(eq(postsTable.id, id))).toEqual(before);
      expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);
      const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, runId));
      if (!run.agentVersionId) throw new Error("Expected the admitted Runtime version");
      const [version] = await f.db
        .select()
        .from(npAgentVersions)
        .where(eq(npAgentVersions.id, run.agentVersionId));
      expect(version.recipeRegistryBody.recipes).toHaveLength(3);
      expect(version.recipeRegistryBody).toEqual(f.runtimeOptions.recipes);
      expect(run.instructionTemplateVersion).toBe(profile);
      expect(f.invoke.mock.calls[0][0].instruction.templateVersion).toBe(profile);
      expect(f.invoke.mock.calls[0][0].instruction.digest).toBe(run.instructionDigest);
      expect(run.triggerId).toBe(trigger.id);
      expect(run.eventRef?.scheduledFor).toBeTypeOf("string");
      expect((await events.schedule({ siteId })).runIds).toEqual([]);
      expect(await f.executor.process({ siteId, runId })).toEqual({ state: "succeeded" });
      expect(f.invoke).toHaveBeenCalledTimes(5);
      f.resetProviderStep();
      const next = await scheduledRun(f, events);
      expect(await f.executor.process({ siteId, runId: next })).toEqual({ state: "failed" });
      expect(f.invoke).toHaveBeenCalledTimes(6);
      const [duplicateCall] = await f.db
        .select()
        .from(npAgentProviderCalls)
        .where(eq(npAgentProviderCalls.runId, next));
      expect(duplicateCall.state).toBe("succeeded");
      expect(duplicateCall.decision).toMatchObject({
        task: "interactive-capability",
        decision: { kind: "propose-capability", capabilityId: "changeset.create" },
      });
      expect(
        (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, next)))[0].errorCode,
      ).toBe("PUBLISHER_PROPOSAL_DUPLICATE");
      expect(await f.db.select().from(npAgentChangesets)).toHaveLength(1);
      expect(await f.db.select().from(postsTable).where(eq(postsTable.id, id))).toEqual(before);
    },
    60_000,
  );

  it("collects a closed Moderator schedule before proposing one exact fresh human-approved quarantine", async () => {
    const f = await moderatorRecipeFixture({
      ...(await recipe("moderator.repeated-link-spam")),
      deferInitialCollection: true,
    });
    active.push(f);
    await f.store.cancel({ siteId, runId: f.runId });
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    const collect = vi.spyOn(f.runtimeCollector, "collect");
    const { events, enqueue } = eventService(f, f.runtimeCollector);
    const trigger = await registerSchedule(f, events);
    advance(f, 60);
    const [due] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, trigger.id));
    const runCount = (await f.db.select().from(npAgentRuns)).length;
    collect.mockRejectedValueOnce(new Error("fixture closed-window source unavailable"));
    const unavailable = await events.schedule({ siteId });
    expect(unavailable).toMatchObject({ failed: 1, runIds: [] });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(runCount);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    expect(f.providerInvoke).not.toHaveBeenCalled();
    expect(
      (await f.db.select().from(npAgentTriggers).where(eq(npAgentTriggers.id, trigger.id)))[0]
        .nextRunAt,
    ).toEqual(due.nextRunAt);
    // Cross a complete source bucket before retrying this unchanged occurrence.
    // Selecting by retry time would collect another bucket and miss its evidence.
    advance(f, 600);
    const retried = await events.schedule({ siteId });
    expect(retried).toMatchObject({ failed: 0 });
    expect(retried.runIds).toHaveLength(1);
    const runId = retried.runIds[0];
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, runId)))[0].eventRef
        ?.scheduledFor,
    ).toBe(due.nextRunAt!.toISOString());
    expect(collect).toHaveBeenLastCalledWith(
      expect.objectContaining({ siteId, windowStartedAt: f.windowStartedAt }),
    );
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    expect(f.providerInvoke).not.toHaveBeenCalled();
    const current = await f.read(runId);
    const proposal = current.candidates[0].proposal;
    f.propose(proposal);
    expect(enqueue).toHaveBeenCalledWith({ siteId, runId });
    expect(await f.executor.process({ siteId, runId })).toEqual({ state: "waiting_approval" });
    expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    const pending = await f.pending(runId);
    await f.decide(pending.output.approvalId);
    const resumed = { siteId, runId, requestActionId: pending.action.id };
    expect(await f.executor.resumeApproval(resumed)).toEqual({ state: "succeeded" });
    expect(await f.executor.resumeApproval(resumed)).toEqual({ state: "succeeded" });
    expect(f.providerInvoke).toHaveBeenCalledTimes(2);
    expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
    expect(
      (await f.db.select().from(npComments).where(eq(npComments.id, proposal.target.id)))[0].status,
    ).toBe("hidden");
    expect((await events.schedule({ siteId })).runIds).toEqual([]);
  }, 60_000);

  it("retains failed collection for actual content Events and coalesces repeated same-target edits without duplicate work", async () => {
    const f = await moderatorRecipeFixture({
      ...(await recipe("moderator.repeated-link-spam")),
      deferInitialCollection: true,
    });
    active.push(f);
    await f.store.cancel({ siteId, runId: f.runId });
    const collect = vi
      .spyOn(f.runtimeCollector, "collect")
      .mockRejectedValueOnce(new Error("fixture source unavailable"));
    const { events } = eventService(f, f.runtimeCollector);
    const register = async (
      eventKind: "community.content.created" | "community.content.moderated",
    ) =>
      events.registerTrigger({
        siteId,
        agentId: f.agentId,
        expectedVersionId: f.runInput.expectedVersionId,
        enabled: true,
        trigger: {
          type: "event",
          id: randomUUID(),
          eventKind,
          filter: { op: "eq", field: "source.kind", value: "community" },
          coalesceSeconds: 600,
        },
      });
    await register("community.content.created");
    const [source] = await f.db
      .select()
      .from(npAgentEvents)
      .where(
        and(
          eq(npAgentEvents.kind, "community.content.created"),
          eq(npAgentEvents.sourceComponent, "community.comments"),
        ),
      );
    const beforeRuns = await f.db.select().from(npAgentRuns);
    await expect(events.dispatch({ siteId, eventId: source.id })).rejects.toBeDefined();
    expect(
      (await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.id, source.id)))[0]
        .dispatchedAt,
    ).toBeNull();
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(beforeRuns.length);
    expect(await f.db.select().from(npAgentProviderCalls)).toEqual([]);
    const retried = await events.dispatch({ siteId, eventId: source.id });
    expect(retried.runIds).toHaveLength(1);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(await f.executor.process({ siteId, runId: retried.runIds[0] })).toEqual({
      state: "succeeded",
    });
    expect((await events.dispatch({ siteId, eventId: source.id })).replayed).toBe(true);
    expect(f.providerInvoke).toHaveBeenCalledTimes(1);
    await register("community.content.moderated");
    const target = f.comments[0];
    for (let i = 0; i < 2; i++) {
      advance(f, 1);
      await withCurrentSite(siteId, () =>
        updateComment({
          commentId: target.id,
          memberId: target.memberId,
          bodyMd: `Updated observation ${i}: https://offer.example/changed-${i}`,
        }),
      );
    }
    const edits = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.kind, "community.content.moderated"));
    expect(edits).toHaveLength(2);
    advance(f, 600);
    const first = await events.dispatch({ siteId, eventId: edits[0].id });
    const collectedCalls = collect.mock.calls.length;
    // A new same-target Event may reuse an admitted exact Run. Fresh source
    // failure must not replace its retained evidence or block that replay.
    collect.mockRejectedValueOnce(new Error("fixture later collection unavailable"));
    const second = await events.dispatch({ siteId, eventId: edits[1].id });
    expect(first.runIds).toHaveLength(1);
    expect(second.runIds).toEqual(first.runIds);
    expect(collect).toHaveBeenCalledTimes(collectedCalls);
    expect(await f.executor.process({ siteId, runId: first.runIds[0] })).toEqual({
      state: "succeeded",
    });
    expect(await f.executor.process({ siteId, runId: first.runIds[0] })).toEqual({
      state: "succeeded",
    });
    expect(f.providerInvoke).toHaveBeenCalledTimes(2);
    expect(await f.db.select().from(npAgentContainments)).toEqual([]);
    expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
  }, 60_000);

  it("schedules Operator diagnostics and a local review plan, then leaves a budget-blocked occurrence retryable", async () => {
    const f = await operatorFixture();
    active.push(f);
    await f.store.cancel({ siteId, runId: f.runId });
    await setJobsPauseState({ paused: true });
    const { events } = eventService(f);
    const trigger = await registerSchedule(f, events);
    const runId = await scheduledRun(f, events);
    expect(await f.executor.process({ siteId, runId })).toEqual({ state: "succeeded" });
    expect(f.plan).toHaveBeenCalledTimes(1);
    expect(await f.db.select().from(npAgentOperatorExecutions)).toEqual([]);
    expect(
      (await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, runId)))
        .map((row) => row.capabilityId)
        .sort(),
    ).toEqual(["ops.plan", "ops.status"]);
    const calls = f.invoke.mock.calls.length;
    advance(f, 60);
    const [before] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, trigger.id));
    await npWithAgentRuntimeControlTransactionV1(siteId, ({ db, revision, settings }) => {
      settings.budgetCeiling.runsPerHour = 0;
      return f.controls.updateInTransaction({
        db,
        siteId,
        expectedRevision: revision,
        actorFingerprint: runtimeFingerprint,
        settings,
      });
    });
    const runCount = (await f.db.select().from(npAgentRuns)).length;
    const blocked = await events.schedule({ siteId });
    expect(blocked.runIds).toEqual([]);
    expect(blocked.failed).toBe(1);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(runCount);
    expect(f.invoke).toHaveBeenCalledTimes(calls);
    expect(
      (await f.db.select().from(npAgentTriggers).where(eq(npAgentTriggers.id, trigger.id)))[0]
        .nextRunAt,
    ).toEqual(before.nextRunAt);
  }, 60_000);

  it("refuses changed scheduled Publisher evidence and revoked delegated authority before an effect or further provider dispatch", async () => {
    const f = await publisherRuntimeFixture(await recipe("publisher.stale-content"));
    active.push(f);
    await f.store.cancel({ siteId, runId: f.runId });
    const id = await f.document();
    const { events } = eventService(f);
    await registerSchedule(f, events);
    f.setBeforeProposal(() =>
      withCurrentSite(siteId, async () => {
        await saveDocument(
          "posts",
          id,
          { title: "Human changed the current base" },
          f.actor.actor.user,
          { status: "published" },
        );
      }),
    );
    const changed = await scheduledRun(f, events);
    expect(await f.executor.process({ siteId, runId: changed })).toEqual({ state: "failed" });
    expect(await f.db.select().from(npAgentChangesets)).toEqual([]);
    expect(await f.previews()).toEqual([]);
    const calls = f.invoke.mock.calls.length;
    const revoked = await scheduledRun(f, events);
    const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, revoked));
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "suspended" })
      .where(eq(npAgentPrincipals.id, run.principalId));
    expect(await f.executor.process({ siteId, runId: revoked })).toEqual({ state: "failed" });
    expect(f.invoke).toHaveBeenCalledTimes(calls);
    expect(await f.db.select().from(npAgentChangesets)).toEqual([]);
    expect(await f.previews()).toEqual([]);
  }, 60_000);
});
