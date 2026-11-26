import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import {
  npRequireAgentModeratorSignalCandidateV1,
  type NpAgentModeratorFactV1,
  type NpAgentModeratorSettingsV1,
} from "../agent-contract/moderator-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAgentModeratorFingerprintV1 } from "./moderator-detector.js";

export function npModeratorFloodTargetV1(fact: NpAgentModeratorFactV1): string {
  return `${fact.subject.kind}\0${fact.subject.collection}\0${fact.subject.kind === "comment" ? fact.subject.commentId : fact.subject.documentId}`;
}

export function npCompareModeratorFloodFactsV1(
  a: NpAgentModeratorFactV1,
  b: NpAgentModeratorFactV1,
): number {
  const source = (fact: NpAgentModeratorFactV1) =>
    fact.evidence.kind === "event"
      ? fact.evidence.eventId
      : `${fact.evidence.collection}\0${fact.evidence.documentId}\0${fact.evidence.revisionId}`;
  const left = [a.evidence.observedAt, a.evidence.kind, source(a), a.evidence.digest];
  const right = [b.evidence.observedAt, b.evidence.kind, source(b), b.evidence.digest];
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return (left[index] ?? "") < (right[index] ?? "") ? -1 : 1;
  }
  return 0;
}

/** Same replacement/conflict semantics as the ordinary deterministic detector. */
export function npMergeModeratorFloodTargetV1(
  previous: NpAgentModeratorFactV1 | null,
  fact: NpAgentModeratorFactV1,
): NpAgentModeratorFactV1 {
  if (!previous) return fact;
  if (npModeratorFloodTargetV1(previous) !== npModeratorFloodTargetV1(fact))
    throw new Error("Mismatched Moderator target checkpoint.");
  if (
    previous.observedAt === fact.observedAt &&
    (previous.targetVersionDigest !== fact.targetVersionDigest ||
      previous.memberId !== fact.memberId ||
      serializeAgentCanonicalJson(previous.domainHashes) !==
        serializeAgentCanonicalJson(fact.domainHashes) ||
      previous.spamVerdict !== fact.spamVerdict ||
      previous.profanityVerdict !== fact.profanityVerdict)
  )
    throw new NpAgentGatewayError(
      "MODERATOR_SOURCE_UNAVAILABLE",
      409,
      "Moderator evidence is unavailable.",
    );
  return fact.observedAt > previous.observedAt ||
    (fact.observedAt === previous.observedAt && npCompareModeratorFloodFactsV1(fact, previous) < 0)
    ? fact
    : previous;
}

/** Bounded qualifying witness, not a claim that these are all domain targets. */
export function npModeratorFloodWitnessV1(
  facts: NpAgentModeratorFactV1[],
): NpAgentModeratorFactV1[] {
  const sorted = [...facts].sort(npCompareModeratorFloodFactsV1);
  const members = new Set<string | null>();
  const first: NpAgentModeratorFactV1[] = [],
    rest: NpAgentModeratorFactV1[] = [];
  for (const fact of sorted) {
    if (members.has(fact.memberId)) rest.push(fact);
    else {
      members.add(fact.memberId);
      first.push(fact);
    }
  }
  return [...first, ...rest].slice(0, 100);
}

/** Include an exact prefix of new targets, adding only the threshold witness needed.
 * Unconsumed targets stay behind the durable cursor; no sample is silently dropped. */
export function npModeratorFloodEvidenceBatchV1(input: {
  facts: NpAgentModeratorFactV1[];
  witness: NpAgentModeratorFactV1[];
  settings: NpAgentModeratorSettingsV1;
}): { consumed: number; facts: NpAgentModeratorFactV1[] } | null {
  for (let count = Math.min(100, input.facts.length); count > 0; count--) {
    const candidate = input.facts.slice(0, count);
    const targets = new Set(candidate.map(npModeratorFloodTargetV1));
    const members = new Set(candidate.map((fact) => fact.memberId));
    for (const fact of input.witness) {
      if (members.size >= input.settings.minIndependentAccounts) break;
      if (members.has(fact.memberId) || targets.has(npModeratorFloodTargetV1(fact))) continue;
      candidate.push(fact);
      targets.add(npModeratorFloodTargetV1(fact));
      members.add(fact.memberId);
    }
    for (const fact of input.witness) {
      if (candidate.length >= input.settings.minItems) break;
      if (targets.has(npModeratorFloodTargetV1(fact))) continue;
      candidate.push(fact);
      targets.add(npModeratorFloodTargetV1(fact));
    }
    if (
      candidate.length <= 100 &&
      candidate.length >= input.settings.minItems &&
      members.size >= input.settings.minIndependentAccounts
    )
      return { consumed: count, facts: candidate.sort(npCompareModeratorFloodFactsV1) };
  }
  return null;
}

/** Preserve all fact bytes; only the canonical evidence batch is bounded. */
export async function npModeratorFloodCandidateV1(input: {
  siteId: string;
  windowStartedAt: string;
  domainHash: string;
  facts: NpAgentModeratorFactV1[];
}) {
  const facts = [...input.facts].sort(npCompareModeratorFloodFactsV1);
  const canonicalEvidence = npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: input.siteId,
    detectorId: "moderator.repeated-link-spam",
    detectorVersion: 1,
    category: "spam",
    subject: null,
    window: {
      startedAt: input.windowStartedAt,
      endedAt: new Date(Date.parse(input.windowStartedAt) + 599_999).toISOString(),
    },
    evidence: facts.map((fact) => fact.evidence),
  });
  return npRequireAgentModeratorSignalCandidateV1({
    canonicalEvidence,
    evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonicalEvidence),
    fingerprint: npAgentModeratorFingerprintV1(input),
    domainHash: input.domainHash,
    severity: "medium",
    confidenceBasis: "exact-rule",
    scoreBasisPoints: Math.min(
      9500,
      5000 + new Set(facts.map((fact) => fact.memberId)).size * 500 + facts.length * 100,
    ),
    title: "Repeated-link activity",
    summary:
      "Independent member accounts posted the same link domain within ten minutes. Human review is required.",
    advisory: true,
    facts,
  });
}
