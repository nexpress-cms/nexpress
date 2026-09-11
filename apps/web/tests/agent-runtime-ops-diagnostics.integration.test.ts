import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentRuns,
  npAgentUsageReservations,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import {
  npCollectAgentHealthSummaryV1,
  type NpAgentDiagnosticsQueryClientV1,
} from "../../../packages/core/src/agent/contract-diagnostics.js";
import {
  npCountAgentSiteRows,
  npDeleteAgentSiteRows,
} from "../../../packages/core/src/agent/site-deletion.js";
import type {
  NpAgentProviderInvokeOutcomeV1,
  NpAgentProviderTaskOutputV1,
} from "../../../packages/core/src/agent-contract/types.js";
import { runtimeFixture, siteId } from "./agent-runtime-service-fixture.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const usageFixtures: Array<Awaited<ReturnType<typeof runtimeUsageFixture>>> = [];
describe.skipIf(skipIfNoTestDb())("Runtime private diagnostics and settled deletion", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of usageFixtures.splice(0)) await f.dispose();
  });
  afterAll(closeTestDb);

  it("verifies real zero-provider queued admission and detects retained source tampering without exposing it", async () => {
    const f = await runtimeFixture();
    const admitted = await f.admission.admit(f.runInput);
    const queryFailures: Array<{ stage: number; code: string }> = [];
    let queryStage = 0;
    const client = (f.db as unknown as { $client: NpAgentDiagnosticsQueryClientV1 }).$client;
    const healthy = await npCollectAgentHealthSummaryV1({
      client: {
        async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
          const stage = ++queryStage;
          try {
            return await client.query<T>(text, values);
          } catch (error) {
            const code = (error as { code?: unknown })?.code;
            queryFailures.push({
              stage,
              code: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : "UNKNOWN",
            });
            throw new Error("Diagnostic fixture query failed");
          }
        },
      },
    });
    expect(queryFailures).toEqual([]);
    expect(healthy.issues.filter((issue) => issue.code === "AGENT_SCHEMA_UNAVAILABLE")).toEqual([]);
    expect(healthy.issues.filter((issue) => issue.code === "AGENT_RUNTIME_DIVERGED")).toEqual([]);
    expect(healthy.states).toContainEqual(
      expect.objectContaining({ entity: "run", state: "queued", count: 1 }),
    );
    const [run] = await f.db.select().from(npAgentRuns).where(eq(npAgentRuns.id, admitted.runId));
    const sources = structuredClone(run.runtimeAdmissionSources!);
    sources.frameworkPolicyVersion += 1;
    await f.db
      .update(npAgentRuns)
      .set({ runtimeAdmissionSources: sources })
      .where(eq(npAgentRuns.id, run.id));
    const changed = await npCollectAgentHealthSummaryV1();
    expect(changed.issues).toContainEqual(
      expect.objectContaining({ code: "AGENT_RUNTIME_DIVERGED", count: 1 }),
    );
    for (const value of [
      siteId,
      run.id,
      run.agentId!,
      run.admissionFingerprint,
      "runtimeAdmissionSources",
      "frameworkPolicy",
    ])
      expect(JSON.stringify(changed)).not.toContain(value);
  });

  it.each(["known", "unsent"] as const)(
    "recognizes %s late settlement only with its exact audit receipt before deletion",
    async (settlement) => {
      const f = await runtimeUsageFixture();
      usageFixtures.push(f);
      const request = await f.request();
      await f.usage.reserve({ siteId, runId: f.runId, request });
      await f.usage.beginDispatch({ siteId, runId: f.runId, request });
      f.advance(1);
      const ambiguous: NpAgentProviderInvokeOutcomeV1 = {
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
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, ambiguous),
      });
      const originalCall = await f.call();
      // This fixture terminalizes the admitted run; AP-505 owns its future worker.
      await f.db
        .update(npAgentRuns)
        .set({
          state: "failed",
          errorCode: "PROVIDER_TIMEOUT",
          errorMessage: "Provider outcome is unavailable.",
          finishedAt: f.options.now(),
        })
        .where(eq(npAgentRuns.id, f.runId));
      await expect(npDeleteAgentSiteRows(f.db, siteId)).rejects.toThrow(
        "reconciled runtime work and usage",
      );

      const decision: NpAgentProviderTaskOutputV1 = {
        task: "interactive-capability",
        decision: { kind: "complete", summary: "Bounded provider observation." },
      };
      const outcome: NpAgentProviderInvokeOutcomeV1 =
        settlement === "known"
          ? {
              schemaVersion: "np.agent-provider-invoke-outcome.v1",
              status: "succeeded",
              provider: request.provider,
              model: request.model,
              providerRequestId: "fixture-late-request",
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
            }
          : {
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
      await f.usage.reconcile({
        siteId,
        providerCallId: request.providerCallId,
        response: await f.response(request, outcome, settlement === "known" ? decision : null),
      });
      expect(await f.call()).toMatchObject({
        state: "ambiguous",
        dispatchState: "unknown",
        responseDigest: originalCall.responseDigest,
      });
      const [reservation] = await f.db.select().from(npAgentUsageReservations);
      expect(reservation.state).toBe(settlement === "known" ? "reconciled" : "released");
      const healthy = await npCollectAgentHealthSummaryV1();
      expect(healthy.issues.filter((issue) => issue.code === "AGENT_SCHEMA_UNAVAILABLE")).toEqual(
        [],
      );
      expect(
        healthy.issues.filter(
          (issue) =>
            issue.code === "AGENT_USAGE_DIVERGED" || issue.code === "AGENT_STALE_USAGE_RESERVATION",
        ),
      ).toEqual([]);
      const removed = await f.db
        .delete(npAuditEvents)
        .where(
          and(
            eq(npAuditEvents.siteId, siteId),
            eq(npAuditEvents.targetId, request.providerCallId),
            eq(npAuditEvents.action, "agent.runtime.usage"),
            sql`${npAuditEvents.payload}->>'transition'='late-reconciled'`,
          ),
        )
        .returning();
      expect(removed).toHaveLength(1);
      expect((await npCollectAgentHealthSummaryV1()).issues).toContainEqual(
        expect.objectContaining({ code: "AGENT_USAGE_DIVERGED", count: 1 }),
      );
      await expect(npDeleteAgentSiteRows(f.db, siteId)).rejects.toThrow(
        "reconciled runtime work and usage",
      );
      const duplicate = { ...removed[0], id: randomUUID() };
      await f.db.insert(npAuditEvents).values([...removed, duplicate]);
      await expect(npDeleteAgentSiteRows(f.db, siteId)).rejects.toThrow(
        "reconciled runtime work and usage",
      );
      await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, duplicate.id));
      await npDeleteAgentSiteRows(f.db, siteId);
      expect(await npCountAgentSiteRows(f.db, siteId)).toBe(0);
    },
  );
});
