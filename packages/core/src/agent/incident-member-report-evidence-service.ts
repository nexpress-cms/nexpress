import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentEvents, npAgentIncidentSignals, npAgentSignals } from "../db/schema/agent.js";
import { canonicalBodyUuid } from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npRequireAgentIncidentMemberReportEvidenceV1,
  type NpAgentIncidentMemberReportEvidenceV1,
  type NpAgentIncidentMemberReportEvidenceItemV1,
} from "../agent-contract/incident-member-report-contract.js";
import { npAgentModeratorMemberReportDetectorV1 } from "../agent-contract/moderator-member-report-contract.js";
import type {
  NpAgentEvidenceRef,
  NpAgentSignalEvidenceCanonicalV1,
} from "../agent-contract/types.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import { withCurrentSite } from "../sites/context.js";
import {
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
} from "./admin-admission.js";
import { createAgentCursorCodecV1 } from "./cursor.js";
import {
  npReadAgentIncidentSignalEvidenceV1,
  type NpAgentIncidentServiceOptionsV1,
  type NpAgentIncidentStaffContextV1,
  type NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import { npInspectAgentModeratorMemberReportSourceV1 } from "./moderator-member-report-source.js";

type Db = ReturnType<typeof getDb>;
type SignalRow = typeof npAgentSignals.$inferSelect;
type Input = Omit<NpAgentIncidentStaffContextV1, "transaction"> & { incidentId: string };
type Ref = Extract<NpAgentEvidenceRef, { kind: "event" }>;
type Group = { eventId: string; signalIds: string[]; refs: Ref[] };
export interface NpAgentIncidentMemberReportEvidenceServiceV1 {
  canReadStaffIncident: NonNullable<NpAgentIncidentServiceOptionsV1["canReadStaffIncident"]>;
  get(input: Input & { cursor?: string | null }): Promise<NpAgentIncidentMemberReportEvidenceV1>;
}
const unavailable = () =>
  new NpAgentGatewayError(
    "INCIDENT_EVIDENCE_UNAVAILABLE",
    409,
    "Incident member report evidence is unavailable.",
  );
const invalidCursor = () =>
  new NpAgentGatewayError(
    "INCIDENT_MEMBER_REPORT_EVIDENCE_CURSOR_INVALID",
    400,
    "Member report evidence cursor is invalid.",
  );
function claimsOnly(signal: SignalRow): boolean {
  return (
    signal.severity === "info" &&
    signal.confidenceBasis === "external" &&
    signal.scoreBasisPoints === null
  );
}
/** Explicit staff-only read installation; no member response or Runtime authority is supplied. */
export function createAgentIncidentMemberReportEvidenceServiceV1(options: {
  reads: NpAgentIncidentStaffReadServiceV1;
  cursorHmacKey: Uint8Array;
  now?: () => Date;
}): NpAgentIncidentMemberReportEvidenceServiceV1 {
  const now = options.now ?? (() => new Date());
  const codec = createAgentCursorCodecV1(
    options.cursorHmacKey,
    "np.agent-incident-member-report-evidence.cursor",
  );
  async function authorize(db: Db, input: NpAgentIncidentStaffContextV1) {
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
    return auth;
  }
  function valid(
    incident: NpAgentIncidentV1,
    signals: readonly NpAgentSignalEvidenceCanonicalV1[],
    siteId: string,
  ) {
    const subject = incident.primarySubject;
    return (
      incident.siteId === siteId &&
      incident.category === "abuse" &&
      subject?.kind === "member" &&
      signals.length > 0 &&
      signals.length <= 100 &&
      incident.signalIds.length === signals.length &&
      new Set(incident.signalIds).size === signals.length &&
      signals.every(
        (s) =>
          s.siteId === siteId &&
          s.category === "abuse" &&
          s.detectorId === npAgentModeratorMemberReportDetectorV1 &&
          s.detectorVersion === 1 &&
          s.subject?.kind === "member" &&
          s.subject.memberId === subject.memberId &&
          s.evidence.length > 0 &&
          s.evidence.every(
            (r) => r.kind === "event" && r.eventKind === "community.member.reported",
          ),
      )
    );
  }
  function groups(
    signals: readonly { id: string; canonical: NpAgentSignalEvidenceCanonicalV1 }[],
  ): Group[] {
    const grouped = new Map<string, Group>();
    for (const signal of signals)
      for (const ref of signal.canonical.evidence) {
        if (ref.kind !== "event") throw unavailable();
        const group = grouped.get(ref.eventId) ?? { eventId: ref.eventId, signalIds: [], refs: [] };
        if (!group.signalIds.includes(signal.id)) group.signalIds.push(signal.id);
        group.refs.push(ref);
        grouped.set(ref.eventId, group);
      }
    if (grouped.size > 100) throw unavailable();
    return [...grouped.values()].sort((a, b) =>
      a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0,
    );
  }
  async function project(
    db: Db,
    incident: NpAgentIncidentV1,
    sources: (typeof npAgentEvents.$inferSelect)[],
    group: Group,
  ): Promise<NpAgentIncidentMemberReportEvidenceItemV1> {
    const missing: NpAgentIncidentMemberReportEvidenceItemV1 = {
      eventId: group.eventId,
      signalIds: group.signalIds,
      availability: "unavailable",
      target: null,
      observed: null,
      current: null,
      responseEligible: false,
    };
    const row = sources.find((s) => s.id === group.eventId);
    if (!row || row.siteId !== incident.siteId || incident.primarySubject?.kind !== "member")
      return missing;
    const inspected = await npInspectAgentModeratorMemberReportSourceV1(db, row);
    if (!inspected) return missing;
    const event = inspected.source.event;
    const digest = Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
      "hex",
    );
    if (
      event.subject.memberId !== incident.primarySubject.memberId ||
      group.refs.some(
        (r) =>
          r.digest !== digest ||
          r.eventKind !== event.kind ||
          r.observedAt !== event.occurredAt ||
          r.excerpt !== null,
      )
    )
      return missing;
    return {
      eventId: group.eventId,
      signalIds: group.signalIds,
      availability: "available",
      target: { kind: "member", id: inspected.member.id },
      observed: {
        occurredAt: event.occurredAt,
        retentionExpiresAt: row.expiresAt.toISOString(),
        status: "active",
        claim: "unverified",
      },
      current: {
        state: inspected.unchanged ? "unchanged" : "changed",
        status: inspected.member.status,
        updatedAt: inspected.member.updatedAt.toISOString(),
        versionDigest: inspected.versionDigest,
        report: {
          status: inspected.report.resolvedAt === null ? "unresolved" : "resolved",
          resolvedAt: inspected.report.resolvedAt?.toISOString() ?? null,
        },
      },
      responseEligible: false,
    };
  }
  async function sourceRows(db: Db, siteId: string, grouped: Group[]) {
    return grouped.length
      ? db
          .select()
          .from(npAgentEvents)
          .where(
            and(
              eq(npAgentEvents.siteId, siteId),
              inArray(
                npAgentEvents.id,
                grouped.map((g) => g.eventId),
              ),
            ),
          )
          .orderBy(asc(npAgentEvents.id))
      : [];
  }
  async function snapshot(db: Db, input: Input) {
    const auth = await authorize(db, input);
    const { incident } = await options.reads.get(
      { incidentId: input.incidentId },
      { ...input, transaction: db },
    );
    const rows = await db
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
      rows.length > 100 ||
      serializeAgentCanonicalJson(rows.map((r) => r.signal.id)) !==
        serializeAgentCanonicalJson(incident.signalIds)
    )
      throw unavailable();
    const signals = [];
    for (const { signal } of rows) {
      if (
        !claimsOnly(signal) ||
        signal.siteId !== input.siteId ||
        signal.incidentId !== incident.id
      )
        throw unavailable();
      signals.push({ id: signal.id, canonical: await npReadAgentIncidentSignalEvidenceV1(signal) });
    }
    if (
      !valid(
        incident,
        signals.map((s) => s.canonical),
        input.siteId,
      )
    )
      throw unavailable();
    const grouped = groups(signals);
    const sources = await sourceRows(db, input.siteId, grouped);
    const items = [];
    for (const group of grouped) items.push(await project(db, incident, sources, group));
    if (items.some((item) => item.availability !== "available")) throw unavailable();
    return {
      incident,
      items,
      binding: codec.mac(
        serializeAgentCanonicalJson({ siteId: input.siteId, auth, incident, signals, items }),
      ),
    };
  }
  return {
    canReadStaffIncident: ({ incident, signals, context }) =>
      withCurrentSite(context.siteId, async () => {
        try {
          const db = context.transaction ?? getDb();
          const initial = await authorize(db, context);
          if (!valid(incident, signals, context.siteId)) return false;
          const rows = await db
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
                eq(npAgentIncidentSignals.siteId, context.siteId),
                eq(npAgentIncidentSignals.incidentId, incident.id),
              ),
            )
            .orderBy(asc(npAgentSignals.id))
            .limit(101);
          if (
            serializeAgentCanonicalJson(rows.map(({ signal }) => signal.id)) !==
            serializeAgentCanonicalJson(incident.signalIds)
          )
            return false;
          for (const [index, { signal }] of rows.entries()) {
            if (
              !claimsOnly(signal) ||
              signal.siteId !== context.siteId ||
              signal.incidentId !== incident.id ||
              serializeAgentCanonicalJson(await npReadAgentIncidentSignalEvidenceV1(signal)) !==
                serializeAgentCanonicalJson(signals[index])
            )
              return false;
          }
          const grouped = groups(
            signals.map((canonical, index) => ({ id: incident.signalIds[index], canonical })),
          );
          const sources = await sourceRows(db, context.siteId, grouped);
          for (const group of grouped) {
            if ((await project(db, incident, sources, group)).availability !== "available")
              return false;
          }
          return (
            serializeAgentCanonicalJson(initial) ===
            serializeAgentCanonicalJson(await authorize(db, context))
          );
        } catch {
          return false;
        }
      }),
    get: (input) =>
      withCurrentSite(input.siteId, async () => {
        canonicalBodyUuid(input.incidentId, "incident.memberReport.id");
        const db = getDb(),
          state = await snapshot(db, input);
        let offset = 0;
        if (input.cursor !== undefined && input.cursor !== null) {
          try {
            const cursor = codec.open(input.cursor) as {
              binding?: unknown;
              offset?: unknown;
              expires?: unknown;
            };
            if (
              cursor.binding !== state.binding ||
              typeof cursor.offset !== "number" ||
              !Number.isInteger(cursor.offset) ||
              cursor.offset <= 0 ||
              cursor.offset >= state.items.length ||
              cursor.offset % 10 !== 0 ||
              typeof cursor.expires !== "number" ||
              cursor.expires <= now().getTime()
            )
              throw invalidCursor();
            offset = cursor.offset;
          } catch {
            throw invalidCursor();
          }
        }
        const current = await snapshot(db, input);
        if (current.binding !== state.binding) throw unavailable();
        return npRequireAgentIncidentMemberReportEvidenceV1({
          schemaVersion: "np.agent-incident-member-report-evidence.v1",
          incidentId: state.incident.id,
          incidentVersion: state.incident.versionNumber,
          items: state.items.slice(offset, offset + 10),
          nextCursor:
            offset + 10 < state.items.length
              ? codec.seal({
                  binding: state.binding,
                  offset: offset + 10,
                  expires: now().getTime() + 900000,
                })
              : null,
        });
      }),
  };
}
