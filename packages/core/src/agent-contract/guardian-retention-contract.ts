import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentEventCanonicalV1 } from "./types.js";

export const npAgentGuardianRetentionFamiliesV1 = [
  "requests",
  "security-transitions",
  "content",
  "sentry",
  "runtime",
  "http",
] as const;
export type NpAgentGuardianRetentionFamilyV1 = (typeof npAgentGuardianRetentionFamiliesV1)[number];
export const npAgentGuardianSourcePairsV1 = {
  requests: {
    "auth.guardian": "auth.login.failed",
    "api.guardian": "api.rate-limited",
    "auth.guardian-session": "auth.login.succeeded",
  },
  "security-transitions": {
    "guardian.authority.v1": "security.authority.changed",
    "guardian.policy.v1": "agent.policy.changed",
    "guardian.credential.v1": "security.credential.changed",
    "guardian.plugin.v1": "security.plugin.changed",
  },
  content: { "guardian.content.v1": "content.activity.observed" },
  sentry: { "sentry.issue-created.v1": "security.error.signal" },
  runtime: { "guardian.runtime.v1": "agent.runtime.activity.observed" },
  http: { "guardian.http.v1": "http.response.observed" },
} as const;
export interface NpAgentGuardianSourceClosureV1 {
  schemaVersion: "np.agent-guardian-source-closure.v1";
  siteId: string;
  family: NpAgentGuardianRetentionFamilyV1;
  namespaceDigest: string;
  closedBefore: string;
  closedAt: string;
  revision: number;
  retentionPolicyDigest: string;
}
/** Closure denies future historical delivery; it is not a completeness claim or authority to delete evidence. */
export function npRequireAgentGuardianSourceClosureV1(
  value: unknown,
): NpAgentGuardianSourceClosureV1 {
  const p = "guardian.retention.closure";
  const keys = [
    "schemaVersion",
    "siteId",
    "family",
    "namespaceDigest",
    "closedBefore",
    "closedAt",
    "revision",
    "retentionPolicyDigest",
  ];
  const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, p, 4096), p, keys, keys, {
    seen: new WeakSet(),
  });
  const closedBefore = canonicalBodyUtc(row.closedBefore, p),
    closedAt = canonicalBodyUtc(row.closedAt, p);
  if (
    row.schemaVersion !== "np.agent-guardian-source-closure.v1" ||
    closedBefore > closedAt ||
    Date.parse(closedBefore) % 600000 !== 0
  )
    failCanonicalBody("invalid-field", p, "Invalid monotonic source delivery closure");
  return {
    schemaVersion: "np.agent-guardian-source-closure.v1",
    siteId: canonicalBodySiteId(row.siteId, p),
    family: canonicalBodyEnum<NpAgentGuardianRetentionFamilyV1>(
      row.family,
      p,
      new Set(npAgentGuardianRetentionFamiliesV1),
    ),
    namespaceDigest: canonicalBodySha256Digest(row.namespaceDigest, p),
    closedBefore,
    closedAt,
    revision: canonicalBodyInteger(row.revision, p, 1, 2147483647),
    retentionPolicyDigest: canonicalBodySha256Digest(row.retentionPolicyDigest, p),
  };
}
export async function npDigestAgentGuardianRetentionValueV1(
  domain: string,
  value: unknown,
): Promise<string> {
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(`${domain}\0${serializeAgentCanonicalJson(value)}`),
  );
}
export async function npAgentGuardianSourceNamespaceDigestV1(
  family: NpAgentGuardianRetentionFamilyV1,
): Promise<string> {
  return npDigestAgentGuardianRetentionValueV1("np.agent-guardian-source-namespace.v1", {
    family,
    // Identity is independent of key rotation and additive detector/source inventories.
    // A closure never claims that every source in the family was installed or observed.
    namespaceVersion: 1,
  });
}
export async function npAgentGuardianSourceDeliveryKeyDigestV1(
  event: NpAgentEventCanonicalV1,
): Promise<string> {
  if (!event.deduplicationKey)
    failCanonicalBody(
      "invalid-field",
      "guardian.retention",
      "A source delivery requires its exact deduplication identity",
    );
  return npDigestAgentGuardianRetentionValueV1("np.agent-guardian-source-delivery-key.v1", {
    siteId: event.siteId,
    source: event.source,
    kind: event.kind,
    deduplicationKey: event.deduplicationKey,
  });
}
