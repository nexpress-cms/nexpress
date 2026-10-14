import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
  canonicalBodyUtc,
} from "../agent-contract/canonical-body-validation.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npAgentModeratorMemberReportDetectorV1,
  npRequireAgentModeratorMemberReportFactV1,
  npRequireAgentModeratorMemberReportCandidateV1,
  type NpAgentModeratorMemberReportCandidateV1,
  type NpAgentModeratorMemberReportFactV1,
} from "../agent-contract/moderator-member-report-contract.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import { npRequireReportRow } from "../community-contract/contract.js";
import type { NpReportRow } from "../community-contract/types.js";
import type {
  NpCommunityMemberReportObservationV1,
  NpCommunityMemberReportObserverV1,
} from "../community/member-report-observer.js";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents } from "../db/schema/agent.js";
import { npMembers, npReports } from "../db/schema/community.js";
import { withCurrentSite } from "../sites/context.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentIncidentObservationResultV1 } from "./incident-write-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import { npObserveIncidentCandidate } from "./incident-observation-service.js";
import {
  npResolveAgentModeratorStaffUserV1,
  type NpAgentModeratorCollectionResultV1,
} from "./moderator-collector.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { createAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
type Member = NpCommunityMemberReportObservationV1["member"];
const SOURCE = "community.member-reports";
const PREFIX = "moderator.mrpt.v1:";
type Event = Omit<NpAgentEventCanonicalV1, "subject" | "payload"> & {
  subject: { kind: "member"; memberId: string };
  payload: Extract<NpAgentEventCanonicalV1["payload"], { kind: "community.member.reported" }>;
};
export interface NpAgentModeratorMemberReportSourceV1 {
  event: Event;
  reportId: string;
  reportBaseDigest: string;
  memberDigest: string;
}
export interface NpAgentModeratorMemberReportInspectionV1 {
  source: NpAgentModeratorMemberReportSourceV1;
  report: NpReportRow;
  member: Member;
  unchanged: boolean;
  eligible: boolean;
  versionDigest: string;
}
const unavailable = (): never => {
  throw new NpAgentGatewayError(
    "MODERATOR_MEMBER_REPORT_SOURCE_UNAVAILABLE",
    409,
    "Member report evidence is unavailable.",
  );
};
const digest = (purpose: string, value: unknown) =>
  createHash("sha256")
    .update(`np.agent-moderator-member-report.v1\0${purpose}\0`)
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url");
const reportDigest = (report: NpReportRow) =>
  digest("report-base", {
    siteId: report.siteId,
    id: report.id,
    reporterId: report.reporterId,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    createdAt: report.createdAt.toISOString(),
  });
const memberDigest = (member: Member) =>
  digest("member-snapshot", {
    id: member.id,
    status: member.status,
    updatedAt: member.updatedAt.toISOString(),
  });
