import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentProviderCalls,
  npAgentRuns,
  npAgentSourceReleases,
  npAgentUsageDaily,
  npAgentUsageReservations,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { npDigestAgentProviderResponseCanonical } from "../../../packages/core/src/agent-contract/canonical-provider.js";
import { npRequireAgentSourceReleaseRecordV1 } from "../../../packages/core/src/agent/source-release-read.js";
import { npRequireAgentRuntimeProviderDecisionV1 } from "../../../packages/core/src/agent/runtime-provider-evidence.js";
import type { NpAgentProviderInvokeOutcomeV1 } from "../../../packages/core/src/agent-contract/types.js";
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
const day = 86_400_000;
async function fixture() {
  const f = await runtimeUsageFixture();
  fixtures.push(f);
  return f;
}
async function settled(f: Fixture, ambiguous = false) {
  const request = await f.request();
  await f.usage.reserve({ siteId, runId: f.runId, request });
  await f.usage.beginDispatch({ siteId, runId: f.runId, request });
  f.advance(1);
  const outcome: NpAgentProviderInvokeOutcomeV1 = ambiguous
    ? {
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
      }
    : {
        schemaVersion: "np.agent-provider-invoke-outcome.v1",
        status: "succeeded",
        provider: request.provider,
        model: request.model,
        providerRequestId: "retention-fixture",
        output: {
          task: "interactive-capability",
          decision: { kind: "complete", summary: "Observed." },
        },
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
  const response = await f.response(request, outcome, outcome.output);
  await f.usage.reconcile({ siteId, providerCallId: request.providerCallId, response });
  return { request, response };
}
async function finish(f: Fixture, unresolved = false) {
  const store = createAgentRuntimeExecutionStoreV1({ admission: f.admission, now: f.options.now });
  if (unresolved) return store.cancel({ siteId, runId: f.runId });
  const { claim } = await store.claim({ siteId, runId: f.runId });
  if (!claim) throw new Error("Expected live fixture claim");
  return store.transition({ siteId, runId: f.runId, claim, state: "succeeded" });
}

describe.skipIf(skipIfNoTestDb())("Runtime provider and aggregate retention", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(async () => {
    for (const f of fixtures.splice(0)) await f.dispose();
  });
  afterAll(closeTestDb);

  it("expires only optional diagnostics at the deadline while preserving active execution evidence", async () => {
    const f = await fixture();
    const { response } = await settled(f);
    const expires = new Date(f.options.now().getTime() + day);
    await f.db.update(npAgentProviderCalls).set({
      requestRedacted: { summary: "private request" },
      responseRedacted: { summary: "private response" },
      diagnosticExpiresAt: expires,
    });
    expect(
      await pruneAgentRuntimeEventsV1({ siteId, now: new Date(expires.getTime() - 1) }),
    ).toEqual({ examined: 0, pruned: 0, nextCursor: null });
    expect(await pruneAgentRuntimeEventsV1({ siteId, now: expires })).toEqual({
      examined: 1,
      pruned: 1,
      nextCursor: null,
    });
    const call = await f.call();
    expect(call).toMatchObject({
      requestRedacted: null,
      responseRedacted: null,
      responseDigest: await npDigestAgentProviderResponseCanonical(response),
    });
    expect(await npRequireAgentRuntimeProviderDecisionV1(call)).toEqual(response.decision);
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(1);
  });

  it("caps diagnostics at 30 days even when their stored deadline is longer", async () => {
    const f = await fixture();
    await settled(f);
    const call = await f.call();
    await f.db.update(npAgentProviderCalls).set({
      requestRedacted: { summary: "diagnostic" },
      diagnosticExpiresAt: new Date(call.createdAt.getTime() + 60 * day),
    });
    expect(
      await pruneAgentRuntimeEventsV1({
        siteId,
        now: new Date(call.createdAt.getTime() + 30 * day),
      }),
    ).toMatchObject({ pruned: 1 });
    expect((await f.call()).requestRedacted).toBeNull();
  });

  it("releases settled sources after terminal retention while preserving actual audit", async () => {
    const f = await fixture();
    await settled(f);
    const now = new Date(f.options.now().getTime() + 401 * day);
    expect(await pruneAgentRuntimeEventsV1({ siteId, now })).toEqual({
      examined: 0,
      pruned: 0,
      nextCursor: null,
    });
    await finish(f);
    const audit = await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id);
    const result = await pruneAgentRuntimeEventsV1({ siteId, now });
    expect(result.pruned).toBe(3);
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(0);
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(0);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
    const receipts = await f.db.select().from(npAgentSourceReleases);
    expect(receipts).toHaveLength(3);
    for (const receipt of receipts)
      await expect(npRequireAgentSourceReleaseRecordV1(receipt)).resolves.toMatchObject({ siteId });
    expect(receipts.map((row) => row.sourceKind).sort()).toEqual([
      "provider-call",
      "runtime-run",
      "usage-reservation",
    ]);
    expect(await f.db.select().from(npAuditEvents).orderBy(npAuditEvents.id)).toEqual(audit);
    expect(await f.db.select().from(npAgentUsageDaily)).toHaveLength(1);
    expect((await pruneAgentRuntimeEventsV1({ siteId, now })).pruned).toBe(1);
    expect(await f.db.select().from(npAgentUsageDaily)).toHaveLength(0);
    await expect(f.admission.admit(f.runInput)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(
      f.admission.admit({ ...f.runInput, goal: "Changed historical request" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("pins a finalized reservation when its call disappeared without a release receipt", async () => {
    const f = await fixture();
    const { request } = await settled(f);
    await finish(f);
    // Deliberately model incomplete legacy evidence, never the positive cleanup path.
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.targetId, request.providerCallId));
    await f.db
      .delete(npAgentProviderCalls)
      .where(eq(npAgentProviderCalls.id, request.providerCallId));
    await pruneAgentRuntimeEventsV1({
      siteId,
      now: new Date(f.options.now().getTime() + 401 * day),
    });
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(1);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(1);
    expect(await f.db.select().from(npAgentSourceReleases)).toHaveLength(0);
  });

  it("retains ambiguous outcomes and unresolved usage regardless of nominal age", async () => {
    const f = await fixture();
    await settled(f, true);
    await finish(f, true);
    f.advance(61);
    await f.usage.expire({ siteId });
    const now = new Date(f.options.now().getTime() + 401 * day);
    await pruneAgentRuntimeEventsV1({ siteId, now });
    expect(await f.db.select().from(npAgentProviderCalls)).toHaveLength(1);
    expect(await f.db.select().from(npAgentUsageReservations)).toHaveLength(1);
    const daily = await f.db.select().from(npAgentUsageDaily);
    expect(daily).toHaveLength(1);
    expect(daily[0]?.unknownCalls).toBe(1);
  });
});
