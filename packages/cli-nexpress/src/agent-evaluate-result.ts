import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  npFormatAgentEvaluationReportV1,
  npFormatAgentGuardianEvaluationArtifactV1,
  npRequireAgentGuardianEvaluationArtifactV1,
  npCompareAgentGuardianEvaluationArtifactsV1,
  npBuildAgentGuardianEvaluationReviewArtifactV1,
  npRequireAgentGuardianEvaluationReviewArtifactV1,
  npCompareAgentGuardianEvaluationReviewArtifactsV1,
  type NpAgentGuardianEvaluationArtifactV1,
  type NpAgentGuardianEvaluationReviewArtifactV1,
  type NpAgentGuardianEvaluationReviewComparisonV1,
  type NpAgentEvaluationReportCommandResultV1,
  npFormatAgentModeratorEvaluationCommandResult,
  type NpAgentModeratorEvaluationCommandResult,
  type NpAgentModeratorEvaluationReviewCommandResult,
  npBuildAgentModeratorProposalEvaluationReviewArtifactV1,
  npRequireAgentModeratorProposalEvaluationReviewArtifactV1,
  npCompareAgentModeratorProposalEvaluationReviewArtifactsV1,
  type NpAgentModeratorProposalEvaluationReviewArtifactV1,
  type NpAgentModeratorProposalEvaluationReviewComparisonV1,
  npBuildAgentOperatorPlanEvaluationReviewArtifactV1,
  npRequireAgentOperatorPlanEvaluationReviewArtifactV1,
  npCompareAgentOperatorPlanEvaluationReviewArtifactsV1,
  type NpAgentOperatorPlanEvaluationReviewArtifactV1,
  type NpAgentOperatorPlanEvaluationReviewComparisonV1,
  npAgentEvaluationArtifactMaxBytesV1,
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentEvaluationCommandResultV1,
  npDigestAgentEvaluationSuiteV1,
  npCompareAgentEvaluationArtifactsV1,
  npBuildAgentEvaluationReviewArtifactV1,
  npCompareAgentEvaluationReviewArtifactsV1,
  npRequireAgentEvaluationReviewArtifactV1,
  npBuildAgentProfileEvaluationReviewArtifactV1,
  npRequireAgentProfileEvaluationReviewArtifactV1,
  npCompareAgentProfileEvaluationReviewArtifactsV1,
  type NpAgentEvaluationCommandArgsV1,
  type NpAgentEvaluationCommandResultV1,
  type NpAgentEvaluationReviewArtifactV1,
  type NpAgentProfileEvaluationReviewArtifactV1,
  type NpAgentEvaluationReviewComparisonV1,
} from "@nexpress/core/agent-contract";

interface ReviewResult {
  schemaVersion: "np.agent-eval-review-command.v1";
  artifact: NpAgentEvaluationReviewArtifactV1 | NpAgentProfileEvaluationReviewArtifactV1 | null;
  comparison: NpAgentEvaluationReviewComparisonV1 | null;
  errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | "EVALUATION_UNAVAILABLE" | null;
}
interface OperatorPlanReviewResult {
  schemaVersion: "np.agent-operator-plan-eval-review-command.v1";
  artifact: NpAgentOperatorPlanEvaluationReviewArtifactV1 | null;
  comparison: NpAgentOperatorPlanEvaluationReviewComparisonV1 | null;
  errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | "EVALUATION_UNAVAILABLE" | null;
}
interface ModeratorProposalReviewResult {
  schemaVersion: "np.agent-moderator-proposal-eval-review-command.v1";
  artifact: NpAgentModeratorProposalEvaluationReviewArtifactV1 | null;
  comparison: NpAgentModeratorProposalEvaluationReviewComparisonV1 | null;
  errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | "EVALUATION_UNAVAILABLE" | null;
}
type GuardianResult =
  | {
      schemaVersion: "np.agent-guardian-eval-command.v1";
      artifact: NpAgentGuardianEvaluationArtifactV1 | null;
      comparison: Awaited<ReturnType<typeof npCompareAgentGuardianEvaluationArtifactsV1>> | null;
      errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | "EVALUATION_UNAVAILABLE" | null;
    }
  | {
      schemaVersion: "np.agent-guardian-eval-review-command.v1";
      artifact: NpAgentGuardianEvaluationReviewArtifactV1 | null;
      comparison: NpAgentGuardianEvaluationReviewComparisonV1 | null;
      errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | "EVALUATION_UNAVAILABLE" | null;
    };
