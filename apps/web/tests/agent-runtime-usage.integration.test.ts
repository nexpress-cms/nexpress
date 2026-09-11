import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentProviderCalls,
  npAgentUsageReservations,
  npAgentUsageDaily,
  npAgentRuns,
  npAgentConnectionSecretVersions,
  npAgentConnectionConfigVersions,
  npAgentConnections,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentRuntimeAdmissionV1 } from "../../../packages/core/src/agent/runtime-admission.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentActivityServiceV1 } from "../../../packages/core/src/agent/activity-service.js";
import {
  npMeasureAgentRuntimeBudgetV1,
  npRequireAgentRuntimeUsageKnownV1,
} from "../../../packages/core/src/agent/runtime-budget.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import type {
  NpAgentProviderInvokeOutcomeV1,
  NpAgentProviderRequestCanonicalV1,
  NpAgentProviderTaskOutputV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { runtimeBudget, siteId } from "./agent-runtime-service-fixture.js";
import { runtimeUsageFixture, usageInstruction } from "./agent-runtime-usage-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof runtimeUsageFixture>>;
const fixtures: Fixture[] = [];
async function fixture(options: Parameters<typeof runtimeUsageFixture>[0] = {}) {
  const f = await runtimeUsageFixture(options);
  fixtures.push(f);
  return f;
}
const decision: NpAgentProviderTaskOutputV1 = {
  task: "interactive-capability",
  decision: { kind: "complete", summary: "The worker is observable." },
};
function success(request: NpAgentProviderRequestCanonicalV1): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: request.provider,
    model: request.model,
    providerRequestId: "fixture-request",
    output: decision,
    usage: {
      inputTokens: 6,
      cachedInputTokens: 2,
      outputTokens: 3,
      tokenSource: "provider",
      costMicros: 11,
      costSource: "adapter-estimate",
    },
    finishReason: "stop",
    latencyMs: 10,
  };
}
function ambiguous(request: NpAgentProviderRequestCanonicalV1): NpAgentProviderInvokeOutcomeV1 {
  return {
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
    latencyMs: 30_000,
  };
}
function unsent(request: NpAgentProviderRequestCanonicalV1): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "failed",
    provider: request.provider,
    model: request.model,
    providerRequestId: null,
    output: null,
    errorClass: "invalid-request",
    safeCode: "INVALID_REQUEST",
    retryable: false,
    dispatchState: "not-dispatched",
    usage: null,
    finishReason: null,
    latencyMs: 0,
  };
}
async function measure(f: Fixture) {
  return npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
    npMeasureAgentRuntimeBudgetV1({ db, siteId, now: f.options.now() }),
  );
}

