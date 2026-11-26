import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  canonicalBodyArray,
  canonicalBodySiteId,
  canonicalBodyUtc,
  failCanonicalBody,
} from "../agent-contract/canonical-body-validation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorFactV1,
  npRequireAgentModeratorSettingsV1,
  type NpAgentModeratorEvidenceV1,
  type NpAgentModeratorFactV1,
  type NpAgentModeratorSettingsV1,
  type NpAgentModeratorSignalCandidateV1,
} from "../agent-contract/moderator-contract.js";

const DETECTOR_ID = "moderator.repeated-link-spam";
const WINDOW_MS = 600_000;
const MAXIMUM_FACTS = 100;
const MAXIMUM_SIGNALS = 100;
const hash = (purpose: string, value: string): string =>
  createHash("sha256").update(`${purpose}\0${value}`).digest("hex");
/** No fetch or classifier call; prose is discarded before durable facts are built. */
export function npExtractAgentModeratorDomainHashesV1(text: string): string[] {
  if (
    typeof text !== "string" ||
    text.length > 65_536 ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)
  )
    failCanonicalBody("limit", "agent.moderator.text", "must be bounded valid text");
  const domains = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/giu)) {
    // URL is a local parser only. Credentials, paths, fragments and query strings are never retained.
    let url: URL;
    try {
      url = new URL(match[0].replace(/[),.;!?\]}]+$/u, ""));
    } catch {
      continue;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (
      !hostname.includes(".") ||
      isIP(hostname.replace(/^\[|\]$/gu, "")) !== 0 ||
      !/^[a-z0-9.-]+$/u.test(hostname)
    )
      continue;
    domains.add(hash("np.agent-moderator-domain.v1", hostname));
    if (domains.size > 16)
      failCanonicalBody(
        "limit",
        "agent.moderator.domains",
        "may contain at most 16 distinct domains",
      );
  }
  return [...domains].sort();
}
export function npAgentModeratorWindowStartedAtV1(observedAt: string): string {
  const canonical = canonicalBodyUtc(observedAt, "agent.moderator.observedAt");
  return new Date(Math.floor(Date.parse(canonical) / WINDOW_MS) * WINDOW_MS).toISOString();
}
function targetKey(fact: NpAgentModeratorFactV1): string {
  return `${fact.subject.kind}\0${fact.subject.collection}\0${fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId}`;
}
function evidenceSource(ref: NpAgentModeratorEvidenceV1): string {
  return ref.kind === "event"
    ? ref.eventId
    : `${ref.collection}\0${ref.documentId}\0${ref.revisionId}`;
}
function compareFacts(left: NpAgentModeratorFactV1, right: NpAgentModeratorFactV1): number {
  const a = [
    left.evidence.observedAt,
    left.evidence.kind,
    evidenceSource(left.evidence),
    left.evidence.digest,
  ];
  const b = [
    right.evidence.observedAt,
    right.evidence.kind,
    evidenceSource(right.evidence),
    right.evidence.digest,
  ];
  for (let index = 0; index < a.length; index++) {
    if (a[index] === b[index]) continue;
    return (a[index] ?? "") < (b[index] ?? "") ? -1 : 1;
  }
  return 0;
}
/** Stable active-incident key; evidence growth within one domain/site/bucket does not open a new incident. */
export function npAgentModeratorFingerprintV1(input: {
  siteId: string;
  windowStartedAt: string;
  domainHash: string;
}): string {
  const siteId = canonicalBodySiteId(input.siteId, "agent.moderator.siteId");
  const startedAt = canonicalBodyUtc(input.windowStartedAt, "agent.moderator.windowStartedAt");
  if (
    npAgentModeratorWindowStartedAtV1(startedAt) !== startedAt ||
    !/^[a-f0-9]{64}$/u.test(input.domainHash)
  )
    failCanonicalBody(
      "invalid-field",
      "agent.moderator.fingerprint",
      "requires an aligned window and exact domain digest",
    );
  return `${DETECTOR_ID}.v1:${hash("np.agent-moderator-fingerprint.v1", serializeAgentCanonicalJson({ siteId, detectorId: DETECTOR_ID, detectorVersion: 1, category: "spam", domainHash: input.domainHash, windowStartedAt: startedAt }))}`;
}
export interface NpAgentRepeatedLinkDetectionInputV1 {
  siteId: string;
  windowStartedAt: string;
  settings: NpAgentModeratorSettingsV1;
  facts: NpAgentModeratorFactV1[];
}
/** Deterministic advisory evidence only; even threshold zero cannot activate a quarantine. */
export async function npDetectAgentRepeatedLinkSpamV1(
  input: NpAgentRepeatedLinkDetectionInputV1,
): Promise<NpAgentModeratorSignalCandidateV1[]> {
  const siteId = canonicalBodySiteId(input.siteId, "agent.moderator.siteId");
  const startedAt = canonicalBodyUtc(input.windowStartedAt, "agent.moderator.windowStartedAt");
  if (npAgentModeratorWindowStartedAtV1(startedAt) !== startedAt)
    failCanonicalBody(
      "invalid-field",
      "agent.moderator.windowStartedAt",
      "must start on a ten-minute UTC bucket",
    );
  const endedAt = new Date(Date.parse(startedAt) + WINDOW_MS - 1).toISOString();
  const settings = npRequireAgentModeratorSettingsV1(input.settings);
  const allowedCollections = new Set(settings.collectionSlugs);
  const rawFacts = canonicalBodyArray(input.facts, "agent.moderator.facts", MAXIMUM_FACTS, {
    seen: new WeakSet<object>(),
  });
  const currentTargets = new Map<string, NpAgentModeratorFactV1>();
  const evidenceBodies = new Map<string, string>();
  for (const raw of rawFacts) {
    const fact = npRequireAgentModeratorFactV1(raw);
    if (
      fact.siteId !== siteId ||
      fact.observedAt < startedAt ||
      fact.observedAt > endedAt ||
      !allowedCollections.has(fact.subject.collection)
    )
      failCanonicalBody(
        "invalid-field",
        "agent.moderator.facts",
        "every fact must belong to the selected site, collection and time bucket",
      );
    const key = `${fact.evidence.kind}\0${evidenceSource(fact.evidence)}`;
    const body = serializeAgentCanonicalJson(fact);
    const seen = evidenceBodies.get(key);
    if (seen !== undefined && seen !== body)
      failCanonicalBody(
        "invalid-field",
        "agent.moderator.facts",
        "an immutable source cannot describe conflicting facts",
      );
    evidenceBodies.set(key, body);
    const previous = currentTargets.get(targetKey(fact));
    if (
      previous &&
      previous.observedAt === fact.observedAt &&
      (previous.targetVersionDigest !== fact.targetVersionDigest ||
        previous.memberId !== fact.memberId ||
        serializeAgentCanonicalJson(previous.domainHashes) !==
          serializeAgentCanonicalJson(fact.domainHashes) ||
        previous.spamVerdict !== fact.spamVerdict ||
        previous.profanityVerdict !== fact.profanityVerdict)
    )
      failCanonicalBody(
        "invalid-field",
        "agent.moderator.facts",
        "same-time revisions of a target must agree",
      );
    // A target counts once, even after reports/edits. Use its newest actual observation.
    if (
      !previous ||
      fact.observedAt > previous.observedAt ||
      (fact.observedAt === previous.observedAt && compareFacts(fact, previous) < 0)
    )
      currentTargets.set(targetKey(fact), fact);
  }
  const groups = new Map<string, NpAgentModeratorFactV1[]>();
  for (const fact of currentTargets.values()) {
    // A refused write cannot become an actionable persisted target, nor can an unknown actor establish independence.
    if (
      fact.memberId === null ||
      fact.spamVerdict === "reject" ||
      fact.profanityVerdict === "reject"
    )
      continue;
    for (const domainHash of fact.domainHashes) {
      const group = groups.get(domainHash) ?? [];
      group.push(fact);
      groups.set(domainHash, group);
    }
  }
  const results: NpAgentModeratorSignalCandidateV1[] = [];
  for (const [domainHash, matches] of [...groups].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const independentAccounts = new Set(matches.map((fact) => fact.memberId)).size;
    if (matches.length < settings.minItems || independentAccounts < settings.minIndependentAccounts)
      continue;
    if (results.length >= MAXIMUM_SIGNALS)
      failCanonicalBody(
        "limit",
        "agent.moderator.signals",
        "more than 100 candidates requires a narrower host batch",
      );
    matches.sort(compareFacts);
    const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId,
      detectorId: DETECTOR_ID,
      detectorVersion: 1,
      category: "spam",
      window: { startedAt, endedAt },
      subject: null,
      evidence: matches.map((fact) => fact.evidence),
    });
    results.push({
      canonicalEvidence,
      evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
      fingerprint: npAgentModeratorFingerprintV1({
        siteId,
        windowStartedAt: startedAt,
        domainHash,
      }),
      severity: "medium",
      confidenceBasis: "exact-rule",
      // Count-based prioritization, not a spam verdict or reviewed precision estimate. Adapter flags are preserved, never fabricated.
      scoreBasisPoints: Math.min(9500, 5000 + independentAccounts * 500 + matches.length * 100),
      title: "Repeated-link activity",
      summary:
        "Independent member accounts posted the same link domain within ten minutes. Human review is required.",
      domainHash,
      facts: matches.map((fact) => npRequireAgentModeratorFactV1(fact)),
      advisory: true,
    });
  }
  return results;
}
