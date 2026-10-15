import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  npBuildAgentEvaluationReportV1,
  npReadAgentEvaluationReportInputV1,
  npAssertAgentEvaluationReportOutputV1,
  runAgentModeratorEvaluationV1,
  runAgentModeratorEvaluationV2,
  runAgentModeratorEvaluationV3,
  npRequireAgentModeratorEvaluationArtifact,
  npCompareAgentModeratorEvaluationArtifacts,
  npBuildAgentModeratorEvaluationReviewArtifact,
  npRequireAgentModeratorEvaluationReviewArtifact,
  npCompareAgentModeratorEvaluationReviewArtifacts,
  NpAgentEvaluationError,
  runAgentEvaluationV1,
  npCreateAgentOperatorEvaluationSuiteV1,
  npCreateAgentOperatorPlanEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV1,
  npCreateAgentModeratorProposalEvaluationSuiteV2,
  npCreateAgentModeratorProposalEvaluationSuiteV3,
  npCreateAgentPublisherEvaluationSuiteV1,
  npCreateAgentPublisherEvaluationSuiteV2,
  type NpAgentEvaluationProviderV1,
} from "@nexpress/core/agents";
import {
  npFormatAgentEvaluationReportV1,
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
  npBuildAgentEvaluationReviewArtifactV1,
  npRequireAgentEvaluationReviewArtifactV1,
  npCompareAgentEvaluationReviewArtifactsV1,
  type NpAgentEvaluationReviewArtifactV1,
  type NpAgentEvaluationReviewComparisonV1,
  npCompareAgentEvaluationArtifactsV1,
  npRequireAgentEvaluationArtifactV1,
  npRequireAgentEvaluationBudgetV1,
  npParseAgentEvaluationCommandArgsV1,
  type NpAgentEvaluationCommandArgsV1,
  npRequireAgentEvaluationCommandResultV1,
  type NpAgentEvaluationCommandResultV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentEvaluationBudgetV1,
} from "@nexpress/core/agent-contract";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

export const AGENT_EVALUATE_HELP = `NexPress Agent evaluation

pnpm agent:evaluate --dataset moderator.v1 --out <artifact> --json
pnpm agent:evaluate --dataset moderator.v2 --out <artifact> --json
pnpm agent:evaluate --dataset moderator.v3 --out <artifact> --json
pnpm agent:evaluate --provider fake --dataset moderator-proposal.v1 --out <artifact> --json
pnpm agent:evaluate --provider fake --dataset moderator-proposal.v2 --out <artifact> --json
pnpm agent:evaluate --provider fake --dataset moderator-proposal.v3 --out <artifact> --json
pnpm agent:evaluate --provider fake --dataset operator.v1 --json
pnpm agent:evaluate --provider fake --dataset operator-plan.v1 --out <artifact> --json
pnpm agent:evaluate --provider fake --dataset publisher.v1 --out <artifact> --json
pnpm agent:evaluate --provider fake --dataset publisher.v2 --out <artifact> --json
nexpress agent evaluate --out <artifact> [--compare <previous-artifact>] [--json]
nexpress agent evaluate --review <evaluation-artifact> [--reviews <labels.json>] [--compare <review-artifact>] [--out <review-artifact>] [--json]
nexpress agent evaluate --report <manifest.json> [--out <report.json>] [--json]

Review labels are self-reported offline evaluation data, never live approvals.
Without --reviews, review mode emits evidence/proposals and binding fields with no labels.
Report inputs resolve relative to the manifest. Exit zero means a report was generated,
including missing or failed evidence; it does not establish model usefulness or full R6 acceptance.

moderator.v1 preserves the original observed-content detector fixtures.
moderator.v2 adds unverified report and mixed facts to actual detector replay; report claims establish no spam verdict or approval authority.
moderator.v3 adds synthetic document reports and document/comment mixed targets to actual detector replay; reporter counts confer no author independence or verdict authority.
All moderator detector datasets run the actual deterministic detector offline; network providers and explicit model/budget flags are unavailable.
moderator-proposal.v1 checks the installed recipe response against synthetic observed evidence.
moderator-proposal.v2 adds synthetic unverified report and mixed evidence; reports confer no verdict or approval authority.
moderator-proposal.v3 adds exact document/comment targets to synthetic document-report and mixed evidence; reports confer no verdict or approval authority.
publisher.v2 preserves all V1 cases and adds completeness-priority controls with a separate uncertainty instruction profile; V1 artifacts remain unchanged.
Fake mode checks deterministic fixtures; it does not measure model usefulness.
Network evaluation requires a host-injected provider and explicit --provider, --model, --dataset,
--max-calls, --max-input-tokens, --max-output-tokens, --max-cost-micros and --confirm-network.
No application bootstrap, credentials, workers or tools are loaded by this command.
`;

