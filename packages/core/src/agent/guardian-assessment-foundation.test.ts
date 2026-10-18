import { describe, expect, it } from "vitest";
import {
  npRequireAgentGuardianAssessmentDecisionV1,
  npRequireAgentGuardianAssessmentEvidenceV1,
  npRequireAgentGuardianAssessmentV1,
  npRequireAgentGuardianAssessmentFactV1,
} from "../agent-contract/guardian-assessment-contract.js";
import { npRequireAgentGuardianAssessmentSourceProofV1 } from "./guardian-assessment-proof.js";
import { npAssertAgentGuardianAssessmentContextV1 } from "./guardian-assessment-context.js";
import {
  npRequireAgentGuardianAssessmentBudgetV1,
  npReadAgentGuardianAssessmentEligibilityV1,
} from "./guardian-assessment-budget.js";
import {
  createAgentGuardianAssessmentSourceV1,
  npIsAgentGuardianAssessmentSourceV1,
} from "./guardian-assessment-source.js";
import { createAgentGuardianIncidentAssessmentServiceV1 } from "./guardian-incident-assessment-service.js";
import { previewFixture } from "./changeset-preview-test-fixture.js";
import { withAgentChangeSetPreview } from "./changeset-preview-overlay.js";
import type { NpAgentIncidentServiceV1 } from "./incident-service.js";
import {
  guardianAssessmentContextFixture,
  guardianAssessmentEvidenceFixture,
  guardianAssessmentManifestFixture,
  guardianAssessmentUuid,
  guardianAssessmentHash,
} from "./guardian-assessment-test-fixture.js";

