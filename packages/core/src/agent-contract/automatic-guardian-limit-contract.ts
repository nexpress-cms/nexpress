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
import { npRequireAgentRestrictionSubjectV1 } from "./restriction-adapter-contract.js";
import type { NpAgentRestrictionOpaqueActorBucketSubjectV1 } from "./types.js";

/** A deliberately narrower first automatic effect than the existing human workflow. */
export const NP_AGENT_AUTOMATIC_GUARDIAN_LIMIT_TTL_MAX_SECONDS_V1 = 900;
export const npAgentAutomaticGuardianLimitRuleKindV1 = "staff-escalated-auth-rule.v1";
export type NpAgentAutomaticGuardianLimitScopeV1 = "auth.member" | "auth.staff";
export type NpAgentAutomaticGuardianLimitDetectorV1 =
  "guardian.login-failures" | "guardian.rate-limits";

/** Host artifact only. Parsing this shape never qualifies a deployment or grants authority. */
export interface NpAgentAutomaticGuardianLimitDeploymentV1 {
  schemaVersion: "np.agent-automatic-guardian-limit-deployment.v1";
  policyId: string;
  policyVersion: number;
  siteId: string;
  principalIds: string[];
  rule: {
    kind: typeof npAgentAutomaticGuardianLimitRuleKindV1;
    detectorId: NpAgentAutomaticGuardianLimitDetectorV1;
    detectorVersion: 1;
    minimumSeverity: "high" | "critical";
    maximumEvidenceAgeSeconds: number;
    maximumEscalationAgeSeconds: number;
  };
  actionScopes: NpAgentAutomaticGuardianLimitScopeV1[];
  limits: { restrictionSeconds: number; actionsPerHour: number; activeRestrictions: number };
  qualification: {
    source: "production-human-review";
    policyVersion: number;
    reviewArtifactDigest: string;
    legitimateImpactReviewArtifactDigest: string;
    shadowArtifactDigest: string;
    shadowStartedAt: string;
    shadowEndedAt: string;
    compensationTestArtifactDigest: string;
  };
  issuedAt: string;
  expiresAt: string;
}

/** Private exact evidence. Serialized copies are historical facts, never live execution grants. */
export interface NpAgentAutomaticGuardianLimitAuthorizationV1 {
  schemaVersion: "np.agent-automatic-guardian-limit-authorization.v1";
  policyId: string;
  policyVersion: number;
  deploymentDigest: string;
  policyDigest: string;
  siteId: string;
  principalId: string;
  ruleKind: typeof npAgentAutomaticGuardianLimitRuleKindV1;
  incidentId: string;
  incidentVersion: number;
  incidentFingerprint: string;
  incidentUpdatedAt: string;
  incidentSeverity: "high" | "critical";
  signalId: string;
  detectorId: NpAgentAutomaticGuardianLimitDetectorV1;
  detectorVersion: 1;
  signalEvidenceDigest: string;
  sourceEventIds: string[];
  sourceFactsDigest: string;
  sourceWindow: { startedAt: string; endedAt: string };
  /** The existing source rule remains medium and proves only this lower bound. */
  sourceBaselineSeverity: "medium";
  observedCount: 5;
  countBasis: "at-least";
  staffEscalation: {
    timelineEntryId: string;
    transitionVersion: number;
    fromSeverity: "info" | "low" | "medium" | "high";
    toSeverity: "high" | "critical";
    createdAt: string;
    evidenceDigest: string;
  };
  subject: NpAgentRestrictionOpaqueActorBucketSubjectV1;
  actionScopes: [NpAgentAutomaticGuardianLimitScopeV1];
  authorizedAt: string;
  expiresAt: string;
}
const p = "automaticGuardianLimit";
function fail(): never {
  return failCanonicalBody("invalid-field", p, "Invalid automatic Guardian limit evidence");
}
const rec = (value: unknown, keys: readonly string[]) =>
  canonicalBodyRecord(value, p, keys, keys, { seen: new WeakSet<object>() });
const en = <const T extends string>(value: unknown, values: readonly T[]) =>
  canonicalBodyEnum<T>(value, p, new Set(values));
const integer = (value: unknown, minimum: number, maximum = 2147483647) =>
  canonicalBodyInteger(value, p, minimum, maximum);
