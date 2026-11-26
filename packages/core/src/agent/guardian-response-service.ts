import {
  npIsAgentAutomaticGuardianLimitAuthorityV1,
  npIsAgentAutomaticGuardianLimitAuthorizationV1,
  type NpAgentAutomaticGuardianLimitAuthorityV1,
} from "./automatic-guardian-limit-service.js";
import type { NpAgentAutomaticGuardianLimitAuthorizationV1 } from "../agent-contract/automatic-guardian-limit-contract.js";
import type {
  NpAgentCapabilityAuthenticationV1,
  NpAgentCapabilityAdmissionServiceV1,
} from "./capability-admission.js";
import type { NpAgentGatewayServiceV1 } from "./gateway-service.js";
import type { NpAgentResolvedGatewayPrincipalV1 } from "./capability-registry.js";
import {
  npReadAgentGuardianCaptureAdmissionV1,
  npRequireAgentGuardianNewResponseV1,
  npAgentGuardianResponsePolicyDigestV1,
} from "./guardian-capture-admission.js";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { getDb as GetDb } from "../db/runtime.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentSignals,
  npAgentActorRestrictions,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSessions, npSiteMemberships, npUsers } from "../db/schema/system.js";
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
import {
  npRequireAgentGuardianResponsePlanInputV1,
  npRequireAgentGuardianAutomaticResponseInputV1,
  npRequireAgentGuardianAutomaticResponseActionV1,
  type NpAgentGuardianAutomaticResponseInputV1,
  type NpAgentGuardianAutomaticResponseActionV1,
  npRequireAgentGuardianResponseExecuteInputV1,
  npRequireAgentGuardianResponseV1,
  npRequireAgentApprovalGuardianResponseActionReviewV1,
  type NpAgentGuardianResponsePlanInputV1,
  type NpAgentGuardianResponseExecuteInputV1,
  type NpAgentGuardianResponseV1,
  type NpAgentGuardianResponseCapabilityIdV1,
} from "../agent-contract/guardian-response-contract.js";
import type {
  NpAgentApprovalStatementCanonicalV1,
  NpAgentApprovalTargetV1,
  NpAgentJsonObject,
  NpAgentTargetRef,
  NpAgentInvocationAuthorityRefV1,
  NpAgentSignalEvidenceCanonicalV1,
  NpAgentStaffSiteAuthorizationCanonicalV1,
  NpAgentRestrictionOpaqueActorBucketSubjectV1,
  NpAgentActorRestrictionScope,
  NpAgentRestrictionCanonicalV1,
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
  type NpAgentIncidentServiceV1,
} from "./incident-service.js";
import type {
  NpAgentApprovalServiceV1,
  NpAgentApprovalServiceOptionsV1,
} from "./approval-service.js";
import { npReadAgentActiveRestrictionProjectionRefsV1 } from "./guardian-restriction-adapter.js";
import { npReadAgentGuardianIncidentEvidenceV1 } from "./guardian-observation-service.js";
import {
  npRequireAgentRestrictionCanonical,
  npDigestAgentRestrictionCanonical,
} from "../agent-contract/canonical-restriction.js";
import {
  npRequireAgentRestrictionMutationResultV1,
  npRequireAgentRestrictionVerifyResultV1,
  npRequireAgentRestrictionHealthV1,
  npAgentRestrictionSubjectKeyV1,
  type NpAgentRestrictionAdapter,
} from "../agent-contract/restriction-adapter-contract.js";
import {
  npGuardianResponseCapabilityDefinitionV1,
  npGuardianAutomaticResponseCapabilityDefinitionV1,
  NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1,
  type NpGuardianResponseCapabilityDefinitionV1,
} from "./guardian-response-capability.js";
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
type Restriction = typeof npAgentActorRestrictions.$inferSelect;
interface Facts {
  incident: NpAgentIncidentV1;
  subject: NpAgentRestrictionOpaqueActorBucketSubjectV1;
  restrictions: Restriction[];
  targetVersionDigest: string;
  allowedScopes: NpAgentActorRestrictionScope[];
  policy: NpAgentGuardianResponsePolicyV1;
}
type LoadedAction =
  | {
      authorityKind: "human";
      row: Action;
      command: NpAgentGuardianResponsePlanInputV1;
      definition: NpGuardianResponseCapabilityDefinitionV1;
    }
  | {
      authorityKind: "deployment";
      row: Action;
      command: NpAgentGuardianResponsePlanInputV1;
      definition: NpGuardianResponseCapabilityDefinitionV1;
      automatic: NpAgentGuardianAutomaticResponseActionV1;
    };
