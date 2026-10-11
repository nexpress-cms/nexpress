import { createHash } from "node:crypto";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
} from "../agent-contract/canonical-events.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentModeratorFactV1,
  npRequireAgentModeratorSettingsV1,
  npRequireAgentModeratorSignalCandidateV1,
  type NpAgentModeratorFactV1,
  type NpAgentModeratorSettingsV1,
  type NpAgentModeratorSignalCandidateV1,
} from "../agent-contract/moderator-contract.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import type { NpTransaction } from "../collections/pipeline.js";
import { npRequireCommentRow, npRequireReportRow } from "../community-contract/contract.js";
import type { NpCommentRow, NpReportRow } from "../community-contract/types.js";
import { npInspectCommunityCommentEvidenceV1 } from "../community/content-containment.js";
import type {
  NpCommunityCommentReportObservationV1,
  NpCommunityCommentReportObserverV1,
} from "../community/report-observer.js";
import type { NpAuthUser } from "../config/types.js";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents } from "../db/schema/agent.js";
import { npReports } from "../db/schema/community.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { withCurrentSite } from "../sites/context.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentIncidentWriteServiceV1 } from "./incident-write-service.js";
import {
  npResolveAgentModeratorStaffUserV1,
  type NpAgentModeratorCollectionResultV1,
} from "./moderator-collector.js";
import {
  npAgentModeratorWindowStartedAtV1,
  npDetectAgentRepeatedLinkSpamV1,
  npExtractAgentModeratorDomainHashesV1,
} from "./moderator-detector.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { createAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
const SOURCE = "community.comment-reports";
const KEY_PREFIX = "moderator.rpt.v1:";
type CommentSubject = Extract<NonNullable<NpAgentEventCanonicalV1["subject"]>, { kind: "comment" }>;
type CommentPayload = Extract<
  NpAgentEventCanonicalV1["payload"],
  { targetKind: "comment" | "document" }
