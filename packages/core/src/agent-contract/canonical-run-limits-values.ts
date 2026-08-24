import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import type { NpAgentRunLimitsCanonicalV1 } from "./types.js";

const SAFE_INTEGER_MAXIMUM = Number.MAX_SAFE_INTEGER;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const RUN_WALL_CLOCK_MAXIMUM_SECONDS = 86_400;

export const npAgentRunLimitsCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "maxAttempts",
  "maxProviderCalls",
  "maxCapabilityCalls",
  "maxInputTokens",
  "maxOutputTokens",
  "maxCostMicros",
  "maxWallClockSeconds",
] as const satisfies readonly (keyof NpAgentRunLimitsCanonicalV1)[];

export const npAgentRunLimitsCanonicalExcludedKeysV1 = [
  "limitsHash",
  "runLimitsHash",
  "resolvedAt",
  "sourceRefs",
] as const;

export function parseAgentRunLimitsCanonical(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRunLimitsCanonicalV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRunLimitsCanonicalIncludedKeysV1,
    npAgentRunLimitsCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== "np.agent-run-limits.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-run-limits.v1");
  }
  return {
    schemaVersion: "np.agent-run-limits.v1",
    maxAttempts: canonicalBodyInteger(
      record.maxAttempts,
      `${path}.maxAttempts`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxProviderCalls: canonicalBodyInteger(
      record.maxProviderCalls,
      `${path}.maxProviderCalls`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxCapabilityCalls: canonicalBodyInteger(
      record.maxCapabilityCalls,
      `${path}.maxCapabilityCalls`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxInputTokens: canonicalBodyInteger(
      record.maxInputTokens,
      `${path}.maxInputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxOutputTokens: canonicalBodyInteger(
      record.maxOutputTokens,
      `${path}.maxOutputTokens`,
      0,
      SIGNED_32_BIT_MAXIMUM,
    ),
    maxCostMicros: canonicalBodyInteger(
      record.maxCostMicros,
      `${path}.maxCostMicros`,
      0,
      SAFE_INTEGER_MAXIMUM,
    ),
    maxWallClockSeconds: canonicalBodyInteger(
      record.maxWallClockSeconds,
      `${path}.maxWallClockSeconds`,
      1,
      RUN_WALL_CLOCK_MAXIMUM_SECONDS,
    ),
  };
}
