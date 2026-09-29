import {
  npAgentIncidentSeverityOrderV1,
  npRequireAgentIncidentSeverityInputV1,
  type NpAgentIncidentSeverityInputV1,
} from "../agent-contract/incident-severity-contract.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentIncidents,
  npAgentContainments,
  npAgentActions,
  npAgentIncidentTimeline,
  npAgentInvocations,
} from "../db/schema/agent.js";
import {
  npRequireAgentIncidentTransitionInputV1,
  type NpAgentIncidentTransitionInputV1,
  type NpAgentIncidentWorkflowV1,
} from "../agent-contract/incident-workflow-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { createAgentAdminAdmissionV1, NpAgentGatewayError } from "./admin-admission.js";
import {
  type NpAgentIncidentStaffContextV1,
  type NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
type Db = ReturnType<typeof getDb>;
type Staff = Omit<NpAgentIncidentStaffContextV1, "transaction">;
type Containment = typeof npAgentContainments.$inferSelect;
type Action = typeof npAgentActions.$inferSelect;
export interface NpAgentIncidentWorkflowServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  /** Domain owner must authorize the actual retained target under this transaction. */
  canReviewContainment(
    input: Staff & { db: Db; containment: Containment },
  ): boolean | Promise<boolean>;
  /** Unresolved actions may precede containment creation. Missing owner fails closed. */
  canReviewAction?(input: Staff & { db: Db; action: Action }): boolean | Promise<boolean>;
  notifications?: Pick<NpAgentIncidentNotificationsServiceV1, "record">;
  now?: () => Date;
}
export interface NpAgentIncidentWorkflowServiceV1 {
  get(input: Staff & { incidentId: string }): Promise<NpAgentIncidentWorkflowV1>;
  escalate(
    input: Staff & { incidentId: string; command: NpAgentIncidentSeverityInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  transition(
    input: Staff & { incidentId: string; command: NpAgentIncidentTransitionInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
}
function fail(code = "INCIDENT_WORKFLOW_UNAVAILABLE", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Incident workflow is unavailable.");
}
const terminal = (status: string) => ["resolved", "dismissed"].includes(status);
/** Explicit host service, never installed by the runtime. Uses the same site lock as moderation effects. */
export function createAgentIncidentWorkflowServiceV1(
  options: NpAgentIncidentWorkflowServiceOptionsV1,
): NpAgentIncidentWorkflowServiceV1 {
  if (typeof options.canReviewContainment !== "function")
    throw new Error("Incident containment visibility owner is required.");
  const now = options.now ?? (() => new Date());
  const admission = createAgentAdminAdmissionV1({ now });
  async function snapshot(
    db: Db,
    input: Staff & { incidentId: string },
  ): Promise<NpAgentIncidentWorkflowV1> {
    const context = { siteId: input.siteId, actor: input.actor, transaction: db };
    const { incident } = await options.reads.get({ incidentId: input.incidentId }, context);
    const rows = await db
      .select()
      .from(npAgentContainments)
      .where(
        and(
          eq(npAgentContainments.siteId, input.siteId),
          eq(npAgentContainments.incidentId, input.incidentId),
        ),
      )
      .orderBy(asc(npAgentContainments.id))
      .limit(101);
    if (rows.length > 100) fail("INCIDENT_WORKFLOW_LIMIT_REACHED");
    for (const containment of rows)
      if (
        (await options.canReviewContainment({
          siteId: input.siteId,
          actor: structuredClone(input.actor),
          db,
          containment: structuredClone(containment),
        })) !== true
      )
        fail("INCIDENT_WORKFLOW_FORBIDDEN", 403);
    const actions = await db
      .select()
      .from(npAgentActions)
      .where(
        and(
          eq(npAgentActions.siteId, input.siteId),
          inArray(npAgentActions.capabilityId, ["moderation.quarantine", "moderation.restore"]),
          inArray(npAgentActions.state, ["proposed", "approval_pending", "approved", "executing"]),
          or(
            sql`${npAgentActions.inputCanonical}->>'incidentId'=${input.incidentId}`,
            rows.length
              ? inArray(
                  npAgentActions.containmentId,
                  rows.map((r) => r.id),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(asc(npAgentActions.id))
      .limit(101);
    if (actions.length > 100) fail("INCIDENT_WORKFLOW_LIMIT_REACHED");
    for (const action of actions)
      if (
        (await options.canReviewAction?.({
          siteId: input.siteId,
          actor: structuredClone(input.actor),
          db,
          action: structuredClone(action),
        })) !== true
      )
        fail("INCIDENT_WORKFLOW_FORBIDDEN", 403);
    const reviewHash = `cj1:sha256:${createHash("sha256")
      .update(
        serializeAgentCanonicalJson({
          schemaVersion: "np.agent-incident-containment-review.v1",
          siteId: input.siteId,
          incidentId: incident.id,
          versionNumber: incident.versionNumber,
          containments: rows.map((r) => ({
            id: r.id,
            state: r.state,
            sourceActionId: r.sourceActionId,
            restoreActionId: r.restoreActionId,
            targetVersionDigest: r.targetVersionDigest,
            updatedAt: r.updatedAt.toISOString(),
            expiresAt: r.expiresAt?.toISOString() ?? null,
          })),
          actions: actions.map((a) => ({
            id: a.id,
            state: a.state,
            inputHash: a.inputHash,
            approvalId: a.approvalId,
            verificationState: a.verificationState,
            executionInvocationId: a.executionInvocationId,
          })),
        }),
      )
      .digest("base64url")}`;
    const active = rows.filter((r) => r.state === "active").length,
      restored = rows.filter((r) => r.state === "restored").length;
    const availableTransitions: NpAgentIncidentWorkflowV1["availableTransitions"] = terminal(
      incident.status,
    )
      ? []
      : incident.status === "open"
        ? ["investigating"]
        : [];
    if (!terminal(incident.status) && actions.length === 0)
      availableTransitions.push("resolved", "dismissed");
    // Revalidate after the domain owner callbacks; do not project a mixed generation.
    const current = await options.reads.get({ incidentId: input.incidentId }, context);
    if (serializeAgentCanonicalJson(current.incident) !== serializeAgentCanonicalJson(incident))
      fail("INCIDENT_VERSION_CONFLICT");
    return {
      availableTransitions,
      availableSeverities: terminal(incident.status)
        ? []
        : npAgentIncidentSeverityOrderV1.filter(
            (severity): severity is "low" | "medium" | "high" | "critical" =>
              severity !== "info" &&
              npAgentIncidentSeverityOrderV1.indexOf(severity) >
                npAgentIncidentSeverityOrderV1.indexOf(incident.severity),
          ),
      containment: {
        reviewHash,
        total: rows.length,
        active,
        restored,
        unresolved: rows.length - active - restored,
        pendingActions: actions.length,
      },
    };
  }
  async function transaction<T>(siteId: string, fn: (db: Db) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++)
      try {
        return await getDb().transaction(
          (tx) => npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) => fn(db), tx as Db),
          { isolationLevel: "serializable" },
        );
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string } };
        if (attempt >= 2 || !["40001", "23505"].includes(e.cause?.code ?? e.code ?? ""))
          throw error;
      }
  }
  return {
    get: (input) => transaction(input.siteId, (db) => snapshot(db, input)),
    async escalate(input) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodySiteId(input.siteId, "incident.siteId");
      canonicalBodyUuid(input.incidentId, "incident.id");
      const command = npRequireAgentIncidentSeverityInputV1(input.command);
      return transaction(input.siteId, async (db) => {
        await snapshot(db, input);
        const result = await admission({
          db,
          siteId: input.siteId,
          actor: input.actor,
          operationId: "agents.incidents.escalate",
          targetId: input.incidentId,
          command,
          mutate: async ({ db, command, invocationId, now: time }) => {
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
            if (!incident) fail("INCIDENT_NOT_FOUND", 404);
            if (incident.versionNumber !== command.expectedVersion)
              fail("INCIDENT_VERSION_CONFLICT");
            const workflow = await snapshot(db, input);
            if (!workflow.availableSeverities?.includes(command.severity))
              fail("INCIDENT_SEVERITY_INVALID");
            const [invocation] = await db
              .select()
              .from(npAgentInvocations)
              .where(
                and(
                  eq(npAgentInvocations.siteId, input.siteId),
                  eq(npAgentInvocations.id, invocationId),
                ),
              )
              .limit(1);
            if (!invocation?.auditEventId) fail();
            const versionNumber = incident.versionNumber + 1;
            const changed = await db
              .update(npAgentIncidents)
              .set({ severity: command.severity, versionNumber, updatedAt: time })
              .where(
                and(
                  eq(npAgentIncidents.siteId, input.siteId),
                  eq(npAgentIncidents.id, input.incidentId),
                  eq(npAgentIncidents.versionNumber, command.expectedVersion),
                ),
              )
              .returning({ id: npAgentIncidents.id });
            if (changed.length !== 1) fail("INCIDENT_VERSION_CONFLICT");
            const [seq] = await db
              .select({ n: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)+1` })
              .from(npAgentIncidentTimeline)
              .where(
                and(
                  eq(npAgentIncidentTimeline.siteId, input.siteId),
                  eq(npAgentIncidentTimeline.incidentId, input.incidentId),
                ),
              );
            const sequence = Number(seq?.n);
            if (!Number.isSafeInteger(sequence) || sequence > 2147483647)
              fail("INCIDENT_WORKFLOW_LIMIT_REACHED");
            const [entry] = await db
              .insert(npAgentIncidentTimeline)
              .values({
                siteId: input.siteId,
                incidentId: incident.id,
                sequence,
                kind: "human_note",
                sourceKind: "staff",
                sourceId: input.actor.user.id,
                sourceFingerprint: invocation.actorFingerprint,
                auditEventId: invocation.auditEventId,
                summary: "Staff raised Incident severity.",
                details: {
                  schemaVersion: "np.agent-incident-severity-entry.v1",
                  transitionVersion: versionNumber,
                  severity: command.severity,
                  status: incident.status,
                  fromSeverity: incident.severity,
                  toSeverity: command.severity,
                  note: command.note,
                  invocationId,
                },
                createdAt: time,
              })
              .returning({ id: npAgentIncidentTimeline.id });
            if (!entry) fail();
            if (options.notifications)
              await options.notifications.record({
                db,
                siteId: input.siteId,
                incidentId: incident.id,
                transitionVersion: versionNumber,
                transition: "escalated",
                timelineId: entry.id,
              });
            return {
              resourceId: incident.id,
              output: {
                schemaVersion: "np.agent-incident-severity-result.v1",
                incidentId: incident.id,
                severity: command.severity,
                versionNumber,
              },
            };
          },
        });
        return { resourceId: result.resourceId, replayed: result.replayed };
      });
    },
    async transition(input) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodySiteId(input.siteId, "incident.siteId");
      canonicalBodyUuid(input.incidentId, "incident.id");
      const command = npRequireAgentIncidentTransitionInputV1(input.command);
      return transaction(input.siteId, async (db) => {
        // Current staff, every signal target and containment owner apply even to exact replays.
        await snapshot(db, input);
        const result = await admission({
          db,
          siteId: input.siteId,
          actor: input.actor,
          operationId: "agents.incidents.transition",
          targetId: input.incidentId,
          command,
          mutate: async ({ db, command, now: time, invocationId }) => {
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
            if (!incident) fail("INCIDENT_NOT_FOUND", 404);
            if (incident.versionNumber !== command.expectedVersion)
              fail("INCIDENT_VERSION_CONFLICT");
            const workflow = await snapshot(db, input);
            if (!workflow.availableTransitions.includes(command.transition))
              fail("INCIDENT_TRANSITION_INVALID");
            if (command.transition !== "investigating") {
              if (command.containmentReviewHash !== workflow.containment.reviewHash)
                fail("INCIDENT_CONTAINMENT_REVIEW_STALE");
              if (
                command.containmentDisposition !==
                (workflow.containment.active > 0 ? "retain" : "acknowledge")
              )
                fail("INCIDENT_CONTAINMENT_REVIEW_REQUIRED");
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
            const versionNumber = incident.versionNumber + 1;
            const changed = await db
              .update(npAgentIncidents)
              .set({
                status: command.transition,
                resolutionCode: command.resolutionCode,
                resolvedAt: command.transition === "investigating" ? null : time,
                versionNumber,
                updatedAt: time,
              })
              .where(
                and(
                  eq(npAgentIncidents.siteId, input.siteId),
                  eq(npAgentIncidents.id, input.incidentId),
                  eq(npAgentIncidents.versionNumber, command.expectedVersion),
                ),
              )
              .returning({ id: npAgentIncidents.id });
            if (changed.length !== 1) fail("INCIDENT_VERSION_CONFLICT");
            const [seq] = await db
              .select({ n: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)+1` })
              .from(npAgentIncidentTimeline)
              .where(
                and(
                  eq(npAgentIncidentTimeline.siteId, input.siteId),
                  eq(npAgentIncidentTimeline.incidentId, input.incidentId),
                ),
              );
            const sequence = Number(seq?.n);
            if (!Number.isSafeInteger(sequence) || sequence > 2147483647)
              fail("INCIDENT_WORKFLOW_LIMIT_REACHED");
            const [notificationEntry] = await db
              .insert(npAgentIncidentTimeline)
              .values({
                siteId: input.siteId,
                incidentId: input.incidentId,
                sequence,
                kind: "state_transition",
                sourceKind: "staff",
                sourceId: input.actor.user.id,
                sourceFingerprint: invocation.actorFingerprint,
                auditEventId: invocation.auditEventId,
                summary: `Incident ${command.transition}.`,
                details: {
                  schemaVersion: "np.agent-incident-transition-entry.v1",
                  transitionVersion: versionNumber,
                  severity: incident.severity,
                  fromStatus: incident.status,
                  toStatus: command.transition,
                  resolutionCode: command.resolutionCode,
                  note: command.note,
                  containmentDisposition: command.containmentDisposition,
                  containmentReviewHash: command.containmentReviewHash,
                },
                createdAt: time,
              })
              .returning({ id: npAgentIncidentTimeline.id });
            if (notificationEntry && options.notifications)
              await options.notifications.record({
                db,
                siteId: input.siteId,
                incidentId: incident.id,
                transitionVersion: versionNumber,
                transition: command.transition,
                timelineId: notificationEntry.id,
              });
            return {
              resourceId: incident.id,
              output: {
                schemaVersion: "np.agent-incident-transition-result.v1",
                incidentId: incident.id,
                status: command.transition,
                versionNumber,
              },
            };
          },
        });
        return { resourceId: result.resourceId, replayed: result.replayed };
      });
    },
  };
}
