import { npCreateAgentModeratorAssessmentFixtureCorpusV1 } from "./moderator-assessment-fixtures.js";
import {
  npDigestAgentEvaluationValueV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationCaseV1,
  type NpAgentEvaluationSuiteV1,
} from "../agent-contract/evaluation-contract.js";
import { npAgentCapabilityIds } from "../agent-contract/types.js";

/** Explicit new profile; old detector/proposal corpus and instruction hashes stay unchanged. */
export async function npCreateAgentModeratorAssessmentEvaluationSuiteV1(): Promise<NpAgentEvaluationSuiteV1> {
  const cases: NpAgentEvaluationCaseV1[] = [];
  for (const item of npCreateAgentModeratorAssessmentFixtureCorpusV1().cases) {
    const source = {
      id: "moderator-assessment",
      kind: "moderator-assessment" as const,
      observedAt: item.input.metadata.observedAt,
      text: JSON.stringify({
        schemaVersion: "np.agent-moderator-assessment-eval-facts.v1",
        locale: item.locale,
        ...item.input,
      }),
    };
    cases.push({
      schemaVersion: "np.agent-eval-case.v1",
      id: item.id,
      caseVersion: 1,
      locale: item.locale,
      category: "moderator-assessment",
      evidence: [{ ...source, digest: await npDigestAgentEvaluationValueV1(source) }],
      expectedSignals: [],
      allowedActions: [],
      forbiddenActions: [...npAgentCapabilityIds].sort(),
      expectedDecision:
        item.expected.label === "uncertain"
          ? "observe"
          : item.expected.label === "benign"
            ? "ignore"
            : "advise",
      rationaleTags: item.expected.label === "uncertain" ? ["unknown"] : [],
      expectedClassification: item.expected.label,
    });
  }
  return npRequireAgentEvaluationSuiteV1({
    schemaVersion: "np.agent-eval-suite.v1",
    id: "moderator-semantic-assessment",
    version: 1,
    cases,
  });
}
