import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentGuardianRuntimeObservationServiceV1,
  type NpAgentGuardianRuntimeObservationOptionsV1,
} from "../../../packages/core/src/agent/guardian-runtime-observation.js";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import {
  resetAgentGuardianRuntimeObserverV1,
  setAgentGuardianRuntimeObserverV1,
} from "../../../packages/core/src/agent/guardian-runtime-observer.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentGuardianRetentionServiceV1 } from "../../../packages/core/src/agent/guardian-retention-service.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { npAgentRuntimeReceipts } from "../../../packages/core/src/db/schema/guardian-runtime.js";
import {
  npAgentActions,
  npAgentEvents,
  npAgentIncidents,
  npAgentSignals,
  npAgentRuns,
  npAgentCircuitBreakers,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSessions, npSettings } from "../../../packages/core/src/db/schema/system.js";
import type {
  NpAgentProviderInvokeOutcomeV1,
  NpAgentProviderTaskOutputV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { runtimeReadCapabilityFixture } from "./agent-runtime-capability-fixture.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { guardianRuntimeExecutorFixture } from "./agent-guardian-runtime-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const cleanup: Array<() => Promise<void>> = [];
type ReadFixture = Awaited<ReturnType<typeof runtimeReadCapabilityFixture>>;
function install(f: Pick<ReadFixture, "db" | "options" | "actor">) {
  const forbidden = () =>
    Promise.reject(new Error("Source collection must not admit Runtime or call a provider"));
  const events = createAgentRuntimeEventServiceV1({
    admission: {
      admit: forbidden,
      retry: forbidden,
      withCurrentRun: forbidden,
      withRunAuthority: forbidden,
    },
    enqueueRun: forbidden,
    deploymentAuthority: {
      policyId: "guardian-runtime-source-test",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
  });
  const authority = { allowed: true };
  const sourceOptions: NpAgentGuardianRuntimeObservationOptionsV1 = {
    receiptKey: { id: "guardian-runtime-test-v1", bytes: new Uint8Array(32).fill(83) },
    installedSiteIds: [siteId],
    events,
    authorize: () =>
      authority.allowed
        ? Promise.resolve()
        : Promise.reject(new Error("Collector authority unavailable")),
    now: f.options.now,
  };
  const source = createAgentGuardianRuntimeObservationServiceV1(sourceOptions);
  setAgentGuardianRuntimeObserverV1(source.observer);
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(84),
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      try {
        await source.evidence({
          db: context.transaction ?? f.db,
          siteId: context.siteId,
          actor: context.actor,
          incident,
        });
        return true;
      } catch {
        return false;
      }
    },
  });
  async function incident() {
    const [signal] = await f.db
      .select()
      .from(npAgentSignals)
      .where(eq(npAgentSignals.siteId, siteId))
      .limit(1);
    if (!signal?.incidentId) throw new Error("Expected verified Runtime Signal/Incident");
    return (
      await reads.staff.get({ incidentId: signal.incidentId }, { siteId, actor: f.actor.actor })
    ).incident;
  }
  return { source, sourceOptions, events, authority, incident };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => (resolve = complete));
  return { promise, resolve };
}
/** Pin the other two harness clients so late callbacks see their exact client
 * reused in another real transaction after the collector's rollback. */
