import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import { parseAgentRunLimitsCanonical } from "./canonical-run-limits-values.js";
import {
  npAgentBudgetSourceKinds,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentRecipeIds,
  type NpAgentBudgetSnapshotCanonicalV1,
  type NpAgentBudgetSnapshotCountersV1,
  type NpAgentBudgetSnapshotRecipeV1,
  type NpAgentBudgetSnapshotReservationV1,
  type NpAgentBudgetSnapshotSourceRefV1,
  type NpAgentBudgetSnapshotWindowsV1,
  type NpAgentBudgetSourceKind,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentRecipeId,
} from "./types.js";

const PURPOSE = "np.agent-budget-snapshot.v1" as const;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const SAFE_INTEGER_MAXIMUM = Number.MAX_SAFE_INTEGER;
const MAXIMUM_SOURCE_REFS = npAgentCanonicalBodyMaxBytesV1[PURPOSE];
const SOURCE_KINDS = new Set<string>(npAgentBudgetSourceKinds);
const RECIPE_IDS = new Set<string>(npAgentRecipeIds);
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const UTC_MONTH_PATTERN = /^\d{4}-\d{2}$/u;

export const npAgentBudgetSnapshotCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "principalId",
  "agentId",
  "recipe",
  "capturedAt",
  "sourceRefs",
  "limits",
  "counters",
  "windows",
  "reservation",
] as const satisfies readonly (keyof NpAgentBudgetSnapshotCanonicalV1)[];

export const npAgentBudgetSnapshotCanonicalExcludedKeysV1 = [
  "snapshotDigest",
  "budgetSnapshotHash",
  "runId",
  "runState",
  "attempt",
  "usage",
  "result",
  "errorCode",
  "leaseUntil",
  "finishedAt",
] as const;

export const npAgentBudgetSnapshotRecipeIncludedKeysV1 = [
  "id",
  "version",
  "fingerprint",
] as const satisfies readonly (keyof NpAgentBudgetSnapshotRecipeV1)[];

export const npAgentBudgetSnapshotSourceRefIncludedKeysV1 = [
  "kind",
  "id",
  "version",
  "digest",
] as const satisfies readonly (keyof NpAgentBudgetSnapshotSourceRefV1)[];

export const npAgentBudgetSnapshotCountersIncludedKeysV1 = [
  "concurrentRuns",
  "concurrentProviderCalls",
  "runsRollingHour",
  "providerCallsRollingHour",
  "inputTokensUtcDay",
  "outputTokensUtcDay",
  "inputTokensUtcMonth",
  "outputTokensUtcMonth",
  "costMicrosUtcDay",
  "costMicrosUtcMonth",
  "incidentAnalysesFingerprintUtcDay",
  "directActionsRollingHour",
  "directActionsSubjectRollingHour",
] as const satisfies readonly (keyof NpAgentBudgetSnapshotCountersV1)[];

export const npAgentBudgetSnapshotWindowsIncludedKeysV1 = [
  "rollingHourStartedAt",
  "utcDay",
  "utcMonth",
] as const satisfies readonly (keyof NpAgentBudgetSnapshotWindowsV1)[];

export const npAgentBudgetSnapshotReservationIncludedKeysV1 = [
  "runs",
  "providerCalls",
  "inputTokens",
  "outputTokens",
  "costMicros",
] as const satisfies readonly (keyof NpAgentBudgetSnapshotReservationV1)[];

function parseRecipe(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentBudgetSnapshotRecipeV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentBudgetSnapshotRecipeIncludedKeysV1,
    npAgentBudgetSnapshotRecipeIncludedKeysV1,
    state,
  );
  return {
    id: canonicalBodyEnum<NpAgentRecipeId>(record.id, `${path}.id`, RECIPE_IDS),
    version: canonicalBodyInteger(record.version, `${path}.version`, 1, SIGNED_32_BIT_MAXIMUM),
    fingerprint: canonicalBodySha256Digest(record.fingerprint, `${path}.fingerprint`),
  };
}