interface CheckedApproval {
  entry: Approval;
  statement: NpAgentApprovalStatementCanonicalV1;
}
export interface NpAgentGuardianResponsePolicyV1 {
  policyDigest: string;
  maximumDurationSeconds: number;
  approvalLifetimeSeconds: number;
  allowedScopes: NpAgentActorRestrictionScope[];
}
export interface NpAgentGuardianResponseServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  /** Exact adapter must be installed in the request enforcement entrypoint too. */
  adapter: NpAgentRestrictionAdapter;
  /** Resolve retained frozen adapter implementations for cleanup after rotation. */
  resolveAdapter?(input: {
    id: string;
    contractVersion: number;
    fingerprint: string;
  }): NpAgentRestrictionAdapter | null;
  canEnforceSubject(input: {
    db: Db;
    siteId: string;
    subject: NpAgentRestrictionOpaqueActorBucketSubjectV1;
    actionScopes: readonly NpAgentActorRestrictionScope[];
  }): Promise<boolean>;
  resolveApprovals(): NpAgentApprovalServiceV1;
  /** A live host decision, never an inferred production allowance. Null disables the workflow. */
  resolvePolicy(
    input: Input & { db: Db; subject: NpAgentRestrictionOpaqueActorBucketSubjectV1 },
  ): Promise<NpAgentGuardianResponsePolicyV1 | null>;
  /** Reuse the same current per-user Incident ACL as reads; signed Approval owns its historical session proof. */
  canReviewIncidentAsStaffUser(input: {
    db: Db;
    siteId: string;
    userId: string;
    incident: NpAgentIncidentV1;
    signals: readonly NpAgentSignalEvidenceCanonicalV1[];
  }): boolean | Promise<boolean>;
  /** Explicit private policy path. Absence preserves the human-only workflow. */
  automatic?: {
    authority: NpAgentAutomaticGuardianLimitAuthorityV1;
    admission: Pick<
      NpAgentCapabilityAdmissionServiceV1,
      "withCurrentAuthority" | "withStoredAuthority"
    >;
    incidents: Pick<NpAgentIncidentServiceV1, "get">;
    resolveTransportAudience: NpAgentGatewayServiceV1["getTransportAudience"];
  };
  admission?: NpAgentAdminAdmissionOptionsV1;
  now?: () => Date;
}
export interface NpAgentGuardianResponseServiceV1 {
  automatic: {
    /** Installed host path only; current qualification is checked for every new effect. */
    readonly installed: boolean;
    limit(
      input: NpAgentGuardianAutomaticResponseInputV1 & {
        authentication: NpAgentCapabilityAuthenticationV1;
      },
    ): Promise<{ resourceId: string; replayed: boolean }>;
  };
  get(input: Input): Promise<NpAgentGuardianResponseV1>;
  plan(
    input: Input & { command: NpAgentGuardianResponsePlanInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  execute(
    input: Input & { command: NpAgentGuardianResponseExecuteInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  reconcile(input: {
    siteId: string;
    limit?: number;
  }): Promise<{ checked: number; resolved: number }>;
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
    "GUARDIAN_RESPONSE_CONFLICT",
    409,
    "Guardian response evidence changed. Review the current Incident and prepare a new plan.",
  );
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_RESPONSE_UNAVAILABLE",
    503,
    "The current-site Guardian response policy and service must be installed explicitly.",
  );
}
function capability(
  command: NpAgentGuardianResponsePlanInputV1,
): NpAgentGuardianResponseCapabilityIdV1 {
  return command.operation.kind === "limit" ? "security.limitActor" : "security.removeActorLimit";
}
function targets(incidentId: string): NpAgentTargetRef[] {
  return [{ kind: "incident", incidentId }];
}

export function createAgentGuardianResponseServiceV1(
  options: NpAgentGuardianResponseServiceOptionsV1,
): NpAgentGuardianResponseServiceV1 {
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
    if (!auth.authority.capabilities.includes("admin.manage")) fail();
    return auth;
  }
  async function policy(
    db: Db,
    input: Input,
    subject: NpAgentRestrictionOpaqueActorBucketSubjectV1,
  ): Promise<NpAgentGuardianResponsePolicyV1> {
    if (typeof options.resolvePolicy !== "function") unavailable();
    const result = await options.resolvePolicy({ ...input, db, subject });
    if (!result) unavailable();
    canonicalBodySha256Digest(result.policyDigest, "guardianResponse.policyDigest");
    canonicalBodyInteger(
      result.maximumDurationSeconds,
      "guardianResponse.maximumDurationSeconds",
      60,
      3600,
    );
    canonicalBodyInteger(
      result.approvalLifetimeSeconds,
      "guardianResponse.approvalLifetimeSeconds",
      1,
      900,
    );
    if (
      !Array.isArray(result.allowedScopes) ||
      result.allowedScopes.length > 5 ||
      result.allowedScopes.some(
        (scope) =>
          ![
            "auth.staff",
            "auth.member",
            "agent.gateway",
            "community.write",
            "content.write",
          ].includes(scope),
      ) ||
      !same(result.allowedScopes, [...new Set(result.allowedScopes)].sort())
    )
      unavailable();
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
  async function authorize(
    db: Db,
    input: Input,
    lock = false,
    checkpoint?: () => void,
  ): Promise<Facts> {
    checkpoint?.();
    if (
      typeof options.canReviewIncidentAsStaffUser !== "function" ||
      typeof options.canEnforceSubject !== "function"
    )
      unavailable();
    await actor(db, input.siteId, input.actor);
    const incident = (
      await options.reads.get({ incidentId: input.incidentId }, { ...input, transaction: db })
    ).incident;
    checkpoint?.();
    if (
      incident.siteId !== input.siteId ||
      !["authentication", "traffic"].includes(incident.category) ||
      incident.primarySubject?.kind !== "actor-bucket" ||
      incident.primarySubject.purpose !== "network-address"
    )
      fail();
    if (lock) {
      const [stored] = await db
        .select({ version: npAgentIncidents.versionNumber })
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, incident.id)))
        .for("update");
      if (!stored || stored.version !== incident.versionNumber) fail();
    }
    const evidence = await npReadAgentGuardianIncidentEvidenceV1({
      db,
      siteId: input.siteId,
      incident,
    });
    if (!evidence.length) fail();
    const { kind: _kind, ...bucket } = incident.primarySubject;
    const subject: NpAgentRestrictionOpaqueActorBucketSubjectV1 = {
      kind: "opaque_actor_bucket",
      ...bucket,
    };
    const currentPolicy = await policy(db, input, subject);
    checkpoint?.();
    const sourceScopes = new Set<NpAgentActorRestrictionScope>();
    for (const item of evidence) {
      if (item.detectorId === "guardian.login-failures")
        sourceScopes.add(item.audience === "staff" ? "auth.staff" : "auth.member");
      else if (item.routeFamily === "mcp") sourceScopes.add("agent.gateway");
      else if (item.routeFamily === "collections") sourceScopes.add("content.write");
      else if (item.routeFamily === "community-events") sourceScopes.add("community.write");
      else if (item.routeFamily === "staff-auth") sourceScopes.add("auth.staff");
    }
    const allowedScopes = currentPolicy.allowedScopes.filter((scope) => sourceScopes.has(scope));
    const restrictions = await db
      .select()
      .from(npAgentActorRestrictions)
      .where(
        and(
          eq(npAgentActorRestrictions.siteId, input.siteId),
          eq(npAgentActorRestrictions.incidentId, incident.id),
        ),
      )
      .orderBy(desc(npAgentActorRestrictions.createdAt), desc(npAgentActorRestrictions.id))
      .limit(26);
    const targetVersionDigest = digest("np.agent-guardian-response-target.v1", {
      siteId: input.siteId,
      incidentId: incident.id,
      subject,
      policy: currentPolicy,
      allowedScopes,
      adapter: {
        id: options.adapter.id,
        contractVersion: options.adapter.contractVersion,
        fingerprint: options.adapter.fingerprint,
      },
    });
    return {
      incident,
      subject,
      restrictions,
      targetVersionDigest,
      allowedScopes,
      policy: currentPolicy,
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
      original.operationId !== "agents.incidents.guardian_response_plan" ||
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
  function automaticSummary(envelope: NpAgentGuardianAutomaticResponseActionV1): NpAgentJsonObject {
    return {
      schemaVersion: "np.agent-guardian-automatic-response-summary.v1",
      incidentId: envelope.request.incidentId,
      ruleKind: envelope.authorization.ruleKind,
      sourceBaselineSeverity: "medium",
      staffEscalated: true,
      durationSeconds:
        envelope.command.operation.kind === "limit"
          ? envelope.command.operation.durationSeconds
          : 0,
      actionScopes: [...envelope.authorization.actionScopes],
    };
  }
  function automaticTargetDigest(
    authorization: NpAgentAutomaticGuardianLimitAuthorizationV1,
    controlPolicyDigest: string,
    adapter: { id: string; contractVersion: number; fingerprint: string },
  ): string {
    return digest("np.agent-guardian-automatic-response-target.v1", {
      authorization,
      controlPolicyDigest,
      adapter: {
        id: adapter.id,
        contractVersion: adapter.contractVersion,
        fingerprint: adapter.fingerprint,
      },
    });
  }
  async function automaticInvocation(
    db: Db,
    row: Action,
  ): Promise<{ original: Invocation; envelope: NpAgentGuardianAutomaticResponseActionV1 }> {
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
      original.actorKind !== "principal" ||
      original.operationKind !== "capability" ||
      original.operationId !== "security.limitActor" ||
      original.requestHash !== row.invocationFingerprint ||
      original.state !== "completed" ||
      original.resultKind !== "action" ||
      original.resultId !== row.id ||
      !original.outputRedacted ||
      !original.auditEventId
    )
      fail();
    const body = npRequireAgentInvocationRequestCanonical(original.requestBody),
      auth = npRequireAgentAuthorizationContextCanonical(original.authorizationContextBody);
    const envelope = npRequireAgentGuardianAutomaticResponseActionV1(body.input),
      request = npRequireAgentGuardianAutomaticResponseInputV1(row.inputCanonical);
    const definition = await npGuardianAutomaticResponseCapabilityDefinitionV1();
    if (
      (await npDigestAgentInvocationRequestCanonical(body)) !== original.requestHash ||
      (await npDigestAgentAuthorizationContextCanonical(auth)) !==
        original.authorizationContextFingerprint ||
      auth.siteId !== row.siteId ||
      auth.actor.kind !== "principal" ||
      auth.actor.principalId !== original.principalId ||
      auth.actor.principalId !== envelope.authorization.principalId ||
      auth.actor.actorFingerprint !== original.actorFingerprint ||
      !["service-family", "oauth-grant"].includes(auth.authorityRef.kind) ||
      !same(auth.authorityRef, original.authorityRef) ||
      auth.transport !== original.transport ||
      body.actorKind !== "principal" ||
      body.actorFingerprint !== original.actorFingerprint ||
      body.authorizationContextFingerprint !== original.authorizationContextFingerprint ||
      body.operationKind !== "capability" ||
      body.operationId !== "security.limitActor" ||
      body.contractVersion !== 1 ||
      body.contractFingerprint !== definition.fingerprint ||
      !same(body.effectProfile, { id: definition.profile, contractVersion: 1 }) ||
      original.contractVersion !== 1 ||
      original.effectContractVersion !== 1 ||
      original.contractFingerprint !== definition.fingerprint ||
      original.effectProfileId !== definition.profile ||
      !same(original.capabilityDefinitionBody, definition.canonical) ||
      !same(request, envelope.request) ||
      envelope.authorization.siteId !== row.siteId ||
      request.incidentId !== incidentIdOf(row) ||
      row.startedAt?.toISOString() !== envelope.authorization.authorizedAt ||
      original.requestedAt.toISOString() !== envelope.authorization.authorizedAt ||
      original.completedAt?.toISOString() !== envelope.authorization.authorizedAt ||
      original.idempotencyKey !== `guardian-auto:${request.idempotencyKey}` ||
      original.outputRedacted.actionId !== row.id ||
      original.outputRedacted.state !== "executing" ||
      original.outputHash !==
        digest("np.agent-guardian-automatic-stage.v1", original.outputRedacted) ||
      row.executionInvocationId !== original.id ||
      row.executionInvocationFingerprint !== original.requestHash ||
      !same(row.inputRedacted, automaticSummary(envelope))
    )
      fail();
    const [audit] = await db
      .select()
      .from(npAuditEvents)
      .where(and(eq(npAuditEvents.siteId, row.siteId), eq(npAuditEvents.id, original.auditEventId)))
      .limit(1);
    if (
      !audit ||
      audit.actorKind !== "agent-principal" ||
      audit.action !== "agents.guardian_response.automatic_limit" ||
      audit.targetType !== "agent-incident" ||
      audit.targetId !== request.incidentId ||
      audit.createdAt.getTime() !== original.requestedAt.getTime() ||
      !same(audit.payload, {
        schemaVersion: "np.agent-guardian-automatic-response-audit.v1",
        invocationId: original.id,
        actionId: row.id,
        requestHash: original.requestHash,
        authorizationDigest: digest(
          "np.agent-guardian-automatic-authorization.v1",
          envelope.authorization,
        ),
        controlPolicyDigest: envelope.controlPolicyDigest,
      })
    )
      fail();
    return { original, envelope };
  }
  async function loadAutomaticAction(db: Db, row: Action): Promise<LoadedAction> {
    if (
      row.capabilityId !== "security.limitActor" ||
      row.approvalId !== null ||
      row.runId !== null ||
      row.runFingerprint !== null ||
      row.containmentId !== null ||
      !row.enforcementAdapterId ||
      !row.enforcementAdapterContractVersion ||
      !row.enforcementAdapterFingerprint ||
      !["executing", "succeeded", "failed", "compensated"].includes(row.state)
    )
      fail();
    const { original, envelope } = await automaticInvocation(db, row),
      definition = await npGuardianAutomaticResponseCapabilityDefinitionV1();
    const adapter = {
      id: row.enforcementAdapterId,
      contractVersion: row.enforcementAdapterContractVersion,
      fingerprint: row.enforcementAdapterFingerprint,
    };
    if (
      envelope.command.expectedTargetVersionDigest !==
      automaticTargetDigest(envelope.authorization, envelope.controlPolicyDigest, adapter)
    )
      fail();
    const targetRefs = targets(envelope.request.incidentId);
    const body = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: row.siteId,
      actionId: row.id,
      invocationFingerprint: original.requestHash,
      runFingerprint: null,
      sequence: 1,
      capabilityId: "security.limitActor",
      capabilityContractVersion: 1,
      capabilityFingerprint: definition.fingerprint,
      effectProfile: { id: definition.profile, contractVersion: 1 },
      risk: "reversible",
      requiredScopes: ["security:execute"],
      targetRefs,
      targetVersionFacts: targetRefs.map((targetRef) => ({
        targetRef: structuredClone(targetRef),
        versionDigest: envelope.command.expectedTargetVersionDigest,
      })),
      input: json(envelope.request),
    });
    if (
      row.capabilityContractVersion !== 1 ||
      row.capabilityFingerprint !== definition.fingerprint ||
      !same(row.capabilityDefinitionBody, definition.canonical) ||
      row.effectProfileId !== definition.profile ||
      row.effectContractVersion !== 1 ||
      row.risk !== "reversible" ||
      row.sequence !== 1 ||
      !same(row.requiredScopes, body.requiredScopes) ||
      !same(row.targetRefs, body.targetRefs) ||
      !same(row.targetVersionFacts, body.targetVersionFacts) ||
      row.auditEventId !== original.auditEventId ||
      (await npDigestAgentActionCanonical(body)) !== row.inputHash
    )
      fail();
    return {
      authorityKind: "deployment",
      row,
      command: envelope.command,
      definition,
      automatic: envelope,
    };
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
    if (row?.effectProfileId === NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1)
      return loadAutomaticAction(db, row);
    if (
      !row ||
      !["security.limitActor", "security.removeActorLimit"].includes(row.capabilityId) ||
      !row.approvalId ||
      row.runId ||
      row.runFingerprint ||
      row.containmentId ||
      !row.enforcementAdapterId ||
      !row.enforcementAdapterContractVersion ||
      !row.enforcementAdapterFingerprint
    )
      fail();
    const command = npRequireAgentGuardianResponsePlanInputV1(row.inputCanonical);
    const definition = await npGuardianResponseCapabilityDefinitionV1(capability(command));
    const targetRefs = targets(incidentIdOf(row));
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
      requiredScopes: ["security:execute"],
      targetRefs,
      targetVersionFacts: targetRefs.map((targetRef) => ({
        targetRef: structuredClone(targetRef),
        versionDigest: command.expectedTargetVersionDigest,
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
    return { authorityKind: "human", row, command, definition };
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
      !same(statement.requiredScopes, ["security:execute"]) ||
      !same(statement.requiredHumanCapabilities, ["admin.manage"]) ||
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
    {
      if (
        facts.incident.versionNumber !== command.expectedVersion ||
        facts.targetVersionDigest !== command.expectedTargetVersionDigest ||
        !same(statement.policyHashes, [
          command.operation.kind === "limit"
            ? await npAgentGuardianResponsePolicyDigestV1(db, row.siteId, facts.policy.policyDigest)
            : facts.policy.policyDigest,
        ]) ||
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
    if (!current.authority.capabilities.includes("admin.manage")) fail();
    // The original signed decision is verified above; visibility is independently current.
    const originalActor = await requester(db, row);
    const readable = await options.reads.get(
      { incidentId: incidentIdOf(row) },
      { siteId: row.siteId, actor: originalActor, transaction: db },
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
          eq(npAgentSignals.siteId, row.siteId),
          eq(npAgentIncidentSignals.incidentId, readable.incident.id),
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
      !same(
        signals.map(({ signal }) => signal.id),
        readable.incident.signalIds,
      ) ||
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
  async function ownRestriction(
    db: Db,
    siteId: string,
    incidentId: string,
    sourceActionId: string,
    restrictionId: string,
  ): Promise<Restriction> {
    const source = await loadAction(db, siteId, sourceActionId);
    if (
      source.row.capabilityId !== "security.limitActor" ||
      incidentIdOf(source.row) !== incidentId ||
      source.command.operation.kind !== "limit" ||
      !source.row.executionInvocationId
    )
      fail();
    const [row] = await db
      .select()
      .from(npAgentActorRestrictions)
      .where(
        and(
          eq(npAgentActorRestrictions.siteId, siteId),
          eq(npAgentActorRestrictions.id, restrictionId),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.sourceActionId !== sourceActionId ||
      row.incidentId !== incidentId ||
      row.adapterId !== source.row.enforcementAdapterId ||
      row.adapterContractVersion !== source.row.enforcementAdapterContractVersion ||
      row.adapterFingerprint !== source.row.enforcementAdapterFingerprint
    )
      fail();
    const descriptor = npRequireAgentRestrictionCanonical(row.descriptor);
    await stagedExecution(db, source, row);
    if (
      source.row.startedAt?.toISOString() !== descriptor.startsAt ||
      Date.parse(descriptor.expiresAt) - Date.parse(descriptor.startsAt) !==
        source.command.operation.durationSeconds * 1000
    )
      fail();
    if (
      (await npDigestAgentRestrictionCanonical(descriptor)) !== row.restrictionHash ||
      descriptor.restrictionId !== row.id ||
      descriptor.siteId !== siteId ||
      descriptor.expiresAt !== row.expiresAt.toISOString() ||
      descriptor.targetVersionDigest !== source.command.expectedTargetVersionDigest ||
      !same(descriptor.actionScopes, source.command.operation.actionScopes) ||
      row.subjectKey !== npAgentRestrictionSubjectKeyV1(descriptor.subject)
    )
      fail();
    if (row.activatedAt !== null) await lifecycleReceipt(db, row, row.installReceipt, "install");
    if (["removed", "expired"].includes(row.state))
      await lifecycleReceipt(
        db,
        row,
        row.removalReceipt,
        row.state === "expired" ? "expire" : "remove",
      );
    return row;
  }
  async function stagedExecution(db: Db, action: LoadedAction, row: Restriction): Promise<void> {
    if (!action.row.executionInvocationId) fail();
    if (action.authorityKind === "deployment") {
      const { original } = await automaticInvocation(db, action.row);
      if (
        action.row.executionInvocationId !== original.id ||
        action.row.executionInvocationFingerprint !== original.requestHash ||
        original.outputRedacted?.restrictionId !== row.id ||
        original.outputRedacted.restrictionHash !== row.restrictionHash ||
        original.outputRedacted.adapterId !== row.adapterId ||
        original.outputRedacted.adapterContractVersion !== row.adapterContractVersion ||
        original.outputRedacted.adapterFingerprint !== row.adapterFingerprint ||
        row.descriptor.reasonCode !== "GUARDIAN_POLICY_AUTH_LIMIT" ||
        action.automatic.authorization.subject.kind !== "opaque_actor_bucket" ||
        !same(action.automatic.authorization.subject, row.descriptor.subject) ||
        action.automatic.authorization.authorizedAt !== row.descriptor.startsAt ||
        action.automatic.authorization.expiresAt !== row.descriptor.expiresAt
      )
        fail();
      return;
    }
    if (
      action.command.operation.kind === "remove" &&
      (action.row.capabilityId !== "security.removeActorLimit" ||
        action.command.operation.sourceActionId !== row.sourceActionId ||
        action.command.operation.restrictionId !== row.id ||
        action.row.compensatesActionId !== row.sourceActionId ||
        action.row.enforcementAdapterId !== row.adapterId ||
        action.row.enforcementAdapterContractVersion !== row.adapterContractVersion ||
        action.row.enforcementAdapterFingerprint !== row.adapterFingerprint)
    )
      fail();
    const [execution] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, row.siteId),
          eq(npAgentInvocations.id, action.row.executionInvocationId),
        ),
      )
      .limit(1);
    const checked = await approval(db, action.row);
    await statementMatches(db, action, checked.statement, false);
    if (
      !execution ||
      execution.state !== "completed" ||
      execution.operationId !== "agents.incidents.guardian_response_execute" ||
      execution.requestHash !== action.row.executionInvocationFingerprint ||
      !execution.outputRedacted ||
      execution.outputHash !== digest("np.agent-admin-output.v1", execution.outputRedacted) ||
      execution.outputRedacted.actionId !== action.row.id ||
      execution.outputRedacted.state !== "executing" ||
      execution.outputRedacted.restrictionId !== row.id ||
      execution.outputRedacted.restrictionHash !== row.restrictionHash ||
      execution.outputRedacted.adapterId !== row.adapterId ||
      execution.outputRedacted.adapterContractVersion !== row.adapterContractVersion ||
      execution.outputRedacted.adapterFingerprint !== row.adapterFingerprint ||
      checked.entry.state !== "consumed" ||
      checked.entry.consumedAt?.getTime() !== action.row.startedAt?.getTime() ||
      !action.row.startedAt
    )
      fail();
    const executeBody = npRequireAgentInvocationRequestCanonical(execution.requestBody);
    const { targetId, parentTargetId, ...executeInput } = executeBody.input;
    const executionCommand = npRequireAgentGuardianResponseExecuteInputV1(executeInput);
    const planInvocation = await invocation(db, action.row);
    if (
      (await npDigestAgentInvocationRequestCanonical(executeBody)) !== execution.requestHash ||
      executeBody.actorFingerprint !== planInvocation.actorFingerprint ||
      executeBody.authorizationContextFingerprint !== execution.authorizationContextFingerprint ||
      !same(execution.authorizationContextBody, planInvocation.authorizationContextBody) ||
      targetId !== row.incidentId ||
      parentTargetId !== null ||
      executionCommand.actionId !== action.row.id ||
      executionCommand.approvalId !== action.row.approvalId ||
      executionCommand.proposalHash !== action.row.inputHash ||
      executionCommand.expectedVersion !== action.command.expectedVersion ||
      execution.authorizationContextFingerprint !==
        planInvocation.authorizationContextFingerprint ||
      execution.actorKind !== "staff" ||
      execution.transport !== "admin" ||
      execution.operationKind !== "admin" ||
      !same(execution.authorityRef, planInvocation.authorityRef)
    )
      fail();
  }
  async function lifecycleReceipt(
    db: Db,
    row: Restriction,
    receipt: NpAgentJsonObject | null,
    operation: "install" | "remove" | "expire",
  ): Promise<void> {
    if (
      !receipt ||
      receipt.schemaVersion !== "np.agent-guardian-response-effect.v1" ||
      receipt.restrictionId !== row.id ||
      receipt.restrictionHash !== row.restrictionHash ||
      receipt.sourceActionId !== row.sourceActionId ||
      receipt.incidentId !== row.incidentId ||
      receipt.operation !== operation ||
      typeof receipt.auditEventId !== "string"
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
            canonicalBodyUuid(receipt.auditEventId, "guardianResponse.auditEventId"),
          ),
        ),
      )
      .limit(1);
    if (
      !audit ||
      audit.action !== "agent.guardian_response.effect" ||
      audit.targetType !== "incident" ||
      audit.targetId !== row.incidentId ||
      !same(audit.payload, receipt)
    )
      fail();
    const verification = npRequireAgentRestrictionVerifyResultV1(receipt.verification);
    if (
      verification.restrictionId !== row.id ||
      (operation === "install"
        ? verification.state !== "installed" ||
          verification.effectiveExpiresAt !== row.descriptor.expiresAt
        : verification.state !== "absent")
    )
      fail();
  }
  async function stageLimitRestriction(
    db: Db,
    siteId: string,
    incidentId: string,
    sourceActionId: string,
    descriptor: NpAgentRestrictionCanonicalV1,
  ): Promise<{ id: string; hash: string }> {
    const hash = await npDigestAgentRestrictionCanonical(descriptor),
      time = new Date(descriptor.startsAt);
    await db.insert(npAgentActorRestrictions).values({
      id: descriptor.restrictionId,
      siteId,
      incidentId,
      sourceActionId,
      descriptor,
      restrictionHash: hash,
      subjectKey: npAgentRestrictionSubjectKeyV1(descriptor.subject),
      scopeDigest: digest("np.agent-guardian-scope.v1", descriptor.actionScopes),
      adapterId: options.adapter.id,
      adapterContractVersion: options.adapter.contractVersion,
      adapterFingerprint: options.adapter.fingerprint,
      state: "pending",
      expiresAt: new Date(descriptor.expiresAt),
      createdAt: time,
      updatedAt: time,
    });
    return { id: descriptor.restrictionId, hash };
  }
  async function validLimitOperation(
    db: Db,
    siteId: string,
    operation: Extract<NpAgentGuardianResponsePlanInputV1["operation"], { kind: "limit" }>,
    facts: Pick<Facts, "incident" | "subject" | "allowedScopes"> & {
      policy: Pick<NpAgentGuardianResponsePolicyV1, "maximumDurationSeconds">;
    },
  ): Promise<void> {
    if (
      ["resolved", "dismissed"].includes(facts.incident.status) ||
      operation.durationSeconds > facts.policy.maximumDurationSeconds ||
      operation.actionScopes.some((scope) => !facts.allowedScopes.includes(scope)) ||
      !(await options.canEnforceSubject({
        db,
        siteId: siteId,
        subject: facts.subject,
        actionScopes: operation.actionScopes,
      }))
    )
      fail();
    const health = npRequireAgentRestrictionHealthV1(await options.adapter.healthCheck());
    if (
      health.schemaVersion !== "np.agent-restriction-health.v1" ||
      health.status !== "ready" ||
      !health.sharedAcrossReplicas ||
      !options.adapter.sharedAcrossReplicas
    )
      unavailable();
    const refs = await npReadAgentActiveRestrictionProjectionRefsV1({
      db,
      siteId: siteId,
      now: now(),
    });
    const projectionKey = (ref: {
      purpose: string;
      projectionVersion: number;
      projectionFingerprint: string;
      keyId: string;
    }) =>
      serializeAgentCanonicalJson({
        purpose: ref.purpose,
        projectionVersion: ref.projectionVersion,
        projectionFingerprint: ref.projectionFingerprint,
        keyId: ref.keyId,
      });
    if (new Set([...refs.map(projectionKey), projectionKey(facts.subject)]).size > 8) unavailable();
    const active = await db
      .select({ id: npAgentActorRestrictions.id })
      .from(npAgentActorRestrictions)
      .where(
        and(
          eq(npAgentActorRestrictions.siteId, siteId),
          eq(npAgentActorRestrictions.subjectKey, npAgentRestrictionSubjectKeyV1(facts.subject)),
          inArray(npAgentActorRestrictions.state, ["pending", "active", "removing"]),
        ),
      )
      .limit(1);
    if (active.length) fail();
  }
  async function validOperation(
    db: Db,
    action: Pick<LoadedAction, "row" | "command">,
    facts: Facts,
  ): Promise<Restriction | null> {
    if (action.command.operation.kind === "limit") {
      await validLimitOperation(db, action.row.siteId, action.command.operation, facts);
      return null;
    }
    const row = await ownRestriction(
      db,
      action.row.siteId,
      facts.incident.id,
      action.command.operation.sourceActionId,
      action.command.operation.restrictionId,
    );
    if (!["pending", "active", "removing"].includes(row.state) || row.removalActionId) fail();
    return row;
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
        row.capabilityId === "security.limitActor"
          ? "A human-approved temporary site request restriction was verified."
          : "This workflow's human-approved request limit removal was verified.",
      details: {
        schemaVersion: "np.agent-guardian-response-timeline.v1",
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
    if (seed.authorityKind !== "human") fail();
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
        viewer && ["succeeded", "failed", "compensated"].includes(seed.row.state)
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
        // Current viewer/source checks remain in withTarget. Reading the signed
        // historical plan must not require new-effect authority to still exist.
        await statementMatches(db, action, checked.statement, false);
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
        await statementMatches(db, action, checked.statement, false);
        return npRequireAgentApprovalGuardianResponseActionReviewV1({
          actionId: action.row.id,
          proposalHash: action.row.inputHash,
          capabilityId: action.row.capabilityId,
          incidentId: incidentIdOf(action.row),
          expectedTargetVersionDigest: action.command.expectedTargetVersionDigest,
          operation: action.command.operation,
          policyDigest: checked.statement.policyHashes[0],
        });
      }),
    review: () =>
      Promise.reject(
        new NpAgentGatewayError(
          "APPROVAL_NOT_FOUND",
          404,
          "Guardian response has no content ChangeSet review.",
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
            await statementMatches(db, action, statement, decision === "approve");
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
      command: NpAgentGuardianResponsePlanInputV1 | NpAgentGuardianResponseExecuteInputV1;
    },
    mode: "plan" | "execute",
  ): Promise<{ resourceId: string; replayed: boolean }> {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodyUuid(input.incidentId, "guardianResponse.incidentId");
    return transaction(input.siteId, async (db) => {
      let seededApproval: CheckedApproval | null = null;
      if (mode === "execute") {
        const command = npRequireAgentGuardianResponseExecuteInputV1(input.command);
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
            ? "agents.incidents.guardian_response_plan"
            : "agents.incidents.guardian_response_execute",
        targetId: input.incidentId,
        command: input.command,
        mutate: async ({
          db,
          command: admitted,
          invocationId,
          now: time,
        }): Promise<{ resourceId: string; output: NpAgentJsonObject }> => {
          // Exact completed invocation replay stays available while disabled.
          // This callback executes only for a new admitted command.
          if (mode === "plan") {
            if (npRequireAgentGuardianResponsePlanInputV1(admitted).operation.kind === "limit")
              await npRequireAgentGuardianNewResponseV1(db, input.siteId);
          } else {
            const action = await loadAction(
              db,
              input.siteId,
              npRequireAgentGuardianResponseExecuteInputV1(admitted).actionId,
            );
            if (action.command.operation.kind === "limit")
              await npRequireAgentGuardianNewResponseV1(db, input.siteId);
          }
          if (admitted.expectedVersion !== facts.incident.versionNumber) fail();
          const [invoked] = await db
            .select()
            .from(npAgentInvocations)
            .where(eq(npAgentInvocations.id, invocationId));
          if (!invoked || !invoked.auditEventId) fail();
          if (mode === "plan") {
            const command = npRequireAgentGuardianResponsePlanInputV1(admitted);
            if (command.expectedTargetVersionDigest !== facts.targetVersionDigest) fail();
            const retained =
              command.operation.kind === "remove"
                ? await ownRestriction(
                    db,
                    input.siteId,
                    input.incidentId,
                    command.operation.sourceActionId,
                    command.operation.restrictionId,
                  )
                : null;
            const id = randomUUID();
            const definition = await npGuardianResponseCapabilityDefinitionV1(capability(command));
            const targetRefs = targets(input.incidentId);
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
              requiredScopes: ["security:execute"],
              targetRefs,
              targetVersionFacts: targetRefs.map((targetRef) => ({
                targetRef: structuredClone(targetRef),
                versionDigest: command.expectedTargetVersionDigest,
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
                enforcementAdapterId: retained?.adapterId ?? options.adapter.id,
                enforcementAdapterContractVersion:
                  retained?.adapterContractVersion ?? options.adapter.contractVersion,
                enforcementAdapterFingerprint:
                  retained?.adapterFingerprint ?? options.adapter.fingerprint,
                idempotencyKey: command.idempotencyKey,
                inputRedacted: json(command),
                inputCanonical: json(command),
                requiredScopes: ["security:execute"],
                targetRefs: body.targetRefs,
                targetVersionFacts: body.targetVersionFacts,
                inputHash: hash,
                approvalId,
                auditEventId: invoked.auditEventId,
                createdAt: time,
                compensatesActionId:
                  command.operation.kind === "remove" ? command.operation.sourceActionId : null,
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
                requiredScopes: ["security:execute"],
                requiredHumanCapabilities: ["admin.manage"],
                requiredHumanPredicates: [],
                policyHashes: [
                  command.operation.kind === "limit"
                    ? await npAgentGuardianResponsePolicyDigestV1(
                        db,
                        input.siteId,
                        facts.policy.policyDigest,
                      )
                    : facts.policy.policyDigest,
                ],
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
          const command = npRequireAgentGuardianResponseExecuteInputV1(admitted);
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
          let stagedRestrictionId: string;
          let stagedRestrictionHash: string;
          if (action.command.operation.kind === "limit") {
            const descriptor = npRequireAgentRestrictionCanonical({
              schemaVersion: "np.agent-restriction.v1",
              restrictionId: randomUUID(),
              siteId: input.siteId,
              subject: facts.subject,
              actionScopes: action.command.operation.actionScopes,
              startsAt: time.toISOString(),
              expiresAt: new Date(
                time.getTime() + action.command.operation.durationSeconds * 1000,
              ).toISOString(),
              reasonCode: "GUARDIAN_REVIEWED_REQUEST_LIMIT",
              targetVersionDigest: facts.targetVersionDigest,
            });
            const staged = await stageLimitRestriction(
              db,
              input.siteId,
              input.incidentId,
              action.row.id,
              descriptor,
            );
            stagedRestrictionId = staged.id;
            stagedRestrictionHash = staged.hash;
          } else {
            if (!existing) fail();
            stagedRestrictionId = existing.id;
            stagedRestrictionHash = existing.restrictionHash;
            const [stagedRemoval] = await db
              .update(npAgentActorRestrictions)
              .set({
                state: "removing",
                removalActionId: action.row.id,
                rowVersion: existing.rowVersion + 1,
                updatedAt: time,
              })
              .where(
                and(
                  eq(npAgentActorRestrictions.id, existing.id),
                  eq(npAgentActorRestrictions.rowVersion, existing.rowVersion),
                ),
              )
              .returning({ id: npAgentActorRestrictions.id });
            if (!stagedRemoval) fail();
          }
          await db
            .update(npAgentActions)
            .set({
              state: "executing",
              executionInvocationId: invocationId,
              executionInvocationFingerprint: invoked.requestHash,
              verificationState: "unknown",
              startedAt: time,
            })
            .where(and(eq(npAgentActions.id, action.row.id), eq(npAgentActions.state, "approved")));
          await actor(db, input.siteId, input.actor);
          await liveApprover(db, action.row, checked.entry);
          if (!same(facts.policy, await policy(db, input, facts.subject))) fail();
          const output = {
            actionId: action.row.id,
            state: "executing",
            restrictionId: stagedRestrictionId,
            restrictionHash: stagedRestrictionHash,
            adapterId: existing?.adapterId ?? options.adapter.id,
            adapterContractVersion:
              existing?.adapterContractVersion ?? options.adapter.contractVersion,
            adapterFingerprint: existing?.adapterFingerprint ?? options.adapter.fingerprint,
          };
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

      await authorize(db, input);
      return { resourceId: result.resourceId, replayed: result.replayed };
    });
  }
  function automaticOptions() {
    const automatic = options.automatic;
    if (
      !automatic ||
      !npIsAgentAutomaticGuardianLimitAuthorityV1(automatic.authority) ||
      typeof automatic.admission.withCurrentAuthority !== "function" ||
      typeof automatic.admission.withStoredAuthority !== "function" ||
      typeof automatic.incidents.get !== "function" ||
      typeof automatic.resolveTransportAudience !== "function"
    )
      unavailable();
    return automatic;
  }
  function automaticPrincipal(
    authentication: NpAgentCapabilityAuthenticationV1,
  ): NpAgentResolvedGatewayPrincipalV1 {
    const authority = authentication.principal.authority,
      exposure = authentication.authorizationContext.gatewayExposure;
    if (authority.kind !== "user" || !authority.userId || exposure === null) unavailable();
    const oauth = !("serviceToken" in authentication);
    return {
      kind: oauth ? "oauth-user" : "service",
      principalId: authentication.principal.id,
      siteId: authentication.principal.siteId,
      authority: { kind: "user", userId: authority.userId },
      credentialId:
        "serviceToken" in authentication ? authentication.serviceToken.id : authentication.grantId,
      gatewayExposureCeiling: exposure,
      scopes: authentication.scopes,
    };
  }
  async function automaticRead(
    db: Db,
    authentication: NpAgentCapabilityAuthenticationV1,
    incidentId: string,
    time: Date,
    signal = AbortSignal.timeout(1000),
  ) {
    const principal = automaticPrincipal(authentication);
    return (
      await automaticOptions().incidents.get(
        { incidentId },
        {
          siteId: principal.siteId,
          principal,
          requestedAt: time.toISOString(),
          transaction: db,
          abortSignal: signal,
        },
      )
    ).incident;
  }
  async function prepareAutomaticTransaction(db: Db, siteId: string): Promise<void> {
    const settings = await db.execute(
      sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_ms,extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_ms`,
    );
    const statement = Number(settings.rows[0]?.statement_ms),
      lock = Number(settings.rows[0]?.lock_ms);
    if (!Number.isFinite(statement) || statement < 0 || !Number.isFinite(lock) || lock < 0) fail();
    await db.execute(
      sql`select set_config('statement_timeout',${`${Math.min(statement || 500, 500)}ms`},true),set_config('lock_timeout',${`${Math.min(lock || 100, 100)}ms`},true)`,
    );
    await npWithAgentRuntimeControlTransactionV1(siteId, () => Promise.resolve(undefined), db);
  }
  async function automaticLimit(
    input: NpAgentGuardianAutomaticResponseInputV1 & {
      authentication: NpAgentCapabilityAuthenticationV1;
    },
  ): Promise<{ resourceId: string; replayed: boolean }> {
    npAssertAgentPreviewEffectsAllowed();
    const automatic = automaticOptions(),
      { authentication, ...raw } = input;
    const request = npRequireAgentGuardianAutomaticResponseInputV1(raw),
      principal = automaticPrincipal(authentication),
      siteId = principal.siteId;
    const definition = await npGuardianAutomaticResponseCapabilityDefinitionV1();
    const result = await withCurrentSite(siteId, () =>
      withDeferredPostCommit(() =>
        automatic.admission.withCurrentAuthority({
          authentication,
          transactionWorkBudgetMs: 1000,
          requiredScopes: ["incident:read", "security:execute"],
          minimumExposure: "approved-execute",
          prepareTransaction: (db) => prepareAutomaticTransaction(db, siteId),
          mutate: async (db, time) => {
            // Serializes quota decisions across principals and reviewed deployment rotations.
            await db.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-guardian-automatic-limit:${siteId}`},0))`,
            );
            const incident = await automaticRead(db, authentication, request.incidentId, time);
            const [prior] = await db
              .select()
              .from(npAgentInvocations)
              .where(
                and(
                  eq(npAgentInvocations.siteId, siteId),
                  eq(npAgentInvocations.actorKind, "principal"),
                  eq(
                    npAgentInvocations.actorFingerprint,
                    authentication.authorizationContext.actor.actorFingerprint,
                  ),
                  eq(
                    npAgentInvocations.authorizationContextFingerprint,
                    authentication.authorizationContextFingerprint,
                  ),
                  eq(npAgentInvocations.operationKind, "capability"),
                  eq(npAgentInvocations.operationId, "security.limitActor"),
                  eq(npAgentInvocations.idempotencyKey, `guardian-auto:${request.idempotencyKey}`),
                ),
              )
              .limit(1);
            if (prior) {
              if (!prior.resultId) fail();
              const action = await loadAction(db, siteId, prior.resultId);
              if (
                action.authorityKind !== "deployment" ||
                !same(action.automatic.request, request) ||
                action.row.invocationId !== prior.id
              )
                fail();
              // Exact completed replay is historical; it never re-dispatches or extends expiry.
              return { resourceId: action.row.id, replayed: true };
            }
            await npRequireAgentGuardianNewResponseV1(db, siteId);
            if (incident.versionNumber !== request.expectedVersion) fail();
            const authorization = await automatic.authority.authorize({
              db,
              siteId,
              principalId: principal.principalId,
              incident,
              signalId: request.signalId,
              now: time,
            });
            if (
              !npIsAgentAutomaticGuardianLimitAuthorizationV1(authorization) ||
              authorization.deploymentDigest !== automatic.authority.deploymentDigest
            )
              fail();
            const controlPolicyDigest = await npAgentGuardianResponsePolicyDigestV1(
              db,
              siteId,
              authorization.policyDigest,
            );
            const operation = {
              kind: "limit" as const,
              durationSeconds:
                (Date.parse(authorization.expiresAt) - Date.parse(authorization.authorizedAt)) /
                1000,
              actionScopes: [...authorization.actionScopes],
            };
            const command = npRequireAgentGuardianResponsePlanInputV1({
              schemaVersion: "np.agent-guardian-response-plan-input.v1",
              expectedVersion: request.expectedVersion,
              expectedTargetVersionDigest: automaticTargetDigest(
                authorization,
                controlPolicyDigest,
                options.adapter,
              ),
              operation,
              idempotencyKey: request.idempotencyKey,
            });
            if (command.operation.kind !== "limit") fail();
            await validLimitOperation(db, siteId, command.operation, {
              incident,
              subject: authorization.subject,
              allowedScopes: [...authorization.actionScopes],
              policy: {
                maximumDurationSeconds: automatic.authority.deployment.limits.restrictionSeconds,
              },
            });
            const [active] = await db
              .select({ total: sql<number>`count(*)::int` })
              .from(npAgentActorRestrictions)
              .where(
                and(
                  eq(npAgentActorRestrictions.siteId, siteId),
                  inArray(npAgentActorRestrictions.state, ["pending", "active", "removing"]),
                ),
              );
            const [hour] = await db
              .select({ total: sql<number>`count(*)::int` })
              .from(npAgentActions)
              .where(
                and(
                  eq(npAgentActions.siteId, siteId),
                  eq(
                    npAgentActions.effectProfileId,
                    NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1,
                  ),
                  sql`${npAgentActions.createdAt} >= ${new Date(time.getTime() - 3600000)}`,
                ),
              );
            if (
              Number(active?.total ?? 0) >=
                automatic.authority.deployment.limits.activeRestrictions ||
              Number(hour?.total ?? 0) >= automatic.authority.deployment.limits.actionsPerHour
            )
              unavailable();
            const envelope = npRequireAgentGuardianAutomaticResponseActionV1({
              schemaVersion: "np.agent-guardian-automatic-response-action.v1",
              request,
              command,
              authorization,
              controlPolicyDigest,
            });
            const body = npRequireAgentInvocationRequestCanonical({
              schemaVersion: "np.agent-idempotency-request.v1",
              siteId,
              actorKind: "principal",
              actorFingerprint: authentication.authorizationContext.actor.actorFingerprint,
              authorizationContextFingerprint: authentication.authorizationContextFingerprint,
              operationKind: "capability",
              operationId: "security.limitActor",
              contractVersion: 1,
              contractFingerprint: definition.fingerprint,
              effectProfile: { id: definition.profile, contractVersion: 1 },
              input: json(envelope),
            });
            const requestHash = await npDigestAgentInvocationRequestCanonical(body),
              invocationId = randomUUID(),
              actionId = randomUUID(),
              auditId = randomUUID();
            await db.insert(npAuditEvents).values({
              id: auditId,
              siteId,
              actorKind: "agent-principal",
              action: "agents.guardian_response.automatic_limit",
              targetType: "agent-incident",
              targetId: incident.id,
              payload: {
                schemaVersion: "np.agent-guardian-automatic-response-audit.v1",
                invocationId,
                actionId,
                requestHash,
                authorizationDigest: digest(
                  "np.agent-guardian-automatic-authorization.v1",
                  authorization,
                ),
                controlPolicyDigest,
              },
              createdAt: time,
            });
            await db.insert(npAgentInvocations).values({
              id: invocationId,
              siteId,
              actorKind: "principal",
              principalId: principal.principalId,
              actorFingerprint: body.actorFingerprint,
              authorizationContextBody: authentication.authorizationContext,
              authorizationContextFingerprint: authentication.authorizationContextFingerprint,
              authorityRef: authentication.authorizationContext.authorityRef,
              operationKind: "capability",
              operationId: "security.limitActor",
              contractVersion: 1,
              contractFingerprint: definition.fingerprint,
              capabilityDefinitionBody: definition.canonical,
              effectProfileId: definition.profile,
              effectContractVersion: 1,
              transport: authentication.authorizationContext.transport,
              mcpExecutionMode: ["mcp-service", "mcp-oauth"].includes(
                authentication.authorizationContext.transport,
              )
                ? "normal"
                : null,
              idempotencyKey: `guardian-auto:${request.idempotencyKey}`,
              requestBody: body,
              requestHash,
              state: "started",
              auditEventId: auditId,
              requestedAt: time,
              expiresAt: new Date(time.getTime() + 86400000),
            });
            const targetRefs = targets(incident.id);
            const canonical = npRequireAgentActionCanonical({
              schemaVersion: "np.agent-action.v1",
              siteId,
              actionId,
              invocationFingerprint: requestHash,
              runFingerprint: null,
              sequence: 1,
              capabilityId: "security.limitActor",
              capabilityContractVersion: 1,
              capabilityFingerprint: definition.fingerprint,
              effectProfile: { id: definition.profile, contractVersion: 1 },
              risk: "reversible",
              requiredScopes: ["security:execute"],
              targetRefs,
              targetVersionFacts: targetRefs.map((targetRef) => ({
                targetRef: structuredClone(targetRef),
                versionDigest: command.expectedTargetVersionDigest,
              })),
              input: json(request),
            });
            await db.insert(npAgentActions).values({
              id: actionId,
              siteId,
              invocationId,
              invocationFingerprint: requestHash,
              executionInvocationId: invocationId,
              executionInvocationFingerprint: requestHash,
              sequence: 1,
              capabilityId: "security.limitActor",
              capabilityContractVersion: 1,
              capabilityFingerprint: definition.fingerprint,
              capabilityDefinitionBody: definition.canonical,
              effectProfileId: definition.profile,
              effectContractVersion: 1,
              risk: "reversible",
              state: "executing",
              enforcementAdapterId: options.adapter.id,
              enforcementAdapterContractVersion: options.adapter.contractVersion,
              enforcementAdapterFingerprint: options.adapter.fingerprint,
              idempotencyKey: request.idempotencyKey,
              inputRedacted: automaticSummary(envelope),
              inputCanonical: json(request),
              requiredScopes: canonical.requiredScopes,
              targetRefs: canonical.targetRefs,
              targetVersionFacts: canonical.targetVersionFacts,
              inputHash: await npDigestAgentActionCanonical(canonical),
              approvalId: null,
              auditEventId: auditId,
              verificationState: "unknown",
              startedAt: time,
              createdAt: time,
            });
            const descriptor = npRequireAgentRestrictionCanonical({
              schemaVersion: "np.agent-restriction.v1",
              restrictionId: randomUUID(),
              siteId,
              subject: authorization.subject,
              actionScopes: authorization.actionScopes,
              startsAt: authorization.authorizedAt,
              expiresAt: authorization.expiresAt,
              reasonCode: "GUARDIAN_POLICY_AUTH_LIMIT",
              targetVersionDigest: command.expectedTargetVersionDigest,
            });
            const staged = await stageLimitRestriction(
              db,
              siteId,
              incident.id,
              actionId,
              descriptor,
            );
            const output = {
              actionId,
              state: "executing",
              restrictionId: staged.id,
              restrictionHash: staged.hash,
              adapterId: options.adapter.id,
              adapterContractVersion: options.adapter.contractVersion,
              adapterFingerprint: options.adapter.fingerprint,
            };
            await db
              .update(npAgentInvocations)
              .set({
                state: "completed",
                resultKind: "action",
                resultId: actionId,
                outputRedacted: output,
                outputHash: digest("np.agent-guardian-automatic-stage.v1", output),
                completedAt: time,
              })
              .where(eq(npAgentInvocations.id, invocationId));
            const currentIncident = await automaticRead(db, authentication, incident.id, time);
            const fresh = await automatic.authority.authorize({
              db,
              siteId,
              principalId: principal.principalId,
              incident: currentIncident,
              signalId: request.signalId,
              now: time,
            });
            if (
              !npIsAgentAutomaticGuardianLimitAuthorizationV1(fresh) ||
              !same(fresh, authorization) ||
              controlPolicyDigest !==
                (await npAgentGuardianResponsePolicyDigestV1(db, siteId, fresh.policyDigest))
            )
              fail();
            await npRequireAgentGuardianNewResponseV1(db, siteId);
            return { resourceId: actionId, replayed: false };
          },
        }),
      ),
    );
    await reconcileAction(siteId, result.resourceId, !result.replayed);
    return result;
  }
  function retainedAdapter(row: Restriction): NpAgentRestrictionAdapter {
    const identity = {
      id: row.adapterId,
      contractVersion: row.adapterContractVersion,
      fingerprint: row.adapterFingerprint,
    };
    const adapter =
      options.resolveAdapter?.(identity) ??
      (options.adapter.id === identity.id &&
      options.adapter.contractVersion === identity.contractVersion &&
      options.adapter.fingerprint === identity.fingerprint
        ? options.adapter
        : null);
    if (
      !adapter ||
      adapter.id !== identity.id ||
      adapter.contractVersion !== identity.contractVersion ||
      adapter.fingerprint !== identity.fingerprint
    )
      unavailable();
    return adapter;
  }
  async function admitAutomaticInstall(
    siteId: string,
    row: Restriction,
    signal: AbortSignal,
    bounded: <T>(work: Promise<T>) => Promise<T>,
    checkpoint: () => void,
  ): Promise<void> {
    const deadline = performance.now() + 1000;
    const before = () => {
      checkpoint();
      if (performance.now() >= deadline) unavailable();
    };
    const automatic = automaticOptions(),
      seed = await bounded(loadAction(getDb(), siteId, row.sourceActionId));
    if (seed.authorityKind !== "deployment") fail();
    const { original } = await bounded(automaticInvocation(getDb(), seed.row));
    const retained = retainedAdapter(row),
      health = npRequireAgentRestrictionHealthV1(await bounded(retained.healthCheck()));
    if (!retained.sharedAcrossReplicas || !health.sharedAcrossReplicas || health.status !== "ready")
      unavailable();
    // The admission owner bounds/closes its entire transaction. Racing that raw
    // owner here could return before its guarded callback had rolled back.
    before();
    await automatic.admission.withStoredAuthority({
      transactionWorkBudgetMs: Math.max(1, Math.floor(deadline - performance.now())),
      authorizationContext: original.authorizationContextBody,
      authorizationContextFingerprint: original.authorizationContextFingerprint,
      requiredScopes: ["incident:read", "security:execute"],
      minimumExposure: "approved-execute",
      resolveTransportAudience: async (...args) => {
        before();
        const value = await bounded(automatic.resolveTransportAudience(...args));
        before();
        return value;
      },
      prepareTransaction: async (db) => {
        before();
        await prepareAutomaticTransaction(db, siteId);
        before();
      },
      mutate: async (db, time, authentication) => {
        checkpoint();
        await bounded(npRequireAgentGuardianNewResponseV1(db, siteId));
        const action = await bounded(loadAction(db, siteId, row.sourceActionId));
        if (
          action.authorityKind !== "deployment" ||
          action.row.state !== "executing" ||
          !same(action.automatic, seed.automatic)
        )
          fail();
        const current = await bounded(
          ownRestriction(db, siteId, row.incidentId, row.sourceActionId, row.id),
        );
        if (
          current.state !== "pending" ||
          current.rowVersion !== row.rowVersion ||
          current.removalActionId !== null ||
          !same(current.descriptor, row.descriptor) ||
          current.expiresAt <= time
        )
          fail();
        const incident = await bounded(
          automaticRead(db, authentication, row.incidentId, time, signal),
        );
        const fresh = await bounded(
          automatic.authority.authorize({
            db,
            siteId,
            principalId: authentication.principal.id,
            incident,
            signalId: action.automatic.request.signalId,
            now: time,
          }),
        );
        const {
          authorizedAt: _originalAt,
          expiresAt: _originalExpiry,
          ...originalBasis
        } = action.automatic.authorization;
        const { authorizedAt: _freshAt, expiresAt: _freshExpiry, ...freshBasis } = fresh;
        const controlPolicyDigest = await bounded(
          npAgentGuardianResponsePolicyDigestV1(db, siteId, fresh.policyDigest),
        );
        if (
          !npIsAgentAutomaticGuardianLimitAuthorizationV1(fresh) ||
          fresh.deploymentDigest !== automatic.authority.deploymentDigest ||
          !same(originalBasis, freshBasis) ||
          Date.parse(fresh.expiresAt) < row.expiresAt.getTime() ||
          controlPolicyDigest !== action.automatic.controlPolicyDigest
        )
          fail();
        // The original descriptor remains frozen. Fresh permission never extends its timer.
        checkpoint();
      },
    });
    checkpoint();
  }
  async function admitInstall(
    siteId: string,
    row: Restriction,
    signal: AbortSignal,
  ): Promise<void> {
    const checkpoint = () => {
      if (signal.aborted) fail();
    };
    const bounded = async <T>(work: Promise<T>): Promise<T> => {
      checkpoint();
      let abort: (() => void) | undefined;
      try {
        const result = await Promise.race([
          work,
          new Promise<never>((_resolve, reject) => {
            abort = () =>
              reject(
                new NpAgentGatewayError(
                  "GUARDIAN_RESPONSE_UNAVAILABLE",
                  503,
                  "Guardian response dispatch admission is unavailable.",
                ),
              );
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          }),
        ]);
        checkpoint();
        return result;
      } finally {
        if (abort) signal.removeEventListener("abort", abort);
      }
    };
    const descriptor = npRequireAgentRestrictionCanonical(row.descriptor);
    if (descriptor.subject.kind !== "opaque_actor_bucket") fail();
    // The host's potentially slow enforceability probe holds no site/control lock.
    if (
      !(await bounded(
        options.canEnforceSubject({
          db: getDb(),
          siteId,
          subject: descriptor.subject,
          actionScopes: descriptor.actionScopes,
        }),
      ))
    )
      fail();
    if (descriptor.reasonCode === "GUARDIAN_POLICY_AUTH_LIMIT") {
      await admitAutomaticInstall(siteId, row, signal, bounded, checkpoint);
      return;
    }
    await bounded(
      withCurrentSite(siteId, () =>
        getDb().transaction(
          async (transaction) => {
            checkpoint();
            const db = transaction as Db;
            const settings = await db.execute(
              sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_ms,extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_ms`,
            );
            checkpoint();
            const statement = Number(settings.rows[0]?.statement_ms),
              lock = Number(settings.rows[0]?.lock_ms);
            if (!Number.isFinite(statement) || statement < 0 || !Number.isFinite(lock) || lock < 0)
              fail();
            await db.execute(
              sql`select set_config('statement_timeout',${`${Math.min(statement || 500, 500)}ms`},true),set_config('lock_timeout',${`${Math.min(lock || 100, 100)}ms`},true)`,
            );
            return npWithAgentRuntimeControlTransactionV1(
              siteId,
              async ({ db }) => {
                checkpoint();
                await bounded(npRequireAgentGuardianNewResponseV1(db, siteId));
                const action = await bounded(loadAction(db, siteId, row.sourceActionId));
                const signed = await bounded(approval(db, action.row));
                const original = await bounded(invocation(db, action.row));
                await bounded(
                  lockPeople(db, siteId, [
                    { userId: original.requesterId, sessionId: original.authorityRef.sessionId },
                    ...(signed.entry.decidedByUserId
                      ? [{ userId: signed.entry.decidedByUserId }]
                      : []),
                  ]),
                );
                const current = await bounded(
                  ownRestriction(db, siteId, row.incidentId, row.sourceActionId, row.id),
                );
                if (
                  current.state !== "pending" ||
                  current.rowVersion !== row.rowVersion ||
                  current.removalActionId !== null ||
                  !same(current.descriptor, row.descriptor) ||
                  current.expiresAt <= now() ||
                  action.row.state !== "executing"
                )
                  fail();
                const originalActor = await bounded(requester(db, action.row));
                const facts = await bounded(
                  authorize(
                    db,
                    { siteId, actor: originalActor, incidentId: row.incidentId },
                    true,
                    checkpoint,
                  ),
                );
                await bounded(statementMatches(db, action, signed.statement, false));
                await bounded(liveApprover(db, action.row, signed.entry));
                const policyDigest = await bounded(
                  npAgentGuardianResponsePolicyDigestV1(db, siteId, facts.policy.policyDigest),
                );
                if (
                  signed.entry.state !== "consumed" ||
                  signed.entry.expiresAt <= now() ||
                  !same(signed.statement.policyHashes, [policyDigest]) ||
                  facts.incident.versionNumber !== action.command.expectedVersion ||
                  facts.targetVersionDigest !== action.command.expectedTargetVersionDigest ||
                  !same(facts.subject, descriptor.subject) ||
                  descriptor.actionScopes.some((scope) => !facts.allowedScopes.includes(scope))
                )
                  fail();
                checkpoint();
              },
              db,
            );
          },
          // Obtain a fresh control snapshot after the quota lock is acquired;
          // a waiting lock statement must not pin an older control generation.
          { isolationLevel: "read committed" },
        ),
      ),
    );
    checkpoint();
    // Successful current-generation admission serializes with disable/enable.
    // Existing executing/pending staging already records a possible effect. It is
    // not a per-attempt receipt; the adapter still owns idempotent install semantics.
    // An operation admitted here may complete after a later disable. A timeout
    // cannot assert that already-admitted external I/O was cancelled.
  }
  async function reconcileAction(
    siteId: string,
    actionId: string,
    dispatch: boolean,
  ): Promise<boolean> {
    const db = getDb();
    const action = await loadAction(db, siteId, actionId);
    const [seed] = await db
      .select()
      .from(npAgentActorRestrictions)
      .where(
        and(
          eq(npAgentActorRestrictions.siteId, siteId),
          action.command.operation.kind === "limit"
            ? eq(npAgentActorRestrictions.sourceActionId, actionId)
            : eq(npAgentActorRestrictions.removalActionId, actionId),
        ),
      )
      .limit(1);
    if (
      !seed ||
      !["pending", "active", "removing"].includes(seed.state) ||
      (seed.state === "active" && seed.expiresAt > now())
    )
      return false;
    try {
      const row = await ownRestriction(db, siteId, seed.incidentId, seed.sourceActionId, seed.id);
      if (row.removalActionId) {
        const removal = await loadAction(db, siteId, row.removalActionId);
        if (removal.row.state !== "executing") fail();
        await stagedExecution(db, removal, row);
      }
      const adapter = retainedAdapter(row),
        descriptor = npRequireAgentRestrictionCanonical(row.descriptor);
      const signal = AbortSignal.timeout(1000);
      const expired = row.expiresAt <= now();
      const remove = expired || row.state === "removing";
      let mutation: ReturnType<typeof npRequireAgentRestrictionMutationResultV1> | null = null;
      if (remove) {
        mutation = npRequireAgentRestrictionMutationResultV1(
          await adapter.remove(descriptor, {
            idempotencyKey: expired
              ? `expire:${row.id}:1:${descriptor.expiresAt}`
              : `remove:${row.id}:${row.removalActionId}`,
            expectedRowVersion: 1,
            signal,
          }),
        );
        if (
          !["removed", "already_absent"].includes(mutation.status) ||
          mutation.restrictionId !== row.id ||
          mutation.effectiveExpiresAt !== null
        )
          fail();
      } else if (
        dispatch &&
        row.state === "pending" &&
        (await npReadAgentGuardianCaptureAdmissionV1(db, siteId)).state !== "disabled"
      ) {
        await admitInstall(siteId, row, signal);
        if (signal.aborted) fail();
        mutation = npRequireAgentRestrictionMutationResultV1(
          await adapter.install(descriptor, {
            idempotencyKey: `install:${row.id}:1`,
            expectedRowVersion: 1,
            signal,
          }),
        );
        if (
          !["installed", "already_installed"].includes(mutation.status) ||
          mutation.restrictionId !== row.id ||
          mutation.effectiveExpiresAt !== descriptor.expiresAt
        )
          fail();
      }
      const verification = npRequireAgentRestrictionVerifyResultV1(
        await adapter.verify(descriptor, { signal }),
      );
      if (
        verification.restrictionId !== row.id ||
        (remove
          ? verification.state !== "absent"
          : verification.state !== "installed" ||
            verification.effectiveExpiresAt !== descriptor.expiresAt)
      )
        return false;
      if (!remove) {
        const health = npRequireAgentRestrictionHealthV1(await adapter.healthCheck());
        if (health.status !== "ready" || !health.sharedAcrossReplicas) return false;
        // Verification cannot infer a live installation after the exact TTL.
        if (row.expiresAt <= now()) return false;
      }
      return transaction(siteId, async (tx) => {
        const [current] = await tx
          .select()
          .from(npAgentActorRestrictions)
          .where(
            and(
              eq(npAgentActorRestrictions.siteId, siteId),
              eq(npAgentActorRestrictions.id, row.id),
            ),
          )
          .for("update");
        if (
          !current ||
          current.rowVersion !== row.rowVersion ||
          !same(current.descriptor, row.descriptor) ||
          current.state !== row.state
        )
          return false;
        const time = now();
        if (!remove && time >= row.expiresAt) return false;
        const source = await loadAction(tx, siteId, row.sourceActionId, true);
        const selected = row.removalActionId
          ? await loadAction(tx, siteId, row.removalActionId, true)
          : source;
        const auditId = randomUUID();
        const evidence = {
          schemaVersion: "np.agent-guardian-response-effect.v1",
          restrictionId: row.id,
          restrictionHash: row.restrictionHash,
          sourceActionId: source.row.id,
          actionId: selected.row.id,
          incidentId: row.incidentId,
          operation: remove ? (expired ? "expire" : "remove") : "install",
          priorActivationEstablished: source.row.state === "succeeded",
          receipt: mutation ? json(mutation) : null,
          verification: json(verification),
          auditEventId: auditId,
          executedAt: time.toISOString(),
        };
        const effectDigest = digest("np.agent-guardian-response-effect.v1", evidence);
        const original =
          selected.authorityKind === "human"
            ? await invocation(tx, selected.row)
            : (await automaticInvocation(tx, selected.row)).original;
        await tx.insert(npAuditEvents).values({
          id: auditId,
          siteId,
          actorKind: "system",
          action: "agent.guardian_response.effect",
          targetType: "incident",
          targetId: row.incidentId,
          payload: evidence,
          createdAt: time,
        });
        await tx
          .update(npAgentActorRestrictions)
          .set({
            state: remove ? (expired ? "expired" : "removed") : "active",
            rowVersion: row.rowVersion + 1,
            updatedAt: time,
            lastErrorCode: null,
            ...(remove
              ? {
                  removedAt: time,
                  revokedAt: expired ? null : time,
                  removalReceipt: json({ ...evidence }),
                }
              : { activatedAt: row.activatedAt ?? time, installReceipt: json({ ...evidence }) }),
          })
          .where(
            and(
              eq(npAgentActorRestrictions.id, row.id),
              eq(npAgentActorRestrictions.rowVersion, row.rowVersion),
            ),
          );
        if (selected.row.state === "executing" && (!remove || selected.row.id !== source.row.id)) {
          const output = {
            actionId: selected.row.id,
            state: "succeeded",
            resultDigest: effectDigest,
          };
          const [finished] = await tx
            .update(npAgentActions)
            .set({
              state: "succeeded",
              outputRedacted: output,
              outputHash: digest("np.agent-guardian-response-output.v1", output),
              effectDigest,
              targetVersionDigest: row.restrictionHash,
              verifierId: selected.definition.verifierId,
              verificationState: "passed",
              verificationResultDigest: effectDigest,
              verificationEvidence: [json(evidence)],
              verifiedAt: time,
              finishedAt: time,
            })
            .where(
              and(eq(npAgentActions.id, selected.row.id), eq(npAgentActions.state, "executing")),
            )
            .returning();
          if (!finished) fail();
          const requesterActor = await requester(tx, selected.row).catch(() => null);
          if (requesterActor)
            await timeline(
              tx,
              { siteId, incidentId: row.incidentId, actor: requesterActor },
              finished,
              auditId,
              time,
            );
          else
            await appendCleanupTimeline(
              tx,
              row,
              selected.row,
              auditId,
              effectDigest,
              time,
              remove
                ? "Temporary request limit removal was verified."
                : "Temporary request limit installation was verified.",
            );
        }
        if (remove) {
          if (source.row.state === "succeeded")
            await tx
              .update(npAgentActions)
              .set({
                state: "compensated",
                compensatorId: "guardian.limit.remove.v1",
                compensationResultDigest: effectDigest,
                compensationEvidence: [json(evidence)],
                compensatedAt: time,
              })
              .where(
                and(eq(npAgentActions.id, source.row.id), eq(npAgentActions.state, "succeeded")),
              );
          else if (source.row.state === "executing")
            await tx
              .update(npAgentActions)
              .set({
                state: "failed",
                errorCode: "GUARDIAN_ACTIVATION_UNVERIFIED",
                finishedAt: time,
                compensatorId: "guardian.limit.remove.v1",
                compensationResultDigest: effectDigest,
                compensationEvidence: [json(evidence)],
                compensatedAt: time,
              })
              .where(
                and(eq(npAgentActions.id, source.row.id), eq(npAgentActions.state, "executing")),
              );
          if (expired || selected.row.id === source.row.id)
            await appendCleanupTimeline(
              tx,
              row,
              source.row,
              auditId,
              effectDigest,
              time,
              expired
                ? "Expired request limit cleanup was confirmed."
                : "Request limit removal was confirmed; prior activation remains unestablished.",
            );
        }
        // The persisted signed requester fingerprint remains historical evidence even if its account is gone.
        void original;
        return true;
      });
    } catch {
      await transaction(siteId, async (tx) => {
        await tx
          .update(npAgentActorRestrictions)
          .set({ lastErrorCode: "GUARDIAN_ENFORCEMENT_UNAVAILABLE", updatedAt: now() })
          .where(
            and(
              eq(npAgentActorRestrictions.siteId, siteId),
              eq(npAgentActorRestrictions.id, seed.id),
              eq(npAgentActorRestrictions.rowVersion, seed.rowVersion),
              inArray(npAgentActorRestrictions.state, ["pending", "active", "removing"]),
            ),
          );
      });
      return false;
    }
  }
  async function appendCleanupTimeline(
    db: Db,
    row: Restriction,
    action: Action,
    auditId: string,
    fingerprint: string,
    time: Date,
    summary: string,
  ): Promise<void> {
    await db
      .select({ id: npAgentIncidents.id })
      .from(npAgentIncidents)
      .where(and(eq(npAgentIncidents.siteId, row.siteId), eq(npAgentIncidents.id, row.incidentId)))
      .for("update");
    const [last] = await db
      .select({ sequence: sql<number>`coalesce(max(${npAgentIncidentTimeline.sequence}),0)` })
      .from(npAgentIncidentTimeline)
      .where(
        and(
          eq(npAgentIncidentTimeline.siteId, row.siteId),
          eq(npAgentIncidentTimeline.incidentId, row.incidentId),
        ),
      );
    await db.insert(npAgentIncidentTimeline).values({
      siteId: row.siteId,
      incidentId: row.incidentId,
      sequence: Number(last?.sequence ?? 0) + 1,
      kind: "action",
      sourceKind: "system",
      sourceFingerprint: fingerprint,
      actionId: action.id,
      approvalId: action.approvalId,
      auditEventId: auditId,
      summary,
      details: { schemaVersion: "np.agent-guardian-lifecycle.v1", restrictionId: row.id },
      createdAt: time,
    });
  }

  return {
    automatic: {
      installed: npIsAgentAutomaticGuardianLimitAuthorityV1(options.automatic?.authority),
      limit: automaticLimit,
    },
    approvalTargets,
    plan: (input) =>
      mutate(
        { ...input, command: npRequireAgentGuardianResponsePlanInputV1(input.command) },
        "plan",
      ),
    execute: async (input) => {
      npAssertAgentPreviewEffectsAllowed();
      const command = npRequireAgentGuardianResponseExecuteInputV1(input.command);
      const before = await loadAction(getDb(), input.siteId, command.actionId);
      if (["executing", "succeeded", "compensated"].includes(before.row.state)) {
        await authorize(getDb(), input);
        const original = await invocation(getDb(), before.row);
        if (
          incidentIdOf(before.row) !== input.incidentId ||
          original.staffUserId !== input.actor.user.id ||
          original.authorityRef.sessionId !== input.actor.sessionId ||
          before.row.approvalId !== command.approvalId ||
          before.row.inputHash !== command.proposalHash
        )
          fail();
        await reconcileAction(input.siteId, before.row.id, false);
        return { resourceId: before.row.id, replayed: true };
      }
      const result = await mutate({ ...input, command }, "execute");
      await reconcileAction(input.siteId, result.resourceId, !result.replayed);
      return result;
    },
    reconcile: async ({ siteId, limit = 25 }) => {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodyInteger(limit, "guardianResponse.limit", 1, 100);
      const rows = await getDb()
        .select()
        .from(npAgentActorRestrictions)
        .where(
          and(
            eq(npAgentActorRestrictions.siteId, siteId),
            sql`(${npAgentActorRestrictions.state} in ('pending','removing') or (${npAgentActorRestrictions.state}='active' and ${npAgentActorRestrictions.expiresAt}<=${now()}))`,
          ),
        )
        .orderBy(
          asc(npAgentActorRestrictions.rowVersion),
          asc(npAgentActorRestrictions.updatedAt),
          asc(npAgentActorRestrictions.id),
        )
        .limit(limit);
      let resolved = 0;
      for (const row of rows) {
        await getDb()
          .update(npAgentActorRestrictions)
          .set({ updatedAt: now(), rowVersion: row.rowVersion + 1 })
          .where(
            and(
              eq(npAgentActorRestrictions.siteId, siteId),
              eq(npAgentActorRestrictions.id, row.id),
              eq(npAgentActorRestrictions.rowVersion, row.rowVersion),
            ),
          );
        if (await reconcileAction(siteId, row.removalActionId ?? row.sourceActionId, false))
          resolved++;
      }
      return { checked: rows.length, resolved };
    },
    get: async (input) => {
      return withCurrentSite(input.siteId, async () => {
        const db = getDb(),
          facts = await authorize(db, input);
        const rows = await db
          .select()
          .from(npAgentActions)
          .where(
            and(
              eq(npAgentActions.siteId, input.siteId),
              inArray(npAgentActions.capabilityId, [
                "security.limitActor",
                "security.removeActorLimit",
              ]),
              isNotNull(npAgentActions.approvalId),
              sql`${npAgentActions.targetRefs} @> ${JSON.stringify([{ kind: "incident", incidentId: input.incidentId }])}::jsonb`,
            ),
          )
          .orderBy(desc(npAgentActions.createdAt), desc(npAgentActions.id))
          .limit(26);
        const plans: NpAgentGuardianResponseV1["plans"] = [];
        for (const row of rows.slice(0, 25)) {
          const action = await loadAction(db, input.siteId, row.id),
            checked = await approval(db, row);
          await statementMatches(db, action, checked.statement, false);
          let canExecute = false;
          const original = await invocation(db, row);
          if (
            original.staffUserId === input.actor.user.id &&
            original.authorityRef.sessionId === input.actor.sessionId
          ) {
            if (row.state === "executing") canExecute = true;
            else if (
              row.state === "approved" &&
              checked.entry.state === "approved" &&
              checked.entry.expiresAt > now()
            ) {
              try {
                await statementMatches(db, action, checked.statement, true);
                await liveApprover(db, row, checked.entry);
                canExecute = true;
              } catch {
                /* Drift removes authority. */
              }
            }
          }
          if (
            ![
              "approval_pending",
              "approved",
              "executing",
              "succeeded",
              "failed",
              "compensated",
            ].includes(row.state)
          )
            fail();
          plans.push({
            actionId: row.id,
            approvalId: row.approvalId!,
            proposalHash: row.inputHash,
            capabilityId: capability(action.command),
            operation: action.command.operation,
            state: row.state as NpAgentGuardianResponseV1["plans"][number]["state"],
            approvalExpiresAt: checked.entry.expiresAt.toISOString(),
            canExecute,
          });
        }
        const restrictions: NpAgentGuardianResponseV1["restrictions"] = [];
        for (const item of facts.restrictions.slice(0, 25)) {
          const row = await ownRestriction(
            db,
            input.siteId,
            input.incidentId,
            item.sourceActionId,
            item.id,
          );
          restrictions.push({
            restrictionId: row.id,
            sourceActionId: row.sourceActionId,
            expiresAt: row.expiresAt.toISOString(),
            state: row.state as NpAgentGuardianResponseV1["restrictions"][number]["state"],
            rowVersion: row.rowVersion,
            lastErrorCode: row.lastErrorCode,
            canRemove:
              ["pending", "active", "removing"].includes(row.state) && !row.removalActionId,
          });
        }
        const current = await authorize(db, input);
        if (
          facts.targetVersionDigest !== current.targetVersionDigest ||
          facts.incident.versionNumber !== current.incident.versionNumber
        )
          fail();
        let enforceable = false;
        try {
          const health = npRequireAgentRestrictionHealthV1(await options.adapter.healthCheck());
          enforceable =
            (await npReadAgentGuardianCaptureAdmissionV1(db, input.siteId)).state !== "disabled" &&
            health.status === "ready" &&
            health.sharedAcrossReplicas &&
            options.adapter.sharedAcrossReplicas &&
            (await options.canEnforceSubject({
              db,
              siteId: input.siteId,
              subject: facts.subject,
              actionScopes: facts.allowedScopes,
            }));
        } catch {
          /* Unavailable enforcement grants no new limit. */
        }
        const [otherActive] = await db
          .select({ id: npAgentActorRestrictions.id })
          .from(npAgentActorRestrictions)
          .where(
            and(
              eq(npAgentActorRestrictions.siteId, input.siteId),
              eq(
                npAgentActorRestrictions.subjectKey,
                npAgentRestrictionSubjectKeyV1(facts.subject),
              ),
              inArray(npAgentActorRestrictions.state, ["pending", "active", "removing"]),
            ),
          )
          .limit(1);
        return npRequireAgentGuardianResponseV1({
          schemaVersion: "np.agent-guardian-response.v1",
          incidentId: input.incidentId,
          incidentVersion: facts.incident.versionNumber,
          targetVersionDigest: facts.targetVersionDigest,
          maximumDurationSeconds: facts.policy.maximumDurationSeconds,
          allowedScopes: facts.allowedScopes,
          canLimit:
            enforceable &&
            !otherActive &&
            !["resolved", "dismissed"].includes(facts.incident.status) &&
            facts.allowedScopes.length > 0 &&
            !facts.restrictions.some((row) =>
              ["pending", "active", "removing"].includes(row.state),
            ),
          restrictions,
          plans,
          truncated: rows.length > 25 || facts.restrictions.length > 25,
        });
      });
    },
  };
}