> & { kind: "community.content.reported"; targetKind: "comment"; status: "visible" | "pending" };
export interface NpAgentModeratorCommentReportSourceV1 {
  event: Omit<NpAgentEventCanonicalV1, "subject" | "payload"> & {
    subject: CommentSubject;
    payload: CommentPayload;
  };
  reportId: string;
  reportBaseDigest: string;
  commentDigest: string;
}
export interface NpAgentModeratorCommentReportInspectionV1 {
  source: NpAgentModeratorCommentReportSourceV1;
  report: NpReportRow;
  comment: NpCommentRow;
  versionDigest: string;
  unchanged: boolean;
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "MODERATOR_SOURCE_UNAVAILABLE",
    409,
    "Moderator evidence is unavailable.",
  );
}
function digest(purpose: string, value: unknown): string {
  return createHash("sha256")
    .update(`np.agent-moderator-comment-report.v1\0${purpose}\0`)
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url");
}
function reportBaseDigest(report: NpReportRow): string {
  return digest("report-base", {
    siteId: report.siteId,
    id: report.id,
    reporterId: report.reporterId,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    createdAt: report.createdAt.toISOString(),
  });
}
function commentDigest(comment: NpCommentRow): string {
  return digest("comment-snapshot", {
    ...comment,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
  });
}
/** Only digests leave the source owner; resolution remains a separate current fact. */
export function npAgentModeratorCommentReportSourceKeyV1(
  reportInput: NpReportRow,
  commentInput: NpCommentRow,
): string {
  const report = npRequireReportRow(reportInput),
    comment = npRequireCommentRow(commentInput);
  if (
    report.targetType !== "comment" ||
    report.targetId !== comment.id ||
    report.siteId !== comment.siteId
  )
    unavailable();
  return `${KEY_PREFIX}${Buffer.from(report.id.replaceAll("-", ""), "hex").toString("base64url")}:${reportBaseDigest(report)}:${commentDigest(comment)}`;
}
export function npBuildAgentModeratorCommentReportEventV1(
  input: Omit<NpCommunityCommentReportObservationV1, "db">,
): NpAgentEventCanonicalV1 | null {
  const report = npRequireReportRow(input.report),
    comment = npRequireCommentRow(input.comment);
  if (comment.status !== "visible" && comment.status !== "pending") return null;
  if (report.resolvedAt !== null) unavailable();
  return npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: report.siteId,
    kind: "community.content.reported",
    occurredAt: report.createdAt.toISOString(),
    source: { kind: "community", component: SOURCE },
    subject: {
      kind: "comment",
      commentId: comment.id,
      collection: comment.targetType,
      documentId: comment.targetId,
    },
    actor: { kind: "member", memberId: report.reporterId },
    causation: null,
    correlationId: null,
    deduplicationKey: npAgentModeratorCommentReportSourceKeyV1(report, comment),
    privacy: "internal",
    payload: {
      kind: "community.content.reported",
      targetKind: "comment",
      targetId: comment.id,
      collection: comment.targetType,
      authorMemberId: comment.memberId,
      verdictCode: "COMMENT_REPORT_FILED",
      status: comment.status,
    },
  });
}
/** Host installation only. Source transaction owns event persistence and rollback. */
export function createAgentModeratorCommentReportObserverV1(options: {
  events: Pick<ReturnType<typeof createAgentRuntimeEventServiceV1>, "record">;
}): NpCommunityCommentReportObserverV1 {
  return {
    async prepare({ db, siteId }) {
      await npWithAgentRuntimeControlTransactionV1(siteId, async () => {}, db);
    },
    async record(input) {
      const event = npBuildAgentModeratorCommentReportEventV1(input);
      if (event) await options.events.record({ siteId: event.siteId, event, db: input.db });
    },
  };
}
/** Immutable canonical integrity only; this does not claim the source is still eligible. */
export async function npReadAgentModeratorCommentReportSourceV1(
  source: EventRow,
): Promise<NpAgentModeratorCommentReportSourceV1 | null> {
  const event = npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: source.siteId,
    kind: source.kind,
    occurredAt: source.occurredAt.toISOString(),
    source: { kind: source.sourceKind, component: source.sourceComponent },
    subject: source.subject,
    actor: source.actor,
    causation: source.causation,
    correlationId: source.correlationId,
    deduplicationKey: source.deduplicationKey,
    privacy: source.privacy,
    payload: source.payload,
  });
  if ((await npDigestAgentEventCanonical(event)) !== source.eventHash) unavailable();
  if (
    event.kind !== "community.content.reported" ||
    event.source.kind !== "community" ||
    event.source.component !== SOURCE ||
    event.subject?.kind !== "comment" ||
    event.payload.kind !== "community.content.reported" ||
    event.payload.targetKind !== "comment" ||
    (event.payload.status !== "visible" && event.payload.status !== "pending") ||
    event.payload.verdictCode !== "COMMENT_REPORT_FILED" ||
    event.payload.targetId !== event.subject.commentId ||
    event.payload.collection !== event.subject.collection ||
    event.payload.authorMemberId === null ||
    event.actor?.kind !== "member" ||
    event.privacy !== "internal" ||
    event.causation !== null ||
    event.correlationId !== null
  )
    return null;
  const match =
    /^moderator\.rpt\.v1:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/u.exec(
      event.deduplicationKey ?? "",
    );
  if (!match) return null;
  const reportHex = Buffer.from(match[1], "base64url").toString("hex");
  if (reportHex.length !== 32 || Buffer.from(reportHex, "hex").toString("base64url") !== match[1])
    return null;
  for (const value of [match[2], match[3]])
    if (Buffer.from(value, "base64url").toString("base64url") !== value) return null;
  const reportId = canonicalBodyUuid(
    `${reportHex.slice(0, 8)}-${reportHex.slice(8, 12)}-${reportHex.slice(12, 16)}-${reportHex.slice(16, 20)}-${reportHex.slice(20)}`,
    "moderator.reportId",
  );
  return {
    event: {
      ...event,
      subject: event.subject,
      payload: {
        ...event.payload,
        kind: "community.content.reported",
        targetKind: "comment",
        status: event.payload.status,
      },
    },
    reportId,
    reportBaseDigest: match[2],
    commentDigest: match[3],
  };
}
/** Actual report owner plus current domain ACL/version; edits and resolution remain reviewable. */
export async function npInspectAgentModeratorCommentReportSourceV1(
  db: Db,
  row: EventRow,
  user: NpAuthUser,
): Promise<NpAgentModeratorCommentReportInspectionV1 | null> {
  const source = await npReadAgentModeratorCommentReportSourceV1(row);
  if (!source) return null;
  const [raw] = await db
    .select()
    .from(npReports)
    .where(and(eq(npReports.id, source.reportId), eq(npReports.siteId, row.siteId)))
    .limit(1);
  if (!raw) return null;
  let current: { versionDigest: string; comment: NpCommentRow };
  try {
    current = await npInspectCommunityCommentEvidenceV1(db as unknown as NpTransaction, {
      siteId: row.siteId,
      target: {
        kind: "comment",
        collection: source.event.subject.collection,
        id: source.event.subject.commentId,
      },
      user,
    });
  } catch (error) {
    if (
      error instanceof NpForbiddenError ||
      error instanceof NpNotFoundError ||
      error instanceof NpValidationError
    )
      return null;
    throw error;
  }
  const report = npRequireReportRow(raw),
    comment = current.comment,
    event = source.event;
  if (
    report.targetType !== "comment" ||
    report.targetId !== event.subject.commentId ||
    reportBaseDigest(report) !== source.reportBaseDigest ||
    event.actor?.kind !== "member" ||
    event.actor.memberId !== report.reporterId ||
    report.createdAt.toISOString() !== event.occurredAt ||
    comment.targetId !== event.subject.documentId ||
    comment.memberId !== event.payload.authorMemberId
  )
    return null;
  return {
    source,
    report,
    comment,
    versionDigest: current.versionDigest,
    unchanged: commentDigest(comment) === source.commentDigest,
  };
}
export async function npReadAgentModeratorCommentReportFactV1(
  db: Db,
  source: EventRow,
  user: NpAuthUser,
): Promise<NpAgentModeratorFactV1 | null> {
  const current = await npInspectAgentModeratorCommentReportSourceV1(db, source, user);
  if (
    !current ||
    !current.unchanged ||
    current.report.resolvedAt !== null ||
    (current.comment.status !== "visible" && current.comment.status !== "pending")
  )
    return null;
  const { event } = current.source;
  return npRequireAgentModeratorFactV1({
    schemaVersion: "np.agent-moderator-fact.v1",
    siteId: source.siteId,
    observedAt: event.occurredAt,
    subject: event.subject,
    memberId: current.comment.memberId,
    targetVersionDigest: current.versionDigest,
    domainHashes: npExtractAgentModeratorDomainHashesV1(current.comment.bodyMd),
    spamVerdict: "unknown",
    profanityVerdict: "unknown",
    evidence: {
      kind: "event",
      eventId: source.id,
      eventKind: event.kind,
      observedAt: event.occurredAt,
      digest: Buffer.from(source.eventHash.slice("cj1:sha256:".length), "base64url").toString(
        "hex",
      ),
      excerpt: null,
    },
  });
}
/** Re-resolve immutable refs and current eligibility inside the Incident writer's transaction. */
export async function npResolveAgentModeratorCommentReportEvidenceV1(input: {
  db: Db;
  candidate: NpAgentModeratorSignalCandidateV1;
  staffUserId: string;
}): Promise<boolean> {
  const candidate = npRequireAgentModeratorSignalCandidateV1(input.candidate);
  canonicalBodyUuid(input.staffUserId, "moderator.staffUserId");
  const siteId = candidate.canonicalEvidence.siteId;
  return withCurrentSite(siteId, async () => {
    const user = await npResolveAgentModeratorStaffUserV1(input.db, siteId, input.staffUserId);
    for (const expected of candidate.facts) {
      if (expected.evidence.kind !== "event") return false;
      const [source] = await input.db
        .select()
        .from(npAgentEvents)
        .where(
          and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, expected.evidence.eventId)),
        )
        .limit(1);
      if (!source) return false;
      const actual = await npReadAgentModeratorCommentReportFactV1(input.db, source, user);
      if (!actual || serializeAgentCanonicalJson(actual) !== serializeAgentCanonicalJson(expected))
        return false;
    }
    return true;
  });
}
export interface NpAgentModeratorCommentReportCollectorV1 {
  collect(input: {
    siteId: string;
    windowStartedAt: string;
    settings: NpAgentModeratorSettingsV1;
  }): Promise<NpAgentModeratorCollectionResultV1>;
}
/** Explicit invocation of existing detector over at most 100 exact, unresolved actual report observations. */
export function createAgentModeratorCommentReportCollectorV1(options: {
  staffUserId: string;
  incidents: NpAgentIncidentWriteServiceV1;
  now?: () => Date;
}): NpAgentModeratorCommentReportCollectorV1 {
  canonicalBodyUuid(options.staffUserId, "moderator.staffUserId");
  const now = options.now ?? (() => new Date());
  return {
    async collect(input) {
      npAssertAgentPreviewEffectsAllowed();
      const siteId = canonicalBodySiteId(input.siteId, "moderator.siteId");
      if (npAgentModeratorWindowStartedAtV1(input.windowStartedAt) !== input.windowStartedAt)
        unavailable();
      const start = new Date(input.windowStartedAt),
        end = new Date(start.getTime() + 600_000);
      if (end > now()) unavailable();
      const settings = npRequireAgentModeratorSettingsV1(input.settings);
      return withCurrentSite(siteId, () =>
        npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
          const user = await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
          const sources = await db
            .select()
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, siteId),
                eq(npAgentEvents.sourceKind, "community"),
                eq(npAgentEvents.sourceComponent, SOURCE),
                eq(npAgentEvents.kind, "community.content.reported"),
                gte(npAgentEvents.occurredAt, start),
                lt(npAgentEvents.occurredAt, end),
              ),
            )
            .orderBy(asc(npAgentEvents.occurredAt), asc(npAgentEvents.id))
            .limit(101);
          if (sources.length > 100)
            throw new NpAgentGatewayError(
              "MODERATOR_COLLECTION_LIMIT",
              409,
              "The selected moderation window exceeds the bounded collector capacity.",
            );
          const facts: NpAgentModeratorFactV1[] = [];
          for (const source of sources) {
            if (
              source.subject?.kind !== "comment" ||
              !settings.collectionSlugs.includes(source.subject.collection)
            )
              continue;
            const fact = await npReadAgentModeratorCommentReportFactV1(db, source, user);
            if (fact) facts.push(fact);
          }
          const candidates = await npDetectAgentRepeatedLinkSpamV1({
            siteId,
            windowStartedAt: input.windowStartedAt,
            settings,
            facts,
          });
          const observations: NpAgentModeratorCollectionResultV1["observations"] = [];
          for (const candidate of candidates)
            observations.push(await options.incidents.observe(candidate, { transaction: db }));
          await npResolveAgentModeratorStaffUserV1(db, siteId, options.staffUserId);
          return { inspectedEvents: sources.length, acceptedFacts: facts.length, observations };
        }),
      );
    },
  };
}
