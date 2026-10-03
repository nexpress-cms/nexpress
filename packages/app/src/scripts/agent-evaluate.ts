import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  NpAgentEvaluationError,
  runAgentEvaluationV1,
  npCreateAgentOperatorEvaluationSuiteV1,
  type NpAgentEvaluationProviderV1,
} from "@nexpress/core/agents";
import {
  npAgentEvaluationArtifactMaxBytesV1,
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

pnpm agent:evaluate --provider fake --dataset operator.v1 --json
nexpress agent evaluate --out <artifact> [--compare <previous-artifact>] [--json]

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
        suite: await npCreateAgentOperatorEvaluationSuiteV1(),
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