function compareSourceRefs(
  left: NpAgentBudgetSnapshotSourceRefV1,
  right: NpAgentBudgetSnapshotSourceRefV1,
): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  const leftId = left.id ?? "";
  const rightId = right.id ?? "";
  if (leftId !== rightId) return leftId < rightId ? -1 : 1;
  if (left.version !== right.version) return left.version - right.version;
  if (left.digest === right.digest) return 0;
  return left.digest < right.digest ? -1 : 1;
}

function parseSourceRefs(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentBudgetSnapshotSourceRefV1[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_SOURCE_REFS, state);
  const result: NpAgentBudgetSnapshotSourceRefV1[] = [];
  let previous: NpAgentBudgetSnapshotSourceRefV1 | undefined;
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const record = canonicalBodyRecord(
      entry,
      entryPath,
      npAgentBudgetSnapshotSourceRefIncludedKeysV1,
      npAgentBudgetSnapshotSourceRefIncludedKeysV1,
      state,
    );
    const current: NpAgentBudgetSnapshotSourceRefV1 = {
      kind: canonicalBodyEnum<NpAgentBudgetSourceKind>(
        record.kind,
        `${entryPath}.kind`,
        SOURCE_KINDS,
      ),
      id: record.id === null ? null : canonicalBodyAscii(record.id, `${entryPath}.id`, 128),
      version: canonicalBodyInteger(
        record.version,
        `${entryPath}.version`,
        1,
        SIGNED_32_BIT_MAXIMUM,
      ),
      digest: canonicalBodySha256Digest(record.digest, `${entryPath}.digest`),
    };
    if (previous !== undefined) {
      const order = compareSourceRefs(current, previous);
      if (order <= 0) {
        failCanonicalBody(
          order === 0 ? "duplicate" : "order",
          entryPath,
          "must be sorted unique by (kind,id-or-empty,version,digest)",
        );
      }
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseCount(value: unknown, path: string): number {
  return canonicalBodyInteger(value, path, 0, SIGNED_32_BIT_MAXIMUM);
}

function parseCostMicros(value: unknown, path: string): number {
  return canonicalBodyInteger(value, path, 0, SAFE_INTEGER_MAXIMUM);
}

function parseCounters(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentBudgetSnapshotCountersV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentBudgetSnapshotCountersIncludedKeysV1,
    npAgentBudgetSnapshotCountersIncludedKeysV1,
    state,
  );
  return {
    concurrentRuns: parseCount(record.concurrentRuns, `${path}.concurrentRuns`),
    concurrentProviderCalls: parseCount(
      record.concurrentProviderCalls,
      `${path}.concurrentProviderCalls`,
    ),
    runsRollingHour: parseCount(record.runsRollingHour, `${path}.runsRollingHour`),
    providerCallsRollingHour: parseCount(
      record.providerCallsRollingHour,
      `${path}.providerCallsRollingHour`,
    ),
    inputTokensUtcDay: parseCount(record.inputTokensUtcDay, `${path}.inputTokensUtcDay`),
    outputTokensUtcDay: parseCount(record.outputTokensUtcDay, `${path}.outputTokensUtcDay`),
    inputTokensUtcMonth: parseCount(record.inputTokensUtcMonth, `${path}.inputTokensUtcMonth`),
    outputTokensUtcMonth: parseCount(record.outputTokensUtcMonth, `${path}.outputTokensUtcMonth`),
    costMicrosUtcDay: parseCostMicros(record.costMicrosUtcDay, `${path}.costMicrosUtcDay`),
    costMicrosUtcMonth: parseCostMicros(record.costMicrosUtcMonth, `${path}.costMicrosUtcMonth`),
    incidentAnalysesFingerprintUtcDay: parseCount(
      record.incidentAnalysesFingerprintUtcDay,
      `${path}.incidentAnalysesFingerprintUtcDay`,
    ),
    directActionsRollingHour: parseCount(
      record.directActionsRollingHour,
      `${path}.directActionsRollingHour`,
    ),
    directActionsSubjectRollingHour: parseCount(
      record.directActionsSubjectRollingHour,
      `${path}.directActionsSubjectRollingHour`,
    ),
  };
}

function parseUtcDay(value: unknown, path: string): string {
  if (typeof value !== "string" || !UTC_DAY_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical UTC calendar day");
  }
  const timestamp = `${value}T00:00:00.000Z`;
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
    failCanonicalBody("invalid-field", path, "must be a canonical UTC calendar day");
  }
  return value;
}

