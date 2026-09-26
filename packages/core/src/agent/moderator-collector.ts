import { createHash } from "node:crypto";
import { npRequireAuthUser } from "../auth-contract/contract.js";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
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
import { npRequireCommentRow } from "../community-contract/contract.js";
import type { NpCommentRow } from "../community-contract/types.js";
import { npInspectCommunityContentContainmentV1 } from "../community/content-containment.js";
import type {
  NpCommunityModerationObservationV1,
  NpCommunityModerationObserverV1,
} from "../community/moderation-observer.js";
import type { NpTransaction } from "../collections/pipeline.js";
import type { NpAuthUser } from "../config/types.js";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents } from "../db/schema/agent.js";
import { npComments } from "../db/schema/community.js";
import { npUsers } from "../db/schema/system.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { withCurrentSite } from "../sites/context.js";
import { npResolveLiveAgentStaffAuthorizationV1, NpAgentGatewayError } from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type {
  NpAgentIncidentWriteServiceV1,
  NpAgentIncidentObservationResultV1,
} from "./incident-write-service.js";
import {
  npAgentModeratorWindowStartedAtV1,
  npDetectAgentRepeatedLinkSpamV1,
  npExtractAgentModeratorDomainHashesV1,
} from "./moderator-detector.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import type { createAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof npAgentEvents.$inferSelect;
type Verdicts = Pick<NpCommunityModerationObservationV1, "spamVerdict" | "profanityVerdict">;
const SOURCE = "community.comments";
function unavailable(): never {
  throw new NpAgentGatewayError(
    "MODERATOR_SOURCE_UNAVAILABLE",
    409,
    "Moderator evidence is unavailable.",
  );
}
function code(verdicts: Verdicts): string {
  if (
    !["pass", "flag"].includes(verdicts.spamVerdict) ||
    !["pass", "flag"].includes(verdicts.profanityVerdict)
  )
    unavailable();
  return `SPAM_${verdicts.spamVerdict.toUpperCase()}_PROFANITY_${verdicts.profanityVerdict.toUpperCase()}`;
}
function verdicts(value: string | null): Verdicts | null {
  const match = /^SPAM_(PASS|FLAG)_PROFANITY_(PASS|FLAG)$/u.exec(value ?? "");
  return match
    ? {
        spamVerdict: match[1] === "FLAG" ? "flag" : "pass",
        profanityVerdict: match[2] === "FLAG" ? "flag" : "pass",
      }
    : null;
}
/** Only a digest leaves the existing content owner; no body is copied to Agent storage. */
export function npAgentModeratorCommentSourceKeyV1(
  rowInput: NpCommentRow,
  outcome: Verdicts,
): string {
  const row = npRequireCommentRow(rowInput);
  const body = {
    siteId: row.siteId,
    id: row.id,
    collection: row.targetType,
    documentId: row.targetId,
    memberId: row.memberId,
    parentId: row.parentId,
    bodyMd: row.bodyMd,
    bodyHtml: row.bodyHtml,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    verdictCode: code(outcome),
  };
  return `moderator.comment.v1:${createHash("sha256").update("np.agent-moderator-comment-source.v1\0").update(serializeAgentCanonicalJson(body)).digest("hex")}`;
}
export function npBuildAgentModeratorCommentEventV1(
  input: Omit<NpCommunityModerationObservationV1, "db">,
): NpAgentEventCanonicalV1 | null {
  const row = npRequireCommentRow(input.row);
  if (row.status !== "visible" && row.status !== "pending") return null;
  canonicalBodyUuid(input.actorMemberId, "moderator.actorMemberId");
  const kind =
    input.operation === "create" ? "community.content.created" : "community.content.moderated";
  return npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: row.siteId,
    kind,
    occurredAt: (input.operation === "create"
      ? row.createdAt
      : (row.editedAt ?? row.createdAt)
    ).toISOString(),
    source: { kind: "community", component: SOURCE },
    subject: {
      kind: "comment",
      commentId: row.id,
      collection: row.targetType,
      documentId: row.targetId,
    },
    actor: { kind: "member", memberId: input.actorMemberId },
    causation: null,
    correlationId: null,
    deduplicationKey: npAgentModeratorCommentSourceKeyV1(row, input),
    privacy: "internal",
    payload: {
      kind,
      targetKind: "comment",
      targetId: row.id,
      collection: row.targetType,
      authorMemberId: row.memberId,
      verdictCode: code(input),
      status: row.status,
    },
  });
}
/** Install explicitly through core/bootstrap. Recording never dispatches events or starts Runtime. */
export function createAgentModeratorCommentObserverV1(options: {
  events: Pick<ReturnType<typeof createAgentRuntimeEventServiceV1>, "record">;
}): NpCommunityModerationObserverV1 {
  return {
    async prepare({ db, siteId }) {
      await npWithAgentRuntimeControlTransactionV1(siteId, async () => {}, db);
    },
    async record(input) {
      const event = npBuildAgentModeratorCommentEventV1(input);
      if (event) await options.events.record({ siteId: event.siteId, event, db: input.db });
    },
  };
}
function envelope(row: EventRow): NpAgentEventCanonicalV1 {
  return npRequireAgentEventCanonical({
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
}
async function currentUser(db: Db, siteId: string, staffUserId: string): Promise<NpAuthUser> {
  const live = await npResolveLiveAgentStaffAuthorizationV1(db, siteId, staffUserId);
  if (!live.authority.capabilities.includes("community.moderate")) unavailable();
  const [row] = await db
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, staffUserId))
    .limit(1);
  if (!row) unavailable();
  return npRequireAuthUser({
    ...row,
    role: live.authority.kind === "super-admin" ? "admin" : live.authority.role,
  });
}
async function readFact(
  db: Db,
  source: EventRow,
  user: NpAuthUser,
): Promise<NpAgentModeratorFactV1 | null> {
  const event = envelope(source);
  if ((await npDigestAgentEventCanonical(event)) !== source.eventHash) unavailable();
  if (
    event.source.kind !== "community" ||
    event.source.component !== SOURCE ||
    event.subject?.kind !== "comment" ||
    (event.payload.kind !== "community.content.created" &&
      event.payload.kind !== "community.content.moderated") ||
    event.payload.targetKind !== "comment"
  )
    return null;
  const outcome = verdicts(event.payload.verdictCode);
  if (
    !outcome ||
    event.payload.targetId !== event.subject.commentId ||
    event.payload.collection !== event.subject.collection ||
    event.actor?.kind !== "member" ||
    event.actor.memberId !== event.payload.authorMemberId
  )
    return null;
  let versionDigest: string;
  try {
    ({ versionDigest } = await npInspectCommunityContentContainmentV1(
      db as unknown as NpTransaction,
      {
        siteId: source.siteId,
        target: {
          kind: "comment",
          collection: event.subject.collection,
          id: event.subject.commentId,
        },
        user,
      },
    ));
  } catch (error) {
    if (
      error instanceof NpForbiddenError ||
      error instanceof NpNotFoundError ||
      error instanceof NpValidationError
    )
      return null;
    throw error;
  }
  const [raw] = await db
    .select()
    .from(npComments)
    .where(and(eq(npComments.siteId, source.siteId), eq(npComments.id, event.subject.commentId)))
    .limit(1);
  if (!raw) return null;
  const row = npRequireCommentRow(raw);
  if (
    (row.status !== "visible" && row.status !== "pending") ||
    row.targetId !== event.subject.documentId ||
    row.memberId !== event.payload.authorMemberId ||
    row.status !== event.payload.status ||
    event.deduplicationKey !== npAgentModeratorCommentSourceKeyV1(row, outcome) ||
    (row.editedAt ?? row.createdAt).toISOString() !== event.occurredAt
  )
    return null;
  return npRequireAgentModeratorFactV1({
    schemaVersion: "np.agent-moderator-fact.v1",
    siteId: source.siteId,
    observedAt: event.occurredAt,
    subject: event.subject,
    memberId: row.memberId,
    targetVersionDigest: versionDigest,
    domainHashes: npExtractAgentModeratorDomainHashesV1(row.bodyMd),
    ...outcome,
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
/** Re-resolve all immutable refs and current domain ACLs inside the Incident writer transaction. */
export async function npResolveAgentModeratorCommentEvidenceV1(input: {
  db: Db;
  candidate: NpAgentModeratorSignalCandidateV1;
  staffUserId: string;
}): Promise<boolean> {
  const candidate = npRequireAgentModeratorSignalCandidateV1(input.candidate);
  canonicalBodyUuid(input.staffUserId, "moderator.staffUserId");
  const siteId = candidate.canonicalEvidence.siteId;
  return withCurrentSite(siteId, async () => {
    const user = await currentUser(input.db, siteId, input.staffUserId);
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
      const actual = await readFact(input.db, source, user);
      if (!actual || serializeAgentCanonicalJson(actual) !== serializeAgentCanonicalJson(expected))
        return false;
    }
    return true;
  });
}
export interface NpAgentModeratorCollectionResultV1 {
  inspectedEvents: number;
  acceptedFacts: number;
  observations: NpAgentIncidentObservationResultV1[];
}
/** Explicit host invocation over a closed window. Missing/legacy evidence is omitted, never treated as a pass verdict. */
export function createAgentModeratorCollectorV1(options: {
  staffUserId: string;
  incidents: NpAgentIncidentWriteServiceV1;
  now?: () => Date;
}) {
  canonicalBodyUuid(options.staffUserId, "moderator.staffUserId");
  const now = options.now ?? (() => new Date());
  return {
    async collect(input: {
      siteId: string;
      windowStartedAt: string;
      settings: NpAgentModeratorSettingsV1;
    }): Promise<NpAgentModeratorCollectionResultV1> {
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
          const user = await currentUser(db, siteId, options.staffUserId);
          const sources = await db
            .select()
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, siteId),
                eq(npAgentEvents.sourceKind, "community"),
                eq(npAgentEvents.sourceComponent, SOURCE),
                inArray(npAgentEvents.kind, [
                  "community.content.created",
                  "community.content.moderated",
                ]),
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
            const fact = await readFact(db, source, user);
            if (fact) facts.push(fact);
          }
          const candidates = await npDetectAgentRepeatedLinkSpamV1({
            siteId,
            windowStartedAt: input.windowStartedAt,
            settings,
            facts,
          });
          const observations: NpAgentIncidentObservationResultV1[] = [];
          for (const candidate of candidates)
            observations.push(await options.incidents.observe(candidate, { transaction: db }));
          await currentUser(db, siteId, options.staffUserId);
          return { inspectedEvents: sources.length, acceptedFacts: facts.length, observations };
        }),
      );
    },
  };
}
