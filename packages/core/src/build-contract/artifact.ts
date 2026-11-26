import type { z } from "zod";
import { NpAgentContractError } from "../agent-contract/contract.js";
import type { NpAgentContractResult } from "../agent-contract/types.js";
import { inspectJson } from "./primitives.js";

export function requireArtifact<T>(
  value: unknown,
  schema: z.ZodType<T>,
  limits: { bytes: number; depth: number },
): T {
  const inspected = inspectJson(value, limits.bytes, limits.depth);
  const parsed = schema.safeParse(inspected);
  if (!parsed.success)
    throw new NpAgentContractError(
      "Invalid Build artifact",
      parsed.error.issues.slice(0, 20).map((issue) => ({
        code: "invalid-field",
        path: `build.${issue.path.map(String).join(".")}`,
        message:
          issue.code === "unrecognized_keys"
            ? "contains unknown fields"
            : "does not satisfy the exact Build artifact contract",
      })),
    );
  return parsed.data;
}
export function analyzeArtifact<T>(parser: () => T): NpAgentContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    return {
      ok: false,
      issues:
        error instanceof NpAgentContractError
          ? error.contractIssues
          : [{ code: "unsafe-value", path: "build", message: "could not be inspected safely" }],
    };
  }
}
