import {
  canonicalBodyRecord,
  canonicalBodyUuid,
  canonicalBodyUtc,
  canonicalBodySiteId,
  canonicalBodySha256Digest,
  canonicalBodyAscii,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npRequireAgentSignalEvidenceCanonical } from "./canonical-events.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import type { NpAgentEvidenceRef, NpAgentSignalEvidenceCanonicalV1 } from "./types.js";

export const npAgentModeratorMemberReportDetectorV1 = "moderator.member-report-review" as const;
export interface NpAgentModeratorMemberReportFactV1 {
  schemaVersion: "np.agent-member-report-fact.v1";
  siteId: string;
  observedAt: string;
  memberId: string;
  memberVersionDigest: string;
  claim: "unverified";
  evidence: Extract<NpAgentEvidenceRef, { kind: "event" }>;
}
/** Exact report presence, not a spam classifier, account sanction or quality estimate. */
export interface NpAgentModeratorMemberReportCandidateV1 {
  canonicalEvidence: NpAgentSignalEvidenceCanonicalV1;
  evidenceDigest: string;
  fingerprint: string;
  severity: "info";
  confidenceBasis: "external";
  scoreBasisPoints: null;
  title: "Member reports awaiting review";
  summary: "Unverified member report claims were recorded. Staff review is required.";
  facts: NpAgentModeratorMemberReportFactV1[];
  advisory: true;
}
const path = "agent.memberReport";
const bad = (): never =>
  failCanonicalBody("invalid-field", path, "Invalid member report review evidence");
const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, path, keys, keys, { seen: new WeakSet<object>() });
export function npRequireAgentModeratorMemberReportFactV1(
  value: unknown,
): NpAgentModeratorMemberReportFactV1 {
  const raw = record(cloneCanonicalRuntimeInput(value, path, 16384), [
    "schemaVersion",
    "siteId",
    "observedAt",
    "memberId",
    "memberVersionDigest",
    "claim",
    "evidence",
  ]);
  if (raw.schemaVersion !== "np.agent-member-report-fact.v1" || raw.claim !== "unverified") bad();
  const siteId = canonicalBodySiteId(raw.siteId, path);
  const observedAt = canonicalBodyUtc(raw.observedAt, path);
  const memberId = canonicalBodyUuid(raw.memberId, path);
  const evidence = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId,
    detectorId: npAgentModeratorMemberReportDetectorV1,
    detectorVersion: 1,
    category: "abuse",
    window: { startedAt: observedAt, endedAt: observedAt },
    subject: { kind: "member", memberId },
    evidence: [raw.evidence],
  }).evidence[0];
  if (evidence.kind !== "event") return bad();
  if (
    evidence.eventKind !== "community.member.reported" ||
    evidence.observedAt !== observedAt ||
    evidence.excerpt !== null
  )
    bad();
  return {
    schemaVersion: "np.agent-member-report-fact.v1",
    siteId,
    observedAt,
    memberId,
    memberVersionDigest: canonicalBodySha256Digest(raw.memberVersionDigest, path),
    claim: "unverified",
    evidence,
  };
}
export function npRequireAgentModeratorMemberReportCandidateV1(
  value: unknown,
): NpAgentModeratorMemberReportCandidateV1 {
  const raw = record(cloneCanonicalRuntimeInput(value, path, 524288), [
    "canonicalEvidence",
    "evidenceDigest",
    "fingerprint",
    "severity",
    "confidenceBasis",
    "scoreBasisPoints",
    "title",
    "summary",
    "facts",
    "advisory",
  ]);
  const canonicalEvidence = npRequireAgentSignalEvidenceCanonical(raw.canonicalEvidence);
  if (
    canonicalEvidence.detectorId !== npAgentModeratorMemberReportDetectorV1 ||
    canonicalEvidence.detectorVersion !== 1 ||
    canonicalEvidence.category !== "abuse" ||
    canonicalEvidence.subject?.kind !== "member" ||
    Date.parse(canonicalEvidence.window.startedAt) % 600000 !== 0 ||
    Date.parse(canonicalEvidence.window.endedAt) -
      Date.parse(canonicalEvidence.window.startedAt) !==
      599999 ||
    !Array.isArray(raw.facts) ||
    !raw.facts.length ||
    raw.facts.length > 100
  )
    bad();
  const facts = (raw.facts as unknown[]).map(npRequireAgentModeratorMemberReportFactV1);
  const subject = canonicalEvidence.subject;
  if (
    !subject ||
    subject.kind !== "member" ||
    facts.length !== canonicalEvidence.evidence.length ||
    facts.some(
      (f, i) =>
        f.siteId !== canonicalEvidence.siteId ||
        f.memberId !== subject.memberId ||
        serializeAgentCanonicalJson(f.evidence) !==
          serializeAgentCanonicalJson(canonicalEvidence.evidence[i]),
    ) ||
    new Set(facts.map((f) => f.evidence.eventId)).size !== facts.length
  )
    bad();
  if (
    raw.severity !== "info" ||
    raw.confidenceBasis !== "external" ||
    raw.scoreBasisPoints !== null ||
    raw.title !== "Member reports awaiting review" ||
    raw.summary !== "Unverified member report claims were recorded. Staff review is required." ||
    raw.advisory !== true
  )
    bad();
  const fingerprint = canonicalBodyAscii(raw.fingerprint, path, 256);
  if (!/^moderator\.member-reports\.v1:[a-f0-9]{64}$/u.test(fingerprint)) bad();
  return {
    canonicalEvidence,
    facts,
    fingerprint,
    evidenceDigest: canonicalBodySha256Digest(raw.evidenceDigest, path),
    severity: "info",
    confidenceBasis: "external",
    scoreBasisPoints: null,
    title: "Member reports awaiting review",
    summary: "Unverified member report claims were recorded. Staff review is required.",
    advisory: true,
  };
}