const maximumArtifactBytes = npAgentEvaluationArtifactMaxBytesV1;
class EvaluationCommandError extends Error {
  constructor(readonly code: NonNullable<NpAgentEvaluationCommandResultV1["errorCode"]>) {
    super(code);
  }
}
export type NpAgentEvaluateCliInputV1 = NpAgentEvaluationCommandArgsV1;
export const parseAgentEvaluateArgsV1 = npParseAgentEvaluationCommandArgsV1;

async function readArtifactJson(path: string): Promise<unknown> {
  const file = await open(
    resolve(path),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumArtifactBytes) throw new Error("Invalid artifact");
    const buffer = Buffer.alloc(maximumArtifactBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximumArtifactBytes) throw new Error("Invalid artifact");
    return JSON.parse(buffer.subarray(0, length).toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}
async function writeArtifactJson(path: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > maximumArtifactBytes) throw new Error("Invalid artifact");
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const stat = await lstat(destination).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (stat && !stat.isFile()) throw new Error("Invalid artifact destination");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export interface NpRunAgentEvaluateProcessOptionsV1 {
  argv?: readonly string[];
  output?: Pick<Writable, "write">;
  resolveProvider?: (id: string, model: string) => Promise<NpAgentEvaluationProviderV1 | null>;
}

/** Explicit evaluation dependency injection only; never load application configuration. */
export async function runAgentEvaluateProcessV1(
  options: NpRunAgentEvaluateProcessOptionsV1 = {},
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const output = options.output ?? process.stdout;
  const normalized = normalizePnpmPassthroughArgv([...argv]);
  if (normalized.length === 1 && (normalized[0] === "--help" || normalized[0] === "-h")) {
    output.write(AGENT_EVALUATE_HELP);
    return 0;
  }
  let input: NpAgentEvaluateCliInputV1 | null = null;
  let result: NpAgentEvaluationCommandResultV1;
  try {
    try {
      input = parseAgentEvaluateArgsV1(argv);
    } catch {
      throw new EvaluationCommandError("ARGUMENT_INVALID");
    }
    if (input.reviewPath) return runReview(input, output);
    if (input.reportPath) return runReport(input, output);
    if (
      input.dataset === "moderator.v1" ||
      input.dataset === "moderator.v2" ||
      input.dataset === "moderator.v3"
    )
      return runModerator(input, output);
    let budget: NpAgentEvaluationBudgetV1;
    try {
      budget = npRequireAgentEvaluationBudgetV1({
        maxCalls: input.maxCalls,
        maxInputTokens: input.maxInputTokens,
        maxOutputTokens: input.maxOutputTokens,
        maxCostMicros: input.maxCostMicros,
        timeoutMs: 5000,
      });
    } catch {
      throw new EvaluationCommandError("ARGUMENT_INVALID");
    }
    let baseline: NpAgentEvaluationArtifactV1 | null = null;
    if (input.comparePath) {
      try {
        baseline = await npRequireAgentEvaluationArtifactV1(
          await readArtifactJson(input.comparePath),
        );
      } catch {
        throw new EvaluationCommandError("ARTIFACT_INVALID");
      }
    }
    let provider: NpAgentEvaluationProviderV1 | undefined;
    if (input.provider !== "fake") {
      try {
        provider = (await options.resolveProvider?.(input.provider, input.model)) ?? undefined;
      } catch {
        throw new EvaluationCommandError("PROVIDER_UNAVAILABLE");
      }
      if (!provider) throw new EvaluationCommandError("PROVIDER_UNAVAILABLE");
    }
    const artifact = await npRequireAgentEvaluationArtifactV1(
      await runAgentEvaluationV1({
        suite:
          input.dataset === "publisher.v2"
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
                      : await npCreateAgentOperatorEvaluationSuiteV1(),
        mode: input.provider === "fake" ? "fake" : "provider",
        providerId: input.provider,
        model: input.model,
        budget,
        confirmNetwork: input.confirmNetwork,
        ...(provider ? { provider } : {}),
      }),
    );
    const comparison = baseline
      ? await npCompareAgentEvaluationArtifactsV1(artifact, baseline)
      : null;
    result = await npRequireAgentEvaluationCommandResultV1({
      schemaVersion: "np.agent-eval-command.v1",
      artifact,
      comparison,
      errorCode: null,
    });
    if (input.outPath) {
      try {
        await writeArtifactJson(input.outPath, artifact);
      } catch {
        throw new EvaluationCommandError("ARTIFACT_UNAVAILABLE");
      }
    }
  } catch (error) {
    const errorCode =
      error instanceof EvaluationCommandError || error instanceof NpAgentEvaluationError
        ? error.code
        : "EVALUATION_UNAVAILABLE";
    result = await npRequireAgentEvaluationCommandResultV1({
      schemaVersion: "np.agent-eval-command.v1",
      artifact: null,
      comparison: null,
      errorCode,
    });
  }
  const text = result.errorCode
    ? `Agent evaluation unavailable (${result.errorCode}).`
    : `Agent evaluation ${result.artifact?.ok ? "passed" : "failed"}: ${result.artifact?.metrics.cases ?? 0} cases; ${result.artifact?.mode === "fake" ? "deterministic fixture correctness only; model usefulness is not measured" : "provider evaluation"}.${result.comparison ? (result.comparison.comparable ? " Comparison is compatible; use --json for metric deltas." : ` Comparison is not comparable (${result.comparison.reason}); no regression conclusion.`) : ""}`;
  output.write(`${(input?.json ?? argv.includes("--json")) ? JSON.stringify(result) : text}\n`);
  return result.errorCode || !result.artifact?.ok ? 1 : 0;
}

async function assertReviewOutputIsSeparate(input: NpAgentEvaluateCliInputV1): Promise<void> {
  if (!input.outPath) return;
  const destination = resolve(input.outPath);
  const inputs = [input.reviewPath, input.reviewsPath, input.comparePath].filter(
    (p): p is string => typeof p === "string",
  );
  if (inputs.some((p) => resolve(p) === destination)) throw new Error("Invalid review output");
  const destinationStat = await stat(destination).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (destinationStat)
    for (const path of inputs) {
      const inputStat = await stat(resolve(path));
      if (inputStat.dev === destinationStat.dev && inputStat.ino === destinationStat.ino)
        throw new Error("Invalid review output");
    }
}
async function runReview(
  input: NpAgentEvaluateCliInputV1,
  output: Pick<Writable, "write">,
): Promise<number> {
  let artifact: NpAgentEvaluationReviewArtifactV1 | null = null;
  let comparison: NpAgentEvaluationReviewComparisonV1 | null = null;
  let errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | null = null;
  try {
    const source: unknown = await readArtifactJson(input.reviewPath!);
    if (
      source &&
      typeof source === "object" &&
      "schemaVersion" in source &&
      (source.schemaVersion === "np.agent-moderator-eval.v1" ||
        source.schemaVersion === "np.agent-moderator-eval.v2" ||
        source.schemaVersion === "np.agent-moderator-eval.v3")
    )
      return runModerator(input, output, source);
    const evaluation = await npRequireAgentEvaluationArtifactV1(source);
    if (evaluation.suite.cases[0].category === "moderator-proposal")
      return runModeratorProposalReview(input, output, evaluation);
    if (evaluation.suite.cases[0].category === "ops-plan")
      return runOperatorPlanReview(input, output, evaluation);
    artifact = await npBuildAgentEvaluationReviewArtifactV1(
      evaluation,
      input.reviewsPath ? await readArtifactJson(input.reviewsPath) : [],
    );
    if (input.comparePath)
      comparison = await npCompareAgentEvaluationReviewArtifactsV1(
        artifact,
        await npRequireAgentEvaluationReviewArtifactV1(await readArtifactJson(input.comparePath)),
      );
  } catch {
    errorCode = "ARTIFACT_INVALID";
  }
  if (!errorCode && input.outPath)
    try {
      await assertReviewOutputIsSeparate(input);
      await writeArtifactJson(input.outPath, artifact);
    } catch {
      errorCode = "ARTIFACT_UNAVAILABLE";
    }
  if (errorCode) {
    artifact = null;
    comparison = null;
  }
  const result = {
    schemaVersion: "np.agent-eval-review-command.v1",
    artifact,
    comparison,
    errorCode,
  };
  const text = errorCode
    ? `Agent evaluation review unavailable (${errorCode}).`
    : `Offline Agent evaluation review: ${artifact?.summary.reviewed} reviewed; ${artifact?.summary.unreviewed} unreviewed; ${artifact?.summary.ineligible} without a reviewable proposal. Self-reported labels confer no approval authority.${comparison ? (comparison.comparable ? " Comparison uses the matched reviewed case/prediction cohort; use --json for rates and unmatched cases." : ` Comparison is not comparable (${comparison.reason}); no regression conclusion.`) : ""}`;
  output.write(`${input.json ? JSON.stringify(result) : text}\n`);
  return errorCode ? 1 : 0;
}

async function runModerator(
  input: NpAgentEvaluateCliInputV1,
  output: Pick<Writable, "write">,
  reviewSource?: unknown,
): Promise<number> {
  let result:
    NpAgentModeratorEvaluationCommandResult | NpAgentModeratorEvaluationReviewCommandResult;
  const sourceVersion =
    reviewSource && typeof reviewSource === "object" && "schemaVersion" in reviewSource
      ? reviewSource.schemaVersion
      : null;
  const version = input.reviewPath
    ? sourceVersion === "np.agent-moderator-eval.v3"
      ? 3
      : sourceVersion === "np.agent-moderator-eval.v2"
        ? 2
        : 1
    : input.dataset === "moderator.v3"
      ? 3
      : input.dataset === "moderator.v2"
        ? 2
        : 1;
  try {
    if (input.reviewPath) {
      const artifact = await npBuildAgentModeratorEvaluationReviewArtifact(
        reviewSource,
        input.reviewsPath ? await readArtifactJson(input.reviewsPath) : [],
      );
      const comparison = input.comparePath
        ? await npCompareAgentModeratorEvaluationReviewArtifacts(
            artifact,
            await npRequireAgentModeratorEvaluationReviewArtifact(
              await readArtifactJson(input.comparePath),
            ),
          )
        : null;
      result = {
        ...(artifact.schemaVersion === "np.agent-moderator-eval-review.v3"
          ? { schemaVersion: "np.agent-moderator-eval-review-command.v3" as const, artifact }
          : artifact.schemaVersion === "np.agent-moderator-eval-review.v2"
            ? { schemaVersion: "np.agent-moderator-eval-review-command.v2" as const, artifact }
            : { schemaVersion: "np.agent-moderator-eval-review-command.v1" as const, artifact }),
        comparison,
        errorCode: null,
      };
    } else {
      const baseline = input.comparePath
        ? await npRequireAgentModeratorEvaluationArtifact(await readArtifactJson(input.comparePath))
        : null;
      const artifact =
        input.dataset === "moderator.v3"
          ? await runAgentModeratorEvaluationV3()
          : input.dataset === "moderator.v2"
            ? await runAgentModeratorEvaluationV2()
            : await runAgentModeratorEvaluationV1();
      const comparison = baseline
        ? await npCompareAgentModeratorEvaluationArtifacts(artifact, baseline)
        : null;
      result = {
        ...(artifact.dataset === "moderator.v3"
          ? { schemaVersion: "np.agent-moderator-eval-command.v3" as const, artifact }
          : artifact.dataset === "moderator.v2"
            ? { schemaVersion: "np.agent-moderator-eval-command.v2" as const, artifact }
            : { schemaVersion: "np.agent-moderator-eval-command.v1" as const, artifact }),
        comparison,
        errorCode: null,
      };
    }
  } catch {
    result = {
      schemaVersion: input.reviewPath
        ? version === 3
          ? "np.agent-moderator-eval-review-command.v3"
          : version === 2
            ? "np.agent-moderator-eval-review-command.v2"
            : "np.agent-moderator-eval-review-command.v1"
        : version === 3
          ? "np.agent-moderator-eval-command.v3"
          : version === 2
            ? "np.agent-moderator-eval-command.v2"
            : "np.agent-moderator-eval-command.v1",
      artifact: null,
      comparison: null,
      errorCode: "ARTIFACT_INVALID",
    };
  }
  if (!result.errorCode && input.outPath) {
    try {
      // Preserve every input used to produce an evaluation or a review, including hardlink aliases.
      await assertReviewOutputIsSeparate(input);
      await writeArtifactJson(input.outPath, result.artifact);
    } catch {
      result = {
        schemaVersion: result.schemaVersion,
        artifact: null,
        comparison: null,
        errorCode: "ARTIFACT_UNAVAILABLE",
      };
    }
  }
  output.write(
    `${input.json ? JSON.stringify(result) : npFormatAgentModeratorEvaluationCommandResult(result)}\n`,
  );
  return result.errorCode ||
    !result.artifact ||
    ((result.schemaVersion === "np.agent-moderator-eval-command.v1" ||
      result.schemaVersion === "np.agent-moderator-eval-command.v2" ||
      result.schemaVersion === "np.agent-moderator-eval-command.v3") &&
      !result.artifact.ok)
    ? 1
    : 0;
}

async function runOperatorPlanReview(
  input: NpAgentEvaluateCliInputV1,
  output: Pick<Writable, "write">,
  source: NpAgentEvaluationArtifactV1,
): Promise<number> {
  let artifact: NpAgentOperatorPlanEvaluationReviewArtifactV1 | null = null;
  let comparison: NpAgentOperatorPlanEvaluationReviewComparisonV1 | null = null;
  let errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | null = null;
  try {
    artifact = await npBuildAgentOperatorPlanEvaluationReviewArtifactV1(
      source,
      input.reviewsPath ? await readArtifactJson(input.reviewsPath) : [],
    );
    if (input.comparePath)
      comparison = await npCompareAgentOperatorPlanEvaluationReviewArtifactsV1(
        artifact,
        await npRequireAgentOperatorPlanEvaluationReviewArtifactV1(
          await readArtifactJson(input.comparePath),
        ),
      );
  } catch {
    errorCode = "ARTIFACT_INVALID";
  }
  if (!errorCode && input.outPath)
    try {
      await assertReviewOutputIsSeparate(input);
      await writeArtifactJson(input.outPath, artifact);
    } catch {
      errorCode = "ARTIFACT_UNAVAILABLE";
    }
  if (errorCode) {
    artifact = null;
    comparison = null;
  }
  const result = {
    schemaVersion: "np.agent-operator-plan-eval-review-command.v1",
    artifact,
    comparison,
    errorCode,
  };
  const text = errorCode
    ? `Operator plan review unavailable (${errorCode}).`
    : `Offline Operator diagnosis/plan review: ${artifact?.summary.reviewed} reviewed; ${artifact?.summary.unreviewed} unreviewed; ${artifact?.summary.ineligible} without a reviewable proposal. Self-reported labels confer no approval authority.${comparison ? (comparison.comparable ? " Comparison uses the matched reviewed case/prediction cohort." : ` Comparison is not comparable (${comparison.reason}); no regression conclusion.`) : ""}`;
  output.write(`${input.json ? JSON.stringify(result) : text}\n`);
  return errorCode ? 1 : 0;
}

async function runModeratorProposalReview(
  input: NpAgentEvaluateCliInputV1,
  output: Pick<Writable, "write">,
  source: NpAgentEvaluationArtifactV1,
): Promise<number> {
  let artifact: NpAgentModeratorProposalEvaluationReviewArtifactV1 | null = null;
  let comparison: NpAgentModeratorProposalEvaluationReviewComparisonV1 | null = null;
  let errorCode: "ARTIFACT_INVALID" | "ARTIFACT_UNAVAILABLE" | null = null;
  try {
    artifact = await npBuildAgentModeratorProposalEvaluationReviewArtifactV1(
      source,
      input.reviewsPath ? await readArtifactJson(input.reviewsPath) : [],
    );
    if (input.comparePath)
      comparison = await npCompareAgentModeratorProposalEvaluationReviewArtifactsV1(
        artifact,
        await npRequireAgentModeratorProposalEvaluationReviewArtifactV1(
          await readArtifactJson(input.comparePath),
        ),
      );
  } catch {
    errorCode = "ARTIFACT_INVALID";
  }
  if (!errorCode && input.outPath)
    try {
      await assertReviewOutputIsSeparate(input);
      await writeArtifactJson(input.outPath, artifact);
    } catch {
      errorCode = "ARTIFACT_UNAVAILABLE";
    }
  if (errorCode) {
    artifact = null;
    comparison = null;
  }
  const result = {
    schemaVersion: "np.agent-moderator-proposal-eval-review-command.v1",
    artifact,
    comparison,
    errorCode,
  };
  const text = errorCode
    ? `Moderator proposal review unavailable (${errorCode}).`
    : `Offline Moderator proposal review: ${artifact?.summary.reviewed} reviewed; ${artifact?.summary.unreviewed} unreviewed; ${artifact?.summary.ineligible} without a reviewable response. Self-reported labels confer no approval authority.${comparison ? (comparison.comparable ? " Comparison uses the matched reviewed case/prediction cohort." : ` Comparison is not comparable (${comparison.reason}); no regression conclusion.`) : ""}`;
  output.write(`${input.json ? JSON.stringify(result) : text}\n`);
  return errorCode ? 1 : 0;
}

async function runReport(
  input: NpAgentEvaluateCliInputV1,
  output: Pick<Writable, "write">,
): Promise<number> {
  let result: NpAgentEvaluationReportCommandResultV1;
  try {
    const loaded = await npReadAgentEvaluationReportInputV1(input.reportPath!);
    const artifact = await npBuildAgentEvaluationReportV1(loaded.input);
    result = { schemaVersion: "np.agent-eval-report-command.v1", artifact, errorCode: null };
    if (input.outPath) {
      try {
        await npAssertAgentEvaluationReportOutputV1(input.outPath, loaded.sourcePaths);
        await writeArtifactJson(input.outPath, artifact);
      } catch {
        result = {
          schemaVersion: "np.agent-eval-report-command.v1",
          artifact: null,
          errorCode: "ARTIFACT_UNAVAILABLE",
        };
      }
    }
  } catch {
    result = {
      schemaVersion: "np.agent-eval-report-command.v1",
      artifact: null,
      errorCode: "ARTIFACT_INVALID",
    };
  }
  output.write(
    `${input.json ? JSON.stringify(result) : result.artifact ? npFormatAgentEvaluationReportV1(result.artifact) : `Evaluation report unavailable (${result.errorCode}).`}\n`,
  );
  return result.errorCode ? 1 : 0;
}
