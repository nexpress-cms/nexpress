import {
  npRequireAgentGuardianNewResponseV1,
  npAgentGuardianResponsePolicyDigestV1,
} from "./guardian-capture-admission.js";
import { npReadAgentEventRowsV1, npReadAgentEventRowEvidenceV1 } from "./event-evidence.js";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentIncidents,
  npAgentIncidentSignals,
  npAgentIncidentTimeline,
  npAgentInvocations,
  npAgentSignals,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSessions, npSiteMemberships, npSites, npUsers } from "../db/schema/system.js";
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
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import {
  npRequireAgentGuardianSessionPlanInputV1,
  npRequireAgentGuardianSessionExecuteInputV1,
  npRequireAgentGuardianSessionV1,
  npRequireAgentGuardianSessionTargetV1,
  npRequireAgentApprovalGuardianSessionActionReviewV1,
  type NpAgentGuardianSessionPlanInputV1,
  type NpAgentGuardianSessionExecuteInputV1,
  type NpAgentGuardianSessionTargetV1,
  type NpAgentGuardianSessionV1,
} from "../agent-contract/guardian-session-contract.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
} from "../agent-contract/canonical-events.js";
import type {
  NpAgentApprovalStatementCanonicalV1,
  NpAgentApprovalTargetV1,
  NpAgentJsonObject,
  NpAgentTargetRef,
  NpAgentInvocationAuthorityRefV1,
  NpAgentSignalEvidenceCanonicalV1,
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
import { npReadGuardianSessionIncidentEvidenceV1 } from "./guardian-session-observation.js";
import {
  npReadGuardianSessionFamilyV1,
  npRevokeGuardianSessionFamilyV1,
  type NpGuardianSessionFamilyRefV1,
} from "../auth/guardian-session.js";
import {
  npGuardianSessionCapabilityDefinitionV1,
  type NpGuardianSessionCapabilityDefinitionV1,
} from "./guardian-session-capability.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";

type Db = ReturnType<typeof getDb>;
type Action = typeof npAgentActions.$inferSelect;
type Approval = typeof npAgentApprovals.$inferSelect;
type Invocation = typeof npAgentInvocations.$inferSelect;
type StaffInvocation = Omit<Invocation, "authorityRef"> & {
  authorityRef: Extract<NpAgentInvocationAuthorityRefV1, { kind: "staff-session" }>;
  requesterId: string;
};
type Input = { siteId: string; actor: NpAgentAdminActorV1; incidentId: string };
interface CanonicalInput {
  schemaVersion: "np.agent-guardian-session-action-input.v1";
  command: NpAgentGuardianSessionPlanInputV1;
  family: NpGuardianSessionFamilyRefV1;
  target: NpAgentGuardianSessionTargetV1;
  sourceDigest: string;
  policyDigest: string;
}
interface LoadedAction {
  row: Action;
  input: CanonicalInput;
  definition: NpGuardianSessionCapabilityDefinitionV1;
}
interface Facts {
  incident: NpAgentIncidentV1;
  family: NpGuardianSessionFamilyRefV1;
  target: NpAgentGuardianSessionTargetV1;
  sourceDigest: string;
  targetVersionDigest: string;
  live: boolean;
  policy: NpAgentGuardianSessionPolicyV1 | null;
}
export interface NpAgentGuardianSessionPolicyV1 {
  policyDigest: string;
  approvalLifetimeSeconds: number;
}
export interface NpAgentGuardianSessionServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  events: Pick<NpAgentRuntimeEventServiceV1, "record">;
  resolveApprovals(): NpAgentApprovalServiceV1;
  /** Null disables new plans and execution, without hiding verified historical effects. */
  resolvePolicy(
    input: Input & { db: Db; target: NpAgentGuardianSessionTargetV1 },
  ): Promise<NpAgentGuardianSessionPolicyV1 | null>;
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
export interface NpAgentGuardianSessionServiceV1 {
  get(input: Input): Promise<NpAgentGuardianSessionV1>;
  plan(
    input: Input & { command: NpAgentGuardianSessionPlanInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  execute(
    input: Input & { command: NpAgentGuardianSessionExecuteInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  approvalTargets: NpAgentApprovalServiceOptionsV1["targets"];
}
const json = (v: object) => v as unknown as NpAgentJsonObject;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const digest = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(purpose + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
function fail(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_SESSION_CONFLICT",
    409,
    "Session or approval evidence changed. Review the current Incident and prepare a new plan.",
  );
}
function unavailable(): never {
  throw new NpAgentGatewayError(
    "GUARDIAN_SESSION_UNAVAILABLE",
    503,
    "Guardian session response requires an explicitly installed policy and service.",
  );
}
function targetChanged(): never {
  throw new NpAgentGatewayError(
    "APPROVAL_TARGET_CHANGED",
    409,
    "The approved session target or policy changed.",
  );
}
function authorityChanged(): never {
  throw new NpAgentGatewayError(
    "AUTHORIZATION_CHANGED",
    409,
    "Current session response authority changed.",
  );
}
function incidentIdOf(row: Action): string {
  const refs = row.targetRefs.filter((ref) => ref.kind === "incident");
  if (refs.length !== 1 || refs[0].kind !== "incident") fail();
  return refs[0].incidentId;
}
function targets(incidentId: string): NpAgentTargetRef[] {
  return [{ kind: "incident", incidentId }];
}
function canonicalInput(value: unknown): CanonicalInput {
  const r = canonicalBodyRecord(
    value,
    "guardianSession.action",
    ["schemaVersion", "command", "family", "target", "sourceDigest", "policyDigest"],
    ["schemaVersion", "command", "family", "target", "sourceDigest", "policyDigest"],
    { seen: new WeakSet() },
  );
  const f = canonicalBodyRecord(
    r.family,
    "guardianSession.family",
    ["actorKind", "principalId", "sessionFamilyId"],
    ["actorKind", "principalId", "sessionFamilyId"],
    { seen: new WeakSet() },
  );
  const target = npRequireAgentGuardianSessionTargetV1(r.target);
  if (
    r.schemaVersion !== "np.agent-guardian-session-action-input.v1" ||
    f.actorKind !== target.actorKind ||
    f.sessionFamilyId !== target.sessionFamilyId
  )
    fail();
  return {
    schemaVersion: "np.agent-guardian-session-action-input.v1",
    command: npRequireAgentGuardianSessionPlanInputV1(r.command),
    family: {
      actorKind: target.actorKind,
      principalId: canonicalBodyUuid(f.principalId, "guardianSession.principalId"),
      sessionFamilyId: target.sessionFamilyId,
    },
    target,
    sourceDigest: canonicalBodySha256Digest(r.sourceDigest, "guardianSession.sourceDigest"),
    policyDigest: canonicalBodySha256Digest(r.policyDigest, "guardianSession.policyDigest"),
  };
}

/** Explicit host-owned response. All authorization, exact deletion and evidence share one DB transaction. */
export function createAgentGuardianSessionServiceV1(
  options: NpAgentGuardianSessionServiceOptionsV1,
): NpAgentGuardianSessionServiceV1 {
  const now = options.now ?? (() => new Date());
  const admission = createAgentAdminAdmissionV1({ ...options.admission, now });
  const transaction = <T>(siteId: string, work: (db: Db) => Promise<T>) =>
    withCurrentSite(siteId, () =>
      withDeferredPostCommit(() =>
        getDb().transaction(
          async (tx) => {
            // Freeze the deployment impact catalog before taking the transaction snapshot.
            // Session tables have no site fence: site insertion/deletion must not race
            // a signed affected-site count. This metadata-only shared lock is brief.
            await tx.execute(sql`set local lock_timeout = '100ms'`);
            await tx.execute(sql`lock table np_sites in share mode`);
            return npWithAgentRuntimeControlTransactionV1(siteId, ({ db }) => work(db), tx);
          },
          { isolationLevel: "serializable" },
        ),
      ),
    );
  async function actor(db: Db, input: Input): Promise<void> {
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      input.siteId,
      input.actor,
      now(),
    );
    if (!auth.authority.capabilities.includes("admin.manage")) fail();
  }
  async function lockPeople(
    db: Db,
    siteId: string,
    people: readonly { userId: string; sessionId?: string }[],
  ): Promise<void> {
    const ids = [...new Set(people.map((p) => p.userId))].sort();
    if (!ids.length) fail();
    await db
      .select({ id: npUsers.id })
      .from(npUsers)
      .where(inArray(npUsers.id, ids))
      .orderBy(asc(npUsers.id))
      .for("share");
    await db
      .select({ id: npSiteMemberships.userId })
      .from(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, siteId), inArray(npSiteMemberships.userId, ids)))
      .orderBy(asc(npSiteMemberships.userId))
      .for("share");
    const sessions = [...new Set(people.flatMap((p) => (p.sessionId ? [p.sessionId] : [])))].sort();
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
    await actor(db, input);
    const incident = (
      await options.reads.get({ incidentId: input.incidentId }, { ...input, transaction: db })
    ).incident;
    if (
      incident.siteId !== input.siteId ||
      incident.category !== "authentication" ||
      incident.primarySubject?.kind !== "session"
    )
      fail();
    if (lock) {
      const [row] = await db
        .select({ version: npAgentIncidents.versionNumber })
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, input.siteId), eq(npAgentIncidents.id, incident.id)))
        .for("update");
      if (!row || row.version !== incident.versionNumber) fail();
    }
    const source = await npReadGuardianSessionIncidentEvidenceV1({
      db,
      siteId: input.siteId,
      incident,
    });
    const family = {
      actorKind: source.actorKind,
      principalId: source.principalId,
      sessionFamilyId: source.sessionFamilyId,
    };
    const sites = await db
      .select({ id: npSites.id })
      .from(npSites)
      .orderBy(asc(npSites.id))
      .limit(10001);
    if (!sites.length || sites.length > 10000 || !sites.some((site) => site.id === input.siteId))
      unavailable();
    const impactDigest = digest("np.agent-session-deployment-impact.v1", {
      family,
      createdAt: source.createdAt,
      sites: sites.map((s) => s.id),
    });
    const target: NpAgentGuardianSessionTargetV1 = {
      actorKind: family.actorKind,
      sessionFamilyId: family.sessionFamilyId,
      createdAt: source.createdAt,
      impact: "deployment",
      affectedSiteCount: sites.length,
      impactDigest,
    };
    const current = await npReadGuardianSessionFamilyV1(db, family, { lock });
    const live =
      !!current &&
      current.createdAt === source.createdAt &&
      Date.parse(current.refreshExpiresAt) > now().getTime();
    const policy =
      typeof options.resolvePolicy === "function"
        ? await options.resolvePolicy({ ...input, db, target })
        : null;
    if (policy) {
      canonicalBodySha256Digest(policy.policyDigest, "guardianSession.policyDigest");
      canonicalBodyInteger(
        policy.approvalLifetimeSeconds,
        "guardianSession.approvalLifetimeSeconds",
        1,
        900,
      );
    }
    const targetVersionDigest = digest("np.agent-guardian-session-target.v1", {
      siteId: input.siteId,
      incidentId: incident.id,
      family,
      target,
      sourceDigest: source.sourceDigest,
      policy,
    });
    return {
      incident,
      family,
      target,
      sourceDigest: source.sourceDigest,
      targetVersionDigest,
      live,
      policy,
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
      original.operationId !== "agents.incidents.guardian_session_plan" ||
      original.authorityRef.kind !== "staff-session" ||
      original.requestHash !== row.invocationFingerprint ||
      !original.auditEventId
    )
      fail();
    const body = npRequireAgentInvocationRequestCanonical(original.requestBody),
      auth = npRequireAgentAuthorizationContextCanonical(original.authorizationContextBody);
    const { targetId, parentTargetId, ...command } = body.input;
    const input = canonicalInput(row.inputCanonical);
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
      !same(command, input.command) ||
      body.actorFingerprint !== original.actorFingerprint ||
      body.authorizationContextFingerprint !== original.authorizationContextFingerprint
    )
      fail();
    return { ...original, authorityRef: auth.authorityRef, requesterId: auth.actor.userId };
  }
  function actionBody(
    row: Pick<Action, "id" | "siteId" | "invocationFingerprint">,
    input: CanonicalInput,
    definition: NpGuardianSessionCapabilityDefinitionV1,
    incidentId: string,
  ) {
    const refs = targets(incidentId);
    return npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: row.siteId,
      actionId: row.id,
      invocationFingerprint: row.invocationFingerprint,
      runFingerprint: null,
      sequence: 1,
      capabilityId: "security.revokeSessions",
      capabilityContractVersion: 1,
      capabilityFingerprint: definition.fingerprint,
      effectProfile: { id: "sessions.revoke", contractVersion: 1 },
      risk: "sensitive",
      requiredScopes: ["security:execute"],
      targetRefs: refs,
      targetVersionFacts: refs.map((targetRef) => ({
        targetRef: structuredClone(targetRef),
        versionDigest: input.command.expectedTargetVersionDigest,
      })),
      input: json(input),
    });
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
      row.capabilityId !== "security.revokeSessions" ||
      !row.approvalId ||
      row.runId ||
      row.runFingerprint ||
      row.containmentId ||
      row.undoRef ||
      row.compensatorId ||
      row.compensatesActionId ||
      row.enforcementAdapterId ||
      row.enforcementAdapterContractVersion ||
      row.enforcementAdapterFingerprint
    )
      fail();
    const input = canonicalInput(row.inputCanonical),
      definition = await npGuardianSessionCapabilityDefinitionV1();
    const body = actionBody(row, input, definition, incidentIdOf(row));
    if (
      row.sequence !== 1 ||
      row.capabilityContractVersion !== 1 ||
      row.capabilityFingerprint !== definition.fingerprint ||
      !same(row.capabilityDefinitionBody, definition.canonical) ||
      !same(row.targetRefs, body.targetRefs) ||
      !same(row.targetVersionFacts, body.targetVersionFacts) ||
      row.effectProfileId !== "sessions.revoke" ||
      row.effectContractVersion !== 1 ||
      row.risk !== "sensitive" ||
      !same(row.requiredScopes, body.requiredScopes) ||
      (await npDigestAgentActionCanonical(body)) !== row.inputHash
    )
      fail();
    await invocation(db, row);
    return { row, input, definition };
  }
  async function requester(db: Db, row: Action): Promise<NpAgentAdminActorV1> {
    const original = await invocation(db, row);
    if (
      original.actorDeletedAt !== null ||
      original.staffUserId === null ||
      original.staffUserId !== original.requesterId
    )
      authorityChanged();
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
    if (!user || user.tokenVersion !== original.authorityRef.userTokenVersion) authorityChanged();
    const value = { user, sessionId: original.authorityRef.sessionId };
    const auth = await npResolveAgentStaffSessionAuthorizationV1(db, row.siteId, value, now());
    if (
      !auth.authority.capabilities.includes("admin.manage") ||
      (await npDigestAgentStaffSiteAuthorizationCanonical(auth)) !==
        original.authorityRef.siteAuthorizationDigest
    )
      fail();
    return value;
  }
  async function approval(db: Db, row: Action, lock = false) {
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
    const { row, input, definition } = action,
      original = await invocation(db, row);
    if (
      statement.target.kind !== "action" ||
      statement.target.actionId !== row.id ||
      statement.target.runId !== null ||
      statement.target.agentId !== null ||
      statement.target.proposalHash !== row.inputHash ||
      statement.siteId !== row.siteId ||
      statement.approvalId !== row.approvalId ||
      statement.capabilityId !== "security.revokeSessions" ||
      statement.capabilityContractVersion !== 1 ||
      statement.capabilityFingerprint !== definition.fingerprint ||
      statement.requester.kind !== "staff" ||
      statement.requester.userId !== original.requesterId ||
      statement.requester.fingerprint !== original.actorFingerprint ||
      !same(statement.requiredScopes, ["security:execute"]) ||
      !same(statement.requiredHumanCapabilities, ["admin.manage"]) ||
      !same(statement.requiredHumanPredicates, ["is-super-admin"]) ||
      !same(statement.policyHashes, [input.policyDigest]) ||
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
    const facts = await authorize(db, {
      siteId: row.siteId,
      actor: originalActor,
      incidentId: incidentIdOf(row),
    });
    if (
      !facts.policy ||
      !facts.live ||
      ["resolved", "dismissed"].includes(facts.incident.status) ||
      facts.incident.versionNumber !== input.command.expectedVersion ||
      facts.targetVersionDigest !== input.command.expectedTargetVersionDigest ||
      !same(facts.target, input.target) ||
      !same(facts.family, input.family) ||
      facts.sourceDigest !== input.sourceDigest ||
      (await npAgentGuardianResponsePolicyDigestV1(db, row.siteId, facts.policy.policyDigest)) !==
        input.policyDigest ||
      Date.parse(statement.expiresAt) >
        Date.parse(statement.createdAt) + facts.policy.approvalLifetimeSeconds * 1000
    )
      targetChanged();
    return facts;
  }
  async function approverVisible(db: Db, row: Action, entry: Approval): Promise<void> {
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
      current.authority.kind !== "super-admin" ||
      !current.authority.capabilities.includes("admin.manage")
    )
      authorityChanged();
    const originalActor = await requester(db, row);
    const incident = (
      await options.reads.get(
        { incidentId: incidentIdOf(row) },
        { siteId: row.siteId, actor: originalActor, transaction: db },
      )
    ).incident;
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
          eq(npAgentSignals.siteId, row.siteId),
          eq(npAgentIncidentSignals.incidentId, incident.id),
        ),
      )
      .orderBy(asc(npAgentSignals.id))
      .limit(101);
    const signals = await Promise.all(
      rows.map(({ signal }) => npReadAgentIncidentSignalEvidenceV1(signal)),
    );
    if (
      !rows.length ||
      rows.length > 100 ||
      !same(
        rows.map(({ signal }) => signal.id),
        incident.signalIds,
      )
    )
      fail();
    if (
      !(await options.canReviewIncidentAsStaffUser({
        db,
        siteId: row.siteId,
        userId: entry.decidedByUserId,
        incident,
        signals,
      }))
    )
      authorityChanged();
  }
  async function receipt(
    db: Db,
    action: LoadedAction,
  ): Promise<NpAgentGuardianSessionExecuteInputV1> {
    const { row, input, definition } = action;
    const checked = await approval(db, row);
    await statementMatches(db, action, checked.statement, false);
    if (
      row.state !== "succeeded" ||
      !row.executionInvocationId ||
      !row.startedAt ||
      !row.finishedAt ||
      row.verifiedAt?.getTime() !== row.finishedAt.getTime() ||
      row.verificationState !== "passed" ||
      row.verifierId !== definition.verifierId ||
      !row.verificationEvidence ||
      row.verificationEvidence.length !== 1 ||
      checked.entry.state !== "consumed" ||
      checked.entry.consumedAt?.getTime() !== row.startedAt.getTime()
    )
      fail();
    const e = row.verificationEvidence[0];
    const keys = [
      "schemaVersion",
      "actionId",
      "incidentId",
      "sessionFamilyId",
      "actorKind",
      "createdAt",
      "impactDigest",
      "affectedSiteCount",
      "sourceDigest",
      "auditEventId",
      "eventId",
      "eventHash",
      "revokedAt",
    ];
    canonicalBodyRecord(e, "guardianSession.receipt", keys, keys, { seen: new WeakSet() });
    if (
      e.schemaVersion !== "np.agent-guardian-session-effect.v1" ||
      e.actionId !== row.id ||
      e.incidentId !== incidentIdOf(row) ||
      e.sessionFamilyId !== input.family.sessionFamilyId ||
      e.actorKind !== input.family.actorKind ||
      e.createdAt !== input.target.createdAt ||
      e.impactDigest !== input.target.impactDigest ||
      e.affectedSiteCount !== input.target.affectedSiteCount ||
      e.sourceDigest !== input.sourceDigest ||
      e.revokedAt !== row.finishedAt.toISOString()
    )
      fail();
    canonicalBodyUuid(e.eventId, "guardianSession.eventId");
    canonicalBodySha256Digest(e.eventHash, "guardianSession.eventHash");
    const hash = digest("np.agent-guardian-session-effect.v1", e),
      output = { actionId: row.id, state: "succeeded", resultDigest: hash };
    if (
      row.effectDigest !== hash ||
      row.verificationResultDigest !== hash ||
      row.targetVersionDigest !== input.command.expectedTargetVersionDigest ||
      !same(row.outputRedacted, output) ||
      row.outputHash !== digest("np.agent-guardian-session-output.v1", output)
    )
      fail();
    const [audit] = await db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.siteId, row.siteId),
          eq(npAuditEvents.id, canonicalBodyUuid(e.auditEventId, "guardianSession.auditEventId")),
        ),
      )
      .limit(1);
    if (
      !audit ||
      audit.action !== "agent.guardian_session.effect" ||
      audit.targetType !== "incident" ||
      audit.targetId !== incidentIdOf(row) ||
      audit.createdAt.getTime() !== row.finishedAt.getTime() ||
      !same(audit.payload, e)
    )
      fail();
    const [execution] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, row.siteId),
          eq(npAgentInvocations.id, row.executionInvocationId),
        ),
      )
      .limit(1);
    const original = await invocation(db, row);
    if (audit.actorKind !== "staff" || audit.actorUserId !== original.requesterId) fail();
    const [storedEvent] = await npReadAgentEventRowsV1(db, row.siteId, [
      canonicalBodyUuid(e.eventId, "guardianSession.eventId"),
    ]);
    if (!storedEvent) fail();
    const retainedEvent = await npReadAgentEventRowEvidenceV1(storedEvent);
    const expectedEvent = npRequireAgentEventCanonical({
      version: "np.agent-event.v1",
      siteId: row.siteId,
      kind: "auth.session.revoked",
      occurredAt: e.revokedAt,
      source: { kind: "auth", component: "auth.guardian-session" },
      subject: {
        kind: "session",
        actorKind: input.family.actorKind,
        sessionFamilyId: input.family.sessionFamilyId,
      },
      actor: { kind: "staff", userId: original.requesterId },
      causation: null,
      correlationId: null,
      deduplicationKey: row.id,
      privacy: "sensitive",
      payload: {
        kind: "auth.session.revoked",
        audience: input.family.actorKind,
        sessionFamilyId: input.family.sessionFamilyId,
        reasonCode: "GUARDIAN_REVIEWED_SESSION_REVOCATION",
      },
    });
    if (
      !same(retainedEvent, expectedEvent) ||
      (await npDigestAgentEventCanonical(retainedEvent)) !== e.eventHash
    )
      fail();
    if (
      !execution ||
      execution.state !== "completed" ||
      execution.operationId !== "agents.incidents.guardian_session_execute" ||
      execution.requestHash !== row.executionInvocationFingerprint ||
      !same(execution.outputRedacted, output) ||
      execution.outputHash !== digest("np.agent-admin-output.v1", output) ||
      execution.actorKind !== "staff" ||
      execution.operationKind !== "admin" ||
      execution.transport !== "admin" ||
      !same(execution.authorityRef, original.authorityRef) ||
      execution.authorizationContextFingerprint !== original.authorizationContextFingerprint ||
      !same(execution.authorizationContextBody, original.authorizationContextBody)
    )
      fail();
    const body = npRequireAgentInvocationRequestCanonical(execution.requestBody);
    const { targetId, parentTargetId, ...value } = body.input;
    const command = npRequireAgentGuardianSessionExecuteInputV1(value);
    if (
      (await npDigestAgentInvocationRequestCanonical(body)) !== execution.requestHash ||
      body.actorFingerprint !== original.actorFingerprint ||
      body.authorizationContextFingerprint !== execution.authorizationContextFingerprint ||
      targetId !== incidentIdOf(row) ||
      parentTargetId !== null ||
      command.actionId !== row.id ||
      command.approvalId !== row.approvalId ||
      command.proposalHash !== row.inputHash ||
      command.expectedVersion !== input.command.expectedVersion
    )
      fail();
    // Audit + Action + consumed Approval + execution invocation committed with the exact deletion.
    // A new login may create another family. No historical read needs the revoked row to remain live.
    return command;
  }
  async function withTarget<T>(
    siteId: string,
    target: NpAgentApprovalTargetV1,
    viewer: NpAgentAdminActorV1 | undefined,
    work: (db: Db, action: LoadedAction) => Promise<T>,
  ): Promise<T> {
    if (target.kind !== "action") fail();
    const seed = await loadAction(getDb(), siteId, target.actionId),
      original = await invocation(getDb(), seed.row),
      initial = await approval(getDb(), seed.row);
    return transaction(siteId, async (db) => {
      await lockPeople(db, siteId, [
        { userId: original.requesterId, sessionId: original.authorityRef.sessionId },
        ...(viewer ? [{ userId: viewer.user.id, sessionId: viewer.sessionId }] : []),
        ...(initial.entry.decidedByUserId ? [{ userId: initial.entry.decidedByUserId }] : []),
      ]);
      const context = viewer ?? (await requester(db, seed.row));
      await authorize(db, { siteId, actor: context, incidentId: incidentIdOf(seed.row) }, true);
      if (viewer) await actor(db, { siteId, actor: viewer, incidentId: incidentIdOf(seed.row) });
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
        await statementMatches(db, action, checked.statement, false);
        if (action.row.state === "succeeded") await receipt(db, action);
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
        if (action.row.state === "succeeded") await receipt(db, action);
        return npRequireAgentApprovalGuardianSessionActionReviewV1({
          actionId: action.row.id,
          proposalHash: action.row.inputHash,
          capabilityId: "security.revokeSessions",
          incidentId: incidentIdOf(action.row),
          expectedTargetVersionDigest: action.input.command.expectedTargetVersionDigest,
          target: action.input.target,
          policyDigest: action.input.policyDigest,
        });
      }),
    review: () =>
      Promise.reject(
        new NpAgentGatewayError(
          "APPROVAL_NOT_FOUND",
          404,
          "Session revocation has no content ChangeSet review.",
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
            const [updated] = await db
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
              .where(
                and(
                  eq(npAgentActions.id, action.row.id),
                  eq(npAgentActions.state, action.row.state),
                ),
              )
              .returning({ id: npAgentActions.id });
            if (!updated) fail();
          },
        }),
      ),
    revalidate: ({ siteId, statement }) =>
      withTarget(siteId, statement.target, undefined, async (db, action) => {
        await statementMatches(db, action, statement, true);
        const checked = await approval(db, action.row, true);
        if (checked.entry.state === "approved")
          await approverVisible(db, action.row, checked.entry);
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
            const [updated] = await db
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
              )
              .returning({ id: npAgentActions.id });
            if (!updated) fail();
          },
        });
      });
    },
  };
  async function mutate(
    input: Input & {
      command: NpAgentGuardianSessionPlanInputV1 | NpAgentGuardianSessionExecuteInputV1;
    },
    mode: "plan" | "execute",
  ) {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodyUuid(input.incidentId, "guardianSession.incidentId");
    return transaction(input.siteId, async (db) => {
      const seeded =
        mode === "execute"
          ? await loadAction(
              db,
              input.siteId,
              npRequireAgentGuardianSessionExecuteInputV1(input.command).actionId,
            )
          : null;
      const initial = seeded ? await approval(db, seeded.row) : null;
      await lockPeople(db, input.siteId, [
        { userId: input.actor.user.id, sessionId: input.actor.sessionId },
        ...(initial?.entry.decidedByUserId ? [{ userId: initial.entry.decidedByUserId }] : []),
      ]);
      const facts = await authorize(db, input, true);
      const result = await admission({
        db,
        siteId: input.siteId,
        actor: input.actor,
        operationId:
          mode === "plan"
            ? "agents.incidents.guardian_session_plan"
            : "agents.incidents.guardian_session_execute",
        targetId: input.incidentId,
        command: input.command,
        mutate: async ({
          db,
          command: admitted,
          invocationId,
          now: time,
        }): Promise<{ resourceId: string; output: NpAgentJsonObject }> => {
          // Replayed terminal outcomes remain readable; only new effects are gated.
          await npRequireAgentGuardianNewResponseV1(db, input.siteId);
          if (
            admitted.expectedVersion !== facts.incident.versionNumber ||
            !facts.policy ||
            !facts.live ||
            ["resolved", "dismissed"].includes(facts.incident.status)
          )
            fail();
          const [invoked] = await db
            .select()
            .from(npAgentInvocations)
            .where(eq(npAgentInvocations.id, invocationId));
          if (!invoked || !invoked.auditEventId) fail();
          if (mode === "plan") {
            const command = npRequireAgentGuardianSessionPlanInputV1(admitted);
            if (command.expectedTargetVersionDigest !== facts.targetVersionDigest) fail();
            const id = randomUUID(),
              approvalId = randomUUID(),
              definition = await npGuardianSessionCapabilityDefinitionV1();
            const canonical: CanonicalInput = {
              schemaVersion: "np.agent-guardian-session-action-input.v1",
              command,
              family: facts.family,
              target: facts.target,
              sourceDigest: facts.sourceDigest,
              policyDigest: await npAgentGuardianResponsePolicyDigestV1(
                db,
                input.siteId,
                facts.policy.policyDigest,
              ),
            };
            const body = actionBody(
                { id, siteId: input.siteId, invocationFingerprint: invoked.requestHash },
                canonical,
                definition,
                input.incidentId,
              ),
              hash = await npDigestAgentActionCanonical(body);
            await db.insert(npAgentActions).values({
              id,
              siteId: input.siteId,
              invocationId,
              invocationFingerprint: invoked.requestHash,
              sequence: 1,
              capabilityId: "security.revokeSessions",
              capabilityContractVersion: 1,
              capabilityFingerprint: definition.fingerprint,
              capabilityDefinitionBody: definition.canonical,
              effectProfileId: "sessions.revoke",
              effectContractVersion: 1,
              risk: "sensitive",
              state: "approval_pending",
              idempotencyKey: command.idempotencyKey,
              inputRedacted: json(command),
              inputCanonical: json(canonical),
              requiredScopes: ["security:execute"],
              targetRefs: body.targetRefs,
              targetVersionFacts: body.targetVersionFacts,
              inputHash: hash,
              approvalId,
              auditEventId: invoked.auditEventId,
              createdAt: time,
            });
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
                capabilityId: "security.revokeSessions",
                capabilityContractVersion: 1,
                capabilityFingerprint: definition.fingerprint,
                requiredScopes: ["security:execute"],
                requiredHumanCapabilities: ["admin.manage"],
                requiredHumanPredicates: ["is-super-admin"],
                policyHashes: [canonical.policyDigest],
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
          const command = npRequireAgentGuardianSessionExecuteInputV1(admitted),
            action = await loadAction(db, input.siteId, command.actionId, true),
            original = await invocation(db, action.row);
          if (
            incidentIdOf(action.row) !== input.incidentId ||
            action.row.state !== "approved" ||
            action.row.executionInvocationId ||
            action.row.approvalId !== command.approvalId ||
            action.row.inputHash !== command.proposalHash ||
            original.staffUserId !== input.actor.user.id ||
            original.authorityRef.sessionId !== input.actor.sessionId ||
            original.authorizationContextFingerprint !== invoked.authorizationContextFingerprint
          )
            fail();
          const checked = await approval(db, action.row, true);
          if (checked.entry.state !== "approved" || checked.entry.expiresAt <= time) fail();
          await statementMatches(db, action, checked.statement, true);
          await approverVisible(db, action.row, checked.entry);
          await options.resolveApprovals().consumeAction({
            db,
            siteId: input.siteId,
            id: checked.entry.id,
            actionId: action.row.id,
            proposalHash: action.row.inputHash,
            statementHash: checked.entry.statementHash,
            consumedAt: time,
          });
          // CAS is observed even if a host trigger suppresses an UPDATE without throwing.
          const [consumed] = await db
            .select()
            .from(npAgentApprovals)
            .where(
              and(
                eq(npAgentApprovals.siteId, input.siteId),
                eq(npAgentApprovals.id, checked.entry.id),
              ),
            )
            .limit(1);
          if (
            !consumed ||
            consumed.state !== "consumed" ||
            consumed.consumedAt?.getTime() !== time.getTime() ||
            consumed.version !== checked.entry.version + 1
          )
            fail();
          // Recheck immediately before effect while all authority, target and Approval locks are held.
          const current = await authorize(db, input);
          if (
            !current.policy ||
            !current.live ||
            current.targetVersionDigest !== action.input.command.expectedTargetVersionDigest ||
            current.incident.versionNumber !== action.input.command.expectedVersion
          )
            fail();
          await approverVisible(db, action.row, checked.entry);
          await npRequireAgentGuardianNewResponseV1(db, input.siteId);
          if (
            !(await npRevokeGuardianSessionFamilyV1(
              db,
              action.input.family,
              action.input.target.createdAt,
            ))
          )
            fail();
          if (await npReadGuardianSessionFamilyV1(db, action.input.family)) fail();
          const event = npRequireAgentEventCanonical({
            version: "np.agent-event.v1",
            siteId: input.siteId,
            kind: "auth.session.revoked",
            occurredAt: time.toISOString(),
            source: { kind: "auth", component: "auth.guardian-session" },
            subject: {
              kind: "session",
              actorKind: action.input.family.actorKind,
              sessionFamilyId: action.input.family.sessionFamilyId,
            },
            actor: { kind: "staff", userId: input.actor.user.id },
            causation: null,
            correlationId: null,
            deduplicationKey: action.row.id,
            privacy: "sensitive",
            payload: {
              kind: "auth.session.revoked",
              audience: action.input.family.actorKind,
              sessionFamilyId: action.input.family.sessionFamilyId,
              reasonCode: "GUARDIAN_REVIEWED_SESSION_REVOCATION",
            },
          });
          const recorded = await options.events.record({ db, siteId: input.siteId, event });
          const auditId = randomUUID(),
            e = {
              schemaVersion: "np.agent-guardian-session-effect.v1",
              actionId: action.row.id,
              incidentId: input.incidentId,
              sessionFamilyId: action.input.family.sessionFamilyId,
              actorKind: action.input.family.actorKind,
              createdAt: action.input.target.createdAt,
              impactDigest: action.input.target.impactDigest,
              affectedSiteCount: action.input.target.affectedSiteCount,
              sourceDigest: action.input.sourceDigest,
              auditEventId: auditId,
              eventId: recorded.eventId,
              eventHash: await npDigestAgentEventCanonical(event),
              revokedAt: time.toISOString(),
            },
            effectDigest = digest("np.agent-guardian-session-effect.v1", e),
            output = { actionId: action.row.id, state: "succeeded", resultDigest: effectDigest };
          await db.insert(npAuditEvents).values({
            id: auditId,
            siteId: input.siteId,
            actorKind: "staff",
            actorUserId: input.actor.user.id,
            action: "agent.guardian_session.effect",
            targetType: "incident",
            targetId: input.incidentId,
            payload: e,
            createdAt: time,
          });
          const [finished] = await db
            .update(npAgentActions)
            .set({
              state: "succeeded",
              executionInvocationId: invocationId,
              executionInvocationFingerprint: invoked.requestHash,
              startedAt: time,
              finishedAt: time,
              outputRedacted: output,
              outputHash: digest("np.agent-guardian-session-output.v1", output),
              effectDigest,
              targetVersionDigest: action.input.command.expectedTargetVersionDigest,
              verifierId: action.definition.verifierId,
              verificationState: "passed",
              verificationResultDigest: effectDigest,
              verificationEvidence: [e],
              verifiedAt: time,
            })
            .where(and(eq(npAgentActions.id, action.row.id), eq(npAgentActions.state, "approved")))
            .returning({ id: npAgentActions.id });
          if (!finished) fail();
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
            sourceFingerprint: effectDigest,
            actionId: action.row.id,
            approvalId: action.row.approvalId,
            auditEventId: auditId,
            summary:
              "The exact human-approved browser session family was terminated. A new login remains available.",
            details: {
              schemaVersion: "np.agent-guardian-session-timeline.v1",
              actionId: action.row.id,
              capabilityId: "security.revokeSessions",
            },
            createdAt: time,
          });
          return { resourceId: action.row.id, output };
        },
      });
      // No post-effect live-session demand: the authorized operation may have terminated its requester's own session.
      // Receipt verification is independent of the target row and performs no protected user data reads.
      const retained = await loadAction(db, input.siteId, result.resourceId);
      if (mode === "execute") await receipt(db, retained);
      return { resourceId: result.resourceId, replayed: result.replayed };
    });
  }
  return {
    approvalTargets,
    plan: (input) => {
      npAssertAgentPreviewEffectsAllowed();
      return mutate(
        { ...input, command: npRequireAgentGuardianSessionPlanInputV1(input.command) },
        "plan",
      );
    },
    execute: async (input) => {
      npAssertAgentPreviewEffectsAllowed();
      const command = npRequireAgentGuardianSessionExecuteInputV1(input.command),
        before = await loadAction(getDb(), input.siteId, command.actionId);
      if (before.row.state === "succeeded")
        return transaction(input.siteId, async (db) => {
          await authorize(db, input);
          const action = await loadAction(db, input.siteId, command.actionId),
            original = await invocation(db, action.row);
          if (
            incidentIdOf(action.row) !== input.incidentId ||
            original.staffUserId !== input.actor.user.id ||
            action.row.approvalId !== command.approvalId ||
            action.row.inputHash !== command.proposalHash ||
            action.input.command.expectedVersion !== command.expectedVersion
          )
            fail();
          const executed = await receipt(db, action);
          if (!same(command, executed)) fail();
          return { resourceId: action.row.id, replayed: true };
        });
      return mutate({ ...input, command }, "execute");
    },
    get: (input) =>
      withCurrentSite(input.siteId, async () => {
        const db = getDb(),
          facts = await authorize(db, input),
          rows = await db
            .select()
            .from(npAgentActions)
            .where(
              and(
                eq(npAgentActions.siteId, input.siteId),
                eq(npAgentActions.capabilityId, "security.revokeSessions"),
                sql`${npAgentActions.targetRefs} @> ${JSON.stringify([{ kind: "incident", incidentId: input.incidentId }])}::jsonb`,
              ),
            )
            .orderBy(desc(npAgentActions.createdAt), desc(npAgentActions.id))
            .limit(26);
        const plans: NpAgentGuardianSessionV1["plans"] = [];
        for (const row of rows.slice(0, 25)) {
          const action = await loadAction(db, input.siteId, row.id),
            checked = await approval(db, row),
            original = await invocation(db, row);
          await statementMatches(db, action, checked.statement, false);
          if (row.state === "succeeded") await receipt(db, action);
          let canExecute = false;
          if (
            row.state === "approved" &&
            checked.entry.state === "approved" &&
            checked.entry.expiresAt > now() &&
            original.staffUserId === input.actor.user.id &&
            original.authorityRef.sessionId === input.actor.sessionId
          ) {
            try {
              await statementMatches(db, action, checked.statement, true);
              await approverVisible(db, row, checked.entry);
              canExecute = true;
            } catch {
              /* Current drift removes the action without inventing a result. */
            }
          }
          if (!["approval_pending", "approved", "succeeded", "failed"].includes(row.state)) fail();
          plans.push({
            actionId: row.id,
            approvalId: row.approvalId!,
            proposalHash: row.inputHash,
            state: row.state as NpAgentGuardianSessionV1["plans"][number]["state"],
            approvalExpiresAt: checked.entry.expiresAt.toISOString(),
            canExecute,
          });
        }
        const current = await authorize(db, input);
        if (
          facts.targetVersionDigest !== current.targetVersionDigest ||
          facts.incident.versionNumber !== current.incident.versionNumber ||
          facts.live !== current.live
        )
          fail();
        let captureEnabled = false;
        try {
          captureEnabled =
            (await npRequireAgentGuardianNewResponseV1(db, input.siteId)).state !== "disabled";
        } catch {
          /* Missing or disabled new-effect admission preserves historical reads. */
        }
        return npRequireAgentGuardianSessionV1({
          schemaVersion: "np.agent-guardian-session.v1",
          incidentId: input.incidentId,
          incidentVersion: facts.incident.versionNumber,
          targetVersionDigest: facts.targetVersionDigest,
          target: facts.target,
          canPlan:
            captureEnabled &&
            !!facts.policy &&
            facts.live &&
            !["resolved", "dismissed"].includes(facts.incident.status),
          plans,
          truncated: rows.length > 25,
        });
      }),
  };
}
