import { describe, expect, it } from "vitest";
import {
  npAnalyzeAgentCanonicalBodyV1,
  npDigestAgentCanonicalBodyV1,
} from "./canonical-purpose-registry.js";
import {
  npAnalyzeAgentSourceReleaseCanonical,
  npDigestAgentRuntimeAdmissionKeyV1,
  npDigestAgentSourceReleaseV1,
  npRequireAgentSourceReleaseV1,
} from "./source-release-contract.js";
import type { NpAgentSourceReleaseCanonicalV1 } from "./types.js";

const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const otherId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const at = "2026-01-01T00:00:00.000Z";
const later = "2026-07-01T00:00:00.000Z";
const base = {
  schemaVersion: "np.agent-source-release.v1",
  verifierVersion: 1,
  siteId: "docs-site",
  sourceId: id,
  releasedAt: later,
} as const;
const run = {
  ...base,
  kind: "runtime-run",
  principalId: id,
  agentId: id,
  agentVersionId: id,
  admissionFingerprint: digest,
  runLimitsHash: digest,
  budgetSnapshotHash: digest,
  admissionKeyDigest: digest,
  state: "succeeded",
  finishedAt: at,
  retentionEligibleAt: later,
  deadlineAt: at,
} satisfies NpAgentSourceReleaseCanonicalV1;
const call = {
  ...base,
  kind: "provider-call",
  runId: id,
  runFingerprint: digest,
  reservationId: id,
  reservationFingerprint: digest,
  requestDigest: digest,
  responseDigest: digest,
  state: "succeeded",
  dispatchState: "dispatched",
  usageSource: "provider",
  costSource: "adapter-estimate",
  inputTokens: 12,
  cachedInputTokens: 3,
  outputTokens: 4,
  costMicros: 7,
  finishedAt: at,
  reservationFinalizedAt: at,
} satisfies NpAgentSourceReleaseCanonicalV1;
const reservation = {
  ...base,
  kind: "usage-reservation",
  runId: id,
  agentId: id,
  connectionId: id,
  model: "test-model",
  pricingId: "test-pricing",
  pricingVersion: 1,
  pricingFingerprint: `pr1:sha256:${"A".repeat(43)}`,
  pricingEffectiveAt: at,
  reservedAt: at,
  finalizedAt: at,
  state: "reconciled",
  reservedCalls: 1,
  reservedInputTokens: 20,
  reservedOutputTokens: 20,
  reservedCostMicros: 100,
  actualInputTokens: 12,
  actualCachedInputTokens: 3,
  actualOutputTokens: 4,
  actualCostMicros: 7,
  actualUsageSource: "provider",
  actualCostSource: "adapter-estimate",
  budgetChargeCostMicros: 7,
} satisfies NpAgentSourceReleaseCanonicalV1;
const breaker = {
  ...base,
  kind: "circuit-breaker",
  scopeKind: "site",
  scopeRef: "docs-site",
  version: 1,
  state: "closed",
  failureCount: 0,
  probeLeaseUntil: null,
  updatedAt: at,
} satisfies NpAgentSourceReleaseCanonicalV1;

function invalid(value: unknown) {
  expect(npAnalyzeAgentSourceReleaseCanonical(value).ok).toBe(false);
}

