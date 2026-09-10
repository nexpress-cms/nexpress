import { createHash, createHmac } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentApprovals } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npRequireAgentApprovalStatementCanonical,
  npDigestAgentApprovalStatementCanonical,
  npMacAgentApprovalStatementCanonical,
  npVerifyAgentApprovalStatementCanonicalMac,
  npRequireAgentApprovalDecisionCanonicalForStatement,
  npDigestAgentApprovalDecisionCanonical,
  npMacAgentApprovalDecisionCanonical,
  npVerifyAgentApprovalDecisionCanonicalMac,
  npRequireAgentApprovalRevocationCanonicalForBindings,
  npDigestAgentApprovalRevocationCanonical,
  npMacAgentApprovalRevocationCanonical,
  npVerifyAgentApprovalRevocationCanonicalMac,
  npRequireAgentApprovalWire,
  type NpAgentApprovalStatementCanonicalV1,
  type NpAgentApprovalIntegrityKeyV1,
  type NpAgentApprovalDecisionReauthenticationV1,
  type NpAgentApprovalTargetV1,
  type NpAgentJsonObject,
  type NpAgentChangeSetReviewV1,
} from "../agent-contract/index.js";
import {
  npRequireAgentApprovalChallengeRequestV1,
  npRequireAgentApprovalDecisionInputV1,
  npRequireAgentApprovalChallengeOutputV1,
  npRequireAgentApprovalListItemV1,
  npRequireAgentApprovalDetailV1,
  npRequireAgentApprovalPageV1,
  npRequireAgentApprovalQueryV1,
  type NpAgentApprovalChallengeOutputV1,
  type NpAgentApprovalListItemV1,
} from "../agent-contract/approval-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  createAgentAdminAdmissionV1,
  npResolveAgentStaffSessionAuthorizationV1,
  npValidateAgentStaffPrimaryReauthenticationFactV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminAdmissionOptionsV1,
} from "./admin-admission.js";
import {
  npMintAgentOpaqueVerifierV1,
  npVerifyAgentOpaqueVerifierV1,
  type NpAgentTokenHashKeyring,
} from "./opaque-verifier.js";
import { createAgentCursorCodecV1 } from "./cursor.js";

type Db = ReturnType<typeof getDb>;
type Row = typeof npAgentApprovals.$inferSelect;
type Decision = "approve" | "reject" | "revoke";
const json = (value: object) => value as unknown as NpAgentJsonObject;
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const clearedChallenge = {
  challengePurpose: null,
  challengeHash: null,
  challengeHashKeyId: null,
  challengeIssuedToUserId: null,
  challengeSessionFingerprint: null,
  challengeExpiresAt: null,
};
const missing = () =>
  new NpAgentGatewayError("APPROVAL_NOT_FOUND", 404, "Approval is unavailable.");
const conflict = () =>
  new NpAgentGatewayError("APPROVAL_CONFLICT", 409, "Approval changed. Reload its current state.");
const integrity = () =>
  new NpAgentGatewayError(
    "APPROVAL_INTEGRITY_INVALID",
    409,
    "Approval integrity could not be verified.",
  );

/** Dedicated deployment-held keys. Never resolved from NP_SECRET or another credential keyring. */
export interface NpAgentApprovalIntegrityKeyring {
  active: NpAgentApprovalIntegrityKeyV1;
  previous?: readonly NpAgentApprovalIntegrityKeyV1[];
}
export interface NpAgentApprovalTargetAccessV1 {
  /** Caller holds the target lock before locking an approval. All operations are metadata only. */
  verify: (statement: NpAgentApprovalStatementCanonicalV1, decision: Decision) => Promise<void>;
  transition: (state: "approved" | "rejected" | "ready") => Promise<void>;
}
export interface NpAgentApprovalServiceOptionsV1 extends NpAgentAdminAdmissionOptionsV1 {
  integrityKeys: NpAgentApprovalIntegrityKeyring;
  challengeKeys: NpAgentTokenHashKeyring;
  cursorKey: Uint8Array;
  targets: {
    visible: (input: {
      siteId: string;
      target: NpAgentApprovalTargetV1;
      actor: NpAgentAdminActorV1;
    }) => Promise<NpAgentApprovalListItemV1["reviewSummary"]>;
    withAuthority: <T>(input: {
      siteId: string;
      target: NpAgentApprovalTargetV1;
      actor: NpAgentAdminActorV1;
      decision: Decision;
      mutate: (db: Db, target: NpAgentApprovalTargetAccessV1) => Promise<T>;
    }) => Promise<T>;
    review: (input: {
      siteId: string;
      target: NpAgentApprovalTargetV1;
      actor: NpAgentAdminActorV1;
    }) => Promise<NpAgentChangeSetReviewV1>;
    revalidate: (input: {
      siteId: string;
      statement: NpAgentApprovalStatementCanonicalV1;
    }) => Promise<void>;
    /** Explicit maintenance, without browser authority; locks target before approval. */
    expire: (input: {
      siteId: string;
      target: NpAgentApprovalTargetV1;
      mutate: (db: Db, target: NpAgentApprovalTargetAccessV1) => Promise<boolean>;
    }) => Promise<boolean>;
  };
}