async function pinOtherClients(db: ReadFixture["db"]) {
  const release = deferred<void>();
  const entered = [deferred<void>(), deferred<void>()];
  const transactions = entered.map((ready) =>
    db.transaction(async (transaction) => {
      await transaction.execute(sql`select 1`);
      ready.resolve();
      await release.promise;
    }),
  );
  await Promise.all(entered.map((ready) => ready.promise));
  return async () => {
    release.resolve();
    await Promise.all(transactions);
  };
}
async function newRead(f: ReadFixture) {
  const { runId } = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
  const acquired = await f.store.claim({ siteId, runId });
  if (!acquired.claim) throw new Error("Expected actual Runtime claim");
  return f.capability.invokeRuntime({ ...f.input, runId, claim: acquired.claim });
}
const decision: NpAgentProviderTaskOutputV1 = {
  task: "interactive-capability",
  decision: { kind: "complete", summary: "Controlled local usage receipt" },
};
function success(costMicros: number): NpAgentProviderInvokeOutcomeV1 {
  return {
    schemaVersion: "np.agent-provider-invoke-outcome.v1",
    status: "succeeded",
    provider: "fake-provider",
    model: "fake-model",
    providerRequestId: null,
    output: decision,
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      tokenSource: "provider",
      costSource: "provider",
      costMicros,
    },
    finishReason: "stop",
    latencyMs: 0,
  };
}
function retention(f: Pick<ReadFixture, "options">, source: ReturnType<typeof install>["source"]) {
  return createAgentGuardianRetentionServiceV1({
    policy: { version: 1, eventDays: 1, receiptDays: 1, signalDays: 1, historyDays: 1 },
    authorize: () => Promise.resolve(),
    proofOwners: [
      {
        family: "runtime",
        verifyEvent: source.verifyEvent,
        verifySignal: source.verifySignal,
        verifyReceipt: source.verifyReceiptForRetention,
      },
    ],
    now: () => new Date(f.options.now().getTime() + 100 * 86_400_000),
  });
}

