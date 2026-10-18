import { describe, expect, it } from "vitest";
import {
  createAgentGuardianActorProjectionV1,
  NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1,
} from "../agent/guardian-actor-projection.js";
import {
  NP_AGENT_GUARDIAN_HTTP_ACTIVITY_HASH_DOMAIN_V1,
  NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1,
  NP_AGENT_GUARDIAN_HTTP_SOURCE_MAC_DOMAIN_V1,
  npEvaluateAgentGuardianHttpRulesV1,
  npRequireAgentGuardianHttpActivityV1,
  npRequireAgentGuardianHttpEventPayloadV1,
  npRequireAgentGuardianHttpEvidenceV1,
  npRequireAgentGuardianHttpSourceReceiptV1,
  type NpAgentGuardianHttpActivityV1,
  type NpAgentGuardianHttpStatusV1,
} from "./guardian-http-contract.js";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const startedAt = "2026-10-18T00:00:00.000Z";
const projection = createAgentGuardianActorProjectionV1({
  id: "synthetic-http-key-1",
  bytes: new Uint8Array(32).fill(41),
});
const digest = `cj1:sha256:${"D".repeat(43)}`;
function activity(
  index: number,
  status: NpAgentGuardianHttpStatusV1 = 401,
): NpAgentGuardianHttpActivityV1 {
  return {
    schemaVersion: "np.agent-guardian-http-activity.v1",
    observationId: id(index),
    siteId: "default",
    occurredAt: new Date(Date.parse(startedAt) + index * 1000).toISOString(),
    status,
    routeFamily: "admin",
    networkBucket: {
      ...projection.project({ siteId: "default", purpose: "network-address", value: "192.0.2.41" }),
      purpose: "network-address",
      projectionVersion: 1,
    },
  };
}
function evaluate(activities: NpAgentGuardianHttpActivityV1[]) {
  return npEvaluateAgentGuardianHttpRulesV1({
    siteId: "default",
    windowStartedAt: startedAt,
    activities,
  });
}
const cohort = () => Array.from({ length: 5 }, (_, index) => activity(index + 1));

