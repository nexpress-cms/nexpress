import { beforeEach, describe, expect, it, vi } from "vitest";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "../agent-contract/runtime-contract.js";
import type { NpAgentPolicyResolutionInputV1 } from "../agent-contract/runtime-policy.js";
import type { NpAgentAutomaticGuardianLimitDeploymentV1 } from "../agent-contract/automatic-guardian-limit-contract.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import type { NpAgentGuardianEvidenceV1 } from "../agent-contract/guardian-contract.js";
import type { NpAgentSignalEvidenceCanonicalV1 } from "../agent-contract/types.js";
import { npAgentIncidents, npAgentIncidentTimeline, npAgentSignals } from "../db/schema/agent.js";
import {
  createAgentAutomaticGuardianLimitAuthorityV1,
  npIsAgentAutomaticGuardianLimitAuthorityV1,
  npIsAgentAutomaticGuardianLimitAuthorizationV1,
  type NpAgentAutomaticGuardianLimitAuthorizeInputV1,
} from "./automatic-guardian-limit-service.js";
const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  signal: vi.fn(),
  escalation: vi.fn(),
  rows: vi.fn(),
  event: vi.fn(),
  brand: vi.fn(),
  verifyEvent: vi.fn(),
  verifySignal: vi.fn(),
}));
vi.mock("./guardian-observation-service.js", () => ({
  npReadAgentGuardianIncidentEvidenceV1: mocks.source,
  npIsAgentGuardianAuthenticatedRequestSourceV1: mocks.brand,
}));
vi.mock("./incident-service.js", () => ({ npReadAgentIncidentSignalEvidenceV1: mocks.signal }));
vi.mock("./incident-severity-evidence.js", () => ({
  npRequireIncidentSeverityEvidence: mocks.escalation,
}));
vi.mock("./event-evidence.js", () => ({
  npReadAgentEventRowsV1: mocks.rows,
  npReadAgentEventRowEvidenceV1: mocks.event,
}));
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const digest = `cj1:sha256:${"A".repeat(43)}`;
const date = (minute: number) =>
  new Date(`2026-10-18T00:${minute.toString().padStart(2, "0")}:00.000Z`);
