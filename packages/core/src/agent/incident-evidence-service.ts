import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentIncidentSignals, npAgentSignals } from "../db/schema/agent.js";
import type { NpTransaction } from "../collections/pipeline.js";
import {
  npInspectCommunityCommentEvidenceV1,
  type NpCommunityContentTargetV1,
} from "../community/content-containment.js";
import { NpForbiddenError, NpNotFoundError, NpValidationError } from "../errors.js";
import { withCurrentSite } from "../sites/context.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import type { NpAgentEvidenceRef } from "../agent-contract/types.js";
import {
  npRequireAgentIncidentEvidenceV1,
  type NpAgentIncidentEvidenceV1,
  type NpAgentIncidentEvidenceItemV1,
} from "../agent-contract/incident-evidence-contract.js";
import {
  npReadAgentIncidentSignalEvidenceV1,
  type NpAgentIncidentStaffContextV1,
  type NpAgentIncidentStaffReadServiceV1,
  type NpAgentIncidentServiceOptionsV1,
} from "./incident-service.js";
import {
  npReadAgentModeratorCommentSourceV1,
  npResolveAgentModeratorStaffUserV1,
  npAgentModeratorCommentSourceKeyV1,
} from "./moderator-collector.js";
import {
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
} from "./admin-admission.js";
import { createAgentCursorCodecV1 } from "./cursor.js";

type Db = ReturnType<typeof getDb>;
type Facts = {
  user: Awaited<ReturnType<typeof npResolveAgentModeratorStaffUserV1>>;
  auth: Awaited<ReturnType<typeof npResolveAgentStaffSessionAuthorizationV1>>;
  incident: NpAgentIncidentV1;
  sources: (typeof npAgentEvents.$inferSelect)[];
};
type Input = Omit<NpAgentIncidentStaffContextV1, "transaction"> & { incidentId: string };
type EventRef = Extract<NpAgentEvidenceRef, { kind: "event" }>;
type Group = { eventId: string; signalIds: string[]; refs: EventRef[] };
export interface NpAgentIncidentEvidenceServiceV1 {
  canReadStaffIncident: NonNullable<NpAgentIncidentServiceOptionsV1["canReadStaffIncident"]>;
  get(input: Input & { cursor?: string | null }): Promise<NpAgentIncidentEvidenceV1>;
  /** Directly reusable as response.resolveTargets. Caller transaction and canonical Incident remain bound. */
  resolveTargets(
    input: Input & { db: Db; incident: NpAgentIncidentV1 },
  ): Promise<NpCommunityContentTargetV1[]>;
}
const unavailable = () =>
  new NpAgentGatewayError(
    "INCIDENT_EVIDENCE_UNAVAILABLE",
    409,
    "Incident evidence is unavailable. Refresh and review current evidence.",
  );
const invalidCursor = () =>
  new NpAgentGatewayError(
    "INCIDENT_EVIDENCE_CURSOR_INVALID",
    400,
    "Incident evidence cursor is invalid.",
  );
