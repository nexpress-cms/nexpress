import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { getDb as GetDb } from "../db/runtime.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentEvents,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentSignals,
} from "../db/schema/agent.js";
import { npAuditEvents, npBans, npMembers, npReports } from "../db/schema/community.js";
import { npSessions, npSiteMemberships, npUsers } from "../db/schema/system.js";
import { npIssueBanInTransactionV1, npRevokeBanInTransactionV1 } from "../community/bans.js";
import { npRequireBanRow } from "../community-contract/contract.js";
import type { NpBanRow } from "../community-contract/types.js";
import { withCurrentSite } from "../sites/context.js";
import { withDeferredPostCommit } from "../collections/pipeline.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentActionCanonical,
  npRequireAgentActionCanonical,
} from "../agent-contract/canonical-action.js";
import {
  npDigestAgentInvocationRequestCanonical,
  npRequireAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import {
  npDigestAgentAuthorizationContextCanonical,
  npRequireAgentAuthorizationContextCanonical,
} from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentStaffSiteAuthorizationCanonical } from "../agent-contract/canonical-bodies.js";
import {
  canonicalBodyInteger,
  canonicalBodySha256Digest,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { npAgentModeratorMemberReportDetectorV1 } from "../agent-contract/moderator-member-report-contract.js";
import {
  npRequireAgentMemberResponsePlanInputV1,
  npRequireAgentMemberResponseExecuteInputV1,
  npRequireAgentMemberResponseV1,
  npRequireAgentApprovalMemberResponseActionReviewV1,
  type NpAgentMemberResponsePlanInputV1,
  type NpAgentMemberResponseExecuteInputV1,
  type NpAgentMemberResponseV1,
  type NpAgentMemberResponseCapabilityIdV1,
} from "../agent-contract/member-response-contract.js";
import type {
  NpAgentApprovalStatementCanonicalV1,
  NpAgentApprovalTargetV1,
  NpAgentJsonObject,
  NpAgentTargetRef,
  NpAgentInvocationAuthorityRefV1,
  NpAgentSignalEvidenceCanonicalV1,
  NpAgentStaffSiteAuthorizationCanonicalV1,
} from "../agent-contract/types.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  createAgentAdminAdmissionV1,
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
  npResolveLiveAgentStaffAuthorizationV1,
  type NpAgentAdminActorV1,
  type NpAgentAdminAdmissionOptionsV1,
} from "./admin-admission.js";
import {
  npReadAgentIncidentSignalEvidenceV1,
  type NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import type {
  NpAgentApprovalServiceV1,
  NpAgentApprovalServiceOptionsV1,
} from "./approval-service.js";
import type { NpAgentIncidentMemberReportEvidenceServiceV1 } from "./incident-member-report-evidence-service.js";
import {
  npInspectAgentModeratorMemberReportSourceV1,
  npReadAgentModeratorMemberReportSourceV1,
} from "./moderator-member-report-source.js";
import {
  npMemberResponseCapabilityDefinitionV1,
  type NpMemberResponseCapabilityDefinitionV1,
} from "./member-response-capability.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

type Db = ReturnType<typeof GetDb>;
type Action = typeof npAgentActions.$inferSelect;
type Approval = typeof npAgentApprovals.$inferSelect;
type Invocation = typeof npAgentInvocations.$inferSelect;
type StaffInvocation = Omit<Invocation, "authorityRef" | "auditEventId"> & {
  authorityRef: Extract<NpAgentInvocationAuthorityRefV1, { kind: "staff-session" }>;
  requesterId: string;
  auditEventId: string;
};
type Input = { siteId: string; actor: NpAgentAdminActorV1; incidentId: string };
type Member = Pick<typeof npMembers.$inferSelect, "id" | "status" | "updatedAt" | "tokenVersion">;
interface SourceFact {
  eventId: string;
  reportId: string;
  versionDigest: string;
  resolvedAt: string | null;
  status: Member["status"];
}
interface Facts {
  incident: NpAgentIncidentV1;
  memberId: string;
  member: Member;
  restrictions: NpBanRow[];
  sourceFacts: SourceFact[];
  memberVersionDigest: string;
  policy: NpAgentMemberResponsePolicyV1;
}
interface LoadedAction {
  row: Action;
  command: NpAgentMemberResponsePlanInputV1;
  definition: NpMemberResponseCapabilityDefinitionV1;
}
interface CheckedApproval {
  entry: Approval;
  statement: NpAgentApprovalStatementCanonicalV1;
}
export interface NpAgentMemberResponsePolicyV1 {
  policyDigest: string;
  maximumDurationSeconds: number;
  approvalLifetimeSeconds: number;
}
export interface NpAgentMemberResponseServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  memberEvidence: Pick<
    NpAgentIncidentMemberReportEvidenceServiceV1,
    "canReadStaffIncident" | "canReviewStaffUser"
  >;
  resolveApprovals(): NpAgentApprovalServiceV1;
  /** A live host decision, never an inferred production allowance. Null disables the workflow. */
  resolvePolicy(
    input: Input & { db: Db; memberId: string },
  ): Promise<NpAgentMemberResponsePolicyV1 | null>;
  /** Reuse the same current per-user Incident ACL as reads; signed Approval owns its historical session proof. */
  canReviewIncidentAsStaffUser(input: {
    db: Db;
    siteId: string;
    userId: string;
    incident: NpAgentIncidentV1;
    signals: readonly NpAgentSignalEvidenceCanonicalV1[];
  }): boolean | Promise<boolean>;
  admission?: NpAgentAdminAdmissionOptionsV1;
  now?: () => Date;
}
export interface NpAgentMemberResponseServiceV1 {
  get(input: Input): Promise<NpAgentMemberResponseV1>;
  plan(
    input: Input & { command: NpAgentMemberResponsePlanInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  execute(
    input: Input & { command: NpAgentMemberResponseExecuteInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  approvalTargets: NpAgentApprovalServiceOptionsV1["targets"];
}
const json = (value: object) => value as unknown as NpAgentJsonObject;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const digest = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(purpose + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
function fail(): never {
  throw new NpAgentGatewayError(
    "MEMBER_RESPONSE_CONFLICT",
    409,
    "Member response evidence changed. Review the current Incident and prepare a new plan.",
  );
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "MEMBER_RESPONSE_UNAVAILABLE",
    503,
    "The current-site Member response policy and service must be installed explicitly.",
  );
}
function capability(
  command: NpAgentMemberResponsePlanInputV1,
): NpAgentMemberResponseCapabilityIdV1 {
  return command.operation.kind === "restrict"
    ? "moderation.member.restrict"
    : "moderation.member.revoke";
}
function banFacts(row: NpBanRow): NpAgentJsonObject {
  return {
    id: row.id,
    siteId: row.siteId,
    memberId: row.memberId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    kind: row.kind,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    reason: row.reason,
    byUserId: row.byUserId,
    byMemberId: row.byMemberId,
    createdAt: row.createdAt.toISOString(),
  };
}
function targets(incidentId: string, memberId: string): NpAgentTargetRef[] {
  return [
    {
      kind: "actor" as const,
      subject: {
        kind: "principal" as const,
        principalKind: "member" as const,
        principalId: memberId,
      },
    },
    { kind: "incident" as const, incidentId },
  ].sort((a, b) => {
    const left = serializeAgentCanonicalJson(a),
      right = serializeAgentCanonicalJson(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Optional staff-only workflow. It never registers a capability, installs a worker or grants account authority. */
export function createAgentMemberResponseServiceV1(
  options: NpAgentMemberResponseServiceOptionsV1,
): NpAgentMemberResponseServiceV1 {
  const now = options.now ?? (() => new Date());
  const admission = createAgentAdminAdmissionV1({ ...options.admission, now });
  const transaction = <T>(siteId: string, work: (db: Db) => Promise<T>) =>
    withCurrentSite(siteId, () =>
      withDeferredPostCommit(() =>
        getDb().transaction(
          (tx) => npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) => work(db), tx),
          { isolationLevel: "serializable" },
        ),
      ),
    );

  async function actor(
    db: Db,
    siteId: string,
    value: NpAgentAdminActorV1,
  ): Promise<NpAgentStaffSiteAuthorizationCanonicalV1> {
    const auth = await npResolveAgentStaffSessionAuthorizationV1(db, siteId, value, now());
    if (
      !auth.authority.capabilities.includes("admin.manage") ||
      !auth.authority.capabilities.includes("community.moderate")
    )
      fail();
    return auth;
  }
  async function policy(
    db: Db,
    input: Input,
    memberId: string,
  ): Promise<NpAgentMemberResponsePolicyV1> {
    if (typeof options.resolvePolicy !== "function") unavailable();
    const result = await options.resolvePolicy({ ...input, db, memberId });
    if (!result) unavailable();
    canonicalBodySha256Digest(result.policyDigest, "memberResponse.policyDigest");
    canonicalBodyInteger(
      result.maximumDurationSeconds,
      "memberResponse.maximumDurationSeconds",
      1,
      2592000,
    );
    canonicalBodyInteger(
      result.approvalLifetimeSeconds,
      "memberResponse.approvalLifetimeSeconds",
      1,
      900,
    );
    return structuredClone(result);
  }
  async function lockPeople(
    db: Db,
    siteId: string,
    people: readonly { userId: string; sessionId?: string }[],
  ): Promise<void> {
    const ids = [...new Set(people.map((person) => person.userId))].sort();
    if (!ids.length) fail();
    await db
      .select({ id: npUsers.id })
      .from(npUsers)
      .where(inArray(npUsers.id, ids))
      .orderBy(asc(npUsers.id))
      .for("share");
    await db
      .select({ userId: npSiteMemberships.userId })
      .from(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, siteId), inArray(npSiteMemberships.userId, ids)))
      .orderBy(asc(npSiteMemberships.userId))
      .for("share");
    const sessions = [
      ...new Set(people.flatMap((person) => (person.sessionId ? [person.sessionId] : []))),
    ].sort();
    if (sessions.length)
      await db
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(inArray(npSessions.id, sessions))
        .orderBy(asc(npSessions.id))
        .for("share");
  }
  async function authorize(db: Db, input: Input, lock = false): Promise<Facts> {
    if (typeof options.canReviewIncidentAsStaffUser !== "function") unavailable();
    await actor(db, input.siteId, input.actor);
    const incident = (
      await options.reads.get({ incidentId: input.incidentId }, { ...input, transaction: db })
    ).incident;
    if (
      incident.siteId !== input.siteId ||
      incident.category !== "abuse" ||
      incident.primarySubject?.kind !== "member"
    )
      fail();
    const memberId = incident.primarySubject.memberId;
    if (lock) {
      const [row] = await db
        .select({ version: npAgentIncidents.versionNumber })
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, incident.id)))
        .for("update");
      if (!row || row.version !== incident.versionNumber) fail();
      await db
        .select({ id: npMembers.id })
        .from(npMembers)
        .where(eq(npMembers.id, memberId))
        .for("no key update");
    }
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
          eq(npAgentIncidentSignals.incidentId, incident.id),
        ),
      )
      .orderBy(asc(npAgentSignals.id))
      .limit(101);
    if (
      !rows.length ||
      rows.length > 100 ||
      !same(
        rows.map(({ signal }) => signal.id),
        incident.signalIds,
      )
    )
      fail();
    const signals = await Promise.all(
      rows.map(async ({ signal }) => {
        const canonical = await npReadAgentIncidentSignalEvidenceV1(signal);
        if (
          signal.incidentId !== incident.id ||
          signal.severity !== "info" ||
          signal.confidenceBasis !== "external" ||
          signal.scoreBasisPoints !== null ||
          canonical.detectorId !== npAgentModeratorMemberReportDetectorV1 ||
          canonical.detectorVersion !== 1 ||
          canonical.subject?.kind !== "member" ||
          canonical.subject.memberId !== memberId ||
          !canonical.evidence.length ||
          canonical.evidence.some(
            (ref) => ref.kind !== "event" || ref.eventKind !== "community.member.reported",
          )
        )
          fail();
        return canonical;
      }),
    );
    const eventIds = [
      ...new Set(
        signals.flatMap((signal) =>
          signal.evidence.flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : [])),
        ),
      ),
    ].sort();
    if (eventIds.length > 100) fail();
    const events = await db
      .select()
      .from(npAgentEvents)
      .where(and(eq(npAgentEvents.siteId, input.siteId), inArray(npAgentEvents.id, eventIds)))
      .orderBy(asc(npAgentEvents.id));
    if (events.length !== eventIds.length) fail();
    if (lock) {
      const sources = await Promise.all(events.map(npReadAgentModeratorMemberReportSourceV1));
      if (sources.some((source) => !source || source.event.subject.memberId !== memberId)) fail();
      const reportIds = [
        ...new Set(sources.flatMap((source) => (source ? [source.reportId] : []))),
      ].sort();
      await db
        .select({ id: npReports.id })
        .from(npReports)
        .where(and(eq(npReports.siteId, input.siteId), inArray(npReports.id, reportIds)))
        .orderBy(asc(npReports.id))
        .for("share");
    }
    const sourceFacts: SourceFact[] = [];
    for (const event of events) {
      const inspected = await npInspectAgentModeratorMemberReportSourceV1(db, event);
      if (!inspected || inspected.member.id !== memberId) fail();
      sourceFacts.push({
        eventId: event.id,
        reportId: inspected.report.id,
        versionDigest: inspected.versionDigest,
        resolvedAt: inspected.report.resolvedAt?.toISOString() ?? null,
        status: inspected.member.status,
      });
    }
    if (
      !(await options.memberEvidence.canReadStaffIncident({
        incident,
        signals,
        context: { ...input, transaction: db },
      }))
    )
      fail();
    const [member] = await db
      .select({
        id: npMembers.id,
        status: npMembers.status,
        updatedAt: npMembers.updatedAt,
        tokenVersion: npMembers.tokenVersion,
      })
      .from(npMembers)
      .where(eq(npMembers.id, memberId))
      .limit(1);
    if (!member) fail();
    const restrictionQuery = db
      .select()
      .from(npBans)
      .where(
        and(
          eq(npBans.siteId, input.siteId),
          eq(npBans.memberId, memberId),
          or(isNull(npBans.expiresAt), gt(npBans.expiresAt, now())),
        ),
      )
      .orderBy(asc(npBans.id))
      .limit(101);
    const restrictionRows = lock ? await restrictionQuery.for("update") : await restrictionQuery;
    if (restrictionRows.length > 100) fail();
    const restrictions = restrictionRows.map(npRequireBanRow);
    const memberVersionDigest = digest("np.agent-member-response-version.v1", {
      siteId: input.siteId,
      memberId,
      status: member.status,
      updatedAt: member.updatedAt.toISOString(),
      tokenVersion: member.tokenVersion,
      sources: sourceFacts,
      bans: restrictions.map(banFacts),
    });
    return {
      incident,
      memberId,
      member,
      restrictions,
      sourceFacts,
      memberVersionDigest,
      policy: await policy(db, input, memberId),
    };
  }
  async function invocation(db: Db, row: Action): Promise<StaffInvocation> {
    if (!row.invocationId) fail();
    const [original] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, row.siteId), eq(npAgentInvocations.id, row.invocationId)),
      )
      .limit(1);
    if (
      !original ||
      original.actorKind !== "staff" ||
      original.transport !== "admin" ||
      original.operationKind !== "admin" ||
      original.operationId !== "agents.incidents.member_response_plan" ||
      original.authorityRef.kind !== "staff-session" ||
      original.requestHash !== row.invocationFingerprint ||
      !original.auditEventId
    )
      fail();
    const body = npRequireAgentInvocationRequestCanonical(original.requestBody);
    const auth = npRequireAgentAuthorizationContextCanonical(original.authorizationContextBody);
    const { targetId, parentTargetId, ...command } = body.input;
    if (
      (await npDigestAgentInvocationRequestCanonical(body)) !== original.requestHash ||
      (await npDigestAgentAuthorizationContextCanonical(auth)) !==
        original.authorizationContextFingerprint ||
      auth.actor.kind !== "staff" ||
      (original.staffUserId !== null
        ? original.staffUserId !== auth.actor.userId || original.actorDeletedAt !== null
        : original.actorDeletedAt === null || original.actorDeletedAt < original.requestedAt) ||
      auth.actor.actorFingerprint !== original.actorFingerprint ||
      original.actorFingerprint !==
        digest("np.agent-staff-actor.v1", { siteId: row.siteId, userId: auth.actor.userId }) ||
      auth.transport !== "admin" ||
      auth.authorityRef.kind !== "staff-session" ||
      !same(auth.authorityRef, original.authorityRef) ||
      targetId !== incidentIdOf(row) ||
      parentTargetId !== null ||
      !same(command, row.inputCanonical) ||
      body.actorFingerprint !== original.actorFingerprint ||
      body.authorizationContextFingerprint !== original.authorizationContextFingerprint
    )
      fail();
    return {
      ...original,
      authorityRef: auth.authorityRef,
      requesterId: auth.actor.userId,
      auditEventId: original.auditEventId,
    };
  }
  function incidentIdOf(row: Action): string {
    const targets = row.targetRefs.filter((target) => target.kind === "incident");
    if (targets.length !== 1 || targets[0].kind !== "incident") fail();
    return targets[0].incidentId;
  }
  async function loadAction(
    db: Db,
    siteId: string,
    id: string,
    lock = false,
  ): Promise<LoadedAction> {
    const query = db
      .select()
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, id)))
      .limit(1);
    const [row] = lock ? await query.for("update") : await query;
    if (
      !row ||
      !["moderation.member.restrict", "moderation.member.revoke"].includes(row.capabilityId) ||
      !row.approvalId ||
      row.runId ||
      row.runFingerprint ||
      row.containmentId ||
      row.enforcementAdapterId
    )
      fail();
    const command = npRequireAgentMemberResponsePlanInputV1(row.inputCanonical);
    const definition = await npMemberResponseCapabilityDefinitionV1(capability(command));
    const targetRefs = targets(incidentIdOf(row), command.memberId);
    const body = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId,
      actionId: row.id,
      invocationFingerprint: row.invocationFingerprint,
      runFingerprint: null,
      sequence: 1,
      capabilityId: capability(command),
      capabilityContractVersion: 1,
      capabilityFingerprint: definition.fingerprint,
      effectProfile: { id: definition.profile, contractVersion: 1 },
      risk: "sensitive",
      requiredScopes: ["moderation:execute"],
      targetRefs,
      targetVersionFacts: targetRefs.map((targetRef) => ({
        targetRef: structuredClone(targetRef),
        versionDigest: command.expectedMemberVersionDigest,
      })),
      input: json(command),
    });
    if (
      row.capabilityId !== capability(command) ||
      row.capabilityFingerprint !== definition.fingerprint ||
      !same(row.capabilityDefinitionBody, definition.canonical) ||
      !same(row.targetRefs, body.targetRefs) ||
      !same(row.targetVersionFacts, body.targetVersionFacts) ||
      row.effectProfileId !== definition.profile ||
      row.effectContractVersion !== 1 ||
      row.risk !== "sensitive" ||
      !same(row.requiredScopes, body.requiredScopes) ||
      (await npDigestAgentActionCanonical(body)) !== row.inputHash
    )
      fail();
    await invocation(db, row);
    return { row, command, definition };
  }
  async function requester(db: Db, row: Action): Promise<NpAgentAdminActorV1> {
    const original = await invocation(db, row);
    if (
      original.actorDeletedAt !== null ||
      original.staffUserId === null ||
      original.staffUserId !== original.requesterId
    )
      fail();
    if (original.authorityRef.kind !== "staff-session") fail();
    const [user] = await db
      .select({
        id: npUsers.id,
        email: npUsers.email,
        name: npUsers.name,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
      })
      .from(npUsers)
      .where(eq(npUsers.id, original.staffUserId))
      .limit(1);
    if (!user || user.tokenVersion !== original.authorityRef.userTokenVersion) fail();
    const value = { user, sessionId: original.authorityRef.sessionId };
    const auth = await actor(db, row.siteId, value);
    if (
      (await npDigestAgentStaffSiteAuthorizationCanonical(auth)) !==
      original.authorityRef.siteAuthorizationDigest
    )
      fail();
    return value;
  }
  async function approval(db: Db, row: Action, lock = false): Promise<CheckedApproval> {
    const query = db
      .select()
      .from(npAgentApprovals)
      .where(and(eq(npAgentApprovals.siteId, row.siteId), eq(npAgentApprovals.id, row.approvalId!)))
      .limit(1);
    const [entry] = lock ? await query.for("update") : await query;
    if (!entry) fail();
    const checked = await options.resolveApprovals().verify(entry);
    return { entry, statement: checked.statement };
  }
  async function statementMatches(
    db: Db,
    action: LoadedAction,
    statement: NpAgentApprovalStatementCanonicalV1,
    fresh: boolean,
  ): Promise<Facts | undefined> {
    const { row, command, definition } = action;
    const original = await invocation(db, row);
    if (
      statement.target.kind !== "action" ||
      statement.target.actionId !== row.id ||
      statement.target.runId !== null ||
      statement.target.agentId !== null ||
      statement.target.proposalHash !== row.inputHash ||
      statement.siteId !== row.siteId ||
      statement.approvalId !== row.approvalId ||
      statement.capabilityId !== row.capabilityId ||
      statement.capabilityContractVersion !== 1 ||
      statement.capabilityFingerprint !== definition.fingerprint ||
      statement.requester.kind !== "staff" ||
      statement.requester.userId !== original.requesterId ||
      statement.requester.fingerprint !== original.actorFingerprint ||
      !same(statement.requiredScopes, ["moderation:execute"]) ||
      !same(statement.requiredHumanCapabilities, ["admin.manage", "community.moderate"]) ||
      statement.requiredHumanPredicates.length ||
      statement.requiresLivePreview ||
      statement.previewId !== null ||
      statement.previewDigest !== null ||
      statement.risk !== "sensitive" ||
      statement.reauthentication.mode !== "recent" ||
      statement.reauthentication.maxAgeSeconds !== 300 ||
      statement.reauthentication.assurance !== "staff-primary"
    )
      fail();
    if (!fresh) return;
    const originalActor = await requester(db, row);
    const input = { siteId: row.siteId, actor: originalActor, incidentId: incidentIdOf(row) };
    const facts = await authorize(db, input);
    if (facts.memberId !== command.memberId) fail();
    {
      if (
        facts.incident.versionNumber !== command.expectedVersion ||
        facts.memberVersionDigest !== command.expectedMemberVersionDigest ||
        !same(statement.policyHashes, [facts.policy.policyDigest]) ||
        new Date(statement.expiresAt).getTime() >
          new Date(statement.createdAt).getTime() + facts.policy.approvalLifetimeSeconds * 1000
      )
        fail();
      await validOperation(db, action, facts);
    }
    return facts;
  }
  async function liveApprover(db: Db, row: Action, entry: Approval): Promise<void> {
    const original = await invocation(db, row);
    if (
      !entry.decidedByUserId ||
      entry.decidedByUserId === original.requesterId ||
      entry.decisionBody?.decision !== "approve"
    )
      fail();
    const current = await npResolveLiveAgentStaffAuthorizationV1(
      db,
      row.siteId,
      entry.decidedByUserId,
    );
    if (
      !current.authority.capabilities.includes("admin.manage") ||
      !current.authority.capabilities.includes("community.moderate")
    )
      fail();
    // The original signed decision is verified above; visibility is independently current.
    const originalActor = await requester(db, row);
    const readable = await options.reads.get(
      { incidentId: incidentIdOf(row) },
      { siteId: row.siteId, actor: originalActor, transaction: db },
    );
    const signals = await db
      .select({ signal: npAgentSignals })
      .from(npAgentSignals)
      .where(
        and(
          eq(npAgentSignals.siteId, row.siteId),
          eq(npAgentSignals.incidentId, readable.incident.id),
        ),
      )
      .orderBy(asc(npAgentSignals.id))
      .limit(101);
    const canonicalSignals = await Promise.all(
      signals.map(({ signal }) => npReadAgentIncidentSignalEvidenceV1(signal)),
    );
    // Approver item visibility is rechecked with the signed decision's current staff identity.
    if (
      !signals.length ||
      signals.length > 100 ||
      typeof options.memberEvidence.canReviewStaffUser !== "function" ||
      !(await options.memberEvidence.canReviewStaffUser({
        db,
        siteId: row.siteId,
        userId: entry.decidedByUserId,
        incident: readable.incident,
        signals: canonicalSignals,
      })) ||
      !(await options.canReviewIncidentAsStaffUser({
        db,
        siteId: row.siteId,
        userId: entry.decidedByUserId,
        incident: readable.incident,
        signals: canonicalSignals,
      }))
    )
      fail();
  }
  async function proof(db: Db, action: LoadedAction): Promise<NpAgentJsonObject> {
    const { row, command } = action;
    if (
      row.state !== "succeeded" ||
      row.verificationState !== "passed" ||
      !row.effectDigest ||
      row.verificationResultDigest !== row.effectDigest ||
      !row.verificationEvidence ||
      row.verificationEvidence.length !== 1 ||
      !row.verifiedAt ||
      !row.executionInvocationId ||
      !row.auditEventId ||
      !row.outputRedacted ||
      row.outputHash !== digest("np.agent-member-response-output.v1", row.outputRedacted)
    )
      fail();
    const evidence = row.verificationEvidence[0];
    if (
      evidence.schemaVersion !== "np.agent-member-response-effect.v1" ||
      evidence.actionId !== row.id ||
      evidence.incidentId !== incidentIdOf(row) ||
      evidence.memberId !== command.memberId ||
      evidence.capabilityId !== row.capabilityId ||
      evidence.executedAt !== row.verifiedAt.toISOString() ||
      row.effectDigest !== digest("np.agent-member-response-effect.v1", evidence) ||
      !same(row.outputRedacted, {
        actionId: row.id,
        state: "succeeded",
        resultDigest: row.effectDigest,
      })
    )
      fail();
    const [audit] = await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, row.siteId),
          eq(
            npAuditEvents.id,
            canonicalBodyUuid(evidence.auditEventId, "memberResponse.auditEventId"),
          ),
        ),
      )
      .limit(1);
    if (
      !audit ||
      audit.action !== "agent.member_response.effect" ||
      audit.targetType !== "member" ||
      audit.targetId !== command.memberId ||
      !same(audit.payload, evidence)
    )
      fail();
    const checkedApproval = await approval(db, row);
    if (checkedApproval.entry.state !== "consumed") fail();
    await statementMatches(db, action, checkedApproval.statement, false);
    return evidence;
  }
  async function ownBan(
    db: Db,
    siteId: string,
    incidentId: string,
    memberId: string,
    sourceActionId: string,
    banId: string,
    active = true,
  ): Promise<NpBanRow> {
    const source = await loadAction(db, siteId, sourceActionId);
    if (
      source.row.capabilityId !== "moderation.member.restrict" ||
      incidentIdOf(source.row) !== incidentId ||
      source.command.memberId !== memberId ||
      source.command.operation.kind !== "restrict"
    )
      fail();
    const evidence = await proof(db, source);
    const [raw] = await db
      .select()
      .from(npBans)
      .where(and(eq(npBans.siteId, siteId), eq(npBans.id, banId), eq(npBans.memberId, memberId)))
      .limit(1);
    if (!raw) fail();
    const ban = npRequireBanRow(raw);
    if (
      ban.scopeType !== "site" ||
      ban.scopeId !== null ||
      ban.kind !== "temporary" ||
      !ban.expiresAt ||
      (active && ban.expiresAt <= now()) ||
      !same(evidence.ban, banFacts(ban)) ||
      ban.reason !== `Agent Member response ${source.row.id}`
    )
      fail();
    return ban;
  }
  async function validOperation(
    db: Db,
    action: Pick<LoadedAction, "row" | "command">,
    facts: Facts,
  ): Promise<NpBanRow | null> {
    if (action.command.operation.kind === "restrict") {
      if (
        ["resolved", "dismissed"].includes(facts.incident.status) ||
        facts.member.status !== "active" ||
        facts.sourceFacts.some((source) => source.resolvedAt !== null) ||
        action.command.operation.durationSeconds > facts.policy.maximumDurationSeconds ||
        facts.restrictions.some(
          (ban) => ban.scopeType === "site" && (ban.expiresAt === null || ban.expiresAt > now()),
        )
      )
        fail();
      return null;
    }
    return ownBan(
      db,
      action.row.siteId,
      facts.incident.id,
      facts.memberId,
      action.command.operation.sourceActionId,
      action.command.operation.banId,
    );
  }
  async function timeline(
    db: Db,
    input: Input,
    row: Action,
    auditEventId: string,
    time: Date,
  ): Promise<void> {
    const [last] = await db
      .select({ sequence: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)` })
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.siteId, input.siteId),
          eq(npAgentIncidentTimeline.incidentId, input.incidentId),
        ),
      );
    await db.insert(npAgentIncidentTimeline).values({
      siteId: input.siteId,
      incidentId: input.incidentId,
      sequence: Number(last?.sequence ?? 0) + 1,
      kind: "action",
      sourceKind: "staff",
      sourceId: input.actor.user.id,
      sourceFingerprint: row.effectDigest!,
      actionId: row.id,
      approvalId: row.approvalId,
      auditEventId,
      summary:
        row.capabilityId === "moderation.member.restrict"
          ? "A human-approved temporary site Member restriction was verified."
          : "This workflow's human-approved Member restriction revocation was verified.",
      details: {
        schemaVersion: "np.agent-member-response-timeline.v1",
        actionId: row.id,
        capabilityId: row.capabilityId,
      },
      createdAt: time,
    });
  }
  async function withTarget<T>(
    siteId: string,
    target: NpAgentApprovalTargetV1,
    viewer: NpAgentAdminActorV1 | undefined,
    work: (db: Db, action: LoadedAction) => Promise<T>,
  ): Promise<T> {
    if (target.kind !== "action") fail();
    const seed = await loadAction(getDb(), siteId, target.actionId);
    const original = await invocation(getDb(), seed.row);
    if (original.authorityRef.kind !== "staff-session") fail();
    const initialApproval = await approval(getDb(), seed.row);
    return transaction(siteId, async (db) => {
      await lockPeople(db, siteId, [
        {
          userId: original.requesterId,
          sessionId:
            original.authorityRef.kind === "staff-session"
              ? original.authorityRef.sessionId
              : undefined,
        },
        ...(viewer ? [{ userId: viewer.user.id, sessionId: viewer.sessionId }] : []),
        ...(initialApproval.entry.decidedByUserId
          ? [{ userId: initialApproval.entry.decidedByUserId }]
          : []),
      ]);
      const requesterActor =
        viewer && ["succeeded", "failed"].includes(seed.row.state)
          ? viewer
          : await requester(db, seed.row);
      const input = { siteId, actor: requesterActor, incidentId: incidentIdOf(seed.row) };
      await authorize(db, input, true);
      if (viewer) await authorize(db, { ...input, actor: viewer });
      const action = await loadAction(db, siteId, target.actionId, true);
      if (
        target.runId !== null ||
        target.agentId !== null ||
        target.proposalHash !== action.row.inputHash ||
        !same(seed.row.inputCanonical, action.row.inputCanonical)
      )
        fail();
      return work(db, action);
    });
  }
  const approvalTargets: NpAgentApprovalServiceOptionsV1["targets"] = {
    visible: ({ siteId, target, actor: viewer }) =>
      withTarget(siteId, target, viewer, async (db, action) => {
        const checked = await approval(db, action.row);
        await statementMatches(
          db,
          action,
          checked.statement,
          ["approval_pending", "approved"].includes(action.row.state),
        );
        return {
          operationCount: 1,
          targetCount: 1,
          previewState: null,
          checksRun: null,
          rollbackPlan: "unavailable",
        };
      }),
    actionReview: ({ siteId, target, actor: viewer }) =>
      withTarget(siteId, target, viewer, async (db, action) => {
        const checked = await approval(db, action.row);
        await statementMatches(
          db,
          action,
          checked.statement,
          ["approval_pending", "approved"].includes(action.row.state),
        );
        return npRequireAgentApprovalMemberResponseActionReviewV1({
          actionId: action.row.id,
          proposalHash: action.row.inputHash,
          capabilityId: action.row.capabilityId,
          incidentId: incidentIdOf(action.row),
          memberId: action.command.memberId,
          expectedMemberVersionDigest: action.command.expectedMemberVersionDigest,
          operation: action.command.operation,
          policyDigest: checked.statement.policyHashes[0],
        });
      }),
    review: () =>
      Promise.reject(
        new NpAgentGatewayError(
          "APPROVAL_NOT_FOUND",
          404,
          "Member response has no content ChangeSet review.",
        ),
      ),
    withAuthority: ({ siteId, target, actor: viewer, decision, mutate }) =>
      withTarget(siteId, target, viewer, async (db, action) =>
        mutate(db, {
          verify: async (statement) => {
            if (
              decision === "approve" &&
              statement.requester.kind === "staff" &&
              statement.requester.userId === viewer.user.id
            )
              fail();
            if (!["approval_pending", "approved"].includes(action.row.state)) fail();
            await statementMatches(db, action, statement, true);
          },
          transition: async (state) => {
            const failed = state !== "approved";
            await db
              .update(npAgentActions)
              .set({
                state: failed ? "failed" : "approved",
                errorCode: failed
                  ? decision === "reject"
                    ? "APPROVAL_REJECTED"
                    : "APPROVAL_REVOKED"
                  : null,
                finishedAt: failed ? now() : null,
              })
              .where(eq(npAgentActions.id, action.row.id));
          },
        }),
      ),
    revalidate: ({ siteId, statement }) =>
      withTarget(siteId, statement.target, undefined, async (db, action) => {
        await statementMatches(db, action, statement, true);
        const checked = await approval(db, action.row, true);
        if (checked.entry.state === "approved") await liveApprover(db, action.row, checked.entry);
      }),
    expire: async ({ siteId, target, mutate }) => {
      if (target.kind !== "action") fail();
      return transaction(siteId, async (db) => {
        const action = await loadAction(db, siteId, target.actionId, true);
        return mutate(db, {
          verify: () => {
            if (action.row.inputHash !== target.proposalHash) fail();
            return Promise.resolve();
          },
          transition: async () => {
            const checked = await approval(db, action.row, true);
            if (!["expired", "revoked"].includes(checked.entry.state)) fail();
            await db
              .update(npAgentActions)
              .set({
                state: "failed",
                errorCode:
                  checked.entry.state === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_REVOKED",
                finishedAt: now(),
              })
              .where(
                and(
                  eq(npAgentActions.id, action.row.id),
                  inArray(npAgentActions.state, ["approval_pending", "approved"]),
                ),
              );
          },
        });
      });
    },
  };

  async function mutate(
    input: Input & {
      command: NpAgentMemberResponsePlanInputV1 | NpAgentMemberResponseExecuteInputV1;
    },
    mode: "plan" | "execute",
  ): Promise<{ resourceId: string; replayed: boolean }> {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodyUuid(input.incidentId, "memberResponse.incidentId");
    return transaction(input.siteId, async (db) => {
      let seededApproval: CheckedApproval | null = null;
      if (mode === "execute") {
        const command = npRequireAgentMemberResponseExecuteInputV1(input.command);
        const seeded = await loadAction(db, input.siteId, command.actionId);
        seededApproval = await approval(db, seeded.row);
      }
      await lockPeople(db, input.siteId, [
        { userId: input.actor.user.id, sessionId: input.actor.sessionId },
        ...(seededApproval?.entry.decidedByUserId
          ? [{ userId: seededApproval.entry.decidedByUserId }]
          : []),
      ]);
      const facts = await authorize(db, input, true);
      const result = await admission({
        db,
        siteId: input.siteId,
        actor: input.actor,
        operationId:
          mode === "plan"
            ? "agents.incidents.member_response_plan"
            : "agents.incidents.member_response_execute",
        targetId: input.incidentId,
        command: input.command,
        mutate: async ({
          db,
          command: admitted,
          invocationId,
          now: time,
        }): Promise<{ resourceId: string; output: NpAgentJsonObject }> => {
          if (admitted.expectedVersion !== facts.incident.versionNumber) fail();
          const [invoked] = await db
            .select()
            .from(npAgentInvocations)
            .where(eq(npAgentInvocations.id, invocationId));
          if (!invoked || !invoked.auditEventId) fail();
          if (mode === "plan") {
            const command = npRequireAgentMemberResponsePlanInputV1(admitted);
            if (
              command.memberId !== facts.memberId ||
              command.expectedMemberVersionDigest !== facts.memberVersionDigest
            )
              fail();
            const id = randomUUID();
            const definition = await npMemberResponseCapabilityDefinitionV1(capability(command));
            const targetRefs = targets(input.incidentId, command.memberId);
            const body = npRequireAgentActionCanonical({
              schemaVersion: "np.agent-action.v1",
              siteId: input.siteId,
              actionId: id,
              invocationFingerprint: invoked.requestHash,
              runFingerprint: null,
              sequence: 1,
              capabilityId: capability(command),
              capabilityContractVersion: 1,
              capabilityFingerprint: definition.fingerprint,
              effectProfile: { id: definition.profile, contractVersion: 1 },
              risk: "sensitive",
              requiredScopes: ["moderation:execute"],
              targetRefs,
              targetVersionFacts: targetRefs.map((targetRef) => ({
                targetRef: structuredClone(targetRef),
                versionDigest: command.expectedMemberVersionDigest,
              })),
              input: json(command),
            });
            const hash = await npDigestAgentActionCanonical(body);
            const approvalId = randomUUID();
            const [row] = await db
              .insert(npAgentActions)
              .values({
                id,
                siteId: input.siteId,
                invocationId,
                invocationFingerprint: invoked.requestHash,
                sequence: 1,
                capabilityId: capability(command),
                capabilityContractVersion: 1,
                capabilityFingerprint: definition.fingerprint,
                capabilityDefinitionBody: definition.canonical,
                effectProfileId: definition.profile,
                effectContractVersion: 1,
                risk: "sensitive",
                state: "approval_pending",
                idempotencyKey: command.idempotencyKey,
                inputRedacted: json(command),
                inputCanonical: json(command),
                requiredScopes: ["moderation:execute"],
                targetRefs: body.targetRefs,
                targetVersionFacts: body.targetVersionFacts,
                inputHash: hash,
                approvalId,
                auditEventId: invoked.auditEventId,
                createdAt: time,
                compensatesActionId:
                  command.operation.kind === "revoke" ? command.operation.sourceActionId : null,
              })
              .returning();
            if (!row) fail();
            await validOperation(db, { row, command }, facts);
            await options.resolveApprovals().create({
              db,
              generation: 1,
              statement: {
                version: "np.agent-approval-statement.v1",
                siteId: input.siteId,
                approvalId,
                requester: {
                  kind: "staff",
                  userId: input.actor.user.id,
                  fingerprint: invoked.actorFingerprint,
                },
                target: {
                  kind: "action",
                  actionId: id,
                  runId: null,
                  agentId: null,
                  proposalHash: hash,
                },
                capabilityId: capability(command),
                capabilityContractVersion: 1,
                capabilityFingerprint: definition.fingerprint,
                requiredScopes: ["moderation:execute"],
                requiredHumanCapabilities: ["admin.manage", "community.moderate"],
                requiredHumanPredicates: [],
                policyHashes: [facts.policy.policyDigest],
                requiresLivePreview: false,
                previewId: null,
                previewDigest: null,
                risk: "sensitive",
                reauthentication: {
                  mode: "recent",
                  maxAgeSeconds: 300,
                  assurance: "staff-primary",
                },
                createdAt: time.toISOString(),
                expiresAt: new Date(
                  time.getTime() + facts.policy.approvalLifetimeSeconds * 1000,
                ).toISOString(),
              },
            });
            return { resourceId: id, output: { actionId: id, approvalId, proposalHash: hash } };
          }
          const command = npRequireAgentMemberResponseExecuteInputV1(admitted);
          const action = await loadAction(db, input.siteId, command.actionId, true);
          const original = await invocation(db, action.row);
          if (
            incidentIdOf(action.row) !== input.incidentId ||
            action.row.state !== "approved" ||
            action.row.executionInvocationId ||
            action.row.approvalId !== command.approvalId ||
            action.row.inputHash !== command.proposalHash ||
            original.staffUserId !== input.actor.user.id ||
            original.authorityRef.kind !== "staff-session" ||
            original.authorityRef.sessionId !== input.actor.sessionId ||
            original.authorizationContextFingerprint !== invoked.authorizationContextFingerprint
          )
            fail();
          const checked = await approval(db, action.row, true);
          if (checked.entry.state !== "approved" || checked.entry.expiresAt <= time) fail();
          await statementMatches(db, action, checked.statement, true);
          await liveApprover(db, action.row, checked.entry);
          const existing = await validOperation(db, action, facts);
          await options.resolveApprovals().consumeAction({
            db,
            siteId: input.siteId,
            id: checked.entry.id,
            actionId: action.row.id,
            proposalHash: action.row.inputHash,
            statementHash: checked.entry.statementHash,
            consumedAt: time,
          });
          let ban: NpBanRow;
          if (action.command.operation.kind === "restrict") {
            ban = await npIssueBanInTransactionV1({
              db,
              siteId: input.siteId,
              actor: { kind: "staff", user: input.actor.user },
              memberId: facts.memberId,
              scopeType: "site",
              scopeId: null,
              kind: "temporary",
              expiresAt: new Date(time.getTime() + action.command.operation.durationSeconds * 1000),
              reason: `Agent Member response ${action.row.id}`,
              now: time,
            });
            const [installed] = await db
              .select()
              .from(npBans)
              .where(and(eq(npBans.siteId, input.siteId), eq(npBans.id, ban.id)))
              .limit(1);
            if (!installed || !same(banFacts(npRequireBanRow(installed)), banFacts(ban))) fail();
          } else {
            if (!existing) fail();
            ban = await npRevokeBanInTransactionV1({
              db,
              siteId: input.siteId,
              banId: existing.id,
              expected: existing,
            });
            const [remaining] = await db
              .select({ id: npBans.id })
              .from(npBans)
              .where(eq(npBans.id, ban.id))
              .limit(1);
            if (remaining) fail();
          }
          const auditId = randomUUID();
          const evidence = {
            schemaVersion: "np.agent-member-response-effect.v1",
            actionId: action.row.id,
            sourceActionId:
              action.command.operation.kind === "revoke"
                ? action.command.operation.sourceActionId
                : action.row.id,
            incidentId: input.incidentId,
            memberId: facts.memberId,
            capabilityId: action.row.capabilityId,
            ban: banFacts(ban),
            auditEventId: auditId,
            executedAt: time.toISOString(),
          };
          const effectDigest = digest("np.agent-member-response-effect.v1", evidence);
          const output = {
            actionId: action.row.id,
            state: "succeeded",
            resultDigest: effectDigest,
          };
          await db.insert(npAuditEvents).values({
            id: auditId,
            siteId: input.siteId,
            actorKind: "staff",
            actorUserId: input.actor.user.id,
            action: "agent.member_response.effect",
            targetType: "member",
            targetId: facts.memberId,
            payload: evidence,
            createdAt: time,
          });
          const [completed] = await db
            .update(npAgentActions)
            .set({
              state: "succeeded",
              executionInvocationId: invocationId,
              executionInvocationFingerprint: invoked.requestHash,
              outputRedacted: output,
              outputHash: digest("np.agent-member-response-output.v1", output),
              effectDigest,
              targetVersionDigest: digest("np.agent-member-response-ban.v1", banFacts(ban)),
              verifierId: action.definition.verifierId,
              verificationState: "passed",
              verificationResultDigest: effectDigest,
              verificationEvidence: [evidence],
              verifiedAt: time,
              startedAt: time,
              finishedAt: time,
            })
            .where(and(eq(npAgentActions.id, action.row.id), eq(npAgentActions.state, "approved")))
            .returning();
          if (!completed) fail();
          await timeline(db, input, completed, auditId, time);
          await actor(db, input.siteId, input.actor);
          await liveApprover(db, completed, checked.entry);
          if (!same(facts.policy, await policy(db, input, facts.memberId))) fail();
          return { resourceId: action.row.id, output };
        },
      });
      const action = await loadAction(db, input.siteId, result.resourceId);
      const original = await invocation(db, action.row);
      if (
        incidentIdOf(action.row) !== input.incidentId ||
        original.staffUserId !== input.actor.user.id ||
        original.authorityRef.kind !== "staff-session" ||
        original.authorityRef.sessionId !== input.actor.sessionId
      )
        fail();
      if (result.replayed && mode === "execute") await proof(db, action);
      await authorize(db, input);
      return { resourceId: result.resourceId, replayed: result.replayed };
    });
  }
  return {
    approvalTargets,
    plan: (input) =>
      mutate({ ...input, command: npRequireAgentMemberResponsePlanInputV1(input.command) }, "plan"),
    execute: (input) =>
      mutate(
        { ...input, command: npRequireAgentMemberResponseExecuteInputV1(input.command) },
        "execute",
      ),
    async get(input) {
      return withCurrentSite(input.siteId, async () => {
        const db = getDb();
        const facts = await authorize(db, input);
        const rows = await db
          .select()
          .from(npAgentActions)
          .where(
            and(
              eq(npAgentActions.siteId, input.siteId),
              inArray(npAgentActions.capabilityId, [
                "moderation.member.restrict",
                "moderation.member.revoke",
              ]),
              sql`${npAgentActions.targetRefs} @> ${JSON.stringify([{ kind: "incident", incidentId: input.incidentId }])}::jsonb`,
            ),
          )
          .orderBy(desc(npAgentActions.createdAt), desc(npAgentActions.id))
          .limit(26);
        const plans: NpAgentMemberResponseV1["plans"] = [];
        const revocable: NpAgentMemberResponseV1["revocable"] = [];
        for (const row of rows.slice(0, 25)) {
          const action = await loadAction(db, input.siteId, row.id);
          if (action.command.memberId !== facts.memberId) fail();
          const checked = await approval(db, row);
          await statementMatches(db, action, checked.statement, false);
          let canExecute = false;
          if (
            row.state === "approved" &&
            checked.entry.state === "approved" &&
            checked.entry.expiresAt > now()
          ) {
            try {
              await statementMatches(db, action, checked.statement, true);
              await liveApprover(db, row, checked.entry);
              const original = await invocation(db, row);
              canExecute =
                original.staffUserId === input.actor.user.id &&
                original.authorityRef.kind === "staff-session" &&
                original.authorityRef.sessionId === input.actor.sessionId;
            } catch {
              /* Drift removes execution authority; historical plan metadata remains readable. */
            }
          }
          if (!["approval_pending", "approved", "succeeded", "failed"].includes(row.state)) fail();
          plans.push({
            actionId: row.id,
            approvalId: row.approvalId!,
            proposalHash: row.inputHash,
            capabilityId: capability(action.command),
            operation: action.command.operation,
            state: row.state as NpAgentMemberResponseV1["plans"][number]["state"],
            approvalExpiresAt: checked.entry.expiresAt.toISOString(),
            canExecute,
          });
          if (row.capabilityId === "moderation.member.restrict" && row.state === "succeeded") {
            const evidence = await proof(db, action);
            const ban = evidence.ban;
            if (
              ban &&
              typeof ban === "object" &&
              !Array.isArray(ban) &&
              typeof ban.id === "string"
            ) {
              try {
                const current = await ownBan(
                  db,
                  input.siteId,
                  input.incidentId,
                  facts.memberId,
                  row.id,
                  ban.id,
                );
                revocable.push({
                  sourceActionId: row.id,
                  banId: current.id,
                  expiresAt: current.expiresAt!.toISOString(),
                });
              } catch {
                /* Expired, changed or manually removed restrictions are never revocation choices. */
              }
            }
          }
        }
        const current = await authorize(db, input);
        if (
          !same(
            { incident: facts.incident, digest: facts.memberVersionDigest, policy: facts.policy },
            {
              incident: current.incident,
              digest: current.memberVersionDigest,
              policy: current.policy,
            },
          )
        )
          fail();
        return npRequireAgentMemberResponseV1({
          schemaVersion: "np.agent-member-response.v1",
          incidentId: input.incidentId,
          incidentVersion: facts.incident.versionNumber,
          memberId: facts.memberId,
          memberVersionDigest: facts.memberVersionDigest,
          maximumDurationSeconds: facts.policy.maximumDurationSeconds,
          canRestrict:
            !["resolved", "dismissed"].includes(facts.incident.status) &&
            facts.member.status === "active" &&
            facts.sourceFacts.every((source) => source.resolvedAt === null) &&
            !facts.restrictions.some(
              (ban) =>
                ban.scopeType === "site" && (ban.expiresAt === null || ban.expiresAt > now()),
            ),
          revocable,
          plans,
          truncated: rows.length > 25,
        });
      });
    },
  };
}