function fixture() {
  const deployment: NpAgentAutomaticGuardianLimitDeploymentV1 = {
    schemaVersion: "np.agent-automatic-guardian-limit-deployment.v1",
    policyId: "reviewed-auth-limit",
    policyVersion: 1,
    siteId: "default",
    principalIds: [id(1)],
    rule: {
      kind: "staff-escalated-auth-rule.v1",
      detectorId: "guardian.login-failures",
      detectorVersion: 1,
      minimumSeverity: "high",
      maximumEvidenceAgeSeconds: 600,
      maximumEscalationAgeSeconds: 600,
    },
    actionScopes: ["auth.member", "auth.staff"],
    limits: { restrictionSeconds: 300, actionsPerHour: 5, activeRestrictions: 5 },
    qualification: {
      source: "production-human-review",
      policyVersion: 1,
      reviewArtifactDigest: digest,
      legitimateImpactReviewArtifactDigest: digest,
      shadowArtifactDigest: digest,
      shadowStartedAt: "2026-09-01T00:00:00.000Z",
      shadowEndedAt: "2026-09-15T00:00:00.000Z",
      compensationTestArtifactDigest: digest,
    },
    issuedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-30T00:00:00.000Z",
  };
  const subject = {
    kind: "actor-bucket" as const,
    purpose: "network-address" as const,
    projectionVersion: 1,
    projectionFingerprint: digest,
    keyId: "auth-key-v1",
    bucket: "A".repeat(43),
  };
  const incident: NpAgentIncidentV1 = {
    version: "np.agent-incident.v1",
    id: id(2),
    siteId: "default",
    fingerprint: digest,
    category: "authentication",
    severity: "high",
    status: "open",
    title: "Repeated login failures",
    summary: "Staff reviewed the observations.",
    primarySubject: subject,
    assignedAgentId: null,
    signalIds: [id(3)],
    eventCount: 5,
    firstObservedAt: date(0).toISOString(),
    lastObservedAt: date(1).toISOString(),
    containedAt: null,
    resolvedAt: null,
    resolutionCode: null,
    versionNumber: 2,
    createdAt: date(1).toISOString(),
    updatedAt: date(2).toISOString(),
  };
  const stored = { ...incident, signalCount: 1, updatedAt: date(2) };
  const evidence: NpAgentGuardianEvidenceV1 = {
    schemaVersion: "np.agent-guardian-evidence.v1",
    signalId: id(3),
    detectorId: "guardian.login-failures",
    audience: "staff",
    routeFamily: null,
    window: { startedAt: date(0).toISOString(), endedAt: date(1).toISOString() },
    observedCount: 5,
    threshold: 5,
    countBasis: "at-least",
  };
  const canonical: NpAgentSignalEvidenceCanonicalV1 = {
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: "default",
    detectorId: "guardian.login-failures",
    detectorVersion: 1,
    category: "authentication",
    subject: { ...subject },
    window: { ...evidence.window },
    evidence: [10, 11, 12, 13, 14].map((n) => ({
      kind: "event",
      eventId: id(n),
      eventKind: "auth.login.failed",
      observedAt: date(1).toISOString(),
      digest: "a".repeat(64),
      excerpt: null,
    })),
  };
  const signal = {
    id: id(3),
    siteId: "default",
    incidentId: incident.id,
    status: "attached",
    fingerprint: digest,
    detectorId: "guardian.login-failures",
    detectorVersion: 1,
    severity: "medium",
    confidenceBasis: "exact-rule",
    scoreBasisPoints: null,
    createdAt: date(1),
    updatedAt: date(1),
    evidenceDigest: digest,
  };
  const currentSignal = { ...signal };
  const entry = {
    id: id(4),
    siteId: "default",
    incidentId: incident.id,
    sequence: 2,
    kind: "human_note",
    sourceKind: "staff",
    sourceId: id(5),
    sourceFingerprint: digest,
    eventId: null,
    signalId: null,
    runId: null,
    actionId: null,
    approvalId: null,
    providerCallId: null,
    auditEventId: id(6),
    summary: "Escalated",
    details: {
      schemaVersion: "np.agent-incident-severity-entry.v1",
      invocationId: id(7),
      transitionVersion: 2,
      fromSeverity: "medium",
      toSeverity: "high",
      severity: "high",
      status: "open",
      note: "Private staff note",
    },
    createdAt: date(2),
  } satisfies typeof npAgentIncidentTimeline.$inferSelect;
  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.capabilityModes = [{ capabilityId: "security.limitActor", mode: "guarded" }];
  rules.risk = {
    automaticActionMaximum: "reversible",
    requirePreviewAtOrAbove: null,
    requireRecentAuthAtOrAbove: null,
  };
  rules.automation.guardianLimitActorMinSeverity = "high";
  rules.automation.guardianRestrictionTtlSeconds = 300;
  const policy: NpAgentPolicyResolutionInputV1 = {
    autonomy: "guarded",
    capabilityModes: [...rules.capabilityModes],
    layers: [rules],
  };
  const verifyDeployment = vi.fn(() => Promise.resolve(true)),
    resolvePolicy = vi.fn(() => Promise.resolve(policy)),
    forLock = vi.fn();
  let signalReads = 0;
  const select = vi.fn(() => ({
    from(table: unknown) {
      const builder = {
        where: () => builder,
        orderBy: () => builder,
        for: (mode: string) => {
          forLock(table, mode);
          return builder;
        },
        limit: () =>
          Promise.resolve(
            table === npAgentSignals
              ? [signalReads++ === 0 ? signal : currentSignal]
              : table === npAgentIncidentTimeline
                ? [entry]
                : table === npAgentIncidents
                  ? [stored]
                  : [],
          ),
      };
      return builder;
    },
  }));
  const db = {
    select,
    // Structural driver owner only for the closed-scope facade. These component
    // queries remain explicit stubs; actual PG tests prove transaction lifetime.
    session: { client: { query: vi.fn() } },
  } as unknown as NpAgentAutomaticGuardianLimitAuthorizeInputV1["db"];
  // Existing authenticated source/escalation readers are stubbed in these component
  // units. No test here establishes real database provenance or production qualification.
  mocks.source.mockResolvedValue([evidence]);
  mocks.signal.mockImplementation(() => Promise.resolve(canonical));
  mocks.escalation.mockImplementation(() =>
    Promise.resolve({
      fromSeverity: entry.details.fromSeverity,
      toSeverity: entry.details.toSeverity,
      note: entry.details.note,
    }),
  );
  mocks.rows.mockResolvedValue([10, 11, 12, 13, 14].map((n) => ({ id: id(n), eventHash: digest })));
  mocks.event.mockImplementation((row: { id: string }) =>
    Promise.resolve({
      observationId: row.id,
      kind:
        canonical.detectorId === "guardian.login-failures"
          ? "auth.login.failed"
          : "api.rate-limited",
      occurredAt: date(1).toISOString(),
    }),
  );
  const input: NpAgentAutomaticGuardianLimitAuthorizeInputV1 = {
    db,
    siteId: "default",
    principalId: id(1),
    incident,
    signalId: id(3),
    now: date(3),
  };
  const requestObservations = { verifyEvent: mocks.verifyEvent, verifySignal: mocks.verifySignal };
  mocks.brand.mockImplementation((value: unknown) => value === requestObservations);
  mocks.verifySignal.mockResolvedValue(true);
  mocks.verifyEvent.mockImplementation(({ eventId }: { eventId: string }) =>
    Promise.resolve({
      schemaVersion: "np.agent-guardian-verified-event.v1",
      eventId,
      source: "requests",
      observedAt: date(1).toISOString(),
      sourceDigest: digest,
      detectorId: null,
    }),
  );
  const install = () =>
    createAgentAutomaticGuardianLimitAuthorityV1({
      deployment,
      requestObservations,
      verifyDeployment,
      resolvePolicy,
    });
  return {
    deployment,
    incident,
    stored,
    evidence,
    canonical,
    signal,
    currentSignal,
    entry,
    rules,
    policy,
    verifyDeployment,
    resolvePolicy,
    select,
    forLock,
    input,
    install,
    requestObservations,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("automatic Guardian limit host authority and policy composition", () => {
  it("copies an inert branded deployment and rejects JSON-shaped authority", () => {
    const f = fixture(),
      owner = f.install();
    expect(f.select).not.toHaveBeenCalled();
    expect(f.verifyDeployment).not.toHaveBeenCalled();
    expect(f.resolvePolicy).not.toHaveBeenCalled();
    f.deployment.limits.restrictionSeconds = 900;
    expect(owner.deployment.limits.restrictionSeconds).toBe(300);
    expect(Object.isFrozen(owner.deployment.rule)).toBe(true);
    expect(npIsAgentAutomaticGuardianLimitAuthorityV1(owner)).toBe(true);
    expect(npIsAgentAutomaticGuardianLimitAuthorityV1({ ...owner })).toBe(false);
    expect(npIsAgentAutomaticGuardianLimitAuthorizationV1({ enabled: true })).toBe(false);
  });
  it.each(["missing-approval", "wrong-site", "wrong-principal", "expired"])(
    "blocks %s before source reads",
    async (part) => {
      const f = fixture(),
        owner = f.install();
      if (part === "missing-approval") f.verifyDeployment.mockResolvedValue(false);
      const input = {
        ...f.input,
        ...(part === "wrong-site" ? { siteId: "other" } : {}),
        ...(part === "wrong-principal" ? { principalId: id(99) } : {}),
        ...(part === "expired" ? { now: new Date(f.deployment.expiresAt) } : {}),
      };
      await expect(owner.authorize(input)).rejects.toMatchObject({
        code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
      });
      expect(f.select).not.toHaveBeenCalled();
    },
  );
  it("issues only exact frozen live proof and preserves the medium source/staff-high distinction", async () => {
    const f = fixture(),
      proof = await f.install().authorize(f.input);
    expect(proof).toMatchObject({
      sourceBaselineSeverity: "medium",
      observedCount: 5,
      countBasis: "at-least",
      incidentSeverity: "high",
      actionScopes: ["auth.staff"],
      staffEscalation: {
        timelineEntryId: id(4),
        transitionVersion: 2,
        fromSeverity: "medium",
        toSeverity: "high",
      },
      expiresAt: date(8).toISOString(),
    });
    expect(npIsAgentAutomaticGuardianLimitAuthorizationV1(proof)).toBe(true);
    expect(npIsAgentAutomaticGuardianLimitAuthorizationV1(structuredClone(proof))).toBe(false);
    expect(Object.isFrozen(proof.staffEscalation)).toBe(true);
    expect(JSON.stringify(proof)).not.toContain("Private staff note");
    expect(f.resolvePolicy).toHaveBeenCalledTimes(2);
    expect(f.verifyDeployment).toHaveBeenCalledTimes(2);
    expect(f.forLock.mock.calls.map(([table]) => table)).toEqual([
      npAgentIncidents,
      npAgentSignals,
    ]);
  });
  it.each([
    "medium",
    "source-high",
    "stale-source",
    "stale-escalation",
    "future",
    "unverified-staff",
    "system-escalation",
    "after-review-source",
  ])("blocks %s without inventing source-high proof", async (part) => {
    const f = fixture();
    if (part === "medium") {
      f.incident.severity = "medium";
      f.stored.severity = "medium";
    }
    if (part === "source-high") f.signal.severity = "high";
    if (part === "stale-source") f.input.now = date(11);
    if (part === "stale-escalation") {
      f.deployment.rule.maximumEscalationAgeSeconds = 60;
      f.input.now = new Date(date(3).getTime() + 1);
    }
    if (part === "future") f.entry.createdAt = date(4);
    if (part === "unverified-staff")
      mocks.escalation.mockRejectedValue(new Error("Invalid persisted staff proof"));
    if (part === "system-escalation") f.entry.sourceKind = "system";
    if (part === "after-review-source") f.signal.createdAt = date(3);
    await expect(f.install().authorize(f.input)).rejects.toMatchObject({
      code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
    });
  });
  it("requires the actual signed-source factory brand at installation", () => {
    const f = fixture();
    mocks.brand.mockReturnValue(false);
    expect(() => f.install()).toThrowError(
      expect.objectContaining({ code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED" }),
    );
    expect(f.select).not.toHaveBeenCalled();
  });
  it.each(["unsigned-signal", "key-loss", "wrong-id", "wrong-time", "wrong-hash", "other-source"])(
    "blocks signed source failure %s",
    async (part) => {
      const f = fixture();
      if (part === "unsigned-signal") mocks.verifySignal.mockResolvedValue(false);
      else if (part === "key-loss")
        mocks.verifyEvent.mockRejectedValue(new Error("KEY_UNAVAILABLE"));
      else
        mocks.verifyEvent.mockImplementation(({ eventId }: { eventId: string }) =>
          Promise.resolve({
            schemaVersion: "np.agent-guardian-verified-event.v1",
            eventId: part === "wrong-id" ? id(99) : eventId,
            source: part === "other-source" ? "http" : "requests",
            observedAt: part === "wrong-time" ? date(0).toISOString() : date(1).toISOString(),
            sourceDigest: part === "wrong-hash" ? `cj1:sha256:${"B".repeat(43)}` : digest,
            detectorId: null,
          }),
        );
      await expect(f.install().authorize(f.input)).rejects.toMatchObject({
        code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
      });
    },
  );
  it.each([
    "observe",
    "advise",
    "approved",
    "read-risk",
    "null-floor",
    "critical-floor",
    "scope",
    "category",
    "quiet",
    "preview",
    "recent-auth",
  ])("honors policy denial %s", async (part) => {
    const f = fixture();
    if (part === "observe" || part === "advise" || part === "approved")
      f.rules.capabilityModes[0].mode = part;
    if (part === "read-risk") f.rules.risk.automaticActionMaximum = "read";
    if (part === "null-floor") f.rules.automation.guardianLimitActorMinSeverity = null;
    if (part === "critical-floor") f.rules.automation.guardianLimitActorMinSeverity = "critical";
    if (part === "scope") f.rules.resources.actorRestrictionScopes = ["auth.member"];
    if (part === "category") f.rules.resources.incidentCategories = ["traffic"];
    if (part === "quiet") f.rules.automation.quietHoursUtc = [{ startMinute: 0, endMinute: 10 }];
    if (part === "preview") f.rules.risk.requirePreviewAtOrAbove = "reversible";
    if (part === "recent-auth") f.rules.risk.requireRecentAuthAtOrAbove = "reversible";
    await expect(f.install().authorize(f.input)).rejects.toMatchObject({
      code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
    });
  });
  it("caps expiry by current policy and remaining artifact lifetime", async () => {
    const f = fixture();
    f.rules.automation.guardianRestrictionTtlSeconds = 120;
    expect((await f.install().authorize(f.input)).expiresAt).toBe(date(5).toISOString());
    f.deployment.expiresAt = date(4).toISOString();
    expect((await f.install().authorize(f.input)).expiresAt).toBe(date(4).toISOString());
    f.deployment.expiresAt = new Date(date(3).getTime() + 59999).toISOString();
    await expect(f.install().authorize(f.input)).rejects.toMatchObject({
      code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
    });
  });
  it.each(["generation", "signal", "revocation", "policy"])(
    "rechecks %s after source reads and parent locks",
    async (part) => {
      const f = fixture();
      if (part === "generation") f.stored.versionNumber = 3;
      if (part === "signal") f.currentSignal.evidenceDigest = `cj1:sha256:${"B".repeat(43)}`;
      if (part === "revocation")
        f.verifyDeployment.mockResolvedValueOnce(true).mockResolvedValue(false);
      if (part === "policy") {
        f.resolvePolicy.mockResolvedValueOnce(structuredClone(f.policy));
        f.rules.automation.guardianRestrictionTtlSeconds = 60;
      }
      await expect(f.install().authorize(f.input)).rejects.toMatchObject({
        code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
      });
    },
  );
  it.each(["staff-auth", "member-auth", "mcp"] as const)(
    "derives only actual auth scope from rate family %s",
    async (family) => {
      const f = fixture();
      f.deployment.rule.detectorId = "guardian.rate-limits";
      f.evidence.detectorId = "guardian.rate-limits";
      f.evidence.audience = null;
      f.evidence.routeFamily = family;
      f.signal.detectorId = "guardian.rate-limits";
      f.currentSignal.detectorId = "guardian.rate-limits";
      f.canonical.detectorId = "guardian.rate-limits";
      f.incident.category = "traffic";
      f.stored.category = "traffic";
      f.canonical.category = "traffic";
      if (family === "mcp")
        await expect(f.install().authorize(f.input)).rejects.toMatchObject({
          code: "AUTOMATIC_GUARDIAN_LIMIT_BLOCKED",
        });
      else
        expect((await f.install().authorize(f.input)).actionScopes).toEqual([
          family === "staff-auth" ? "auth.staff" : "auth.member",
        ]);
    },
  );
});