export function createAgentApprovalServiceV1(options: NpAgentApprovalServiceOptionsV1) {
  const now = options.now ?? (() => new Date());
  const admin = createAgentAdminAdmissionV1(options);
  const keys = new Map<string, NpAgentApprovalIntegrityKeyV1>();
  for (const key of [options.integrityKeys.active, ...(options.integrityKeys.previous ?? [])]) {
    if (
      key.owner !== "approval-integrity" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key.id) ||
      !(key.bytes instanceof Uint8Array) ||
      key.bytes.byteLength !== 32 ||
      keys.has(key.id)
    )
      throw new Error("Invalid approval integrity keyring.");
    const otherKeys = [
      options.cursorKey,
      options.challengeKeys.active.key,
      ...Object.values(options.challengeKeys.previous ?? {}),
      options.secretRequestDigestKey?.key,
    ];
    if (otherKeys.some((other) => other && Buffer.from(other).equals(Buffer.from(key.bytes))))
      throw new Error("Approval integrity keys must be separate.");
    keys.set(key.id, { ...key, bytes: new Uint8Array(key.bytes) });
  }
  const challengeKeys: NpAgentTokenHashKeyring = {
    active: {
      id: options.challengeKeys.active.id,
      key: new Uint8Array(options.challengeKeys.active.key),
    },
    previous: Object.fromEntries(
      Object.entries(options.challengeKeys.previous ?? {}).map(([id, key]) => [
        id,
        new Uint8Array(key),
      ]),
    ),
  };
  for (const [id, key] of [
    [challengeKeys.active.id, challengeKeys.active.key] as const,
    ...Object.entries(challengeKeys.previous ?? {}),
  ])
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id) || key.byteLength !== 32)
      throw new Error("Invalid approval challenge keyring.");
  function boundChallengeKeys(input: {
    id: string;
    siteId: string;
    statementHash: string;
    version: number;
    challengeGeneration: number;
    challengePurpose: string;
    challengeIssuedToUserId: string;
    challengeSessionFingerprint: string;
    challengeExpiresAt: Date;
  }): NpAgentTokenHashKeyring {
    const body = serializeAgentCanonicalJson({
      approvalId: input.id,
      siteId: input.siteId,
      statementHash: input.statementHash,
      approvalVersion: input.version,
      generation: input.challengeGeneration,
      purpose: input.challengePurpose,
      userId: input.challengeIssuedToUserId,
      sessionFingerprint: input.challengeSessionFingerprint,
      expiresAt: input.challengeExpiresAt.toISOString(),
    });
    const derive = (key: Uint8Array) =>
      createHmac("sha256", key)
        .update("np.agent-approval-intent-binding.v1\0")
        .update(body)
        .digest();
    return {
      active: { id: challengeKeys.active.id, key: derive(challengeKeys.active.key) },
      previous: Object.fromEntries(
        Object.entries(challengeKeys.previous ?? {}).map(([id, key]) => [id, derive(key)]),
      ),
    };
  }
  const active = keys.get(options.integrityKeys.active.id)!;
  const cursor = createAgentCursorCodecV1(options.cursorKey, "np.agent-approval.cursor");
  const macKeyId = (mac: string) => {
    const match = /^cj1:hmac-sha256:([A-Za-z0-9][A-Za-z0-9._-]{0,127}):[A-Za-z0-9_-]{43}$/u.exec(
      mac,
    );
    if (!match) throw integrity();
    return match[1];
  };
  const resolveMacKey = (mac: string) => {
    const key = keys.get(macKeyId(mac));
    if (!key) throw integrity();
    return key;
  };
  async function verifyUnchecked(row: Row, retiredTerminalOnly = false) {
    if (
      retiredTerminalOnly &&
      (row.state !== "revoked" ||
        row.revocationKind !== "integrity_key_retired" ||
        row.revocationCode !== "APPROVAL_INTEGRITY_KEY_RETIRED" ||
        row.revokedByUserId !== null ||
        row.revocationReason !== null ||
        row.consumedAt !== null ||
        !row.revocationBody ||
        (keys.has(row.integrityKeyId) &&
          (!row.decisionMac || keys.has(macKeyId(row.decisionMac)))) ||
        !(
          (row.targetKind === "changeset" &&
            row.targetChangesetId === row.targetId &&
            row.targetActionId === null &&
            row.targetRollbackPlanId === null) ||
          (row.targetKind === "changeset_rollback" &&
            row.targetRollbackPlanId === row.targetId &&
            row.targetChangesetId !== null &&
            row.targetActionId === null) ||
          (row.targetKind === "action" &&
            row.targetActionId === row.targetId &&
            row.targetChangesetId === null)
        ))
    )
      throw integrity();
    const statement = npRequireAgentApprovalStatementCanonical(row.statementBody);
    const key = keys.get(row.integrityKeyId);
    if (
      (!key && !retiredTerminalOnly) ||
      macKeyId(row.statementMac) !== row.integrityKeyId ||
      (key &&
        !(await npVerifyAgentApprovalStatementCanonicalMac(statement, row.statementMac, key))) ||
      (await npDigestAgentApprovalStatementCanonical(statement)) !== row.statementHash
    )
      throw integrity();
    const targetId =
      statement.target.kind === "action"
        ? statement.target.actionId
        : statement.target.kind === "changeset"
          ? statement.target.changeSetId
          : statement.target.rollbackPlanId;
    if (
      statement.siteId !== row.siteId ||
      statement.approvalId !== row.id ||
      statement.target.kind !== row.targetKind ||
      targetId !== row.targetId ||
      (statement.target.kind !== "action" &&
        statement.target.changeSetId !== row.targetChangesetId) ||
      (statement.target.kind === "changeset_rollback"
        ? statement.target.rollbackPlanId !== row.targetRollbackPlanId
        : row.targetRollbackPlanId !== null) ||
      (statement.target.kind === "action"
        ? statement.target.proposalHash
        : statement.target.planHash) !== row.planHash ||
      statement.capabilityId !== row.capabilityId ||
      statement.capabilityContractVersion !== row.capabilityContractVersion ||
      statement.capabilityFingerprint !== row.capabilityFingerprint ||
      !same(statement.requiredScopes, row.requiredScopes) ||
      !same(statement.requiredHumanCapabilities, row.requiredHumanCapabilities) ||
      !same(statement.requiredHumanPredicates, row.requiredHumanPredicates) ||
      !same(statement.policyHashes, row.policyHashes) ||
      statement.requiresLivePreview !== row.requiresLivePreview ||
      statement.previewId !== row.previewId ||
      statement.previewDigest !== row.previewDigest ||
      statement.risk !== row.risk ||
      statement.requester.kind !== row.requesterKind ||
      statement.requester.fingerprint !== row.requesterFingerprint ||
      statement.createdAt !== row.requestedAt.toISOString() ||
      statement.expiresAt !== row.expiresAt.toISOString() ||
      (statement.reauthentication.mode === "none"
        ? row.requiredReauthMode !== "none" || row.requiredReauthMaxAgeSeconds !== null
        : row.requiredReauthMode !== "recent-staff-primary" ||
          row.requiredReauthMaxAgeSeconds !== statement.reauthentication.maxAgeSeconds) ||
      (statement.requester.kind === "principal"
        ? statement.requester.principalId !== row.requestedByPrincipalId
        : row.requestedByUserId !== null && statement.requester.userId !== row.requestedByUserId)
    )
      throw integrity();
    if (
      statement.requester.kind === "staff" &&
      statement.requester.userId !== null &&
      statement.requester.fingerprint !==
        hash("np.agent-staff-actor.v1", { siteId: row.siteId, userId: statement.requester.userId })
    )
      throw integrity();
    if (
      row.decidedByUserId !== null &&
      row.deciderFingerprint !==
        hash("np.agent-staff-actor.v1", { siteId: row.siteId, userId: row.decidedByUserId })
    )
      throw integrity();
    if (
      row.revokedByUserId !== null &&
      row.revokerFingerprint !==
        hash("np.agent-staff-actor.v1", { siteId: row.siteId, userId: row.revokedByUserId })
    )
      throw integrity();
    const binding = {
      statement,
      statementHash: row.statementHash,
      approvalGeneration: row.generation,
    };
    const decision = row.decisionBody;
    if (decision) {
      const decisionKey = row.decisionMac ? keys.get(macKeyId(row.decisionMac)) : undefined;
      if (
        !row.decisionHash ||
        !row.decisionMac ||
        (await npDigestAgentApprovalDecisionCanonical(decision, binding)) !== row.decisionHash ||
        (!decisionKey && !retiredTerminalOnly) ||
        (decisionKey &&
          !(await npVerifyAgentApprovalDecisionCanonicalMac(
            decision,
            binding,
            row.decisionMac,
            decisionKey,
          ))) ||
        decision.deciderFingerprint !== row.deciderFingerprint ||
        decision.decidedAt !== row.decidedAt?.toISOString() ||
        decision.reason !== row.reason ||
        (decision.reauthentication.mode === "none"
          ? row.decisionReauthFingerprint !== null || row.decisionReauthenticatedAt !== null
          : decision.reauthentication.sessionFactFingerprint !== row.decisionReauthFingerprint ||
            decision.reauthentication.reauthenticatedAt !==
              row.decisionReauthenticatedAt?.toISOString()) ||
        (["approved", "consumed"].includes(row.state) && decision.decision !== "approve") ||
        (row.state === "rejected" && decision.decision !== "reject") ||
        row.state === "pending"
      )
        throw integrity();
    } else if (
      ["approved", "rejected", "consumed"].includes(row.state) ||
      row.decisionHash ||
      row.decisionMac ||
      row.deciderFingerprint ||
      row.decidedAt ||
      row.reason ||
      row.decisionReauthFingerprint ||
      row.decisionReauthenticatedAt
    )
      throw integrity();
    const decisionBinding =
      decision && row.decisionHash ? { decision, decisionHash: row.decisionHash } : null;
    if (row.revocationBody) {
      const revocation = row.revocationBody;
      if (
        row.state !== "revoked" ||
        !row.revocationHash ||
        !row.revocationMac ||
        (await npDigestAgentApprovalRevocationCanonical(revocation, binding, decisionBinding)) !==
          row.revocationHash ||
        !(await npVerifyAgentApprovalRevocationCanonicalMac(
          revocation,
          binding,
          decisionBinding,
          row.revocationMac,
          resolveMacKey(row.revocationMac),
        )) ||
        resolveMacKey(row.revocationMac).id !== row.revocationIntegrityKeyId ||
        revocation.revocationKind !== row.revocationKind ||
        revocation.revokerFingerprint !== row.revokerFingerprint ||
        revocation.revocationCode !== row.revocationCode ||
        revocation.revocationReason !== row.revocationReason ||
        revocation.revokedAt !== row.revokedAt?.toISOString()
      )
        throw integrity();
    } else if (row.state === "revoked" || row.revocationHash || row.revocationMac || row.revokedAt)
      throw integrity();
    return { statement, binding, decisionBinding };
  }
  async function verify(row: Row) {
    try {
      return await verifyUnchecked(row);
    } catch {
      throw integrity();
    }
  }
  /** A removed original key makes historical evidence unavailable, never newly authoritative. */
  async function summary(row: Row) {
    try {
      await verify(row);
      return projectSummary(row);
    } catch {
      try {
        // Canonical body/digest and row bindings remain mandatory. Only the original missing-key
        // MACs may be unavailable; the retained retirement revocation MAC must still verify.
        await verifyUnchecked(row, true);
        return null;
      } catch {
        throw integrity();
      }
    }
  }
  async function incident(siteId: string, id: string) {
    await getDb()
      .insert(npAuditEvents)
      .values({
        siteId,
        actorKind: "system",
        action: "agents.approvals.integrity_incident",
        targetType: "agent-approval",
        targetId: id,
        payload: { code: "APPROVAL_INTEGRITY_INVALID", severity: "high" },
        createdAt: now(),
      });
  }
  async function readRow(siteId: string, id: string, db: Db = getDb(), lock = false) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(id))
      throw missing();
    const query = db
      .select()
      .from(npAgentApprovals)
      .where(and(eq(npAgentApprovals.siteId, siteId), eq(npAgentApprovals.id, id)))
      .limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw missing();
    return row;
  }
  async function staff(
    db: Db,
    siteId: string,
    actor: NpAgentAdminActorV1,
    statement: NpAgentApprovalStatementCanonicalV1,
  ) {
    const auth = await npResolveAgentStaffSessionAuthorizationV1(db, siteId, actor, now());
    if (
      !auth.authority.capabilities.includes("site.access") ||
      statement.requiredHumanCapabilities.some(
        (cap) => !auth.authority.capabilities.includes(cap),
      ) ||
      (statement.requiredHumanPredicates.includes("is-super-admin") &&
        auth.authority.kind !== "super-admin")
    )
      throw missing();
    return auth;
  }
  async function reauthentication(
    siteId: string,
    actor: NpAgentAdminActorV1,
    statement: NpAgentApprovalStatementCanonicalV1,
    purpose: Decision,
  ): Promise<NpAgentApprovalDecisionReauthenticationV1> {
    if (purpose !== "approve" || statement.reauthentication.mode === "none")
      return { mode: "none" };
    const time = now();
    const fact = await options.reauthentication?.verify({
      siteId,
      userId: actor.user.id,
      sessionId: actor.sessionId,
      operationId: "agents.approvals.approve",
      maximumAgeSeconds: statement.reauthentication.maxAgeSeconds,
      now: time,
    });
    const checked = npValidateAgentStaffPrimaryReauthenticationFactV1(
      fact,
      now(),
      statement.reauthentication.maxAgeSeconds,
    );
    if (!checked)
      throw new NpAgentGatewayError(
        "RECENT_REAUTHENTICATION_REQUIRED",
        403,
        "Recent staff-primary reauthentication is required.",
      );
    return { ...statement.reauthentication, ...checked };
  }
  const projectSummary = (row: Row) =>
    npRequireAgentApprovalWire({
      id: row.id,
      generation: row.generation,
      state: row.state,
      statementHash: row.statementHash,
      requiredHumanCapabilities: row.requiredHumanCapabilities,
      requiredHumanPredicates: row.requiredHumanPredicates,
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    });
  async function create(input: {
    db: Db;
    statement: NpAgentApprovalStatementCanonicalV1;
    generation: number;
  }) {
    const s = npRequireAgentApprovalStatementCanonical(input.statement);
    if (s.target.kind === "action") throw missing();
    const statementHash = await npDigestAgentApprovalStatementCanonical(s);
    await input.db.insert(npAgentApprovals).values({
      id: s.approvalId,
      siteId: s.siteId,
      targetKind: s.target.kind,
      targetId: s.target.kind === "changeset" ? s.target.changeSetId : s.target.rollbackPlanId,
      targetRollbackPlanId: s.target.kind === "changeset_rollback" ? s.target.rollbackPlanId : null,
      targetChangesetId: s.target.changeSetId,
      generation: input.generation,
      planHash: s.target.planHash,
      capabilityId: s.capabilityId,
      capabilityContractVersion: s.capabilityContractVersion,
      capabilityFingerprint: s.capabilityFingerprint,
      requiredScopes: s.requiredScopes,
      requiredHumanCapabilities: s.requiredHumanCapabilities,
      requiredHumanPredicates: s.requiredHumanPredicates,
      policyHashes: s.policyHashes,
      requiresLivePreview: s.requiresLivePreview,
      previewId: s.previewId,
      previewDigest: s.previewDigest,
      requiredReauthMode: s.reauthentication.mode === "none" ? "none" : "recent-staff-primary",
      requiredReauthMaxAgeSeconds:
        s.reauthentication.mode === "none" ? null : s.reauthentication.maxAgeSeconds,
      statementBody: s,
      statementHash,
      statementMac: await npMacAgentApprovalStatementCanonical(s, active),
      integrityKeyId: active.id,
      state: "pending",
      risk: s.risk,
      requesterKind: s.requester.kind,
      requestedByPrincipalId: s.requester.kind === "principal" ? s.requester.principalId : null,
      requestedByUserId: s.requester.kind === "staff" ? s.requester.userId : null,
      requesterFingerprint: s.requester.fingerprint,
      requestedAt: new Date(s.createdAt),
      expiresAt: new Date(s.expiresAt),
    });
    return readRow(s.siteId, s.approvalId, input.db);
  }
  async function item(
    row: Row,
    actor: NpAgentAdminActorV1,
    reviewSummary: NpAgentApprovalListItemV1["reviewSummary"],
  ) {
    const { statement } = await verify(row);
    await staff(getDb(), row.siteId, actor, statement);
    const live = row.expiresAt > now();
    return npRequireAgentApprovalListItemV1({
      schemaVersion: "np.agent-approval-list-item.v1",
      reviewSummary,
      approval: projectSummary(row),
      version: row.version,
      target: statement.target,
      intendedOperation:
        statement.target.kind === "changeset"
          ? statement.capabilityId === "changeset.schedule"
            ? "schedule"
            : "apply"
          : null,
      scheduledFor: statement.target.kind === "changeset" ? statement.target.scheduledFor : null,
      statementHash: row.statementHash,
      reauthentication: statement.reauthentication,
      allowedDecisions: live
        ? row.state === "pending"
          ? ["approve", "reject", "revoke"]
          : row.state === "approved"
            ? ["revoke"]
            : []
        : [],
      risk: statement.risk,
      capabilityId: statement.capabilityId,
      requiredScopes: statement.requiredScopes,
      capabilityContractVersion: statement.capabilityContractVersion,
      capabilityFingerprint: statement.capabilityFingerprint,
      policyHashes: statement.policyHashes,
      requiresLivePreview: statement.requiresLivePreview,
      requester: {
        kind: statement.requester.kind,
        id:
          statement.requester.kind === "staff" ? row.requestedByUserId : row.requestedByPrincipalId,
      },
    });
  }
  async function get(input: { siteId: string; actor: NpAgentAdminActorV1; id: string }) {
    const row = await readRow(input.siteId, input.id);
    try {
      const checked = await verify(row);
      await staff(getDb(), input.siteId, input.actor, checked.statement);
      const reviewSummary = await options.targets.visible({
        ...input,
        target: checked.statement.target,
      });
      const projected = await item(row, input.actor, reviewSummary);
      const review = await options.targets.review({ ...input, target: projected.target });
      const current = await readRow(input.siteId, input.id);
      if (current.version !== row.version) throw conflict();
      await staff(getDb(), input.siteId, input.actor, row.statementBody);
      return npRequireAgentApprovalDetailV1({
        schemaVersion: "np.agent-approval-detail.v1",
        item: projected,
        review: projected.target.kind === "changeset_rollback" ? null : review,
        rollbackReview:
          projected.target.kind === "changeset_rollback" ? review.rollbackDetail : null,
      });
    } catch (error) {
      if (error instanceof NpAgentGatewayError && error.code === "APPROVAL_INTEGRITY_INVALID")
        await incident(input.siteId, input.id);
      throw missing();
    }
  }
  async function list(input: { siteId: string; actor: NpAgentAdminActorV1; query?: unknown }) {
    const query = npRequireAgentApprovalQueryV1(input.query ?? {});
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      getDb(),
      input.siteId,
      input.actor,
      now(),
    );
    const fingerprint = hash("np.agent-approval-list-authority.v1", {
      siteId: input.siteId,
      sessionId: input.actor.sessionId,
      auth,
      query: { ...query, cursor: null },
    });
    type Position = { expiresAt: string; risk: number; id: string };
    let after: Position | null = null;
    if (query.cursor) {
      try {
        const decoded = cursor.open(query.cursor) as {
          fingerprint: string;
          expires: number;
          after: Position | null;
        };
        if (
          decoded.fingerprint !== fingerprint ||
          !Number.isSafeInteger(decoded.expires) ||
          decoded.expires <= now().getTime() ||
          !decoded.after ||
          !Number.isFinite(Date.parse(decoded.after.expiresAt)) ||
          ![0, 1, 2].includes(decoded.after.risk) ||
          !/^[0-9a-f-]{36}$/u.test(decoded.after.id)
        )
          throw conflict();
        after = decoded.after;
      } catch {
        throw new NpAgentGatewayError(
          "APPROVAL_CURSOR_INVALID",
          400,
          "Approval cursor is invalid.",
        );
      }
    }
    const riskOrder = sql<number>`case ${npAgentApprovals.risk} when 'destructive' then 2 when 'sensitive' then 1 else 0 end`;
    const conditions = [eq(npAgentApprovals.siteId, input.siteId)];
    if (query.state) conditions.push(eq(npAgentApprovals.state, query.state));
    if (query.risk) conditions.push(eq(npAgentApprovals.risk, query.risk));
    if (query.targetKind) conditions.push(eq(npAgentApprovals.targetKind, query.targetKind));
    if (query.requesterKind)
      conditions.push(eq(npAgentApprovals.requesterKind, query.requesterKind));
    if (query.requesterId)
      conditions.push(
        sql`(${npAgentApprovals.requestedByUserId}=${query.requesterId} or ${npAgentApprovals.requestedByPrincipalId}=${query.requesterId})`,
      );
    if (query.requiredHumanCapability)
      conditions.push(
        sql`${query.requiredHumanCapability}=any(${npAgentApprovals.requiredHumanCapabilities})`,
      );
    if (query.createdAfter)
      conditions.push(sql`${npAgentApprovals.requestedAt}>=${new Date(query.createdAfter)}`);
    if (query.createdBefore)
      conditions.push(sql`${npAgentApprovals.requestedAt}<=${new Date(query.createdBefore)}`);
    if (query.expiresAfter)
      conditions.push(sql`${npAgentApprovals.expiresAt}>=${new Date(query.expiresAfter)}`);
    if (query.expiresBefore)
      conditions.push(sql`${npAgentApprovals.expiresAt}<=${new Date(query.expiresBefore)}`);
    if (after)
      conditions.push(
        sql`(${npAgentApprovals.expiresAt}>${new Date(after.expiresAt)} or (${npAgentApprovals.expiresAt}=${new Date(after.expiresAt)} and (${riskOrder}<${after.risk} or (${riskOrder}=${after.risk} and ${npAgentApprovals.id}>${after.id}))))`,
      );
    const rows = await getDb()
      .select()
      .from(npAgentApprovals)
      .where(and(...conditions))
      .orderBy(asc(npAgentApprovals.expiresAt), desc(riskOrder), asc(npAgentApprovals.id))
      .limit(query.limit + 1);
    const items = [];
    for (const row of rows.slice(0, query.limit)) {
      try {
        const checked = await verify(row);
        await staff(getDb(), input.siteId, input.actor, checked.statement);
        const reviewSummary = await options.targets.visible({
          ...input,
          target: checked.statement.target,
        });
        const projected = await item(row, input.actor, reviewSummary);
        items.push(projected);
      } catch (error) {
        // Item visibility never widens a bounded scan; integrity failures retain their audit signal.
        if (error instanceof NpAgentGatewayError && error.code === "APPROVAL_INTEGRITY_INVALID")
          await incident(input.siteId, row.id);
      }
    }
    const last = rows[Math.min(rows.length, query.limit) - 1];
    const current = await npResolveAgentStaffSessionAuthorizationV1(
      getDb(),
      input.siteId,
      input.actor,
      now(),
    );
    if (!same(auth, current)) throw missing();
    return npRequireAgentApprovalPageV1({
      schemaVersion: "np.agent-approval-page.v1",
      items,
      nextCursor:
        rows.length > query.limit && last
          ? cursor.seal({
              fingerprint,
              expires: now().getTime() + 300_000,
              after: {
                expiresAt: last.expiresAt.toISOString(),
                risk: last.risk === "destructive" ? 2 : last.risk === "sensitive" ? 1 : 0,
                id: last.id,
              },
            })
          : null,
    });
  }
  async function mutate<T>(
    input: { siteId: string; actor: NpAgentAdminActorV1; id: string; purpose: Decision },
    run: (db: Db, row: Row, target: NpAgentApprovalTargetAccessV1) => Promise<T>,
  ) {
    const seed = await readRow(input.siteId, input.id);
    try {
      const checked = await verify(seed);
      await staff(getDb(), input.siteId, input.actor, checked.statement);
      return await options.targets.withAuthority({
        siteId: input.siteId,
        target: checked.statement.target,
        actor: input.actor,
        decision: input.purpose,
        mutate: async (db, target) => {
          const row = await readRow(input.siteId, input.id, db, true);
          await verify(row);
          if (!same(row.statementBody, seed.statementBody)) throw conflict();
          await staff(db, input.siteId, input.actor, row.statementBody);
          if (row.expiresAt <= now())
            throw new NpAgentGatewayError("APPROVAL_EXPIRED", 409, "Approval expired.");
          await target.verify(row.statementBody, input.purpose);
          const result = await run(db, row, target);
          await staff(db, input.siteId, input.actor, row.statementBody);
          return result;
        },
      });
    } catch (error) {
      if (error instanceof NpAgentGatewayError && error.code === "APPROVAL_INTEGRITY_INVALID")
        await incident(input.siteId, input.id);
      throw error;
    }
  }
  async function issueChallenge(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    id: string;
    command: unknown;
  }): Promise<NpAgentApprovalChallengeOutputV1> {
    const command = npRequireAgentApprovalChallengeRequestV1(input.command);
    return mutate({ ...input, purpose: command.purpose }, async (db, row) => {
      const result = await admin({
        db,
        siteId: input.siteId,
        actor: input.actor,
        operationId: "agents.approvals.decision_challenge",
        targetId: input.id,
        command,
        mutate: async () => {
          if (
            row.version !== command.expectedApprovalVersion ||
            row.statementHash !== command.statementHash ||
            !(command.purpose === "revoke"
              ? ["pending", "approved"].includes(row.state)
              : row.state === "pending")
          )
            throw conflict();
          await reauthentication(input.siteId, input.actor, row.statementBody, command.purpose);
          const time = now();
          const expiresAt = new Date(Math.min(time.getTime() + 300_000, row.expiresAt.getTime()));
          if (expiresAt <= time) throw conflict();
          const version = row.version + 1,
            generation = row.challengeGeneration + 1;
          const sessionFingerprint = hash("np.agent-approval-session.v1", {
            siteId: input.siteId,
            userId: input.actor.user.id,
            sessionId: input.actor.sessionId,
          });
          const issued = npMintAgentOpaqueVerifierV1({
            purpose: "approval-challenge",
            siteId: input.siteId,
            publicId: row.id,
            keyring: boundChallengeKeys({
              ...row,
              version,
              challengeGeneration: generation,
              challengePurpose: command.purpose,
              challengeIssuedToUserId: input.actor.user.id,
              challengeSessionFingerprint: sessionFingerprint,
              challengeExpiresAt: expiresAt,
            }),
          });
          const challenge = issued.value.slice(-43);
          await db
            .update(npAgentApprovals)
            .set({
              version,
              challengeGeneration: generation,
              challengePurpose: command.purpose,
              challengeHash: issued.verifier,
              challengeHashKeyId: issued.hashKeyId,
              challengeIssuedToUserId: input.actor.user.id,
              challengeSessionFingerprint: hash("np.agent-approval-session.v1", {
                siteId: input.siteId,
                userId: input.actor.user.id,
                sessionId: input.actor.sessionId,
              }),
              challengeExpiresAt: expiresAt,
              challengeConsumedAt: null,
            })
            .where(and(eq(npAgentApprovals.id, row.id), eq(npAgentApprovals.version, row.version)));
          return {
            resourceId: row.id,
            oneTimeValue: challenge,
            output: json({
              schemaVersion: "np.agent-approval-challenge.v1",
              approvalId: row.id,
              approvalVersion: version,
              purpose: command.purpose,
              challengeGeneration: generation,
              reauthentication: row.statementBody.reauthentication,
              expiresAt: expiresAt.toISOString(),
            }),
          };
        },
      });
      return npRequireAgentApprovalChallengeOutputV1({
        ...result.output,
        challenge: result.oneTimeValue,
      });
    });
  }
  async function decide(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    id: string;
    decision: Decision;
    command: unknown;
  }) {
    const command = npRequireAgentApprovalDecisionInputV1(input.command);
    await mutate({ ...input, purpose: input.decision }, async (db, row, target) => {
      await admin({
        db,
        siteId: input.siteId,
        actor: input.actor,
        operationId: `agents.approvals.${input.decision}`,
        targetId: input.id,
        command,
        mutate: async () => {
          if (
            row.version !== command.expectedApprovalVersion ||
            row.statementHash !== command.statementHash ||
            row.challengeGeneration !== command.challengeGeneration ||
            row.challengePurpose !== input.decision ||
            row.challengeIssuedToUserId !== input.actor.user.id ||
            row.challengeSessionFingerprint !==
              hash("np.agent-approval-session.v1", {
                siteId: input.siteId,
                userId: input.actor.user.id,
                sessionId: input.actor.sessionId,
              }) ||
            !row.challengeExpiresAt ||
            row.challengeExpiresAt <= now() ||
            row.challengeConsumedAt ||
            !row.challengeHash ||
            !row.challengeHashKeyId ||
            !npVerifyAgentOpaqueVerifierV1({
              purpose: "approval-challenge",
              siteId: input.siteId,
              publicId: row.id,
              secret: Buffer.from(command.challenge, "base64url"),
              storedVerifier: row.challengeHash,
              storedHashKeyId: row.challengeHashKeyId,
              keyring: boundChallengeKeys({
                ...row,
                challengePurpose: row.challengePurpose,
                challengeIssuedToUserId: row.challengeIssuedToUserId,
                challengeSessionFingerprint: row.challengeSessionFingerprint,
                challengeExpiresAt: row.challengeExpiresAt,
              }),
            }) ||
            !(input.decision === "revoke"
              ? ["pending", "approved"].includes(row.state)
              : row.state === "pending")
          )
            throw conflict();
          const fact = await reauthentication(
            input.siteId,
            input.actor,
            row.statementBody,
            input.decision,
          );
          const authorization = await staff(db, input.siteId, input.actor, row.statementBody);
          const time = now();
          if (time >= row.expiresAt || time >= row.challengeExpiresAt) throw conflict();
          const checked = await verify(row);
          const fingerprint = hash("np.agent-staff-actor.v1", {
            siteId: input.siteId,
            userId: input.actor.user.id,
          });
          let update: Partial<typeof npAgentApprovals.$inferInsert>;
          if (input.decision === "revoke") {
            const revocation = await npRequireAgentApprovalRevocationCanonicalForBindings(
              {
                schemaVersion: "np.agent-approval-revocation.v1",
                siteId: input.siteId,
                approvalId: row.id,
                approvalGeneration: row.generation,
                statementHash: row.statementHash,
                decisionHash: row.decisionHash,
                revocationKind: "human",
                revokerFingerprint: fingerprint,
                revocationCode: "APPROVAL_REVOKED",
                revocationReason: command.reason,
                revokedAt: time.toISOString(),
              },
              checked.binding,
              checked.decisionBinding,
            );
            update = {
              state: "revoked",
              revocationKind: "human",
              revokedByUserId: input.actor.user.id,
              revokerFingerprint: fingerprint,
              revocationCode: "APPROVAL_REVOKED",
              revocationReason: command.reason,
              revocationBody: revocation,
              revocationHash: await npDigestAgentApprovalRevocationCanonical(
                revocation,
                checked.binding,
                checked.decisionBinding,
              ),
              revocationMac: await npMacAgentApprovalRevocationCanonical(
                revocation,
                checked.binding,
                checked.decisionBinding,
                active,
              ),
              revocationIntegrityKeyId: active.id,
              revokedAt: time,
            };
          } else {
            const decision = await npRequireAgentApprovalDecisionCanonicalForStatement(
              {
                schemaVersion: "np.agent-approval-decision.v1",
                siteId: input.siteId,
                approvalId: row.id,
                approvalGeneration: row.generation,
                statementHash: row.statementHash,
                decision: input.decision,
                deciderFingerprint: fingerprint,
                currentHumanCapabilities: authorization.authority.capabilities,
                reason: command.reason,
                reauthentication: fact,
                decidedAt: time.toISOString(),
              },
              checked.binding,
            );
            update = {
              state: input.decision === "approve" ? "approved" : "rejected",
              decidedByUserId: input.actor.user.id,
              deciderFingerprint: fingerprint,
              decisionBody: decision,
              decisionHash: await npDigestAgentApprovalDecisionCanonical(decision, checked.binding),
              decisionMac: await npMacAgentApprovalDecisionCanonical(
                decision,
                checked.binding,
                active,
              ),
              decisionReauthFingerprint: fact.mode === "none" ? null : fact.sessionFactFingerprint,
              decisionReauthenticatedAt:
                fact.mode === "none" ? null : new Date(fact.reauthenticatedAt),
              decidedAt: time,
              reason: command.reason,
            };
          }
          await db
            .update(npAgentApprovals)
            .set({
              ...update,
              ...clearedChallenge,
              version: row.version + 1,
              challengeConsumedAt: time,
            })
            .where(and(eq(npAgentApprovals.id, row.id), eq(npAgentApprovals.version, row.version)));
          await target.transition(
            input.decision === "approve"
              ? "approved"
              : input.decision === "reject"
                ? "rejected"
                : "ready",
          );
          return { resourceId: row.id, output: { approvalId: row.id } };
        },
      });
    });
    return get(input);
  }
  async function reconcileExpired(input: { siteId: string; limit?: number }) {
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Invalid approval maintenance limit.");
    const rows = await getDb()
      .select()
      .from(npAgentApprovals)
      .where(
        and(
          eq(npAgentApprovals.siteId, input.siteId),
          inArray(npAgentApprovals.state, ["pending", "approved"]),
          lte(npAgentApprovals.expiresAt, now()),
        ),
      )
      .orderBy(asc(npAgentApprovals.expiresAt), asc(npAgentApprovals.id))
      .limit(limit);
    let expired = 0;
    for (const seed of rows) {
      try {
        const checked = await verify(seed);
        const changed = await options.targets.expire({
          siteId: input.siteId,
          target: checked.statement.target,
          mutate: async (db, target) => {
            const row = await readRow(input.siteId, seed.id, db, true);
            await verify(row);
            if (!["pending", "approved"].includes(row.state) || row.expiresAt > now()) return false;
            await db
              .update(npAgentApprovals)
              .set({ state: "expired", ...clearedChallenge, version: row.version + 1 })
              .where(eq(npAgentApprovals.id, row.id));
            await target.transition("ready");
            await db.insert(npAuditEvents).values({
              siteId: input.siteId,
              actorKind: "system",
              action: "agents.approvals.expired",
              targetType: "agent-approval",
              targetId: row.id,
              payload: { outcome: "expired" },
              createdAt: now(),
            });
            return true;
          },
        });
        if (changed) expired++;
      } catch (error) {
        if (error instanceof NpAgentGatewayError && error.code === "APPROVAL_INTEGRITY_INVALID")
          await incident(input.siteId, seed.id);
      }
    }
    return { examined: rows.length, expired };
  }
  async function writeSystemRevocation(
    db: Db,
    row: Row,
    checked: Pick<Awaited<ReturnType<typeof verify>>, "binding" | "decisionBinding">,
    kind: "authority_loss" | "target_invalidated" | "integrity_key_retired",
    code: string,
  ) {
    const time = now();
    const revokerFingerprint = hash("np.agent-approval-system.v1", {
      siteId: row.siteId,
      kind,
    });
    const revocation = await npRequireAgentApprovalRevocationCanonicalForBindings(
      {
        schemaVersion: "np.agent-approval-revocation.v1",
        siteId: row.siteId,
        approvalId: row.id,
        approvalGeneration: row.generation,
        statementHash: row.statementHash,
        decisionHash: row.decisionHash,
        revocationKind: kind,
        revokerFingerprint,
        revocationCode: code,
        revocationReason: null,
        revokedAt: time.toISOString(),
      },
      checked.binding,
      checked.decisionBinding,
    );
    await db
      .update(npAgentApprovals)
      .set({
        state: "revoked",
        ...clearedChallenge,
        version: row.version + 1,
        revocationKind: kind,
        revokerFingerprint,
        revocationCode: code,
        revocationBody: revocation,
        revocationHash: await npDigestAgentApprovalRevocationCanonical(
          revocation,
          checked.binding,
          checked.decisionBinding,
        ),
        revocationMac: await npMacAgentApprovalRevocationCanonical(
          revocation,
          checked.binding,
          checked.decisionBinding,
          active,
        ),
        revocationIntegrityKeyId: active.id,
        revokedAt: time,
      })
      .where(eq(npAgentApprovals.id, row.id));
    return time;
  }
  /** Server-only outer transaction seam; caller holds the ChangeSet lock first. */
  async function consume(input: {
    db: Db;
    siteId: string;
    id: string;
    changeSetId: string;
    planHash: string;
    statementHash: string;
    consumedAt: Date;
    rollbackPlanId?: string;
  }) {
    const row = await readRow(input.siteId, input.id, input.db, true);
    const checked = await verify(row);
    if (
      row.state !== "approved" ||
      row.expiresAt <= now() ||
      row.statementHash !== input.statementHash ||
      checked.statement.target.kind === "action" ||
      (input.rollbackPlanId
        ? checked.statement.target.kind !== "changeset_rollback" ||
          checked.statement.target.rollbackPlanId !== input.rollbackPlanId
        : checked.statement.target.kind !== "changeset") ||
      checked.statement.target.changeSetId !== input.changeSetId ||
      checked.statement.target.planHash !== input.planHash
    )
      throw conflict();
    await input.db
      .update(npAgentApprovals)
      .set({
        state: "consumed",
        consumedAt: input.consumedAt,
        version: row.version + 1,
        ...clearedChallenge,
      })
      .where(
        and(
          eq(npAgentApprovals.siteId, input.siteId),
          eq(npAgentApprovals.id, input.id),
          eq(npAgentApprovals.version, row.version),
        ),
      );
  }
  /** Existing canonical revocation under a domain cancellation/failure transaction. */
  async function invalidateForExecution(input: {
    db: Db;
    siteId: string;
    id: string;
    changeSetId: string;
    code: "OPERATOR_CANCELLED" | "EXECUTION_CANCELLED";
    rollbackPlanId?: string;
  }) {
    const row = await readRow(input.siteId, input.id, input.db, true);
    const checked = await verify(row);
    if (
      checked.statement.target.kind === "action" ||
      (input.rollbackPlanId
        ? checked.statement.target.kind !== "changeset_rollback" ||
          checked.statement.target.rollbackPlanId !== input.rollbackPlanId
        : checked.statement.target.kind !== "changeset") ||
      checked.statement.target.changeSetId !== input.changeSetId
    )
      throw conflict();
    if (!["pending", "approved"].includes(row.state)) return;
    const time = await writeSystemRevocation(
      input.db,
      row,
      checked,
      "target_invalidated",
      input.code,
    );
    await input.db.insert(npAuditEvents).values({
      siteId: input.siteId,
      actorKind: "system",
      action: "agents.approvals.revoked",
      targetType: "agent-approval",
      targetId: row.id,
      payload: { code: input.code, kind: "target_invalidated", verification: "verified" },
      createdAt: time,
    });
  }
  async function revokeSystem(
    seed: Row,
    kind: "authority_loss" | "target_invalidated" | "integrity_key_retired",
    code: string,
    allowRetiredKey = false,
    retiredKeyId?: string,
  ) {
    const statement = npRequireAgentApprovalStatementCanonical(seed.statementBody);
    return options.targets.expire({
      siteId: seed.siteId,
      target: statement.target,
      mutate: async (db, target) => {
        const row = await readRow(seed.siteId, seed.id, db, true);
        if (!["pending", "approved"].includes(row.state) || row.version !== seed.version)
          return false;
        if (
          retiredKeyId &&
          row.integrityKeyId !== retiredKeyId &&
          row.decisionMac?.split(":")[2] !== retiredKeyId
        )
          return false;
        let checked;
        if (allowRetiredKey) {
          // Explicit emergency invalidation never treats the removed key as verification.
          const retained = npRequireAgentApprovalStatementCanonical(row.statementBody);
          if (
            retained.siteId !== row.siteId ||
            retained.approvalId !== row.id ||
            (await npDigestAgentApprovalStatementCanonical(retained)) !== row.statementHash
          )
            throw integrity();
          checked = {
            binding: {
              statement: retained,
              statementHash: row.statementHash,
              approvalGeneration: row.generation,
            },
            decisionBinding:
              row.decisionBody && row.decisionHash
                ? { decision: row.decisionBody, decisionHash: row.decisionHash }
                : null,
          };
        } else checked = await verify(row);
        const time = await writeSystemRevocation(db, row, checked, kind, code);
        await target.transition("ready");
        await db.insert(npAuditEvents).values({
          siteId: row.siteId,
          actorKind: "system",
          action: "agents.approvals.revoked",
          targetType: "agent-approval",
          targetId: row.id,
          payload: { code, kind, verification: allowRetiredKey ? "key-retired" : "verified" },
          createdAt: time,
        });
        return true;
      },
    });
  }
  /** Explicit host maintenance. Scan cursors are site/filter bound and never exposed by HTTP. */
  async function reconcile(input: {
    siteId: string;
    limit?: number;
    cursor?: string;
    retireIntegrityKeyId?: string;
  }) {
    const limit = input.limit ?? 100;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (input.retireIntegrityKeyId !== undefined &&
        (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.retireIntegrityKeyId) ||
          input.retireIntegrityKeyId === active.id))
    )
      throw new Error("Invalid approval maintenance request.");
    const binding = { siteId: input.siteId, keyId: input.retireIntegrityKeyId ?? null };
    let after: string | null = null;
    if (input.cursor) {
      const parsed = cursor.open(input.cursor) as {
        binding: typeof binding;
        after: string;
        expires: number;
      };
      if (
        !same(parsed.binding, binding) ||
        parsed.expires <= now().getTime() ||
        !/^[0-9a-f-]{36}$/u.test(parsed.after)
      )
        throw conflict();
      after = parsed.after;
    }
    const conditions = [
      eq(npAgentApprovals.siteId, input.siteId),
      inArray(npAgentApprovals.state, ["pending", "approved"]),
    ];
    if (after) conditions.push(sql`${npAgentApprovals.id}>${after}`);
    if (input.retireIntegrityKeyId)
      conditions.push(sql`(${npAgentApprovals.integrityKeyId}=${input.retireIntegrityKeyId} or
      split_part(${npAgentApprovals.decisionMac}, ':', 3)=${input.retireIntegrityKeyId})`);
    const rows = await getDb()
      .select()
      .from(npAgentApprovals)
      .where(and(...conditions))
      .orderBy(asc(npAgentApprovals.id))
      .limit(limit + 1);
    let revoked = 0,
      incidents = 0;
    for (const row of rows.slice(0, limit)) {
      try {
        if (input.retireIntegrityKeyId) {
          if (
            await revokeSystem(
              row,
              "integrity_key_retired",
              "APPROVAL_INTEGRITY_KEY_RETIRED",
              !keys.has(input.retireIntegrityKeyId),
              input.retireIntegrityKeyId,
            )
          )
            revoked++;
          continue;
        }
        const checked = await verify(row);
        if (row.expiresAt <= now()) continue; // Existing expiry owner has its own bounded scan.
        try {
          await options.targets.revalidate({ siteId: row.siteId, statement: checked.statement });
        } catch (error) {
          if (!(error instanceof NpAgentGatewayError)) throw error;
          const authorityCodes = [
            "AUTHORIZATION_CHANGED",
            "STAFF_AUTHORIZATION_REQUIRED",
            "SITE_ACCESS_DENIED",
            "CHANGESET_ACCESS_DENIED",
            "CAPABILITY_UNAVAILABLE",
            "TRANSPORT_UNAVAILABLE",
          ];
          const targetCodes = [
            "CHANGESET_CONFLICT",
            "CHANGESET_NOT_FOUND",
            "PREVIEW_REQUIRED",
            "APPROVAL_CONFLICT",
          ];
          if (!authorityCodes.includes(error.code) && !targetCodes.includes(error.code))
            throw error;
          const kind = authorityCodes.includes(error.code)
            ? "authority_loss"
            : "target_invalidated";
          if (
            await revokeSystem(
              row,
              kind,
              error.code === "PREVIEW_REQUIRED"
                ? "PREVIEW_REQUIRED"
                : kind === "authority_loss"
                  ? "APPROVAL_AUTHORITY_LOST"
                  : "APPROVAL_TARGET_INVALIDATED",
            )
          )
            revoked++;
        }
      } catch (error) {
        if (error instanceof NpAgentGatewayError && error.code === "APPROVAL_INTEGRITY_INVALID") {
          incidents++;
          await incident(input.siteId, row.id);
        }
      }
    }
    const last = rows[Math.min(rows.length, limit) - 1];
    return {
      examined: Math.min(rows.length, limit),
      revoked,
      incidents,
      nextCursor:
        rows.length > limit && last
          ? cursor.seal({ binding, after: last.id, expires: now().getTime() + 300_000 })
          : null,
    };
  }
  return {
    create,
    verify,
    summary,
    get,
    list,
    issueChallenge,
    decide,
    reconcileExpired,
    reconcile,
    consume,
    invalidateForExecution,
  };
}
export type NpAgentApprovalServiceV1 = ReturnType<typeof createAgentApprovalServiceV1>;
