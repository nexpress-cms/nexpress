import type { NpAgentIncidentEvidenceServiceV1 } from "./incident-evidence-service.js";
import type { NpAgentIncidentResponseServiceV1 } from "./incident-response-service.js";
import {
  npRequireAgentIncidentDecisionV1,
  type NpAgentIncidentTransitionInputV1,
} from "../agent-contract/incident-workflow-contract.js";
import type { NpAgentIncidentWorkflowServiceV1 } from "./incident-workflow-service.js";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentSignals,
  npAgentIncidentTimeline,
  npAgentFeedback,
  npAgentIncidents,
  npAgentActions,
} from "../db/schema/agent.js";
import {
  npRequireAgentIncidentStudioDetailV1,
  type NpAgentIncidentStudioDetailV1,
} from "../agent-contract/incident-studio-contract.js";
import {
  npRequireAgentIncidentListInputV1,
  type NpAgentIncidentListInputV1,
  type NpAgentIncidentListOutputV1,
} from "../agent-contract/incident-contract.js";
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
  evidence: NpAgentIncidentEvidenceServiceV1["get"];
  responsePlan: NpAgentIncidentResponseServiceV1["responsePlan"];
  responseExecute: NpAgentIncidentResponseServiceV1["responseExecute"];
  restore: NpAgentIncidentResponseServiceV1["restore"];
  list(input: Staff & { query: NpAgentIncidentListInputV1 }): Promise<NpAgentIncidentListOutputV1>;
  get(
    input: Staff & { incidentId: string; cursor?: string | null },
  ): Promise<NpAgentIncidentStudioDetailV1>;
  transition(
    input: Staff & { incidentId: string; command: NpAgentIncidentTransitionInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  feedback(
    input: Staff & { incidentId: string; command: NpAgentIncidentFeedbackInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
}
export interface NpAgentIncidentStudioServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  writer?: NpAgentIncidentWriteServiceV1;
  workflow?: NpAgentIncidentWorkflowServiceV1;
  response?: NpAgentIncidentResponseServiceV1;
  evidence?: NpAgentIncidentEvidenceServiceV1;
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
    input: Staff & { query: NpAgentIncidentListInputV1 },
  ): Promise<NpAgentIncidentListOutputV1> {
    const query = npRequireAgentIncidentListInputV1(input.query);
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
    for (const row of rows.slice(0, query.limit)) {
      try {
        const current = (await options.reads.get({ incidentId: row.id }, input)).incident;
        if (
          current.versionNumber === row.version &&
          current.updatedAt === row.updatedAt.toISOString()
        )
          items.push(current);
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
    return {
      schemaVersion: "np.agent-incident-list.v1",
      items,
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
    };
  }
  async function get(
    input: Staff & { incidentId: string; cursor?: string | null },
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
      timeline.push({
        id: row.id,
        sequence: row.sequence,
        kind: row.kind,
        createdAt: row.createdAt.toISOString(),
        approvalId,
        actionId,
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
    if (options.response) {
      try {
        response = await options.response.get(input);
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
