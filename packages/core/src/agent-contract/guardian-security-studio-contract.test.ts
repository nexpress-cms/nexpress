import { describe, expect, it } from "vitest";
import { npRequireAgentIncidentStudioDetailV1 } from "./incident-studio-contract.js";

const at = "2026-10-18T00:01:00.000Z";
const signalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const evidence = {
  schemaVersion: "np.agent-guardian-security-evidence.v1",
  signalId,
  detectorId: "guardian.authority-escalated",
  detectorVersion: 1,
  basis: "committed-transition",
  targetKind: "site-role",
  observedAt: at,
  sourceDigest: `cj1:sha256:${"A".repeat(43)}`,
  impact: {
    scope: "site",
    affectedSiteCount: 1,
    siteCatalogDigest: `cj1:sha256:${"B".repeat(43)}`,
  },
};
function detail() {
  return {
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
      siteId: "default",
      fingerprint: "security-fixture",
      category: "authorization",
      severity: "medium",
      status: "open",
      title: "Authority increase observed",
      summary: "A committed transition requires review.",
      primarySubject: null,
      assignedAgentId: null,
      signalIds: [signalId],
      eventCount: 1,
      firstObservedAt: at,
      lastObservedAt: at,
      containedAt: null,
      resolvedAt: null,
      resolutionCode: null,
      versionNumber: 1,
      createdAt: at,
      updatedAt: at,
    },
    signals: [
      {
        id: signalId,
        detectorId: evidence.detectorId,
        detectorVersion: 1,
        category: "authorization",
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        createdAt: at,
      },
    ],
    timeline: [],
    nextTimelineCursor: null,
    feedback: [],
    feedbackAvailable: false,
    workflow: null,
    guardianSecurityEvidence: [evidence],
  };
}
describe("Guardian security evidence in Incident detail", () => {
  it("keeps a deterministic severity increase distinct from human and model decisions", () => {
    const base = detail();
    const change = {
      fromSeverity: "low",
      toSeverity: "high",
      detectorId: evidence.detectorId,
      detectorVersion: 1,
      signalId,
      evidenceDigest: evidence.sourceDigest,
    };
    const entry = {
      id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
      sequence: 2,
      kind: "correlated",
      createdAt: at,
      approvalId: null,
      actionId: null,
      decision: null,
      ruleSeverityChange: change,
    };
    const value = {
      ...base,
      incident: { ...base.incident, severity: "high", versionNumber: 2 },
      timeline: [entry],
    };
    expect(npRequireAgentIncidentStudioDetailV1(value).timeline[0]?.ruleSeverityChange).toEqual(
      change,
    );
    for (const altered of [
      { ...entry, kind: "human_note" },
      { ...entry, ruleSeverityChange: { ...change, fromSeverity: "critical" } },
      { ...entry, ruleSeverityChange: { ...change, toSeverity: "low" } },
      { ...entry, ruleSeverityChange: { ...change, signalId: entry.id } },
      {
        ...entry,
        severityChange: { fromSeverity: "low", toSeverity: "high", note: "Forged staff note" },
      },
    ])
      expect(() =>
        npRequireAgentIncidentStudioDetailV1({ ...value, timeline: [altered] }),
      ).toThrow();
  });
  it("requires exact displayed signal identity, rule, category and observation time", () => {
    const value = detail();
    expect(npRequireAgentIncidentStudioDetailV1(value).guardianSecurityEvidence).toEqual([
      evidence,
    ]);
    for (const change of [
      { signalId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3" },
      { detectorId: "guardian.policy-activated", targetKind: "agent-policy" },
      { observedAt: "2026-10-18T00:02:00.000Z" },
      { userId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd4" },
    ])
      expect(() =>
        npRequireAgentIncidentStudioDetailV1({
          ...value,
          guardianSecurityEvidence: [{ ...evidence, ...change }],
        }),
      ).toThrow();
    for (const change of [
      { detectorVersion: 2 },
      { confidenceBasis: "model-classification", scoreBasisPoints: 8000 },
      { category: "agent-abuse" },
    ])
      expect(() =>
        npRequireAgentIncidentStudioDetailV1({
          ...value,
          signals: [{ ...value.signals[0], ...change }],
        }),
      ).toThrow();
  });
  it("represents lost proof as unavailable and rejects mixed or incomplete evidence", () => {
    const value = detail();
    expect(
      npRequireAgentIncidentStudioDetailV1({ ...value, guardianSecurityEvidence: null })
        .guardianSecurityEvidence,
    ).toBeNull();
    for (const change of [
      { guardianSecurityEvidence: [] },
      { guardianSecurityEvidence: [evidence, evidence] },
      { guardianEvidence: null },
      { signals: [] },
      { signals: [{ ...value.signals[0], detectorId: "guardian.login-failures" }] },
    ])
      expect(() => npRequireAgentIncidentStudioDetailV1({ ...value, ...change })).toThrow();
  });
  it("binds external facts to external confidence and keeps an unavailable proof from becoming an exact rule", () => {
    const { guardianSecurityEvidence: _security, ...base } = detail();
    const value = {
      ...base,
      incident: { ...base.incident, category: "availability" },
      signals: [
        {
          ...base.signals[0],
          category: "availability",
          detectorId: "guardian.external-error-created",
          confidenceBasis: "external",
        },
      ],
      guardianExternalEvidence: null,
    };
    expect(npRequireAgentIncidentStudioDetailV1(value).guardianExternalEvidence).toBeNull();
    expect(() =>
      npRequireAgentIncidentStudioDetailV1({
        ...value,
        signals: [{ ...value.signals[0], confidenceBasis: "exact-rule" }],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentIncidentStudioDetailV1({ ...value, guardianSecurityEvidence: null }),
    ).toThrow();
  });
});