const sha = (value: unknown) => canonicalBodySha256Digest(value, p);
const utc = (value: unknown) => canonicalBodyUtc(value, p);
const uuid = (value: unknown) => canonicalBodyUuid(value, p);
function policyId(value: unknown): string {
  const result = canonicalBodyAscii(value, p, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/u.test(result)) fail();
  return result;
}
function sorted<T extends string>(
  value: unknown,
  maximum: number,
  parse: (item: unknown) => T,
): T[] {
  const rows = canonicalBodyArray(value, p, maximum, { seen: new WeakSet<object>() }).map(parse);
  if (!rows.length || rows.some((row, index) => index > 0 && row <= rows[index - 1])) fail();
  return rows;
}
const scopes = (value: unknown) =>
  sorted(value, 2, (item) => en(item, ["auth.member", "auth.staff"]));
const detector = (value: unknown) => en(value, ["guardian.login-failures", "guardian.rate-limits"]);
const severity = (value: unknown) => en(value, ["high", "critical"]);

export function npRequireAgentAutomaticGuardianLimitDeploymentV1(
  input: unknown,
): NpAgentAutomaticGuardianLimitDeploymentV1 {
  const row = rec(cloneCanonicalRuntimeInput(input, p, 32768), [
    "schemaVersion",
    "policyId",
    "policyVersion",
    "siteId",
    "principalIds",
    "rule",
    "actionScopes",
    "limits",
    "qualification",
    "issuedAt",
    "expiresAt",
  ]);
  const rule = rec(row.rule, [
    "kind",
    "detectorId",
    "detectorVersion",
    "minimumSeverity",
    "maximumEvidenceAgeSeconds",
    "maximumEscalationAgeSeconds",
  ]);
  const limits = rec(row.limits, ["restrictionSeconds", "actionsPerHour", "activeRestrictions"]);
  const q = rec(row.qualification, [
    "source",
    "policyVersion",
    "reviewArtifactDigest",
    "legitimateImpactReviewArtifactDigest",
    "shadowArtifactDigest",
    "shadowStartedAt",
    "shadowEndedAt",
    "compensationTestArtifactDigest",
  ]);
  const version = integer(row.policyVersion, 1),
    issuedAt = utc(row.issuedAt),
    expiresAt = utc(row.expiresAt);
  const shadowStartedAt = utc(q.shadowStartedAt),
    shadowEndedAt = utc(q.shadowEndedAt);
  if (
    integer(q.policyVersion, 1) !== version ||
    Date.parse(shadowEndedAt) <= Date.parse(shadowStartedAt) ||
    Date.parse(shadowEndedAt) > Date.parse(issuedAt) ||
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > 30 * 86400000
  )
    fail();
  return {
    schemaVersion: en(row.schemaVersion, ["np.agent-automatic-guardian-limit-deployment.v1"]),
    policyId: policyId(row.policyId),
    policyVersion: version,
    siteId: canonicalBodySiteId(row.siteId, p),
    principalIds: sorted(row.principalIds, 100, uuid),
    rule: {
      kind: en(rule.kind, [npAgentAutomaticGuardianLimitRuleKindV1]),
      detectorId: detector(rule.detectorId),
      detectorVersion: rule.detectorVersion === 1 ? 1 : fail(),
      minimumSeverity: severity(rule.minimumSeverity),
      maximumEvidenceAgeSeconds: integer(rule.maximumEvidenceAgeSeconds, 60, 3600),
      maximumEscalationAgeSeconds: integer(rule.maximumEscalationAgeSeconds, 60, 86400),
    },
    actionScopes: scopes(row.actionScopes),
    limits: {
      restrictionSeconds: integer(
        limits.restrictionSeconds,
        60,
        NP_AGENT_AUTOMATIC_GUARDIAN_LIMIT_TTL_MAX_SECONDS_V1,
      ),
      actionsPerHour: integer(limits.actionsPerHour, 1, 100),
      activeRestrictions: integer(limits.activeRestrictions, 1, 1000),
    },
    qualification: {
      source: en(q.source, ["production-human-review"]),
      policyVersion: version,
      reviewArtifactDigest: sha(q.reviewArtifactDigest),
      legitimateImpactReviewArtifactDigest: sha(q.legitimateImpactReviewArtifactDigest),
      shadowArtifactDigest: sha(q.shadowArtifactDigest),
      shadowStartedAt,
      shadowEndedAt,
      compensationTestArtifactDigest: sha(q.compensationTestArtifactDigest),
    },
    issuedAt,
    expiresAt,
  };
}