describe.skipIf(skipIfNoTestDb())(
  "Guardian actual Runtime source receipts and review rules",
  () => {
    beforeAll(ensureMigrated);
    beforeEach(async () => {
      await truncateAll();
      registerTestCollections();
    });
    afterEach(async () => {
      resetAgentGuardianRuntimeObserverV1();
      for (const dispose of cleanup.splice(0)) await dispose();
    });
    afterAll(closeTestDb);
    it("pins emitted and sampled receipts for a current Run, then releases actual terminal settled history through its source owner", async () => {
      const f = await runtimeUsageFixture({ limits: { maxProviderCalls: 120 } });
      cleanup.push(f.dispose);
      const g = install(f);
      for (let sequence = 1; sequence <= 101; sequence++) {
        const request = await f.request({ sequence });
        await f.usage.reserve({ siteId, runId: f.runId, request });
        const cancelled: NpAgentProviderInvokeOutcomeV1 = {
          schemaVersion: "np.agent-provider-invoke-outcome.v1",
          status: "failed",
          provider: request.provider,
          model: request.model,
          providerRequestId: null,
          output: null,
          errorClass: "cancelled",
          safeCode: "CONTROLLED_UNSENT_RELEASE",
          retryable: false,
          dispatchState: "not-dispatched",
          usage: null,
          finishReason: null,
          latencyMs: 0,
        };
        await f.usage.reconcile({
          siteId,
          providerCallId: request.providerCallId,
          requireUnsent: true,
          response: await f.response(request, cancelled),
        });
      }
      for (let round = 0; round < 30; round++) {
        await g.source.collect({ siteId });
        const pending = (await f.db.select().from(npAgentRuntimeReceipts)).filter(
          (r) => r.state === "pending" || r.state === "blocked",
        );
        if (!pending.length) break;
      }
      const initial = await f.db.select().from(npAgentRuntimeReceipts);
      expect(initial.filter((r) => r.state === "emitted")).toHaveLength(100);
      expect(initial.filter((r) => r.state === "sampled")).toHaveLength(1);
      expect(await f.db.select().from(npAgentSignals)).toHaveLength(0);
      const owner = retention(f, g.source);
      const held = await owner.prune({ siteId });
      expect(held.eventsPruned).toBe(0);
      expect(held.receiptsPruned).toBe(0);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toHaveLength(101);
      const store = createAgentRuntimeExecutionStoreV1({
        admission: f.admission,
        now: f.options.now,
      });
      await store.cancel({ siteId, runId: f.runId });
      await pruneAgentRuntimeEventsV1({
        siteId,
        now: new Date(f.options.now().getTime() + 100 * 86_400_000),
      });
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toHaveLength(101);
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(100);
      expect(await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId))).toHaveLength(
        1,
      );
      let cursor: string | null = null,
        eventsPruned = 0,
        receiptsPruned = 0;
      for (let round = 0; round < 30; round++) {
        const result = await owner.prune({ siteId, cursor, limit: 25 });
        eventsPruned += result.eventsPruned;
        receiptsPruned += result.receiptsPruned;
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
      expect(eventsPruned).toBe(100);
      expect(receiptsPruned).toBe(101);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toHaveLength(0);
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
      expect(
        await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, f.runId)),
      ).toMatchObject([{ state: "cancelled" }]);
    }, 120_000);
    it("retains an authentic emitted unknown-cost receipt even after its Run becomes terminal and old", async () => {
      const f = await runtimeUsageFixture();
      cleanup.push(f.dispose);
      const g = install(f),
        request = await f.request();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      await f.usage.beginDispatch({ siteId, runId: f.runId, request });
      const unknown: NpAgentProviderInvokeOutcomeV1 = {
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "ambiguous",
        provider: request.provider,
        model: request.model,
        providerRequestId: null,
        output: null,
        errorClass: "timeout",
        safeCode: "CONTROLLED_UNKNOWN",
        retryable: false,
        dispatchState: "unknown",
        usage: null,
        finishReason: null,
        latencyMs: 0,
      };
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, unknown),
      });
      await g.source.collect({ siteId });
      const store = createAgentRuntimeExecutionStoreV1({
        admission: f.admission,
        now: f.options.now,
      });
      await store.cancel({ siteId, runId: f.runId });
      const result = await retention(f, g.source).prune({ siteId });
      expect(result.eventsPruned).toBe(0);
      expect(result.receiptsPruned).toBe(0);
      const [receipt] = await f.db.select().from(npAgentRuntimeReceipts);
      expect(receipt.state).toBe("emitted");
      expect(
        await g.source.verifyReceiptForRetention({ db: f.db, siteId, receiptId: receipt.id }),
      ).toMatchObject({ state: "emitted" });
    });
    it("always retains pending, closed-delivery held and invalid blocked receipts from real Action writes", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      await f.store.cancel({ siteId, runId: f.input.runId });
      const owner = retention(f, g.source);
      await owner.prune({ siteId });
      expect((await f.db.select().from(npAgentRuntimeReceipts))[0].state).toBe("pending");
      expect(await g.source.collect({ siteId })).toMatchObject({ held: 1, emitted: 0 });
      await owner.prune({ siteId });
      expect((await f.db.select().from(npAgentRuntimeReceipts))[0].state).toBe("held");
      const result = await newRead(f);
      if (!("actionId" in result)) throw new Error("Expected real read Action result");
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, result.actionId));
      if (!action.runId) throw new Error("Expected real Runtime Action");
      await f.store.cancel({ siteId, runId: action.runId });
      const [pending] = await f.db
        .select()
        .from(npAgentRuntimeReceipts)
        .where(eq(npAgentRuntimeReceipts.runId, action.runId));
      await f.db
        .update(npAgentRuntimeReceipts)
        .set({ sourceMac: `hmac-sha256:${"A".repeat(43)}` })
        .where(eq(npAgentRuntimeReceipts.id, pending.id));
      expect(await g.source.collect({ siteId })).toMatchObject({ blocked: 1, emitted: 0 });
      await owner.prune({ siteId });
      expect((await f.db.select().from(npAgentRuntimeReceipts)).map((r) => r.state).sort()).toEqual(
        ["blocked", "held"],
      );
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    });
    it("captures the actual two-proposal blocker and keeps diagnostic history after the breaker opens", async () => {
      const f = await guardianRuntimeExecutorFixture("repeat");
      cleanup.push(f.dispose);
      const g = install(f);
      expect(await f.executor.process(f.input)).toEqual({ state: "policy_blocked" });
      expect(f.invoke).toHaveBeenCalledTimes(2);
      const receipts = await f.db.select().from(npAgentRuntimeReceipts);
      expect(receipts.filter((r) => r.body.fact.kind === "proposal-repeated")).toHaveLength(1);
      expect(await g.source.collect({ siteId })).toMatchObject({ blocked: 0 });
      const [signal] = await f.db
        .select()
        .from(npAgentSignals)
        .where(eq(npAgentSignals.detectorId, "guardian.repeated-proposals"));
      expect(signal).toBeTruthy();
      expect(await g.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
      expect(await f.executor.process(f.input)).toEqual({ state: "policy_blocked" });
      expect(f.invoke).toHaveBeenCalledTimes(2);
    });
    it("records five actual rejected proposals with missing scopes rather than treating arbitrary 404s as scope proof", async () => {
      // The fixture's ordinary breaker threshold3 stops admission before this
      // five-observation rule. Explicit host configuration6 exercises the actual
      // Guardian rule; no production breaker or stored source fact is bypassed.
      const f = await guardianRuntimeExecutorFixture("denied", { breakerFailureThreshold: 6 });
      cleanup.push(f.dispose);
      const g = install(f);
      expect(await f.executor.process(f.input)).toEqual({ state: "failed" });
      for (let n = 0; n < 4; n++) {
        const { runId } = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
        expect(await f.executor.process({ siteId, runId })).toEqual({ state: "failed" });
      }
      const [breaker] = await f.db
        .select()
        .from(npAgentCircuitBreakers)
        .where(
          and(
            eq(npAgentCircuitBreakers.siteId, siteId),
            eq(npAgentCircuitBreakers.scopeKind, "agent"),
            eq(npAgentCircuitBreakers.scopeRef, f.runInput.agentId),
          ),
        );
      expect(breaker).toMatchObject({ state: "closed", failureCount: 5 });
      const receipts = await f.db.select().from(npAgentRuntimeReceipts);
      const denied = receipts.filter((r) => r.body.fact.kind === "scope-denied");
      expect(denied).toHaveLength(5);
      for (const receipt of denied)
        expect(receipt.body.fact).toMatchObject({
          capabilityId: "content.query",
          missingScopes: ["content:draft"],
        });
      expect(await g.source.collect({ siteId })).toMatchObject({ blocked: 0 });
      const [signal] = await f.db
        .select()
        .from(npAgentSignals)
        .where(eq(npAgentSignals.detectorId, "guardian.denied-scopes"));
      expect(signal).toBeTruthy();
      expect(await g.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
      expect(await f.db.select().from(npAgentActions)).toHaveLength(0);
    });
    it("leaves an actual Runtime Action save unchanged with no observer and creates no source receipt", async () => {
      const f = await runtimeReadCapabilityFixture();
      await f.capability.invokeRuntime(f.input);
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, f.input.runId)),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toEqual([]);
    });
    it("captures five actual admitted Actions across same-Agent Runs and verifies one redacted review Signal", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      for (let n = 0; n < 4; n++) await newRead(f);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toHaveLength(5);
      expect(await g.source.collect({ siteId })).toMatchObject({
        state: "collecting",
        processed: 5,
        emitted: 5,
        blocked: 0,
        held: 0,
        backlog: 0,
      });
      const [signal] = await f.db.select().from(npAgentSignals);
      expect(signal).toMatchObject({
        detectorId: "guardian.action-velocity",
        category: "agent-abuse",
      });
      expect(await g.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
      const incident = await g.incident(),
        evidence = await g.source.evidence({ db: f.db, siteId, actor: f.actor.actor, incident });
      expect(evidence).toMatchObject([
        { observedCount: 5, countBasis: "at-least", assessment: "review-only", accounting: null },
      ]);
      expect(JSON.stringify(evidence)).not.toContain(f.input.runId);
      // The actual Incident owner above established the current read ACL. The private
      // Runtime assessment facet authenticates identical proof without fabricating a session.
      expect(await g.source.assessmentEvidence({ db: f.db, siteId, incident })).toEqual(evidence);
      await expect(
        g.source.assessmentEvidence({
          db: f.db,
          siteId,
          incident: { ...incident, versionNumber: incident.versionNumber + 1 },
        }),
      ).rejects.toMatchObject({ code: "GUARDIAN_RUNTIME_EVIDENCE_UNAVAILABLE" });
      const events = await f.db.select().from(npAgentEvents);
      for (const event of events) {
        expect(event.dispatchedAt).toEqual(event.recordedAt);
        expect(await g.source.verifyEvent({ db: f.db, siteId, eventId: event.id })).toMatchObject({
          source: "runtime",
          detectorId: null,
        });
      }
      expect(await g.source.collect({ siteId })).toMatchObject({ processed: 0, emitted: 0 });
      expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    });
    it("does not recapture a replayed Action or commit an Action when its installed source fails", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      await f.capability.invokeRuntime(f.input);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toHaveLength(1);
      const { runId } = await f.admission.admit({ ...f.runInput, idempotencyKey: randomUUID() });
      const acquired = await f.store.claim({ siteId, runId });
      if (!acquired.claim) throw new Error("Expected claim");
      setAgentGuardianRuntimeObserverV1({
        record: async (input) => {
          await g.source.observer.record(input);
          throw new Error("Injected post-insert source failure");
        },
      });
      await expect(
        f.capability.invokeRuntime({ ...f.input, runId, claim: acquired.claim }),
      ).rejects.toMatchObject({ code: "GUARDIAN_RUNTIME_SOURCE_INVALID" });
      expect(
        await f.db.select().from(npAgentActions).where(eq(npAgentActions.runId, runId)),
      ).toEqual([]);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toHaveLength(1);
    });
    it("blocks a corrupt receipt without starving a later valid fact and requires current collector authority", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      await newRead(f);
      const [receipt] = await f.db.select().from(npAgentRuntimeReceipts);
      await f.db
        .update(npAgentRuntimeReceipts)
        .set({ sourceMac: `hmac-sha256:${"A".repeat(43)}` })
        .where(eq(npAgentRuntimeReceipts.id, receipt.id));
      g.authority.allowed = false;
      await expect(g.source.collect({ siteId })).rejects.toThrow("Collector authority unavailable");
      expect(await f.db.select().from(npAgentEvents)).toEqual([]);
      g.authority.allowed = true;
      expect(await g.source.collect({ siteId })).toMatchObject({
        processed: 2,
        blocked: 1,
        emitted: 1,
        backlog: 1,
      });
      const [blocked] = await f.db
        .select()
        .from(npAgentRuntimeReceipts)
        .where(eq(npAgentRuntimeReceipts.id, receipt.id));
      expect(blocked).toMatchObject({ state: "blocked", failureCode: "SOURCE_INTEGRITY" });
    });
    it.each(["authorize", "record"] as const)(
      "bounds a stalled %s callback, rolls back its real source work and denies a saved write after exact client reuse",
      async (kind) => {
        const f = await runtimeReadCapabilityFixture(),
          g = install(f);
        await f.capability.invokeRuntime(f.input);
        const [receipt] = await f.db.select().from(npAgentRuntimeReceipts);
        expect(receipt.state).toBe("pending");
        const unpin = await pinOtherClients(f.db),
          entered = deferred<void>(),
          release = deferred<void>(),
          completed = deferred<unknown>();
        let sourcePid: number | undefined;
        const settingKey = `guardian.runtime.synthetic-late-${kind}`;
        const stall = async (db: ReadFixture["db"]) => {
          const result = await db.execute(sql`select pg_backend_pid() as pid`);
          sourcePid = Number(result.rows[0].pid);
          const prepared = db
            .insert(npSettings)
            .values({ siteId, key: settingKey, value: true })
            .prepare(`guardian_runtime_${randomUUID().replaceAll("-", "")}`);
          entered.resolve();
          await release.promise;
          try {
            await prepared.execute();
            completed.resolve(null);
          } catch (error) {
            completed.resolve(error);
            throw error;
          }
        };
        const source = createAgentGuardianRuntimeObservationServiceV1({
          ...g.sourceOptions,
          authorize:
            kind === "authorize"
              ? async (context) => {
                  await g.sourceOptions.authorize(context);
                  await stall(context.db);
                }
              : g.sourceOptions.authorize,
          events:
            kind === "record"
              ? {
                  record: async (input) => {
                    if (!input.db) throw new Error("Expected source transaction");
                    const recorded = await g.events.record(input);
                    await stall(input.db);
                    return recorded;
                  },
                }
              : g.events,
        });
        const fallback = setTimeout(() => release.resolve(), 7500);
        const startedAt = performance.now(),
          collection = source.collect({ siteId });
        void collection.then(
          () => entered.resolve(),
          () => entered.resolve(),
        );
        try {
          const rejected = expect(collection).rejects.toMatchObject({
            code: "GUARDIAN_RUNTIME_SOURCE_TIMEOUT",
            statusCode: 503,
          });
          await entered.promise;
          await rejected;
          // Five seconds of work plus the bounded500ms SQL/rollback drain;
          // this is a lifecycle assertion, not a request-performance result.
          expect(performance.now() - startedAt).toBeLessThan(6500);
          expect(sourcePid).toBeDefined();
          await f.db.transaction(async (borrower) => {
            const result = await borrower.execute(sql`select pg_backend_pid() as pid`);
            expect(Number(result.rows[0].pid)).toBe(sourcePid);
            await borrower.execute(sql`set local lock_timeout = '250ms'`);
            await borrower.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`np:site-quota:${siteId}`}, 0))`,
            );
            release.resolve();
            expect(await completed.promise).toBeInstanceOf(Error);
            expect(
              await borrower.select().from(npSettings).where(eq(npSettings.key, settingKey)),
            ).toEqual([]);
            expect(await borrower.select().from(npAgentEvents)).toEqual([]);
            expect(await borrower.select().from(npAgentSignals)).toEqual([]);
            expect(await borrower.select().from(npAgentRuntimeReceipts)).toMatchObject([
              { id: receipt.id, state: "pending", emittedEventId: null, failureCode: null },
            ]);
          });
          const controls = createAgentGuardianControlsV1({
            deploymentActorFingerprint: `cj1:sha256:${"A".repeat(43)}`,
            now: f.options.now,
          });
          expect(
            (await controls.disable({ siteId, reason: "Synthetic source recovery" })).outcome,
          ).toBe("disabled");
          expect(await g.source.collect({ siteId })).toMatchObject({ state: "disabled" });
        } finally {
          clearTimeout(fallback);
          release.resolve();
          await collection.catch(() => undefined);
          await unpin();
        }
      },
      20_000,
    );
    it("keeps each collector SQL statement within500ms and preserves an ordinary blocked receipt", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      const source = createAgentGuardianRuntimeObservationServiceV1({
        ...g.sourceOptions,
        events: {
          record: async (input) => {
            if (!input.db) throw new Error("Expected source transaction");
            await input.db.execute(sql`select pg_sleep(2)`);
            return g.events.record(input);
          },
        },
      });
      const startedAt = performance.now();
      expect(await source.collect({ siteId })).toMatchObject({
        processed: 1,
        emitted: 0,
        blocked: 1,
        backlog: 1,
      });
      expect(performance.now() - startedAt).toBeLessThan(1800);
      expect(await f.db.select().from(npAgentEvents)).toEqual([]);
      expect(await f.db.select().from(npAgentRuntimeReceipts)).toMatchObject([
        { state: "blocked", failureCode: "DELIVERY_UNAVAILABLE", emittedEventId: null },
      ]);
    });
    it("bounds serial retained-key detector work without committing a partial source proof", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      for (let n = 0; n < 9; n++) await newRead(f);
      expect(await g.source.collect({ siteId })).toMatchObject({ emitted: 10, blocked: 0 });
      await newRead(f);
      const [pending] = await f.db
        .select()
        .from(npAgentRuntimeReceipts)
        .where(eq(npAgentRuntimeReceipts.state, "pending"));
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let lookups = 0;
      const source = createAgentGuardianRuntimeObservationServiceV1({
        ...g.sourceOptions,
        receiptKey: { id: "guardian-runtime-test-v2", bytes: new Uint8Array(32).fill(85) },
        resolveReceiptKey: (id) => {
          if (id !== g.sourceOptions.receiptKey.id) return null;
          lookups++;
          return new Promise<Uint8Array>((resolve) => {
            const timer = setTimeout(() => {
              timers.delete(timer);
              resolve(g.sourceOptions.receiptKey.bytes);
            }, 450);
            timers.add(timer);
          });
        },
      });
      const beforeEvents = await f.db.select().from(npAgentEvents),
        beforeSignals = await f.db.select().from(npAgentSignals),
        startedAt = performance.now();
      try {
        await expect(source.collect({ siteId, limit: 1 })).rejects.toMatchObject({
          code: "GUARDIAN_RUNTIME_SOURCE_TIMEOUT",
        });
        expect(performance.now() - startedAt).toBeLessThan(6500);
        const boundedLookups = lookups;
        expect(boundedLookups).toBeGreaterThan(1);
        await new Promise((resolve) => setTimeout(resolve, 550));
        expect(lookups).toBe(boundedLookups);
        expect(await f.db.select().from(npAgentEvents)).toEqual(beforeEvents);
        expect(await f.db.select().from(npAgentSignals)).toEqual(beforeSignals);
        expect(
          await f.db
            .select()
            .from(npAgentRuntimeReceipts)
            .where(eq(npAgentRuntimeReceipts.id, pending.id)),
        ).toMatchObject([{ state: "pending", failureCode: null, emittedEventId: null }]);
        expect(await g.source.collect({ siteId, limit: 1 })).toMatchObject({
          emitted: 1,
          blocked: 0,
        });
      } finally {
        for (const timer of timers) clearTimeout(timer);
      }
    }, 30_000);
    it("retains unknown accounting captured before late settlement and counts only the real known settled cost", async () => {
      const f = await runtimeUsageFixture();
      cleanup.push(f.dispose);
      const g = install(f),
        request = await f.request();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      await f.usage.beginDispatch({ siteId, runId: f.runId, request });
      const ambiguous: NpAgentProviderInvokeOutcomeV1 = {
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "ambiguous",
        provider: "fake-provider",
        model: "fake-model",
        providerRequestId: null,
        output: null,
        errorClass: "timeout",
        safeCode: "CONTROLLED_TIMEOUT",
        retryable: false,
        dispatchState: "unknown",
        usage: null,
        finishReason: null,
        latencyMs: 0,
      };
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, ambiguous),
      });
      f.advance(61);
      await f.usage.expire({ siteId });
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, success(100_000), decision),
      });
      const receipts = await f.db.select().from(npAgentRuntimeReceipts);
      expect(receipts).toHaveLength(3);
      expect(
        receipts.filter(
          (r) => r.body.fact.kind === "provider-cost" && r.body.fact.accounting.state === "unknown",
        ),
      ).toHaveLength(2);
      expect(await g.source.collect({ siteId })).toMatchObject({
        processed: 3,
        emitted: 3,
        blocked: 0,
        held: 0,
      });
      const [signal] = await f.db
        .select()
        .from(npAgentSignals)
        .where(eq(npAgentSignals.detectorId, "guardian.spend-velocity"));
      expect(signal).toBeTruthy();
      expect(await g.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
      const evidence = await g.source.evidence({
        db: f.db,
        siteId,
        actor: f.actor.actor,
        incident: await g.incident(),
      });
      expect(evidence[0].accounting).toMatchObject({
        reportedCostMicros: 100_000,
        estimatedCostMicros: 0,
        knownCostMicros: 100_000,
        unknownCallCount: 0,
        unknownBudgetChargeMicros: 0,
      });
      for (const receipt of receipts)
        expect(
          await g.source.verifyReceiptForRetention({ db: f.db, siteId, receiptId: receipt.id }),
        ).toMatchObject({ state: "emitted" });
    });
    it("fails closed on current session loss and keeps retained history after Runtime stops", async () => {
      const f = await runtimeReadCapabilityFixture(),
        g = install(f);
      await f.capability.invokeRuntime(f.input);
      for (let n = 0; n < 4; n++) await newRead(f);
      await g.source.collect({ siteId });
      const incident = await g.incident();
      await f.store.cancel({ siteId, runId: f.input.runId });
      expect(
        await g.source.evidence({ db: f.db, siteId, actor: f.actor.actor, incident }),
      ).toHaveLength(1);
      await f.db.delete(npSessions).where(eq(npSessions.id, f.actor.actor.sessionId));
      await expect(
        g.source.evidence({ db: f.db, siteId, actor: f.actor.actor, incident }),
      ).rejects.toThrow();
      expect(
        await f.db
          .select()
          .from(npAgentIncidents)
          .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, incident.id))),
      ).toHaveLength(1);
      expect(await f.db.select().from(npAgentRuns)).not.toHaveLength(0);
    });
  },
);
