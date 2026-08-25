import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
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
import {
  NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS,
  NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS,
  npAgentActorBucketPurposesV1,
  npAgentActorRestrictionScopes,
  npAgentRestrictionPrincipalKinds,
  type NpAgentActorBucketPurposeV1,
  type NpAgentActorRestrictionScope,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentRestrictionAuthenticatedPrincipalSubjectV1,
  type NpAgentRestrictionCanonicalV1,
  type NpAgentRestrictionOpaqueActorBucketSubjectV1,
  type NpAgentRestrictionPrincipalKind,
  type NpAgentRestrictionSubjectV1,
} from "./types.js";

const PURPOSE = "np.agent-restriction.v1" as const;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const PROJECTION_FINGERPRINT_CHARACTERS = 256;
const ACTOR_BUCKET_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const ACTOR_BUCKET_PURPOSES = new Set<string>(npAgentActorBucketPurposesV1);
const ACTION_SCOPES = new Set<string>(npAgentActorRestrictionScopes);
const PRINCIPAL_KINDS = new Set<string>(npAgentRestrictionPrincipalKinds);
const SUBJECT_KINDS = new Set<string>(["authenticated_principal", "opaque_actor_bucket"]);

export const npAgentRestrictionCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "restrictionId",
  "siteId",
  "subject",
  "actionScopes",
  "startsAt",
  "expiresAt",
  "reasonCode",
  "targetVersionDigest",
] as const satisfies readonly (keyof NpAgentRestrictionCanonicalV1)[];

export const npAgentRestrictionCanonicalExcludedKeysV1 = [
  "restrictionHash",
  "status",
  "containmentId",
  "actionId",
  "incidentId",
  "enforcementAdapter",
  "enforcementAdapterContractVersion",
  "enforcementAdapterFingerprint",
  "enforcementRef",
  "installReceipt",
  "removalReceipt",
  "lastErrorCode",
  "rowVersion",
  "createdAt",
  "updatedAt",
  "revokedAt",
] as const;

export const npAgentRestrictionAuthenticatedPrincipalSubjectIncludedKeysV1 = [
  "kind",
  "principalKind",
  "principalId",
] as const satisfies readonly (keyof NpAgentRestrictionAuthenticatedPrincipalSubjectV1)[];

export const npAgentRestrictionOpaqueActorBucketSubjectIncludedKeysV1 = [
  "kind",
  "purpose",
  "projectionVersion",
  "projectionFingerprint",
  "keyId",
  "bucket",
] as const satisfies readonly (keyof NpAgentRestrictionOpaqueActorBucketSubjectV1)[];

const SUBJECT_KEYS = [
  ...new Set<string>([
    ...npAgentRestrictionAuthenticatedPrincipalSubjectIncludedKeysV1,
    ...npAgentRestrictionOpaqueActorBucketSubjectIncludedKeysV1,
  ]),
] as const;

function requireExactBranchKeys(
  record: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "is not part of this subject branch");
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      failCanonicalBody("missing-field", `${path}.${key}`, "is required for this subject branch");
    }
  }
}

function parseActorBucket(value: unknown, path: string): string {
  if (typeof value !== "string" || !ACTOR_BUCKET_PATTERN.test(value)) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must be exactly 43 unpadded base64url HMAC characters",
    );
  }
  return value;
}

function parseStableCode(value: unknown, path: string): string {
  if (typeof value !== "string" || !STABLE_CODE_PATTERN.test(value)) {
    failCanonicalBody("invalid-field", path, "must be a 1..64 character stable uppercase code");
  }
  return value;
}

