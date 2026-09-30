import {
  npRequireAgentAuthorizationContextCanonical,
  npDigestAgentAuthorizationContextCanonical,
} from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentStaffSiteAuthorizationCanonical } from "../agent-contract/canonical-bodies.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import {
  npResolveAgentBudgetV1,
  type NpAgentConcreteBudgetV1,
} from "../agent-contract/runtime-budget.js";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npUsers, npSiteMemberships, npSessions } from "../db/schema/system.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentIncidents,
  npAgentInvocations,
  npAgentRuns,
} from "../db/schema/agent.js";
import { withDeferredPostCommit, type NpTransaction } from "../collections/pipeline.js";
import { withCurrentSite } from "../sites/context.js";
import type { NpAuthUser } from "../config/types.js";
import {
  NpCommunityContainmentVerificationError,
  npInspectCommunityContentContainmentV1,
  npQuarantineCommunityContentV1,
  npRestoreCommunityContentV1,
  type NpCommunityContentTargetV1,
  type NpCommunityContentOriginalStateV1,
} from "../community/content-containment.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import { npCreateModerationGatewayRunV1, npMeasureModerationBudgetV1 } from "./moderation-run.js";
import {
  NpAgentGatewayError,
  npResolveLiveAgentStaffAuthorizationV1,
  npResolveAgentStaffSessionAuthorizationV1,
  type NpAgentAdminActorV1,
} from "./admin-admission.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";
import type {
  NpAgentApprovalServiceV1,
  NpAgentApprovalServiceOptionsV1,
} from "./approval-service.js";
import type { NpAgentGatewayServiceV1 } from "./gateway-service.js";
import type { createAgentIncidentWriteServiceV1 } from "./incident-write-service.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npResolveAgentPolicyV1,
  npAgentAutonomyAllowsV1,
  type NpAgentPolicyResolutionInputV1,
} from "../agent-contract/runtime-policy.js";
import {
  npRequireAgentInvocationRequestCanonical,
  npDigestAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import {
  npRequireAgentActionCanonical,
  npDigestAgentActionCanonical,
} from "../agent-contract/canonical-action.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npRequireAgentApprovalStatementCanonical } from "../agent-contract/canonical-approval.js";
import {
  npRequireAgentQuarantineProposalV1,
  npRequireAgentRestoreProposalV1,
} from "../agent-contract/moderator-contract.js";
import {
  npBuildAgentModerationCapabilityDefinitionCanonicalV1,
  npRequireAgentModerationCapabilityInputV1,
  npRequireAgentModerationCapabilityOutputV1,
  type NpAgentModerationCapabilityIdV1,
  type NpAgentModerationCapabilityInvocationRequestV1,
  type NpAgentModerationCapabilityInvocationResultV1,
} from "../agent-contract/moderation-capability-contract.js";
import type {
  NpAgentJsonObject,
  NpAgentTargetRef,
  NpAgentApprovalStatementCanonicalV1,
  NpAgentApprovalTargetV1,
} from "../agent-contract/types.js";
import type { NpAgentApprovalModerationActionReviewV1 } from "../agent-contract/approval-contract.js";

type Db = ReturnType<typeof getDb>;
type Action = typeof npAgentActions.$inferSelect;
type Containment = typeof npAgentContainments.$inferSelect;
const json = (value: object) => value as unknown as NpAgentJsonObject;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const digest = (purpose: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256")
    .update(purpose + "\0")
    .update(serializeAgentCanonicalJson(value))
    .digest("base64url")}`;
const unavailable = () =>
  new NpAgentGatewayError("MODERATION_UNAVAILABLE", 404, "Moderation target is unavailable.");
const conflict = () =>
  new NpAgentGatewayError(
    "MODERATION_CONFLICT",
    409,
    "Moderation evidence changed. Prepare a new proposal.",
  );
export interface NpAgentModerationServiceOptionsV1 {
  admission: Pick<
    NpAgentCapabilityAdmissionServiceV1,
    "withCurrentAuthority" | "withStoredAuthority"
  >;
  resolveBudget: (input: { db: Db; siteId: string }) => Promise<NpAgentConcreteBudgetV1>;
  resolveApprovals: () => NpAgentApprovalServiceV1;
  resolveTransportAudience: NpAgentGatewayServiceV1["getTransportAudience"];
  /** Trusted current policy source. Missing installation never grants authority. */
  resolvePolicy: (input: {
    db: Db;
    siteId: string;
    user: NpAuthUser;
    principalId: string;
    target: NpCommunityContentTargetV1;
  }) => Promise<NpAgentPolicyResolutionInputV1>;
  resolveStaffPolicy?: (input: {
    db: Db;
    siteId: string;
    user: NpAuthUser;
    target: NpCommunityContentTargetV1;
  }) => Promise<NpAgentPolicyResolutionInputV1>;
  canReadIncident?: (input: {
    db: Db;
    siteId: string;
    incidentId: string;
    user: NpAuthUser;
  }) => Promise<boolean>;
  incidents?: Pick<ReturnType<typeof createAgentIncidentWriteServiceV1>, "appendContainmentEvent"> &
    Partial<
      Pick<ReturnType<typeof createAgentIncidentWriteServiceV1>, "appendFailedContainmentEvent">
    >;
  now?: () => Date;
}
/** Installed only by the host. This first owner always requires fresh human approval. */
export function createAgentModerationServiceV1(options: NpAgentModerationServiceOptionsV1) {
  const now = options.now ?? (() => new Date());
  const prepare = (db: Db, siteId: string) =>
    npWithAgentRuntimeControlTransactionV1(siteId, () => Promise.resolve(undefined), db);
  async function user(db: Db, siteId: string, userId: string): Promise<NpAuthUser> {
    const authorization = await npResolveLiveAgentStaffAuthorizationV1(db, siteId, userId);
    if (!authorization.authority.capabilities.includes("community.moderate")) throw unavailable();
    const [row] = await db.select().from(npUsers).where(eq(npUsers.id, userId)).limit(1);
    if (!row) throw unavailable();
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role:
        authorization.authority.kind === "super-admin"
          ? "admin"
          : (authorization.authority.role as NpAuthUser["role"]),
      tokenVersion: row.tokenVersion,
    };
  }
  async function entry(id: NpAgentModerationCapabilityIdV1) {
    const canonical = npBuildAgentModerationCapabilityDefinitionCanonicalV1(id);
    return {
      canonical,
      fingerprint: await npDigestAgentCapabilityRegistryCanonical(
        canonical,
        canonical.capabilities,
      ),
      descriptor: canonical.capabilities[0].descriptor,
    };
  }
  async function loadAction(db: Db, siteId: string, id: string) {
    const [row] = await db
      .select()
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, id)))
      .for("update")
      .limit(1);
    if (!row || !["moderation.quarantine", "moderation.restore"].includes(row.capabilityId))
      throw unavailable();
    const definition = await entry(row.capabilityId as NpAgentModerationCapabilityIdV1);
    const canonical = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId,
      actionId: row.id,
      invocationFingerprint: row.invocationFingerprint,
      runFingerprint: row.runFingerprint,
      sequence: row.sequence,
      capabilityId: row.capabilityId,
      capabilityContractVersion: row.capabilityContractVersion,
      capabilityFingerprint: row.capabilityFingerprint,
      effectProfile: { id: row.effectProfileId, contractVersion: row.effectContractVersion },
      risk: row.risk,
      requiredScopes: row.requiredScopes,
      targetRefs: row.targetRefs,
      targetVersionFacts: row.targetVersionFacts,
      input: row.inputCanonical,
    });
    if (
      row.capabilityFingerprint !== definition.fingerprint ||
      !same(row.capabilityDefinitionBody, definition.canonical) ||
      (await npDigestAgentActionCanonical(canonical)) !== row.inputHash
    )
      throw conflict();
    return row;
  }
  async function invocation(db: Db, siteId: string, id: string | null) {
    if (!id) throw unavailable();
    const [row] = await db
      .select()
      .from(npAgentInvocations)
      .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, id)))
      .limit(1);
    if (
      !row ||
      (await npDigestAgentInvocationRequestCanonical(
        npRequireAgentInvocationRequestCanonical(row.requestBody),
      )) !== row.requestHash
    )
      throw conflict();
    return row;
  }
  async function resolveTarget(
    db: Db,
    siteId: string,
    capabilityId: NpAgentModerationCapabilityIdV1,
    proposal: unknown,
    viewer: NpAuthUser,
    fresh = true,
  ) {
    let target: NpCommunityContentTargetV1,
      expectedVersionDigest: string,
      incidentId: string | null,
      containment: Containment | null = null;
    if (capabilityId === "moderation.quarantine") {
      const p = npRequireAgentQuarantineProposalV1(proposal);
      ({ target, expectedVersionDigest, incidentId } = p);
    } else {
      const p = npRequireAgentRestoreProposalV1(proposal);
      const [row] = await db
        .select()
        .from(npAgentContainments)
        .where(
          and(eq(npAgentContainments.siteId, siteId), eq(npAgentContainments.id, p.containmentId)),
        )
        .for("update")
        .limit(1);
      if (
        !row ||
        row.kind !== "content_quarantine" ||
        (fresh ? row.state !== "active" : !["active", "restored"].includes(row.state)) ||
        row.targetVersionDigest !== p.expectedVersionDigest
      )
        throw conflict();
      containment = row;
      target = npRequireAgentQuarantineProposalV1({
        incidentId: row.incidentId,
        target: row.targetRef,
        expectedVersionDigest: row.targetVersionDigest,
        reasonCode: "RESTORE",
      }).target;
      expectedVersionDigest = p.expectedVersionDigest;
      incidentId = row.incidentId;
      const source = await loadAction(db, siteId, row.sourceActionId);
      if (
        (fresh
          ? source.state !== "succeeded"
          : !["succeeded", "compensated"].includes(source.state)) ||
        source.containmentId !== row.id ||
        source.targetVersionDigest !== row.targetVersionDigest
      )
        throw conflict();
      const originalDigest = digest("np.agent-moderation-original.v1", row.originalState);
      const expectedResult = digest("np.agent-moderation-result.v1", {
        actionId: source.id,
        state: "succeeded",
        evidence: source.verificationEvidence,
      });
      if (
        source.outputHash !== digest("np.agent-capability-output.v1", source.outputRedacted) ||
        source.outputRedacted?.resultDigest !== expectedResult ||
        source.effectDigest !== expectedResult ||
        source.verificationResultDigest !== expectedResult ||
        source.verificationState !== "passed" ||
        row.originalState.versionDigest !== source.targetVersionFacts[0]?.versionDigest
      )
        throw conflict();
      if (
        !source.verificationEvidence?.some(
          (fact) => fact.containmentId === row.id && fact.originalStateDigest === originalDigest,
        )
      )
        throw conflict();
    }
    if (incidentId !== null) {
      const [incident] = await db
        .select({ id: npAgentIncidents.id, status: npAgentIncidents.status })
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, incidentId)))
        .limit(1);
      if (
        !incident ||
        (fresh &&
          capabilityId === "moderation.quarantine" &&
          ["resolved", "dismissed"].includes(incident.status)) ||
        !options.incidents ||
        (await options.canReadIncident?.({ db, siteId, incidentId, user: viewer })) !== true
      )
        throw unavailable();
    }
    const inspected = await npInspectCommunityContentContainmentV1(db as unknown as NpTransaction, {
      siteId,
      target,
      user: viewer,
    });
    if (fresh && inspected.versionDigest !== expectedVersionDigest) throw conflict();
    return { target, expectedVersionDigest, incidentId, containment };
  }
  async function policy(
    db: Db,
    siteId: string,
    viewer: NpAuthUser,
    principalId: string | null,
    target: NpCommunityContentTargetV1,
    capabilityId: NpAgentModerationCapabilityIdV1,
    incidentId: string | null = null,
  ) {
    const source = principalId
      ? await options.resolvePolicy({ db, siteId, user: viewer, principalId, target })
      : await options.resolveStaffPolicy?.({ db, siteId, user: viewer, target });
    if (!source) throw unavailable();
    const resolved = npResolveAgentPolicyV1(source);
    const mode = resolved.capabilityModes.find((item) => item.capabilityId === capabilityId)?.mode;
    if (
      !mode ||
      !npAgentAutonomyAllowsV1(mode, "request-approval") ||
      (resolved.resources.collections !== null &&
        !resolved.resources.collections.includes(target.collection)) ||
      resolved.automation.moderationTargetsPerRun < 1 ||
      (resolved.risk.requirePreviewAtOrAbove !== null &&
        { reversible: 1, sensitive: 2, destructive: 3 }[resolved.risk.requirePreviewAtOrAbove] <=
          (capabilityId === "moderation.quarantine" ? 1 : 2))
    )
      throw unavailable();
    if (incidentId !== null && resolved.resources.incidentCategories !== null) {
      const [incident] = await db
        .select()
        .from(npAgentIncidents)
        .where(and(eq(npAgentIncidents.siteId, siteId), eq(npAgentIncidents.id, incidentId)))
        .limit(1);
      if (
        !incident ||
        !resolved.resources.incidentCategories.some((category) => category === incident.category)
      )
        throw unavailable();
    }
    return [
      digest("np.agent-moderation-policy.v1", {
        resolved,
        budget: npResolveAgentBudgetV1(await options.resolveBudget({ db, siteId })),
      }),
    ];
  }
  async function review(
    db: Db,
    row: Action,
    viewer: NpAuthUser,
    fresh = false,
  ): Promise<NpAgentApprovalModerationActionReviewV1> {
    const id = row.capabilityId as NpAgentModerationCapabilityIdV1;
    const target = await resolveTarget(db, row.siteId, id, row.inputCanonical, viewer, fresh);
    return {
      actionId: row.id,
      proposalHash: row.inputHash,
      capabilityId: id,
      target: target.target,
      expectedVersionDigest: target.expectedVersionDigest,
      containmentId: target.containment?.id ?? null,
      incidentId: target.incidentId,
      reasonCode:
        id === "moderation.quarantine"
          ? npRequireAgentQuarantineProposalV1(row.inputCanonical).reasonCode
          : null,
    };
  }
  async function assertStatement(
    db: Db,
    row: Action,
    statement: NpAgentApprovalStatementCanonicalV1,
    viewer: NpAuthUser,
  ) {
    const original = await invocation(db, row.siteId, row.invocationId);
    const facts = await review(db, row, viewer, true);
    if (
      statement.target.kind !== "action" ||
      statement.target.actionId !== row.id ||
      statement.target.proposalHash !== row.inputHash ||
      statement.capabilityFingerprint !== row.capabilityFingerprint ||
      statement.capabilityId !== row.capabilityId ||
      statement.target.runId !== row.runId ||
      (original.actorKind === "staff"
        ? statement.requester.kind !== "staff" ||
          statement.requester.userId !== original.staffUserId
        : statement.requester.kind !== "principal" ||
          statement.requester.principalId !== original.principalId) ||
      statement.requester.fingerprint !== original.actorFingerprint ||
      !same(statement.requiredScopes, row.requiredScopes) ||
      !same(
        statement.policyHashes,
        await policy(
          db,
          row.siteId,
          viewer,
          original.principalId,
          facts.target,
          facts.capabilityId,
          facts.incidentId,
        ),
      )
    )
      throw conflict();
  }
  async function assertLiveApprover(
    db: Db,
    action: Action,
    approval: typeof npAgentApprovals.$inferSelect,
    statement: NpAgentApprovalStatementCanonicalV1,
  ) {
    if (!approval.decidedByUserId)
      throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 403, "Approval authority changed.");
    await db
      .select({ id: npUsers.id })
      .from(npUsers)
      .where(eq(npUsers.id, approval.decidedByUserId))
      .for("update");
    await db
      .select({ role: npSiteMemberships.role })
      .from(npSiteMemberships)
      .where(
        and(
          eq(npSiteMemberships.siteId, action.siteId),
          eq(npSiteMemberships.userId, approval.decidedByUserId),
        ),
      )
      .for("update");
    const authority = await npResolveLiveAgentStaffAuthorizationV1(
      db,
      action.siteId,
      approval.decidedByUserId,
    );
    if (
      !authority.authority.capabilities.includes("site.access") ||
      statement.requiredHumanCapabilities.some(
        (capability) => !authority.authority.capabilities.includes(capability),
      ) ||
      (statement.requiredHumanPredicates.includes("is-super-admin") &&
        authority.authority.kind !== "super-admin")
    )
      throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 403, "Approval authority changed.");
    if (
      statement.requester.kind === "staff" &&
      statement.requester.userId === approval.decidedByUserId
    )
      throw unavailable();
    await review(db, action, await user(db, action.siteId, approval.decidedByUserId), true);
  }
  async function storedStaff(db: Db, original: typeof npAgentInvocations.$inferSelect) {
    const context = npRequireAgentAuthorizationContextCanonical(original.authorizationContextBody);
    const ref = context.authorityRef;
    if (
      original.actorKind !== "staff" ||
      ref.kind !== "staff-session" ||
      context.actor.kind !== "staff" ||
      context.actor.userId !== original.staffUserId ||
      context.actor.actorFingerprint !== original.actorFingerprint ||
      (await npDigestAgentAuthorizationContextCanonical(context)) !==
        original.authorizationContextFingerprint
    )
      throw unavailable();
    const [row] = await db
      .select()
      .from(npUsers)
      .where(eq(npUsers.id, ref.userId))
      .for("update")
      .limit(1);
    await db
      .select({ id: npSessions.id })
      .from(npSessions)
      .where(eq(npSessions.id, ref.sessionId))
      .for("update");
    await db
      .select({ role: npSiteMemberships.role })
      .from(npSiteMemberships)
      .where(
        and(
          eq(npSiteMemberships.siteId, original.siteId),
          eq(npSiteMemberships.userId, ref.userId),
        ),
      )
      .for("update");
    if (!row || row.tokenVersion !== ref.userTokenVersion) throw unavailable();
    const viewer = await user(db, original.siteId, row.id);
    const authority = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      original.siteId,
      { user: viewer, sessionId: ref.sessionId },
      now(),
    );
    if (
      !authority.authority.capabilities.includes("admin.manage") ||
      (await npDigestAgentStaffSiteAuthorizationCanonical(authority)) !==
        ref.siteAuthorizationDigest
    )
      throw unavailable();
    return viewer;
  }
  async function withTarget<T>(
    siteId: string,
    target: NpAgentApprovalTargetV1,
    actor: NpAgentAdminActorV1 | undefined,
    mutate: (db: Db, row: Action, viewer: NpAuthUser) => Promise<T>,
  ) {
    if (target.kind !== "action") throw unavailable();
    const [seed] = await getDb()
      .select()
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, target.actionId)))
      .limit(1);
    if (!seed) throw unavailable();
    const original = await invocation(getDb(), siteId, seed.invocationId);
    if (original.actorKind === "staff")
      return withCurrentSite(siteId, () =>
        getDb().transaction(
          async (db) => {
            await prepare(db, siteId);
            const requester = await storedStaff(db, original);
            const row = await loadAction(db, siteId, target.actionId);
            if (
              row.inputHash !== target.proposalHash ||
              row.runId !== null ||
              target.runId !== null ||
              !same(seed.inputCanonical, row.inputCanonical)
            )
              throw conflict();
            if (actor) {
              const authority = await npResolveAgentStaffSessionAuthorizationV1(
                db,
                siteId,
                actor,
                now(),
              );
              if (!authority.authority.capabilities.includes("admin.manage")) throw unavailable();
              await review(db, row, await user(db, siteId, actor.user.id));
            }
            return mutate(db, row, requester);
          },
          { isolationLevel: "serializable" },
        ),
      );
    return withCurrentSite(siteId, () =>
      options.admission.withStoredAuthority({
        authorizationContext: original.authorizationContextBody,
        authorizationContextFingerprint: original.authorizationContextFingerprint,
        requiredScopes: ["moderation:execute"],
        minimumExposure: "propose",
        prepareTransaction: (db) => prepare(db, siteId),
        resolveTransportAudience: options.resolveTransportAudience,
        mutate: async (db, _time, authentication) => {
          const auth = authentication.principal.authority;
          if (auth.kind !== "user" || !auth.userId) throw unavailable();
          const requester = await user(db, siteId, auth.userId);
          if (actor) {
            await npResolveAgentStaffSessionAuthorizationV1(db, siteId, actor, now());
            await user(db, siteId, actor.user.id);
          }
          const row = await loadAction(db, siteId, target.actionId);
          if (
            row.inputHash !== target.proposalHash ||
            row.runId !== target.runId ||
            !same(seed.inputCanonical, row.inputCanonical)
          )
            throw conflict();
          if (actor) await review(db, row, await user(db, siteId, actor.user.id));
          return mutate(db, row, requester);
        },
      }),
    );
  }
  const approvalTargets: NpAgentApprovalServiceOptionsV1["targets"] = {
    visible: async ({ siteId, target, actor }) =>
      withTarget(siteId, target, actor, async (db, row, viewer) => {
        await review(db, row, viewer);
        return {
          operationCount: 1,
          targetCount: 1,
          previewState: null,
          checksRun: null,
          rollbackPlan: row.capabilityId === "moderation.quarantine" ? "available" : "unavailable",
        };
      }),
    actionReview: async ({ siteId, target, actor }) =>
      withTarget(siteId, target, actor, (db, row, viewer) => review(db, row, viewer)),
    review: () => Promise.reject(unavailable()),
    withAuthority: async ({ siteId, target, actor, decision, mutate }) =>
      withTarget(siteId, target, actor, (db, row, viewer) =>
        mutate(db, {
          verify: async (statement) => {
            if (
              decision === "approve" &&
              statement.requester.kind === "staff" &&
              statement.requester.userId === actor.user.id
            )
              throw unavailable();
            await assertStatement(db, row, statement, viewer);
            if (!["approval_pending", "approved"].includes(row.state)) throw conflict();
          },
          transition: async (state) => {
            const time = now();
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
                finishedAt: failed ? time : null,
              })
              .where(eq(npAgentActions.id, row.id));
            if (failed && row.runId)
              await db
                .update(npAgentRuns)
                .set({
                  state: "failed",
                  errorCode: decision === "reject" ? "APPROVAL_REJECTED" : "APPROVAL_REVOKED",
                  errorMessage: "The required human approval is no longer available.",
                  finishedAt: time,
                })
                .where(
                  and(
                    eq(npAgentRuns.siteId, siteId),
                    eq(npAgentRuns.id, row.runId),
                    eq(npAgentRuns.state, "waiting_approval"),
                  ),
                );
          },
        }),
      ),
    revalidate: async ({ siteId, statement }) =>
      withTarget(siteId, statement.target, undefined, async (db, row, viewer) => {
        await assertStatement(db, row, statement, viewer);
        const [approval] = await db
          .select()
          .from(npAgentApprovals)
          .where(
            and(eq(npAgentApprovals.siteId, siteId), eq(npAgentApprovals.id, statement.approvalId)),
          )
          .for("update");
        if (approval?.state === "approved") await assertLiveApprover(db, row, approval, statement);
      }),
    expire: async ({ siteId, target, mutate }) => {
      if (target.kind !== "action") throw unavailable();
      return getDb().transaction(async (db) => {
        const row = await loadAction(db, siteId, target.actionId);
        return mutate(db, {
          verify: () => {
            if (row.inputHash !== target.proposalHash) throw conflict();
            return Promise.resolve();
          },
          transition: async () => {
            const time = now();
            const [approval] = await db
              .select({ state: npAgentApprovals.state })
              .from(npAgentApprovals)
              .where(
                and(eq(npAgentApprovals.siteId, siteId), eq(npAgentApprovals.id, row.approvalId!)),
              );
            if (!approval || !["expired", "revoked"].includes(approval.state)) throw conflict();
            const errorCode =
              approval.state === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_REVOKED";
            await db
              .update(npAgentActions)
              .set({ state: "failed", errorCode, finishedAt: time })
              .where(
                and(
                  eq(npAgentActions.id, row.id),
                  sql`${npAgentActions.state} in ('approval_pending','approved')`,
                ),
              );
            if (row.runId)
              await db
                .update(npAgentRuns)
                .set({
                  state: "failed",
                  errorCode,
                  errorMessage: "The required human approval is no longer available.",
                  finishedAt: time,
                })
                .where(
                  and(
                    eq(npAgentRuns.siteId, siteId),
                    eq(npAgentRuns.id, row.runId),
                    eq(npAgentRuns.state, "waiting_approval"),
                  ),
                );
          },
        });
      });
    },
  };
  async function perform(input: {
    db: Db;
    siteId: string;
    time: Date;
    viewer: NpAuthUser;
    principalId: string | null;
    actorFingerprint: string;
    authorizationContextFingerprint: string;
    invocationId: string;
    requestHash: string;
    auditId: string;
    capabilityId: NpAgentModerationCapabilityIdV1;
    parsed: ReturnType<typeof npRequireAgentModerationCapabilityInputV1>;
    idempotencyKey: string;
  }) {
    const {
      db,
      siteId,
      time,
      viewer,
      principalId,
      actorFingerprint,
      authorizationContextFingerprint,
      invocationId,
      requestHash,
      auditId,
      capabilityId,
      parsed,
      idempotencyKey,
    } = input;
    const definition = await entry(capabilityId);
    const profile =
      capabilityId === "moderation.quarantine" ? "containment.create" : "containment.restore";
    let actionId: string, runId: string | null, output: object;
    if (parsed.mode === "propose") {
      const target = await resolveTarget(db, siteId, capabilityId, parsed.proposal, viewer);
      const policyHashes = await policy(
        db,
        siteId,
        viewer,
        principalId,
        target.target,
        capabilityId,
        target.incidentId,
      );
      const targetRef: NpAgentTargetRef =
        target.target.kind === "document"
          ? {
              kind: "document",
              collection: target.target.collection,
              documentId: target.target.id,
            }
          : {
              kind: "comment",
              collection: target.target.collection,
              commentId: target.target.id,
            };
      const run = principalId
        ? await npCreateModerationGatewayRunV1({
            db,
            siteId,
            principalId: principalId,
            invocationId,
            capabilityId,
            now: time,
            target: targetRef,
            budget: await options.resolveBudget({ db, siteId }),
          })
        : null;
      if (!run)
        await npMeasureModerationBudgetV1({
          db,
          siteId,
          now: time,
          target: targetRef,
          budget: await options.resolveBudget({ db, siteId }),
          reserveRun: false,
        });
      const deadlineAt = run?.deadlineAt ?? new Date(time.getTime() + 900000);
      runId = run?.id ?? null;
      actionId = randomUUID();
      const approvalId = randomUUID();
      const canonical = npRequireAgentActionCanonical({
        schemaVersion: "np.agent-action.v1",
        siteId,
        actionId,
        invocationFingerprint: requestHash,
        runFingerprint: run?.fingerprint ?? null,
        sequence: 1,
        capabilityId,
        capabilityContractVersion: 1,
        capabilityFingerprint: definition.fingerprint,
        effectProfile: { id: profile, contractVersion: 1 },
        risk: definition.descriptor.risk,
        requiredScopes: ["moderation:execute"],
        targetRefs: [{ ...targetRef }],
        targetVersionFacts: [
          { targetRef: { ...targetRef }, versionDigest: target.expectedVersionDigest },
        ],
        input: json(parsed.proposal),
      });
      const proposalHash = await npDigestAgentActionCanonical(canonical);
      await db.insert(npAgentActions).values({
        id: actionId,
        siteId,
        runId,
        runFingerprint: run?.fingerprint ?? null,
        invocationId,
        invocationFingerprint: requestHash,
        sequence: 1,
        capabilityId,
        capabilityContractVersion: 1,
        capabilityFingerprint: definition.fingerprint,
        capabilityDefinitionBody: definition.canonical,
        effectProfileId: profile,
        effectContractVersion: 1,
        risk: definition.descriptor.risk,
        state: "approval_pending",
        idempotencyKey,
        inputRedacted: json(parsed.proposal),
        inputCanonical: json(parsed.proposal),
        requiredScopes: canonical.requiredScopes,
        targetRefs: canonical.targetRefs,
        targetVersionFacts: canonical.targetVersionFacts,
        inputHash: proposalHash,
        approvalId,
        containmentId: target.containment?.id ?? null,
        compensatesActionId: target.containment?.sourceActionId ?? null,
        auditEventId: auditId,
        createdAt: time,
      });
      const statement = npRequireAgentApprovalStatementCanonical({
        version: "np.agent-approval-statement.v1",
        siteId,
        approvalId,
        requester: principalId
          ? { kind: "principal", principalId, fingerprint: actorFingerprint }
          : { kind: "staff", userId: viewer.id, fingerprint: actorFingerprint },
        target: { kind: "action", actionId, runId, agentId: null, proposalHash },
        capabilityId,
        capabilityContractVersion: 1,
        capabilityFingerprint: definition.fingerprint,
        requiredScopes: ["moderation:execute"],
        requiredHumanCapabilities: principalId
          ? ["community.moderate"]
          : ["admin.manage", "community.moderate"],
        requiredHumanPredicates: [],
        policyHashes,
        requiresLivePreview: false,
        previewId: null,
        previewDigest: null,
        risk: definition.descriptor.risk,
        reauthentication: {
          mode: "recent",
          maxAgeSeconds: 300,
          assurance: "staff-primary",
        },
        createdAt: time.toISOString(),
        expiresAt: deadlineAt.toISOString(),
      });
      await options.resolveApprovals().create({ db, statement, generation: 1 });
      output = {
        state: "approval_required",
        runId,
        actionId,
        approvalId,
        proposalHash,
        approvalResource: `/admin/agents/approvals/${approvalId}`,
        expiresAt: deadlineAt.toISOString(),
      };
    } else {
      const action = await loadAction(db, siteId, parsed.actionId);
      actionId = action.id;
      runId = action.runId;
      const original = await invocation(db, siteId, action.invocationId);
      if (
        action.capabilityId !== capabilityId ||
        action.state !== "approved" ||
        action.approvalId !== parsed.approvalId ||
        action.inputHash !== parsed.proposalHash ||
        original.principalId !== principalId ||
        (principalId === null && original.staffUserId !== viewer.id) ||
        original.authorizationContextFingerprint !== authorizationContextFingerprint ||
        action.executionInvocationId
      )
        throw conflict();
      const target = await resolveTarget(db, siteId, capabilityId, action.inputCanonical, viewer);
      const [approval] = await db
        .select()
        .from(npAgentApprovals)
        .where(and(eq(npAgentApprovals.siteId, siteId), eq(npAgentApprovals.id, parsed.approvalId)))
        .for("update")
        .limit(1);
      if (!approval) throw unavailable();
      const checked = await options.resolveApprovals().verify(approval);
      await assertStatement(db, action, checked.statement, viewer);
      await assertLiveApprover(db, action, approval, checked.statement);
      if (principalId && !runId) throw conflict();
      const [run] = await db
        .select()
        .from(npAgentRuns)
        .where(
          and(
            eq(npAgentRuns.siteId, siteId),
            eq(npAgentRuns.id, runId ?? "00000000-0000-0000-0000-000000000000"),
          ),
        )
        .for("update")
        .limit(1);
      if (
        runId &&
        (!run || run.state !== "waiting_approval" || run.deadlineAt <= time || run.finishedAt)
      )
        throw conflict();
      await npMeasureModerationBudgetV1({
        db,
        siteId,
        now: time,
        target: action.targetRefs[0],
        budget: await options.resolveBudget({ db, siteId }),
        reserveRun: false,
      });
      await options.resolveApprovals().consumeAction({
        db,
        siteId,
        id: approval.id,
        actionId,
        proposalHash: action.inputHash,
        statementHash: approval.statementHash,
        consumedAt: time,
      });
      let containmentId: string,
        resultVersion: string,
        originalStateDigest: string | null = null,
        state: "succeeded" | "compensated";
      if (capabilityId === "moderation.quarantine") {
        const p = npRequireAgentQuarantineProposalV1(action.inputCanonical);
        containmentId = randomUUID();
        let changed: Awaited<ReturnType<typeof npQuarantineCommunityContentV1>>;
        try {
          changed = await withDeferredPostCommit(() =>
            db.transaction(async (tx) => {
              const result = await npQuarantineCommunityContentV1(tx as unknown as NpTransaction, {
                siteId,
                target: target.target,
                user: viewer,
                expectedVersionDigest: p.expectedVersionDigest,
                reasonCode: p.reasonCode,
              });
              const verified = await npInspectCommunityContentContainmentV1(
                tx as unknown as NpTransaction,
                {
                  siteId,
                  target: target.target,
                  user: viewer,
                },
              );
              if (verified.versionDigest !== result.installedVersionDigest)
                throw new NpCommunityContainmentVerificationError();
              return result;
            }),
          );
        } catch (error) {
          // Only a typed post-write mismatch, after the savepoint has rolled back,
          // establishes failure. Permission, CAS, hook/DB and unknown errors still abort.
          if (
            !(error instanceof NpCommunityContainmentVerificationError) ||
            (target.incidentId && !options.incidents?.appendFailedContainmentEvent)
          )
            throw error;
          const errorCode = "CONTAINMENT_VERIFICATION_FAILED";
          const evidence = [{ outcome: "rolled_back", reasonCode: errorCode }];
          const resultDigest = digest("np.agent-moderation-result.v1", {
            actionId,
            state: "failed",
            evidence,
          });
          const failedOutput = {
            schemaVersion: "np.agent-direct-action.v1",
            actionId,
            state: "failed",
            containmentId: null,
            resultDigest,
            verificationRefs: [],
          };
          const validated = npRequireAgentModerationCapabilityOutputV1(capabilityId, failedOutput);
          const outputHash = digest("np.agent-capability-output.v1", validated);
          await db
            .update(npAgentActions)
            .set({
              state: "failed",
              errorCode,
              executionInvocationId: invocationId,
              executionInvocationFingerprint: requestHash,
              verifierId: "containment.verify",
              verificationState: "failed",
              verificationResultDigest: resultDigest,
              verificationEvidence: evidence,
              verifiedAt: time,
              startedAt: time,
              finishedAt: time,
              outputRedacted: json(validated),
              outputHash,
            })
            .where(eq(npAgentActions.id, actionId));
          if (runId)
            await db
              .update(npAgentRuns)
              .set({
                state: "failed",
                errorCode,
                errorMessage:
                  "Content quarantine verification failed; the attempt was rolled back.",
                result: json(validated),
                finishedAt: time,
              })
              .where(eq(npAgentRuns.id, runId));
          await db
            .update(npAuditEvents)
            .set({
              payload: sql`${npAuditEvents.payload} || ${JSON.stringify({
                actionId,
                invocationId,
                requestHash,
                outcome: "rolled_back",
                errorCode,
              })}::jsonb`,
            })
            .where(and(eq(npAuditEvents.siteId, siteId), eq(npAuditEvents.id, auditId)));
          if (target.incidentId)
            await options.incidents!.appendFailedContainmentEvent!({
              db,
              siteId,
              incidentId: target.incidentId,
              actionId,
              auditEventId: auditId,
            });
          return { actionId, runId, output: json(validated), outputHash };
        }
        resultVersion = changed.installedVersionDigest;
        originalStateDigest = digest("np.agent-moderation-original.v1", changed.originalState);
        state = "succeeded";
        await db.insert(npAgentContainments).values({
          id: containmentId,
          siteId,
          kind: "content_quarantine",
          targetKind: target.target.kind,
          targetRef: json(target.target),
          targetVersionDigest: resultVersion,
          sourceActionId: actionId,
          incidentId: target.incidentId,
          state: "active",
          originalState: json(changed.originalState),
          activatedAt: time,
          createdAt: time,
          updatedAt: time,
        });
      } else {
        const containment = target.containment;
        if (!containment) throw conflict();
        containmentId = containment.id;
        const changed = await npRestoreCommunityContentV1(db as unknown as NpTransaction, {
          siteId,
          target: target.target,
          user: viewer,
          expectedVersionDigest: target.expectedVersionDigest,
          originalState: containment.originalState as unknown as NpCommunityContentOriginalStateV1,
        });
        resultVersion = changed.restoredVersionDigest;
        state = "compensated";
        await db
          .update(npAgentContainments)
          .set({
            state: "restored",
            restoreActionId: actionId,
            restoredAt: time,
            updatedAt: time,
          })
          .where(eq(npAgentContainments.id, containmentId));
        const compensationEvidence = [
          {
            containmentId,
            restoredVersionDigest: resultVersion,
            restoreActionId: actionId,
          },
        ];
        await db
          .update(npAgentActions)
          .set({
            state: "compensated",
            compensatedAt: time,
            compensationEvidence,
            compensationResultDigest: digest(
              "np.agent-moderation-compensation.v1",
              compensationEvidence,
            ),
          })
          .where(eq(npAgentActions.id, containment.sourceActionId));
      }
      // Quarantine verification already belongs to the rollback-capable savepoint.
      if (capabilityId === "moderation.restore") {
        const verified = await npInspectCommunityContentContainmentV1(
          db as unknown as NpTransaction,
          { siteId, target: target.target, user: viewer },
        );
        if (verified.versionDigest !== resultVersion) throw conflict();
      }
      const evidence = [{ containmentId, targetVersionDigest: resultVersion, originalStateDigest }];
      const resultDigest = digest("np.agent-moderation-result.v1", {
        actionId,
        state,
        evidence,
      });
      output = {
        schemaVersion: "np.agent-direct-action.v1",
        actionId,
        state,
        containmentId,
        resultDigest,
        verificationRefs: [`containment:${containmentId}`],
      };
      await db
        .update(npAgentActions)
        .set({
          state: capabilityId === "moderation.restore" ? "compensated" : "succeeded",
          executionInvocationId: invocationId,
          executionInvocationFingerprint: requestHash,
          containmentId,
          effectDigest: resultDigest,
          targetVersionDigest: resultVersion,
          verifierId:
            capabilityId === "moderation.quarantine"
              ? "containment.verify"
              : "containment.restore.verify",
          verificationState: "passed",
          verificationResultDigest: resultDigest,
          verificationEvidence: evidence,
          verifiedAt: time,
          startedAt: time,
          finishedAt: time,
          ...(capabilityId === "moderation.quarantine"
            ? { undoRef: { containmentId }, compensatorId: "containment.compensate" }
            : {
                compensatedAt: time,
                compensationResultDigest: resultDigest,
                compensationEvidence: evidence,
              }),
        })
        .where(eq(npAgentActions.id, actionId));
      if (runId)
        await db
          .update(npAgentRuns)
          .set({ state: "succeeded", result: json(output), finishedAt: time })
          .where(eq(npAgentRuns.id, runId));
      if (target.incidentId)
        await options.incidents!.appendContainmentEvent({
          db,
          siteId,
          incidentId: target.incidentId,
          actionId,
          containmentId,
          phase: capabilityId === "moderation.quarantine" ? "quarantined" : "restored",
          auditEventId: auditId,
        });
    }
    const validated = principalId
      ? npRequireAgentModerationCapabilityOutputV1(capabilityId, output)
      : output;
    const outputHash = digest("np.agent-capability-output.v1", validated);
    await db
      .update(npAgentActions)
      .set({ outputRedacted: json(validated), outputHash })
      .where(eq(npAgentActions.id, actionId));
    return { actionId, runId, output: json(validated), outputHash };
  }
  async function invokeCapability(input: {
    authentication: NpAgentCapabilityAuthenticationV1;
    request: NpAgentModerationCapabilityInvocationRequestV1;
  }): Promise<NpAgentModerationCapabilityInvocationResultV1> {
    npAssertAgentPreviewEffectsAllowed();
    const { authentication, request } = input;
    const capabilityId = request.capabilityId;
    const parsed = npRequireAgentModerationCapabilityInputV1(capabilityId, request.arguments.input);
    const idempotencyKey = request.arguments.idempotencyKey;
    if (
      typeof idempotencyKey !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(idempotencyKey)
    )
      throw conflict();
    const auth = authentication.principal.authority;
    if (auth.kind !== "user" || !auth.userId) throw unavailable();
    const siteId = authentication.principal.siteId;
    const definition = await entry(capabilityId);
    const profile =
      capabilityId === "moderation.quarantine" ? "containment.create" : "containment.restore";
    const requestBody = npRequireAgentInvocationRequestCanonical({
      schemaVersion: "np.agent-idempotency-request.v1",
      siteId,
      actorKind: "principal",
      actorFingerprint: authentication.authorizationContext.actor.actorFingerprint,
      authorizationContextFingerprint: authentication.authorizationContextFingerprint,
      operationKind: "capability",
      operationId: capabilityId,
      contractVersion: 1,
      contractFingerprint: definition.fingerprint,
      effectProfile: {
        id: parsed.mode === "propose" ? "domain.read" : profile,
        contractVersion: 1,
      },
      input: json(parsed),
    });
    const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
    return withCurrentSite(siteId, () =>
      withDeferredPostCommit(() =>
        options.admission.withCurrentAuthority({
          authentication,
          requiredScopes: ["moderation:execute"],
          prepareTransaction: (db) => prepare(db, siteId),
          minimumExposure: parsed.mode === "propose" ? "propose" : "approved-execute",
          mutate: async (db, time) => {
            await db.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-moderation:${siteId}:${authentication.principal.id}:${idempotencyKey}`},0))`,
            );
            const viewer = await user(db, siteId, auth.userId!);
            const [prior] = await db
              .select()
              .from(npAgentInvocations)
              .where(
                and(
                  eq(npAgentInvocations.siteId, siteId),
                  eq(npAgentInvocations.actorFingerprint, requestBody.actorFingerprint),
                  eq(
                    npAgentInvocations.authorizationContextFingerprint,
                    authentication.authorizationContextFingerprint,
                  ),
                  eq(npAgentInvocations.operationId, capabilityId),
                  eq(npAgentInvocations.idempotencyKey, idempotencyKey),
                ),
              )
              .limit(1);
            if (prior) {
              if (
                prior.requestHash !== requestHash ||
                prior.state !== "completed" ||
                prior.expiresAt <= time ||
                !prior.outputRedacted ||
                prior.outputHash !== digest("np.agent-capability-output.v1", prior.outputRedacted)
              )
                throw conflict();
              const action = await loadAction(db, siteId, prior.resultId!);
              // Replay still requires current target visibility and policy, but never repeats the mutation.
              const proposal =
                capabilityId === "moderation.quarantine"
                  ? npRequireAgentQuarantineProposalV1(action.inputCanonical)
                  : npRequireAgentRestoreProposalV1(action.inputCanonical);
              const [containment] = action.containmentId
                ? await db
                    .select()
                    .from(npAgentContainments)
                    .where(
                      and(
                        eq(npAgentContainments.siteId, siteId),
                        eq(npAgentContainments.id, action.containmentId),
                      ),
                    )
                    .limit(1)
                : [];
              const target =
                "target" in proposal
                  ? proposal.target
                  : containment
                    ? npRequireAgentQuarantineProposalV1({
                        target: containment.targetRef,
                        incidentId: containment.incidentId,
                        expectedVersionDigest: containment.targetVersionDigest,
                        reasonCode: "RESTORE",
                      }).target
                    : null;
              if (!target) throw conflict();
              await npInspectCommunityContentContainmentV1(db as unknown as NpTransaction, {
                siteId,
                target,
                user: viewer,
              });
              const retained = await review(db, action, viewer, false);
              await policy(
                db,
                siteId,
                viewer,
                authentication.principal.id,
                target,
                capabilityId,
                retained.incidentId,
              );
              return {
                schemaVersion: "np.agent-moderation-invocation-result.v1",
                invocationId: prior.id,
                capabilityId,
                output: npRequireAgentModerationCapabilityOutputV1(
                  capabilityId,
                  prior.outputRedacted,
                ),
              };
            }
            const invocationId = randomUUID();
            const [audit] = await db
              .insert(npAuditEvents)
              .values({
                siteId,
                actorKind: "agent-principal",
                action: "agents.capability.invoke",
                targetType: "agent-capability",
                targetId: capabilityId,
                payload: {
                  schemaVersion: "np.agent-capability-audit.v1",
                  capabilityId,
                  invocationId,
                  requestHash,
                  outcome: parsed.mode === "propose" ? "approval_required" : "executing",
                },
                createdAt: time,
              })
              .returning({ id: npAuditEvents.id });
            if (!audit) throw conflict();
            await db.insert(npAgentInvocations).values({
              id: invocationId,
              siteId,
              actorKind: "principal",
              principalId: authentication.principal.id,
              actorFingerprint: requestBody.actorFingerprint,
              authorizationContextBody: authentication.authorizationContext,
              authorizationContextFingerprint: authentication.authorizationContextFingerprint,
              authorityRef: authentication.authorizationContext.authorityRef,
              operationKind: "capability",
              operationId: capabilityId,
              contractVersion: 1,
              contractFingerprint: definition.fingerprint,
              capabilityDefinitionBody: definition.canonical,
              effectProfileId: requestBody.effectProfile!.id,
              effectContractVersion: 1,
              transport: authentication.authorizationContext.transport,
              mcpExecutionMode: ["mcp-service", "mcp-oauth"].includes(
                authentication.authorizationContext.transport,
              )
                ? "normal"
                : null,
              idempotencyKey,
              requestBody,
              requestHash,
              state: "started",
              auditEventId: audit.id,
              requestedAt: time,
              expiresAt: new Date(time.getTime() + 365 * 86400000),
            });
            const result = await perform({
              db,
              siteId,
              time,
              viewer,
              principalId: authentication.principal.id,
              actorFingerprint: requestBody.actorFingerprint,
              authorizationContextFingerprint: authentication.authorizationContextFingerprint,
              invocationId,
              requestHash,
              auditId: audit.id,
              capabilityId,
              parsed,
              idempotencyKey,
            });
            await db
              .update(npAgentInvocations)
              .set({
                state: "completed",
                resultKind: "action",
                resultId: result.actionId,
                runId: result.runId,
                outputRedacted: result.output,
                outputHash: result.outputHash,
                completedAt: time,
              })
              .where(eq(npAgentInvocations.id, invocationId));
            return {
              schemaVersion: "np.agent-moderation-invocation-result.v1",
              invocationId,
              capabilityId,
              output: npRequireAgentModerationCapabilityOutputV1(capabilityId, result.output),
            };
          },
        }),
      ),
    );
  }
  return {
    capabilityIds: ["moderation.quarantine", "moderation.restore"] as const,
    invokeCapability,
    staff: {
      enabled: typeof options.resolveStaffPolicy === "function",
      async viewer(input: { db: Db; siteId: string; actor: NpAgentAdminActorV1 }) {
        const authority = await npResolveAgentStaffSessionAuthorizationV1(
          input.db,
          input.siteId,
          input.actor,
          now(),
        );
        if (!authority.authority.capabilities.includes("admin.manage")) throw unavailable();
        return user(input.db, input.siteId, input.actor.user.id);
      },
      async canExecute(input: {
        db: Db;
        siteId: string;
        actor: NpAgentAdminActorV1;
        actionId: string;
      }) {
        const row = await loadAction(input.db, input.siteId, input.actionId);
        const original = await invocation(input.db, input.siteId, row.invocationId);
        const viewer = await storedStaff(input.db, original);
        const current = await npResolveAgentStaffSessionAuthorizationV1(
          input.db,
          input.siteId,
          input.actor,
          now(),
        );
        if (
          !current.authority.capabilities.includes("admin.manage") ||
          viewer.id !== input.actor.user.id ||
          original.authorityRef.kind !== "staff-session" ||
          original.authorityRef.sessionId !== input.actor.sessionId
        )
          throw unavailable();
        if (row.state !== "approved" || !row.approvalId) throw conflict();
        const [approval] = await input.db
          .select()
          .from(npAgentApprovals)
          .where(
            and(eq(npAgentApprovals.siteId, input.siteId), eq(npAgentApprovals.id, row.approvalId)),
          );
        if (!approval || approval.state !== "approved" || approval.expiresAt <= now())
          throw conflict();
        const verified = await options.resolveApprovals().verify(approval);
        await assertStatement(input.db, row, verified.statement, viewer);
        await assertLiveApprover(input.db, row, approval, verified.statement);
        return true;
      },
      async invoke(input: {
        db: Db;
        siteId: string;
        actor: NpAgentAdminActorV1;
        invocationId: string;
        capabilityId: NpAgentModerationCapabilityIdV1;
        parsed: ReturnType<typeof npRequireAgentModerationCapabilityInputV1>;
        idempotencyKey: string;
      }) {
        npAssertAgentPreviewEffectsAllowed();
        if (!options.resolveStaffPolicy) throw unavailable();
        const original = await invocation(input.db, input.siteId, input.invocationId);
        const viewer = await storedStaff(input.db, original);
        if (
          viewer.id !== input.actor.user.id ||
          original.authorityRef.kind !== "staff-session" ||
          original.authorityRef.sessionId !== input.actor.sessionId ||
          original.operationKind !== "admin" ||
          original.state !== "started"
        )
          throw unavailable();
        const admitted = original.requestBody.input;
        const expectedOperation =
          input.parsed.mode === "propose"
            ? "agents.incidents.response_plan"
            : input.capabilityId === "moderation.restore"
              ? "agents.incidents.restore"
              : "agents.incidents.response_execute";
        if (
          original.operationId !== expectedOperation ||
          !admitted ||
          admitted.idempotencyKey !== input.idempotencyKey
        )
          throw conflict();
        if (
          input.parsed.mode === "propose"
            ? !same(admitted.proposal, input.parsed.proposal) ||
              admitted.capabilityId !== input.capabilityId
            : admitted.actionId !== input.parsed.actionId ||
              admitted.approvalId !== input.parsed.approvalId ||
              admitted.proposalHash !== input.parsed.proposalHash
        )
          throw conflict();
        const facts =
          input.parsed.mode === "propose"
            ? await resolveTarget(
                input.db,
                input.siteId,
                input.capabilityId,
                input.parsed.proposal,
                viewer,
              )
            : await review(
                input.db,
                await loadAction(input.db, input.siteId, input.parsed.actionId),
                viewer,
                true,
              );
        if (!facts.incidentId || admitted.targetId !== facts.incidentId) throw conflict();
        if (!original.auditEventId) throw conflict();
        return perform({
          ...input,
          time: now(),
          viewer,
          principalId: null,
          actorFingerprint: original.actorFingerprint,
          authorizationContextFingerprint: original.authorizationContextFingerprint,
          requestHash: original.requestHash,
          auditId: original.auditEventId,
        });
      },
      async review(input: {
        db: Db;
        siteId: string;
        actor: NpAgentAdminActorV1;
        actionId: string;
        fresh?: boolean;
      }) {
        const authority = await npResolveAgentStaffSessionAuthorizationV1(
          input.db,
          input.siteId,
          input.actor,
          now(),
        );
        if (!authority.authority.capabilities.includes("admin.manage")) throw unavailable();
        const row = await loadAction(input.db, input.siteId, input.actionId);
        const viewer = await user(input.db, input.siteId, input.actor.user.id);
        const facts = await review(input.db, row, viewer, input.fresh);
        await policy(
          input.db,
          input.siteId,
          viewer,
          null,
          facts.target,
          facts.capabilityId,
          facts.incidentId,
        );
        return { row, facts };
      },
      async authorizeReplay(input: {
        db: Db;
        siteId: string;
        actor: NpAgentAdminActorV1;
        actionId: string;
      }) {
        const row = await loadAction(input.db, input.siteId, input.actionId);
        const original = await invocation(input.db, input.siteId, row.invocationId);
        const viewer = await storedStaff(input.db, original);
        if (
          viewer.id !== input.actor.user.id ||
          original.authorityRef.kind !== "staff-session" ||
          original.authorityRef.sessionId !== input.actor.sessionId
        )
          throw unavailable();
        const facts = await review(input.db, row, viewer, false);
        await policy(
          input.db,
          input.siteId,
          viewer,
          null,
          facts.target,
          facts.capabilityId,
          facts.incidentId,
        );
      },
    },
    approvalTargets,
  };
}
export type NpAgentModerationServiceV1 = ReturnType<typeof createAgentModerationServiceV1>;
