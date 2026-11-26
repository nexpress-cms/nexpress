import {
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { parseAgentSubject } from "./canonical-runtime-primitives.js";
import {
  npAgentModerationReasonCodes,
  type NpAgentModerationReasonCode,
  type NpAgentSubject,
} from "./types.js";

export interface NpAgentModeratorAssessmentEvidenceV1 {
  schemaVersion: "np.agent-moderator-assessment-evidence.v1";
  observedAt: string;
  incident: { id: string; versionNumber: number; fingerprint: string } | null;
  truncated: boolean;
  sources: {
    id: string;
    eventId: string;
    eventDigest: string;
    subject: Extract<NpAgentSubject, { kind: "comment" | "document" }>;
    currentVersionDigest: string;
    excerptDigest: string;
  }[];
}
/** Separately labelled model judgment; it is neither a deterministic fact nor effect authority. */
export interface NpAgentModeratorAssessmentV1 {
  schemaVersion: "np.agent-moderator-assessment.v1";
  incidentId: string;
  incidentVersion: number;
  observedAt: string;
  label: "spam" | "abuse" | "benign" | "uncertain";
  confidenceBasisPoints: number;
  reasonCodes: NpAgentModerationReasonCode[];
  evidenceDigests: string[];
  summary: string;
  /** Safe immutable source bindings only; raw excerpts are never retained. */
  evidence: NpAgentModeratorAssessmentEvidenceV1;
  provenance: {
    runId: string;
    providerCallId: string;
    provider: string;
    model: string;
    recipeFingerprint: string;
    instructionDigest: string;
    policyDigests: string[];
    requestDigest: string;
    responseDigest: string;
    sourceDigest: string;
  };
}
const invalid = (path: string): never =>
  failCanonicalBody("invalid-field", path, "must be bounded exact Moderator assessment evidence");
function text(value: unknown, path: string, limit: number, allowLineBreaks = false): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    /[\p{Cc}\p{Cs}]/u.test(allowLineBreaks ? value.replace(/[\n\r\t]/gu, "") : value)
  )
    return invalid(path);
  return value;
}
function inspect(value: unknown, limit: number) {
  const encoded = serializeAgentCanonicalJson(value);
  if (new TextEncoder().encode(encoded).byteLength > limit) invalid("moderator.assessment");
  const state = { seen: new WeakSet<object>() };
  const record = (entry: unknown, path: string, keys: readonly string[]) =>
    canonicalBodyRecord(entry, path, keys, keys, state);
  return { value: JSON.parse(encoded) as unknown, state, record };
}
function digests(value: unknown, path: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) return invalid(path);
  const result = value.map((item, index) => canonicalBodySha256Digest(item, `${path}.${index}`));
  if (result.some((item, index) => index > 0 && result[index - 1] >= item)) return invalid(path);
  return result;
}
export function npRequireAgentModeratorAssessmentEvidenceV1(
  value: unknown,
): NpAgentModeratorAssessmentEvidenceV1 {
  const parsed = inspect(value, 16 * 1024),
    path = "moderator.assessmentEvidence";
  const row = parsed.record(parsed.value, path, [
    "schemaVersion",
    "observedAt",
    "incident",
    "truncated",
    "sources",
  ]);
  if (
    row.schemaVersion !== "np.agent-moderator-assessment-evidence.v1" ||
    typeof row.truncated !== "boolean" ||
    !Array.isArray(row.sources) ||
    row.sources.length > 10
  )
    return invalid(path);
  let incident: NpAgentModeratorAssessmentEvidenceV1["incident"] = null;
  if (row.incident !== null) {
    const target = parsed.record(row.incident, `${path}.incident`, [
      "id",
      "versionNumber",
      "fingerprint",
    ]);
    incident = {
      id: canonicalBodyUuid(target.id, `${path}.incident.id`),
      versionNumber: canonicalBodyInteger(
        target.versionNumber,
        `${path}.incident.versionNumber`,
        1,
        2147483647,
      ),
      fingerprint: text(target.fingerprint, `${path}.incident.fingerprint`, 256),
    };
  }
  const sources = row.sources.map((item, index) => {
    const sourcePath = `${path}.sources.${index}`;
    const source = parsed.record(item, sourcePath, [
      "id",
      "eventId",
      "eventDigest",
      "subject",
      "currentVersionDigest",
      "excerptDigest",
    ]);
    const subject = parseAgentSubject(source.subject, `${sourcePath}.subject`, parsed.state);
    if (subject.kind !== "comment" && subject.kind !== "document") return invalid(sourcePath);
    if (source.id !== `moderator-assessment-${index.toString().padStart(3, "0")}`)
      return invalid(sourcePath);
    return {
      id: source.id,
      eventId: canonicalBodyUuid(source.eventId, `${sourcePath}.eventId`),
      eventDigest: canonicalBodySha256Digest(source.eventDigest, `${sourcePath}.eventDigest`),
      subject,
      currentVersionDigest: canonicalBodySha256Digest(
        source.currentVersionDigest,
        `${sourcePath}.currentVersionDigest`,
      ),
      excerptDigest: canonicalBodySha256Digest(source.excerptDigest, `${sourcePath}.excerptDigest`),
    };
  });
  if (incident === null && sources.length > 0) return invalid(path);
  if (
    new Set(sources.map((source) => serializeAgentCanonicalJson(source.subject))).size !==
    sources.length
  )
    return invalid(path);
  return {
    schemaVersion: "np.agent-moderator-assessment-evidence.v1",
    observedAt: canonicalBodyUtc(row.observedAt, `${path}.observedAt`),
    incident,
    truncated: row.truncated,
    sources,
  };
}
export function npRequireAgentModeratorAssessmentV1(value: unknown): NpAgentModeratorAssessmentV1 {
  const parsed = inspect(value, 16 * 1024),
    path = "moderator.assessment";
  const row = parsed.record(parsed.value, path, [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "observedAt",
    "label",
    "confidenceBasisPoints",
    "reasonCodes",
    "evidenceDigests",
    "summary",
    "evidence",
    "provenance",
  ]);
  if (
    row.schemaVersion !== "np.agent-moderator-assessment.v1" ||
    !["spam", "abuse", "benign", "uncertain"].includes(String(row.label)) ||
    !Array.isArray(row.reasonCodes) ||
    row.reasonCodes.length > 8
  )
    return invalid(path);
  const reasons = row.reasonCodes.map((code) => {
    if (!npAgentModerationReasonCodes.includes(code as NpAgentModerationReasonCode))
      return invalid(path);
    return code as NpAgentModerationReasonCode;
  });
  if (reasons.some((code, index) => index > 0 && reasons[index - 1] >= code)) return invalid(path);
  const provenance = parsed.record(row.provenance, `${path}.provenance`, [
    "runId",
    "providerCallId",
    "provider",
    "model",
    "recipeFingerprint",
    "instructionDigest",
    "policyDigests",
    "requestDigest",
    "responseDigest",
    "sourceDigest",
  ]);
  const evidence = npRequireAgentModeratorAssessmentEvidenceV1(row.evidence);
  if (
    !evidence.incident ||
    evidence.incident.id !== row.incidentId ||
    evidence.incident.versionNumber !== row.incidentVersion ||
    evidence.observedAt !== row.observedAt
  )
    return invalid(path);
  return {
    schemaVersion: "np.agent-moderator-assessment.v1",
    incidentId: canonicalBodyUuid(row.incidentId, `${path}.incidentId`),
    incidentVersion: canonicalBodyInteger(
      row.incidentVersion,
      `${path}.incidentVersion`,
      1,
      2147483647,
    ),
    observedAt: canonicalBodyUtc(row.observedAt, `${path}.observedAt`),
    label: row.label as NpAgentModeratorAssessmentV1["label"],
    confidenceBasisPoints: canonicalBodyInteger(
      row.confidenceBasisPoints,
      `${path}.confidenceBasisPoints`,
      0,
      10000,
    ),
    reasonCodes: reasons,
    evidenceDigests: digests(row.evidenceDigests, `${path}.evidenceDigests`, 10),
    summary: text(row.summary, `${path}.summary`, 2000, true),
    evidence,
    provenance: {
      runId: canonicalBodyUuid(provenance.runId, `${path}.provenance.runId`),
      providerCallId: canonicalBodyUuid(
        provenance.providerCallId,
        `${path}.provenance.providerCallId`,
      ),
      provider: text(provenance.provider, `${path}.provenance.provider`, 128),
      model: text(provenance.model, `${path}.provenance.model`, 256),
      recipeFingerprint: canonicalBodySha256Digest(
        provenance.recipeFingerprint,
        `${path}.provenance.recipeFingerprint`,
      ),
      instructionDigest: canonicalBodySha256Digest(
        provenance.instructionDigest,
        `${path}.provenance.instructionDigest`,
      ),
      policyDigests: digests(provenance.policyDigests, `${path}.provenance.policyDigests`, 64),
      requestDigest: canonicalBodySha256Digest(
        provenance.requestDigest,
        `${path}.provenance.requestDigest`,
      ),
      responseDigest: canonicalBodySha256Digest(
        provenance.responseDigest,
        `${path}.provenance.responseDigest`,
      ),
      sourceDigest: canonicalBodySha256Digest(
        provenance.sourceDigest,
        `${path}.provenance.sourceDigest`,
      ),
    },
  };
}