/** Explicit host installation. Retained observations never grant content access or mutation authority. */
export function createAgentIncidentEvidenceServiceV1(options: {
  reads: NpAgentIncidentStaffReadServiceV1;
  cursorHmacKey: Uint8Array;
  now?: () => Date;
}): NpAgentIncidentEvidenceServiceV1 {
  const now = options.now ?? (() => new Date());
  const codec = createAgentCursorCodecV1(
    options.cursorHmacKey,
    "np.agent-incident-evidence.cursor",
  );
  async function snapshot(db: Db, input: Input) {
    canonicalBodyUuid(input.incidentId, "incidentId");
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      input.siteId,
      input.actor,
      now(),
    );
    if (
      !auth.authority.capabilities.includes("admin.manage") ||
      !auth.authority.capabilities.includes("community.moderate")
    )
      throw new NpAgentGatewayError("INCIDENT_FORBIDDEN", 403, "Incident permission is required.");
    const user = await npResolveAgentModeratorStaffUserV1(db, input.siteId, input.actor.user.id);
    const { incident } = await options.reads.get(
      { incidentId: input.incidentId },
      { ...input, transaction: db },
    );
    const signals = await db
      .select({ signal: npAgentSignals })
      .from(npAgentIncidentSignals)
      .innerJoin(
        npAgentSignals,
        and(
          eq(npAgentSignals.siteId, npAgentIncidentSignals.siteId),
          eq(npAgentSignals.id, npAgentIncidentSignals.signalId),
        ),
      )
      .where(
        and(
          eq(npAgentIncidentSignals.siteId, input.siteId),
          eq(npAgentIncidentSignals.incidentId, input.incidentId),
        ),
      )
      .orderBy(asc(npAgentSignals.id))
      .limit(101);
    if (
      signals.length > 100 ||
      serializeAgentCanonicalJson(signals.map((s) => s.signal.id)) !==
        serializeAgentCanonicalJson(incident.signalIds)
    )
      throw unavailable();
    const byEvent = new Map<string, Group>();
    for (const { signal } of signals) {
      const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
      for (const ref of canonical.evidence) {
        if (ref.kind !== "event") continue;
        let group = byEvent.get(ref.eventId);
        if (!group) {
          if (byEvent.size >= 100) throw unavailable();
          group = { eventId: ref.eventId, signalIds: [], refs: [] };
          byEvent.set(ref.eventId, group);
        }
        if (!group.signalIds.includes(signal.id)) group.signalIds.push(signal.id);
        group.refs.push(ref);
      }
    }
    const groups = [...byEvent.values()].sort((a, b) => a.eventId.localeCompare(b.eventId));
    const sources = groups.length
      ? await db
          .select()
          .from(npAgentEvents)
          .where(
            and(
              eq(npAgentEvents.siteId, input.siteId),
              inArray(
                npAgentEvents.id,
                groups.map((g) => g.eventId),
              ),
            ),
          )
          .orderBy(asc(npAgentEvents.id))
      : [];
    const items: NpAgentIncidentEvidenceItemV1[] = [];
    for (const group of groups)
      items.push(await project(db, input, { auth, incident, sources, user }, group));
    // The authenticated cursor carries only a binding MAC; no private source body leaves the server.
    const binding = codec.mac(
      JSON.stringify({
        siteId: input.siteId,
        sessionId: input.actor.sessionId,
        auth,
        user,
        incident,
        signals,
        sources,
        items,
      }),
    );
    return { auth, user, incident, groups, sources, binding, items };
  }
  async function project(
    db: Db,
    input: Input,
    facts: Facts,
    group: Group,
  ): Promise<NpAgentIncidentEvidenceItemV1> {
    const missing: NpAgentIncidentEvidenceItemV1 = {
      eventId: group.eventId,
      signalIds: group.signalIds,
      availability: "unavailable",
      target: null,
      observed: null,
      current: null,
      responseEligible: false,
    };
    const source = facts.sources.find((s) => s.id === group.eventId);
    if (!source) return missing;
    let checked;
    try {
      checked = await npReadAgentModeratorCommentSourceV1(source);
    } catch {
      return missing;
    }
    if (!checked) return missing;
    const { event, outcome } = checked;
    const hexDigest = Buffer.from(
      source.eventHash.slice("cj1:sha256:".length),
      "base64url",
    ).toString("hex");
    if (
      group.refs.some(
        (ref) =>
          ref.digest !== hexDigest ||
          ref.eventKind !== event.kind ||
          ref.observedAt !== event.occurredAt,
      )
    )
      return missing;
    const target = {
      kind: "comment" as const,
      collection: event.subject.collection,
      id: event.subject.commentId,
    };
    let inspected;
    try {
      inspected = await npInspectCommunityCommentEvidenceV1(db as unknown as NpTransaction, {
        siteId: input.siteId,
        target,
        user: facts.user,
      });
    } catch (error) {
      if (
        error instanceof NpForbiddenError ||
        error instanceof NpNotFoundError ||
        error instanceof NpValidationError
      )
        return missing;
      throw error;
    }
    const row = inspected.comment;
    if (row.targetId !== event.subject.documentId || row.memberId !== event.payload.authorMemberId)
      return missing;
    const matches =
      event.deduplicationKey === npAgentModeratorCommentSourceKeyV1(row, outcome) &&
      (row.editedAt ?? row.createdAt).toISOString() === event.occurredAt &&
      row.status === event.payload.status;
    const state =
      row.status === "hidden" || row.status === "deleted"
        ? row.status
        : matches
          ? "unchanged"
          : "changed";
    return {
      eventId: group.eventId,
      signalIds: group.signalIds,
      availability: "available",
      target,
      observed: {
        occurredAt: event.occurredAt,
        retentionExpiresAt: source.expiresAt.toISOString(),
        status: event.payload.status,
        ...outcome,
      },
      current: {
        state,
        status: row.status,
        editedAt: row.editedAt?.toISOString() ?? null,
        versionDigest: inspected.versionDigest,
      },
      responseEligible:
        state === "unchanged" && !["resolved", "dismissed"].includes(facts.incident.status),
    };
  }
  async function current(db: Db, input: Input, previous: Awaited<ReturnType<typeof snapshot>>) {
    const next = await snapshot(db, input);
    if (next.binding !== previous.binding) throw unavailable();
  }
  return {
    canReadStaffIncident: ({ incident, signals, context }) =>
      withCurrentSite(context.siteId, async () => {
        const db = context.transaction ?? getDb();
        const auth = await npResolveAgentStaffSessionAuthorizationV1(
          db,
          context.siteId,
          context.actor,
          now(),
        );
        if (
          !auth.authority.capabilities.includes("admin.manage") ||
          !auth.authority.capabilities.includes("community.moderate") ||
          incident.siteId !== context.siteId
        )
          return false;
        // This source owner supports only its canonical comment observations, and never skips an unknown subject/ref.
        if (
          incident.primarySubject !== null ||
          !signals.length ||
          signals.length > 100 ||
          signals.some(
            (s) =>
              s.subject !== null ||
              s.siteId !== context.siteId ||
              !s.evidence.length ||
              s.evidence.some((ref) => ref.kind !== "event"),
          )
        )
          return false;
        const user = await npResolveAgentModeratorStaffUserV1(
          db,
          context.siteId,
          context.actor.user.id,
        );
        const refs = signals
          .flatMap((s) => s.evidence)
          .filter((ref): ref is EventRef => ref.kind === "event");
        const ids = [...new Set(refs.map((ref) => ref.eventId))];
        if (ids.length > 100) return false;
        const sources = await db
          .select()
          .from(npAgentEvents)
          .where(and(eq(npAgentEvents.siteId, context.siteId), inArray(npAgentEvents.id, ids)));
        for (const eventId of ids) {
          const item = await project(
            db,
            { ...context, incidentId: incident.id },
            { auth, incident, sources, user },
            { eventId, signalIds: [], refs: refs.filter((ref) => ref.eventId === eventId) },
          );
          if (item.availability !== "available") return false;
        }
        return true;
      }),
    get: (input) =>
      withCurrentSite(input.siteId, async () => {
        const db = getDb();
        const s = await snapshot(db, input);
        let offset = 0;
        if (input.cursor !== undefined && input.cursor !== null) {
          try {
            const c = codec.open(input.cursor) as {
              binding: unknown;
              offset: unknown;
              expires: unknown;
            };
            if (
              c.binding !== s.binding ||
              typeof c.offset !== "number" ||
              !Number.isInteger(c.offset) ||
              c.offset <= 0 ||
              c.offset >= s.groups.length ||
              c.offset % 10 !== 0 ||
              typeof c.expires !== "number" ||
              c.expires <= now().getTime()
            )
              throw invalidCursor();
            offset = c.offset;
          } catch {
            throw invalidCursor();
          }
        }
        const items = s.items.slice(offset, offset + 10);
        await current(db, input, s);
        return npRequireAgentIncidentEvidenceV1({
          schemaVersion: "np.agent-incident-evidence.v1",
          incidentId: s.incident.id,
          incidentVersion: s.incident.versionNumber,
          items,
          nextCursor:
            offset + 10 < s.groups.length
              ? codec.seal({
                  binding: s.binding,
                  offset: offset + 10,
                  expires: now().getTime() + 900000,
                })
              : null,
        });
      }),
    resolveTargets: (input) =>
      withCurrentSite(input.siteId, async () => {
        const s = await snapshot(input.db, input);
        if (serializeAgentCanonicalJson(input.incident) !== serializeAgentCanonicalJson(s.incident))
          throw unavailable();
        const unique = new Map<string, NpCommunityContentTargetV1>();
        for (const item of s.items) {
          if (item.responseEligible && item.target)
            unique.set(serializeAgentCanonicalJson(item.target), item.target);
        }
        await current(input.db, input, s);
        return [...unique.values()];
      }),
  };
}
