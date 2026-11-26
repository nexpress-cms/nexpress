import { describe, expect, it } from "vitest";
import {
  npAgentAutomaticQuarantineQualificationV1,
  type NpAgentAutomaticQuarantineDeploymentV1,
} from "./automatic-quarantine-contract.js";
const deployment: NpAgentAutomaticQuarantineDeploymentV1 = {
  schemaVersion: "np.agent-automatic-quarantine-deployment.v1",
  policyId: "spam-reviewed",
  policyVersion: 1,
  siteId: "default",
  locale: "ko",
  principalIds: [],
  collectionSlugs: ["posts"],
  rule: {
    kind: "reviewed-blocked-domain.v1",
    domainHash: "a".repeat(64),
    minimumItems: 5,
    minimumIndependentAccounts: 3,
    maximumEvidenceAgeSeconds: 3600,
  },
  limits: { containmentSeconds: 300, actionsPerHour: 10, activeContainments: 10 },
  qualification: {
    source: "production-human-review",
    policyVersion: 1,
    locale: "ko",
    reviewArtifactDigest: `cj1:sha256:${"A".repeat(43)}`,
    reviewedPredictedPositives: 1000,
    reviewedTruePositives: 1000,
    reviewedLegitimateHardNegatives: 1000,
    shadowArtifactDigest: `cj1:sha256:${"B".repeat(43)}`,
    shadowStartedAt: "2026-09-01T00:00:00.000Z",
    shadowEndedAt: "2026-09-15T00:00:00.000Z",
    compensationTestArtifactDigest: `cj1:sha256:${"C".repeat(43)}`,
  },
  issuedAt: "2026-09-16T00:00:00.000Z",
  expiresAt: "2026-09-20T00:00:00.000Z",
};
describe("automatic quarantine reviewed qualification (diagnostic, not authority)", () => {
  it("calculates the one-sided Wilson bound from reviewed positives", () => {
    const result = npAgentAutomaticQuarantineQualificationV1(deployment);
    expect(result.qualified).toBe(true);
    expect(result.precision).toBe(1);
    expect(result.precisionLowerBound).toBeCloseTo(0.9973018, 6);
    const boundary = structuredClone(deployment);
    boundary.qualification.reviewedTruePositives = 995;
    // 99.5% observed precision alone is insufficient at n=1000.
    expect(npAgentAutomaticQuarantineQualificationV1(boundary).qualified).toBe(false);
  });
  it.each(["positives", "hard-negatives", "shadow", "locale", "policy", "precision"])(
    "leaves insufficient %s evidence unqualified",
    (change) => {
      const d = structuredClone(deployment);
      if (change === "positives") {
        d.qualification.reviewedPredictedPositives = 999;
        d.qualification.reviewedTruePositives = 999;
      }
      if (change === "hard-negatives") d.qualification.reviewedLegitimateHardNegatives = 999;
      if (change === "shadow") d.qualification.shadowEndedAt = "2026-09-14T23:59:59.000Z";
      if (change === "locale") d.qualification.locale = "en";
      if (change === "policy") d.qualification.policyVersion = 2;
      if (change === "precision") d.qualification.reviewedTruePositives = 990;
      expect(npAgentAutomaticQuarantineQualificationV1(d).qualified).toBe(false);
    },
  );
});
