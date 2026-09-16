import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import {
  canonicalRuntimeIdempotencyKey,
  cloneCanonicalRuntimeInput,
} from "./canonical-runtime-primitives.js";
import type { NpAgentContractResult, NpAgentSourceReleaseCanonicalV1 } from "./types.js";

export type { NpAgentSourceReleaseCanonicalV1, NpAgentSourceReleaseV1 } from "./types.js";
const PURPOSE = "np.agent-source-release.v1";
const PATH = "agent.canonical.sourceRelease";
const MAX_INTEGER = 2_147_483_647;
const COMMON = [
  "schemaVersion",
  "verifierVersion",
  "kind",
  "siteId",
  "sourceId",
  "releasedAt",
] as const;
const VARIANT_KEYS = {
  "runtime-run": [
    "principalId",
    "agentId",
    "agentVersionId",
    "admissionFingerprint",
    "runLimitsHash",
    "budgetSnapshotHash",
    "state",
    "finishedAt",
    "retentionEligibleAt",
    "deadlineAt",
    "admissionKeyDigest",
  ],
  "provider-call": [
    "runId",
    "runFingerprint",
    "reservationId",
    "reservationFingerprint",
    "requestDigest",
    "responseDigest",
    "state",
    "dispatchState",
    "usageSource",
    "costSource",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "costMicros",
    "finishedAt",
    "reservationFinalizedAt",
  ],
  "usage-reservation": [
    "runId",
    "agentId",
    "connectionId",
    "model",
    "pricingId",
    "pricingVersion",
    "pricingFingerprint",
    "pricingEffectiveAt",
    "reservedAt",
    "finalizedAt",
    "state",
    "reservedCalls",
    "reservedInputTokens",
    "reservedOutputTokens",
    "reservedCostMicros",
    "actualInputTokens",
    "actualCachedInputTokens",
    "actualOutputTokens",
    "actualCostMicros",
    "actualUsageSource",
    "actualCostSource",
    "budgetChargeCostMicros",
  ],
  "circuit-breaker": [
    "scopeKind",
    "scopeRef",
    "version",
    "state",
    "failureCount",
    "probeLeaseUntil",
    "updatedAt",
  ],
} as const;
export const npAgentSourceReleaseCanonicalIncludedKeysV1 = [
  ...new Set([...COMMON, ...Object.values(VARIANT_KEYS).flat()]),
];
export const npAgentSourceReleaseCanonicalExcludedKeysV1 = [
  "evidenceDigest",
  "goal",
  "context",
  "requestRedacted",
  "responseRedacted",
  "credential",
] as const;

