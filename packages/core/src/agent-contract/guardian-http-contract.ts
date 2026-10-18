import {
  canonicalBodyArray,
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
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { cloneCanonicalRuntimeInput, parseActorBucket } from "./canonical-runtime-primitives.js";
import {
  NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1,
  NP_AGENT_GUARDIAN_THRESHOLD_V1,
  NP_AGENT_GUARDIAN_WINDOW_MS_V1,
  npAgentGuardianRouteFamiliesV1,
  type NpAgentGuardianRouteFamilyV1,
} from "./guardian-contract.js";
import type { NpAgentActorBucketRefV1 } from "./types.js";

export const npAgentGuardianHttpStatusesV1 = [401, 403, 404] as const;
export type NpAgentGuardianHttpStatusV1 = (typeof npAgentGuardianHttpStatusesV1)[number];
export const NP_AGENT_GUARDIAN_HTTP_SOURCE_COMPONENT_V1 = "guardian.http.v1";
export const NP_AGENT_GUARDIAN_HTTP_ACTIVITY_HASH_DOMAIN_V1 = "np.guardian-http-activity.v1";
export const NP_AGENT_GUARDIAN_HTTP_SOURCE_MAC_DOMAIN_V1 = "np.guardian-http-source-receipt.v1";
export const npAgentGuardianHttpDetectorIdsV1 = ["guardian.http-responses"] as const;
export const npAgentGuardianHttpRuleBoundsV1 = Object.freeze({
  windowMs: NP_AGENT_GUARDIAN_WINDOW_MS_V1,
  responseCount: NP_AGENT_GUARDIAN_THRESHOLD_V1,
  maximumActivities: NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1,
});

// Existing observation-v1 projection, not a new projection or execution purpose.
// The source owner must also verify its installed projection and retained keys.
const NETWORK_PROJECTION_FINGERPRINT = "cj1:sha256:Tc2eBqJQ_cAuxaxGRLnoMlroKzxPGqgc5O9cQNcCJjk";
export type NpAgentGuardianHttpNetworkBucketV1 = NpAgentActorBucketRefV1 & {
  purpose: "network-address";
  projectionVersion: 1;
};

/** Private final-response facts. No path, query, body, account or error text is retained. */
export interface NpAgentGuardianHttpActivityV1 {
  schemaVersion: "np.agent-guardian-http-activity.v1";
  observationId: string;
  siteId: string;
  occurredAt: string;
  status: NpAgentGuardianHttpStatusV1;
  routeFamily: NpAgentGuardianRouteFamilyV1;
  networkBucket: NpAgentGuardianHttpNetworkBucketV1;
}
export interface NpAgentGuardianHttpEventPayloadV1 {
  kind: "http.response.observed";
  receiptId: string;
  activity: NpAgentGuardianHttpActivityV1;
}
/** Stored audit metadata only. Server verification requires the actual receipt MAC
 * and exact retained key. The MAC commits this parsed object minus sourceMac under
 * the fixed domain. bodyHash commits the Event's activity under the activity domain.
 * This receipt does not retain the network bucket or prove post-purge source facts. */
export interface NpAgentGuardianHttpSourceReceiptV1 {
  schemaVersion: "np.agent-guardian-http-receipt.v1";
  siteId: string;
  receiptId: string;
  keyId: string;
  eventId: string;
  eventHash: string;
  bodyHash: string;
  recordedAt: string;
  sourceMac: string;
}
/** Review metadata only. A 404 is an observed response, never an authorization or attack verdict. */
export interface NpAgentGuardianHttpEvidenceV1 {
  schemaVersion: "np.agent-guardian-http-evidence.v1";
  signalId: string;
  detectorId: "guardian.http-responses";
  detectorVersion: 1;
  status: NpAgentGuardianHttpStatusV1;
  routeFamily: NpAgentGuardianRouteFamilyV1;
  window: { startedAt: string; endedAt: string };
  observedCount: 5;
  countBasis: "at-least";
  assessment: "review-only";
  sourceDigest: string;
}
/** Private rule cohort, not a public actor identifier or execution target. */
export interface NpAgentGuardianHttpRuleMatchV1 extends Omit<
  NpAgentGuardianHttpEvidenceV1,
  "schemaVersion" | "signalId" | "sourceDigest"
> {
  networkBucket: NpAgentGuardianHttpNetworkBucketV1;
  observationIds: string[];
}

function status(value: unknown, path: string): NpAgentGuardianHttpStatusV1 {
  const parsed = canonicalBodyInteger(value, path, 401, 404);
  if (parsed !== 401 && parsed !== 403 && parsed !== 404)
    failCanonicalBody("invalid-field", path, "must be an observed 401, 403 or 404 response");
  return parsed;
}
function family(value: unknown, path: string): NpAgentGuardianRouteFamilyV1 {
  return canonicalBodyEnum<NpAgentGuardianRouteFamilyV1>(
    value,
    path,
    new Set(npAgentGuardianRouteFamiliesV1),
  );
}
function networkBucket(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianHttpNetworkBucketV1 {
  const bucket = parseActorBucket(value, path, state, "network-address");
  if (
    bucket.projectionVersion !== 1 ||
    bucket.projectionFingerprint !== NETWORK_PROJECTION_FINGERPRINT
  )
    failCanonicalBody(
      "invalid-field",
      path,
      "must use the existing network observation projection",
    );
  return { ...bucket, purpose: "network-address", projectionVersion: 1 };
}
function window(value: unknown, path: string, state: CanonicalBodyInspectionState) {
  const row = canonicalBodyRecord(
    value,
    path,
    ["startedAt", "endedAt"],
    ["startedAt", "endedAt"],
    state,
  );
  const startedAt = canonicalBodyUtc(row.startedAt, path),
    endedAt = canonicalBodyUtc(row.endedAt, path),
    start = Date.parse(startedAt);
  if (
    start % NP_AGENT_GUARDIAN_WINDOW_MS_V1 !== 0 ||
    endedAt < startedAt ||
    Date.parse(endedAt) >= start + NP_AGENT_GUARDIAN_WINDOW_MS_V1
  )
    failCanonicalBody("invalid-field", path, "must be one fixed UTC ten-minute window");
  return { startedAt, endedAt };
}
export function npParseAgentGuardianHttpActivityV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianHttpActivityV1 {
  const keys = [
    "schemaVersion",
    "observationId",
    "siteId",
    "occurredAt",
    "status",
    "routeFamily",
    "networkBucket",
  ];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-http-activity.v1"]),
    ),
    observationId: canonicalBodyUuid(row.observationId, path),
    siteId: canonicalBodySiteId(row.siteId, path),
    occurredAt: canonicalBodyUtc(row.occurredAt, path),
    status: status(row.status, path),
    routeFamily: family(row.routeFamily, path),
    networkBucket: networkBucket(row.networkBucket, path, state),
  };
}
export function npRequireAgentGuardianHttpActivityV1(
  value: unknown,
): NpAgentGuardianHttpActivityV1 {
  const path = "guardian.http.activity";
  return npParseAgentGuardianHttpActivityV1(cloneCanonicalRuntimeInput(value, path, 4096), path, {
    seen: new WeakSet<object>(),
  });
}
export function npParseAgentGuardianHttpEventPayloadV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianHttpEventPayloadV1 {
  const keys = ["kind", "receiptId", "activity"],
    row = canonicalBodyRecord(value, path, keys, keys, state),
    activity = npParseAgentGuardianHttpActivityV1(row.activity, path, state),
    receiptId = canonicalBodyUuid(row.receiptId, path);
  if (receiptId !== activity.observationId)
    failCanonicalBody("invalid-field", path, "receipt must bind the exact response observation");
  return {
    kind: canonicalBodyEnum(row.kind, path, new Set(["http.response.observed"])),
    receiptId,
    activity,
  };
}
export function npRequireAgentGuardianHttpEventPayloadV1(
  value: unknown,
): NpAgentGuardianHttpEventPayloadV1 {
  const path = "guardian.http.event";
  return npParseAgentGuardianHttpEventPayloadV1(
    cloneCanonicalRuntimeInput(value, path, 8192),
    path,
    {
      seen: new WeakSet<object>(),
    },
  );
}
export function npParseAgentGuardianHttpSourceReceiptV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianHttpSourceReceiptV1 {
  const keys = [
    "schemaVersion",
    "siteId",
    "receiptId",
    "keyId",
    "eventId",
    "eventHash",
    "bodyHash",
    "recordedAt",
    "sourceMac",
  ];
  const row = canonicalBodyRecord(value, path, keys, keys, state),
    receiptId = canonicalBodyUuid(row.receiptId, path),
    recordedAt = canonicalBodyUtc(row.recordedAt, path);
  if (typeof row.sourceMac !== "string" || !/^hmac-sha256:[A-Za-z0-9_-]{43}$/u.test(row.sourceMac))
    failCanonicalBody("invalid-field", path, "invalid exact HTTP source receipt binding");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-http-receipt.v1"]),
    ),
    siteId: canonicalBodySiteId(row.siteId, path),
    receiptId,
    keyId: canonicalBodyIdentifier(row.keyId, path, 128),
    eventId: canonicalBodyUuid(row.eventId, path),
    eventHash: canonicalBodySha256Digest(row.eventHash, path),
    bodyHash: canonicalBodySha256Digest(row.bodyHash, path),
    recordedAt,
    sourceMac: row.sourceMac,
  };
}
export function npRequireAgentGuardianHttpSourceReceiptV1(
  value: unknown,
): NpAgentGuardianHttpSourceReceiptV1 {
  const path = "guardian.http.receipt";
  return npParseAgentGuardianHttpSourceReceiptV1(
    cloneCanonicalRuntimeInput(value, path, 8192),
    path,
    { seen: new WeakSet<object>() },
  );
}
export function npParseAgentGuardianHttpEvidenceV1(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentGuardianHttpEvidenceV1 {
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "detectorVersion",
    "status",
    "routeFamily",
    "window",
    "observedCount",
    "countBasis",
    "assessment",
    "sourceDigest",
  ];
  const row = canonicalBodyRecord(value, path, keys, keys, state);
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-http-evidence.v1"]),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId: canonicalBodyEnum(row.detectorId, path, new Set(npAgentGuardianHttpDetectorIdsV1)),
    detectorVersion: canonicalBodyInteger(row.detectorVersion, path, 1, 1) as 1,
    status: status(row.status, path),
    routeFamily: family(row.routeFamily, path),
    window: window(row.window, path, state),
    observedCount: canonicalBodyInteger(row.observedCount, path, 5, 5) as 5,
    countBasis: canonicalBodyEnum(row.countBasis, path, new Set(["at-least"])),
    assessment: canonicalBodyEnum(row.assessment, path, new Set(["review-only"])),
    sourceDigest: canonicalBodySha256Digest(row.sourceDigest, path),
  };
}
export function npRequireAgentGuardianHttpEvidenceV1(
  value: unknown,
): NpAgentGuardianHttpEvidenceV1 {
  const path = "guardian.http.evidence";
  return npParseAgentGuardianHttpEvidenceV1(cloneCanonicalRuntimeInput(value, path, 4096), path, {
    seen: new WeakSet<object>(),
  });
}

