import { describe, expect, it } from "vitest";
import { npRequireAgentGuardianEvidenceV1 } from "./guardian-contract.js";
import { npAnalyzeAgentEventCanonical } from "./canonical-events.js";
import { npRequireAgentIncidentStudioDetailV1 } from "./incident-studio-contract.js";

const evidence = {
  schemaVersion: "np.agent-guardian-evidence.v1",
  signalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  detectorId: "guardian.login-failures",
  audience: "staff",
  routeFamily: null,
  window: { startedAt: "2026-10-17T00:00:00.000Z", endedAt: "2026-10-17T00:01:00.000Z" },
  observedCount: 5,
  threshold: 5,
  countBasis: "at-least",
};
describe("Guardian safe evidence", () => {
  it("binds verified counts, category and observation window to the displayed Incident", () => {
    const detail = {
      schemaVersion: "np.agent-incident-studio-detail.v1",
      incident: {
        version: "np.agent-incident.v1",
        id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
        siteId: "default",
        fingerprint: "test-fixture",
        category: "authentication",
        severity: "medium",
        status: "open",
        title: "Repeated login failures",
        summary: "At least five observed failures",
        primarySubject: null,
        assignedAgentId: null,
        signalIds: [evidence.signalId],
        eventCount: 5,
        firstObservedAt: evidence.window.startedAt,
        lastObservedAt: evidence.window.endedAt,
        containedAt: null,
        resolvedAt: null,
        resolutionCode: null,
        versionNumber: 1,
        createdAt: evidence.window.endedAt,
        updatedAt: evidence.window.endedAt,
      },
      signals: [
        {
          id: evidence.signalId,
          detectorId: evidence.detectorId,
          detectorVersion: 1,
          category: "authentication",
          confidenceBasis: "exact-rule",
          scoreBasisPoints: null,
          createdAt: evidence.window.endedAt,
        },
      ],
      timeline: [],
      nextTimelineCursor: null,
      feedback: [],
      feedbackAvailable: false,
      workflow: null,
      guardianEvidence: [evidence],
    };
    expect(npRequireAgentIncidentStudioDetailV1(detail).guardianEvidence).toHaveLength(1);
    for (const change of [
      { category: "traffic" },
      { eventCount: 1 },
      { lastObservedAt: evidence.window.startedAt },
    ])
      expect(() =>
        npRequireAgentIncidentStudioDetailV1({
          ...detail,
          incident: { ...detail.incident, ...change },
        }),
      ).toThrow();
  });
  it("retains lower-bound rule evidence and rejects fabricated totals, source dimensions and raw facts", () => {
    expect(npRequireAgentGuardianEvidenceV1(evidence)).toEqual(evidence);
    for (const change of [
      { countBasis: "total" },
      { observedCount: 6 },
      { routeFamily: "staff-auth" },
      { ip: "192.0.2.1" },
      { window: { ...evidence.window, endedAt: "2026-10-17T00:10:00.000Z" } },
    ])
      expect(() => npRequireAgentGuardianEvidenceV1({ ...evidence, ...change })).toThrow();
    expect(
      npRequireAgentGuardianEvidenceV1({
        ...evidence,
        detectorId: "guardian.rate-limits",
        audience: null,
        routeFamily: "admin",
      }).routeFamily,
    ).toBe("admin");
  });
  it("accepts a closed API rate-limit event without request paths, credentials or raw IPs", () => {
    const ipBucket = {
      purpose: "network-address",
      projectionVersion: 1,
      projectionFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      keyId: "test-key",
      bucket: "B".repeat(43),
    };
    const event = {
      version: "np.agent-event.v1",
      siteId: "default",
      kind: "api.rate-limited",
      occurredAt: evidence.window.endedAt,
      source: { kind: "api", component: "api.guardian" },
      subject: null,
      actor: null,
      causation: null,
      correlationId: null,
      deduplicationKey: "source-1",
      privacy: "sensitive",
      payload: { kind: "api.rate-limited", routeFamily: "admin", ipBucket },
    };
    expect(npAnalyzeAgentEventCanonical(event).ok).toBe(true);
    expect(
      npAnalyzeAgentEventCanonical({
        ...event,
        payload: { ...event.payload, routeFamily: "/api/admin/private?token=secret" },
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentEventCanonical({
        ...event,
        payload: { ...event.payload, authorization: "secret" },
      }).ok,
    ).toBe(false);
  });
});