describe("source-release receipts", () => {
  it.each([run, call, reservation, breaker])(
    "validates exact $kind facts through the canonical registry",
    async (body) => {
      expect(npRequireAgentSourceReleaseV1(body)).toEqual(body);
      expect(npAnalyzeAgentCanonicalBodyV1("np.agent-source-release.v1", body)).toEqual({
        ok: true,
        value: body,
      });
      expect(await npDigestAgentSourceReleaseV1(body)).toBe(
        await npDigestAgentCanonicalBodyV1("np.agent-source-release.v1", body),
      );
      const reverse = Object.fromEntries(Object.entries(body).reverse());
      expect(await npDigestAgentSourceReleaseV1(reverse)).toBe(
        await npDigestAgentSourceReleaseV1(body),
      );
      for (const key of Object.keys(body)) {
        const missing: Record<string, unknown> = { ...body };
        delete missing[key];
        invalid(missing);
      }
      invalid({ ...body, unexpected: id });
      invalid({ ...body, goal: "secret" });
      invalid({ ...body, verifierVersion: 2 });
      invalid({ ...body, schemaVersion: "np.agent-source-release.v2" });
      invalid({ ...body, siteId: "INVALID SITE" });
      invalid({ ...body, sourceId: "invalid" });
      invalid({ ...body, releasedAt: "2025-01-01T00:00:00.000Z" });
    },
  );

  it("pins unknown usage, nonterminal work and contradictory settlement facts", () => {
    for (const state of ["queued", "running", "waiting_approval", "waiting_retry", "verifying"])
      invalid({ ...run, state });
    invalid({ ...run, retentionEligibleAt: "2025-12-31T00:00:00.000Z" });
    invalid({ ...call, usageSource: "unknown" });
    invalid({ ...call, costSource: null });
    invalid({ ...call, dispatchState: "ambiguous" });
    invalid({ ...call, dispatchState: "not-dispatched" });
    invalid({ ...call, cachedInputTokens: 13 });
    invalid({ ...call, costMicros: Number.MAX_SAFE_INTEGER + 1 });
    invalid({ ...call, inputTokens: 0.5 });
    invalid({ ...reservation, state: "expired" });
    invalid({ ...reservation, actualUsageSource: "unknown" });
    invalid({ ...reservation, budgetChargeCostMicros: 8 });
    invalid({ ...reservation, actualCachedInputTokens: 13 });
    invalid({ ...reservation, pricingEffectiveAt: later });
    invalid({ ...reservation, reservedCalls: 0 });
    invalid({ ...reservation, unpriced: true });
    invalid({ ...breaker, state: "open" });
    invalid({ ...breaker, failureCount: 1 });
    invalid({ ...breaker, probeLeaseUntil: later });
    invalid({ ...breaker, scopeRef: "other-site" });
    invalid({ ...breaker, scopeKind: "subject", scopeRef: "short" });
  });

  it("preserves proven non-dispatch null facts instead of converting unknown usage to zero", () => {
    const nonDispatch = {
      ...call,
      state: "failed",
      dispatchState: "not-dispatched",
      usageSource: null,
      costSource: null,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      costMicros: null,
    };
    expect(npRequireAgentSourceReleaseV1(nonDispatch)).toEqual(nonDispatch);
    invalid({ ...nonDispatch, costMicros: 0 });
    invalid({ ...nonDispatch, state: "succeeded" });
    const released = {
      ...reservation,
      state: "released",
      actualInputTokens: null,
      actualCachedInputTokens: null,
      actualOutputTokens: null,
      actualCostMicros: null,
      actualUsageSource: null,
      actualCostSource: null,
      budgetChargeCostMicros: 0,
    };
    expect(npRequireAgentSourceReleaseV1(released)).toEqual(released);
    invalid({ ...released, actualCostMicros: 0 });
    invalid({ ...released, budgetChargeCostMicros: 1 });
  });

  it("rejects oversized, non-data and noncanonical input without invoking getters", () => {
    invalid({ ...run, goal: "x".repeat(16 * 1024) });
    invalid({ ...run, releasedAt: "2026-07-01T00:00:00Z" });
    invalid({ ...run, finishedAt: "2026-02-30T00:00:00.000Z" });
    let reads = 0;
    const getter = { ...run };
    Object.defineProperty(getter, "kind", {
      enumerable: true,
      get() {
        reads += 1;
        return "runtime-run";
      },
    });
    invalid(getter);
    expect(reads).toBe(0);
    invalid(Object.assign(Object.create(null), run));
    invalid({ ...run, [Symbol("extra")]: true });
  });

  it("binds receipt digest to identity, provenance and release time", async () => {
    const original = await npDigestAgentSourceReleaseV1(call);
    for (const changed of [
      { ...call, sourceId: otherId },
      { ...call, reservationFingerprint: `cj1:sha256:${"B".repeat(43)}` },
      { ...call, costSource: "provider" },
      { ...call, releasedAt: "2026-07-02T00:00:00.000Z" },
    ])
      expect(await npDigestAgentSourceReleaseV1(changed)).not.toBe(original);
  });
});

describe("consumed Runtime admission key", () => {
  const scope = { siteId: "docs-site", principalId: id, idempotencyKey: "request:1" };
  it("uses stable domain-separated exact site/principal/runtime/key scope", async () => {
    const original = await npDigestAgentRuntimeAdmissionKeyV1(scope);
    expect(original).toBe("cj1:sha256:KEQ97x6QTlu7yjUBMdSNejnawWqtutHJCU1253KBZQI");
    expect(await npDigestAgentRuntimeAdmissionKeyV1({ ...scope })).toBe(original);
    for (const changed of [
      { ...scope, siteId: "other-site" },
      { ...scope, principalId: otherId },
      { ...scope, idempotencyKey: "request:2" },
    ])
      expect(await npDigestAgentRuntimeAdmissionKeyV1(changed)).not.toBe(original);
    expect(original).not.toContain(scope.idempotencyKey);
  });
  it("rejects out-of-scope and unsafe key input", async () => {
    await expect(
      npDigestAgentRuntimeAdmissionKeyV1({ ...scope, idempotencyKey: "a b" }),
    ).rejects.toThrow();
    await expect(
      npDigestAgentRuntimeAdmissionKeyV1({ ...scope, idempotencyKey: "a".repeat(257) }),
    ).rejects.toThrow();
    const extra = { ...scope, origin: "gateway" };
    await expect(npDigestAgentRuntimeAdmissionKeyV1(extra)).rejects.toThrow();
  });
});