/** Canonical rule reconstruction only. Receipt MACs and actual final-response ownership
 * are separately required before these activities may establish any retained source proof. */
export function npEvaluateAgentGuardianHttpRulesV1(input: {
  siteId: string;
  windowStartedAt: string;
  activities: readonly NpAgentGuardianHttpActivityV1[];
}): NpAgentGuardianHttpRuleMatchV1[] {
  const path = "guardian.http.rule",
    keys = ["siteId", "windowStartedAt", "activities"],
    state = { seen: new WeakSet<object>() },
    row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(input, path, 262_144),
      path,
      keys,
      keys,
      state,
    ),
    siteId = canonicalBodySiteId(row.siteId, path),
    startedAt = canonicalBodyUtc(row.windowStartedAt, path),
    start = Date.parse(startedAt);
  if (start % NP_AGENT_GUARDIAN_WINDOW_MS_V1 !== 0)
    failCanonicalBody("invalid-field", path, "must begin at a fixed UTC ten-minute boundary");
  const activities = canonicalBodyArray(
    row.activities,
    path,
    NP_AGENT_GUARDIAN_SITE_EVENT_LIMIT_V1,
    state,
  ).map((value) => npParseAgentGuardianHttpActivityV1(value, path, state));
  const identities = new Map<string, string>(),
    groups = new Map<string, NpAgentGuardianHttpActivityV1[]>();
  for (const activity of activities.sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) || a.observationId.localeCompare(b.observationId),
  )) {
    if (
      activity.siteId !== siteId ||
      Date.parse(activity.occurredAt) < start ||
      Date.parse(activity.occurredAt) >= start + NP_AGENT_GUARDIAN_WINDOW_MS_V1
    )
      failCanonicalBody("invalid-field", path, "HTTP response must belong to this site and window");
    const binding = serializeAgentCanonicalJson(activity),
      previous = identities.get(activity.observationId);
    if (previous !== undefined) {
      if (previous !== binding)
        failCanonicalBody("duplicate", path, "response identity cannot change its source facts");
      continue;
    }
    identities.set(activity.observationId, binding);
    const key = serializeAgentCanonicalJson({
      status: activity.status,
      routeFamily: activity.routeFamily,
      networkBucket: activity.networkBucket,
    });
    const cohort = groups.get(key) ?? [];
    cohort.push(activity);
    groups.set(key, cohort);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, activities]): NpAgentGuardianHttpRuleMatchV1[] => {
      if (activities.length < NP_AGENT_GUARDIAN_THRESHOLD_V1) return [];
      const cohort = activities.slice(0, NP_AGENT_GUARDIAN_THRESHOLD_V1),
        first = cohort[0];
      return [
        {
          detectorId: "guardian.http-responses",
          detectorVersion: 1,
          status: first.status,
          routeFamily: first.routeFamily,
          networkBucket: { ...first.networkBucket },
          window: { startedAt, endedAt: cohort[cohort.length - 1].occurredAt },
          observedCount: 5,
          countBasis: "at-least",
          assessment: "review-only",
          observationIds: cohort.map((activity) => activity.observationId),
        },
      ];
    });
}