describe("Guardian advisory contract and trust boundaries", () => {
  it("keeps actual Runtime cost unknowns separate in advisory facts and rejects invented totals", () => {
    const fact = {
      detectorId: "guardian.spend-velocity",
      detectorVersion: 1,
      category: "agent-abuse",
      severity: "medium",
      window: { startedAt: "2026-10-18T00:00:00.000Z", endedAt: "2026-10-18T00:01:00.000Z" },
      observedCount: 3,
      audience: null,
      routeFamily: null,
      impact: "site",
      accounting: {
        reportedCallCount: 1,
        reportedCostMicros: 100000,
        estimatedCallCount: 1,
        estimatedCostMicros: 20000,
        knownCostMicros: 120000,
        unknownCallCount: 1,
        unknownBudgetChargeMicros: 250000,
        releasedCallCount: 0,
      },
    };
    expect(npRequireAgentGuardianAssessmentFactV1(fact)).toEqual(fact);
    for (const change of [
      { observedCount: 2 },
      { accounting: null },
      { accounting: { ...fact.accounting, knownCostMicros: 370000 } },
      { accounting: { ...fact.accounting, unknownCallCount: 0 } },
      { impact: "deployment" },
      { audience: "staff" },
      { detectorId: "guardian.policy-activated" },
    ]) {
      expect(() => npRequireAgentGuardianAssessmentFactV1({ ...fact, ...change })).toThrow();
    }
    const repeated = {
      ...fact,
      detectorId: "guardian.repeated-proposals",
      observedCount: 2,
      accounting: null,
    };
    expect(npRequireAgentGuardianAssessmentFactV1(repeated)).toEqual(repeated);
    expect(() =>
      npRequireAgentGuardianAssessmentFactV1({ ...repeated, observedCount: 1 }),
    ).toThrow();
  });
  it("blocks advisory persistence during preview before inspecting context or a database", async () => {
    const source = createAgentGuardianAssessmentSourceV1({
      incidents: {} as NpAgentIncidentServiceV1,
    });
    const service = createAgentGuardianIncidentAssessmentServiceV1({
      source,
      incidents: {} as NpAgentIncidentServiceV1,
    });
    const poison = new Proxy(
      {},
      {
        get() {
          throw new Error("Preview inspected advisory context");
        },
      },
    );
    await withAgentChangeSetPreview(await previewFixture(), async () => {
      await expect(
        Promise.resolve().then(() =>
          Reflect.apply(service.record.bind(service), service, [poison, poison]),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    });
  });
  it("rejects private identities, cross-profile facts and fabricated totals", () => {
    const evidence = guardianAssessmentEvidenceFixture();
    expect(npRequireAgentGuardianAssessmentEvidenceV1(evidence)).toEqual(evidence);
    for (const invalid of [
      { ...evidence, principalId: guardianAssessmentUuid(20) },
      { ...evidence, recipeId: "guardian.agent-abuse" },
      {
        ...evidence,
        sources: [
          { ...evidence.sources[0], fact: { ...evidence.sources[0].fact, observedCount: 5000 } },
        ],
      },
      {
        ...evidence,
        sources: [
          { ...evidence.sources[0], fact: { ...evidence.sources[0].fact, rawIp: "192.0.2.1" } },
        ],
      },
    ])
      expect(() => npRequireAgentGuardianAssessmentEvidenceV1(invalid)).toThrow();
  });
  it("cannot parse capabilities, forged approvals or extra authority as an assessment", () => {
    const decision = {
      kind: "assessment",
      disposition: "inconclusive",
      confidenceBasisPoints: 0,
      assessmentCodes: ["inconclusive"],
      evidenceDigests: [],
      summary: "Evidence requires human review.",
    };
    expect(npRequireAgentGuardianAssessmentDecisionV1(decision)).toEqual(decision);
    for (const invalid of [
      { ...decision, approval: "approved" },
      { ...decision, severity: "low" },
      { ...decision, status: "resolved" },
      { kind: "propose-capability", capabilityId: "security.limitActor", arguments: {} },
      { ...decision, confidenceBasisPoints: 10001 },
    ])
      expect(() => npRequireAgentGuardianAssessmentDecisionV1(invalid)).toThrow();
  });
  it("binds each observation and its classification, rejecting rehashed metadata substitution", () => {
    const evidence = guardianAssessmentEvidenceFixture(),
      proof = guardianAssessmentManifestFixture(evidence);
    expect(npRequireAgentGuardianAssessmentSourceProofV1(proof, evidence)).toEqual(evidence);
    expect(() =>
      npRequireAgentGuardianAssessmentSourceProofV1(proof, {
        ...evidence,
        sources: [{ ...evidence.sources[0], signalDigest: guardianAssessmentHash("foreign", 1) }],
      }),
    ).toThrow();
    const forged = guardianAssessmentManifestFixture({
      ...evidence,
      sources: [{ ...evidence.sources[0], signalDigest: guardianAssessmentHash("foreign", 1) }],
    });
    expect(() =>
      npRequireAgentGuardianAssessmentSourceProofV1(forged, {
        ...evidence,
        sources: [{ ...evidence.sources[0], signalDigest: guardianAssessmentHash("foreign", 1) }],
      }),
    ).toThrow();
  });
  it("requires inconclusive output for truncated evidence and exact admitted digests otherwise", () => {
    const evidence = guardianAssessmentEvidenceFixture();
    const assessment = {
      schemaVersion: "np.agent-guardian-assessment.v1",
      incidentId: evidence.incident!.id,
      incidentVersion: 1,
      observedAt: evidence.observedAt,
      disposition: "consistent",
      confidenceBasisPoints: 6000,
      assessmentCodes: ["credential-stuffing-pattern"],
      evidenceDigests: [evidence.sources[0].digest],
      summary: "Repeated failures were observed; malicious intent is unproven.",
      evidence,
      provenance: {
        runId: guardianAssessmentUuid(3),
        providerCallId: guardianAssessmentUuid(7),
        provider: "fake",
        model: "synthetic",
        recipeFingerprint: guardianAssessmentHash("recipe", 1),
        instructionDigest: guardianAssessmentHash("instruction", 1),
        policyDigests: [],
        requestDigest: guardianAssessmentHash("request", 1),
        responseDigest: guardianAssessmentHash("response", 1),
        sourceDigest: guardianAssessmentHash("source", 1),
      },
    };
    expect(npRequireAgentGuardianAssessmentV1(assessment)).toEqual(assessment);
    expect(() =>
      npRequireAgentGuardianAssessmentV1({ ...assessment, evidenceDigests: [] }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianAssessmentV1({
        ...assessment,
        assessmentCodes: ["content-integrity-anomaly"],
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentGuardianAssessmentV1({
        ...assessment,
        evidence: { ...evidence, truncated: true },
      }),
    ).toThrow();
    expect(
      npRequireAgentGuardianAssessmentV1({
        ...assessment,
        disposition: "inconclusive",
        assessmentCodes: ["inconclusive"],
        evidence: { ...evidence, truncated: true },
      }).disposition,
    ).toBe("inconclusive");
  });
  it("rejects lost authority and mutation scopes before touching a source or database", async () => {
    const f = await guardianAssessmentContextFixture();
    npAssertAgentGuardianAssessmentContextV1(f.context);
    f.context.evidence.definition.scopes.push("security:execute");
    expect(() => npAssertAgentGuardianAssessmentContextV1(f.context)).toThrow();
    const source = createAgentGuardianAssessmentSourceV1({
      incidents: {} as NpAgentIncidentServiceV1,
    });
    expect(npIsAgentGuardianAssessmentSourceV1(source)).toBe(true);
    await expect(source.read(f.context)).rejects.toThrow();
    expect(f.select).not.toHaveBeenCalled();
    expect(() =>
      createAgentGuardianIncidentAssessmentServiceV1({
        source: { read: (...args) => source.read(...args) },
        incidents: {} as NpAgentIncidentServiceV1,
      }),
    ).toThrow();
  });
});
describe("Guardian fingerprint analysis admission", () => {
  it("admits an initial bounded analysis and refuses tools before accounting", async () => {
    const f = await guardianAssessmentContextFixture();
    await expect(
      npRequireAgentGuardianAssessmentBudgetV1(f.context, f.request),
    ).resolves.toBeUndefined();
    f.select.mockClear();
    await expect(
      npRequireAgentGuardianAssessmentBudgetV1(f.context, {
        ...f.request,
        tools: [{} as (typeof f.request.tools)[number]],
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_UNAVAILABLE" });
    expect(f.select).not.toHaveBeenCalled();
  });
  it("counts another Agent's pending fingerprint against the site ceiling", async () => {
    const f = await guardianAssessmentContextFixture();
    f.rows.push({ ...f.row(), state: "reserved", dispatchState: "not-dispatched" });
    expect(
      (await npReadAgentGuardianAssessmentEligibilityV1(f.context))(
        f.evidence.incident!.fingerprint,
      ),
    ).toBe(false);
    await expect(
      npRequireAgentGuardianAssessmentBudgetV1(f.context, f.request),
    ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_BLOCKED" });
  });
  it("retains ambiguous analysis across the day boundary and does not infer zero from missing proof", async () => {
    const f = await guardianAssessmentContextFixture();
    f.rows.push({
      ...f.row(),
      state: "ambiguous",
      createdAt: new Date("2026-10-17T00:00:00.000Z"),
      startedAt: new Date("2026-10-17T00:00:00.000Z"),
    });
    await expect(
      npRequireAgentGuardianAssessmentBudgetV1(f.context, f.request),
    ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_BLOCKED" });
    f.rows.splice(0, 1, { ...f.row(), diagnostic: null });
    await expect(
      npRequireAgentGuardianAssessmentBudgetV1(f.context, f.request),
    ).rejects.toMatchObject({ code: "RUNTIME_BUDGET_UNAVAILABLE" });
  });
});
