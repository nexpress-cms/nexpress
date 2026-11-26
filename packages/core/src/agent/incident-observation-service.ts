import { and, eq, inArray, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentIncidents,
  npAgentSignals,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
} from "../db/schema/agent.js";
import type {
  NpAgentSignalEvidenceCanonicalV1,
  NpAgentIncidentSeverity,
} from "../agent-contract/types.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type { NpAgentIncidentObservationResultV1 } from "./incident-write-service.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import { npAgentIncidentSeverityOrderV1 } from "../agent-contract/incident-severity-contract.js";
type Db = ReturnType<typeof getDb>;
type Signal = typeof npAgentSignals.$inferSelect;
export interface NpIncidentObservationCandidate {
  canonicalEvidence: NpAgentSignalEvidenceCanonicalV1;
  evidenceDigest: string;
  fingerprint: string;
  severity: NpAgentIncidentSeverity;
  confidenceBasis: "exact-rule" | "statistical" | "external";
  scoreBasisPoints: number | null;
  title: string;
  summary: string;
}
const fail = (code = "INCIDENT_EVIDENCE_INVALID", status = 409): never => {
  throw new NpAgentGatewayError(code, status, "Incident operation is unavailable.");
};
function signalCanonical(row: Signal): NpAgentSignalEvidenceCanonicalV1 {
  return npRequireAgentSignalEvidenceCanonical({
    schemaVersion: "np.agent-signal-evidence.v1",
    siteId: row.siteId,
    detectorId: row.detectorId,
    detectorVersion: row.detectorVersion,
    category: row.category,
    window: {
      startedAt: row.windowStartedAt.toISOString(),
      endedAt: row.windowEndedAt.toISOString(),
    },
    subject: row.subject,
    evidence: row.evidence,
  });
}
async function sequence(db: Db, siteId: string, incidentId: string): Promise<number> {
  const [row] = await db
    .select({ maximum: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)` })
    .from(npAgentIncidentTimeline)
    .where(
      and(
        eq(npAgentIncidentTimeline.siteId, siteId),
        eq(npAgentIncidentTimeline.incidentId, incidentId),
      ),
    );
  const next = Number(row?.maximum ?? 0) + 1;
  if (!Number.isSafeInteger(next) || next > 2147483647) fail("INCIDENT_LIMIT_REACHED");
  return next;
}
/** Private persistence seam. Each caller must first validate its exact source-domain candidate. */
export async function npObserveIncidentCandidate(input: {
  candidate: NpIncidentObservationCandidate;
  resolveEvidence(db: Db): boolean | Promise<boolean>;
  now: () => Date;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record" | "recordFailure">;
  transaction?: Db;
}): Promise<NpAgentIncidentObservationResultV1> {
  const { candidate } = input;
  const canonical = candidate.canonicalEvidence;
  const time = input.now();
  if (Date.parse(canonical.window.endedAt) > time.getTime()) fail();
  const run = async (db: Db): Promise<NpAgentIncidentObservationResultV1> => {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-incident:${canonical.siteId}:${canonical.category}:${candidate.fingerprint}`},0))`,
    );
    // The callback only receives a clone; it cannot rewrite the stored facts.
    if ((await input.resolveEvidence(db)) !== true) fail();
    const [existing] = await db
      .select()
      .from(npAgentSignals)
      .where(
        and(
          eq(npAgentSignals.siteId, canonical.siteId),
          eq(npAgentSignals.detectorId, canonical.detectorId),
          eq(npAgentSignals.detectorVersion, canonical.detectorVersion),
          eq(npAgentSignals.evidenceDigest, candidate.evidenceDigest),
          eq(npAgentSignals.fingerprint, candidate.fingerprint),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.fingerprint !== candidate.fingerprint ||
        !existing.incidentId ||
        (await npDigestAgentSignalEvidenceCanonical(signalCanonical(existing))) !==
          candidate.evidenceDigest
      )
        return fail();
      const [incident] = await db
        .select()
        .from(npAgentIncidents)
        .where(
          and(
            eq(npAgentIncidents.siteId, canonical.siteId),
            eq(npAgentIncidents.id, existing.incidentId),
          ),
        )
        .limit(1);
      if (!incident) fail();
      return {
        incidentId: incident.id,
        signalId: existing.id,
        versionNumber: incident.versionNumber,
        disposition: "replayed",
      };
    }
    let [incident] = await db
      .select()
      .from(npAgentIncidents)
      .where(
        and(
          eq(npAgentIncidents.siteId, canonical.siteId),
          eq(npAgentIncidents.category, canonical.category),
          eq(npAgentIncidents.fingerprint, candidate.fingerprint),
          inArray(npAgentIncidents.status, ["open", "investigating", "contained", "monitoring"]),
        ),
      )
      .for("update")
      .limit(1);
    const created = !incident;
    if (!incident) {
      [incident] = await db
        .insert(npAgentIncidents)
        .values({
          siteId: canonical.siteId,
          category: canonical.category,
          status: "open",
          severity: candidate.severity,
          fingerprint: candidate.fingerprint,
          title: candidate.title,
          summary: candidate.summary,
          primarySubject: canonical.subject,
          firstObservedAt: new Date(canonical.window.startedAt),
          lastObservedAt: new Date(canonical.window.endedAt),
          createdAt: time,
          updatedAt: time,
        })
        .returning();
    }
    if (!incident) fail();
    const suppressed = incident.signalCount >= 100;
    const currentSeverityRank = npAgentIncidentSeverityOrderV1.findIndex(
      (value) => value === incident.severity,
    );
    if (currentSeverityRank < 0) fail();
    const escalated =
      !created &&
      !suppressed &&
      candidate.confidenceBasis === "exact-rule" &&
      candidate.scoreBasisPoints === null &&
      npAgentIncidentSeverityOrderV1.indexOf(candidate.severity) > currentSeverityRank;
    const severity = escalated ? candidate.severity : incident.severity;
    const [signal] = await db
      .insert(npAgentSignals)
      .values({
        siteId: canonical.siteId,
        detectorId: canonical.detectorId,
        detectorVersion: canonical.detectorVersion,
        category: canonical.category,
        severity: candidate.severity,
        confidenceBasis: candidate.confidenceBasis,
        scoreBasisPoints: candidate.scoreBasisPoints,
        fingerprint: candidate.fingerprint,
        subject: canonical.subject,
        evidence: canonical.evidence,
        evidenceDigest: candidate.evidenceDigest,
        status: suppressed ? "suppressed" : "attached",
        incidentId: incident.id,
        windowStartedAt: new Date(canonical.window.startedAt),
        windowEndedAt: new Date(canonical.window.endedAt),
        expiresAt: new Date(time.getTime() + 30 * 86400000),
        createdAt: time,
        updatedAt: time,
      })
      .returning();
    if (!signal) fail();
    if (!suppressed)
      await db
        .insert(npAgentIncidentSignals)
        .values({ siteId: canonical.siteId, incidentId: incident.id, signalId: signal.id });
    const retained = suppressed
      ? []
      : await db
          .select({ evidence: npAgentSignals.evidence })
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
              eq(npAgentIncidentSignals.siteId, canonical.siteId),
              eq(npAgentIncidentSignals.incidentId, incident.id),
            ),
          )
          .limit(101);
    if (retained.length > 100) fail("INCIDENT_LIMIT_REACHED");
    const eventCount = suppressed
      ? incident.eventCount
      : new Set(
          retained.flatMap(({ evidence }) =>
            evidence.filter((item) => item.kind === "event").map((item) => item.eventId),
          ),
        ).size;
    const versionNumber = created ? 1 : incident.versionNumber + 1;
    const updated = await db
      .update(npAgentIncidents)
      .set({
        signalCount: incident.signalCount + (suppressed ? 0 : 1),
        eventCount: Math.max(incident.eventCount, eventCount),
        severity,
        versionNumber,
        firstObservedAt: new Date(
          Math.min(incident.firstObservedAt.getTime(), Date.parse(canonical.window.startedAt)),
        ),
        lastObservedAt: new Date(
          Math.max(incident.lastObservedAt.getTime(), Date.parse(canonical.window.endedAt)),
        ),
        updatedAt: time,
      })
      .where(
        and(
          eq(npAgentIncidents.siteId, canonical.siteId),
          eq(npAgentIncidents.id, incident.id),
          eq(npAgentIncidents.versionNumber, incident.versionNumber),
        ),
      )
      .returning({ id: npAgentIncidents.id });
    if (updated.length !== 1) fail("INCIDENT_VERSION_CONFLICT");
    const [notificationEntry] = await db
      .insert(npAgentIncidentTimeline)
      .values({
        siteId: canonical.siteId,
        incidentId: incident.id,
        sequence: await sequence(db, canonical.siteId, incident.id),
        kind: created ? "observed" : "correlated",
        sourceKind: "system",
        sourceFingerprint: candidate.evidenceDigest,
        signalId: signal.id,
        summary: escalated
          ? "Incident severity increased by a verified deterministic source rule."
          : suppressed
            ? "Additional matching signal retained beyond the incident detail limit."
            : candidate.summary,
        details: {
          schemaVersion: escalated
            ? "np.agent-incident-rule-severity-entry.v1"
            : "np.agent-incident-signal-entry.v1",
          transitionVersion: versionNumber,
          severity,
          detectorId: canonical.detectorId,
          detectorVersion: canonical.detectorVersion,
          evidenceDigest: candidate.evidenceDigest,
          disposition: suppressed ? "suppressed" : created ? "created" : "correlated",
          ...(escalated
            ? {
                status: incident.status,
                fromSeverity: incident.severity,
                toSeverity: severity,
                signalId: signal.id,
              }
            : {}),
        },
        createdAt: time,
      })
      .returning({ id: npAgentIncidentTimeline.id });
    if ((created || escalated) && notificationEntry && input.notifications)
      await input.notifications.record({
        db,
        siteId: canonical.siteId,
        incidentId: incident.id,
        transitionVersion: versionNumber,
        transition: created ? "opened" : "escalated",
        timelineId: notificationEntry.id,
      });
    return {
      incidentId: incident.id,
      signalId: signal.id,
      versionNumber,
      disposition: suppressed ? "suppressed" : created ? "created" : "correlated",
    };
  };
  return npWithAgentRuntimeControlTransactionV1(
    canonical.siteId,
    ({ db }) => run(db),
    input.transaction,
  );
}
