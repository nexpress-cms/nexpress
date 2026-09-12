import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npAgentRuns } from "../../../packages/core/src/db/schema/agent.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { npAgentCircuitBreakers } from "../../../packages/core/src/db/schema/agent.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";
async function fixture() {
  const f = await runtimeFixture();
  const { runId } = await f.admission.admit(f.runInput);
  const store = createAgentRuntimeExecutionStoreV1({
    admission: f.admission,
    now: f.options.now,
    leaseSeconds: 10,
  });
  const input = { siteId, runId };
  const row = async () =>
    (
      await f.db
        .select()
        .from(npAgentRuns)
        .where(and(eq(npAgentRuns.siteId, siteId), eq(npAgentRuns.id, runId)))
    )[0]!;
  return { ...f, store, input, row };
}
describe.skipIf(skipIfNoTestDb())("runtime execution claim persistence", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });
  it("admits only one concurrent claim without increasing initial attempt", async () => {
    const f = await fixture();
    const claims = await Promise.all([f.store.claim(f.input), f.store.claim(f.input)]);
    expect(claims.filter((row) => row.claim)).toHaveLength(1);
    expect((await f.row()).attempt).toBe(1);
  });
  it("reclaim increments generation and rejects stale renewal/completion", async () => {
    const f = await fixture();
    const first = (await f.store.claim(f.input)).claim!;
    f.advance(11);
    const second = (await f.store.claim(f.input)).claim!;
    expect(second.attempt).toBe(2);
    await expect(f.store.renew({ ...f.input, claim: first })).rejects.toMatchObject({
      code: "RUNTIME_EXECUTION_CONFLICT",
    });
    await expect(
      f.store.transition({ ...f.input, claim: first, state: "failed" }),
    ).rejects.toMatchObject({ code: "RUNTIME_EXECUTION_CONFLICT" });
    expect((await f.row()).state).toBe("running");
  });
  it("renewal fences the prior lease timestamp", async () => {
    const f = await fixture();
    const first = (await f.store.claim(f.input)).claim!;
    f.advance(1);
    const renewed = await f.store.renew({ ...f.input, claim: first });
    expect(renewed.leaseUntil).not.toBe(first.leaseUntil);
    await expect(f.store.renew({ ...f.input, claim: first })).rejects.toBeDefined();
    await f.store.transition({ ...f.input, claim: renewed, state: "failed" });
    expect((await f.row()).leaseUntil).toBeNull();
  });
  it("completes verified work only through a current claim and clears its lease", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    expect(await f.store.transition({ ...f.input, claim, state: "verifying" })).toEqual({
      state: "verifying",
    });
    expect(await f.store.transition({ ...f.input, claim, state: "succeeded" })).toEqual({
      state: "succeeded",
    });
    expect((await f.row()).leaseUntil).toBeNull();
    expect((await f.row()).finishedAt).not.toBeNull();
    expect(await f.store.claim(f.input)).toEqual({ state: "succeeded", claim: null });
  });
  it("rolls back an awaited operation that outlives its claim", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    await expect(
      f.store.withClaim({ ...f.input, claim }, async ({ db }) => {
        await db
          .update(npAgentRuns)
          .set({ result: { marker: "must-rollback" } })
          .where(eq(npAgentRuns.id, f.input.runId));
        f.advance(11);
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_LEASE_LOST" });
    expect((await f.row()).result).toBeNull();
  });
  it("retains a durable retry time and does not claim early", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    const retryAt = new Date(f.options.now!().getTime() + 20000).toISOString();
    await f.store.waitRetry({ ...f.input, claim, retryAt });
    expect((await f.store.claim(f.input)).claim).toBeNull();
    expect((await f.row()).leaseUntil).toBeNull();
    f.advance(21);
    expect((await f.store.claim(f.input)).claim?.attempt).toBe(2);
    expect((await f.row()).runtimeRetryAt).toBeNull();
  });
  it("cancellation is terminal and independently replayable", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    expect(await f.store.cancel(f.input)).toEqual({ state: "cancelled" });
    expect(await f.store.cancel(f.input)).toEqual({ state: "cancelled" });
    await expect(f.store.renew({ ...f.input, claim })).rejects.toBeDefined();
    expect((await f.store.claim(f.input)).claim).toBeNull();
  });
  it("containment stays available when current readiness disappears", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    f.state.ready = false;
    await expect(
      f.store.withClaim({ ...f.input, claim }, () => Promise.resolve()),
    ).rejects.toBeDefined();
    expect(await f.store.cancel(f.input)).toEqual({ state: "cancelled" });
  });
  it("cannot invent a waiting approval without a persisted action", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    await expect(
      f.store.transition({ ...f.input, claim, state: "waiting_approval" }),
    ).rejects.toMatchObject({ code: "RUNTIME_APPROVAL_UNAVAILABLE" });
    expect((await f.row()).state).toBe("running");
  });
  it("attempt exhaustion remains terminal after later claim requests", async () => {
    const f = await fixture();
    await f.store.claim(f.input);
    f.advance(11);
    await f.store.claim(f.input);
    f.advance(11);
    expect(await f.store.claim(f.input)).toEqual({ state: "failed", claim: null });
    expect((await f.row()).errorCode).toBe("RUNTIME_ATTEMPTS_EXHAUSTED");
    expect(await f.store.claim(f.input)).toEqual({ state: "failed", claim: null });
  });
  it("a stored repeated-proposal failure opens one idempotent Agent breaker", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    await f.store.transition({
      ...f.input,
      claim,
      state: "failed",
      errorCode: "RUNTIME_REPEATED_PROPOSAL",
    });
    const breakers = createAgentRuntimeBreakersV1({
      failureThreshold: 10,
      windowSeconds: 60,
      cooldownSeconds: 60,
      now: f.options.now,
    });
    expect(await breakers.observeRun(f.input)).toEqual({ state: "open", replayed: false });
    expect(await breakers.observeRun(f.input)).toEqual({ state: "open", replayed: true });
    const [row] = await f.db.select().from(npAgentCircuitBreakers);
    expect(row.scopeKind).toBe("agent");
    expect(row.reasonCode).toBe("RUNTIME_POLICY_LOOP");
    expect(row.failureCount).toBe(1);
  });
  it("budget exhaustion does not install a permanent Agent policy breaker", async () => {
    const f = await fixture();
    const claim = (await f.store.claim(f.input)).claim!;
    await f.store.transition({
      ...f.input,
      claim,
      state: "budget_blocked",
      errorCode: "RUNTIME_BUDGET_EXHAUSTED",
    });
    const breakers = createAgentRuntimeBreakersV1({
      failureThreshold: 1,
      windowSeconds: 60,
      cooldownSeconds: 60,
      now: f.options.now,
    });
    expect(await breakers.observeRun(f.input)).toEqual({ state: "closed", replayed: false });
    expect(await f.db.select().from(npAgentCircuitBreakers)).toHaveLength(0);
  });
  it("expired deadline terminalizes without resurrecting a claim", async () => {
    const f = await fixture();
    await f.store.claim(f.input);
    f.advance(86401);
    expect(await f.store.recover(f.input)).toEqual({ state: "failed", claim: null });
    expect((await f.row()).errorCode).toBe("RUNTIME_DEADLINE_EXCEEDED");
  });
  it("tampered canonical evidence cannot be healed through cancellation", async () => {
    const f = await fixture();
    await f.db
      .update(npAgentRuns)
      .set({ goal: "tampered" })
      .where(eq(npAgentRuns.id, f.input.runId));
    await expect(f.store.cancel(f.input)).rejects.toMatchObject({
      code: "RUNTIME_EXECUTION_INTEGRITY_INVALID",
    });
    expect((await f.row()).state).toBe("queued");
  });
  it("uses the same unavailable boundary for absent and cross-site runs", async () => {
    const f = await fixture();
    await expect(
      f.store.claim({ siteId, runId: "00000000-0000-4000-8000-000000000001" }),
    ).rejects.toMatchObject({ code: "RUNTIME_RESOURCE_UNAVAILABLE" });
  });
});