describe("Guardian final HTTP response contract", () => {
  it.each([401, 403, 404] as const)(
    "accepts final status %i without inventing an attack verdict",
    (status) => {
      const source = activity(1, status);
      expect(npRequireAgentGuardianHttpActivityV1(source)).toEqual(source);
      expect(source.networkBucket.projectionFingerprint).toBe(
        NP_AGENT_GUARDIAN_ACTOR_PROJECTION_FINGERPRINT_V1,
      );
      expect(
        npRequireAgentGuardianHttpEventPayloadV1({
          kind: "http.response.observed",
          receiptId: source.observationId,
          activity: source,
        }),
      ).toMatchObject({ activity: { status }, receiptId: source.observationId });
      const match = evaluate(cohort().map((entry) => ({ ...entry, status })))[0];
      const { observationIds: _ids, networkBucket: _bucket, ...safe } = match;
      expect(
        npRequireAgentGuardianHttpEvidenceV1({
          schemaVersion: "np.agent-guardian-http-evidence.v1",
          signalId: id(200),
          sourceDigest: digest,
          ...safe,
        }),
      ).toMatchObject({
        status,
        observedCount: 5,
        countBasis: "at-least",
        assessment: "review-only",
      });
    },
  );

  it("rejects raw request identities, unknown status/family and other projection purposes", () => {
    const source = activity(1);
    for (const extra of [
      "path",
      "query",
      "body",
      "ip",
      "userId",
      "error",
      "severity",
      "approvalId",
    ])
      expect(() =>
        npRequireAgentGuardianHttpActivityV1({ ...source, [extra]: "private-value" }),
      ).toThrow();
    for (const status of [200, 400, 402, 405, 429, 500, "401", NaN, 401.5])
      expect(() => npRequireAgentGuardianHttpActivityV1({ ...source, status })).toThrow();
    for (const routeFamily of ["/api/admin/private", "admin?token=private", "unknown", "*"])
      expect(() => npRequireAgentGuardianHttpActivityV1({ ...source, routeFamily })).toThrow();
    for (const patch of [
      { purpose: "login-identifier" },
      { purpose: "staff-principal" },
      { projectionVersion: 2 },
      { projectionFingerprint: digest },
      { bucket: "192.0.2.41" },
      { bucket: `${source.networkBucket.bucket}=` },
    ])
      expect(() =>
        npRequireAgentGuardianHttpActivityV1({
          ...source,
          networkBucket: { ...source.networkBucket, ...patch },
        }),
      ).toThrow();
  });

  it("binds exact receipt UUIDs and keeps stored audit metadata free of the network bucket", () => {
    const source = activity(1);
    expect(() =>
      npRequireAgentGuardianHttpEventPayloadV1({
        kind: "http.response.observed",
        receiptId: id(2),
        activity: source,
      }),
    ).toThrow();
    const receipt = {
      schemaVersion: "np.agent-guardian-http-receipt.v1",
      siteId: source.siteId,
      receiptId: source.observationId,
      keyId: "synthetic-receipt-key-1",
      eventId: id(100),
      eventHash: digest,
      bodyHash: digest,
      recordedAt: source.occurredAt,
      sourceMac: `hmac-sha256:${"M".repeat(43)}`,
    };
    // Shape acceptance is deliberately not a MAC-authenticity claim.
    expect(npRequireAgentGuardianHttpSourceReceiptV1(receipt)).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toContain(source.networkBucket.bucket);
    expect(() =>
      npRequireAgentGuardianHttpSourceReceiptV1({ ...receipt, activity: source }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianHttpSourceReceiptV1({
        ...receipt,
        networkBucket: source.networkBucket,
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianHttpSourceReceiptV1({ ...receipt, sourceMac: "unverified" }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianHttpSourceReceiptV1({ ...receipt, recordedAt: "2026-10-18T00:00:01Z" }),
    ).toThrow();
    expect(NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1).toBe("guardian.http.v1");
    expect(NP_AGENT_GUARDIAN_HTTP_ACTIVITY_HASH_DOMAIN_V1).not.toBe(
      NP_AGENT_GUARDIAN_HTTP_SOURCE_MAC_DOMAIN_V1,
    );
  });

  it("requires five distinct final responses and never counts a replay twice", () => {
    expect(evaluate(cohort().slice(0, 4))).toEqual([]);
    expect(evaluate(Array.from({ length: 5 }, () => activity(1)))).toEqual([]);
    const original = cohort();
    expect(evaluate([...original, activity(1)])).toEqual(evaluate(original));
    expect(() => evaluate([...original, { ...activity(1), status: 403 }])).toThrow();
  });

  it("partitions status, closed family, network identity and historical key identity", () => {
    const original = cohort();
    for (const patch of [
      { status: 403 as const },
      { routeFamily: "mcp" as const },
      { networkBucket: { ...original[0].networkBucket, bucket: "X".repeat(43) } },
      { networkBucket: { ...original[0].networkBucket, keyId: "synthetic-old-key" } },
    ])
      expect(evaluate([...original.slice(0, 4), { ...original[4], ...patch }])).toEqual([]);
    expect(
      evaluate([
        ...original,
        ...original.map((entry, index) => ({
          ...entry,
          networkBucket: { ...entry.networkBucket },
          observationId: id(index + 20),
          status: 404 as const,
        })),
      ]),
    ).toHaveLength(2);
  });

  it("freezes a deterministic first-five lower-count cohort without rewriting its inputs", () => {
    const original = [...cohort(), activity(6)],
      before = structuredClone(original);
    const expected = evaluate(original);
    expect(evaluate([...original].reverse())).toEqual(expected);
    expect(expected[0]).toMatchObject({
      observationIds: [1, 2, 3, 4, 5].map(id),
      observedCount: 5,
      window: { startedAt, endedAt: activity(5).occurredAt },
    });
    expect(original).toEqual(before);
  });

  it("rejects mixed sites, sliding windows, boundary crossing and a site flood beyond the cap", () => {
    expect(() =>
      evaluate([...cohort().slice(0, 4), { ...activity(5), siteId: "other-site" }]),
    ).toThrow();
    expect(() =>
      npEvaluateAgentGuardianHttpRulesV1({
        siteId: "default",
        windowStartedAt: activity(1).occurredAt,
        activities: cohort(),
      }),
    ).toThrow();
    for (const occurredAt of ["2026-10-17T23:59:59.999Z", "2026-10-18T00:10:00.000Z"])
      expect(() => evaluate([...cohort().slice(0, 4), { ...activity(5), occurredAt }])).toThrow();
    expect(evaluate(Array.from({ length: 100 }, (_, index) => activity(index + 1)))).toHaveLength(
      1,
    );
    expect(() =>
      evaluate(Array.from({ length: 101 }, (_, index) => activity(index + 1))),
    ).toThrow();
  });

  it("accepts only the bounded review projection with canonical times and no private source fields", () => {
    const { observationIds: _ids, networkBucket: _bucket, ...match } = evaluate(cohort())[0];
    const evidence = {
      schemaVersion: "np.agent-guardian-http-evidence.v1",
      signalId: id(200),
      sourceDigest: digest,
      ...match,
    };
    for (const extra of [
      "networkBucket",
      "observationIds",
      "receiptId",
      "userId",
      "path",
      "severity",
      "approval",
    ])
      expect(() =>
        npRequireAgentGuardianHttpEvidenceV1({ ...evidence, [extra]: "private-value" }),
      ).toThrow();
    for (const patch of [
      { assessment: "attack" },
      { observedCount: 4 },
      { observedCount: 6 },
      { countBasis: "exact" },
      { sourceDigest: "unbound" },
      { detectorVersion: 2 },
    ])
      expect(() => npRequireAgentGuardianHttpEvidenceV1({ ...evidence, ...patch })).toThrow();
    expect(() =>
      npRequireAgentGuardianHttpEvidenceV1({
        ...evidence,
        window: { startedAt, endedAt: "2026-10-18T00:10:00.000Z" },
      }),
    ).toThrow();
  });
});