export type EvaluationResult =
  | GuardianResult
  | NpAgentEvaluationReportCommandResultV1
  | OperatorPlanReviewResult
  | ModeratorProposalReviewResult
  | NpAgentEvaluationCommandResultV1
  | ReviewResult
  | NpAgentModeratorEvaluationCommandResult
  | NpAgentModeratorEvaluationReviewCommandResult;
export function blockedEvaluationResult(
  review: boolean,
  invalidArtifact = false,
  report = false,
): EvaluationResult {
  if (report)
    return {
      schemaVersion: "np.agent-eval-report-command.v1",
      artifact: null,
      errorCode: invalidArtifact ? "ARTIFACT_INVALID" : "EVALUATION_UNAVAILABLE",
    };
  return {
    schemaVersion: review ? "np.agent-eval-review-command.v1" : "np.agent-eval-command.v1",
    artifact: null,
    comparison: null,
    errorCode: invalidArtifact ? "ARTIFACT_INVALID" : "EVALUATION_UNAVAILABLE",
  };
}
export function evaluationResultFailed(result: EvaluationResult): boolean {
  return Boolean(
    result.errorCode ||
    !result.artifact ||
    ((result.schemaVersion === "np.agent-eval-command.v1" ||
      result.schemaVersion === "np.agent-guardian-eval-command.v1" ||
      result.schemaVersion === "np.agent-moderator-eval-command.v1" ||
      result.schemaVersion === "np.agent-moderator-eval-command.v2" ||
      result.schemaVersion === "np.agent-moderator-eval-command.v3") &&
      !result.artifact.ok),
  );
}
export function formatEvaluationResult(result: EvaluationResult): string {
  if (
    result.schemaVersion === "np.agent-guardian-eval-command.v1" ||
    result.schemaVersion === "np.agent-guardian-eval-review-command.v1"
  ) {
    if (result.errorCode || !result.artifact)
      return `Guardian offline evaluation unavailable (${result.errorCode}).`;
    const text =
      result.schemaVersion === "np.agent-guardian-eval-review-command.v1"
        ? `Guardian synthetic prediction review: supported=${result.artifact.summary.supported}; unsupported=${result.artifact.summary.unsupported}; unreviewed=${result.artifact.summary.unreviewed}. Self-reported labels confer no approval authority.`
        : npFormatAgentGuardianEvaluationArtifactV1(result.artifact);
    return `${text}${result.comparison ? (result.comparison.comparable ? " Comparison uses the compatible synthetic corpus/profile; no production or model usefulness conclusion." : ` Comparison is not comparable (${result.comparison.reason}); no regression conclusion.`) : ""}`;
  }
  if (result.schemaVersion === "np.agent-eval-report-command.v1")
    return result.artifact
      ? npFormatAgentEvaluationReportV1(result.artifact)
      : `Evaluation report unavailable (${result.errorCode}).`;
  if (
    result.schemaVersion === "np.agent-moderator-eval-command.v1" ||
    result.schemaVersion === "np.agent-moderator-eval-review-command.v1" ||
    result.schemaVersion === "np.agent-moderator-eval-command.v2" ||
    result.schemaVersion === "np.agent-moderator-eval-review-command.v2" ||
    result.schemaVersion === "np.agent-moderator-eval-command.v3" ||
    result.schemaVersion === "np.agent-moderator-eval-review-command.v3"
  )
    return npFormatAgentModeratorEvaluationCommandResult(result);
  if (result.errorCode) return `Agent evaluation unavailable (${result.errorCode}).`;
  if (
    result.schemaVersion === "np.agent-eval-review-command.v1" ||
    result.schemaVersion === "np.agent-operator-plan-eval-review-command.v1" ||
    result.schemaVersion === "np.agent-moderator-proposal-eval-review-command.v1"
  ) {
    const reviewable =
      result.schemaVersion === "np.agent-moderator-proposal-eval-review-command.v1"
        ? "response"
        : "proposal";
    return `Offline Agent evaluation review: ${result.artifact?.summary.reviewed} reviewed; ${result.artifact?.summary.unreviewed} unreviewed; ${result.artifact?.summary.ineligible} without a reviewable ${reviewable}. Self-reported labels confer no approval authority.${result.comparison ? (result.comparison.comparable ? " Comparison uses the matched reviewed case/prediction cohort; use --json for rates and unmatched cases." : ` Comparison is not comparable (${result.comparison.reason}); no regression conclusion.`) : ""}`;
  }
  return `Agent evaluation ${result.artifact?.ok ? "passed" : "failed"}: ${result.artifact?.metrics.cases ?? 0} cases; ${result.artifact?.mode === "fake" ? "deterministic fixture correctness only; model usefulness is not measured" : "provider evaluation"}.${result.comparison ? (result.comparison.comparable ? " Comparison is compatible; use --json for metric deltas." : ` Comparison is not comparable (${result.comparison.reason}); no regression conclusion.`) : ""}`;
}
async function readBoundedJson(path: string, cwd: string): Promise<unknown> {
  const file = await open(
    resolve(cwd, path),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await file.stat();
    const maximum = npAgentEvaluationArtifactMaxBytesV1;
    if (!metadata.isFile() || metadata.size > maximum) throw new Error("Invalid artifact");
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new Error("Invalid artifact");
    return JSON.parse(buffer.subarray(0, length).toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}
async function separateReviewOutput(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
): Promise<void> {
  if (!input.outPath) return;
  const destination = resolve(cwd, input.outPath);
  const paths = [input.reviewPath, input.reviewsPath, input.comparePath]
    .filter((p): p is string => typeof p === "string")
    .map((p) => resolve(cwd, p));
  if (paths.includes(destination)) throw new Error("Invalid review output");
  const metadata = await stat(destination).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (metadata)
    for (const path of paths) {
      const source = await stat(path);
      if (source.dev === metadata.dev && source.ino === metadata.ino)
        throw new Error("Invalid review output");
    }
}
/** Capture requested inputs before child execution; never trust child-provided source/comparison. */
export async function prepareEvaluationResultVerifier(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
): Promise<(value: unknown) => Promise<EvaluationResult>> {
  if (input.reportPath) {
    const {
      npReadAgentEvaluationReportInputV1,
      npBuildAgentEvaluationReportV1,
      npAssertAgentEvaluationReportOutputV1,
    } = await import("@nexpress/core/agents");
    const loaded = await npReadAgentEvaluationReportInputV1(input.reportPath, cwd);
    if (input.outPath)
      await npAssertAgentEvaluationReportOutputV1(input.outPath, loaded.sourcePaths, cwd);
    const expected: NpAgentEvaluationReportCommandResultV1 = {
      schemaVersion: "np.agent-eval-report-command.v1",
      artifact: await npBuildAgentEvaluationReportV1(loaded.input),
      errorCode: null,
    };
    return (value) => {
      for (const errorCode of ["ARTIFACT_INVALID", "ARTIFACT_UNAVAILABLE"] as const) {
        const failure: NpAgentEvaluationReportCommandResultV1 = {
          schemaVersion: expected.schemaVersion,
          artifact: null,
          errorCode,
        };
        if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
      }
      if (!isDeepStrictEqual(value, expected))
        throw new Error("Mismatched evaluation report result");
      return Promise.resolve(expected);
    };
  }
  if (input.reviewPath) {
    await separateReviewOutput(input, cwd);
    const source = await readBoundedJson(input.reviewPath, cwd);
    if (
      source &&
      typeof source === "object" &&
      "schemaVersion" in source &&
      source.schemaVersion === "np.agent-guardian-eval.v1"
    )
      return prepareGuardianVerifier(input, cwd, source);
    if (
      source &&
      typeof source === "object" &&
      "schemaVersion" in source &&
      (source.schemaVersion === "np.agent-moderator-eval.v1" ||
        source.schemaVersion === "np.agent-moderator-eval.v2" ||
        source.schemaVersion === "np.agent-moderator-eval.v3")
    )
      return prepareModeratorVerifier(input, cwd, source);
    const evaluation = await npRequireAgentEvaluationArtifactV1(source);
    if (evaluation.suite.cases[0].category === "moderator-proposal")
      return prepareModeratorProposalReviewVerifier(input, cwd, evaluation);
    if (evaluation.suite.cases[0].category === "ops-plan")
      return prepareOperatorPlanReviewVerifier(input, cwd, evaluation);
    if (
      evaluation.suite.cases[0].category === "moderator-assessment" ||
      evaluation.suite.cases[0].category === "publisher-selection"
    )
      return prepareProfileReviewVerifier(input, cwd, evaluation);
    const expectedArtifact = await npBuildAgentEvaluationReviewArtifactV1(
      evaluation,
      input.reviewsPath ? await readBoundedJson(input.reviewsPath, cwd) : [],
    );
    const expectedComparison = input.comparePath
      ? await npCompareAgentEvaluationReviewArtifactsV1(
          expectedArtifact,
          await npRequireAgentEvaluationReviewArtifactV1(
            await readBoundedJson(input.comparePath, cwd),
          ),
        )
      : null;
    const expected: ReviewResult = {
      schemaVersion: "np.agent-eval-review-command.v1",
      artifact: expectedArtifact,
      comparison: expectedComparison,
      errorCode: null,
    };
    return (value) => {
      for (const errorCode of ["ARTIFACT_INVALID", "ARTIFACT_UNAVAILABLE"] as const) {
        const failure: ReviewResult = {
          schemaVersion: "np.agent-eval-review-command.v1",
          artifact: null,
          comparison: null,
          errorCode,
        };
        if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
      }
      if (!isDeepStrictEqual(value, expected)) throw new Error("Mismatched review result");
      return Promise.resolve(expected);
    };
  }
  if (input.dataset === "guardian.v1") return prepareGuardianVerifier(input, cwd);
  if (
    input.dataset === "moderator.v1" ||
    input.dataset === "moderator.v2" ||
    input.dataset === "moderator.v3"
  )
    return prepareModeratorVerifier(input, cwd);
  const baseline = input.comparePath
    ? await npRequireAgentEvaluationArtifactV1(await readBoundedJson(input.comparePath, cwd))
    : null;
  const {
    npCreateAgentOperatorEvaluationSuiteV1,
    npCreateAgentPublisherEvaluationSuiteV1,
    npCreateAgentPublisherEvaluationSuiteV2,
    npCreateAgentPublisherSelectionEvaluationSuiteV1,
    npCreateAgentModeratorAssessmentEvaluationSuiteV1,
    npCreateAgentOperatorPlanEvaluationSuiteV1,
    npCreateAgentModeratorProposalEvaluationSuiteV1,
    npCreateAgentModeratorProposalEvaluationSuiteV2,
    npCreateAgentModeratorProposalEvaluationSuiteV3,
  } = await import("@nexpress/core/agents");
  const suite =
    input.dataset === "publisher.v3"
      ? await npCreateAgentPublisherSelectionEvaluationSuiteV1()
      : input.dataset === "moderator-assessment.v1"
        ? await npCreateAgentModeratorAssessmentEvaluationSuiteV1()
        : input.dataset === "publisher.v2"
          ? await npCreateAgentPublisherEvaluationSuiteV2()
          : input.dataset === "publisher.v1"
            ? await npCreateAgentPublisherEvaluationSuiteV1()
            : input.dataset === "operator-plan.v1"
              ? await npCreateAgentOperatorPlanEvaluationSuiteV1()
              : input.dataset === "moderator-proposal.v3"
                ? await npCreateAgentModeratorProposalEvaluationSuiteV3()
                : input.dataset === "moderator-proposal.v2"
                  ? await npCreateAgentModeratorProposalEvaluationSuiteV2()
                  : input.dataset === "moderator-proposal.v1"
                    ? await npCreateAgentModeratorProposalEvaluationSuiteV1()
                    : await npCreateAgentOperatorEvaluationSuiteV1();
  const suiteHash = await npDigestAgentEvaluationSuiteV1(suite);
  return async (value) => {
    const parsed = await npRequireAgentEvaluationCommandResultV1(value);
    const artifact = parsed.artifact;
    if (artifact) {
      if (
        artifact.provider !== input.provider ||
        artifact.model !== input.model ||
        artifact.suite.id !== suite.id ||
        artifact.suiteHash !== suiteHash ||
        artifact.mode !== (input.provider === "fake" ? "fake" : "provider") ||
        artifact.budget.maxCalls !== input.maxCalls ||
        artifact.budget.maxInputTokens !== input.maxInputTokens ||
        artifact.budget.maxOutputTokens !== input.maxOutputTokens ||
        artifact.budget.maxCostMicros !== input.maxCostMicros ||
        artifact.budget.timeoutMs !== 5000
      )
        throw new Error("Mismatched evaluation result");
      const comparison = baseline
        ? await npCompareAgentEvaluationArtifactsV1(artifact, baseline)
        : null;
      if (!isDeepStrictEqual(parsed.comparison, comparison))
        throw new Error("Mismatched evaluation comparison");
    }
    return parsed;
  };
}

async function prepareGuardianVerifier(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
  reviewSource?: unknown,
): Promise<(value: unknown) => Promise<EvaluationResult>> {
  await separateReviewOutput(input, cwd);
  let expected: GuardianResult;
  if (input.reviewPath) {
    const artifact = await npBuildAgentGuardianEvaluationReviewArtifactV1(
      reviewSource,
      input.reviewsPath ? await readBoundedJson(input.reviewsPath, cwd) : [],
    );
    expected = {
      schemaVersion: "np.agent-guardian-eval-review-command.v1",
      artifact,
      comparison: input.comparePath
        ? await npCompareAgentGuardianEvaluationReviewArtifactsV1(
            artifact,
            await npRequireAgentGuardianEvaluationReviewArtifactV1(
              await readBoundedJson(input.comparePath, cwd),
            ),
          )
        : null,
      errorCode: null,
    };
  } else {
    const { runAgentGuardianEvaluationV1 } = await import("@nexpress/core/agents");
    const artifact = await runAgentGuardianEvaluationV1();
    expected = {
      schemaVersion: "np.agent-guardian-eval-command.v1",
      artifact,
      comparison: input.comparePath
        ? await npCompareAgentGuardianEvaluationArtifactsV1(
            artifact,
            await npRequireAgentGuardianEvaluationArtifactV1(
              await readBoundedJson(input.comparePath, cwd),
            ),
          )
        : null,
      errorCode: null,
    };
  }
  return async (value) => {
    for (const errorCode of [
      "ARTIFACT_INVALID",
      "ARTIFACT_UNAVAILABLE",
      "EVALUATION_UNAVAILABLE",
    ] as const) {
      const failure: GuardianResult = {
        schemaVersion: expected.schemaVersion,
        artifact: null,
        comparison: null,
        errorCode,
      };
      if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
    }
    // The child cannot choose its corpus, labels, profile, comparison or authority.
    if (!isDeepStrictEqual(value, expected)) throw new Error("Mismatched Guardian result");
    return Promise.resolve(expected);
  };
}

async function prepareProfileReviewVerifier(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
  source: unknown,
): Promise<(value: unknown) => Promise<EvaluationResult>> {
  const artifact = await npBuildAgentProfileEvaluationReviewArtifactV1(
    source,
    input.reviewsPath ? await readBoundedJson(input.reviewsPath, cwd) : [],
  );
  const comparison = input.comparePath
    ? await npCompareAgentProfileEvaluationReviewArtifactsV1(
        artifact,
        await npRequireAgentProfileEvaluationReviewArtifactV1(
          await readBoundedJson(input.comparePath, cwd),
        ),
      )
    : null;
  const expected: ReviewResult = {
    schemaVersion: "np.agent-eval-review-command.v1",
    artifact,
    comparison,
    errorCode: null,
  };
  return async (value) => {
    for (const errorCode of ["ARTIFACT_INVALID", "ARTIFACT_UNAVAILABLE"] as const) {
      const failure: ReviewResult = {
        schemaVersion: expected.schemaVersion,
        artifact: null,
        comparison: null,
        errorCode,
      };
      if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
    }
    if (!isDeepStrictEqual(value, expected)) throw new Error("Mismatched profile review result");
    return Promise.resolve(expected);
  };
}

async function prepareModeratorVerifier(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
  reviewSource?: unknown,
): Promise<(value: unknown) => Promise<EvaluationResult>> {
  const {
    runAgentModeratorEvaluationV1,
    runAgentModeratorEvaluationV2,
    runAgentModeratorEvaluationV3,
    npRequireAgentModeratorEvaluationArtifact,
    npCompareAgentModeratorEvaluationArtifacts,
    npBuildAgentModeratorEvaluationReviewArtifact,
    npRequireAgentModeratorEvaluationReviewArtifact,
    npCompareAgentModeratorEvaluationReviewArtifacts,
  } = await import("@nexpress/core/agents");
  await separateReviewOutput(input, cwd);
  let expected:
    NpAgentModeratorEvaluationCommandResult | NpAgentModeratorEvaluationReviewCommandResult;
  if (input.reviewPath) {
    const artifact = await npBuildAgentModeratorEvaluationReviewArtifact(
      reviewSource,
      input.reviewsPath ? await readBoundedJson(input.reviewsPath, cwd) : [],
    );
    const comparison = input.comparePath
      ? await npCompareAgentModeratorEvaluationReviewArtifacts(
          artifact,
          await npRequireAgentModeratorEvaluationReviewArtifact(
            await readBoundedJson(input.comparePath, cwd),
          ),
        )
      : null;
    expected = {
      ...(artifact.schemaVersion === "np.agent-moderator-eval-review.v3"
        ? { schemaVersion: "np.agent-moderator-eval-review-command.v3" as const, artifact }
        : artifact.schemaVersion === "np.agent-moderator-eval-review.v2"
          ? { schemaVersion: "np.agent-moderator-eval-review-command.v2" as const, artifact }
          : { schemaVersion: "np.agent-moderator-eval-review-command.v1" as const, artifact }),
      comparison,
      errorCode: null,
    };
  } else {
    const artifact =
      input.dataset === "moderator.v3"
        ? await runAgentModeratorEvaluationV3()
        : input.dataset === "moderator.v2"
          ? await runAgentModeratorEvaluationV2()
          : await runAgentModeratorEvaluationV1();
    const comparison = input.comparePath
      ? await npCompareAgentModeratorEvaluationArtifacts(
          artifact,
          await npRequireAgentModeratorEvaluationArtifact(
            await readBoundedJson(input.comparePath, cwd),
          ),
        )
      : null;
    expected = {
      ...(artifact.dataset === "moderator.v3"
        ? { schemaVersion: "np.agent-moderator-eval-command.v3" as const, artifact }
        : artifact.dataset === "moderator.v2"
          ? { schemaVersion: "np.agent-moderator-eval-command.v2" as const, artifact }
          : { schemaVersion: "np.agent-moderator-eval-command.v1" as const, artifact }),
      comparison,
      errorCode: null,
    };
  }
  return async (value) => {
    for (const errorCode of [
      "ARTIFACT_INVALID",
      "ARTIFACT_UNAVAILABLE",
      "EVALUATION_UNAVAILABLE",
    ] as const) {
      const failure = {
        schemaVersion: expected.schemaVersion,
        artifact: null,
        comparison: null,
        errorCode,
      };
      if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
    }
    // Deterministic detector results and review labels must match the exact requested inputs.
    if (!isDeepStrictEqual(value, expected)) throw new Error("Mismatched Moderator result");
    return Promise.resolve(expected);
  };
}

async function prepareOperatorPlanReviewVerifier(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
  source: unknown,
): Promise<(value: unknown) => Promise<EvaluationResult>> {
  const artifact = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(
    source,
    input.reviewsPath ? await readBoundedJson(input.reviewsPath, cwd) : [],
  );
  const comparison = input.comparePath
    ? await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(
        artifact,
        await npRequireAgentOperatorPlanEvaluationReviewArtifactV1(
          await readBoundedJson(input.comparePath, cwd),
        ),
      )
    : null;
  const expected: OperatorPlanReviewResult = {
    schemaVersion: "np.agent-operator-plan-eval-review-command.v1",
    artifact,
    comparison,
    errorCode: null,
  };
  return async (value) => {
    for (const errorCode of ["ARTIFACT_INVALID", "ARTIFACT_UNAVAILABLE"] as const) {
      const failure: OperatorPlanReviewResult = {
        schemaVersion: expected.schemaVersion,
        artifact: null,
        comparison: null,
        errorCode,
      };
      if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
    }
    if (!isDeepStrictEqual(value, expected))
      throw new Error("Mismatched Operator plan review result");
    return Promise.resolve(expected);
  };
}

async function prepareModeratorProposalReviewVerifier(
  input: NpAgentEvaluationCommandArgsV1,
  cwd: string,
  source: unknown,
): Promise<(value: unknown) => Promise<EvaluationResult>> {
  const artifact = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(
    source,
    input.reviewsPath ? await readBoundedJson(input.reviewsPath, cwd) : [],
  );
  const comparison = input.comparePath
    ? await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(
        artifact,
        await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
          await readBoundedJson(input.comparePath, cwd),
        ),
      )
    : null;
  const expected: ModeratorProposalReviewResult = {
    schemaVersion: "np.agent-moderator-proposal-eval-review-command.v1",
    artifact,
    comparison,
    errorCode: null,
  };
  return async (value) => {
    for (const errorCode of ["ARTIFACT_INVALID", "ARTIFACT_UNAVAILABLE"] as const) {
      const failure: ModeratorProposalReviewResult = {
        schemaVersion: expected.schemaVersion,
        artifact: null,
        comparison: null,
        errorCode,
      };
      if (isDeepStrictEqual(value, failure)) return Promise.resolve(failure);
    }
    if (!isDeepStrictEqual(value, expected))
      throw new Error("Mismatched Moderator proposal review result");
    return Promise.resolve(expected);
  };
}
