import {
  npAgentGuardianHttpDetectorIdsV1,
  type NpAgentGuardianHttpEvidenceV1,
} from "../agent-contract/guardian-http-contract.js";
import type { NpAgentGuardianHttpObservationServiceV1 } from "./guardian-http-observation.js";
import {
  npAgentGuardianRuntimeDetectorIdsV1,
  type NpAgentGuardianRuntimeEvidenceV1,
} from "../agent-contract/guardian-runtime-contract.js";
import type { NpAgentGuardianRuntimeObservationServiceV1 } from "./guardian-runtime-observation.js";
import type { NpAgentNotificationDeliveryServiceV1 } from "./notification-delivery-service.js";
import { npReadAgentGuardianIncidentEvidenceV1 } from "./guardian-observation-service.js";
import type { NpAgentGuardianSecurityObservationServiceV1 } from "./guardian-security-observation.js";
import type { NpAgentGuardianContentObservationServiceV1 } from "./guardian-content-observation.js";
import type { NpAgentGuardianExternalObservationServiceV1 } from "./guardian-external-observation.js";
import { npRequireAgentGuardianIncidentAssessmentEntryV1 } from "./guardian-incident-assessment-service.js";
import type { NpAgentGuardianAssessmentV1 } from "../agent-contract/guardian-assessment-contract.js";
import {
  npAgentGuardianContentDetectorIdsV1,
  type NpAgentGuardianContentEvidenceV1,
} from "../agent-contract/guardian-content-contract.js";
import {
  NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1,
  type NpAgentGuardianExternalEvidenceV1,
} from "../agent-contract/guardian-external-contract.js";
import {
  npAgentGuardianSecurityDetectorIdsV1,
  type NpAgentGuardianSecurityEvidenceV1,
} from "../agent-contract/guardian-security-contract.js";
import type { NpAgentGuardianEvidenceV1 } from "../agent-contract/guardian-contract.js";
import type { NpAgentGuardianSessionEvidenceV1 } from "../agent-contract/guardian-session-contract.js";
import { npReadAgentGuardianSessionSafeEvidenceV1 } from "./guardian-session-evidence.js";
import type { NpAgentIncidentMemberReportEvidenceServiceV1 } from "./incident-member-report-evidence-service.js";
import { NP_INCIDENT_NOTIFICATION_RECOVERY_SCHEMA } from "./incident-notification-recovery.js";
import {
  npRequireIncidentSeverityEvidence,
  npRequireIncidentRuleSeverityEvidence,
} from "./incident-severity-evidence.js";
import type { NpAgentIncidentRuleSeverityChangeV1 } from "../agent-contract/incident-rule-severity-contract.js";
import {
  npRequireAgentIncidentAssessmentEntryV1,
  npRequireAgentIncidentSegmentedAssessmentEntryV2,
} from "./incident-assessment-service.js";
import type { NpAgentModeratorSegmentedAssessmentV2 } from "../agent-contract/moderator-segmented-assessment-contract.js";
import type { NpAgentModeratorAssessmentV1 } from "../agent-contract/moderator-assessment-contract.js";
import {
  type NpAgentIncidentSeverityChangeV1,
  type NpAgentIncidentSeverityInputV1,
} from "../agent-contract/incident-severity-contract.js";
import { npRequireIncidentContainmentFailure } from "./incident-containment-failure.js";
import type { NpAgentIncidentNotificationsServiceV1 } from "./incident-notifications-service.js";
import type { NpAgentIncidentAssignmentServiceV1 } from "./incident-assignment-service.js";
import { npRequireAgentIncidentAssignmentEntryV1 } from "../agent-contract/incident-assignment-contract.js";
import type { NpAgentIncidentEvidenceServiceV1 } from "./incident-evidence-service.js";
import type { NpAgentIncidentResponseServiceV1 } from "./incident-response-service.js";
import {
  npRequireAgentIncidentDecisionV1,
  type NpAgentIncidentTransitionInputV1,
} from "../agent-contract/incident-workflow-contract.js";
import type { NpAgentIncidentWorkflowServiceV1 } from "./incident-workflow-service.js";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, lte, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentSignals,
  npAgentIncidentTimeline,
  npAgentFeedback,
  npAgentIncidents,
  npAgentActions,
  npAgentContainments,
  npAgentIncidentSignals,
} from "../db/schema/agent.js";
import {
  npRequireAgentIncidentStudioListQueryV1,
  type NpAgentIncidentStudioListQueryV1,
} from "../agent-contract/incident-studio-query-contract.js";
import {
  npRequireAgentIncidentStudioDetailV1,
  npRequireAgentIncidentStudioListOutputV1,
  type NpAgentIncidentStudioDetailV1,
  type NpAgentIncidentStudioListOutputV1,
} from "../agent-contract/incident-studio-contract.js";
import { type NpAgentIncidentListOutputV1 } from "../agent-contract/incident-contract.js";
import { type NpAgentIncidentFeedbackInputV1 } from "../agent-contract/incident-feedback-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
} from "./admin-admission.js";
import {
  type NpAgentIncidentStaffContextV1,
  type NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import { type NpAgentIncidentWriteServiceV1 } from "./incident-write-service.js";
import { type NpAgentActivityServiceV1 } from "./activity-service.js";
import { type NpAgentApprovalServiceV1 } from "./approval-service.js";
import { createAgentCursorCodecV1 } from "./cursor.js";

type Staff = Omit<NpAgentIncidentStaffContextV1, "transaction">;
export interface NpAgentIncidentStudioServiceV1 {
  notifications: NpAgentIncidentNotificationsServiceV1["list"];
  deliveries?: NpAgentNotificationDeliveryServiceV1["list"];
  assignment: NpAgentIncidentAssignmentServiceV1["get"];
  assign: NpAgentIncidentAssignmentServiceV1["assign"];
  evidence: NpAgentIncidentEvidenceServiceV1["get"];
  memberReportEvidence?: NpAgentIncidentMemberReportEvidenceServiceV1["get"];
  responsePlan: NpAgentIncidentResponseServiceV1["responsePlan"];
  responseExecute: NpAgentIncidentResponseServiceV1["responseExecute"];
  restore: NpAgentIncidentResponseServiceV1["restore"];
  list(
    input: Staff & { query: NpAgentIncidentStudioListQueryV1 },
  ): Promise<NpAgentIncidentStudioListOutputV1>;
  get(
    input: Staff & { incidentId: string; cursor?: string | null; responseCursor?: string | null },
  ): Promise<NpAgentIncidentStudioDetailV1>;
  escalate(
    input: Staff & { incidentId: string; command: NpAgentIncidentSeverityInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  transition(
    input: Staff & { incidentId: string; command: NpAgentIncidentTransitionInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  feedback(
    input: Staff & { incidentId: string; command: NpAgentIncidentFeedbackInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
}
export interface NpAgentIncidentStudioServiceOptionsV1 {
  guardianSecurityObservations?: Pick<NpAgentGuardianSecurityObservationServiceV1, "evidence">;
  guardianContentObservations?: Pick<NpAgentGuardianContentObservationServiceV1, "evidence">;
  guardianExternalObservations?: Pick<NpAgentGuardianExternalObservationServiceV1, "evidence">;
  guardianRuntimeObservations?: Pick<NpAgentGuardianRuntimeObservationServiceV1, "evidence">;
  guardianHttpObservations?: Pick<NpAgentGuardianHttpObservationServiceV1, "evidence">;
  reads: NpAgentIncidentStaffReadServiceV1;
  writer?: NpAgentIncidentWriteServiceV1;
  workflow?: NpAgentIncidentWorkflowServiceV1;
  response?: NpAgentIncidentResponseServiceV1;
  evidence?: NpAgentIncidentEvidenceServiceV1;
  memberReportEvidence?: NpAgentIncidentMemberReportEvidenceServiceV1;
  assignment?: NpAgentIncidentAssignmentServiceV1;
  notifications?: NpAgentIncidentNotificationsServiceV1;
  notificationDelivery?: NpAgentNotificationDeliveryServiceV1;
  activity?: NpAgentActivityServiceV1;
  approvals?: NpAgentApprovalServiceV1;
  cursorHmacKey: Uint8Array;
  now?: () => Date;
}
const unavailable = () =>
  new NpAgentGatewayError("INCIDENT_NOT_FOUND", 404, "Incident is unavailable.");
const invalidCursor = () =>
  new NpAgentGatewayError("INCIDENT_CURSOR_INVALID", 400, "Incident cursor is invalid.");
/** Staff-only composition; the shared reader owns all canonical evidence and per-target ACL checks. */
export function createAgentIncidentStudioServiceV1(
  options: NpAgentIncidentStudioServiceOptionsV1,
): NpAgentIncidentStudioServiceV1 {
  const now = options.now ?? (() => new Date());
  const cursor = createAgentCursorCodecV1(options.cursorHmacKey, "np.agent-incident-studio.cursor");
  async function list(
    input: Staff & { query: NpAgentIncidentStudioListQueryV1 },
  ): Promise<NpAgentIncidentStudioListOutputV1> {
    const query = npRequireAgentIncidentStudioListQueryV1(input.query);
    await options.reads.authorize(input);
    const db = getDb();
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      input.siteId,
      input.actor,
      now(),
    );
    if (!auth.authority.capabilities.includes("admin.manage"))
      throw new NpAgentGatewayError("INCIDENT_FORBIDDEN", 403, "Incident permission is required.");
    const binding = cursor.mac(
      serializeAgentCanonicalJson({
        kind: "list",
        siteId: input.siteId,
        sessionId: input.actor.sessionId,
        auth,
        query: { ...query, cursor: null },
      }),
    );
    let position: { closed: number; severity: number; time: string; id: string } | null = null;
    if (query.cursor) {
      try {
        const body = cursor.open(query.cursor) as {
          binding: unknown;
          expires: unknown;
          position: { closed: number; severity: number; time: string; id: string };
        };
        if (
          body.binding !== binding ||
          typeof body.expires !== "number" ||
          body.expires <= now().getTime() ||
          ![0, 1].includes(body.position.closed) ||
          ![0, 1, 2, 3, 4].includes(body.position.severity) ||
          !Number.isFinite(Date.parse(body.position.time)) ||
          !/^[0-9a-f-]{36}$/u.test(body.position.id)
        )
          throw invalidCursor();
        position = body.position;
      } catch {
        throw invalidCursor();
      }
    }
    const closed = sql<number>`case when ${npAgentIncidents.status} in ('resolved','dismissed') then 1 else 0 end`;
    const severity = sql<number>`case ${npAgentIncidents.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;
    const rows = await db
      .select({
        id: npAgentIncidents.id,
        version: npAgentIncidents.versionNumber,
        updatedAt: npAgentIncidents.updatedAt,
        closed,
        severity,
        time: npAgentIncidents.lastObservedAt,
      })
      .from(npAgentIncidents)
      .where(
        and(
          eq(npAgentIncidents.siteId, input.siteId),
          query.statuses.length ? inArray(npAgentIncidents.status, query.statuses) : undefined,
          query.categories.length
            ? inArray(npAgentIncidents.category, query.categories)
            : undefined,
          query.severities.length
            ? inArray(npAgentIncidents.severity, query.severities)
            : undefined,
          query.updatedAfter
            ? gt(npAgentIncidents.updatedAt, new Date(query.updatedAfter))
            : undefined,
          query.assignedAgentId
            ? eq(npAgentIncidents.assignedAgentId, query.assignedAgentId)
            : undefined,
          query.observedAfter
            ? gte(npAgentIncidents.lastObservedAt, new Date(query.observedAfter))
            : undefined,
          query.observedBefore
            ? lte(npAgentIncidents.lastObservedAt, new Date(query.observedBefore))
            : undefined,
          query.query
            ? sql`position(lower(${query.query}) in lower(${npAgentIncidents.title} || ' ' || ${npAgentIncidents.summary}))>0`
            : undefined,
          query.source
            ? sql`exists (select 1 from ${npAgentIncidentSignals} link join ${npAgentSignals} signal on signal.site_id=link.site_id and signal.id=link.signal_id where link.site_id=${input.siteId} and link.incident_id=${npAgentIncidents.id} and signal.detector_id=${query.source})`
            : undefined,
          query.containment
            ? sql`${query.containment === "inactive" ? sql`not` : sql``} exists (select 1 from ${npAgentContainments} containment where containment.site_id=${input.siteId} and containment.incident_id=${npAgentIncidents.id} and containment.state='active')`
            : undefined,
          position
            ? sql`(${closed},${severity},-extract(epoch from ${npAgentIncidents.lastObservedAt}),${npAgentIncidents.id}) > (${position.closed},${position.severity},-extract(epoch from ${position.time}::timestamptz),${position.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(
        asc(closed),
        asc(severity),
        desc(npAgentIncidents.lastObservedAt),
        asc(npAgentIncidents.id),
      )
      .limit(query.limit + 1);
    const items: NpAgentIncidentListOutputV1["items"] = [];
    const summaries: NonNullable<NpAgentIncidentStudioListOutputV1["summaries"]> = [];
    for (const row of rows.slice(0, query.limit)) {
      try {
        const current = (await options.reads.get({ incidentId: row.id }, input)).incident;
        if (
          current.versionNumber === row.version &&
          current.updatedAt === row.updatedAt.toISOString()
        ) {
          if (query.includeSummaries) {
            const summary: (typeof summaries)[number] = {
              incidentId: current.id,
              versionNumber: current.versionNumber,
              containment: null,
              assessmentAvailable: null,
            };
            if (options.workflow) {
              try {
                const review = await options.workflow.get({ ...input, incidentId: current.id });
                const [aggregate] = await db
                  .select({
                    active: sql<number>`count(*)::integer`,
                    nearestExpiryAt: sql<
                      string | null
                    >`to_char(min(${npAgentContainments.expiresAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
                  })
                  .from(npAgentContainments)
                  .where(
                    and(
                      eq(npAgentContainments.siteId, input.siteId),
                      eq(npAgentContainments.incidentId, current.id),
                      eq(npAgentContainments.state, "active"),
                    ),
                  );
                const confirmed = await options.workflow.get({ ...input, incidentId: current.id });
                if (
                  aggregate &&
                  aggregate.active === review.containment.active &&
                  confirmed.containment.reviewHash === review.containment.reviewHash
                )
                  summary.containment = {
                    active: aggregate.active,
                    nearestExpiryAt: aggregate.nearestExpiryAt,
                  };
              } catch {
                // The optional owner must prove every containment/action visible.
                // No owner or an unavailable review is unknown, never zero.
              }
            }
            const [entry] = await db
              .select()
              .from(npAgentIncidentTimeline)
              .where(
                and(
                  eq(npAgentIncidentTimeline.siteId, input.siteId),
                  eq(npAgentIncidentTimeline.incidentId, current.id),
                  eq(npAgentIncidentTimeline.kind, "agent_assessment"),
                ),
              )
              .orderBy(desc(npAgentIncidentTimeline.sequence))
              .limit(1);
            if (!entry) summary.assessmentAvailable = false;
            else {
              try {
                if (entry.details.schemaVersion === "np.agent-guardian-assessment.v1")
                  await npRequireAgentGuardianIncidentAssessmentEntryV1(db, entry);
                else if (
                  entry.details.schemaVersion === "np.agent-moderator-segmented-assessment.v2"
                )
                  await npRequireAgentIncidentSegmentedAssessmentEntryV2(db, entry);
                else await npRequireAgentIncidentAssessmentEntryV1(db, entry);
                summary.assessmentAvailable = true;
              } catch {
                /* Invalid/legacy assessment evidence stays unknown. */
              }
            }
            const checked = (await options.reads.get({ incidentId: current.id }, input)).incident;
            if (serializeAgentCanonicalJson(checked) !== serializeAgentCanonicalJson(current))
              continue;
            summaries.push(summary);
          }
          items.push(current);
        }
      } catch (error) {
        if (!(error instanceof NpAgentGatewayError) || error.code !== "INCIDENT_NOT_FOUND")
          throw error;
      }
    }
    if (
      serializeAgentCanonicalJson(
        await npResolveAgentStaffSessionAuthorizationV1(db, input.siteId, input.actor, now()),
      ) !== serializeAgentCanonicalJson(auth)
    )
      throw new NpAgentGatewayError("INCIDENT_FORBIDDEN", 403, "Incident permission is required.");
    const last = rows[Math.min(rows.length, query.limit) - 1];
    return npRequireAgentIncidentStudioListOutputV1({
      schemaVersion: "np.agent-incident-list.v1",
      items,
      ...(query.includeSummaries ? { summaries } : {}),
      nextCursor:
        rows.length > query.limit && last
          ? cursor.seal({
              binding,
              expires: now().getTime() + 900000,
              position: {
                id: last.id,
                closed: last.closed,
                severity: last.severity,
                time: last.time.toISOString(),
              },
            })
          : null,
    });
  }
  async function get(
    input: Staff & { incidentId: string; cursor?: string | null; responseCursor?: string | null },
  ): Promise<NpAgentIncidentStudioDetailV1> {
    const db = getDb();
    const { incident } = await options.reads.get({ incidentId: input.incidentId }, input);
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      input.siteId,
      input.actor,
      now(),
    );
    const binding = cursor.mac(
      serializeAgentCanonicalJson({
        siteId: input.siteId,
        sessionId: input.actor.sessionId,
        auth,
        incidentId: incident.id,
        version: incident.versionNumber,
      }),
    );
    let after = 0;
    if (input.cursor) {
      try {
        const data = cursor.open(input.cursor) as {
          binding: unknown;
          expires: unknown;
          after: unknown;
        };
        if (
          data.binding !== binding ||
          typeof data.expires !== "number" ||
          data.expires <= now().getTime() ||
          typeof data.after !== "number" ||
          !Number.isSafeInteger(data.after) ||
          data.after < 1
        )
          throw invalidCursor();
        after = data.after;
      } catch {
        throw invalidCursor();
      }
    }
    const signals = incident.signalIds.length
      ? await db
          .select()
          .from(npAgentSignals)
          .where(
            and(
              eq(npAgentSignals.siteId, input.siteId),
              inArray(npAgentSignals.id, incident.signalIds),
            ),
          )
          .orderBy(asc(npAgentSignals.id))
          .limit(100)
      : [];
    const rows = await db
      .select()
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.siteId, input.siteId),
          eq(npAgentIncidentTimeline.incidentId, incident.id),
          gt(npAgentIncidentTimeline.sequence, after),
          sql`coalesce(${npAgentIncidentTimeline.details}->>'schemaVersion','') <> ${NP_INCIDENT_NOTIFICATION_RECOVERY_SCHEMA}`,
        ),
      )
      .orderBy(asc(npAgentIncidentTimeline.sequence))
      .limit(51);
    const timeline = [];
    for (const row of rows.slice(0, 50)) {
      let approvalId: string | null = null,
        actionId: string | null = null;
      let candidateApprovalId = row.approvalId;
      if (row.actionId && options.activity) {
        try {
          const detail = await options.activity.getAction({ ...input, id: row.actionId });
          candidateApprovalId ??= detail.action.approvalId;
          actionId = row.actionId;
        } catch {
          /* Inaccessible references stay absent. */
        }
      }
      // Comment actions are not yet readable through generic Activity. The owning
      // approval service can still authorize the exact retained moderation target.
      if (!candidateApprovalId && row.actionId && options.approvals) {
        const [action] = await db
          .select({ approvalId: npAgentActions.approvalId })
          .from(npAgentActions)
          .where(and(eq(npAgentActions.siteId, input.siteId), eq(npAgentActions.id, row.actionId)))
          .limit(1);
        candidateApprovalId = action?.approvalId ?? null;
      }
      if (candidateApprovalId && options.approvals) {
        try {
          await options.approvals.get({ ...input, id: candidateApprovalId });
          approvalId = candidateApprovalId;
        } catch {
          /* Inaccessible references stay absent. */
        }
      }
      let containmentFailure:
        { outcome: "rolled_back"; reasonCode: "CONTAINMENT_VERIFICATION_FAILED" } | undefined;
      if (row.details.schemaVersion === "np.agent-incident-containment-failure-entry.v1") {
        if ((!actionId && !approvalId) || !row.actionId || !row.auditEventId) continue;
        try {
          const source = await npRequireIncidentContainmentFailure({
            db,
            siteId: input.siteId,
            incidentId: input.incidentId,
            actionId: row.actionId,
            auditEventId: row.auditEventId,
          });
          if (
            row.sourceFingerprint !== source.action.inputHash ||
            row.details.executionInvocationId !== source.execution.id ||
            row.details.outcome !== "rolled_back" ||
            row.details.phase !== "failed"
          )
            continue;
          containmentFailure = {
            outcome: "rolled_back",
            reasonCode: "CONTAINMENT_VERIFICATION_FAILED",
          };
        } catch {
          continue;
        }
      }
      let severityChange: NpAgentIncidentSeverityChangeV1 | undefined;
      let ruleSeverityChange: NpAgentIncidentRuleSeverityChangeV1 | undefined;
      if (row.details.schemaVersion === "np.agent-incident-severity-entry.v1") {
        try {
          severityChange = await npRequireIncidentSeverityEvidence(db, row);
        } catch {
          continue;
        }
      }
      if (row.details.schemaVersion === "np.agent-incident-rule-severity-entry.v1") {
        try {
          ruleSeverityChange = await npRequireIncidentRuleSeverityEvidence(db, row);
        } catch {
          continue;
        }
      }
      let assessment: NpAgentModeratorAssessmentV1 | undefined;
      let segmentedAssessment: NpAgentModeratorSegmentedAssessmentV2 | undefined;
      let guardianAssessment: NpAgentGuardianAssessmentV1 | undefined;
      if (row.kind === "agent_assessment") {
        try {
          if (row.details.schemaVersion === "np.agent-guardian-assessment.v1")
            guardianAssessment = await npRequireAgentGuardianIncidentAssessmentEntryV1(db, row);
          else if (row.details.schemaVersion === "np.agent-moderator-segmented-assessment.v2")
            segmentedAssessment = await npRequireAgentIncidentSegmentedAssessmentEntryV2(db, row);
          else assessment = await npRequireAgentIncidentAssessmentEntryV1(db, row);
        } catch {
          // Raw model prose and unverified legacy entries never become a trusted projection.
          continue;
        }
      }
      timeline.push({
        ...(assessment ? { assessment } : {}),
        ...(segmentedAssessment ? { segmentedAssessment } : {}),
        ...(guardianAssessment ? { guardianAssessment } : {}),
        ...(containmentFailure ? { containmentFailure } : {}),
        ...(containmentFailure && options.notifications?.recoveryState
          ? {
              notificationRecovery: await options.notifications.recoveryState({
                ...input,
                db,
                timelineId: row.id,
              }),
            }
          : {}),
        ...(severityChange ? { severityChange } : {}),
        ...(ruleSeverityChange ? { ruleSeverityChange } : {}),
        id: row.id,
        sequence: row.sequence,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        approvalId,
        actionId,
        ...(row.kind === "human_note" &&
        row.sourceKind === "staff" &&
        row.details.schemaVersion === "np.agent-incident-assignment-entry.v1"
          ? {
              assignment: npRequireAgentIncidentAssignmentEntryV1({
                fromAgentId: row.details.fromAgentId,
                toAgentId: row.details.toAgentId,
              }),
            }
          : {}),
        decision:
          row.kind === "state_transition" &&
          row.details.schemaVersion === "np.agent-incident-transition-entry.v1"
            ? npRequireAgentIncidentDecisionV1({
                fromStatus: row.details.fromStatus,
                toStatus: row.details.toStatus,
                resolutionCode: row.details.resolutionCode,
                note: row.details.note,
                containmentDisposition: row.details.containmentDisposition,
              })
            : null,
      });
    }
    const fingerprints = new Map(
      signals.map((s) => [
        `cj1:sha256:${createHash("sha256")
          .update(
            serializeAgentCanonicalJson({
              schemaVersion: "np.agent-incident-feedback-target.v1",
              siteId: input.siteId,
              incidentId: incident.id,
              signalId: s.id,
              evidenceDigest: s.evidenceDigest,
            }),
          )
          .digest("base64url")}`,
        s.id,
      ]),
    );
    const feedback = fingerprints.size
      ? await db
          .select()
          .from(npAgentFeedback)
          .where(
            and(
              eq(npAgentFeedback.siteId, input.siteId),
              eq(npAgentFeedback.targetKind, "incident"),
              eq(npAgentFeedback.targetId, incident.id),
              inArray(npAgentFeedback.targetFingerprint, [...fingerprints.keys()]),
              sql`not exists (select 1 from np_agent_feedback successor where successor.site_id=${npAgentFeedback.siteId} and successor.supersedes_id=${npAgentFeedback.id})`,
            ),
          )
          .orderBy(asc(npAgentFeedback.id))
          .limit(100)
      : [];
    let response = null;
    const memberReports =
      incident.primarySubject?.kind === "member" &&
      signals.length > 0 &&
      signals.every((signal) => signal.detectorId === "moderator.member-report-review");
    if (options.response && !memberReports) {
      try {
        const {
          responseCursor: selectedResponseCursor,
          cursor: _timelineCursor,
          ...responseInput
        } = input;
        response = await options.response.get({
          ...responseInput,
          ...(selectedResponseCursor !== undefined ? { cursor: selectedResponseCursor } : {}),
        });
      } catch (error) {
        if (!(error instanceof NpAgentGatewayError) || ![403, 404, 409].includes(error.status))
          throw error;
      }
    }
    let workflow = null;
    if (options.workflow) {
      try {
        workflow = await options.workflow.get(input);
      } catch (error) {
        if (
          !(error instanceof NpAgentGatewayError) ||
          ![
            "INCIDENT_WORKFLOW_FORBIDDEN",
            "INCIDENT_WORKFLOW_LIMIT_REACHED",
            "INCIDENT_WORKFLOW_UNAVAILABLE",
          ].includes(error.code)
        )
          throw error;
      }
    }
    let guardianEvidence: NpAgentGuardianEvidenceV1[] | null | undefined;
    if (
      signals.some(
        (signal) =>
          signal.detectorId === "guardian.login-failures" ||
          signal.detectorId === "guardian.rate-limits",
      )
    ) {
      guardianEvidence = null;
      try {
        guardianEvidence = await npReadAgentGuardianIncidentEvidenceV1({
          db,
          siteId: input.siteId,
          incident,
        });
      } catch {
        // Missing or corrupt sources are unavailable; no invented aggregate crosses the wire.
      }
    }
    let guardianSecurityEvidence: NpAgentGuardianSecurityEvidenceV1[] | null | undefined;
    if (
      signals.some((signal) =>
        npAgentGuardianSecurityDetectorIdsV1.some((id) => id === signal.detectorId),
      )
    ) {
      guardianSecurityEvidence = null;
      try {
        if (options.guardianSecurityObservations)
          guardianSecurityEvidence = await options.guardianSecurityObservations.evidence({
            db,
            siteId: input.siteId,
            incident,
          });
      } catch {
        // Historical integrity or retained-key loss is unavailable, never an invented source fact.
      }
    }
    let guardianSessionEvidence: NpAgentGuardianSessionEvidenceV1[] | null | undefined;
    if (signals.some((signal) => signal.detectorId === "guardian.login-after-failures")) {
      guardianSessionEvidence = null;
      try {
        guardianSessionEvidence = await npReadAgentGuardianSessionSafeEvidenceV1({
          db,
          siteId: input.siteId,
          incident,
        });
      } catch {
        /* Historical proof loss cannot disclose session/principal targets. */
      }
    }
    let guardianContentEvidence: NpAgentGuardianContentEvidenceV1[] | null | undefined;
    if (
      signals.some((signal) =>
        npAgentGuardianContentDetectorIdsV1.some((id) => id === signal.detectorId),
      )
    ) {
      guardianContentEvidence = null;
      try {
        if (options.guardianContentObservations)
          guardianContentEvidence = await options.guardianContentObservations.evidence({
            db,
            siteId: input.siteId,
            incident,
            actor: input.actor,
          });
      } catch {
        // Hidden documents and unavailable source proof never become aggregate facts.
      }
    }
    let guardianExternalEvidence: NpAgentGuardianExternalEvidenceV1[] | null | undefined;
    if (signals.some((signal) => signal.detectorId === NP_AGENT_GUARDIAN_EXTERNAL_DETECTOR_ID_V1)) {
      guardianExternalEvidence = null;
      try {
        if (options.guardianExternalObservations)
          guardianExternalEvidence = await options.guardianExternalObservations.evidence({
            db,
            siteId: input.siteId,
            incident,
          });
      } catch {
        // External signatures and local provenance are required, not inferred from labels.
      }
    }
    let guardianRuntimeEvidence: NpAgentGuardianRuntimeEvidenceV1[] | null | undefined;
    if (
      signals.some((signal) =>
        npAgentGuardianRuntimeDetectorIdsV1.some((id) => id === signal.detectorId),
      )
    ) {
      guardianRuntimeEvidence = null;
      try {
        if (options.guardianRuntimeObservations)
          guardianRuntimeEvidence = await options.guardianRuntimeObservations.evidence({
            db,
            siteId: input.siteId,
            incident,
            actor: input.actor,
          });
      } catch {
        /* Unknown accounting/provenance never becomes an invented aggregate. */
      }
    }
    let guardianHttpEvidence: NpAgentGuardianHttpEvidenceV1[] | null | undefined;
    if (
      signals.some((signal) =>
        npAgentGuardianHttpDetectorIdsV1.some((id) => id === signal.detectorId),
      )
    ) {
      guardianHttpEvidence = null;
      try {
        if (options.guardianHttpObservations)
          guardianHttpEvidence = await options.guardianHttpObservations.evidence({
            db,
            siteId: input.siteId,
            incident,
          });
      } catch {
        /* A response count never substitutes for its source proof. */
      }
    }
    // Reread all evidence and item ACLs after composing related records; do not return a mixed generation.
    const current = await options.reads.get({ incidentId: incident.id }, input);
    if (
      serializeAgentCanonicalJson(current.incident) !== serializeAgentCanonicalJson(incident) ||
      serializeAgentCanonicalJson(
        await npResolveAgentStaffSessionAuthorizationV1(db, input.siteId, input.actor, now()),
      ) !== serializeAgentCanonicalJson(auth)
    )
      throw unavailable();
    return npRequireAgentIncidentStudioDetailV1({
      schemaVersion: "np.agent-incident-studio-detail.v1",
      ...(guardianSecurityEvidence === undefined ? {} : { guardianSecurityEvidence }),
      ...(guardianSessionEvidence === undefined ? {} : { guardianSessionEvidence }),
      ...(guardianContentEvidence === undefined ? {} : { guardianContentEvidence }),
      ...(guardianExternalEvidence === undefined ? {} : { guardianExternalEvidence }),
      ...(guardianRuntimeEvidence === undefined ? {} : { guardianRuntimeEvidence }),
      ...(guardianHttpEvidence === undefined ? {} : { guardianHttpEvidence }),
      ...(guardianEvidence === undefined ? {} : { guardianEvidence }),
      incident,
      workflow,
      response,
      signals: signals.map((s) => ({
        id: s.id,
        detectorId: s.detectorId,
        detectorVersion: s.detectorVersion,
        category: s.category,
        confidenceBasis: s.confidenceBasis,
        scoreBasisPoints: s.scoreBasisPoints,
        createdAt: s.createdAt.toISOString(),
      })),
      timeline,
      timelinePageComplete: timeline.length === Math.min(rows.length, 50),
      nextTimelineCursor:
        rows.length > 50
          ? cursor.seal({ binding, expires: now().getTime() + 900000, after: rows[49].sequence })
          : null,
      feedback: feedback.map((f) => ({
        id: f.id,
        signalId: fingerprints.get(f.targetFingerprint),
        label: f.label,
        supersedesId: f.supersedesId,
        createdAt: f.createdAt.toISOString(),
      })),
      feedbackAvailable:
        options.writer?.feedbackEnabled === true &&
        incident.category === "spam" &&
        auth.authority.capabilities.includes("community.moderate"),
    });
  }
  return {
    deliveries: (input) => {
      if (!options.notificationDelivery)
        throw new NpAgentGatewayError(
          "INCIDENT_NOTIFICATION_DELIVERIES_UNAVAILABLE",
          503,
          "External notification delivery is disabled or unavailable.",
        );
      return options.notificationDelivery.list(input);
    },
    notifications: (input) => {
      if (!options.notifications)
        throw new NpAgentGatewayError(
          "INCIDENT_NOTIFICATIONS_UNAVAILABLE",
          503,
          "Incident notifications are unavailable.",
        );
      return options.notifications.list(input);
    },
    assignment: (input) => {
      if (!options.assignment)
        throw new NpAgentGatewayError(
          "INCIDENT_ASSIGNMENT_UNAVAILABLE",
          503,
          "Incident assignment is unavailable.",
        );
      return options.assignment.get(input);
    },
    assign: (input) => {
      if (!options.assignment)
        throw new NpAgentGatewayError(
          "INCIDENT_ASSIGNMENT_UNAVAILABLE",
          503,
          "Incident assignment is unavailable.",
        );
      return options.assignment.assign(input);
    },
    memberReportEvidence: (input) => {
      if (!options.memberReportEvidence)
        throw new NpAgentGatewayError(
          "INCIDENT_EVIDENCE_UNAVAILABLE",
          503,
          "Member report evidence is unavailable.",
        );
      return options.memberReportEvidence.get(input);
    },
    evidence: (input) => {
      if (!options.evidence)
        throw new NpAgentGatewayError(
          "INCIDENT_EVIDENCE_UNAVAILABLE",
          503,
          "Incident evidence is unavailable.",
        );
      return options.evidence.get(input);
    },
    get,
    list,
    responsePlan: (input) => {
      if (!options.response)
        throw new NpAgentGatewayError(
          "INCIDENT_RESPONSE_UNAVAILABLE",
          503,
          "Incident response is unavailable.",
        );
      return options.response.responsePlan(input);
    },
    responseExecute: (input) => {
      if (!options.response)
        throw new NpAgentGatewayError(
          "INCIDENT_RESPONSE_UNAVAILABLE",
          503,
          "Incident response is unavailable.",
        );
      return options.response.responseExecute(input);
    },
    restore: (input) => {
      if (!options.response)
        throw new NpAgentGatewayError(
          "INCIDENT_RESPONSE_UNAVAILABLE",
          503,
          "Incident response is unavailable.",
        );
      return options.response.restore(input);
    },
    escalate: async (input) => {
      if (!options.workflow)
        throw new NpAgentGatewayError(
          "INCIDENT_WORKFLOW_DISABLED",
          403,
          "Incident workflow is unavailable.",
        );
      return options.workflow.escalate(input);
    },
    transition: async (input) => {
      if (!options.workflow)
        throw new NpAgentGatewayError(
          "INCIDENT_WORKFLOW_DISABLED",
          403,
          "Incident workflow is unavailable.",
        );
      return options.workflow.transition(input);
    },
    feedback: async (input) => {
      if (!options.writer)
        throw new NpAgentGatewayError(
          "INCIDENT_FEEDBACK_DISABLED",
          403,
          "Incident feedback is unavailable.",
        );
      await options.reads.get({ incidentId: input.incidentId }, input);
      const result = await options.writer.feedback(input);
      return { resourceId: result.resourceId, replayed: result.replayed };
    },
  };
}