export function npRequireAgentAutomaticGuardianLimitAuthorizationV1(
  input: unknown,
): NpAgentAutomaticGuardianLimitAuthorizationV1 {
  const row = rec(cloneCanonicalRuntimeInput(input, p, 16384), [
    "schemaVersion",
    "policyId",
    "policyVersion",
    "deploymentDigest",
    "policyDigest",
    "siteId",
    "principalId",
    "ruleKind",
    "incidentId",
    "incidentVersion",
    "incidentFingerprint",
    "incidentUpdatedAt",
    "incidentSeverity",
    "signalId",
    "detectorId",
    "detectorVersion",
    "signalEvidenceDigest",
    "sourceEventIds",
    "sourceFactsDigest",
    "sourceWindow",
    "sourceBaselineSeverity",
    "observedCount",
    "countBasis",
    "staffEscalation",
    "subject",
    "actionScopes",
    "authorizedAt",
    "expiresAt",
  ]);
  const w = rec(row.sourceWindow, ["startedAt", "endedAt"]),
    e = rec(row.staffEscalation, [
      "timelineEntryId",
      "transitionVersion",
      "fromSeverity",
      "toSeverity",
      "createdAt",
      "evidenceDigest",
    ]);
  const startedAt = utc(w.startedAt),
    endedAt = utc(w.endedAt),
    createdAt = utc(e.createdAt),
    authorizedAt = utc(row.authorizedAt),
    expiresAt = utc(row.expiresAt),
    incidentUpdatedAt = utc(row.incidentUpdatedAt);
  const incidentVersion = integer(row.incidentVersion, 2),
    transitionVersion = integer(e.transitionVersion, 2),
    incidentSeverity = severity(row.incidentSeverity),
    toSeverity = severity(e.toSeverity);
  const fromSeverity = en(e.fromSeverity, ["info", "low", "medium", "high"]);
  const subject = npRequireAgentRestrictionSubjectV1(row.subject),
    actionScopes = scopes(row.actionScopes),
    sourceEventIds = sorted(row.sourceEventIds, 5, uuid);
  if (
    row.detectorVersion !== 1 ||
    row.observedCount !== 5 ||
    sourceEventIds.length !== 5 ||
    actionScopes.length !== 1 ||
    subject.kind !== "opaque_actor_bucket" ||
    subject.purpose !== "network-address" ||
    incidentSeverity !== toSeverity ||
    (fromSeverity === "high" && toSeverity !== "critical") ||
    transitionVersion > incidentVersion ||
    Date.parse(startedAt) % 600000 !== 0 ||
    endedAt < startedAt ||
    Date.parse(endedAt) >= Date.parse(startedAt) + 600000 ||
    createdAt < endedAt ||
    authorizedAt < createdAt ||
    incidentUpdatedAt < createdAt ||
    incidentUpdatedAt > authorizedAt ||
    Date.parse(expiresAt) - Date.parse(authorizedAt) < 60000 ||
    Date.parse(expiresAt) - Date.parse(authorizedAt) >
      NP_AGENT_AUTOMATIC_GUARDIAN_LIMIT_TTL_MAX_SECONDS_V1 * 1000
  )
    fail();
  return {
    schemaVersion: en(row.schemaVersion, ["np.agent-automatic-guardian-limit-authorization.v1"]),
    policyId: policyId(row.policyId),
    policyVersion: integer(row.policyVersion, 1),
    deploymentDigest: sha(row.deploymentDigest),
    policyDigest: sha(row.policyDigest),
    siteId: canonicalBodySiteId(row.siteId, p),
    principalId: uuid(row.principalId),
    ruleKind: en(row.ruleKind, [npAgentAutomaticGuardianLimitRuleKindV1]),
    incidentId: uuid(row.incidentId),
    incidentVersion,
    incidentFingerprint: sha(row.incidentFingerprint),
    incidentUpdatedAt,
    incidentSeverity,
    signalId: uuid(row.signalId),
    detectorId: detector(row.detectorId),
    detectorVersion: 1,
    signalEvidenceDigest: sha(row.signalEvidenceDigest),
    sourceEventIds,
    sourceFactsDigest: sha(row.sourceFactsDigest),
    sourceWindow: { startedAt, endedAt },
    sourceBaselineSeverity: en(row.sourceBaselineSeverity, ["medium"]),
    observedCount: 5,
    countBasis: en(row.countBasis, ["at-least"]),
    staffEscalation: {
      timelineEntryId: uuid(e.timelineEntryId),
      transitionVersion,
      fromSeverity,
      toSeverity,
      createdAt,
      evidenceDigest: sha(e.evidenceDigest),
    },
    subject,
    actionScopes: [actionScopes[0]],
    authorizedAt,
    expiresAt,
  };
}
