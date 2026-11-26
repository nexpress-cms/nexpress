import {
  npRequireAgentGuardianEvaluationFactsV1,
  npRequireAgentGuardianEvaluationPredictionV1,
  type NpAgentGuardianEvaluationDetectorIdV1,
  type NpAgentGuardianEvaluationFactsV1,
  type NpAgentGuardianEvaluationPredictionV1,
} from "../agent-contract/guardian-evaluation-contract.js";
import {
  NP_AGENT_GUARDIAN_THRESHOLD_V1,
  NP_AGENT_GUARDIAN_WINDOW_MS_V1,
} from "../agent-contract/guardian-contract.js";
import type { NpAgentGuardianAssessmentCode } from "../agent-contract/types.js";

/** Synthetic reference baseline, not the private transaction-bound production detectors.
 * Input has no case identity, oracle, intent, admission decision or expected output. */
export function npPredictAgentGuardianEvaluationBaselineV1(
  value: NpAgentGuardianEvaluationFactsV1,
): NpAgentGuardianEvaluationPredictionV1 {
  const input = npRequireAgentGuardianEvaluationFactsV1(value);
  const end = Date.parse(input.windowStartedAt) + NP_AGENT_GUARDIAN_WINDOW_MS_V1;
  const seen = new Set<string>();
  const facts = input.observations.filter((fact) => {
    if (
      fact.siteId !== input.siteId ||
      fact.observedAt < input.windowStartedAt ||
      Date.parse(fact.observedAt) >= end ||
      seen.has(fact.id)
    )
      return false;
    seen.add(fact.id);
    return true;
  });
  const detectorIds = new Set<NpAgentGuardianEvaluationDetectorIdV1>();
  for (const kind of ["login-failed", "rate-limited"] as const) {
    const actors = new Set(
      facts
        .filter((fact) => fact.kind === kind)
        .map((fact) => fact.actor)
        .filter((actor) => actor !== null),
    );
    for (const actor of actors) {
      const matching = facts.filter((fact) => fact.kind === kind && fact.actor === actor);
      if (matching.length < NP_AGENT_GUARDIAN_THRESHOLD_V1) continue;
      detectorIds.add(kind === "login-failed" ? "guardian.login-failures" : "guardian.rate-limits");
      if (
        kind === "login-failed" &&
        facts.some(
          (fact) =>
            fact.kind === "login-succeeded" &&
            fact.actor === actor &&
            fact.account !== null &&
            matching.filter(
              (failure) =>
                failure.account === fact.account && failure.observedAt <= fact.observedAt,
            ).length >= 5,
        )
      )
        detectorIds.add("guardian.login-after-failures");
    }
  }
  if (
    facts.some((fact) => fact.kind === "authority-elevated" || fact.kind === "super-admin-elevated")
  )
    detectorIds.add("guardian.authority-escalated");
  if (facts.some((fact) => fact.kind === "policy-activated"))
    detectorIds.add("guardian.policy-activated");
  if (facts.some((fact) => fact.kind === "external-error"))
    detectorIds.add("guardian.external-error-created");
  const documents = new Set(
    facts.map((fact) => fact.documentId).filter((document) => document !== null),
  );
  for (const documentId of documents) {
    const document = facts.filter((fact) => fact.documentId === documentId);
    const saves = document.filter(
      (fact) =>
        fact.kind === "document-save" &&
        fact.account !== null &&
        /^(staff|member):/u.test(fact.account),
    );
    if (saves.length >= 5 && new Set(saves.map((fact) => fact.account)).size >= 3)
      detectorIds.add("guardian.content-churn");
    if (
      new Set(
        document
          .filter((fact) => fact.kind === "document-save" || fact.kind === "revision-autosave")
          .flatMap((fact) => (fact.revisionId ? [fact.revisionId] : [])),
      ).size >= 20
    )
      detectorIds.add("guardian.revision-volume");
  }
  const metadata = input.metadata;
  const complete = !!metadata?.incident && !metadata.truncated && metadata.sources.length > 0;
  const codes = new Set<NpAgentGuardianAssessmentCode>();
  if (!complete) codes.add("inconclusive");
  else
    for (const source of metadata.sources)
      codes.add(
        source.fact.detectorId === "guardian.rate-limits"
          ? "traffic-anomaly"
          : source.fact.detectorId === "guardian.authority-escalated"
            ? "authorization-probing"
            : source.fact.detectorId === "guardian.policy-activated"
              ? "agent-policy-abuse"
              : "credential-stuffing-pattern",
      );
  return npRequireAgentGuardianEvaluationPredictionV1({
    schemaVersion: "np.agent-guardian-eval-prediction.v1",
    detectorIds: [...detectorIds].sort(),
    assessment:
      input.recipeId === null
        ? null
        : {
            task: "guardian-assessment",
            decision: {
              kind: "assessment",
              disposition: complete ? "consistent" : "inconclusive",
              confidenceBasisPoints: complete ? 5000 : 0,
              assessmentCodes: [...codes].sort(),
              evidenceDigests: complete
                ? metadata.sources.map((source) => source.digest).sort()
                : [],
              summary: complete
                ? "Synthetic observations are consistent with the stated pattern. This does not establish malicious intent or authority to act."
                : "Synthetic evidence is incomplete. Source proof and current authority require separate live checks.",
            },
          },
  });
}