function parseSubject(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentRestrictionSubjectV1 {
  const record = canonicalBodyRecord(value, path, SUBJECT_KEYS, ["kind"], state);
  const kind = canonicalBodyEnum<NpAgentRestrictionSubjectV1["kind"]>(
    record.kind,
    `${path}.kind`,
    SUBJECT_KINDS,
  );
  if (kind === "authenticated_principal") {
    requireExactBranchKeys(
      record,
      path,
      npAgentRestrictionAuthenticatedPrincipalSubjectIncludedKeysV1,
    );
    return {
      kind,
      principalKind: canonicalBodyEnum<NpAgentRestrictionPrincipalKind>(
        record.principalKind,
        `${path}.principalKind`,
        PRINCIPAL_KINDS,
      ),
      principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`),
    };
  }

  requireExactBranchKeys(record, path, npAgentRestrictionOpaqueActorBucketSubjectIncludedKeysV1);
  return {
    kind,
    purpose: canonicalBodyEnum<NpAgentActorBucketPurposeV1>(
      record.purpose,
      `${path}.purpose`,
      ACTOR_BUCKET_PURPOSES,
    ),
    projectionVersion: canonicalBodyInteger(
      record.projectionVersion,
      `${path}.projectionVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    projectionFingerprint: canonicalBodyAscii(
      record.projectionFingerprint,
      `${path}.projectionFingerprint`,
      PROJECTION_FINGERPRINT_CHARACTERS,
    ),
    keyId: canonicalBodyIdentifier(record.keyId, `${path}.keyId`),
    bucket: parseActorBucket(record.bucket, `${path}.bucket`),
  };
}

function parseActionScopes(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentActorRestrictionScope[] {
  const entries = canonicalBodyArray(value, path, npAgentActorRestrictionScopes.length, state);
  if (entries.length === 0) {
    failCanonicalBody("invalid-field", path, "must contain at least one restriction scope");
  }
  const result: NpAgentActorRestrictionScope[] = [];
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const entryPath = `${path}[${index.toString()}]`;
    const current = canonicalBodyEnum<NpAgentActorRestrictionScope>(
      entry,
      entryPath,
      ACTION_SCOPES,
    );
    if (previous !== null && current <= previous) {
      failCanonicalBody(
        current === previous ? "duplicate" : "order",
        entryPath,
        "must be sorted unique by canonical ASCII value",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parseRestrictionCanonical(value: unknown): NpAgentRestrictionCanonicalV1 {
  const path = "agent.canonical.restriction";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentRestrictionCanonicalIncludedKeysV1,
    npAgentRestrictionCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PURPOSE) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${PURPOSE}`);
  }

  const startsAt = canonicalBodyUtc(record.startsAt, `${path}.startsAt`);
  const expiresAt = canonicalBodyUtc(record.expiresAt, `${path}.expiresAt`);
  const durationMilliseconds = Date.parse(expiresAt) - Date.parse(startsAt);
  const minimumMilliseconds = NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS * 1_000;
  const maximumMilliseconds = NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS * 1_000;
  if (durationMilliseconds < minimumMilliseconds || durationMilliseconds > maximumMilliseconds) {
    failCanonicalBody(
      "invalid-field",
      `${path}.expiresAt`,
      `must be ${NP_AGENT_ACTOR_RESTRICTION_TTL_MIN_SECONDS.toString()}..${NP_AGENT_ACTOR_RESTRICTION_TTL_MAX_SECONDS.toString()} seconds after startsAt`,
    );
  }

  const result: NpAgentRestrictionCanonicalV1 = {
    schemaVersion: PURPOSE,
    restrictionId: canonicalBodyUuid(record.restrictionId, `${path}.restrictionId`),
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    subject: parseSubject(record.subject, `${path}.subject`, state),
    actionScopes: parseActionScopes(record.actionScopes, `${path}.actionScopes`, state),
    startsAt,
    expiresAt,
    reasonCode: parseStableCode(record.reasonCode, `${path}.reasonCode`),
    targetVersionDigest: canonicalBodySha256Digest(
      record.targetVersionDigest,
      `${path}.targetVersionDigest`,
    ),
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentRestrictionCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentRestrictionCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.restriction", () =>
    parseRestrictionCanonical(value),
  );
}

export function npRequireAgentRestrictionCanonical(value: unknown): NpAgentRestrictionCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRestrictionCanonical(value),
    "Invalid Agent restriction canonical body",
  );
}

export function npBuildAgentRestrictionCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-restriction.v1", NpAgentRestrictionCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentRestrictionCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-restriction.v1",
    NpAgentRestrictionCanonicalV1
  >;
}

export async function npDigestAgentRestrictionCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentRestrictionCanonicalBytes(value).domainSeparatedUtf8,
  );
}
