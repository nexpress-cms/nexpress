import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentProviderCalls,
  npAgentCircuitBreakers,
  npAgentUsageReservations,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npRequireAgentRuntimeProviderFailureV1 } from "../../../packages/core/src/agent/runtime-provider-evidence.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import type {
  NpAgentProviderInvokeOutcomeV1,
  NpAgentProviderRequestCanonicalV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
type Fixture = Awaited<ReturnType<typeof runtimeUsageFixture>>;
const fixtures: Fixture[] = [];
async function fixture() {
  const f = await runtimeUsageFixture();
  fixtures.push(f);
  return {
    ...f,
    request: (overrides: Parameters<typeof f.request>[0] = {}) =>
      f.request({
        ...overrides,
        limits: overrides.limits ?? { maxInputTokens: 10, maxOutputTokens: 10, timeoutSeconds: 5 },
      }),
    store: createAgentRuntimeExecutionStoreV1({
      admission: f.admission,
      now: f.options.now,
      leaseSeconds: 10,
    }),
    breakers: createAgentRuntimeBreakersV1({
      failureThreshold: 1,
      windowSeconds: 60,
      cooldownSeconds: 20,
      probeSeconds: 5,
      now: f.options.now,
    }),
    input: { siteId, runId: f.runId },
  };
}
function failure(
  request: NpAgentProviderRequestCanonicalV1,
  authentication = false,
): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "failed",
    provider: request.provider,
    model: request.model,
    providerRequestId: null,
    output: null,
    errorClass: authentication ? "authentication" : "transient",
    safeCode: "PROVIDER_UNAVAILABLE",
    retryable: !authentication,
    dispatchState: "not-dispatched",
    usage: null,
    finishReason: null,
    latencyMs: 1,
  };
}
describe.skipIf(skipIfNoTestDb())("runtime lease recovery and connection breakers", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    for (const f of fixtures.splice(0)) await f.dispose();
  });
  afterAll(async () => {
    await closeTestDb();
  });
  it("rejects stale and omitted claims before provider dispatch", async () => {
    const f = await fixture();
    const request = await f.request();
    const first = (await f.store.claim(f.input)).claim!;
    await f.usage.reserve({ ...f.input, claim: first, request });
    f.advance(11);
    const second = (await f.store.claim(f.input)).claim!;
    await expect(
      f.usage.beginDispatch({ ...f.input, claim: first, request }),
    ).rejects.toBeDefined();
    await expect(f.usage.beginDispatch({ ...f.input, request })).rejects.toBeDefined();
    expect((await f.call()).state).toBe("reserved");
    await f.usage.beginDispatch({ ...f.input, claim: second, request });
    expect((await f.call()).state).toBe("in_flight");
  });
  it("rejects an unsent recovery snapshot after the dispatch fence committed", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    const snapshot = await f.call();
    expect(snapshot.state).toBe("reserved");
    await f.usage.beginDispatch({ ...f.input, request });
    await expect(
      f.usage.reconcile({
        siteId,
        providerCallId: snapshot.id,
        requireUnsent: true,
        response: await f.response(request, failure(request)),
      }),
    ).rejects.toBeDefined();
    expect((await f.call()).state).toBe("in_flight");
    const [reservation] = await f.db
      .select()
      .from(npAgentUsageReservations)
      .where(eq(npAgentUsageReservations.runId, f.runId));
    expect(reservation.state).toBe("reserved");
  });
  it("rejects a false-to-true retry flag on a genuine allowed-class failure", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    const outcome = failure(request);
    if (outcome.status !== "failed") throw new Error("Invalid fixture");
    outcome.retryable = false;
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, outcome),
    });
    await f.db
      .update(npAgentProviderCalls)
      .set({ retryable: true })
      .where(eq(npAgentProviderCalls.id, request.providerCallId));
    const retry = await f.request({ sequence: 2, retryOfId: request.providerCallId });
    await expect(f.usage.reserve({ ...f.input, request: retry })).rejects.toMatchObject({
      code: "RUNTIME_PROVIDER_EVIDENCE_INVALID",
    });
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(1);
  });
  it("requires one exact retained safe-code receipt and accepts an untampered retry", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, failure(request)),
    });
    const call = await f.call();
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
        npRequireAgentRuntimeProviderFailureV1({ db, call }),
      ),
    ).resolves.toMatchObject({ retryable: true, errorClass: "transient" });
    const retry = await f.request({ sequence: 2, retryOfId: request.providerCallId });
    await f.usage.reserve({ ...f.input, request: retry });
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(2);
    const [receipt] = await f.db
      .select()
      .from(npAuditEvents)
      .where(
        and(eq(npAuditEvents.action, "agent.runtime.usage"), eq(npAuditEvents.targetId, call.id)),
      );
    const { outcomeSafeCode: _code, ...legacy } = receipt.payload;
    await f.db
      .update(npAuditEvents)
      .set({ payload: legacy })
      .where(eq(npAuditEvents.id, receipt.id));
    await expect(
      npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) =>
        npRequireAgentRuntimeProviderFailureV1({ db, call }),
      ),
    ).rejects.toMatchObject({ code: "RUNTIME_PROVIDER_EVIDENCE_INVALID" });
  });
  it("lost in-flight work terminalizes the run without releasing unknown spend", async () => {
    const f = await fixture();
    const request = await f.request();
    const claim = (await f.store.claim(f.input)).claim!;
    await f.usage.reserve({ ...f.input, claim, request });
    await f.usage.beginDispatch({ ...f.input, claim, request });
    f.advance(11);
    expect(await f.store.recover(f.input)).toEqual({ state: "failed", claim: null });
    expect((await f.call()).dispatchState).toBe("unknown");
    const [reservation] = await f.db
      .select()
      .from(npAgentUsageReservations)
      .where(eq(npAgentUsageReservations.runId, f.runId));
    expect(reservation.state).toBe("reserved");
  });
  it("late cancellation receipt settles usage without reviving a cancelled run", async () => {
    const f = await fixture();
    const request = await f.request();
    const claim = (await f.store.claim(f.input)).claim!;
    await f.usage.reserve({ ...f.input, claim, request });
    await f.usage.beginDispatch({ ...f.input, claim, request });
    await f.store.cancel(f.input);
    const response = await f.response(request, failure(request));
    await f.usage.reconcile({ siteId, providerCallId: request.providerCallId, response });
    expect((await f.store.claim(f.input)).state).toBe("cancelled");
    expect((await f.call()).state).toBe("failed");
  });
  it("observes each failed immutable call once and leases one half-open probe", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, failure(request)),
    });
    const input = { siteId, providerCallId: request.providerCallId };
    expect(await f.breakers.observeCall(input)).toEqual({ state: "open", replayed: false });
    expect(await f.breakers.observeCall(input)).toEqual({ state: "open", replayed: true });
    expect(await f.breakers.claimProbe({ siteId, connectionId: f.connectionId })).toBeNull();
    f.advance(21);
    const probes = await Promise.all([
      f.breakers.claimProbe({ siteId, connectionId: f.connectionId }),
      f.breakers.claimProbe({ siteId, connectionId: f.connectionId }),
    ]);
    expect(probes.filter(Boolean)).toHaveLength(1);
    const probe = probes.find(Boolean)!;
    expect(await f.breakers.settleProbe({ siteId, probe, succeeded: true })).toEqual({
      state: "closed",
    });
    await expect(f.breakers.settleProbe({ siteId, probe, succeeded: true })).rejects.toBeDefined();
  });
  it("authentication breakers cannot automatically half-open", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, failure(request, true)),
    });
    await f.breakers.observeCall({ siteId, providerCallId: request.providerCallId });
    f.advance(200);
    expect(await f.breakers.claimProbe({ siteId, connectionId: f.connectionId })).toBeNull();
  });
  it("a stale probe cannot close a replacement probe generation", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    await f.usage.reconcile({
      siteId,
      providerCallId: request.providerCallId,
      response: await f.response(request, failure(request)),
    });
    await f.breakers.observeCall({ siteId, providerCallId: request.providerCallId });
    f.advance(21);
    const first = (await f.breakers.claimProbe({ siteId, connectionId: f.connectionId }))!;
    f.advance(6);
    const second = (await f.breakers.claimProbe({ siteId, connectionId: f.connectionId }))!;
    await expect(
      f.breakers.settleProbe({ siteId, probe: first, succeeded: true }),
    ).rejects.toBeDefined();
    await f.breakers.settleProbe({ siteId, probe: second, succeeded: false });
    const [row] = await f.db
      .select()
      .from(npAgentCircuitBreakers)
      .where(
        and(
          eq(npAgentCircuitBreakers.siteId, siteId),
          eq(npAgentCircuitBreakers.id, first.breakerId),
        ),
      );
    expect(row.state).toBe("open");
  });
  it("nonterminal calls cannot fabricate breaker observations", async () => {
    const f = await fixture();
    const request = await f.request();
    await f.usage.reserve({ ...f.input, request });
    await expect(
      f.breakers.observeCall({ siteId, providerCallId: request.providerCallId }),
    ).rejects.toBeDefined();
    expect(await f.db.select().from(npAgentCircuitBreakers)).toHaveLength(0);
    expect((await f.db.select().from(npAgentProviderCalls))[0].state).toBe("reserved");
  });
});
