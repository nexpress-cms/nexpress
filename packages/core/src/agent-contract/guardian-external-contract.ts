import {
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

/** Frozen protocol identity; credential rotation does not change protocol semantics. */
export const npAgentSentryIssueCreatedAdapterIdentityV1 = Object.freeze({
  id: "sentry.issue-created.v1",
  contractVersion: 1,
  fingerprint: "cj1:sha256:H8Y6ecSa6JizKW-34_VrBPvYOycoUzEC3Z6Xx3973iI",
} as const);
export interface NpAgentExternalSignalAdapterIdentityV1 {
  id: "sentry.issue-created.v1";
  contractVersion: 1;
  fingerprint: string;
}
export const NP_AGENT_GUARDIAN_EXTERNAL_BODY_LIMIT_V1 = 65_536;
export const NP_AGENT_GUARDIAN_EXTERNAL_SOURCE_AGE_MS_V1 = 600_000;
/** A future occurrence cannot yet be a deterministic observed fact. */
export const NP_AGENT_GUARDIAN_EXTERNAL_FUTURE_SKEW_MS_V1 = 0;
export const NP_AGENT_GUARDIAN_EXTERNAL_SITE_EVENT_LIMIT_V1 = 100;
export const NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1 = "guardian.external-error-created";

export function npRequireAgentExternalSignalAdapterIdentityV1(
  value: unknown,
): NpAgentExternalSignalAdapterIdentityV1 {
  const path = "guardian.external.adapter";
  const keys = ["id", "contractVersion", "fingerprint"];
  const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, path, 2048), path, keys, keys, {
    seen: new WeakSet<object>(),
  });
  const expected = npAgentSentryIssueCreatedAdapterIdentityV1;
  const fingerprint = canonicalBodySha256Digest(row.fingerprint, `${path}.fingerprint`);
  if (fingerprint !== expected.fingerprint)
    failCanonicalBody(
      "invalid-field",
      `${path}.fingerprint`,
      "unknown adapter protocol fingerprint",
    );
  return {
    id: canonicalBodyEnum(row.id, `${path}.id`, new Set([expected.id] as const)),
    contractVersion: canonicalBodyInteger(
      row.contractVersion,
      `${path}.contractVersion`,
      1,
      1,
    ) as 1,
    fingerprint,
  };
}

/** Safe read projection. Imported text, headers, remote ids and executable targets are absent. */
export interface NpAgentGuardianExternalEvidenceV1 {
  schemaVersion: "np.agent-guardian-external-evidence.v1";
  signalId: string;
  detectorId: "guardian.external-error-created";
  detectorVersion: 1;
  adapter: NpAgentExternalSignalAdapterIdentityV1;
  basis: "authenticated-external-fact";
  category: "availability";
  severity: "medium";
  confidenceBasis: "external";
  observedAt: string;
  observedIssueCount: 1;
  sourceDigest: string;
}
export function npRequireAgentGuardianExternalEvidenceV1(
  value: unknown,
): NpAgentGuardianExternalEvidenceV1 {
  const path = "guardian.external.evidence";
  const keys = [
    "schemaVersion",
    "signalId",
    "detectorId",
    "detectorVersion",
    "adapter",
    "basis",
    "category",
    "severity",
    "confidenceBasis",
    "observedAt",
    "observedIssueCount",
    "sourceDigest",
  ];
  const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, path, 4096), path, keys, keys, {
    seen: new WeakSet<object>(),
  });
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      path,
      new Set(["np.agent-guardian-external-evidence.v1"] as const),
    ),
    signalId: canonicalBodyUuid(row.signalId, path),
    detectorId: canonicalBodyEnum(
      row.detectorId,
      path,
      new Set([NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1] as const),
    ),
    detectorVersion: canonicalBodyInteger(row.detectorVersion, path, 1, 1) as 1,
    adapter: npRequireAgentExternalSignalAdapterIdentityV1(row.adapter),
    basis: canonicalBodyEnum(row.basis, path, new Set(["authenticated-external-fact"] as const)),
    category: canonicalBodyEnum(row.category, path, new Set(["availability"] as const)),
    severity: canonicalBodyEnum(row.severity, path, new Set(["medium"] as const)),
    confidenceBasis: canonicalBodyEnum(row.confidenceBasis, path, new Set(["external"] as const)),
    observedAt: canonicalBodyUtc(row.observedAt, path),
    observedIssueCount: canonicalBodyInteger(row.observedIssueCount, path, 1, 1) as 1,
    sourceDigest: canonicalBodySha256Digest(row.sourceDigest, path),
  };
}