function parse(value: unknown): NpAgentSourceReleaseCanonicalV1 {
  const clone = cloneCanonicalRuntimeInput(value, PATH, 16 * 1024);
  if (clone === null || typeof clone !== "object" || Array.isArray(clone)) {
    failCanonicalBody("shape", PATH, "must be one exact source-release object");
  }
  const kind = canonicalBodyEnum<keyof typeof VARIANT_KEYS>(
    clone.kind,
    `${PATH}.kind`,
    new Set(Object.keys(VARIANT_KEYS)),
  );
  const keys = [...COMMON, ...VARIANT_KEYS[kind]];
  const record = canonicalBodyRecord(clone, PATH, keys, keys, { seen: new WeakSet<object>() });
  if (record.schemaVersion !== PURPOSE || record.verifierVersion !== 1) {
    failCanonicalBody("invalid-field", PATH, "must use source-release v1 and verifier version 1");
  }
  const uuid = (key: string) => canonicalBodyUuid(record[key], `${PATH}.${key}`);
  const digest = (key: string) => canonicalBodySha256Digest(record[key], `${PATH}.${key}`);
  const utc = (key: string) => canonicalBodyUtc(record[key], `${PATH}.${key}`);
  const integer = (key: string, minimum = 0, maximum = MAX_INTEGER) =>
    canonicalBodyInteger(record[key], `${PATH}.${key}`, minimum, maximum);
  const nullableInteger = (key: string, maximum = MAX_INTEGER) =>
    record[key] === null ? null : integer(key, 0, maximum);
  const source = (key: string): "provider" | "adapter-estimate" | null =>
    record[key] === null
      ? null
      : canonicalBodyEnum(record[key], `${PATH}.${key}`, new Set(["provider", "adapter-estimate"]));
  const base = {
    schemaVersion: PURPOSE,
    verifierVersion: 1,
    siteId: canonicalBodySiteId(record.siteId, `${PATH}.siteId`),
    sourceId: uuid("sourceId"),
    releasedAt: utc("releasedAt"),
  } as const;
  const beforeRelease = (timestamp: string) => {
    if (timestamp > base.releasedAt)
      failCanonicalBody("invalid-field", PATH, "must not release before terminal evidence time");
  };
  let result: NpAgentSourceReleaseCanonicalV1;
  if (kind === "runtime-run") {
    const finishedAt = utc("finishedAt");
    const retentionEligibleAt = utc("retentionEligibleAt");
    beforeRelease(retentionEligibleAt);
    if (retentionEligibleAt < finishedAt)
      failCanonicalBody("invalid-field", PATH, "retention eligibility must not precede finish");
    result = {
      ...base,
      kind,
      principalId: uuid("principalId"),
      agentId: uuid("agentId"),
      agentVersionId: uuid("agentVersionId"),
      admissionFingerprint: digest("admissionFingerprint"),
      runLimitsHash: digest("runLimitsHash"),
      budgetSnapshotHash: digest("budgetSnapshotHash"),
      admissionKeyDigest: digest("admissionKeyDigest"),
      state: canonicalBodyEnum(
        record.state,
        `${PATH}.state`,
        new Set(["succeeded", "failed", "cancelled", "policy_blocked", "budget_blocked"]),
      ),
      finishedAt,
      retentionEligibleAt,
      deadlineAt: utc("deadlineAt"),
    };
  } else if (kind === "provider-call") {
    const dispatchState = canonicalBodyEnum<"dispatched" | "not-dispatched">(
      record.dispatchState,
      `${PATH}.dispatchState`,
      new Set(["dispatched", "not-dispatched"]),
    );
    const usageSource = source("usageSource");
    const costSource = source("costSource");
    const inputTokens = nullableInteger("inputTokens");
    const cachedInputTokens = nullableInteger("cachedInputTokens");
    const outputTokens = nullableInteger("outputTokens");
    const costMicros = nullableInteger("costMicros", Number.MAX_SAFE_INTEGER);
    const amounts = [
      usageSource,
      costSource,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costMicros,
    ];
    if (
      dispatchState === "dispatched"
        ? amounts.some((item) => item === null)
        : amounts.some((item) => item !== null)
    )
      failCanonicalBody(
        "invalid-field",
        PATH,
        "dispatch must match known usage or proven non-dispatch",
      );
    if (inputTokens !== null && cachedInputTokens !== null && cachedInputTokens > inputTokens)
      failCanonicalBody("invalid-field", PATH, "cached tokens must not exceed input tokens");
    const finishedAt = utc("finishedAt");
    const reservationFinalizedAt = utc("reservationFinalizedAt");
    beforeRelease(finishedAt);
    beforeRelease(reservationFinalizedAt);
    const state = canonicalBodyEnum<"succeeded" | "failed" | "cancelled">(
      record.state,
      `${PATH}.state`,
      new Set(["succeeded", "failed", "cancelled"]),
    );
    if (state === "succeeded" && dispatchState !== "dispatched")
      failCanonicalBody("invalid-field", PATH, "success requires dispatch");
    result = {
      ...base,
      kind,
      runId: uuid("runId"),
      runFingerprint: digest("runFingerprint"),
      reservationId: uuid("reservationId"),
      reservationFingerprint: digest("reservationFingerprint"),
      requestDigest: digest("requestDigest"),
      responseDigest: digest("responseDigest"),
      state,
      dispatchState,
      usageSource,
      costSource,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costMicros,
      finishedAt,
      reservationFinalizedAt,
    };
  } else if (kind === "usage-reservation") {
    const state = canonicalBodyEnum<"reconciled" | "released">(
      record.state,
      `${PATH}.state`,
      new Set(["reconciled", "released"]),
    );
    const actualInputTokens = nullableInteger("actualInputTokens");
    const actualCachedInputTokens = nullableInteger("actualCachedInputTokens");
    const actualOutputTokens = nullableInteger("actualOutputTokens");
    const actualCostMicros = nullableInteger("actualCostMicros", Number.MAX_SAFE_INTEGER);
    const actualUsageSource = source("actualUsageSource");
    const actualCostSource = source("actualCostSource");
    const budgetChargeCostMicros = integer("budgetChargeCostMicros", 0, Number.MAX_SAFE_INTEGER);
    const amounts = [
      actualInputTokens,
      actualCachedInputTokens,
      actualOutputTokens,
      actualCostMicros,
      actualUsageSource,
      actualCostSource,
    ];
    if (
      state === "released"
        ? amounts.some((item) => item !== null) || budgetChargeCostMicros !== 0
        : amounts.some((item) => item === null) || budgetChargeCostMicros !== actualCostMicros
    )
      failCanonicalBody(
        "invalid-field",
        PATH,
        "final reservation state must match exact known accounting",
      );
    if (
      actualInputTokens !== null &&
      actualCachedInputTokens !== null &&
      actualCachedInputTokens > actualInputTokens
    )
      failCanonicalBody("invalid-field", PATH, "cached tokens must not exceed input tokens");
    const reservedAt = utc("reservedAt");
    const finalizedAt = utc("finalizedAt");
    const pricingEffectiveAt = utc("pricingEffectiveAt");
    beforeRelease(finalizedAt);
    if (pricingEffectiveAt > reservedAt || reservedAt > finalizedAt)
      failCanonicalBody(
        "invalid-field",
        PATH,
        "pricing and reservation timestamps must be ordered",
      );
    if (
      typeof record.pricingFingerprint !== "string" ||
      !/^pr1:sha256:[A-Za-z0-9_-]{43}$/u.test(record.pricingFingerprint)
    )
      failCanonicalBody(
        "invalid-field",
        `${PATH}.pricingFingerprint`,
        "must be a canonical pricing digest",
      );
    result = {
      ...base,
      kind,
      runId: uuid("runId"),
      agentId: uuid("agentId"),
      connectionId: uuid("connectionId"),
      model: canonicalBodyAscii(record.model, `${PATH}.model`, 128),
      pricingId: canonicalBodyAscii(record.pricingId, `${PATH}.pricingId`, 128),
      pricingVersion: integer("pricingVersion", 1),
      pricingFingerprint: record.pricingFingerprint,
      pricingEffectiveAt,
      reservedAt,
      finalizedAt,
      state,
      reservedCalls: integer("reservedCalls", 1),
      reservedInputTokens: integer("reservedInputTokens"),
      reservedOutputTokens: integer("reservedOutputTokens"),
      reservedCostMicros: integer("reservedCostMicros", 0, Number.MAX_SAFE_INTEGER),
      actualInputTokens,
      actualCachedInputTokens,
      actualOutputTokens,
      actualCostMicros,
      actualUsageSource,
      actualCostSource,
      budgetChargeCostMicros,
    };
  } else {
    const scopeKind = canonicalBodyEnum<"site" | "agent" | "connection" | "subject">(
      record.scopeKind,
      `${PATH}.scopeKind`,
      new Set(["site", "agent", "connection", "subject"]),
    );
    const scopeRef =
      scopeKind === "site"
        ? canonicalBodySiteId(record.scopeRef, `${PATH}.scopeRef`)
        : scopeKind === "subject"
          ? canonicalBodyAscii(record.scopeRef, `${PATH}.scopeRef`, 43)
          : uuid("scopeRef");
    if (
      (scopeKind === "site" && scopeRef !== base.siteId) ||
      (scopeKind === "subject" && !/^[A-Za-z0-9_-]{43}$/u.test(scopeRef))
    )
      failCanonicalBody("invalid-field", PATH, "must preserve the exact breaker scope");
    if (record.state !== "closed" || record.failureCount !== 0 || record.probeLeaseUntil !== null)
      failCanonicalBody("invalid-field", PATH, "only an idle closed breaker can be released");
    const updatedAt = utc("updatedAt");
    beforeRelease(updatedAt);
    result = {
      ...base,
      kind,
      scopeKind,
      scopeRef,
      version: integer("version", 1),
      state: "closed",
      failureCount: 0,
      probeLeaseUntil: null,
      updatedAt,
    };
  }
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentSourceReleaseCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentSourceReleaseCanonicalV1> {
  return analyzeCanonicalBody(PATH, () => parse(value));
}
export function npRequireAgentSourceReleaseV1(value: unknown): NpAgentSourceReleaseCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentSourceReleaseCanonical(value),
    "Invalid Agent source-release body",
  );
}
export async function npDigestAgentSourceReleaseV1(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    buildAgentCanonicalFoundationBytes(PURPOSE, npRequireAgentSourceReleaseV1(value))
      .domainSeparatedUtf8,
  );
}

/** The current Runtime admission key scope, retained without storing the raw key. */
export async function npDigestAgentRuntimeAdmissionKeyV1(value: {
  siteId: string;
  principalId: string;
  idempotencyKey: string;
}): Promise<`cj1:sha256:${string}`> {
  const path = "agent.runtime.admissionKey";
  const record = canonicalBodyRecord(
    value,
    path,
    ["siteId", "principalId", "idempotencyKey"],
    ["siteId", "principalId", "idempotencyKey"],
    { seen: new WeakSet<object>() },
  );
  const tuple = [
    canonicalBodySiteId(record.siteId, `${path}.siteId`),
    "runtime",
    canonicalBodyUuid(record.principalId, `${path}.principalId`),
    canonicalRuntimeIdempotencyKey(record.idempotencyKey, `${path}.idempotencyKey`),
  ];
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-runtime-admission-key.v1\0${serializeAgentCanonicalJson(tuple)}`,
    ),
  );
}