export function npAgentModeratorMemberReportSourceKeyV1(
  reportInput: NpReportRow,
  member: Member,
): string {
  const report = npRequireReportRow(reportInput);
  if (report.targetType !== "member" || report.targetId !== member.id || member.status !== "active")
    unavailable();
  return `${PREFIX}${Buffer.from(report.id.replaceAll("-", ""), "hex").toString("base64url")}:${reportDigest(report)}:${memberDigest(member)}`;
}
export function npBuildAgentModeratorMemberReportEventV1(
  input: Omit<NpCommunityMemberReportObservationV1, "db">,
): NpAgentEventCanonicalV1 {
  const report = npRequireReportRow(input.report);
  if (report.resolvedAt !== null || input.member.status !== "active") unavailable();
  return npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: report.siteId,
    kind: "community.member.reported",
    occurredAt: report.createdAt.toISOString(),
    source: { kind: "community", component: SOURCE },
    subject: { kind: "member", memberId: input.member.id },
    actor: { kind: "member", memberId: report.reporterId },
    causation: null,
    correlationId: null,
    deduplicationKey: npAgentModeratorMemberReportSourceKeyV1(report, input.member),
    privacy: "internal",
    payload: {
      kind: "community.member.reported",
      memberId: input.member.id,
      memberStatus: "active",
      claim: "unverified",
    },
  });
}
export function createAgentModeratorMemberReportObserverV1(options: {
  events: Pick<ReturnType<typeof createAgentRuntimeEventServiceV1>, "record">;
}): NpCommunityMemberReportObserverV1 {
  return {
    prepare: async ({ db, siteId }) => {
      await npWithAgentRuntimeControlTransactionV1(siteId, async () => {}, db);
    },
    record: async (input) => {
      const event = npBuildAgentModeratorMemberReportEventV1(input);
      await options.events.record({ siteId: event.siteId, event, db: input.db });
    },
  };
}
export async function npReadAgentModeratorMemberReportSourceV1(
  row: EventRow,
): Promise<NpAgentModeratorMemberReportSourceV1 | null> {
  const event = npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: row.siteId,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    source: { kind: row.sourceKind, component: row.sourceComponent },
    subject: row.subject,
    actor: row.actor,
    causation: row.causation,
    correlationId: row.correlationId,
    deduplicationKey: row.deduplicationKey,
    privacy: row.privacy,
    payload: row.payload,
  });
  if ((await npDigestAgentEventCanonical(event)) !== row.eventHash) unavailable();
  if (
    event.kind !== "community.member.reported" ||
    event.source.kind !== "community" ||
    event.source.component !== SOURCE ||
    event.subject?.kind !== "member" ||
    event.payload.kind !== "community.member.reported" ||
    event.payload.memberId !== event.subject.memberId ||
    event.actor?.kind !== "member" ||
    event.privacy !== "internal" ||
    event.causation !== null ||
    event.correlationId !== null
  )
    return null;
  const key = event.deduplicationKey;
  const match = key?.match(
    /^moderator\.mrpt\.v1:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/u,
  );
  if (!match) return null;
  if (
    [match[2], match[3]].some(
      (value) => Buffer.from(value, "base64url").toString("base64url") !== value,
    )
  )
    return null;
  const hex = Buffer.from(match[1], "base64url").toString("hex");
  if (hex.length !== 32 || Buffer.from(hex, "hex").toString("base64url") !== match[1])
    unavailable();
  const reportId = canonicalBodyUuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    "memberReport.reportId",
  );
  return {
    event: { ...event, subject: event.subject, payload: event.payload },
    reportId,
    reportBaseDigest: match[2],
    memberDigest: match[3],
  };
}
/** Global member metadata is scoped for this read through the real same-site report. */
export async function npInspectAgentModeratorMemberReportSourceV1(
  db: Db,
  row: EventRow,
): Promise<NpAgentModeratorMemberReportInspectionV1 | null> {
  const source = await npReadAgentModeratorMemberReportSourceV1(row);
  if (!source) return null;
  const [raw] = await db
    .select()
    .from(npReports)
    .where(and(eq(npReports.siteId, row.siteId), eq(npReports.id, source.reportId)))
    .limit(1);
  if (!raw) return null;
  const report = npRequireReportRow(raw);
  const [member] = await db
    .select({ id: npMembers.id, status: npMembers.status, updatedAt: npMembers.updatedAt })
    .from(npMembers)
    .where(eq(npMembers.id, source.event.subject.memberId))
    .limit(1);
  if (
    !member ||
    report.targetType !== "member" ||
    report.targetId !== member.id ||
    report.createdAt.toISOString() !== source.event.occurredAt ||
    (report.resolvedAt !== null && report.resolvedAt.getTime() < report.createdAt.getTime()) ||
    source.event.actor?.kind !== "member" ||
    source.event.actor.memberId !== report.reporterId ||
    reportDigest(report) !== source.reportBaseDigest
  )
    return null;
  const unchanged = memberDigest(member) === source.memberDigest;
  if (unchanged && member.status !== source.event.payload.memberStatus) return null;
  return {
    source,
    report,
    member,
    unchanged,
    eligible: member.status === "active" && report.resolvedAt === null,
    versionDigest: `cj1:sha256:${memberDigest(member)}`,
  };
}
export async function npReadAgentModeratorMemberReportFactV1(
  db: Db,
  row: EventRow,
): Promise<NpAgentModeratorMemberReportFactV1 | null> {
  const current = await npInspectAgentModeratorMemberReportSourceV1(db, row);
  if (!current || !current.unchanged || !current.eligible) return null;
  const event = current.source.event;
  return npRequireAgentModeratorMemberReportFactV1({
    schemaVersion: "np.agent-member-report-fact.v1",
    siteId: event.siteId,
    observedAt: event.occurredAt,
    memberId: event.subject.memberId,
    memberVersionDigest: current.versionDigest,
    claim: "unverified",
    evidence: {
      kind: "event",
      eventId: row.id,
      eventKind: event.kind,
      observedAt: event.occurredAt,
      digest: Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString("hex"),
      excerpt: null,
    },
  });
}
export function npAgentModeratorMemberReportFingerprintV1(input: {
  siteId: string;
  memberId: string;
  windowStartedAt: string;
}): string {
  const siteId = canonicalBodySiteId(input.siteId, "memberReport.siteId"),
    memberId = canonicalBodyUuid(input.memberId, "memberReport.memberId"),
    windowStartedAt = canonicalBodyUtc(input.windowStartedAt, "memberReport.windowStartedAt");
  if (Date.parse(windowStartedAt) % 600000 !== 0) unavailable();
  return `moderator.member-reports.v1:${createHash("sha256").update("np.agent-member-report-fingerprint.v1\0").update(serializeAgentCanonicalJson({ siteId, memberId, windowStartedAt })).digest("hex")}`;
}
export async function npResolveAgentModeratorMemberReportEvidenceV1(input: {
  db: Db;
  candidate: NpAgentModeratorMemberReportCandidateV1;
  staffUserId: string;
}): Promise<boolean> {
  const candidate = npRequireAgentModeratorMemberReportCandidateV1(input.candidate),
    siteId = candidate.canonicalEvidence.siteId;
  return withCurrentSite(siteId, async () => {
    await npResolveAgentModeratorStaffUserV1(input.db, siteId, input.staffUserId);
    const memberId = candidate.facts[0].memberId;
    await input.db
      .select({ id: npMembers.id })
      .from(npMembers)
      .where(eq(npMembers.id, memberId))
      .for("no key update");
    const reportIds: string[] = [];
    for (const expected of candidate.facts) {
      const [row] = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, expected.evidence.eventId)),
        )
        .limit(1);
      if (!row) return false;
      const source = await npReadAgentModeratorMemberReportSourceV1(row);
      if (!source || source.event.subject.memberId !== memberId) return false;
      reportIds.push(source.reportId);
    }
    // Member dismissals only lock their report; NO KEY UPDATE on members permits
    // their resolvedByMemberId FK checks. SHARE fences resolution even if the observer is reset.
    await input.db
      .select({ id: npReports.id })
      .from(npReports)
      .where(
        and(
          eq(npReports.siteId, siteId),
          eq(npReports.targetType, "member"),
          eq(npReports.targetId, memberId),
          inArray(npReports.id, [...new Set(reportIds)].sort()),
        ),
      )
      .orderBy(asc(npReports.id))
      .for("share");
    for (const expected of candidate.facts) {
      const [row] = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, expected.evidence.eventId)),
        )
        .limit(1);
      if (!row) return false;
      const actual = await npReadAgentModeratorMemberReportFactV1(input.db, row);
      if (!actual || serializeAgentCanonicalJson(actual) !== serializeAgentCanonicalJson(expected))
        return false;
    }
    await npResolveAgentModeratorStaffUserV1(input.db, siteId, input.staffUserId);
    return true;
  });
}
export interface NpAgentMemberReportIncidentWriteServiceV1 {
  observe(
    candidate: NpAgentModeratorMemberReportCandidateV1,
    options?: { transaction?: Db },
  ): Promise<NpAgentIncidentObservationResultV1>;
}
export function createAgentMemberReportIncidentWriteServiceV1(options: {
  resolveEvidence(input: {
    db: Db;
    candidate: NpAgentModeratorMemberReportCandidateV1;
  }): boolean | Promise<boolean>;
  now?: () => Date;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
}): NpAgentMemberReportIncidentWriteServiceV1 {
  if (typeof options.resolveEvidence !== "function")
    throw new Error("Member report evidence owner is required.");
  return {
    async observe(value, supplied = {}) {
      npAssertAgentPreviewEffectsAllowed();
      const candidate = npRequireAgentModeratorMemberReportCandidateV1(value),
        canonical = candidate.canonicalEvidence;
      if (
        (await npDigestAgentSignalEvidenceCanonical(canonical)) !== candidate.evidenceDigest ||
        npAgentModeratorMemberReportFingerprintV1({
          siteId: canonical.siteId,
          memberId: candidate.facts[0].memberId,
          windowStartedAt: canonical.window.startedAt,
        }) !== candidate.fingerprint
      )
        unavailable();
      return npObserveIncidentCandidate({
        candidate,
        resolveEvidence: (db) =>
          options.resolveEvidence({ db, candidate: structuredClone(candidate) }),
        now: options.now ?? (() => new Date()),
        notifications: options.notifications,
        transaction: supplied.transaction,
      });
    },
  };
}
/** Explicit read-only report review collection. Filings are not a spam score or reporter-independent proof. */
export function createAgentModeratorMemberReportCollectorV1(options: {
  staffUserId: string;
  incidents: NpAgentMemberReportIncidentWriteServiceV1;
  now?: () => Date;
}): {
  collect(input: {
    siteId: string;
    windowStartedAt: string;
  }): Promise<NpAgentModeratorCollectionResultV1>;
} {
  canonicalBodyUuid(options.staffUserId, "memberReport.staffUserId");
  const now = options.now ?? (() => new Date());
  return {
    async collect(input) {
      npAssertAgentPreviewEffectsAllowed();
      const siteId = canonicalBodySiteId(input.siteId, "memberReport.siteId"),
        start = canonicalBodyUtc(input.windowStartedAt, "memberReport.windowStartedAt"),
        end = new Date(Date.parse(start) + 600000);
      if (Date.parse(start) % 600000 !== 0 || end.getTime() > now().getTime()) unavailable();
      return withCurrentSite(siteId, () =>
        npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
          const user = await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
          const rows = await db
            .select()
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, siteId),
                eq(npAgentEvents.sourceKind, "community"),
                eq(npAgentEvents.sourceComponent, SOURCE),
                eq(npAgentEvents.kind, "community.member.reported"),
                gte(npAgentEvents.occurredAt, new Date(start)),
                lt(npAgentEvents.occurredAt, end),
              ),
            )
            .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
            .limit(101);
          if (rows.length > 100)
            throw new NpAgentGatewayError(
              "MODERATOR_SOURCE_LIMIT_REACHED",
              409,
              "Member report collection requires a narrower host batch.",
            );
          const memberIds = [];
          for (const row of rows) {
            const source = await npReadAgentModeratorMemberReportSourceV1(row);
            if (source) memberIds.push(source.event.subject.memberId);
          }
          // Members are global: cross-site collectors must acquire all target rows in the same order.
          if (memberIds.length)
            await db
              .select({ id: npMembers.id })
              .from(npMembers)
              .where(inArray(npMembers.id, [...new Set(memberIds)].sort()))
              .orderBy(asc(npMembers.id))
              .for("no key update");
          const groups = new Map<string, NpAgentModeratorMemberReportFactV1[]>();
          for (const row of rows) {
            const fact = await npReadAgentModeratorMemberReportFactV1(db, row);
            if (fact) {
              const group = groups.get(fact.memberId) ?? [];
              group.push(fact);
              groups.set(fact.memberId, group);
            }
          }
          const results: NpAgentIncidentObservationResultV1[] = [];
          let inspectedFacts = 0;
          for (const [memberId, facts] of [...groups].sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          )) {
            inspectedFacts += facts.length;
            const canonical = npRequireAgentSignalEvidenceCanonical({
              schemaVersion: "np.agent-signal-evidence.v1",
              siteId,
              detectorId: npAgentModeratorMemberReportDetectorV1,
              detectorVersion: 1,
              category: "abuse",
              window: { startedAt: start, endedAt: new Date(end.getTime() - 1).toISOString() },
              subject: { kind: "member", memberId },
              evidence: facts.map((f) => f.evidence),
            });
            const candidate = npRequireAgentModeratorMemberReportCandidateV1({
              canonicalEvidence: canonical,
              evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonical),
              fingerprint: npAgentModeratorMemberReportFingerprintV1({
                siteId,
                memberId,
                windowStartedAt: start,
              }),
              severity: "info",
              confidenceBasis: "external",
              scoreBasisPoints: null,
              title: "Member reports awaiting review",
              summary: "Unverified member report claims were recorded. Staff review is required.",
              facts,
              advisory: true,
            });
            results.push(await options.incidents.observe(candidate, { transaction: db }));
          }
          const current = await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
          if (serializeAgentCanonicalJson(current) !== serializeAgentCanonicalJson(user))
            unavailable();
          return {
            inspectedEvents: rows.length,
            acceptedFacts: inspectedFacts,
            observations: results,
          };
        }),
      );
    },
  };
}
