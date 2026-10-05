import { npRequireAgentEvaluationBudgetV1 } from "./evaluation-contract.js";

export interface NpAgentEvaluationCommandArgsV1 {
  provider: string;
  model: string;
  dataset: "operator.v1" | "publisher.v1" | "moderator.v1";
  reviewPath?: string;
  reviewsPath?: string | null;
  maxCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostMicros: number;
  confirmNetwork: boolean;
  outPath: string | null;
  comparePath: string | null;
  json: boolean;
}
export function npParseAgentEvaluationCommandArgsV1(
  args: readonly string[],
): NpAgentEvaluationCommandArgsV1 {
  const argv = args[0] === "--" ? args.slice(1) : [...args];
  const invalid = () => {
    throw new Error("Invalid Agent evaluation command arguments.");
  };
  if (
    argv.length > 24 ||
    argv.some((value) => typeof value !== "string" || value.length > 4096 || value.includes("\0"))
  )
    invalid();
  const fields = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (fields.has(flag)) invalid();
    if (["--json", "--confirm-network"].includes(flag)) fields.set(flag, true);
    else if (
      [
        "--provider",
        "--model",
        "--dataset",
        "--max-calls",
        "--max-input-tokens",
        "--max-output-tokens",
        "--max-cost-micros",
        "--out",
        "--compare",
        "--review",
        "--reviews",
      ].includes(flag)
    ) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) invalid();
      fields.set(flag, value);
    } else invalid();
  }
  const text = (flag: string): string | null =>
    typeof fields.get(flag) === "string" ? (fields.get(flag) as string) : null;
  const reviewPath = text("--review");
  if (
    reviewPath &&
    [...fields.keys()].some(
      (flag) => !["--review", "--reviews", "--compare", "--out", "--json"].includes(flag),
    )
  )
    invalid();
  if (fields.has("--reviews") && !reviewPath) invalid();
  const provider = text("--provider") ?? "fake";
  const network = provider !== "fake";
  const model = text("--model") ?? (network ? "" : "deterministic-v1");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(provider) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)
  )
    invalid();
  const dataset = text("--dataset") ?? "operator.v1";
  if (dataset !== "operator.v1" && dataset !== "publisher.v1" && dataset !== "moderator.v1")
    invalid();
  const budgetFlags = [
    "--max-calls",
    "--max-input-tokens",
    "--max-output-tokens",
    "--max-cost-micros",
  ];
  if (
    dataset === "moderator.v1" &&
    (network ||
      fields.has("--model") ||
      fields.has("--confirm-network") ||
      budgetFlags.some((flag) => fields.has(flag)))
  )
    invalid();
  if (
    network &&
    (!fields.has("--provider") ||
      !fields.has("--model") ||
      !fields.has("--dataset") ||
      !fields.has("--confirm-network") ||
      budgetFlags.some((flag) => !fields.has(flag)))
  )
    invalid();
  if (!network && (model !== "deterministic-v1" || fields.has("--confirm-network"))) invalid();
  const count = (flag: string, fallback: number): number => {
    const value = text(flag);
    if (value === null) return fallback;
    if (!/^(0|[1-9]\d{0,15})$/.test(value)) invalid();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) invalid();
    return parsed;
  };
  const budget = npRequireAgentEvaluationBudgetV1({
    maxCalls: count("--max-calls", 100),
    maxInputTokens: count("--max-input-tokens", 100_000),
    maxOutputTokens: count("--max-output-tokens", 100_000),
    maxCostMicros: count("--max-cost-micros", 0),
    timeoutMs: 5000,
  });
  return {
    provider,
    model,
    dataset: dataset as "operator.v1" | "publisher.v1" | "moderator.v1",
    ...(reviewPath ? { reviewPath, reviewsPath: text("--reviews") } : {}),
    maxCalls: budget.maxCalls,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    maxCostMicros: budget.maxCostMicros,
    confirmNetwork: network,
    outPath: text("--out"),
    comparePath: text("--compare"),
    json: fields.has("--json"),
  };
}
