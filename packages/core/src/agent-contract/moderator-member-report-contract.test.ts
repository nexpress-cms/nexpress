import { describe, expect, it } from "vitest";
import {
  npRequireAgentModeratorMemberReportCandidateV1,
  npRequireAgentModeratorMemberReportFactV1,
} from "./moderator-member-report-contract.js";
import { npRequireAgentModeratorSignalCandidateV1 } from "./moderator-contract.js";
import { npRequireAgentEventCanonical } from "./canonical-events.js";

const memberId = "10000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000002";
const otherId = "30000000-0000-4000-8000-000000000003";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const time = "2026-10-14T00:01:00.000Z";
const fact = {
  schemaVersion: "np.agent-member-report-fact.v1",
  siteId: "default",
  observedAt: time,
  memberId,
  memberVersionDigest: digest,
  claim: "unverified",
  evidence: {
    kind: "event",
    eventId,
    eventKind: "community.member.reported",
    observedAt: time,
    digest: "a".repeat(64),
    excerpt: null,
  },
};
const candidate = {
  canonicalEvidence: {
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: "default",
    detectorId: "moderator.member-report-review",
    detectorVersion: 1,
    category: "abuse",
    window: { startedAt: "2026-10-14T00:00:00.000Z", endedAt: "2026-10-14T00:09:59.999Z" },
    subject: { kind: "member", memberId },
    evidence: [{ ...fact.evidence }],
  },
  evidenceDigest: digest,
  fingerprint: `moderator.member-reports.v1:${"a".repeat(64)}`,
  severity: "info",
  confidenceBasis: "external",
  scoreBasisPoints: null,
  title: "Member reports awaiting review",
  summary: "Unverified member report claims were recorded. Staff review is required.",
  facts: [fact],
  advisory: true,
};

describe("Member report review contracts", () => {
  it("accepts exact unverified presence without estimating spam or sanction authority", () => {
    expect(npRequireAgentModeratorMemberReportFactV1(fact)).toEqual(fact);
    expect(npRequireAgentModeratorMemberReportCandidateV1(candidate)).toEqual(candidate);
    for (const change of [
      { severity: "low" },
      { confidenceBasis: "deterministic" },
      { scoreBasisPoints: 7000 },
      { title: "Member spam confirmed" },
      { advisory: false },
      { domainHash: "a".repeat(64) },
    ])
      expect(() =>
        npRequireAgentModeratorMemberReportCandidateV1({ ...candidate, ...change }),
      ).toThrow();
    expect(() => npRequireAgentModeratorSignalCandidateV1(candidate)).toThrow();
  });

  it("binds each filing to one exact member, site, Event, window and observed time", () => {
    const facts = Array.from({ length: 100 }, (_, index) => ({
      ...fact,
      evidence: {
        ...fact.evidence,
        eventId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      },
    }));
    const bounded = {
      ...candidate,
      facts,
      canonicalEvidence: {
        ...candidate.canonicalEvidence,
        evidence: facts.map((value) => ({ ...value.evidence })),
      },
    };
    expect(npRequireAgentModeratorMemberReportCandidateV1(bounded).facts).toHaveLength(100);
    const overflowFacts = [
      ...facts,
      { ...fact, evidence: { ...fact.evidence, eventId: "20000000-0000-4000-8000-000000000101" } },
    ];
    expect(() =>
      npRequireAgentModeratorMemberReportCandidateV1({
        ...bounded,
        facts: overflowFacts,
        canonicalEvidence: {
          ...bounded.canonicalEvidence,
          evidence: overflowFacts.map((value) => ({ ...value.evidence })),
        },
      }),
    ).toThrow();
    for (const change of [
      { facts: [{ ...fact, memberId: otherId }] },
      { facts: [{ ...fact, siteId: "other-site" }] },
      { facts: [{ ...fact, observedAt: "2026-10-14T00:02:00.000Z" }] },
      { facts: [{ ...fact, evidence: { ...fact.evidence, eventId: otherId } }] },
      { facts: [] },
      {
        facts: [fact, fact],
        canonicalEvidence: {
          ...candidate.canonicalEvidence,
          evidence: [fact.evidence, fact.evidence],
        },
      },
      {
        canonicalEvidence: {
          ...candidate.canonicalEvidence,
          subject: { kind: "site", siteId: "default" },
        },
      },
      { canonicalEvidence: { ...candidate.canonicalEvidence, category: "spam" } },
      { canonicalEvidence: { ...candidate.canonicalEvidence, detectorVersion: 2 } },
      {
        canonicalEvidence: {
          ...candidate.canonicalEvidence,
          window: { startedAt: time, endedAt: "2026-10-14T00:10:59.999Z" },
        },
      },
      {
        canonicalEvidence: {
          ...candidate.canonicalEvidence,
          window: { ...candidate.canonicalEvidence.window, endedAt: "2026-10-14T00:10:00.000Z" },
        },
      },
    ])
      expect(() =>
        npRequireAgentModeratorMemberReportCandidateV1({ ...candidate, ...change }),
      ).toThrow();
  });

  it("rejects excerpts, report attribution, invented claim verification and non-report facts", () => {
    for (const change of [
      { claim: "verified" },
      { reporterId: otherId },
      { reportId: eventId },
      { reason: "Private allegation" },
      { memberId: "opaque-member-id" },
      { memberVersionDigest: "raw-profile-data" },
      { evidence: { ...fact.evidence, excerpt: "Private report reason" } },
      { evidence: { ...fact.evidence, eventKind: "community.content.reported" } },
    ])
      expect(() => npRequireAgentModeratorMemberReportFactV1({ ...fact, ...change })).toThrow();
  });

  it("limits the canonical member-report Event payload to safe immutable claim metadata", () => {
    const event = {
      version: "np.agent-event.v1",
      siteId: "default",
      kind: "community.member.reported",
      occurredAt: time,
      source: { kind: "community", component: "community.member-reports" },
      subject: { kind: "member", memberId },
      actor: null,
      causation: null,
      correlationId: null,
      deduplicationKey: "member.report.safe-evidence",
      privacy: "internal",
      payload: {
        kind: "community.member.reported",
        memberId,
        memberStatus: "active",
        claim: "unverified",
      },
    };
    expect(npRequireAgentEventCanonical(event)).toEqual(event);
    for (const payload of [
      { ...event.payload, claim: "confirmed" },
      { ...event.payload, memberStatus: "suspended" },
      { ...event.payload, reporterId: otherId },
      { ...event.payload, reason: "Private allegation" },
      { ...event.payload, memberEmail: "private@example.com" },
    ])
      expect(() => npRequireAgentEventCanonical({ ...event, payload })).toThrow();
  });
});
