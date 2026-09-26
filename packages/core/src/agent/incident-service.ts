import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentIncidents, npAgentIncidentSignals, npAgentSignals } from "../db/schema/agent.js";
import {
  npRequireAgentIncidentGetInputV1,
  npRequireAgentIncidentListInputV1,
  npRequireAgentIncidentV1,
  type NpAgentIncidentGetInputV1,
  type NpAgentIncidentListInputV1,
  type NpAgentIncidentOutputV1,
  type NpAgentIncidentListOutputV1,
  type NpAgentIncidentV1,
} from "../agent-contract/incident-contract.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { NpAgentSignalEvidenceCanonicalV1, NpAgentSubject } from "../agent-contract/types.js";
import type { NpAgentReadCapabilityContextV1 } from "./capability-registry.js";
import { NpAgentGatewayError, npResolveLiveAgentStaffAuthorizationV1 } from "./admin-admission.js";
import { createAgentCursorCodecV1 } from "./cursor.js";

type Context = NpAgentReadCapabilityContextV1;
type Incident = typeof npAgentIncidents.$inferSelect;
export interface NpAgentIncidentServiceV1 {
  get(input: NpAgentIncidentGetInputV1, context: Context): Promise<NpAgentIncidentOutputV1>;
  list(input: NpAgentIncidentListInputV1, context: Context): Promise<NpAgentIncidentListOutputV1>;
}
export interface NpAgentIncidentServiceOptionsV1 {
  cursorHmacKey: Uint8Array;
  /** Existing domain owners must check ALL subjects and evidence targets under current authority.
   * Required even for staff admins; unknown/missing owners must return false.
   * This is an additional item ACL, never a replacement for capability admission. */
  canReadIncident(input: {
    incident: NpAgentIncidentV1;
    signals: readonly NpAgentSignalEvidenceCanonicalV1[];
    context: Context;
  }): boolean | Promise<boolean>;
  now?: () => Date;
}
const missing = () =>
  new NpAgentGatewayError("INCIDENT_NOT_FOUND", 404, "Incident is unavailable.");
const forbidden = () =>
  new NpAgentGatewayError("INCIDENT_FORBIDDEN", 403, "Incident permission is required.");
const invalidCursor = () =>
  new NpAgentGatewayError("INCIDENT_CURSOR_INVALID", 400, "Incident cursor is invalid.");

/** Explicit read-only host installation. Admission owns credential/policy revalidation;
 * this owner adds site isolation, live staff authority and per-item domain visibility. */
