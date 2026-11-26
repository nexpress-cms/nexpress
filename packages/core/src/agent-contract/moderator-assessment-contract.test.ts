import { describe, expect, it } from "vitest";
import {
  npRequireAgentModeratorAssessmentEvidenceV1,
  npRequireAgentModeratorAssessmentV1,
  type NpAgentModeratorAssessmentEvidenceV1,
} from "./moderator-assessment-contract.js";
const uuid = "01900000-0000-7000-8000-000000000001",
  hash = `cj1:sha256:${"A".repeat(43)}`;
function evidence(): NpAgentModeratorAssessmentEvidenceV1 {
  return {
    schemaVersion: "np.agent-moderator-assessment-evidence.v1",
    observedAt: "2026-10-15T00:00:00.000Z",
    incident: { id: uuid, versionNumber: 1, fingerprint: "spam-cluster" },
    truncated: false,
    sources: [
      {
        id: "moderator-assessment-000",
        eventId: uuid,
        eventDigest: hash,
        subject: { kind: "document", collection: "posts", documentId: uuid },
        currentVersionDigest: hash,
        excerptDigest: hash,
      },
    ],
  };
}
function assessment() {
  return {
    schemaVersion: "np.agent-moderator-assessment.v1",
    incidentId: uuid,
    incidentVersion: 1,
    observedAt: "2026-10-15T00:00:00.000Z",
    label: "uncertain",
    confidenceBasisPoints: 0,
    reasonCodes: ["insufficient-evidence"],
    evidenceDigests: [hash],
    summary: "The bounded excerpt does not establish a spam verdict.",
    evidence: evidence(),
    provenance: {
      runId: uuid,
      providerCallId: uuid,
      provider: "fake-provider",
      model: "fake-model",
      recipeFingerprint: hash,
      instructionDigest: hash,
      policyDigests: [hash],
      requestDigest: hash,
      responseDigest: hash,
      sourceDigest: hash,
    },
  };
}
describe("read-only Moderator assessment contracts", () => {
  it("reconstructs exact safe evidence without retaining excerpts", () => {
    const source = evidence();
    expect(npRequireAgentModeratorAssessmentEvidenceV1(source)).toEqual(source);
    expect(
      npRequireAgentModeratorAssessmentEvidenceV1({ ...source, incident: null, sources: [] }),
    ).toMatchObject({ incident: null, sources: [] });
    for (const bad of [
      { ...source, excerpt: "never store raw source" },
      { ...source, incident: null },
      { ...source, sources: [...source.sources, ...source.sources] },
      { ...source, sources: [{ ...source.sources[0], text: "secret" }] },
      { ...source, sources: [{ ...source.sources[0], currentVersionDigest: "unbound" }] },
      { ...source, sources: Array.from({ length: 11 }, () => ({ ...source.sources[0] })) },
    ])
      expect(() => npRequireAgentModeratorAssessmentEvidenceV1(bad)).toThrow();
  });
  it("requires bounded labels and complete immutable model provenance", () => {
    const result = assessment();
    expect(npRequireAgentModeratorAssessmentV1(result)).toEqual(result);
    expect(
      npRequireAgentModeratorAssessmentV1({
        ...result,
        summary: "Current bounded facts.\nHuman review remains separate.",
      }).summary,
    ).toContain("\n");
    for (const bad of [
      { ...result, label: "confirmed-spam" },
      { ...result, confidenceBasisPoints: 10001 },
      { ...result, reasonCodes: ["unrelated"] },
      { ...result, evidenceDigests: [hash, hash] },
      { ...result, provenance: { ...result.provenance, rawPrompt: "secret" } },
      { ...result, summary: "x".repeat(2001) },
      { ...result, summary: "invalid\u0000summary" },
    ])
      expect(() => npRequireAgentModeratorAssessmentV1(bad)).toThrow();
  });
});
