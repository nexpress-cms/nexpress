import { describe, expect, it } from "vitest";
import {
  npCreateAgentModeratorAssessmentRecipeDefinitionV1,
  npCreateAgentModeratorAssessmentRecipeDefinitionV2,
  npIsAgentModeratorAssessmentProfileV1,
  npIsAgentModeratorAssessmentRecipeV1,
  npIsAgentModeratorAssessmentRecipeV2,
  npAgentModeratorAssessmentRecipeSetupV1,
  npAgentModeratorAssessmentRecipeSetupV2,
} from "./moderator-assessment-recipe-contract.js";
import {
  npRequireAgentModeratorAssessmentEvidenceV2,
  npRequireAgentModeratorSegmentedAssessmentV2,
} from "./moderator-segmented-assessment-contract.js";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const id = "00000000-0000-4000-8000-000000000001";
const evidence = {
  schemaVersion: "np.agent-moderator-assessment-evidence.v2",
  observedAt: "2026-10-15T00:00:00.000Z",
  incident: { id, versionNumber: 1, fingerprint: "test" },
  sources: [],
  truncated: true,
  manifest: {
    digest: hash,
    signalCount: 2,
    eventCount: 151,
    targetCount: 151,
    segmentCount: 16,
    incomplete: false,
    segmentDigests: Array(16).fill(hash),
  },
  segmentIndex: 15,
};
const assessment = {
  schemaVersion: "np.agent-moderator-segmented-assessment.v2",
  incidentId: id,
  incidentVersion: 1,
  observedAt: evidence.observedAt,
  label: "uncertain",
  confidenceBasisPoints: 0,
  reasonCodes: ["insufficient-evidence"],
  summary: "Incomplete semantic evidence.",
  coverage: {
    manifestDigest: hash,
    signalCount: 2,
    eventCount: 151,
    targetCount: 151,
    segmentCount: 16,
    complete: false,
    incomplete: true,
  },
  segmentProviderCallIds: [id],
  proofDigest: hash,
  provenance: {
    runId: id,
    provider: "fake",
    model: "fake",
    recipeFingerprint: hash,
    instructionDigest: hash,
    policyDigests: [],
  },
};
describe("explicit segmented Moderator contracts", () => {
  it("keeps the original profile identity and requires the exact opt-in V2 instructions", async () => {
    const old = await npCreateAgentModeratorAssessmentRecipeDefinitionV1();
    const next = await npCreateAgentModeratorAssessmentRecipeDefinitionV2();
    expect(await npCreateAgentModeratorAssessmentRecipeDefinitionV1()).toEqual(old);
    expect(npIsAgentModeratorAssessmentRecipeV1(next)).toBe(false);
    expect(npIsAgentModeratorAssessmentRecipeV2(old)).toBe(false);
    expect(npIsAgentModeratorAssessmentProfileV1(old)).toBe(true);
    expect(npIsAgentModeratorAssessmentProfileV1(next)).toBe(true);
    expect(npIsAgentModeratorAssessmentRecipeV2(next)).toBe(true);
    expect(
      npIsAgentModeratorAssessmentRecipeV2({
        ...next,
        instruction: { ...next.instruction!, text: "Quarantine automatically" },
      }),
    ).toBe(false);
    expect(
      npIsAgentModeratorAssessmentRecipeV2({
        ...next,
        instruction: { ...next.instruction!, templateId: "unrelated.instructions" },
      }),
    ).toBe(false);
    expect(next.capabilityIds).toEqual(["incident.get", "incident.list"]);
    npAgentModeratorAssessmentRecipeSetupV2.settings.collectionSlugs.push("separate-suggestion");
    expect(npAgentModeratorAssessmentRecipeSetupV1.settings.collectionSlugs).toEqual([]);
    npAgentModeratorAssessmentRecipeSetupV2.settings.collectionSlugs.pop();
  });
  it("requires exact bounded segment indices and an honest capped manifest", () => {
    expect(npRequireAgentModeratorAssessmentEvidenceV2(evidence)).toEqual(evidence);
    for (const changed of [
      { ...evidence, segmentIndex: 16 },
      { ...evidence, manifest: { ...evidence.manifest, segmentDigests: [hash] } },
      {
        ...evidence,
        manifest: {
          ...evidence.manifest,
          targetCount: 1001,
          segmentCount: 100,
          segmentDigests: Array(100).fill(hash),
          incomplete: false,
        },
      },
      { ...evidence, unexpected: "raw content" },
    ])
      expect(() => npRequireAgentModeratorAssessmentEvidenceV2(changed)).toThrow();
    expect(
      npRequireAgentModeratorAssessmentEvidenceV2({
        ...evidence,
        segmentIndex: 99,
        manifest: {
          ...evidence.manifest,
          targetCount: 1001,
          segmentCount: 100,
          segmentDigests: Array(100).fill(hash),
          incomplete: true,
        },
      }).manifest.incomplete,
    ).toBe(true);
  });
  it("never accepts a complete or non-uncertain verdict with missing segment proofs", () => {
    expect(npRequireAgentModeratorSegmentedAssessmentV2(assessment)).toEqual(assessment);
    for (const changed of [
      { ...assessment, label: "spam" },
      { ...assessment, coverage: { ...assessment.coverage, complete: true } },
      { ...assessment, segmentProviderCallIds: [id, id] },
      { ...assessment, reasonCodes: [] },
      { ...assessment, provenance: { ...assessment.provenance, requestDigest: hash } },
    ])
      expect(() => npRequireAgentModeratorSegmentedAssessmentV2(changed)).toThrow();
  });
});