export function createAgentIncidentServiceV1(
  options: NpAgentIncidentServiceOptionsV1,
): NpAgentIncidentServiceV1 {
  if (typeof options.canReadIncident !== "function")
    throw new Error("Incident visibility owner is required.");
  const codec = createAgentCursorCodecV1(options.cursorHmacKey, "np.agent-incident.cursor");
  const now = options.now ?? (() => new Date());
  async function authority(context: Context) {
    if (
      context.abortSignal.aborted ||
      context.siteId !== context.principal.siteId ||
      !context.principal.scopes.includes("incident:read")
    )
      throw forbidden();
    if (context.principal.kind === "runtime" && !context.runtimeResources) throw forbidden();
    if (context.principal.authority.kind !== "user") return null;
    return npResolveLiveAgentStaffAuthorizationV1(
      context.transaction ?? getDb(),
      context.siteId,
      context.principal.authority.userId,
    );
  }
  async function project(row: Incident, context: Context): Promise<NpAgentIncidentV1 | null> {
    const auth = await authority(context);
    const resources = context.runtimeResources;
    if (
      context.principal.kind === "runtime" &&
      resources?.incidentCategories !== null &&
      !resources?.incidentCategories.includes(row.category as NpAgentIncidentV1["category"])
    )
      return null;
    const subjectAllowed = (subject: NpAgentSubject | null) => {
      if (!subject) return true;
      if (subject.kind === "site" && subject.siteId !== context.siteId) return false;
      return !(
        context.principal.kind === "runtime" &&
        (subject.kind === "document" || subject.kind === "comment") &&
        resources?.collections !== null &&
        !resources?.collections.includes(subject.collection)
      );
    };
    if (!subjectAllowed(row.primarySubject)) return null;
    if (
      auth &&
      !auth.authority.capabilities.includes(
        row.category === "spam" || row.category === "abuse" ? "community.moderate" : "admin.manage",
      )
    )
      return null;
    const db = context.transaction ?? getDb();
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
          eq(npAgentIncidentSignals.siteId, context.siteId),
          eq(npAgentIncidentSignals.incidentId, row.id),
        ),
      )
      .orderBy(asc(npAgentSignals.id))
      .limit(101);
    if (signals.length > 100) return null;
    try {
      const evidence: NpAgentSignalEvidenceCanonicalV1[] = [];
      for (const { signal } of signals) {
        const canonical = npRequireAgentSignalEvidenceCanonical({
          schemaVersion: "np.agent-signal-evidence.v1",
          siteId: signal.siteId,
          detectorId: signal.detectorId,
          detectorVersion: signal.detectorVersion,
          category: signal.category,
          window: {
            startedAt: signal.windowStartedAt.toISOString(),
            endedAt: signal.windowEndedAt.toISOString(),
          },
          subject: signal.subject,
          evidence: signal.evidence,
        });
        if ((await npDigestAgentSignalEvidenceCanonical(canonical)) !== signal.evidenceDigest)
          return null;
        if (!subjectAllowed(canonical.subject)) return null;
        if (
          context.principal.kind === "runtime" &&
          resources?.incidentCategories !== null &&
          !resources?.incidentCategories.includes(canonical.category)
        )
          return null;
        if (
          auth &&
          !auth.authority.capabilities.includes(
            canonical.category === "spam" || canonical.category === "abuse"
              ? "community.moderate"
              : "admin.manage",
          )
        )
          return null;
        if (
          context.principal.kind === "runtime" &&
          resources?.collections !== null &&
          canonical.evidence.some(
            (ref) => ref.kind === "revision" && !resources?.collections?.includes(ref.collection),
          )
        )
          return null;
        evidence.push(canonical);
      }
      const incident = npRequireAgentIncidentV1({
        version: "np.agent-incident.v1",
        id: row.id,
        siteId: row.siteId,
        fingerprint: row.fingerprint,
        category: row.category,
        severity: row.severity,
        status: row.status,
        title: row.title,
        summary: row.summary,
        primarySubject: row.primarySubject,
        assignedAgentId: row.assignedAgentId,
        signalIds: signals.map(({ signal }) => signal.id),
        eventCount: row.eventCount,
        firstObservedAt: row.firstObservedAt.toISOString(),
        lastObservedAt: row.lastObservedAt.toISOString(),
        containedAt: row.containedAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        resolutionCode: row.resolutionCode,
        versionNumber: row.versionNumber,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      if (
        (await options.canReadIncident({
          incident: structuredClone(incident),
          signals: evidence,
          context,
        })) !== true
      )
        return null;
      if (
        serializeAgentCanonicalJson(await authority(context)) !== serializeAgentCanonicalJson(auth)
      )
        return null;
      const [current] = await db
        .select({ version: npAgentIncidents.versionNumber, updatedAt: npAgentIncidents.updatedAt })
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, context.siteId), eq(npAgentIncidents.id, row.id)))
        .limit(1);
      if (
        !current ||
        current.version !== row.versionNumber ||
        current.updatedAt.getTime() !== row.updatedAt.getTime()
      )
        return null;
      return npRequireAgentIncidentV1(incident);
    } catch {
      return null;
    }
  }
  return {
    async get(value, context) {
      const input = npRequireAgentIncidentGetInputV1(value);
      await authority(context);
      const [row] = await (context.transaction ?? getDb())
        .select()
        .from(npAgentIncidents)
        .where(
          and(
            eq(npAgentIncidents.siteId, context.siteId),
            eq(npAgentIncidents.id, input.incidentId),
          ),
        )
        .limit(1);
      const incident = row ? await project(row, context) : null;
      if (!incident) throw missing();
      return { schemaVersion: "np.agent-incident-result.v1", incident };
    },
    async list(value, context) {
      const input = npRequireAgentIncidentListInputV1(value);
      const initialAuthority = await authority(context);
      const binding = codec.mac(
        serializeAgentCanonicalJson({
          siteId: context.siteId,
          principal: context.principal,
          authority: initialAuthority,
          runtimeResources: context.runtimeResources ?? null,
          filters: { ...input, cursor: null },
        }),
      );
      let after: { updatedAt: string; id: string } | null = null;
      const at = now();
      if (input.cursor) {
        try {
          const body = codec.open(input.cursor) as {
            binding?: unknown;
            expiresAt?: unknown;
            after?: { updatedAt?: unknown; id?: unknown };
          };
          if (
            body.binding !== binding ||
            typeof body.expiresAt !== "number" ||
            body.expiresAt <= at.getTime() ||
            body.expiresAt > at.getTime() + 900_000 ||
            typeof body.after?.updatedAt !== "string" ||
            !Number.isFinite(Date.parse(body.after.updatedAt)) ||
            typeof body.after.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.after.id)
          )
            throw invalidCursor();
          after = { updatedAt: body.after.updatedAt, id: body.after.id };
        } catch {
          throw invalidCursor();
        }
      }
      // Scan at most one bounded page; a page may be empty with a continuation.
      // Never leak a total count or stop early merely because an item is hidden.
      const rows = await (context.transaction ?? getDb())
        .select()
        .from(npAgentIncidents)
        .where(
          and(
            eq(npAgentIncidents.siteId, context.siteId),
            input.statuses.length ? inArray(npAgentIncidents.status, input.statuses) : undefined,
            input.categories.length
              ? inArray(npAgentIncidents.category, input.categories)
              : undefined,
            input.severities.length
              ? inArray(npAgentIncidents.severity, input.severities)
              : undefined,
            input.updatedAfter
              ? gt(npAgentIncidents.updatedAt, new Date(input.updatedAfter))
              : undefined,
            after
              ? or(
                  gt(npAgentIncidents.updatedAt, new Date(after.updatedAt)),
                  and(
                    eq(npAgentIncidents.updatedAt, new Date(after.updatedAt)),
                    gt(npAgentIncidents.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(npAgentIncidents.updatedAt), asc(npAgentIncidents.id))
        .limit(input.limit + 1);
      const items: NpAgentIncidentV1[] = [];
      for (const row of rows.slice(0, input.limit)) {
        const visible = await project(row, context);
        if (visible) items.push(visible);
      }
      if (
        serializeAgentCanonicalJson(await authority(context)) !==
        serializeAgentCanonicalJson(initialAuthority)
      )
        throw forbidden();
      const last = rows[Math.min(rows.length, input.limit) - 1];
      const nextCursor =
        rows.length > input.limit && last
          ? codec.seal({
              binding,
              expiresAt: at.getTime() + 900_000,
              after: { updatedAt: last.updatedAt.toISOString(), id: last.id },
            })
          : null;
      return { schemaVersion: "np.agent-incident-list.v1", items, nextCursor };
    },
  };
}