function parseUtcMonth(value: unknown, path: string): string {
  if (typeof value !== "string" || !UTC_MONTH_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a canonical UTC calendar month");
  }
  const timestamp = `${value}-01T00:00:00.000Z`;
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
    failCanonicalBody("invalid-field", path, "must be a canonical UTC calendar month");
  }
  return value;
}

function parseWindows(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentBudgetSnapshotWindowsV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentBudgetSnapshotWindowsIncludedKeysV1,
    npAgentBudgetSnapshotWindowsIncludedKeysV1,
    state,
  );
  return {
    rollingHourStartedAt: canonicalBodyUtc(
      record.rollingHourStartedAt,
      `${path}.rollingHourStartedAt`,
    ),
    utcDay: parseUtcDay(record.utcDay, `${path}.utcDay`),
    utcMonth: parseUtcMonth(record.utcMonth, `${path}.utcMonth`),
  };
}

function parseReservation(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentBudgetSnapshotReservationV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentBudgetSnapshotReservationIncludedKeysV1,
    npAgentBudgetSnapshotReservationIncludedKeysV1,
    state,
  );
  return {
    runs: parseCount(record.runs, `${path}.runs`),
    providerCalls: parseCount(record.providerCalls, `${path}.providerCalls`),
    inputTokens: parseCount(record.inputTokens, `${path}.inputTokens`),
    outputTokens: parseCount(record.outputTokens, `${path}.outputTokens`),
    costMicros: parseCostMicros(record.costMicros, `${path}.costMicros`),
  };
}

function parseBudgetSnapshotCanonical(value: unknown): NpAgentBudgetSnapshotCanonicalV1 {
  const path = "agent.canonical.budgetSnapshot";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentBudgetSnapshotCanonicalIncludedKeysV1,
    npAgentBudgetSnapshotCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${PURPOSE}`);
  }

  const agentId =
    record.agentId === null ? null : canonicalBodyUuid(record.agentId, `${path}.agentId`);
  const recipe =
    record.recipe === null ? null : parseRecipe(record.recipe, `${path}.recipe`, state);
  if (agentId === null && recipe !== null) {
    failCanonicalBody("invalid-field", `${path}.recipe`, "must be null when agentId is null");
  }

  const result: NpAgentBudgetSnapshotCanonicalV1 = {
    schemaVersion: PURPOSE,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`),
    agentId,
    recipe,
    capturedAt: canonicalBodyUtc(record.capturedAt, `${path}.capturedAt`),
    sourceRefs: parseSourceRefs(record.sourceRefs, `${path}.sourceRefs`, state),
    limits: parseAgentRunLimitsCanonical(record.limits, `${path}.limits`, state),
    counters: parseCounters(record.counters, `${path}.counters`, state),
    windows: parseWindows(record.windows, `${path}.windows`, state),
    reservation: parseReservation(record.reservation, `${path}.reservation`, state),
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentBudgetSnapshotCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentBudgetSnapshotCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.budgetSnapshot", () =>
    parseBudgetSnapshotCanonical(value),
  );
}

export function npRequireAgentBudgetSnapshotCanonical(
  value: unknown,
): NpAgentBudgetSnapshotCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentBudgetSnapshotCanonical(value),
    "Invalid Agent budget-snapshot canonical body",
  );
}

export function npBuildAgentBudgetSnapshotCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-budget-snapshot.v1", NpAgentBudgetSnapshotCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentBudgetSnapshotCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-budget-snapshot.v1",
    NpAgentBudgetSnapshotCanonicalV1
  >;
}

export async function npDigestAgentBudgetSnapshotCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentBudgetSnapshotCanonicalBytes(value).domainSeparatedUtf8,
  );
}
