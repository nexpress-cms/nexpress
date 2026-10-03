import { NpError } from "../errors.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npCreateAgentOperatorRecipeDefinitionV1 } from "../agent-contract/operator-recipe-contract.js";
import {
  npBuildAgentEvaluationArtifactV1,
  npDigestAgentEvaluationCaseV1,
  npDigestAgentEvaluationValueV1,
  npAgentEvaluationPredictionSchemaV1,
  npAgentEvaluationBenchmarkInstructionV1,
  npRequireAgentEvaluationBudgetV1,
  npRequireAgentEvaluationPredictionV1,
  npRequireAgentEvaluationSuiteV1,
  type NpAgentEvaluationArtifactV1,
  type NpAgentEvaluationBudgetV1,
  type NpAgentEvaluationCaseResultV1,
  type NpAgentEvaluationCaseV1,
  type NpAgentEvaluationPredictionV1,
  type NpAgentEvaluationSuiteV1,
} from "../agent-contract/evaluation-contract.js";
import type { NpAgentJsonSchema } from "../agent-contract/types.js";

export class NpAgentEvaluationError extends NpError {
  constructor(code: "ARGUMENT_INVALID" | "NETWORK_CONFIRMATION_REQUIRED" | "PROVIDER_UNAVAILABLE") {
    super("Agent evaluation is unavailable.", code, 400);
  }
}
export interface NpAgentEvaluationReservationV1 {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}
export interface NpAgentEvaluationProviderRequestV1 {
  case: Pick<NpAgentEvaluationCaseV1, "id" | "caseVersion" | "locale" | "evidence">;
  instruction: { templateId: string; templateVersion: number; digest: string; text: string };
  responseSchema: NpAgentJsonSchema;
  benchmarkInstruction: string;
}
/** Explicit evaluation-only host owner. It must use isolated test credentials and honor quoted ceilings. */
export interface NpAgentEvaluationProviderV1 {
  id: string;
  model: string;
  /** Local, side-effect-free worst-case token/cost reservation including all prompt/schema overhead. */
  quote(request: NpAgentEvaluationProviderRequestV1): NpAgentEvaluationReservationV1;
  invoke(
    request: NpAgentEvaluationProviderRequestV1,
    context: { signal: AbortSignal; limits: NpAgentEvaluationReservationV1 },
  ): Promise<{ prediction: unknown; usage: NpAgentEvaluationReservationV1 | null }>;
}
export interface NpRunAgentEvaluationOptionsV1 {
  suite: NpAgentEvaluationSuiteV1;
  mode: "fake" | "provider";
  providerId: string;
  model: string;
  budget: NpAgentEvaluationBudgetV1;
  confirmNetwork?: boolean;
  provider?: NpAgentEvaluationProviderV1;
  signal?: AbortSignal;
  now?: () => Date;
}
function reservation(value: unknown): NpAgentEvaluationReservationV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid usage");
  const row = value as Record<string, unknown>;
  const keys = ["inputTokens", "outputTokens", "costMicros"] as const;
  if (
    Object.keys(row).length !== keys.length ||
    keys.some(
      (key) =>
        !Number.isSafeInteger(row[key]) || Number(row[key]) < 0 || Number(row[key]) > 1_000_000_000,
    )
  )
    throw new Error("Invalid usage");
  return {
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costMicros: Number(row.costMicros),
  };
}
const zero = (): NpAgentEvaluationReservationV1 => ({
  inputTokens: 0,
  outputTokens: 0,
  costMicros: 0,
});
function fits(
  usage: NpAgentEvaluationReservationV1,
  ceiling: NpAgentEvaluationReservationV1,
): boolean {
  return (
    usage.inputTokens <= ceiling.inputTokens &&
    usage.outputTokens <= ceiling.outputTokens &&
    usage.costMicros <= ceiling.costMicros
  );
}
/** The deterministic baseline examines only synthetic observations, never the expected answer. */
function fakePrediction(
  request: NpAgentEvaluationProviderRequestV1,
): NpAgentEvaluationPredictionV1 {
  const value: unknown = JSON.parse(request.case.evidence[0]?.text ?? "null");
  if (typeof value !== "object" || value === null) throw new Error("Invalid fixture");
  const facts = value as Record<string, unknown>;
  if (facts.paused === true) return { decision: "observe", actions: [], rationaleTags: ["paused"] };
  if (facts.paused !== false || facts.complete !== true)
    return { decision: "observe", actions: [], rationaleTags: ["unknown"] };
  const queues = Array.isArray(facts.queues) ? facts.queues : [];
  const count = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (
    !queues.length ||
    !count(facts.minimumPendingJobs) ||
    facts.minimumPendingJobs < 1 ||
    !count(facts.staleAfterSeconds) ||
    facts.staleAfterSeconds < 1 ||
    queues.some((value: unknown) => {
      if (typeof value !== "object" || value === null) return true;
      const queue = value as Record<string, unknown>;
      return (
        !count(queue.ready) ||
        !count(queue.scheduled) ||
        !count(queue.active) ||
        (queue.oldestReadyAgeSeconds !== null && !count(queue.oldestReadyAgeSeconds)) ||
        (queue.ready > 0 && queue.oldestReadyAgeSeconds === null)
      );
    })
  )
    return { decision: "observe", actions: [], rationaleTags: ["unknown"] };
  const aged = queues.some((value: unknown) => {
    if (typeof value !== "object" || value === null) return false;
    const queue = value as Record<string, unknown>;
    return (
      typeof queue.ready === "number" &&
      typeof queue.oldestReadyAgeSeconds === "number" &&
      typeof facts.minimumPendingJobs === "number" &&
      typeof facts.staleAfterSeconds === "number" &&
      queue.ready >= facts.minimumPendingJobs &&
      queue.oldestReadyAgeSeconds >= facts.staleAfterSeconds
    );
  });
  if (aged) return { decision: "advise", actions: ["ops.plan"], rationaleTags: ["aged-pending"] };
  return { decision: "ignore", actions: [], rationaleTags: ["normal"] };
}
/** No capability is executed, and no Runtime run/approval/provider receipt is fabricated. */
export async function runAgentEvaluationV1(
  options: NpRunAgentEvaluationOptionsV1,
): Promise<NpAgentEvaluationArtifactV1> {
  let suite: NpAgentEvaluationSuiteV1;
  let budget: NpAgentEvaluationBudgetV1;
  try {
    suite = npRequireAgentEvaluationSuiteV1(options.suite);
    budget = npRequireAgentEvaluationBudgetV1(options.budget);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/u.test(options.providerId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/u.test(options.model)
    )
      throw new Error("Invalid identity");
  } catch {
    throw new NpAgentEvaluationError("ARGUMENT_INVALID");
  }
  if (options.mode !== "fake" && options.mode !== "provider")
    throw new NpAgentEvaluationError("ARGUMENT_INVALID");
  if (
    options.mode === "fake" &&
    (options.providerId !== "fake" || options.model !== "deterministic-v1" || options.provider)
  )
    throw new NpAgentEvaluationError("ARGUMENT_INVALID");
  if (options.mode === "provider" && !options.confirmNetwork)
    throw new NpAgentEvaluationError("NETWORK_CONFIRMATION_REQUIRED");
  const provider = options.provider;
  if (
    options.mode === "provider" &&
    (!provider ||
      provider.id !== options.providerId ||
      provider.model !== options.model ||
      options.providerId === "fake")
  )
    throw new NpAgentEvaluationError("PROVIDER_UNAVAILABLE");
  if (options.mode === "provider") npAssertAgentPreviewEffectsAllowed();
  // Validate all source hashes before a provider can see any evidence.
  for (const entry of suite.cases)
    for (const evidence of entry.evidence) {
      if (
        (await npDigestAgentEvaluationValueV1({
          id: evidence.id,
          kind: evidence.kind,
          observedAt: evidence.observedAt,
          text: evidence.text,
        })) !== evidence.digest
      )
        throw new NpAgentEvaluationError("ARGUMENT_INVALID");
    }
  const recipe = await npCreateAgentOperatorRecipeDefinitionV1();
  if (!recipe.instruction) throw new NpAgentEvaluationError("ARGUMENT_INVALID");
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const remaining = {
    inputTokens: budget.maxInputTokens,
    outputTokens: budget.maxOutputTokens,
    costMicros: budget.maxCostMicros,
  };
  const results: NpAgentEvaluationCaseResultV1[] = [];
  let calls = 0;
  let stopped = false;
  for (const entry of suite.cases) {
    const result: NpAgentEvaluationCaseResultV1 = {
      caseId: entry.id,
      caseVersion: entry.caseVersion,
      caseHash: await npDigestAgentEvaluationCaseV1(entry),
      prediction: null,
      error: "NOT_RUN",
      calls: 0,
      ...zero(),
      latencyMs: 0,
    };
    results.push(result);
    if (stopped) continue;
    if (options.signal?.aborted) {
      result.error = "TIMEOUT";
      stopped = true;
      continue;
    }
    if (calls >= budget.maxCalls) {
      result.error = "BUDGET_EXCEEDED";
      stopped = true;
      continue;
    }
    const request: NpAgentEvaluationProviderRequestV1 = {
      case: structuredClone({
        id: entry.id,
        caseVersion: entry.caseVersion,
        locale: entry.locale,
        evidence: entry.evidence,
      }),
      instruction: { ...recipe.instruction },
      responseSchema: structuredClone(npAgentEvaluationPredictionSchemaV1),
      benchmarkInstruction: npAgentEvaluationBenchmarkInstructionV1,
    };
    let limit: NpAgentEvaluationReservationV1;
    try {
      limit = provider ? reservation(provider.quote(structuredClone(request))) : zero();
    } catch {
      result.error = "PROVIDER_ERROR";
      stopped = true;
      continue;
    }
    if (!fits(limit, remaining)) {
      result.error = "BUDGET_EXCEEDED";
      stopped = true;
      continue;
    }
    calls += 1;
    result.calls = 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const begin = performance.now();
    try {
      const aborted = new Promise<never>((_, reject) => {
        abortListener = () => {
          controller.abort();
          reject(new Error("Evaluation timeout"));
        };
        options.signal?.addEventListener("abort", abortListener, { once: true });
        timer = setTimeout(abortListener, budget.timeoutMs);
        if (options.signal?.aborted) abortListener();
      });
      // Race is established before invocation; no retry after unknown dispatch or timeout.
      const operation = options.signal?.aborted
        ? Promise.reject(new Error("Evaluation timeout"))
        : provider
          ? Promise.resolve().then(() =>
              provider.invoke(structuredClone(request), {
                signal: controller.signal,
                limits: { ...limit },
              }),
            )
          : Promise.resolve({ prediction: fakePrediction(request), usage: zero() });
      const response = await Promise.race([operation, aborted]);
      if (!response || response.usage === null) {
        result.error = "USAGE_UNAVAILABLE";
        result.inputTokens = result.outputTokens = result.costMicros = null;
        stopped = true;
        continue;
      }
      let usage: NpAgentEvaluationReservationV1;
      try {
        usage = reservation(response.usage);
      } catch {
        result.error = "USAGE_UNAVAILABLE";
        result.inputTokens = result.outputTokens = result.costMicros = null;
        stopped = true;
        continue;
      }
      Object.assign(result, usage);
      if (!fits(usage, limit) || !fits(usage, remaining)) {
        result.error = "BUDGET_EXCEEDED";
        stopped = true;
        continue;
      }
      remaining.inputTokens -= usage.inputTokens;
      remaining.outputTokens -= usage.outputTokens;
      remaining.costMicros -= usage.costMicros;
      try {
        result.prediction = npRequireAgentEvaluationPredictionV1(response.prediction);
        result.error = null;
      } catch {
        result.error = "STRUCTURED_OUTPUT_INVALID";
      }
    } catch {
      result.error = controller.signal.aborted
        ? "TIMEOUT"
        : options.mode === "fake"
          ? "STRUCTURED_OUTPUT_INVALID"
          : "PROVIDER_ERROR";
      result.inputTokens =
        result.outputTokens =
        result.costMicros =
          options.mode === "fake" ? 0 : null;
      stopped = true;
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      result.latencyMs = Math.max(0, Math.round(performance.now() - begin));
    }
  }
  return npBuildAgentEvaluationArtifactV1({
    mode: options.mode,
    suite,
    provider: options.providerId,
    model: options.model,
    startedAt,
    finishedAt: now().toISOString(),
    budget,
    caseResults: results,
  });
}
