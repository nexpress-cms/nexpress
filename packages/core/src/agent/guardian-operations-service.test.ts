import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npRequireAgentIncidentStudioDetailV1 } from "../agent-contract/incident-studio-contract.js";
import {
  npRequireAgentGuardianIncidentExportV1,
  npRequireAgentGuardianDiagnosticsV1,
  npAgentGuardianOperationsDetectorsV1,
  npAgentGuardianOperationsSourceIdsV1,
  npRequireAgentGuardianVerifiedEventV1,
} from "../agent-contract/guardian-operations-contract.js";
import { createAgentGuardianOperationsServiceV1 } from "./guardian-operations-service.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentIncidentStudioServiceV1 } from "./incident-studio-service.js";
import { guardianAssessmentEvidenceFixture } from "./guardian-assessment-test-fixture.js";

const at = "2026-10-18T00:01:00.000Z";
const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  signalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
function detail() {
  return npRequireAgentIncidentStudioDetailV1({
    schemaVersion: "np.agent-incident-studio-detail.v1",
    incident: {
      version: "np.agent-incident.v1",
      id,
      siteId: "default",
      fingerprint: "private-target-fingerprint",
      category: "authorization",
      severity: "medium",
      status: "open",
      title: "private-title-marker",
      summary: "private-model-summary-marker",
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
        detectorId: "guardian.authority-escalated",
        detectorVersion: 1,
        category: "authorization",
        confidenceBasis: "exact-rule",
        scoreBasisPoints: null,
        createdAt: at,
      },
    ],
    timeline: [],
    nextTimelineCursor: null,
    timelinePageComplete: true,
    feedback: [],
    feedbackAvailable: false,
    workflow: null,
    guardianSecurityEvidence: [
      {
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
      },
    ],
  });
}
function fixture() {
  const get = vi
    .fn<NpAgentIncidentStudioServiceV1["get"]>()
    .mockImplementation(() => Promise.resolve(detail()));
  const service = createAgentGuardianOperationsServiceV1({
    studio: { get },
    authorizeDiagnostics: async () => {},
    now: () => new Date(at),
  });
  // The explicit facade owns authentication; the test never creates a privileged actor.
  const actor = {} as Parameters<NpAgentIncidentStudioServiceV1["get"]>[0]["actor"];
  const input = { siteId: "default", incidentId: id, expectedVersion: 1, actor };
  return { get, service, input };
}
describe("Guardian read-only operations", () => {
  it("exports verified login-after-failures counts without session or family targets", async () => {
    const f = fixture(),
      base = detail();
    const { guardianSecurityEvidence: _proof, ...remaining } = base;
    const value = npRequireAgentIncidentStudioDetailV1({
      ...remaining,
      incident: { ...base.incident, category: "authentication", severity: "high", eventCount: 6 },
      signals: [
        {
          ...base.signals[0],
          detectorId: "guardian.login-after-failures",
          category: "authentication",
        },
      ],
      guardianSessionEvidence: [
        {
          schemaVersion: "np.agent-guardian-session-evidence.v1",
          signalId,
          detectorId: "guardian.login-after-failures",
          detectorVersion: 1,
          audience: "staff",
          window: { startedAt: at, endedAt: at },
          successfulLoginAt: at,
          precedingFailureCount: 5,
          countBasis: "at-least",
          sourceDigest: `cj1:sha256:${"A".repeat(43)}`,
        },
      ],
    });
    f.get.mockResolvedValue(value);
    const result = await f.service.exportIncident(f.input);
    expect(result.sources[0]).toMatchObject({
      source: "requests",
      observedCount: 6,
      countBasis: "at-least",
    });
    expect(JSON.stringify(result)).not.toMatch(/sessionFamily|actorBucket|principal/u);
  });
  it("exports structured Guardian assessment outcomes while excluding model prose and provenance", async () => {
    const f = fixture(),
      base = detail(),
      evidence = guardianAssessmentEvidenceFixture();
    const { guardianSecurityEvidence: _proof, ...remaining } = base;
    const hash = `cj1:sha256:${"A".repeat(43)}`;
    const value = npRequireAgentIncidentStudioDetailV1({
      ...remaining,
      incident: {
        ...base.incident,
        category: "authentication",
        versionNumber: 2,
        eventCount: 5,
        firstObservedAt: "2026-10-18T00:00:00.000Z",
        lastObservedAt: at,
      },
      signals: [
        { ...base.signals[0], detectorId: "guardian.login-failures", category: "authentication" },
      ],
      guardianEvidence: [
        {
          schemaVersion: "np.agent-guardian-evidence.v1",
          signalId,
          detectorId: "guardian.login-failures",
          audience: "staff",
          routeFamily: null,
          window: { startedAt: "2026-10-18T00:00:00.000Z", endedAt: at },
          observedCount: 5,
          threshold: 5,
          countBasis: "at-least",
        },
      ],
      timeline: [
        {
          id: "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
          sequence: 1,
          kind: "agent_assessment",
          createdAt: evidence.observedAt,
          approvalId: null,
          actionId: null,
          decision: null,
          guardianAssessment: {
            schemaVersion: "np.agent-guardian-assessment.v1",
            incidentId: id,
            incidentVersion: 1,
            observedAt: evidence.observedAt,
            disposition: "consistent",
            confidenceBasisPoints: 6000,
            assessmentCodes: ["credential-stuffing-pattern"],
            evidenceDigests: evidence.sources.map((s) => s.digest),
            summary: "private-model-prose-marker",
            evidence: { ...evidence, incident: { ...evidence.incident, id } },
            provenance: {
              runId: id,
              providerCallId: id,
              provider: "private-provider-marker",
              model: "private-model-marker",
              recipeFingerprint: hash,
              instructionDigest: hash,
              policyDigests: [],
              requestDigest: hash,
              responseDigest: hash,
              sourceDigest: hash,
            },
          },
        },
      ],
    });
    f.get.mockResolvedValue(value);
    const result = await f.service.exportIncident({ ...f.input, expectedVersion: 2 });
    expect(result.outcomes[0].assessment).toMatchObject({
      disposition: "consistent",
      confidenceBasisPoints: 6000,
      assessmentCodes: ["credential-stuffing-pattern"],
    });
    expect(JSON.stringify(result)).not.toMatch(/private-|provenance|requestDigest|responseDigest/u);
  });
  it("exports only whitelisted source facts after two current-authority facade reads", async () => {
    const f = fixture();
    const result = await f.service.exportIncident(f.input);
    expect(f.get).toHaveBeenCalledTimes(2);
    expect(f.get).toHaveBeenNthCalledWith(2, {
      siteId: "default",
      incidentId: id,
      actor: f.input.actor,
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(
      /private-|primarySubject|title|summary|approval|sourceMac|siteCatalogDigest/u,
    );
    const { checksum, ...body } = result;
    expect(checksum).toBe(
      `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(body)).digest("base64url")}`,
    );
    expect(result.sources[0]).toMatchObject({
      source: "security-transitions",
      countBasis: "committed-transition",
      observedCount: 1,
    });
  });
  it("rejects initial and raced generations, source disappearance and withdrawn authority", async () => {
    const f = fixture();
    await expect(
      f.service.exportIncident({ ...f.input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "GUARDIAN_EXPORT_STALE_GENERATION" });
    const cases = [
      () => Promise.resolve({ ...detail(), incident: { ...detail().incident, versionNumber: 2 } }),
      () => Promise.resolve({ ...detail(), guardianSecurityEvidence: null }),
      () =>
        Promise.reject(
          new NpAgentGatewayError("INCIDENT_FORBIDDEN", 403, "Incident permission is required."),
        ),
    ];
    for (const next of cases) {
      f.get.mockReset().mockResolvedValueOnce(detail()).mockImplementationOnce(next);
      await expect(f.service.exportIncident(f.input)).rejects.toBeInstanceOf(NpAgentGatewayError);
    }
  });
  it("requires complete timeline and source projections, rejecting corrupt/extra raw fields", async () => {
    const f = fixture();
    for (const change of [
      { nextTimelineCursor: "opaque-cursor" },
      { guardianSecurityEvidence: null },
      { guardianSecurityEvidence: undefined },
      {
        guardianSecurityEvidence: [
          { ...detail().guardianSecurityEvidence![0], sourceMac: "private-mac" },
        ],
      },
    ]) {
      f.get.mockReset().mockResolvedValue({ ...detail(), ...change });
      await expect(f.service.exportIncident(f.input)).rejects.toBeInstanceOf(NpAgentGatewayError);
    }
  });
  it("does not treat a recomputed checksum as authority or accept private export fields", async () => {
    const f = fixture();
    const result = await f.service.exportIncident(f.input);
    expect(() =>
      npRequireAgentGuardianIncidentExportV1({ ...result, sourceMac: "secret" }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianIncidentExportV1({
        ...result,
        incident: { ...result.incident, primarySubject: null },
      }),
    ).toThrow();
    f.get.mockRejectedValue(
      new NpAgentGatewayError("INCIDENT_NOT_FOUND", 404, "Incident is unavailable."),
    );
    await expect(f.service.exportIncident(f.input)).rejects.toMatchObject({ status: 404 });
  });
  it("keeps unregistered/unavailable source coverage distinct from verified zero", () => {
    const value = {
      schemaVersion: "np.agent-guardian-diagnostics.v1",
      siteId: "default",
      observedAt: at,
      coverage: "bounded-sample",
      sources: npAgentGuardianOperationsSourceIdsV1.map((id) => ({
        id,
        state: "unregistered",
        sampled: null,
        verified: null,
        proofUnavailable: null,
        truncated: false,
      })),
      detectors: npAgentGuardianOperationsDetectorsV1,
      signals: { sampled: 0, invalid: 0, unsupported: 0, truncated: false },
      openCriticalIncidents: { observedCount: 0, truncated: false },
      notificationFailures: { observedCount: 0, truncated: false },
    };
    expect(
      npRequireAgentGuardianDiagnosticsV1(value).sources.every((s) => s.sampled === null),
    ).toBe(true);
    expect(() =>
      npRequireAgentGuardianDiagnosticsV1({
        ...value,
        sources: value.sources.map((s) => ({ ...s, state: "verified" })),
      }),
    ).toThrow();
    expect(() => npRequireAgentGuardianDiagnosticsV1({ ...value, detectors: [] })).toThrow();
  });
  it("rejects raw or misclassified verified Event metadata", () => {
    const safe = {
      schemaVersion: "np.agent-guardian-verified-event.v1",
      eventId: id,
      source: "security-transitions",
      observedAt: at,
      sourceDigest: `cj1:sha256:${"A".repeat(43)}`,
      detectorId: null,
    };
    expect(npRequireAgentGuardianVerifiedEventV1(safe).detectorId).toBeNull();
    expect(() =>
      npRequireAgentGuardianVerifiedEventV1({ ...safe, actor: { kind: "system" } }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianVerifiedEventV1({
        ...safe,
        detectorId: "guardian.external-error-created",
      }),
    ).toThrow();
  });
});
