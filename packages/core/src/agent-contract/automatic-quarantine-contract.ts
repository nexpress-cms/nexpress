/** Host deployment evidence. These values are not an approval or a public execution input. */
export interface NpAgentAutomaticQuarantineDeploymentV1 {
  schemaVersion: "np.agent-automatic-quarantine-deployment.v1";
  policyId: string;
  policyVersion: number;
  siteId: string;
  locale: string;
  principalIds: string[];
  collectionSlugs: string[];
  rule: {
    kind: "reviewed-blocked-domain.v1";
    domainHash: string;
    minimumItems: number;
    minimumIndependentAccounts: number;
    maximumEvidenceAgeSeconds: number;
  };
  limits: {
    containmentSeconds: number;
    actionsPerHour: number;
    activeContainments: number;
  };
  qualification: {
    source: "production-human-review";
    policyVersion: number;
    locale: string;
    reviewArtifactDigest: string;
    reviewedPredictedPositives: number;
    reviewedTruePositives: number;
    reviewedLegitimateHardNegatives: number;
    shadowArtifactDigest: string;
    shadowStartedAt: string;
    shadowEndedAt: string;
    compensationTestArtifactDigest: string;
  };
  issuedAt: string;
  expiresAt: string;
}

export interface NpAgentAutomaticQuarantineEvidenceV1 {
  schemaVersion: "np.agent-automatic-quarantine-authorization.v1";
  policyId: string;
  policyVersion: number;
  deploymentDigest: string;
  locale: string;
  incidentId: string;
  signalId: string;
  signalEvidenceDigest: string;
  sourceEventIds: string[];
  /** Stale/missing observations are excluded from all rule counts; no whole-campaign claim. */
  unavailableSourceEventIds: string[];
  sourceFactsDigest: string;
  itemCount: number;
  independentAccountCount: number;
  authorizedAt: string;
  expiresAt: string;
}

/** Diagnostic only. Qualification still requires a separately trusted current host approval. */
export function npAgentAutomaticQuarantineQualificationV1(
  deployment: NpAgentAutomaticQuarantineDeploymentV1,
): { qualified: boolean; precision: number; precisionLowerBound: number } {
  const q = deployment.qualification;
  const n = q.reviewedPredictedPositives;
  const successes = q.reviewedTruePositives;
  const precision = Number.isSafeInteger(n) && n > 0 ? successes / n : 0;
  // One-sided 95% Wilson score interval: z = Phi^-1(0.95).
  const z = 1.6448536269514722;
  const lower =
    n > 0 && precision >= 0 && precision <= 1
      ? (precision +
          (z * z) / (2 * n) -
          z * Math.sqrt((precision * (1 - precision)) / n + (z * z) / (4 * n * n))) /
        (1 + (z * z) / n)
      : 0;
  return {
    qualified:
      q.source === "production-human-review" &&
      q.policyVersion === deployment.policyVersion &&
      q.locale === deployment.locale &&
      Number.isSafeInteger(n) &&
      Number.isSafeInteger(successes) &&
      successes >= 0 &&
      successes <= n &&
      n >= 1000 &&
      Number.isSafeInteger(q.reviewedLegitimateHardNegatives) &&
      q.reviewedLegitimateHardNegatives >= 1000 &&
      precision >= 0.995 &&
      lower >= 0.99 &&
      Date.parse(q.shadowEndedAt) - Date.parse(q.shadowStartedAt) >= 14 * 86400000,
    precision,
    precisionLowerBound: lower,
  };
}
