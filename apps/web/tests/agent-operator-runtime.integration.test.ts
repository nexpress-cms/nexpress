import { npRequireAgentOpsPlanOutputV1 } from "../../../packages/core/src/agent-contract/operator-capability-contract.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npCreateAgentOperatorAppHostV1 } from "../../../packages/app/src/lib/agents/operator-host";
import {
  getOptionalCacheInvalidationAdapter,
  type NpCacheInvalidationAdapter,
} from "@nexpress/core/cache";
import {
  setCacheInvalidationAdapter,
  resetCacheInvalidationAdapter,
} from "@nexpress/core/bootstrap";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import type {
  NpAgentJsonSchema,
  NpAgentProviderInvokeOutcomeV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import { operatorExecutionFixture } from "./agent-operator-execution-fixture.js";
import { npCreateAgentRuntimeOperatorControlsV1 } from "../../../packages/core/src/agent/runtime-operator-controls.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  npAgentActions,
  npAgentOperatorExecutions,
  npAgentRuns,
  npAgentTriggers,
  npAgentPrincipals,
} from "../../../packages/core/src/db/schema/agent.js";
import {
  runtimeFixture,
  runtimeDefinition,
  runtimeRecipes,
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

const cleanupAdapters: Array<() => void> = [];
async function failedRun(f: Awaited<ReturnType<typeof runtimeFixture>>, runId: string) {
  const store = createAgentRuntimeExecutionStoreV1({ admission: f.admission, now: f.options.now });
  const claim = await store.claim({ siteId, runId });
  if (!claim.claim) throw new Error("Expected actual Runtime claim");
  await store.transition({
    siteId,
    runId,
    claim: claim.claim,
    state: "failed",
    errorCode: "FIXTURE_FAILURE",
  });
  return store;
}
function retry(
  f: Awaited<ReturnType<typeof runtimeFixture>>,
  failedRunId: string,
  key = randomUUID(),
) {
  return f.db.transaction((db) =>
    f.admission.retry({ siteId, failedRunId, idempotencyKey: key, db: db as typeof f.db }),
  );
}
describe.skipIf(skipIfNoTestDb())("Operator Runtime operation owners", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  afterEach(() => {
    for (const cleanup of cleanupAdapters.splice(0)) cleanup();
  });

  it("re-admits retained intent exactly once and rejects revoked authority or changed evidence", async () => {
    const f = await runtimeFixture();
    const source = await f.admission.admit(f.runInput);
    await failedRun(f, source.runId);
    const key = randomUUID();
    const result = await retry(f, source.runId, key);
    expect(result.runId).not.toBe(source.runId);
    expect(await retry(f, source.runId, key)).toEqual({ runId: result.runId, replayed: true });
    const [original] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, source.runId));
    const [next] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, result.runId));
    expect(next).toMatchObject({
      state: "queued",
      agentId: original!.agentId,
      agentVersionId: original!.agentVersionId,
      recipeId: original!.recipeId,
      goal: original!.goal,
      manualInput: original!.manualInput,
    });
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(2);
    f.state.ready = false;
    await expect(retry(f, source.runId)).rejects.toThrow();
    f.state.ready = true;
    await f.db
      .update(npAgentRuns)
      .set({ goal: "tampered intent" })
      .where(eq(npAgentRuns.id, source.runId));
    await expect(retry(f, source.runId)).rejects.toMatchObject({
      code: "RUNTIME_ADMISSION_INVALID",
    });
    await f.db
      .update(npAgentRuns)
      .set({ goal: original!.goal })
      .where(eq(npAgentRuns.id, source.runId));
    await f.db
      .update(npAgentPrincipals)
      .set({ status: "suspended" })
      .where(eq(npAgentPrincipals.id, original!.principalId));
    await expect(retry(f, source.runId)).rejects.toThrow();
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(2);
  });

  it("retries an already-consumed schedule occurrence without advancing its trigger and rechecks budget", async () => {
    const recipes = runtimeRecipes();
    recipes.recipes[0]!.triggerKinds = ["schedule"];
    const f = await runtimeFixture(runtimeBudget({ runsPerHour: 1 }), true, { recipes });
    const events = createAgentRuntimeEventServiceV1({
      admission: f.admission,
      deploymentAuthority: f.options.deploymentAuthority,
      now: f.options.now,
      enqueueRun: () => Promise.resolve("fixture-queue"),
    });
    const trigger = {
      type: "schedule" as const,
      id: randomUUID(),
      cron: "* * * * *",
      catchUp: "once" as const,
    };
    await events.registerTrigger({
      siteId,
      agentId: f.runInput.agentId,
      expectedVersionId: f.runInput.expectedVersionId,
      trigger,
      enabled: true,
    });
    f.advance(120);
    const scheduled = await events.schedule({ siteId });
    const sourceId = scheduled.runIds[0]!;
    await failedRun(f, sourceId);
    const [before] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, trigger.id));
    await expect(retry(f, sourceId)).rejects.toThrow();
    // The original run consumes the current hourly window; retry is admitted only after it expires.
    f.advance(3601);
    const result = await retry(f, sourceId);
    const [source] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, sourceId));
    const [next] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, result.runId));
    const [after] = await f.db
      .select()
      .from(npAgentTriggers)
      .where(eq(npAgentTriggers.id, trigger.id));
    expect(next!.triggerId).toBe(trigger.id);
    expect(next!.eventRef).toEqual(source!.eventRef);
    expect(after!.nextRunAt).toEqual(before!.nextRunAt);
  });

  it("cooperatively cancels the current Run, fences a stale claim, and rejects terminal or foreign runs", async () => {
    const f = await runtimeFixture();
    const source = await f.admission.admit(f.runInput);
    const store = createAgentRuntimeExecutionStoreV1({
      admission: f.admission,
      now: f.options.now,
    });
    const claimed = await store.claim({ siteId, runId: source.runId });
    expect(claimed.claim).not.toBeNull();
    const cancel = (runId: string) =>
      f.db.transaction((db) =>
        store.cancelBeforeCommit({
          siteId,
          runId,
          db: db as typeof f.db,
          executionId: randomUUID(),
        }),
      );
    await expect(cancel(source.runId)).resolves.toEqual({ state: "cancelled" });
    await expect(
      store.withClaim({ siteId, runId: source.runId, claim: claimed.claim! }, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow();
    await expect(cancel(source.runId)).rejects.toThrow();
    await expect(cancel(randomUUID())).rejects.toThrow();
    const [current] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, source.runId));
    expect(current).toMatchObject({
      state: "cancelled",
      leaseUntil: null,
      runtimeRetryAt: null,
      errorCode: "RUNTIME_CANCELLED",
    });
  });
  it("links the approved retry in the same commit and replays without another Run", async () => {
    const runtime = await runtimeFixture();
    const source = await runtime.admission.admit(runtime.runInput);
    const store = await failedRun(runtime, source.runId);
    const owner = npCreateAgentRuntimeOperatorControlsV1({ admission: runtime.admission, store });
    const f = await operatorExecutionFixture(owner, runtime);
    const planned = await f.plan({
      action: "agent.run.retry",
      target: { kind: "run", runId: source.runId },
    });
    await f.decide(planned.approvalId);
    const result = await f.invoke(planned.request);
    expect(result.output).toMatchObject({ action: "agent.run.retry", state: "succeeded" });
    const [journal] = await f.db
      .select()
      .from(npAgentOperatorExecutions)
      .where(eq(npAgentOperatorExecutions.planId, planned.output.planId));
    expect(journal!.sourceRunId).toBe(source.runId);
    expect(journal!.resultRunId).not.toBeNull();
    const [retried] = await f.db
      .select()
      .from(npAgentRuns)
      .where(eq(npAgentRuns.id, journal!.resultRunId!));
    expect(retried!.state).toBe("queued");
    expect(retried!.idempotencyKey).toBe(`operator-retry-${journal!.id}`);
    expect(await f.invoke(planned.request)).toEqual(result);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(2);
  });

  it("executes human-approved cancellation through the real owner and preserves its final receipt", async () => {
    const runtime = await runtimeFixture();
    const source = await runtime.admission.admit(runtime.runInput);
    const store = createAgentRuntimeExecutionStoreV1({
      admission: runtime.admission,
      now: runtime.options.now,
    });
    const owner = npCreateAgentRuntimeOperatorControlsV1({ admission: runtime.admission, store });
    const f = await operatorExecutionFixture(owner, runtime);
    const planned = await f.plan({
      action: "agent.run.cancel",
      target: { kind: "run", runId: source.runId },
    });
    await f.decide(planned.approvalId);
    const result = await f.invoke(planned.request);
    expect(result.output).toMatchObject({
      action: "agent.run.cancel",
      state: "succeeded",
      verificationRefs: [`agent-run:${source.runId}`],
    });
    const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, source.runId));
    expect(run!.state).toBe("cancelled");
    expect(await f.invoke(planned.request)).toEqual(result);
    expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(1);
  });
  it("rejects cancellation after the existing ChangeSet owner commits an approved Runtime action", async () => {
    const f = await runtimeApprovalResumeFixture();
    await f.approve();
    const claimed = await f.store.claimApproval({ ...f.input, requestActionId: f.requestActionId });
    if (!claimed.claim) throw new Error("Expected approved Runtime claim");
    await f.service.resumeRuntimeApproval({
      ...f.input,
      claim: claimed.claim,
      requestActionId: f.requestActionId,
      sequence: 5,
    });
    expect((await f.run()).state).toBe("running");
    const receipt = await f.store.withClaim({ ...f.input, claim: claimed.claim }, (context) =>
      f.service.inspectRuntimeApproval(context, f.requestActionId),
    );
    expect(receipt.status).toBe("completed");
    await expect(
      f.db.transaction((db) =>
        f.store.cancelBeforeCommit({ ...f.input, db, executionId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_COMMIT_BOUNDARY_PASSED" });
    expect((await f.run()).state).toBe("running");
    await f.dispose();
  });
  it("waits for human approval and resumes the real Runtime executor exactly once", async () => {
    const responseSchema: NpAgentJsonSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", const: "interactive-capability", maxLength: 64 },
        decision: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", const: "complete", maxLength: 64 },
                summary: { type: "string", maxLength: 128 },
              },
              required: ["kind", "summary"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", const: "propose-capability", maxLength: 64 },
                capabilityId: { type: "string", const: "ops.plan", maxLength: 128 },
                rationale: { type: "string", maxLength: 128 },
                arguments: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    action: { type: "string", const: "cache.revalidate", maxLength: 128 },
                    target: {
                      type: "object",
                      additionalProperties: false,
                      properties: { kind: { type: "string", const: "site", maxLength: 128 } },
                      required: ["kind"],
                    },
                  },
                  required: ["action", "target"],
                },
              },
              required: ["arguments", "capabilityId", "kind", "rationale"],
            },
          ],
        },
      },
      required: ["decision", "task"],
    };

    const complete: NpAgentProviderInvokeOutcomeV1 = {
      schemaVersion: "np.agent-provider-invoke-outcome.v1",
      status: "succeeded",
      provider: "fake-provider",
      model: "fake-model",
      providerRequestId: null,
      output: { task: "interactive-capability", decision: { kind: "complete", summary: "Done" } },
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
    const proposal: NpAgentProviderInvokeOutcomeV1 = {
      ...complete,
      output: {
        task: "interactive-capability",
        decision: {
          kind: "propose-capability",
          capabilityId: "ops.plan",
          rationale: "Revalidate the approved site cache.",
          arguments: { action: "cache.revalidate", target: { kind: "site" } },
        },
      },
    };
    const invoke = vi.fn().mockResolvedValueOnce(proposal).mockResolvedValue(complete);
    const definition = runtimeDefinition();
    definition.autonomy = "approved";
    definition.scopes = ["ops:execute", "ops:plan", "site:read"];
    definition.capabilityModes = [
      { capabilityId: "ops.execute", mode: "approved" },
      { capabilityId: "ops.plan", mode: "approved" },
    ];
    const runtime = await runtimeUsageFixture({
      delegated: true,
      definition,
      dataClassCeiling: "internal-redacted",
      providerInference: { invoke },
      responseSchema,
    });
    const previousAdapter = getOptionalCacheInvalidationAdapter();
    const invalidate = vi.fn<NpCacheInvalidationAdapter["invalidate"]>((request) => ({
      status: "applied",
      paths: { requested: request.paths.length, succeeded: request.paths.length, failed: 0 },
      tags: { requested: request.tags.length, succeeded: request.tags.length, failed: 0 },
      cdn: { status: "not-configured", adapterKind: null },
    }));
    const cacheAdapter: NpCacheInvalidationAdapter = {
      kind: "operator-runtime-fixture",
      invalidate,
    };
    setCacheInvalidationAdapter(cacheAdapter);
    cleanupAdapters.push(() => {
      if (previousAdapter) setCacheInvalidationAdapter(previousAdapter);
      else resetCacheInvalidationAdapter(cacheAdapter);
    });
    const host = npCreateAgentOperatorAppHostV1({
      authorize: (request) =>
        request.siteId === siteId ? Promise.resolve() : Promise.reject(new Error("Wrong site")),
      authorizeApproval: (request) =>
        request.siteId === siteId ? Promise.resolve() : Promise.reject(new Error("Wrong site")),
      cacheTargets: (request) =>
        Promise.resolve({
          source: "site",
          siteId: request.siteId,
          tags: [`np:site:${request.siteId}`],
        }),
    });
    const f = await operatorExecutionFixture(host, runtime, runtime.admission, runtime.options.now);
    const capabilities = f.admission;
    const store = createAgentRuntimeExecutionStoreV1({
      admission: runtime.admission,
      now: runtime.options.now,
      approval: capabilities,
    });
    const context = createAgentRuntimeContextV1({
      admission: runtime.admission,
      capabilities: {
        list: capabilities.sourceEntries,
        actionOutcomes: capabilities.runtimeActionOutcomes,
      },
    });
    const usage = createAgentRuntimeUsageV1({
      admission: runtime.admission,
      ambiguityWindowSeconds: 300,
      verifyRequest: context.verifyRequest,
      now: runtime.options.now,
    });
    const provider = createAgentProviderInferenceRuntimeV1({
      registry: runtime.providerRegistry,
      now: runtime.options.now,
    });
    const breakers = createAgentRuntimeBreakersV1({
      failureThreshold: 3,
      windowSeconds: 60,
      cooldownSeconds: 30,
      now: runtime.options.now,
    });
    const executor = createAgentRuntimeExecutorV1({
      store,
      context,
      usage,
      provider,
      providerRegistry: runtime.providerRegistry,
      vault: runtime.vault,
      capabilities,
      breakers,
      now: runtime.options.now,
    });
    try {
      const input = { siteId, runId: runtime.runId };
      expect(await executor.process(input)).toEqual({ state: "waiting_approval" });
      expect(invalidate).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(1);
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.runId, runtime.runId));
      expect(action!.state).toBe("approval_pending");
      const planOutput = npRequireAgentOpsPlanOutputV1(action!.outputRedacted);
      if (planOutput.execution.kind !== "agent-executable")
        throw new Error("Expected retained approval");
      expect(action!.approvalId).toBeNull();
      await f.decide(planOutput.execution.approvalId);
      const resume = { ...input, requestActionId: action!.id };
      expect(await executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(await executor.resumeApproval(resume)).toEqual({ state: "succeeded" });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(await f.db.select().from(npAgentOperatorExecutions)).toHaveLength(1);
      // A later approval revocation closes its waiting Run through the same audited execution owner.
      invoke.mockResolvedValueOnce(proposal);
      const waiting = await runtime.admission.admit({
        ...runtime.runInput,
        idempotencyKey: randomUUID(),
      });
      const waitingInput = { siteId, runId: waiting.runId };
      expect(await executor.process(waitingInput)).toEqual({ state: "waiting_approval" });
      const [pending] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.runId, waiting.runId));
      const pendingPlan = npRequireAgentOpsPlanOutputV1(pending!.outputRedacted);
      if (pendingPlan.execution.kind !== "agent-executable")
        throw new Error("Expected revocable approval");
      await f.decide(pendingPlan.execution.approvalId);
      await f.decide(pendingPlan.execution.approvalId, "revoke");
      const [closed] = await f.db
        .select()
        .from(npAgentRuns)
        .where(eq(npAgentRuns.id, waiting.runId));
      expect(closed).toMatchObject({
        state: "failed",
        errorCode: "APPROVAL_REVOKED",
        leaseUntil: null,
        runtimeRetryAt: null,
      });
      await expect(
        executor.resumeApproval({ ...waitingInput, requestActionId: pending!.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(invalidate).toHaveBeenCalledTimes(1);
      const audit = await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, waiting.runId));
      expect(
        audit.some(
          (event) =>
            event.action === "agent.runtime.execution" &&
            event.payload?.fromState === "waiting_approval" &&
            event.payload?.state === "failed",
        ),
      ).toBe(true);
    } finally {
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await runtime.dispose();
    }
  });
});
