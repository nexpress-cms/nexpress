import { describe, expect, it, vi } from "vitest";
import type { NpAgentDiagnosticsQueryClientV1 } from "./contract-diagnostics.js";
import {
  npCollectAgentGuardianHealthV1,
  type NpAgentGuardianHealthProofOwnerV1,
} from "./guardian-health.js";
import { npRequireAgentGuardianHealthV1 } from "../agent-contract/guardian-health-contract.js";
import {
  npAgentGuardianOperationsSourceIdsV1,
  npAgentGuardianOperationsDetectorsV1,
} from "../agent-contract/guardian-operations-contract.js";
import {
  npRequireAgentSignalEvidenceCanonical,
  npDigestAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";

const at = "2026-10-18T00:01:00.000Z",
  id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  hash = `cj1:sha256:${"A".repeat(43)}`;
function fixture() {
  const state = {
    storage: true,
    controls: [{ site_id: "private-site-marker", configured: false, control: null }] as Record<
      string,
      unknown
    >[],
    signals: [] as Record<string, unknown>[],
    critical: [] as Record<string, unknown>[],
    failures: [] as Record<string, unknown>[],
    facts: [] as Record<string, unknown>[],
    receipts: [] as Record<string, unknown>[],
    failQuery: false,
  };
  const query = vi.fn((text: string, _values?: unknown[]) => {
    if (state.failQuery) return Promise.reject(new Error("private-query-error-marker"));
    const rows = text.includes(".storage.v1")
      ? [{ available: state.storage }]
      : text.includes(".controls.v1")
        ? state.controls
        : text.includes(".signals.v1")
          ? state.signals
          : text.includes(".critical.v1")
            ? state.critical
            : text.includes(".notifications.v1")
              ? state.failures
              : text.includes(".content-coverage.v1")
                ? state.receipts
                : text.includes(".proofs.v1")
                  ? state.facts
                  : [];
    return Promise.resolve({ rows });
  });
  const client: NpAgentDiagnosticsQueryClientV1 = {
    query: async <T extends Record<string, unknown>>(text: string, values?: unknown[]) => ({
      rows: (await query(text, values)).rows as T[],
    }),
  };
  const options = { client, now: new Date(at) };
  const fact = { id, site_id: "private-site-marker", occurred_at: new Date(at), event_hash: hash };
  const proof = {
    schemaVersion: "np.agent-guardian-verified-event.v1" as const,
    eventId: id,
    source: "sentry" as const,
    observedAt: at,
    sourceDigest: hash,
    detectorId: "guardian.external-error-created" as const,
  };
  const verifyEvent = vi.fn(() => Promise.resolve({ ...proof }));
  const owner: NpAgentGuardianHealthProofOwnerV1 = {
    source: "sentry",
    readiness: vi.fn(() => Promise.resolve("ready" as const)),
    verifyEvent,
  };
  return { state, client, query, options, fact, proof, owner, verifyEvent };
}
async function signal() {
  const canonical = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: "private-site-marker",
    detectorId: "guardian.external-error-created",
    detectorVersion: 1,
    category: "availability",
    window: { startedAt: at, endedAt: at },
    subject: null,
    evidence: [
      {
        kind: "event",
        eventId: id,
        eventKind: "security.error.signal",
        observedAt: at,
        digest: "a".repeat(64),
        excerpt: null,
      },
    ],
  });
  return {
    site_id: canonical.siteId,
    detector_id: canonical.detectorId,
    detector_version: 1,
    category: "availability",
    confidence_basis: "external",
    score_basis_points: null,
    subject: null,
    evidence: canonical.evidence,
    evidence_digest: await npDigestAgentSignalEvidenceCanonical(canonical),
    window_started_at: new Date(at),
    window_ended_at: new Date(at),
    created_at: new Date(at),
  };
}
describe("aggregate Guardian health", () => {
  it("reports known inventory and unconfigured storage separately from unavailable proof owners", async () => {
    const f = fixture(),
      result = await npCollectAgentGuardianHealthV1(f.options);
    expect(result.state).toBe("warn");
    expect(result.detectors).toHaveLength(npAgentGuardianOperationsDetectorsV1.length);
    expect(result.controls).toMatchObject({ sampledSites: 1, unconfigured: 1, invalid: 0 });
    expect(
      result.proofs.every(
        (p) =>
          p.registration === "unregistered" && p.coverage === "unavailable" && p.verified === null,
      ),
    ).toBe(true);
    expect(result.recentSignals.sampled).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private-site-marker");
  });
  it("preserves unavailable storage without inventing zero counters", async () => {
    const f = fixture();
    f.state.storage = false;
    const result = await npCollectAgentGuardianHealthV1(f.options);
    expect(result).toMatchObject({
      state: "unavailable",
      controls: { sampledSites: null },
      recentSignals: { sampled: null },
      currentCriticalIncidents: { observedCount: null },
    });
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it("reports malformed persisted controls as blocking rather than intentional disable", async () => {
    const f = fixture();
    f.state.controls.push({
      site_id: "private-other",
      configured: true,
      control: { enabled: false },
    });
    const result = await npCollectAgentGuardianHealthV1(f.options);
    expect(result.state).toBe("error");
    expect(result.controls).toMatchObject({
      sampledSites: 2,
      invalid: 1,
      disabled: 0,
      unconfigured: 1,
    });
  });
  it("checks stored enable-plan hash/site bindings, beyond their JSON shape", async () => {
    const f = fixture();
    f.state.controls = [
      {
        site_id: "private-site-marker",
        configured: true,
        control: {
          schemaVersion: "np.agent-guardian-control.v1",
          revision: 2,
          enabled: false,
          currentEnablePlan: {
            schemaVersion: "np.agent-guardian-enable-plan.v1",
            id,
            siteId: "private-site-marker",
            actorFingerprint: hash,
            revision: 2,
            controlDigest: hash,
            registrationFingerprint: hash,
            issuedAt: at,
            expiresAt: "2026-10-18T00:06:00.000Z",
            planHash: hash,
          },
          lastEnableReceipt: null,
        },
      },
    ];
    expect((await npCollectAgentGuardianHealthV1(f.options)).controls.invalid).toBe(1);
  });
  it("verifies canonical Signal integrity while keeping critical/failure counts bounded", async () => {
    const f = fixture();
    f.state.signals = [await signal()];
    f.state.critical = Array.from({ length: 26 }, () => ({ present: true }));
    f.state.failures = Array.from({ length: 26 }, () => ({ present: true }));
    const result = await npCollectAgentGuardianHealthV1(f.options);
    expect(result.recentSignals).toEqual({
      sampled: 1,
      invalid: 0,
      unsupported: 0,
      truncated: false,
    });
    expect(result.currentCriticalIncidents).toEqual({ observedCount: 25, truncated: true });
    expect(result.notificationFailures).toEqual({ observedCount: 25, truncated: true });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/private-site-marker|evidence_digest|sourceMac|eventHash|018f0f30/u);
  });
  it("rejects tampered and unsupported Signal evidence without using it as a proof claim", async () => {
    const f = fixture();
    f.state.signals = [
      { ...(await signal()), evidence_digest: `cj1:sha256:${"B".repeat(43)}` },
      { ...(await signal()), detector_version: 2 },
    ];
    expect(await npCollectAgentGuardianHealthV1(f.options)).toMatchObject({
      state: "error",
      recentSignals: { sampled: 2, invalid: 1, unsupported: 1 },
    });
  });
  it("requires an explicit ready live verifier even for verified-zero coverage", async () => {
    const f = fixture();
    f.state.facts = [f.fact];
    const result = await npCollectAgentGuardianHealthV1({ ...f.options, proofOwners: [f.owner] });
    expect(result.proofs.find((p) => p.source === "sentry")).toMatchObject({
      registration: "ready",
      coverage: "verified",
      sampled: 1,
      verified: 1,
      unverifiable: 0,
    });
    expect(f.verifyEvent).toHaveBeenCalledWith({
      siteId: "private-site-marker",
      eventId: id,
    });
    f.state.facts = [];
    const allOwners = npAgentGuardianOperationsSourceIdsV1.map((source) => ({
      ...f.owner,
      source,
    }));
    expect(
      (await npCollectAgentGuardianHealthV1({ ...f.options, proofOwners: allOwners })).state,
    ).toBe("ok");
  });
  it("reports partial/truncated proofs and rejects raw/misbound verifier metadata", async () => {
    const f = fixture();
    f.state.facts = Array.from({ length: 26 }, () => ({ ...f.fact }));
    const badOwner = {
      ...f.owner,
      verifyEvent: () => Promise.resolve({ ...f.proof, sourceMac: "private-mac-marker" }),
    };
    const result = await npCollectAgentGuardianHealthV1({ ...f.options, proofOwners: [badOwner] });
    expect(result.proofs.find((p) => p.source === "sentry")).toMatchObject({
      coverage: "partial",
      sampled: 25,
      verified: 0,
      unverifiable: 25,
      truncated: true,
    });
    expect(JSON.stringify(result)).not.toContain("private-mac-marker");
  });
  it("closes changed key readiness to unavailable after the proof sample", async () => {
    const f = fixture();
    f.state.facts = [f.fact];
    let count = 0;
    const owner = {
      ...f.owner,
      readiness: () =>
        Promise.resolve(++count === 1 ? ("ready" as const) : ("unavailable" as const)),
    };
    expect(
      (await npCollectAgentGuardianHealthV1({ ...f.options, proofOwners: [owner] })).proofs.find(
        (p) => p.source === "sentry",
      ),
    ).toMatchObject({
      coverage: "unavailable",
      sampled: null,
      verified: null,
      registration: "unavailable",
    });
  });
  it("contains raw query failures and rejects private/malformed health output", async () => {
    const f = fixture();
    f.state.failQuery = true;
    const result = await npCollectAgentGuardianHealthV1(f.options);
    expect(result.state).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private-query");
    expect(() =>
      npRequireAgentGuardianHealthV1({ ...result, siteId: "private-site-marker" }),
    ).toThrow();
    expect(() => npRequireAgentGuardianHealthV1({ ...result, state: "ok" })).toThrow();
  });
});

describe("Guardian content delivery diagnostics", () => {
  it("reports held and capped facts separately from pending delivery and proof coverage", async () => {
    const f = fixture();
    f.state.receipts = [
      { state: "held" },
      { state: "sampled" },
      ...Array.from({ length: 26 }, () => ({ state: "pending" })),
    ];
    const result = await npCollectAgentGuardianHealthV1(f.options);
    expect(result.contentReceipts).toEqual({
      pending: 25,
      blocked: 0,
      held: 1,
      sampled: 1,
      truncated: true,
    });
    expect(result.state).toBe("warn");
    expect(result.proofs.every((proof) => proof.coverage === "unavailable")).toBe(true);
  });
});
