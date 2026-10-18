import { npRequireAgentRestrictionCanonical } from "./canonical-restriction.js";
import {
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
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import {
  npAgentActorRestrictionScopes,
  type NpAgentActorRestrictionScope,
  type NpAgentRestrictionCanonicalV1,
  type NpAgentRestrictionSubjectV1,
} from "./types.js";

export const NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX = 8;
export interface NpAgentRestrictionMutationContext {
  idempotencyKey: string;
  /** Frozen descriptor generation, unchanged across install/remove retries. */
  expectedRowVersion: number;
  signal: AbortSignal;
}
export interface NpAgentRestrictionMutationResultV1 {
  schemaVersion: "np.agent-restriction-mutation-result.v1";
  status: "installed" | "already_installed" | "removed" | "already_absent";
  restrictionId: string;
  enforcementRef: string | null;
  effectiveExpiresAt: string | null;
  resultDigest: string;
}
export interface NpAgentRestrictionVerifyResultV1 {
  schemaVersion: "np.agent-restriction-verify-result.v1";
  state: "installed" | "absent" | "expired" | "unknown";
  restrictionId: string;
  effectiveExpiresAt: string | null;
  resultDigest: string;
}
export interface NpAgentRestrictionCheckV1 {
  schemaVersion: "np.agent-restriction-check.v1";
  siteId: string;
  subjects: NpAgentRestrictionSubjectV1[];
  actionScope: NpAgentActorRestrictionScope;
  observedAt: string;
}
export interface NpAgentRestrictionDecisionV1 {
  schemaVersion: "np.agent-restriction-decision.v1";
  decision: "allow" | "deny";
  restrictionId: string | null;
  matchedSubjectKey: string | null;
  expiresAt: string | null;
  resultDigest: string;
}
export interface NpAgentRestrictionHealthV1 {
  schemaVersion: "np.agent-restriction-health.v1";
  status: "ready" | "degraded" | "unavailable";
  sharedAcrossReplicas: boolean;
  checkedAt: string;
  safeCodes: string[];
}
export interface NpAgentRestrictionAdapter {
  readonly id: string;
  readonly contractVersion: number;
  readonly fingerprint: string;
  readonly sharedAcrossReplicas: boolean;
  install(
    restriction: NpAgentRestrictionCanonicalV1,
    context: NpAgentRestrictionMutationContext,
  ): Promise<NpAgentRestrictionMutationResultV1>;
  remove(
    restriction: NpAgentRestrictionCanonicalV1,
    context: NpAgentRestrictionMutationContext,
  ): Promise<NpAgentRestrictionMutationResultV1>;
  verify(
    restriction: NpAgentRestrictionCanonicalV1,
    context: { signal: AbortSignal },
  ): Promise<NpAgentRestrictionVerifyResultV1>;
  check(
    request: NpAgentRestrictionCheckV1,
    context: { signal: AbortSignal },
  ): Promise<NpAgentRestrictionDecisionV1>;
  healthCheck(): Promise<NpAgentRestrictionHealthV1>;
  shutdown?(): void | Promise<void>;
}
function fail(): never {
  return failCanonicalBody(
    "invalid-field",
    "restrictionAdapter",
    "Invalid restriction adapter contract",
  );
}
const record = (value: unknown, keys: readonly string[]) =>
  canonicalBodyRecord(
    cloneCanonicalRuntimeInput(value, "restrictionAdapter", 32768),
    "restrictionAdapter",
    keys,
    keys,
    { seen: new WeakSet<object>() },
  );
const literal = <T extends string>(value: unknown, values: readonly T[]): T =>
  canonicalBodyEnum<T>(value, "restrictionAdapter", new Set(values));
const nullableUtc = (v: unknown) => (v === null ? null : canonicalBodyUtc(v, "restrictionAdapter"));
export function npAgentRestrictionSubjectKeyV1(subject: NpAgentRestrictionSubjectV1): string {
  return subject.kind === "authenticated_principal"
    ? `principal:v1:${subject.principalKind}:${subject.principalId}`
    : `bucket:v1:${subject.purpose}:${subject.projectionVersion}:${subject.keyId}:${subject.bucket}`;
}
/** Reuse the canonical subject parser rather than accepting a second subject grammar. */
export function npRequireAgentRestrictionSubjectV1(value: unknown): NpAgentRestrictionSubjectV1 {
  return npRequireAgentRestrictionCanonical({
    schemaVersion: "np.agent-restriction.v1",
    restrictionId: "00000000-0000-4000-8000-000000000001",
    siteId: "default",
    subject: value,
    actionScopes: ["auth.staff"],
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
    reasonCode: "CONTRACT_VALIDATION",
    targetVersionDigest: `cj1:sha256:${"A".repeat(43)}`,
  }).subject;
}
export function npRequireAgentRestrictionMutationResultV1(
  value: unknown,
): NpAgentRestrictionMutationResultV1 {
  const r = record(value, [
    "schemaVersion",
    "status",
    "restrictionId",
    "enforcementRef",
    "effectiveExpiresAt",
    "resultDigest",
  ]);
  const status = literal(r.status, [
    "installed",
    "already_installed",
    "removed",
    "already_absent",
  ] as const);
  const effectiveExpiresAt = nullableUtc(r.effectiveExpiresAt);
  const enforcementRef =
    r.enforcementRef === null
      ? null
      : canonicalBodyAscii(r.enforcementRef, "restrictionAdapter.enforcementRef", 256);
  if (
    (status === "installed" || status === "already_installed") &&
    (effectiveExpiresAt === null || enforcementRef === null)
  )
    fail();
  if ((status === "removed" || status === "already_absent") && effectiveExpiresAt !== null) fail();
  return {
    schemaVersion: literal(r.schemaVersion, ["np.agent-restriction-mutation-result.v1"]),
    status,
    restrictionId: canonicalBodyUuid(r.restrictionId, "restrictionAdapter"),
    enforcementRef,
    effectiveExpiresAt,
    resultDigest: canonicalBodySha256Digest(r.resultDigest, "restrictionAdapter"),
  };
}
export function npRequireAgentRestrictionVerifyResultV1(
  value: unknown,
): NpAgentRestrictionVerifyResultV1 {
  const r = record(value, [
    "schemaVersion",
    "state",
    "restrictionId",
    "effectiveExpiresAt",
    "resultDigest",
  ]);
  const state = literal(r.state, ["installed", "absent", "expired", "unknown"] as const),
    effectiveExpiresAt = nullableUtc(r.effectiveExpiresAt);
  if ((state === "installed" || state === "expired") !== (effectiveExpiresAt !== null)) fail();
  return {
    schemaVersion: literal(r.schemaVersion, ["np.agent-restriction-verify-result.v1"]),
    state,
    restrictionId: canonicalBodyUuid(r.restrictionId, "restrictionAdapter"),
    effectiveExpiresAt,
    resultDigest: canonicalBodySha256Digest(r.resultDigest, "restrictionAdapter"),
  };
}
export function npRequireAgentRestrictionCheckV1(value: unknown): NpAgentRestrictionCheckV1 {
  const r = record(value, ["schemaVersion", "siteId", "subjects", "actionScope", "observedAt"]);
  const subjects = canonicalBodyArray(
    r.subjects,
    "restrictionAdapter.subjects",
    NP_AGENT_RESTRICTION_CHECK_SUBJECTS_MAX,
    { seen: new WeakSet<object>() },
  ).map(npRequireAgentRestrictionSubjectV1);
  if (!subjects.length) fail();
  if (subjects[0].kind === "authenticated_principal") {
    if (subjects.length !== 1) fail();
  } else {
    const purpose = subjects[0].purpose;
    if (subjects.some((s) => s.kind !== "opaque_actor_bucket" || s.purpose !== purpose)) fail();
    const keys = subjects.map(npAgentRestrictionSubjectKeyV1);
    if (keys.some((k, i) => i > 0 && k <= keys[i - 1])) fail();
  }
  return {
    schemaVersion: literal(r.schemaVersion, ["np.agent-restriction-check.v1"]),
    siteId: canonicalBodySiteId(r.siteId, "restrictionAdapter.siteId"),
    subjects,
    actionScope: literal(r.actionScope, npAgentActorRestrictionScopes),
    observedAt: canonicalBodyUtc(r.observedAt, "restrictionAdapter"),
  };
}
export function npRequireAgentRestrictionDecisionV1(
  value: unknown,
  request?: NpAgentRestrictionCheckV1,
): NpAgentRestrictionDecisionV1 {
  const r = record(value, [
    "schemaVersion",
    "decision",
    "restrictionId",
    "matchedSubjectKey",
    "expiresAt",
    "resultDigest",
  ]);
  const decision = literal(r.decision, ["allow", "deny"] as const),
    restrictionId =
      r.restrictionId === null ? null : canonicalBodyUuid(r.restrictionId, "restrictionAdapter"),
    matchedSubjectKey =
      r.matchedSubjectKey === null
        ? null
        : canonicalBodyAscii(r.matchedSubjectKey, "restrictionAdapter", 512),
    expiresAt = nullableUtc(r.expiresAt);
  if (
    decision === "allow"
      ? restrictionId !== null || matchedSubjectKey !== null || expiresAt !== null
      : restrictionId === null || matchedSubjectKey === null || expiresAt === null
  )
    fail();
  if (
    request &&
    decision === "deny" &&
    (!request.subjects.some((s) => npAgentRestrictionSubjectKeyV1(s) === matchedSubjectKey) ||
      Date.parse(expiresAt!) <= Date.parse(request.observedAt))
  )
    fail();
  return {
    schemaVersion: literal(r.schemaVersion, ["np.agent-restriction-decision.v1"]),
    decision,
    restrictionId,
    matchedSubjectKey,
    expiresAt,
    resultDigest: canonicalBodySha256Digest(r.resultDigest, "restrictionAdapter"),
  };
}
export function npRequireAgentRestrictionHealthV1(value: unknown): NpAgentRestrictionHealthV1 {
  const r = record(value, [
    "schemaVersion",
    "status",
    "sharedAcrossReplicas",
    "checkedAt",
    "safeCodes",
  ]);
  if (typeof r.sharedAcrossReplicas !== "boolean") fail();
  const safeCodes = canonicalBodyArray(r.safeCodes, "restrictionAdapter.safeCodes", 16, {
    seen: new WeakSet<object>(),
  }).map((v) => {
    if (typeof v !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(v)) fail();
    return v;
  });
  return {
    schemaVersion: literal(r.schemaVersion, ["np.agent-restriction-health.v1"]),
    status: literal(r.status, ["ready", "degraded", "unavailable"]),
    sharedAcrossReplicas: r.sharedAcrossReplicas,
    checkedAt: canonicalBodyUtc(r.checkedAt, "restrictionAdapter"),
    safeCodes,
  };
}
export function npRequireAgentRestrictionMutationKeyV1(value: unknown): string {
  const key = canonicalBodyAscii(value, "restrictionAdapter.idempotencyKey", 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(key)) fail();
  return key;
}
export function npRequireAgentRestrictionGenerationV1(value: unknown): number {
  return canonicalBodyInteger(value, "restrictionAdapter.expectedRowVersion", 1, 2147483647);
}
export const npSameAgentRestrictionSubjectV1 = (
  a: NpAgentRestrictionSubjectV1,
  b: NpAgentRestrictionSubjectV1,
): boolean => serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
