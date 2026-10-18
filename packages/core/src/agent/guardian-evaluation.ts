import {
  npBuildAgentGuardianEvaluationArtifactV1,
  npCreateAgentGuardianEvaluationProfilesV1,
  npRequireAgentGuardianEvaluationCorpusV1,
  type NpAgentGuardianEvaluationArtifactV1,
} from "../agent-contract/guardian-evaluation-contract.js";
import { npCreateAgentGuardianEvaluationCorpusV1 } from "./guardian-evaluation-fixtures.js";
import { npPredictAgentGuardianEvaluationBaselineV1 } from "./guardian-evaluation-baseline.js";

/** Local synthetic conformance only. This runner has no provider, host bootstrap,
 * database, source-capture, capability, approval or worker dependency. */
export async function runAgentGuardianEvaluationV1(
  options: { corpus?: unknown } = {},
): Promise<NpAgentGuardianEvaluationArtifactV1> {
  if (Object.keys(options).some((key) => key !== "corpus"))
    throw new Error("Guardian offline evaluation accepts no provider or execution owner.");
  const corpus = npRequireAgentGuardianEvaluationCorpusV1(
    options.corpus ?? npCreateAgentGuardianEvaluationCorpusV1(),
  );
  // Only this copied input crosses the baseline boundary. Oracle, identity,
  // authored intent and required admission results remain with the scorer.
  const predictions = corpus.cases.map((fixture) =>
    npPredictAgentGuardianEvaluationBaselineV1(structuredClone(fixture.input)),
  );
  return npBuildAgentGuardianEvaluationArtifactV1({
    corpus,
    profiles: await npCreateAgentGuardianEvaluationProfilesV1(),
    predictions,
  });
}