describe.skipIf(skipIfNoTestDb())("Runtime provider usage ledger", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of fixtures.splice(0)) await f.dispose();
  });
  afterAll(closeTestDb);

  it.each(["absent", "reject", "throw"] as const)(
    "fails closed when the source/classification verifier is %s",
    async (verifier) => {
      const f = await fixture({ verifier });
      await expect(
        f.usage.reserve({ siteId, runId: f.runId, request: await f.request() }),
      ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE" });
      expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(0);
      expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(0);
    },
  );

  it("reserves one immutable turn, replays without charge and stores only classified facts", async () => {
    const f = await fixture();
    const request = await f.request();
    const activity = createAgentActivityServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(61),
      now: f.options.now,
    });
    expect(
      (await activity.getRun({ siteId, actor: f.actor.actor, id: f.runId })).run.usage.costMicros,
    ).toBe(0);
    const first = await f.usage.reserve({ siteId, runId: f.runId, request });
    expect(await f.usage.reserve({ siteId, runId: f.runId, request })).toEqual({
      ...first,
      replayed: true,
    });
    const [reservation] = await f.db.select().from(npAgentUsageReservations);
    const call = await f.call();
    expect(reservation).toMatchObject({
      state: "reserved",
      reservedCalls: 1,
      reservedInputTokens: 10,
      reservedOutputTokens: 10,
      reservedCostMicros: 31,
    });
    expect(call).toMatchObject({
      state: "reserved",
      dispatchState: "not-dispatched",
      requestRedacted: null,
      responseRedacted: null,
    });
    expect(JSON.stringify(call)).not.toContain(usageInstruction);
    expect(JSON.stringify(call)).not.toContain("fake-api-key");
    expect(
      (await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)))[0]!.usage,
    ).toEqual({});
    await expect(
      activity.getRun({ siteId, actor: f.actor.actor, id: f.runId }),
    ).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND", status: 404 });
    expect(
      (await activity.listRuns({ siteId, actor: f.actor.actor, query: { origin: "runtime" } }))
        .items,
    ).toEqual([]);
    expect(await measure(f)).toMatchObject({
      concurrentProviderCalls: 1,
      providerCallsRollingHour: 1,
      inputTokensUtcDay: 10,
      outputTokensUtcDay: 10,
      costMicrosUtcDay: 31,
    });
    await expect(
      f.usage.reserve({
        siteId,
        runId: f.runId,
        request: { ...request, limits: { ...request.limits, maxInputTokens: 9 } },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_IDEMPOTENCY_CONFLICT" });
  });

  it.each([
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.connection.secretVersionId = randomUUID();
    },
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.connection.configSnapshotId = randomUUID();
    },
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.connection.credentialVersion++;
    },
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.instruction.text = "Different instructions";
    },
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.recipe.version++;
    },
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.pricing.version++;
    },
    (r: NpAgentProviderRequestCanonicalV1) => {
      r.limits.timeoutSeconds = 121;
    },
  ])("rejects a changed frozen request binding before reservation", async (mutate) => {
    const f = await fixture();
    const request = await f.request();
    mutate(request);
    await expect(f.usage.reserve({ siteId, runId: f.runId, request })).rejects.toMatchObject({
      code: "RUNTIME_PROVIDER_INPUT_INVALID",
    });
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(0);
  });

  it("serializes concurrent calls under the site budget lock", async () => {
    const f = await fixture({ budget: runtimeBudget({ maxConcurrentProviderCalls: 1 }) });
    const a = await f.request(),
      b = await f.request();
    const results = await Promise.allSettled(
      [a, b].map((request) => f.usage.reserve({ siteId, runId: f.runId, request })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(1);
  });

  it("checks the Agent ceiling independently from the broader site ceiling", async () => {
    const f = await fixture({ agentBudget: runtimeBudget({ maxConcurrentProviderCalls: 1 }) });
    await f.usage.reserve({ siteId, runId: f.runId, request: await f.request() });
    await expect(
      f.usage.reserve({ siteId, runId: f.runId, request: await f.request({ sequence: 2 }) }),
    ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_BLOCKED" });
  });

  it("rechecks reduced host limits before dispatching already reserved work", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    const current = createAgentRuntimeAdmissionV1({
      ...f.runtimeOptions,
      runLimits: { ...f.limits, maxInputTokens: 1 },
    });
    const usage = createAgentRuntimeUsageV1({
      admission: current,
      ambiguityWindowSeconds: 60,
      verifyRequest: () => true,
      now: f.options.now,
    });
    await expect(usage.beginDispatch({ siteId, runId: f.runId, request })).rejects.toMatchObject({
      code: "RUNTIME_BUDGET_BLOCKED",
    });
    expect((await f.call()).dispatchState).toBe("not-dispatched");
  });

  it("refreshes paused controls and current credential metadata before dispatch", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.db
      .update(npAgentConnectionSecretVersions)
      .set({ status: "retiring", retiredAt: f.options.now() })
      .where(eq(npAgentConnectionSecretVersions.id, request.connection.secretVersionId));
    await expect(f.usage.beginDispatch({ siteId, runId: f.runId, request })).rejects.toMatchObject({
      code: "RUNTIME_PROVIDER_UNAVAILABLE",
    });
    await f.controls.pause({ siteId, reason: "Contain provider work" });
    await expect(f.usage.reserve({ siteId, runId: f.runId, request })).rejects.toBeInstanceOf(
      Error,
    );
    expect((await f.call()).dispatchState).toBe("not-dispatched");
  });

  it("commits unknown dispatch once and reconciles exact reported/estimated buckets atomically", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    expect(await f.usage.beginDispatch({ siteId, runId: f.runId, request })).toMatchObject({
      state: "in_flight",
    });
    await expect(f.usage.beginDispatch({ siteId, runId: f.runId, request })).rejects.toMatchObject({
      code: "RUNTIME_DISPATCH_UNAVAILABLE",
    });
    f.advance(1);
    const response = await f.response(request, success(request), decision);
    const settled = await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response,
    });
    expect(settled).toMatchObject({ state: "succeeded", reservationState: "reconciled" });
    expect(
      await f.usage.reconcile({ siteId, providerCallId: request.providerCallId, response }),
    ).toEqual({ ...settled, replayed: true });
    const [daily] = await f.db.select().from(npAgentUsageDaily);
    expect(daily).toMatchObject({
      providerCalls: 1,
      reportedInputTokens: 6,
      reportedCachedInputTokens: 2,
      reportedOutputTokens: 3,
      estimatedInputTokens: 0,
      reportedCostMicros: 0,
      estimatedCostMicros: 11,
      budgetChargeCostMicros: 11,
      unknownCalls: 0,
    });
    expect(await measure(f)).toMatchObject({
      concurrentProviderCalls: 0,
      inputTokensUtcDay: 6,
      outputTokensUtcDay: 3,
      costMicrosUtcDay: 11,
    });
  });

  it("rejects a mismatched adapter cost without releasing any reservation", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.usage.beginDispatch({ siteId, runId: f.runId, request });
    const output = success(request);
    if (output.status !== "succeeded") throw new Error();
    output.usage.costMicros = 0;
    await expect(
      f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, output, decision),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_OUTPUT_INVALID" });
    expect((await f.db.select().from(npAgentUsageReservations))[0]!.state).toBe("reserved");
    expect(await f.db.select().from(npAgentUsageDaily)).toHaveLength(0);
  });

  it("rehashes retained pricing/config evidence even when only reconciliation remains", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.usage.beginDispatch({ siteId, runId: f.runId, request });
    await f.db
      .update(npAgentConnectionConfigVersions)
      .set({ config: { changed: true } })
      .where(eq(npAgentConnectionConfigVersions.id, request.connection.configSnapshotId));
    await expect(
      f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, success(request), decision),
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_USAGE_INVALID" });
    expect((await f.db.select().from(npAgentUsageReservations))[0]!.state).toBe("reserved");
    expect(await f.db.select().from(npAgentUsageDaily)).toHaveLength(0);
  });

  it("rejects extra authority fields and accessor envelopes before ledger work", async () => {
    const f = await fixture();
    const request = await f.request();
    const extra = { siteId, runId: f.runId, request, principalId: randomUUID() };
    await expect(f.usage.reserve(extra)).rejects.toMatchObject({
      code: "RUNTIME_ARGUMENT_INVALID",
    });
    await expect(f.usage.beginDispatch(extra)).rejects.toMatchObject({
      code: "RUNTIME_ARGUMENT_INVALID",
    });
    const response = await f.response(request, unsent(request));
    await expect(
      f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response,
        principalId: randomUUID(),
      } as Parameters<typeof f.usage.reconcile>[0]),
    ).rejects.toMatchObject({ code: "RUNTIME_ARGUMENT_INVALID" });
    expect(() =>
      f.usage.expire({ siteId, principalId: randomUUID() } as Parameters<typeof f.usage.expire>[0]),
    ).toThrowError(expect.objectContaining({ code: "RUNTIME_ARGUMENT_INVALID" }));
    let read = false;
    const accessor = Object.defineProperty({ siteId, runId: f.runId }, "request", {
      enumerable: true,
      get() {
        read = true;
        return request;
      },
    });
    await expect(f.usage.reserve(accessor as typeof extra)).rejects.toMatchObject({
      code: "RUNTIME_ARGUMENT_INVALID",
    });
    expect(read).toBe(false);
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(0);
  });

  it("isolates and freezes verifier inputs so a callback cannot corrupt hashed request or budget evidence", async () => {
    const f = await fixture();
    const request = await f.request();
    const unavailable = createAgentRuntimeUsageV1({
      admission: f.admission,
      ambiguityWindowSeconds: 60,
      now: f.options.now,
      verifyRequest: (_context, value) => {
        value.limits.maxOutputTokens = 0;
        return true;
      },
    });
    await expect(unavailable.reserve({ siteId, runId: f.runId, request })).rejects.toMatchObject({
      code: "RUNTIME_PROVIDER_INPUT_UNAVAILABLE",
    });
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(0);
    const protectedUsage = createAgentRuntimeUsageV1({
      admission: f.admission,
      ambiguityWindowSeconds: 60,
      now: f.options.now,
      verifyRequest: (context, value) => {
        expect("db" in context).toBe(false);
        expect(Object.isFrozen(value.limits)).toBe(true);
        expect(Object.isFrozen(context.siteBudget)).toBe(true);
        try {
          value.limits.maxOutputTokens = 0;
        } catch {
          /* A hostile host cannot change evidence. */
        }
        try {
          context.siteBudget.costMicrosPerDay = Number.MAX_SAFE_INTEGER;
        } catch {
          /* Frozen private copy. */
        }
        context.now.setTime(context.now.getTime() + 86_400_000);
        return true;
      },
    });
    await protectedUsage.reserve({ siteId, runId: f.runId, request });
    const [reservation] = await f.db.select().from(npAgentUsageReservations);
    expect(reservation).toMatchObject({
      reservedOutputTokens: 10,
      reservedCostMicros: 31,
      reservedAt: f.options.now(),
    });
  });

  it("releases a proven unsent failure without inventing provider usage", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, unsent(request)),
    });
    expect((await f.db.select().from(npAgentUsageReservations))[0]).toMatchObject({
      state: "released",
      actualInputTokens: null,
      actualCostMicros: null,
      budgetChargeCostMicros: 0,
    });
    expect(await f.db.select().from(npAgentUsageDaily)).toHaveLength(0);
    expect(await measure(f)).toMatchObject({ concurrentProviderCalls: 0, costMicrosUtcDay: 0 });
  });

  it("expires unknown work conservatively, blocks new provider work and settles late usage without reviving success", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.usage.beginDispatch({ siteId, runId: f.runId, request });
    f.advance(1);
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, ambiguous(request)),
    });
    const before = await f.call();
    expect(await f.usage.expire({ siteId })).toEqual({ examined: 0, released: 0, expired: 0 });
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
        npRequireAgentRuntimeUsageKnownV1({ db, siteId }),
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_USAGE_UNKNOWN" });
    f.advance(60);
    expect(await f.usage.expire({ siteId })).toEqual({ examined: 1, released: 0, expired: 1 });
    expect((await f.db.select().from(npAgentUsageDaily))[0]).toMatchObject({
      providerCalls: 1,
      unknownCalls: 1,
      reportedCostMicros: 0,
      estimatedCostMicros: 0,
      budgetChargeCostMicros: 31,
    });
    expect(await measure(f)).toMatchObject({
      inputTokensUtcDay: 10,
      outputTokensUtcDay: 10,
      costMicrosUtcDay: 31,
    });
    await f.controls.pause({ siteId, reason: "Contain unresolved spend" });
    const response = await f.response(request, success(request), decision);
    expect(
      await f.usage.reconcile({ siteId, providerCallId: request.providerCallId, response }),
    ).toMatchObject({ state: "ambiguous", reservationState: "reconciled" });
    expect(
      await f.usage.reconcile({ siteId, providerCallId: request.providerCallId, response }),
    ).toMatchObject({ replayed: true });
    expect(await f.call()).toMatchObject({
      state: "ambiguous",
      decision: null,
      responseDigest: before.responseDigest,
    });
    expect((await f.db.select().from(npAgentUsageDaily))[0]).toMatchObject({
      providerCalls: 1,
      unknownCalls: 0,
      estimatedCostMicros: 11,
      budgetChargeCostMicros: 11,
    });
    expect(await measure(f)).toMatchObject({
      inputTokensUtcDay: 6,
      outputTokensUtcDay: 3,
      costMicrosUtcDay: 11,
    });
    const audit = await f.db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.targetId, request.providerCallId),
          sql`${npAuditEvents.payload}->>'transition'='late-reconciled'`,
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("releases never-dispatched expired work after pause without fabricating a dispatch", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.controls.pause({ siteId, reason: "Contain work" });
    f.advance(61);
    expect(await f.usage.expire({ siteId })).toEqual({ examined: 1, released: 1, expired: 0 });
    expect(await f.call()).toMatchObject({
      state: "cancelled",
      dispatchState: "not-dispatched",
      providerRequestId: null,
      inputTokens: null,
      costMicros: null,
    });
    expect(await f.db.select().from(npAgentUsageDaily)).toHaveLength(0);
    expect(await f.usage.expire({ siteId })).toEqual({ examined: 0, released: 0, expired: 0 });
  });

  it("retains one frozen pricing instant across later turns while preserving actual reservation times", async () => {
    const f = await fixture();
    const first = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request: first });
    await f.usage.reconcile({
      siteId,
      providerCallId: first.providerCallId,
      response: await f.response(first, unsent(first)),
    });
    f.advance(5);
    const second = await f.request({ sequence: 2 });
    await f.usage.reserve({ siteId, runId: f.runId, request: second });
    const reservations = await f.db
      .select()
      .from(npAgentUsageReservations)
      .orderBy(npAgentUsageReservations.reservedAt);
    expect(reservations[1]!.reservedAt.getTime()).toBeGreaterThan(
      reservations[0]!.reservedAt.getTime(),
    );
    expect(reservations[1]!.pricingEffectiveAt).toEqual(reservations[0]!.pricingEffectiveAt);
  });

  it("keeps the rolling hour across a UTC month boundary and carries pending maxima into the new month", async () => {
    const f = await fixture();
    const current = f.options.now();
    const boundary = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1);
    f.advance((boundary - 60_000 - current.getTime()) / 1000);
    const { runId } = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
    const known = await f.request({ runId });
    await f.usage.reserve({ siteId, runId, request: known });
    await f.usage.beginDispatch({ siteId, runId, request: known });
    await f.usage.reconcile({
      siteId,
      providerCallId: known.providerCallId,
      response: await f.response(known, success(known), decision),
    });
    const pending = await f.request({ runId, sequence: 2 });
    await f.usage.reserve({ siteId, runId, request: pending });
    f.advance(120);
    expect(await measure(f)).toMatchObject({
      runsRollingHour: 1,
      providerCallsRollingHour: 2,
      concurrentProviderCalls: 1,
      inputTokensUtcDay: 10,
      inputTokensUtcMonth: 10,
      outputTokensUtcDay: 10,
      outputTokensUtcMonth: 10,
      costMicrosUtcDay: 31,
      costMicrosUtcMonth: 31,
    });
  });

  it("fails closed if finalized daily evidence is absent and uses uniform unavailable foreign ids", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ siteId, runId: f.runId, request });
    await f.usage.beginDispatch({ siteId, runId: f.runId, request });
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, success(request), decision),
    });
    await f.db.delete(npAgentUsageDaily).where(eq(npAgentUsageDaily.siteId, siteId));
    await expect(measure(f)).rejects.toMatchObject({ code: "RUNTIME_BUDGET_UNAVAILABLE" });
    const response = await f.response(
      { ...request, providerCallId: randomUUID() },
      success(request),
      decision,
    );
    await expect(
      f.usage.reconcile({ siteId, providerCallId: response.providerCallId, response }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE", status: 404 });
    expect(
      (
        await f.db
          .select()
          .from(npAgentConnections)
          .where(eq(npAgentConnections.id, f.connectionId))
      )[0]!.status,
    ).toBe("ready");
  });
});
