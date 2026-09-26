import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAgentModeratorFingerprintV1 } from "./moderator-detector.js";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentContainments,
  npAgentFeedback,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentSignals,
} from "../db/schema/agent.js";
import {
  npRequireAgentModeratorSignalCandidateV1,
  type NpAgentModeratorSignalCandidateV1,
} from "../agent-contract/moderator-contract.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../agent-contract/canonical-events.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentIncidentFeedbackInputV1,
  type NpAgentIncidentFeedbackInputV1,
} from "../agent-contract/incident-feedback-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentSignalEvidenceCanonicalV1,
} from "../agent-contract/types.js";
import {
  createAgentAdminAdmissionV1,
  npResolveAgentStaffSessionAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminExecutionResultV1,
} from "./admin-admission.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

type Db = ReturnType<typeof getDb>;
type Incident = typeof npAgentIncidents.$inferSelect;
type Signal = typeof npAgentSignals.$inferSelect;
export interface NpAgentIncidentObservationResultV1 {
  incidentId: string;
  signalId: string;
  versionNumber: number;
  disposition: "created" | "correlated" | "replayed" | "suppressed";
}
export interface NpAgentIncidentWriteServiceOptionsV1 {
  /** Required source-domain owner. It must validate every subject, immutable source
   * digest and current fact under this transaction; a missing owner never accepts. */
  resolveEvidence(input: {
    db: Db;
    candidate: NpAgentModeratorSignalCandidateV1;
  }): boolean | Promise<boolean>;
  /** Current per-target staff ACL. Absence keeps human feedback disabled. */
  canRecordFeedback?(input: {
    db: Db;
    actor: NpAgentAdminActorV1;
    incident: Incident;
    signal: NpAgentSignalEvidenceCanonicalV1;
  }): boolean | Promise<boolean>;
  now?: () => Date;
}
export interface NpAgentIncidentContainmentEventV1 {
  db: Db;
  siteId: string;
  incidentId: string;
  actionId: string;
  containmentId: string;
  phase: "quarantined" | "restored";
  auditEventId: string;
}
export interface NpAgentIncidentWriteServiceV1 {
  observe(
    candidate: NpAgentModeratorSignalCandidateV1,
    options?: { transaction?: Db },
  ): Promise<NpAgentIncidentObservationResultV1>;
  feedback(input: {
    siteId: string;
    incidentId: string;
    actor: NpAgentAdminActorV1;
    command: NpAgentIncidentFeedbackInputV1;
  }): Promise<NpAgentAdminExecutionResultV1<NpAgentJsonObject>>;
  appendContainmentEvent(input: NpAgentIncidentContainmentEventV1): Promise<number>;
}
function fail(code = "INCIDENT_EVIDENCE_INVALID", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Incident operation is unavailable.");
}
function digest(value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
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
async function retryFeedbackTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const cause = error as { code?: string; cause?: { code?: string } };
      if (attempt === 2 || !["40001", "23505"].includes(cause.cause?.code ?? cause.code ?? ""))
        throw error;
    }
  }
}
/** Host-installed deterministic ingestion; no worker, model, authority or effect is installed. */
export function createAgentIncidentWriteServiceV1(
  options: NpAgentIncidentWriteServiceOptionsV1,
): NpAgentIncidentWriteServiceV1 {
  if (typeof options.resolveEvidence !== "function")
    throw new Error("Incident evidence owner is required.");
  const now = options.now ?? (() => new Date());
  const admission = createAgentAdminAdmissionV1({ now });
  return {
    async observe(value, supplied = {}) {
      npAssertAgentPreviewEffectsAllowed();
      const candidate = npRequireAgentModeratorSignalCandidateV1(value);
      const canonical = candidate.canonicalEvidence;
      if (
        (await npDigestAgentSignalEvidenceCanonical(canonical)) !== candidate.evidenceDigest ||
        npAgentModeratorFingerprintV1({
          siteId: canonical.siteId,
          windowStartedAt: canonical.window.startedAt,
          domainHash: candidate.domainHash,
        }) !== candidate.fingerprint
      )
        fail();
      const time = now();
      if (Date.parse(canonical.window.endedAt) > time.getTime()) fail();
      const run = async (db: Db): Promise<NpAgentIncidentObservationResultV1> => {
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-incident:${canonical.siteId}:${canonical.category}:${candidate.fingerprint}`},0))`,
        );
        // The callback only receives a clone; it cannot rewrite the stored facts.
        if ((await options.resolveEvidence({ db, candidate: structuredClone(candidate) })) !== true)
          fail();
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
            fail();
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
              inArray(npAgentIncidents.status, [
                "open",
                "investigating",
                "contained",
                "monitoring",
              ]),
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
        await db.insert(npAgentIncidentTimeline).values({
          siteId: canonical.siteId,
          incidentId: incident.id,
          sequence: await sequence(db, canonical.siteId, incident.id),
          kind: created ? "observed" : "correlated",
          sourceKind: "system",
          sourceFingerprint: candidate.evidenceDigest,
          signalId: signal.id,
          summary: suppressed
            ? "Additional matching signal retained beyond the incident detail limit."
            : candidate.summary,
          details: {
            schemaVersion: "np.agent-incident-signal-entry.v1",
            detectorId: canonical.detectorId,
            detectorVersion: canonical.detectorVersion,
            evidenceDigest: candidate.evidenceDigest,
            disposition: suppressed ? "suppressed" : created ? "created" : "correlated",
          },
          createdAt: time,
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
        supplied.transaction,
      );
    },
    async feedback(input) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodySiteId(input.siteId, "incident.siteId");
      canonicalBodyUuid(input.incidentId, "incident.id");
      const canRecordFeedback = options.canRecordFeedback?.bind(options);
      if (!canRecordFeedback) fail("INCIDENT_FEEDBACK_DISABLED", 403);
      return retryFeedbackTransaction(() =>
        getDb().transaction(
          (tx) =>
            npWithAgentRuntimeControlTransactionV1(
              input.siteId,
              async ({ db }) => {
                const request = npRequireAgentIncidentFeedbackInputV1(input.command);
                const currentAuthority = await npResolveAgentStaffSessionAuthorizationV1(
                  db,
                  input.siteId,
                  input.actor,
                  now(),
                );
                if (!currentAuthority.authority.capabilities.includes("community.moderate"))
                  fail("SITE_ACCESS_DENIED", 403);
                // Idempotent replay still requires the current target owner, in addition to
                // admission's current staff-session and site-capability check.
                const [currentIncident] = await db
                  .select()
                  .from(npAgentIncidents)
                  .where(
                    and(
                      eq(npAgentIncidents.siteId, input.siteId),
                      eq(npAgentIncidents.id, input.incidentId),
                    ),
                  )
                  .limit(1);
                const [currentSignal] = await db
                  .select()
                  .from(npAgentSignals)
                  .where(
                    and(
                      eq(npAgentSignals.siteId, input.siteId),
                      eq(npAgentSignals.id, request.signalId),
                      eq(npAgentSignals.incidentId, input.incidentId),
                    ),
                  )
                  .limit(1);
                if (
                  !currentIncident ||
                  currentIncident.category !== "spam" ||
                  !currentSignal ||
                  currentSignal.category !== "spam"
                )
                  fail("INCIDENT_NOT_FOUND", 404);
                const currentCanonical = signalCanonical(currentSignal);
                if (
                  (await npDigestAgentSignalEvidenceCanonical(currentCanonical)) !==
                    currentSignal.evidenceDigest ||
                  (await canRecordFeedback({
                    db: db,
                    actor: structuredClone(input.actor),
                    incident: structuredClone(currentIncident),
                    signal: currentCanonical,
                  })) !== true
                )
                  fail("INCIDENT_FEEDBACK_FORBIDDEN", 403);
                return admission({
                  db,
                  siteId: input.siteId,
                  actor: input.actor,
                  operationId: "agents.incidents.feedback",
                  targetId: input.incidentId,
                  command: input.command,
                  mutate: async ({ db, now: time, invocationId, command }) => {
                    const [incident] = await db
                      .select()
                      .from(npAgentIncidents)
                      .where(
                        and(
                          eq(npAgentIncidents.siteId, input.siteId),
                          eq(npAgentIncidents.id, input.incidentId),
                        ),
                      )
                      .for("update")
                      .limit(1);
                    if (!incident || incident.category !== "spam") fail("INCIDENT_NOT_FOUND", 404);
                    if (incident.versionNumber !== command.expectedVersion)
                      fail("INCIDENT_VERSION_CONFLICT");
                    const [signal] = await db
                      .select()
                      .from(npAgentSignals)
                      .where(
                        and(
                          eq(npAgentSignals.siteId, input.siteId),
                          eq(npAgentSignals.id, command.signalId),
                          eq(npAgentSignals.incidentId, incident.id),
                        ),
                      )
                      .limit(1);
                    if (!signal || signal.category !== "spam") fail();
                    const canonical = signalCanonical(signal);
                    if (
                      (await npDigestAgentSignalEvidenceCanonical(canonical)) !==
                        signal.evidenceDigest ||
                      (await canRecordFeedback({
                        db,
                        actor: structuredClone(input.actor),
                        incident: structuredClone(incident),
                        signal: canonical,
                      })) !== true
                    )
                      fail("INCIDENT_FEEDBACK_FORBIDDEN", 403);
                    const currentAuthority = await npResolveAgentStaffSessionAuthorizationV1(
                      db,
                      input.siteId,
                      input.actor,
                      now(),
                    );
                    if (!currentAuthority.authority.capabilities.includes("community.moderate"))
                      fail("INCIDENT_FEEDBACK_FORBIDDEN", 403);
                    const targetFingerprint = digest({
                      schemaVersion: "np.agent-incident-feedback-target.v1",
                      siteId: input.siteId,
                      incidentId: incident.id,
                      signalId: signal.id,
                      evidenceDigest: signal.evidenceDigest,
                    });
                    if (command.supersedesId === null) {
                      const [prior] = await db
                        .select({ id: npAgentFeedback.id })
                        .from(npAgentFeedback)
                        .where(
                          and(
                            eq(npAgentFeedback.siteId, input.siteId),
                            eq(npAgentFeedback.targetKind, "incident"),
                            eq(npAgentFeedback.targetFingerprint, targetFingerprint),
                          ),
                        )
                        .limit(1);
                      if (prior) fail("INCIDENT_FEEDBACK_SUPERSESSION_REQUIRED");
                    } else {
                      const [prior] = await db
                        .select()
                        .from(npAgentFeedback)
                        .where(
                          and(
                            eq(npAgentFeedback.siteId, input.siteId),
                            eq(npAgentFeedback.id, command.supersedesId),
                            eq(npAgentFeedback.targetKind, "incident"),
                            eq(npAgentFeedback.targetFingerprint, targetFingerprint),
                          ),
                        )
                        .limit(1);
                      const [successor] = await db
                        .select({ id: npAgentFeedback.id })
                        .from(npAgentFeedback)
                        .where(
                          and(
                            eq(npAgentFeedback.siteId, input.siteId),
                            eq(npAgentFeedback.supersedesId, command.supersedesId),
                          ),
                        )
                        .limit(1);
                      if (!prior || successor) fail("INCIDENT_FEEDBACK_VERSION_CONFLICT");
                    }
                    const [invocation] = await db
                      .select({
                        actorFingerprint: npAgentInvocations.actorFingerprint,
                        auditEventId: npAgentInvocations.auditEventId,
                      })
                      .from(npAgentInvocations)
                      .where(
                        and(
                          eq(npAgentInvocations.siteId, input.siteId),
                          eq(npAgentInvocations.id, invocationId),
                        ),
                      )
                      .limit(1);
                    if (!invocation?.auditEventId) fail();
                    const [feedback] = await db
                      .insert(npAgentFeedback)
                      .values({
                        siteId: input.siteId,
                        targetKind: "incident",
                        targetId: incident.id,
                        targetFingerprint,
                        label: command.label,
                        detectorId: signal.detectorId,
                        detectorVersion: signal.detectorVersion,
                        policyHashes: [],
                        recordedByUserId: input.actor.user.id,
                        actorFingerprint: invocation.actorFingerprint,
                        supersedesId: command.supersedesId,
                        createdAt: time,
                      })
                      .returning({ id: npAgentFeedback.id });
                    if (!feedback) fail();
                    const versionNumber = incident.versionNumber + 1;
                    const updated = await db
                      .update(npAgentIncidents)
                      .set({ versionNumber, updatedAt: time })
                      .where(
                        and(
                          eq(npAgentIncidents.siteId, input.siteId),
                          eq(npAgentIncidents.id, incident.id),
                          eq(npAgentIncidents.versionNumber, command.expectedVersion),
                        ),
                      )
                      .returning({ id: npAgentIncidents.id });
                    if (updated.length !== 1) fail("INCIDENT_VERSION_CONFLICT");
                    await db.insert(npAgentIncidentTimeline).values({
                      siteId: input.siteId,
                      incidentId: incident.id,
                      sequence: await sequence(db, input.siteId, incident.id),
                      kind: "human_note",
                      sourceKind: "staff",
                      sourceId: input.actor.user.id,
                      sourceFingerprint: invocation.actorFingerprint,
                      signalId: signal.id,
                      auditEventId: invocation.auditEventId,
                      summary:
                        command.label === "false-positive"
                          ? "Moderator feedback: false positive."
                          : "Moderator feedback: confirmed spam.",
                      details: {
                        schemaVersion: "np.agent-incident-feedback-entry.v1",
                        feedbackId: feedback.id,
                        label: command.label,
                        signalId: signal.id,
                        detectorId: signal.detectorId,
                        detectorVersion: signal.detectorVersion,
                        supersedesId: command.supersedesId,
                      },
                      createdAt: time,
                    });
                    return {
                      resourceId: incident.id,
                      output: {
                        schemaVersion: "np.agent-incident-feedback-result.v1",
                        incidentId: incident.id,
                        feedbackId: feedback.id,
                        versionNumber,
                      },
                    };
                  },
                });
              },
              tx as Db,
            ),
          { isolationLevel: "serializable" },
        ),
      );
    },
    async appendContainmentEvent(input) {
      npAssertAgentPreviewEffectsAllowed();
      const { db, siteId, incidentId, actionId, containmentId, phase } = input;
      await npWithAgentRuntimeControlTransactionV1(siteId, async () => {}, db);
      canonicalBodySiteId(siteId, "incident.siteId");
      for (const id of [incidentId, actionId, containmentId, input.auditEventId])
        canonicalBodyUuid(id, "incident.reference");
      if (phase !== "quarantined" && phase !== "restored") fail();
      const [incident] = await db
        .select()
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, incidentId)))
        .for("update")
        .limit(1);
      const [action] = await db
        .select()
        .from(npAgentActions)
        .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, actionId)))
        .limit(1);
      const [containment] = await db
        .select()
        .from(npAgentContainments)
        .where(
          and(
            eq(npAgentContainments.siteId, siteId),
            eq(npAgentContainments.id, containmentId),
            eq(npAgentContainments.incidentId, incidentId),
          ),
        )
        .limit(1);
      if (
        !incident ||
        !action ||
        !containment ||
        action.containmentId !== containmentId ||
        action.verificationState !== "passed" ||
        !action.targetVersionDigest ||
        (phase === "quarantined"
          ? action.capabilityId !== "moderation.quarantine" || action.state !== "succeeded"
          : action.capabilityId !== "moderation.restore" || action.state !== "compensated") ||
        (phase === "quarantined"
          ? containment.sourceActionId !== actionId || containment.state !== "active"
          : containment.restoreActionId !== actionId || containment.state !== "restored")
      )
        fail();
      if (!action.executionInvocationId) fail();
      const [execution] = await db
        .select({ auditEventId: npAgentInvocations.auditEventId })
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, siteId),
            eq(npAgentInvocations.id, action.executionInvocationId),
          ),
        )
        .limit(1);
      if (execution?.auditEventId !== input.auditEventId) fail();
      const [existing] = await db
        .select({ id: npAgentIncidentTimeline.id })
        .from(npAgentIncidentTimeline)
        .where(
          and(
            eq(npAgentIncidentTimeline.siteId, siteId),
            eq(npAgentIncidentTimeline.incidentId, incidentId),
            eq(npAgentIncidentTimeline.actionId, actionId),
            eq(npAgentIncidentTimeline.kind, "action"),
          ),
        )
        .limit(1);
      if (existing) return incident.versionNumber;
      const time = now(),
        versionNumber = incident.versionNumber + 1;
      // One bounded target action does not assert the entire campaign is contained.
      await db
        .update(npAgentIncidents)
        .set({ versionNumber, updatedAt: time })
        .where(
          and(
            eq(npAgentIncidents.siteId, siteId),
            eq(npAgentIncidents.id, incidentId),
            eq(npAgentIncidents.versionNumber, incident.versionNumber),
          ),
        );
      await db.insert(npAgentIncidentTimeline).values({
        siteId,
        incidentId,
        sequence: await sequence(db, siteId, incidentId),
        kind: "action",
        sourceKind: "system",
        sourceFingerprint: action.inputHash,
        actionId,
        auditEventId: input.auditEventId,
        summary:
          phase === "quarantined"
            ? "Approved content quarantine installed."
            : "Approved content quarantine restored.",
        details: {
          schemaVersion: "np.agent-incident-containment-entry.v1",
          containmentId,
          phase,
          targetVersionDigest: action.targetVersionDigest,
        },
        createdAt: time,
      });
      return versionNumber;
    },
  };
}
