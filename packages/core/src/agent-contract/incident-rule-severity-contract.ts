import {
  canonicalBodyAscii,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npRequireAgentIncidentSeverityChangeV1,
  type NpAgentIncidentSeverityChangeV1,
} from "./incident-severity-contract.js";

/** A deterministic Signal changed priority; this is neither a staff judgment nor a model decision. */
export interface NpAgentIncidentRuleSeverityChangeV1 {
  fromSeverity: NpAgentIncidentSeverityChangeV1["fromSeverity"];
  toSeverity: NpAgentIncidentSeverityChangeV1["toSeverity"];
  detectorId: string;
  detectorVersion: number;
  signalId: string;
  evidenceDigest: string;
}
export function npRequireAgentIncidentRuleSeverityChangeV1(
  value: unknown,
): NpAgentIncidentRuleSeverityChangeV1 {
  const p = "incident.ruleSeverityChange";
  const keys = [
    "fromSeverity",
    "toSeverity",
    "detectorId",
    "detectorVersion",
    "signalId",
    "evidenceDigest",
  ];
  const row = canonicalBodyRecord(cloneCanonicalRuntimeInput(value, p, 4096), p, keys, keys, {
    seen: new WeakSet(),
  });
  const change = npRequireAgentIncidentSeverityChangeV1({
    fromSeverity: row.fromSeverity,
    toSeverity: row.toSeverity,
    note: "Deterministic source rule.",
  });
  const detectorId = canonicalBodyAscii(row.detectorId, p, 128);
  if (!/^[a-z][a-z0-9.-]{0,127}$/u.test(detectorId))
    failCanonicalBody("invalid-field", p, "Invalid deterministic detector identity");
  return {
    fromSeverity: change.fromSeverity,
    toSeverity: change.toSeverity,
    detectorId,
    detectorVersion: canonicalBodyInteger(row.detectorVersion, p, 1, 2147483647),
    signalId: canonicalBodyUuid(row.signalId, p),
    evidenceDigest: canonicalBodySha256Digest(row.evidenceDigest, p),
  };
}
