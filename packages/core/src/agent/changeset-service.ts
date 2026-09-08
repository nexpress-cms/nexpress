import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, lte, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentApprovals,
  npAgentChangesetValidationAttempts,
} from "../db/schema/agent.js";
import { npUsers, npSessions, npSiteMemberships } from "../db/schema/system.js";
import { npAuditEvents } from "../db/schema/community.js";
import { can } from "../auth/capabilities.js";
import type { NpTransaction } from "../collections/pipeline.js";
import type { NpAuthUser } from "../config/types.js";
import {
  npRequireAgentChangeSetWire,
  npAnalyzeAgentChangeSetWire,
  npVerifyAgentChangeSetAdminProposalV1,
  npDigestAgentChangeSetDraftInputV1,
  npAgentChangeSetLimits,
  npRequireAgentChangeSetValidateRequestV1,
  type NpAgentChangeSetValidateRequestV1,
  type NpAgentValidationIssueWire,
  type NpAgentChangeSetDraftInputV1,
  type NpAgentChangeSetWire,
  type NpAgentChangeSetAdminInputV1,
} from "../agent-contract/changeset-wire-contract.js";
import {
  npDigestAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetSnapshotCanonical,
} from "../agent-contract/canonical-changeset.js";
import { npGetAgentAdminOperationV1 } from "../agent-contract/admin-operation-registry.js";
import {
  npDigestAgentCapabilityRegistryCanonical,
  npRequireAgentCapabilityRegistryCanonical,
} from "../agent-contract/canonical-capability-registry.js";
import {
  npDigestAgentInvocationRequestCanonical,
  npRequireAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import {
  npRequireAgentAuthorizationContextCanonical,
  npDigestAgentAuthorizationContextCanonical,
} from "../agent-contract/canonical-authorization-context.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAnalyzeAgentCursorPageV1 } from "../agent-contract/wire-contract.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
import {
  npAgentScopeStaffCapability,
  type NpAgentJsonObject,
  type NpAgentChangeSetProposalOperationCanonicalV1,
  type NpAgentScope,
  type NpAgentAuthorizationContextCanonicalV1,
} from "../agent-contract/types.js";
import {
  createAgentAdminAdmissionV1,
  npResolveAgentStaffSessionAuthorizationV1,
  npResolveLiveAgentStaffAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminAdmissionOptionsV1,
} from "./admin-admission.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";
import { createAgentChangeSetResourceServiceV1 } from "./changeset-resources.js";
import type { NpAgentGatewayServiceV1 } from "./gateway-service.js";
import { npDigestAgentStaffSiteAuthorizationCanonical } from "../agent-contract/canonical-bodies.js";
import {
  createAgentChangeSetValidationResourceServiceV1,
  NpAgentChangeSetValidationResourceErrorV1,
} from "./changeset-validation-resources.js";
import { createAgentCursorCodecV1 } from "./cursor.js";

type Db = ReturnType<typeof getDb>;
type Row = typeof npAgentChangesets.$inferSelect;
type OpRow = typeof npAgentChangesetOperations.$inferSelect;
export type NpAgentChangeSetActorV1 =
  | { kind: "staff"; siteId: string; actor: NpAgentAdminActorV1 }
  | { kind: "principal"; authentication: NpAgentCapabilityAuthenticationV1 };
export interface NpAgentChangeSetServiceOptionsV1 extends NpAgentAdminAdmissionOptionsV1 {
  cursorKey: Uint8Array;
  admission?: NpAgentCapabilityAdmissionServiceV1;
  eligibilitySeconds?: number;
  gateway?: Pick<NpAgentGatewayServiceV1, "getTransportAudience">;
  validationLifetimeSeconds?: number;
  inlineValidationOperationLimit?: number;
  rollbackWindowSeconds?: number;
  /** Explicit host producer. Failure leaves a durable queued attempt for reconciliation. */
  enqueueValidation?: (job: {
    siteId: string;
    attemptId: string;
    changeSetId: string;
    generation: number;
    draftVersion: number;
    draftHash: string;
  }) => Promise<void>;
}
const hash = (domain: string, value: unknown): `cj1:sha256:${string}` =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const missing = () =>
  new NpAgentGatewayError("CHANGESET_NOT_FOUND", 404, "ChangeSet is unavailable.");
const conflict = () =>
  new NpAgentGatewayError(
    "CHANGESET_CONFLICT",
    409,
    "ChangeSet changed or the request conflicts with an earlier operation.",
  );
const denied = () =>
  new NpAgentGatewayError("CHANGESET_ACCESS_DENIED", 403, "ChangeSet access is denied.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const json = (value: object) => value as unknown as NpAgentJsonObject;
interface Actor {
  siteId: string;
  user: NpAuthUser;
  fingerprint: string;
  authorization: string;
  principalId: string | null;
  scopes: readonly NpAgentScope[] | null;
}

/** Explicit server service. No transport registration, preview, apply, worker or runtime is installed. */
export function createAgentChangeSetServiceV1(options: NpAgentChangeSetServiceOptionsV1) {
  const now = options.now ?? (() => new Date());
  const lifetime = options.eligibilitySeconds ?? 30 * 86400;
  if (!Number.isSafeInteger(lifetime) || lifetime < 60 || lifetime > 90 * 86400)
    throw new Error("ChangeSet eligibility must be 60..7776000 seconds.");
  const cursor = createAgentCursorCodecV1(options.cursorKey, "np.agent-changeset.cursor");
  const admin = createAgentAdminAdmissionV1(options);
  const resources = createAgentChangeSetResourceServiceV1();
  const validationResources = createAgentChangeSetValidationResourceServiceV1();
  const validationLifetime = options.validationLifetimeSeconds ?? 3600;
  const inlineLimit = options.inlineValidationOperationLimit ?? 25;
  const rollbackWindow =
    options.rollbackWindowSeconds ?? npAgentChangeSetLimits.rollbackDefaultSeconds;
  if (
    !Number.isSafeInteger(validationLifetime) ||
    validationLifetime < 60 ||
    validationLifetime > 86400 ||
    !Number.isSafeInteger(inlineLimit) ||
    inlineLimit < 0 ||
    inlineLimit > 500 ||
    !Number.isSafeInteger(rollbackWindow) ||
    rollbackWindow < 60 ||
    rollbackWindow > npAgentChangeSetLimits.rollbackMaximumSeconds
  )
    throw new Error("Invalid ChangeSet validation limits.");
  async function resolve(input: NpAgentChangeSetActorV1, write: boolean): Promise<Actor> {
    const scope: NpAgentScope = write ? "changeset:write" : "changeset:read";
    if (input.kind === "staff") {
      const authority = await npResolveAgentStaffSessionAuthorizationV1(
        getDb(),
        input.siteId,
        input.actor,
        now(),
      );
      if (!authority.authority.capabilities.includes(npAgentScopeStaffCapability[scope]))
        throw denied();
      return {
        siteId: input.siteId,
        user: {
          ...input.actor.user,
          role:
            authority.authority.kind === "super-admin"
              ? "admin"
              : (authority.authority.role as NpAuthUser["role"]),
        },
        fingerprint: hash("np.agent-staff-actor.v1", {
          siteId: input.siteId,
          userId: input.actor.user.id,
        }),
        authorization: serializeAgentCanonicalJson(authority),
        principalId: null,
        scopes: null,
      };
    }
    if (!options.admission) throw missing();
    const auth = input.authentication;
    await options.admission.project({ authentication: auth });
    if (
      !auth.scopes.includes(scope) ||
      auth.principal.authority.kind !== "user" ||
      !auth.principal.authority.userId
    )
      throw denied();
    const siteId = auth.principal.siteId;
    const userId = auth.principal.authority.userId;
    const live = await npResolveLiveAgentStaffAuthorizationV1(getDb(), siteId, userId);
    const [user] = await getDb().select().from(npUsers).where(eq(npUsers.id, userId)).limit(1);
    if (!user || !live.authority.capabilities.includes(npAgentScopeStaffCapability[scope]))
      throw denied();
    return {
      siteId,
      principalId: auth.principal.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tokenVersion: user.tokenVersion,
        role:
          live.authority.kind === "super-admin"
            ? "admin"
            : (live.authority.role as NpAuthUser["role"]),
      },
      scopes: auth.scopes,
      fingerprint: auth.authorizationContext.actor.actorFingerprint,
      authorization: serializeAgentCanonicalJson({ context: auth.authorizationContext, live }),
    };
  }
  async function same(input: NpAgentChangeSetActorV1, actor: Actor, write = false) {
    if ((await resolve(input, write)).authorization !== actor.authorization) throw denied();
  }
  function requireScopes(actor: Actor, scopes: readonly NpAgentScope[]) {
    for (const scope of scopes)
      if (
        (actor.scopes && !actor.scopes.includes(scope)) ||
        !can(actor.user, npAgentScopeStaffCapability[scope])
      )
        throw denied();
  }
  async function operations(db: Db, row: Row) {
    const rows = await db
      .select()
      .from(npAgentChangesetOperations)
      .where(
        and(
          eq(npAgentChangesetOperations.siteId, row.siteId),
          eq(npAgentChangesetOperations.changesetId, row.id),
        ),
      )
      .orderBy(npAgentChangesetOperations.ordinal)
      .limit(501);
    if (rows.length > 500 || rows.some((op, index) => op.ordinal !== index + 1)) throw missing();
    return rows;
  }
  async function project(row: Row, actor: Actor, write = false): Promise<NpAgentChangeSetWire> {
    const ops = await operations(getDb(), row);
    const reserved = ops
      .filter((op) => op.input.kind === "document" && op.input.operation === "create")
      .flatMap((op) => (op.resourceKey.kind === "document" ? [op.resourceKey.documentId] : []));
    for (const op of ops) {
      const context = {
        siteId: row.siteId,
        user: actor.user,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      };
      requireScopes(
        actor,
        write
          ? (await resources.prepare({ ...context, reservedCreateDocumentIds: reserved }))
              .requiredScopes
          : await resources.assertVisible(context),
      );
    }
    // Canonical draft identity is checked again on every read; denormalized payloads never win.
    const proposal = npRequireAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    });
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== row.draftHash)
      throw missing();
    if (!["draft", "validating", "invalid", "ready", "cancelled"].includes(row.state))
      throw missing();
    let validation: NpAgentChangeSetWire["validation"] = null;
    let attempt: typeof npAgentChangesetValidationAttempts.$inferSelect | undefined;
    if (row.state !== "draft" && row.validationGeneration > 0) {
      [attempt] = await getDb()
        .select()
        .from(npAgentChangesetValidationAttempts)
        .where(
          and(
            eq(npAgentChangesetValidationAttempts.siteId, row.siteId),
            eq(npAgentChangesetValidationAttempts.changesetId, row.id),
            eq(npAgentChangesetValidationAttempts.generation, row.validationGeneration),
            eq(npAgentChangesetValidationAttempts.draftVersion, row.draftVersion),
            eq(npAgentChangesetValidationAttempts.draftHash, row.draftHash),
          ),
        )
        .limit(1);
    }
    if (["validating", "invalid", "ready"].includes(row.state) && !attempt) throw missing();
    if (attempt) {
      const context = npRequireAgentAuthorizationContextCanonical(attempt.authorizationContextBody);
      if (
        context.siteId !== row.siteId ||
        (await npDigestAgentAuthorizationContextCanonical(context)) !==
          attempt.authorizationContextFingerprint ||
        serializeAgentCanonicalJson(context.authorityRef) !==
          serializeAgentCanonicalJson(attempt.authorityRef) ||
        context.actor.kind !== attempt.requesterKind ||
        context.actor.actorFingerprint !== attempt.requesterFingerprint ||
        (context.actor.kind === "staff" ? context.actor.userId : context.actor.principalId) !==
          attempt.requesterId
      )
        throw missing();
      const [invocation] = await getDb()
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, row.siteId),
            eq(npAgentInvocations.id, attempt.admittingInvocationId),
          ),
        )
        .limit(1);
      if (
        !invocation ||
        invocation.state !== "completed" ||
        !["agents.changesets.validate", "changeset.validate"].includes(invocation.operationId) ||
        invocation.resultId !== row.id ||
        invocation.outputRedacted?.attemptId !== attempt.id ||
        invocation.authorizationContextFingerprint !== attempt.authorizationContextFingerprint ||
        serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
          serializeAgentCanonicalJson(context) ||
        (await npDigestAgentInvocationRequestCanonical(invocation.requestBody)) !==
          invocation.requestHash
      )
        throw missing();
      if (
        (row.state === "validating" && !["queued", "validating"].includes(attempt.state)) ||
        (row.state === "invalid" && !["invalid", "failed"].includes(attempt.state)) ||
        (row.state === "ready" && attempt.state !== "ready")
      )
        throw missing();
      validation = {
        state:
          attempt.state === "ready"
            ? "valid"
            : attempt.state === "validating"
              ? "running"
              : (attempt.state as "queued" | "invalid" | "failed"),
        generation: attempt.generation,
        issueCount: attempt.issues.length,
        digest: attempt.resultDigest,
        completedAt: attempt.finishedAt?.toISOString() ?? null,
      };
      if (attempt.state === "invalid") {
        if (
          attempt.resultDigest !==
          hash("np.agent-changeset-validation-result.v1", {
            generation: attempt.generation,
            draftHash: attempt.draftHash,
            issues: attempt.issues,
          })
        )
          throw missing();
        for (const op of ops) {
          const relevant = attempt.issues.filter(
            (issue) => issue.operationOrdinal === null || issue.operationOrdinal === op.ordinal,
          );
          if (
            serializeAgentCanonicalJson(op.issues) !== serializeAgentCanonicalJson(relevant) ||
            op.state !== (relevant.length ? "invalid" : "draft")
          )
            throw missing();
        }
      }
    }
    if (row.sealedPlanBody !== null) {
      const sealed = npRequireAgentChangeSetPlanCanonical(row.sealedPlanBody);
      if (
        sealed.planKind !== "changeset" ||
        sealed.siteId !== row.siteId ||
        sealed.changeSetId !== row.id ||
        !attempt ||
        attempt.state !== "ready" ||
        !["ready", "cancelled"].includes(row.state)
      )
        throw missing();
      const body = sealed.body;
      if (
        (await npDigestAgentChangeSetPlanCanonical(sealed)) !== row.planHash ||
        body.draftVersion !== row.draftVersion ||
        body.draftHash !== row.draftHash ||
        body.validationGeneration !== row.validationGeneration ||
        body.baseFingerprint !== row.baseFingerprint ||
        body.expiresAt !== row.expiresAt.toISOString() ||
        body.rollbackWindowSeconds !== row.rollbackWindowSeconds ||
        body.operations.length !== ops.length ||
        serializeAgentCanonicalJson(body.risk) !== serializeAgentCanonicalJson(row.riskSummary) ||
        serializeAgentCanonicalJson(body.risk) !==
          serializeAgentCanonicalJson(attempt.riskSummary) ||
        attempt.issues.length !== 0 ||
        attempt.resultDigest !==
          hash("np.agent-changeset-validation-result.v1", {
            generation: attempt.generation,
            draftHash: attempt.draftHash,
            planHash: row.planHash,
            issues: [],
          })
      )
        throw missing();
      let bytes = 0;
      const bases = [];
      for (let index = 0; index < ops.length; index++) {
        const op = ops[index];
        const planned = body.operations[index];
        const snapshot = op.beforeSnapshot;
        if (
          op.state !== "valid" ||
          op.issues.length !== 0 ||
          op.afterHash !== null ||
          op.resultDigest !== null ||
          planned.ordinal !== op.ordinal ||
          serializeAgentCanonicalJson(planned.operation) !==
            serializeAgentCanonicalJson(op.input) ||
          serializeAgentCanonicalJson(planned.canonicalResourceKey) !==
            serializeAgentCanonicalJson(op.resourceKey) ||
          serializeAgentCanonicalJson(op.baseVersion) !==
            serializeAgentCanonicalJson(op.input.base) ||
          op.beforeHash !== planned.beforeHash ||
          op.snapshotHash !== planned.snapshotHash ||
          !snapshot ||
          snapshot.siteId !== row.siteId ||
          snapshot.changeSetId !== row.id ||
          snapshot.operationOrdinal !== op.ordinal ||
          serializeAgentCanonicalJson(snapshot.canonicalResourceKey) !==
            serializeAgentCanonicalJson(op.resourceKey) ||
          (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== planned.snapshotHash
        )
          throw missing();
        bytes += Buffer.byteLength(serializeAgentCanonicalJson(snapshot));
        if (bytes > npAgentChangeSetLimits.aggregateSnapshotBytes) throw missing();
        const absentCreate =
          planned.operation.kind === "document" && planned.operation.operation === "create";
        if (
          snapshot.presence === "present" &&
          serializeAgentCanonicalJson(snapshot.base) !==
            serializeAgentCanonicalJson(planned.operation.base)
        )
          throw missing();
        if (
          snapshot.presence === "absent" &&
          !absentCreate &&
          !(
            planned.operation.kind === "setting" &&
            planned.operation.operation === "replace" &&
            planned.operation.base === null
          ) &&
          !(
            planned.operation.kind === "theme_tokens" &&
            planned.operation.base?.version === "absent" &&
            planned.operation.base.digest === planned.beforeHash
          )
        )
          throw missing();
        if (
          snapshot.presence === "present"
            ? snapshot.base?.digest !== planned.beforeHash
            : absentCreate
              ? planned.beforeHash !== null
              : planned.beforeHash !==
                hash("np.agent-changeset-resource.v1", {
                  siteId: row.siteId,
                  canonicalResourceKey: op.resourceKey,
                  presence: "absent",
                  value: null,
                })
        )
          throw missing();
        bases.push({
          ordinal: op.ordinal,
          canonicalResourceKey: op.resourceKey,
          presence: snapshot.presence,
          base: snapshot.base,
          snapshotHash: op.snapshotHash,
        });
      }
      if (
        body.baseFingerprint !== hash("np.agent-changeset-bases.v1", { siteId: row.siteId, bases })
      )
        throw missing();
    } else {
      if (
        row.planHash !== null ||
        row.baseFingerprint !== null ||
        row.riskSummary !== null ||
        row.rollbackWindowSeconds !== null ||
        row.state === "ready" ||
        attempt?.state === "ready"
      )
        throw missing();
      if (
        ops.some(
          (op) =>
            op.beforeSnapshot !== null ||
            op.snapshotHash !== null ||
            op.beforeHash !== null ||
            op.afterHash !== null ||
            op.resultDigest !== null,
        )
      )
        throw missing();
      if (
        ["draft", "validating"].includes(row.state) &&
        ops.some((op) => op.state !== "draft" || op.issues.length !== 0)
      )
        throw missing();
    }
    let name = "Deleted staff";
    const actorId = row.principalId ?? row.createdByUserId ?? row.actorFingerprint;
    if (row.principalId) {
      const [principal] = await getDb()
        .select({ name: npAgentPrincipals.name })
        .from(npAgentPrincipals)
        .where(
          and(eq(npAgentPrincipals.siteId, row.siteId), eq(npAgentPrincipals.id, row.principalId)),
        )
        .limit(1);
      if (!principal) throw missing();
      name = principal.name;
    } else if (row.createdByUserId) {
      const [user] = await getDb()
        .select({ name: npUsers.name })
        .from(npUsers)
        .where(eq(npUsers.id, row.createdByUserId))
        .limit(1);
      if (!user) throw missing();
      name = user.name ?? "Staff";
    }
    return npRequireAgentChangeSetWire({
      schemaVersion: "np.agent-changeset.v1",
      id: row.id,
      siteId: row.siteId,
      title: row.title,
      summary: row.summary,
      state: row.state,
      actor: { id: actorId, kind: row.creatorKind, name },
      agentId: row.agentId,
      agentVersionId: row.agentVersionId,
      agentConfigHash: row.agentConfigHash,
      runId: row.runId,
      planHash: row.planHash,
      baseFingerprint: row.baseFingerprint,
      draftVersion: row.draftVersion,
      draftHash: row.draftHash,
      risk: row.riskSummary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
        beforeHash: op.beforeHash,
        afterHash: op.afterHash,
        state: op.state,
        issues: op.issues,
        resultDigest: op.resultDigest,
      })),
      validation,
      preview: null,
      approval: null,
      schedule: null,
      execution: null,
      verification: null,
      rollback: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }
  async function get(input: { actor: NpAgentChangeSetActorV1; id: string }) {
    const actor = await resolve(input.actor, false);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, input.id)))
      .limit(1);
    if (!row) throw missing();
    let result: NpAgentChangeSetWire;
    try {
      result = await project(row, actor);
    } catch {
      throw missing();
    }
    await same(input.actor, actor);
    return result;
  }
  async function prepare(
    actor: Actor,
    draft: NpAgentChangeSetDraftInputV1,
    previous: readonly OpRow[],
  ) {
    const old = new Map(previous.map((op) => [op.clientOperationId, op]));
    const proposed: NpAgentChangeSetProposalOperationCanonicalV1[] = draft.operations.map(
      (op, index) => {
        const prior = old.get(op.clientOperationId);
        const key =
          op.kind === "document" && op.operation === "create"
            ? {
                kind: "document" as const,
                collection: op.resource.collection,
                documentId:
                  prior?.input.kind === "document" && prior.input.operation === "create"
                    ? prior.resourceKey.kind === "document"
                      ? prior.resourceKey.documentId
                      : randomUUID()
                    : randomUUID(),
              }
            : { kind: op.kind, ...op.resource };
        if (
          prior &&
          op.kind === "document" &&
          op.operation === "create" &&
          (prior.input.kind !== "document" ||
            prior.input.operation !== "create" ||
            prior.input.resource.collection !== op.resource.collection)
        )
          throw conflict();
        return {
          ordinal: index + 1,
          operation: op,
          canonicalResourceKey: key,
        } as NpAgentChangeSetProposalOperationCanonicalV1;
      },
    );
    const reserved = proposed
      .filter((op) => op.operation.kind === "document" && op.operation.operation === "create")
      .map((op) =>
        op.canonicalResourceKey.kind === "document" ? op.canonicalResourceKey.documentId : "",
      );
    for (const op of proposed) {
      const result = await resources.prepare({
        siteId: actor.siteId,
        user: actor.user,
        operation: op.operation,
        canonicalResourceKey: op.canonicalResourceKey,
        reservedCreateDocumentIds: reserved,
      });
      requireScopes(actor, result.requiredScopes);
      op.operation = result.operation;
    }
    return proposed;
  }
  async function mutate(
    db: Db,
    time: Date,
    actor: Actor,
    draft: NpAgentChangeSetDraftInputV1,
    request: NpAgentChangeSetAdminInputV1,
    id: string | null,
    invocationId: string,
  ) {
    const inputHash = await npDigestAgentChangeSetDraftInputV1(draft);
    const sourceKey = hash("np.agent-changeset-source-idempotency.v1", request.idempotencyKey);
    let current: Row | undefined;
    if (id) {
      [current] = await db
        .select()
        .from(npAgentChangesets)
        .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
        .for("update")
        .limit(1);
      if (!current) throw missing();
      if (
        !("expectedVersion" in request) ||
        current.draftVersion !== request.expectedVersion ||
        !["draft", "invalid"].includes(current.state) ||
        current.expiresAt <= now()
      )
        throw conflict();
      const [approval] = await db
        .select({ id: npAgentApprovals.id })
        .from(npAgentApprovals)
        .where(and(eq(npAgentApprovals.siteId, actor.siteId), eq(npAgentApprovals.targetId, id)))
        .limit(1);
      if (approval) throw conflict();
    } else {
      [current] = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, actor.siteId),
            eq(npAgentChangesets.actorFingerprint, actor.fingerprint),
            eq(npAgentChangesets.sourceOperationId, "changeset.create"),
            eq(npAgentChangesets.sourceIdempotencyFingerprint, sourceKey),
          ),
        )
        .limit(1);
      if (current) {
        if (current.sourceInputHash !== inputHash) throw conflict();
        return current.id;
      }
    }
    const previous = current ? await operations(db, current) : [];
    if (current)
      for (const op of previous)
        requireScopes(
          actor,
          await resources.assertVisible({
            siteId: actor.siteId,
            user: actor.user,
            operation: op.input,
            canonicalResourceKey: op.resourceKey,
          }),
        );
    const changeSetId = current?.id ?? randomUUID();
    const version = current ? current.draftVersion + 1 : 1;
    const ops = await prepare(actor, draft, previous);
    const draftHash = await npDigestAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: actor.siteId,
      changeSetId,
      draftVersion: version,
      title: draft.title,
      summary: draft.summary,
      operations: ops,
    });
    time = now();
    if (current && current.expiresAt <= time) throw conflict();
    if (!current) {
      const [invocation] = await db
        .select({ fingerprint: npAgentInvocations.requestHash })
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, invocationId))
        .limit(1);
      if (!invocation) throw missing();
      await db.insert(npAgentChangesets).values({
        id: changeSetId,
        siteId: actor.siteId,
        creatorKind: actor.principalId ? "external" : "staff",
        principalId: actor.principalId,
        createdByUserId: actor.principalId ? null : actor.user.id,
        actorFingerprint: actor.fingerprint,
        sourceOperationId: "changeset.create",
        sourceInputHash: inputHash,
        sourceIdempotencyFingerprint: sourceKey,
        invocationId,
        invocationFingerprint: invocation.fingerprint,
        title: draft.title,
        summary: draft.summary,
        draftHash,
        expiresAt: new Date(time.getTime() + lifetime * 1000),
        createdAt: time,
        updatedAt: time,
      });
    } else {
      await db
        .update(npAgentChangesets)
        .set({
          title: draft.title,
          summary: draft.summary,
          draftVersion: version,
          draftHash,
          state: "draft",
          planHash: null,
          sealedPlanBody: null,
          baseFingerprint: null,
          rollbackWindowSeconds: null,
          riskSummary: null,
          policyRefs: [],
          rollbackEligibleUntil: null,
          scheduledFor: null,
          cancellationCode: null,
          updatedAt: time,
        })
        .where(eq(npAgentChangesets.id, changeSetId));
      await db
        .delete(npAgentChangesetOperations)
        .where(
          and(
            eq(npAgentChangesetOperations.siteId, actor.siteId),
            eq(npAgentChangesetOperations.changesetId, changeSetId),
          ),
        );
    }
    if (ops.length)
      await db.insert(npAgentChangesetOperations).values(
        ops.map((op) => ({
          siteId: actor.siteId,
          changesetId: changeSetId,
          ordinal: op.ordinal,
          clientOperationId: op.operation.clientOperationId,
          resourceKind: op.operation.kind,
          resourceKey: op.canonicalResourceKey,
          operation: op.operation.operation,
          input: op.operation,
          baseVersion: op.operation.base,
          beforeHash: null,
          state: "draft",
          createdAt: time,
          updatedAt: time,
        })),
      );
    if (current && current.expiresAt <= now()) throw conflict();
    return changeSetId;
  }
  function definition(operation: "create" | "validate") {
    const validating = operation === "validate";
    const sourceSchema = npGetAgentAdminOperationV1(
      validating ? "agents.changesets.validate" : "agents.changesets.create",
    ).schemas.input.schema;
    const inputSchema = validating
      ? {
          ...sourceSchema,
          properties: {
            ...(sourceSchema.properties as object),
            changeSetId: { type: "string", format: "uuid", maxLength: 36 },
          },
          required: [...(sourceSchema.required as string[]), "changeSetId"],
        }
      : sourceSchema;
    return npRequireAgentCapabilityRegistryCanonical({
      schemaVersion: "np.agent-capability-registry.v1",
      projection: "definition",
      capabilities: [
        {
          descriptor: {
            schemaVersion: "np.agent-capability.v1",
            id: validating ? "changeset.validate" : "changeset.create",
            contractVersion: 1,
            source: "core",
            title: validating ? "Validate ChangeSet draft" : "Create ChangeSet draft",
            description: validating
              ? "Validate and seal the current draft without applying content changes."
              : "Persist a canonical draft without applying content changes.",
            requiredScopes: [validating ? "changeset:read" : "changeset:write"],
            scopeDerivation: "changeset-resources",
            risk: "reversible",
            approval: "none",
            effectProfiles: [
              {
                id: validating ? "changeset.validation" : "changeset.draft-create",
                kind: "mutation",
                reversibility: "none",
                minimumGatewayExposure: "propose",
                verifierId: validating ? "changeset.validation.verify" : "changeset.draft.verify",
                compensatorId: null,
              },
            ],
            bootstrapIntent: "write",
            execution: "inline",
            idempotency: "required",
            gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
            inputSchema,
            outputSchema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              additionalProperties: false,
              properties: {
                changeSetId: { type: "string", format: "uuid", maxLength: 36 },
                ...(validating
                  ? { attemptId: { type: "string", format: "uuid", maxLength: 36 } }
                  : {}),
              },
              required: validating ? ["changeSetId", "attemptId"] : ["changeSetId"],
            },
          },
          implementationVersion: 1,
          effectProfiles: [
            {
              schemaVersion: "np.agent-effect-profile.v1",
              capabilityId: validating ? "changeset.validate" : "changeset.create",
              capabilityContractVersion: 1,
              implementationVersion: 1,
              profileId: validating ? "changeset.validation" : "changeset.draft-create",
              kind: "mutation",
              reversibility: "none",
              minimumGatewayExposure: "propose",
              effectContractVersion: 1,
              verifierId: validating ? "changeset.validation.verify" : "changeset.draft.verify",
              compensatorId: null,
            },
          ],
        },
      ],
    });
  }
  const createDefinition = definition("create");
  const validateDefinition = definition("validate");
  async function invokePrincipal(
    input: Extract<NpAgentChangeSetActorV1, { kind: "principal" }>,
    actor: Actor,
    request: NpAgentChangeSetAdminInputV1<"create"> | NpAgentChangeSetValidateRequestV1,
    kind: "create" | "validate",
    persist: (
      db: Db,
      time: Date,
      invocationId: string,
    ) => Promise<{ changeSetId: string; attemptId?: string }>,
    targetId?: string,
  ) {
    if (!options.admission) throw missing();
    const authentication = input.authentication;
    const operationId = kind === "create" ? "changeset.create" : "changeset.validate";
    const profileId = kind === "create" ? "changeset.draft-create" : "changeset.validation";
    const definitionBody = kind === "create" ? createDefinition : validateDefinition;
    const fingerprint = await npDigestAgentCapabilityRegistryCanonical(
      definitionBody,
      definitionBody.capabilities,
    );
    const authorizationFingerprint = await npDigestAgentAuthorizationContextCanonical(
      authentication.authorizationContext,
    );
    const body = npRequireAgentInvocationRequestCanonical({
      schemaVersion: "np.agent-idempotency-request.v1",
      siteId: actor.siteId,
      actorKind: "principal",
      actorFingerprint: actor.fingerprint,
      authorizationContextFingerprint: authorizationFingerprint,
      operationKind: "capability",
      operationId,
      contractVersion: 1,
      contractFingerprint: fingerprint,
      effectProfile: { id: profileId, contractVersion: 1 },
      input: json(kind === "validate" ? { ...request, changeSetId: targetId } : request),
    });
    const requestHash = await npDigestAgentInvocationRequestCanonical(body);
    return options.admission.withCurrentAuthority({
      authentication,
      requiredScopes: authentication.scopes,
      minimumExposure: "propose",
      mutate: async (db, time) => {
        const [previous] = await db
          .select()
          .from(npAgentInvocations)
          .where(
            and(
              eq(npAgentInvocations.siteId, actor.siteId),
              eq(npAgentInvocations.actorFingerprint, actor.fingerprint),
              eq(npAgentInvocations.authorizationContextFingerprint, authorizationFingerprint),
              eq(npAgentInvocations.operationKind, "capability"),
              eq(npAgentInvocations.operationId, operationId),
              eq(npAgentInvocations.idempotencyKey, request.idempotencyKey),
            ),
          )
          .limit(1);
        if (previous) {
          if (
            previous.requestHash !== requestHash ||
            previous.state !== "completed" ||
            !previous.resultId
          )
            throw conflict();
          const output = previous.outputRedacted;
          if (
            !output ||
            output.changeSetId !== previous.resultId ||
            (kind === "validate" &&
              (typeof output.attemptId !== "string" || !uuid.test(output.attemptId)))
          )
            throw conflict();
          return {
            changeSetId: previous.resultId,
            ...(kind === "validate" ? { attemptId: output.attemptId as string } : {}),
          };
        }
        const [audit] = await db
          .insert(npAuditEvents)
          .values({
            siteId: actor.siteId,
            actorKind: "agent-principal",
            action: kind === "create" ? "agents.changesets.create" : "agents.changesets.validate",
            targetType: "agent-changeset",
            targetId: null,
            payload: { requestHash, operationId, outcome: "completed" },
            createdAt: time,
          })
          .returning({ id: npAuditEvents.id });
        if (!audit) throw missing();
        const invocationId = randomUUID();
        await db.insert(npAgentInvocations).values({
          id: invocationId,
          siteId: actor.siteId,
          actorKind: "principal",
          principalId: actor.principalId,
          actorFingerprint: actor.fingerprint,
          authorizationContextBody: authentication.authorizationContext,
          authorizationContextFingerprint: authorizationFingerprint,
          authorityRef: authentication.authorizationContext.authorityRef,
          operationKind: "capability",
          operationId,
          contractVersion: 1,
          contractFingerprint: fingerprint,
          capabilityDefinitionBody: definitionBody,
          effectProfileId: profileId,
          effectContractVersion: 1,
          transport: authentication.authorizationContext.transport,
          mcpExecutionMode: ["mcp-service", "mcp-oauth"].includes(
            authentication.authorizationContext.transport,
          )
            ? "normal"
            : null,
          idempotencyKey: request.idempotencyKey,
          requestBody: body,
          requestHash,
          state: "started",
          auditEventId: audit.id,
          requestedAt: time,
          expiresAt: new Date(time.getTime() + 86400_000),
        });
        const output = await persist(db, time, invocationId);
        const id = output.changeSetId;
        await db.update(npAuditEvents).set({ targetId: id }).where(eq(npAuditEvents.id, audit.id));
        await db
          .update(npAgentInvocations)
          .set({
            state: "completed",
            resultKind: "changeset",
            resultId: id,
            outputRedacted: output,
            outputHash: hash("np.agent-changeset-result.v1", output),
            completedAt: time,
          })
          .where(eq(npAgentInvocations.id, invocationId));
        return output;
      },
    });
  }
  async function write(input: { actor: NpAgentChangeSetActorV1; command: unknown; id?: string }) {
    const mode = input.id === undefined ? "create" : "update";
    if (input.id !== undefined && !uuid.test(input.id)) throw missing();
    if (mode === "update" && input.actor.kind !== "staff") throw denied();
    const { request, draft } = await npVerifyAgentChangeSetAdminProposalV1(mode, input.command);
    const actor = await resolve(input.actor, true);
    let id: string | undefined;
    // Unique constraints and serializable isolation close concurrent acceptance without replaying effects.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (input.actor.kind === "staff") {
          const result = await admin({
            siteId: actor.siteId,
            actor: input.actor.actor,
            operationId:
              mode === "create" ? "agents.changesets.create" : "agents.changesets.update",
            targetId: input.id ?? null,
            command: request,
            mutate: async ({ db, now: time, invocationId }) => {
              const changeSetId = await mutate(
                db,
                time,
                actor,
                draft,
                request,
                input.id ?? null,
                invocationId,
              );
              await same(input.actor, actor, true);
              return { resourceId: changeSetId, output: { changeSetId } };
            },
          });
          id = result.resourceId;
        } else
          id = (
            await invokePrincipal(
              input.actor,
              actor,
              request,
              "create",
              async (db, time, invocationId) => ({
                changeSetId: await mutate(db, time, actor, draft, request, null, invocationId),
              }),
            )
          ).changeSetId;
        break;
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        if (attempt === 2 || !["40001", "23505"].includes(cause.cause?.code ?? cause.code ?? ""))
          throw error;
        await same(input.actor, actor, true);
      }
    }
    if (!id) throw conflict();
    await same(input.actor, actor, true);
    const [row] = await getDb()
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
      .limit(1);
    if (!row) throw missing();
    const result = await project(row, actor, true);
    await same(input.actor, actor, true);
    return result;
  }
  async function list(input: { actor: NpAgentChangeSetActorV1; limit?: number; cursor?: string }) {
    const actor = await resolve(input.actor, false);
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new NpAgentGatewayError("CHANGESET_QUERY_INVALID", 400, "Invalid ChangeSet query.");
    const binding = cursor.mac(
      serializeAgentCanonicalJson({
        siteId: actor.siteId,
        actor: actor.fingerprint,
        authorization: actor.authorization,
        limit,
      }),
    );
    let position: { id: string; time: string } | null = null;
    if (input.cursor) {
      try {
        const value = cursor.open(input.cursor) as {
          binding: string;
          expires: number;
          position: { id: string; time: string };
        };
        if (
          value.binding !== binding ||
          !Number.isFinite(value.expires) ||
          value.expires <= now().getTime() ||
          !uuid.test(value.position.id) ||
          new Date(value.position.time).toISOString() !== value.position.time
        )
          throw missing();
        position = value.position;
      } catch {
        throw new NpAgentGatewayError(
          "CHANGESET_CURSOR_INVALID",
          400,
          "ChangeSet cursor is invalid.",
        );
      }
    }
    const items: NpAgentChangeSetWire[] = [];
    let more = false;
    let bytes = 4096;
    let pageFull = false;
    for (let scanned = 0; scanned < 500;) {
      const where: SQL[] = [eq(npAgentChangesets.siteId, actor.siteId)];
      if (position)
        where.push(
          or(
            lt(npAgentChangesets.createdAt, new Date(position.time)),
            and(
              eq(npAgentChangesets.createdAt, new Date(position.time)),
              lt(npAgentChangesets.id, position.id),
            ),
          )!,
        );
      const rows = await getDb()
        .select()
        .from(npAgentChangesets)
        .where(and(...where))
        .orderBy(desc(npAgentChangesets.createdAt), desc(npAgentChangesets.id))
        .limit(50);
      more = rows.length === 50;
      for (const row of rows) {
        scanned++;
        const previousPosition = position;
        position = { id: row.id, time: row.createdAt.toISOString() };
        let value: NpAgentChangeSetWire;
        try {
          value = await project(row, actor);
        } catch {
          continue;
        }
        const size = Buffer.byteLength(JSON.stringify(value));
        if (items.length && bytes + size > npAgentChangeSetLimits.wireBytes) {
          position = previousPosition;
          pageFull = true;
          more = true;
          break;
        }
        items.push(value);
        bytes += size;
        if (items.length === limit) {
          more = true;
          break;
        }
      }
      if (items.length === limit || pageFull || !more) break;
    }
    await same(input.actor, actor);
    return npRequireAgentContractResult(
      npAnalyzeAgentCursorPageV1(
        {
          schemaVersion: "np.agent-changesets.v1",
          items,
          nextCursor:
            more && position
              ? cursor.seal({ binding, position, expires: now().getTime() + 900000 })
              : null,
        },
        {
          schemaVersion: "np.agent-changesets.v1",
          analyzeItem: npAnalyzeAgentChangeSetWire,
          itemIssueRoot: "agent.changeset.wire",
          maximumBytes: npAgentChangeSetLimits.wireBytes,
          maximumDepth: 64,
        },
      ),
    );
  }
  const validationFailure = (
    code: "ACCESS_DENIED" | "VALIDATION_FAILED" = "VALIDATION_FAILED",
  ): NpAgentValidationIssueWire => ({
    code,
    severity: "error",
    operationOrdinal: null,
    path: "validation",
    message:
      code === "ACCESS_DENIED"
        ? "Validation authority is unavailable."
        : "Validation could not be completed.",
    evidenceRefs: [],
  });
  async function admitValidation(
    db: Db,
    actor: Actor,
    id: string,
    request: NpAgentChangeSetValidateRequestV1,
    invocationId: string,
  ) {
    const [row] = await db
      .select()
      .from(npAgentChangesets)
      .where(and(eq(npAgentChangesets.siteId, actor.siteId), eq(npAgentChangesets.id, id)))
      .for("update")
      .limit(1);
    const time = now();
    if (!row) throw missing();
    if (
      row.draftVersion !== request.expectedVersion ||
      !["draft", "invalid"].includes(row.state) ||
      row.expiresAt.getTime() - time.getTime() < 60000
    )
      throw conflict();
    const ops = await operations(db, row);
    for (const op of ops)
      requireScopes(
        actor,
        await resources.assertVisible({
          siteId: row.siteId,
          user: actor.user,
          operation: op.input,
          canonicalResourceKey: op.resourceKey,
          tx: db as unknown as NpTransaction,
        }),
      );
    const proposal = {
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    };
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== row.draftHash)
      throw conflict();
    const [invocation] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(eq(npAgentInvocations.siteId, row.siteId), eq(npAgentInvocations.id, invocationId)),
      )
      .limit(1);
    if (!invocation) throw missing();
    const context = npRequireAgentAuthorizationContextCanonical(
      invocation.authorizationContextBody,
    );
    const generation = row.validationGeneration + 1;
    const attemptId = randomUUID();
    await db.insert(npAgentChangesetValidationAttempts).values({
      id: attemptId,
      siteId: row.siteId,
      changesetId: row.id,
      generation,
      draftVersion: row.draftVersion,
      draftHash: row.draftHash,
      admittingInvocationId: invocationId,
      authorizationContextBody: context,
      authorizationContextFingerprint: invocation.authorizationContextFingerprint,
      authorityRef: context.authorityRef,
      requesterKind: context.actor.kind,
      requesterId:
        context.actor.kind === "staff" ? context.actor.userId : context.actor.principalId,
      requesterFingerprint: context.actor.actorFingerprint,
      createdAt: time,
      expiresAt: new Date(
        Math.min(row.expiresAt.getTime(), time.getTime() + validationLifetime * 1000),
      ),
    });
    await db
      .update(npAgentChangesets)
      .set({
        state: "validating",
        validationGeneration: generation,
        planHash: null,
        sealedPlanBody: null,
        baseFingerprint: null,
        riskSummary: null,
        policyRefs: [],
        rollbackWindowSeconds: null,
        updatedAt: time,
      })
      .where(eq(npAgentChangesets.id, id));
    await db
      .update(npAgentChangesetOperations)
      .set({
        state: "draft",
        beforeHash: null,
        beforeSnapshot: null,
        snapshotHash: null,
        afterHash: null,
        issues: [],
        resultDigest: null,
        updatedAt: time,
      })
      .where(
        and(
          eq(npAgentChangesetOperations.siteId, row.siteId),
          eq(npAgentChangesetOperations.changesetId, id),
        ),
      );
    return { changeSetId: id, attemptId };
  }
  async function storedStaff(
    db: Db,
    context: NpAgentAuthorizationContextCanonicalV1,
    fingerprint: string,
  ): Promise<Actor> {
    const checked = npRequireAgentAuthorizationContextCanonical(context);
    const ref = checked.authorityRef;
    if (
      ref.kind !== "staff-session" ||
      checked.actor.kind !== "staff" ||
      (await npDigestAgentAuthorizationContextCanonical(checked)) !== fingerprint
    )
      throw denied();
    const [user] = await db
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
        and(eq(npSiteMemberships.siteId, checked.siteId), eq(npSiteMemberships.userId, ref.userId)),
      )
      .for("update");
    if (!user || user.tokenVersion !== ref.userTokenVersion) throw denied();
    const authority = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      checked.siteId,
      { user, sessionId: ref.sessionId },
      now(),
    );
    if (
      (await npDigestAgentStaffSiteAuthorizationCanonical(authority)) !==
      ref.siteAuthorizationDigest
    )
      throw denied();
    const effectiveUser = {
      ...user,
      role:
        authority.authority.kind === "super-admin"
          ? ("admin" as const)
          : (authority.authority.role as NpAuthUser["role"]),
    };
    if (!can(effectiveUser, "site.access")) throw denied();
    return {
      siteId: checked.siteId,
      user: effectiveUser,
      scopes: null,
      principalId: null,
      fingerprint: checked.actor.actorFingerprint,
      authorization: serializeAgentCanonicalJson(authority),
    };
  }
  async function performValidation(
    db: Db,
    actor: Actor,
    seed: typeof npAgentChangesetValidationAttempts.$inferSelect,
  ) {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np.agent-changeset:${seed.siteId}`}, 0))`,
    );
    const [row] = await db
      .select()
      .from(npAgentChangesets)
      .where(
        and(eq(npAgentChangesets.siteId, seed.siteId), eq(npAgentChangesets.id, seed.changesetId)),
      )
      .for("update")
      .limit(1);
    const [attempt] = await db
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, seed.siteId),
          eq(npAgentChangesetValidationAttempts.id, seed.id),
        ),
      )
      .for("update")
      .limit(1);
    if (!row || !attempt) return { state: "stale" as const };
    if (!["queued", "validating"].includes(attempt.state)) return { state: attempt.state };
    if (
      row.validationGeneration !== attempt.generation ||
      row.draftVersion !== attempt.draftVersion ||
      row.draftHash !== attempt.draftHash ||
      row.state !== "validating"
    )
      return { state: "stale" as const };
    if (attempt.expiresAt <= now() || row.expiresAt <= now())
      throw new NpAgentGatewayError("VALIDATION_EXPIRED", 409, "Validation expired.");
    if (
      serializeAgentCanonicalJson(attempt.authorizationContextBody) !==
        serializeAgentCanonicalJson(seed.authorizationContextBody) ||
      attempt.authorizationContextFingerprint !== seed.authorizationContextFingerprint ||
      actor.fingerprint !== attempt.requesterFingerprint ||
      actor.siteId !== attempt.siteId
    )
      throw denied();
    const [invocation] = await db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, row.siteId),
          eq(npAgentInvocations.id, attempt.admittingInvocationId),
        ),
      )
      .limit(1);
    if (
      !invocation ||
      invocation.state !== "completed" ||
      !["agents.changesets.validate", "changeset.validate"].includes(invocation.operationId) ||
      invocation.resultId !== row.id ||
      invocation.outputRedacted?.attemptId !== attempt.id ||
      invocation.authorizationContextFingerprint !== attempt.authorizationContextFingerprint ||
      serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
        serializeAgentCanonicalJson(attempt.authorizationContextBody) ||
      serializeAgentCanonicalJson(invocation.authorityRef) !==
        serializeAgentCanonicalJson(attempt.authorityRef) ||
      (await npDigestAgentInvocationRequestCanonical(invocation.requestBody)) !==
        invocation.requestHash
    )
      throw missing();
    const ops = await operations(db, row);
    const proposal = npRequireAgentChangeSetProposalCanonical({
      schemaVersion: "np.agent-changeset-proposal.v1",
      siteId: row.siteId,
      changeSetId: row.id,
      draftVersion: row.draftVersion,
      title: row.title,
      summary: row.summary,
      operations: ops.map((op) => ({
        ordinal: op.ordinal,
        operation: op.input,
        canonicalResourceKey: op.resourceKey,
      })),
    });
    if ((await npDigestAgentChangeSetProposalCanonical(proposal)) !== attempt.draftHash)
      throw missing();
    for (const op of ops) {
      try {
        requireScopes(
          actor,
          await resources.assertVisible({
            siteId: row.siteId,
            user: actor.user,
            operation: op.input,
            canonicalResourceKey: op.resourceKey,
            tx: db as unknown as NpTransaction,
          }),
        );
      } catch (error) {
        if (error instanceof NpAgentGatewayError) throw denied();
        throw error;
      }
    }
    await db
      .update(npAgentChangesetValidationAttempts)
      .set({ state: "validating", startedAt: now() })
      .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
    let checked: Awaited<ReturnType<typeof validationResources.validate>>;
    try {
      checked = await validationResources.validate({
        tx: db as unknown as NpTransaction,
        siteId: row.siteId,
        user: actor.user,
        changeSetId: row.id,
        operations: proposal.operations,
        now: now(),
      });
      requireScopes(actor, checked.requiredScopes);
    } catch (error) {
      if (!(error instanceof NpAgentChangeSetValidationResourceErrorV1)) throw error;
      if (attempt.expiresAt <= now() || row.expiresAt <= now())
        throw new NpAgentGatewayError("VALIDATION_EXPIRED", 409, "Validation expired.");
      const issues = error.issues;
      const resultDigest = hash("np.agent-changeset-validation-result.v1", {
        generation: attempt.generation,
        draftHash: attempt.draftHash,
        issues,
      });
      await db
        .update(npAgentChangesetValidationAttempts)
        .set({ state: "invalid", issues: issues.map(json), resultDigest, finishedAt: now() })
        .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
      await db
        .update(npAgentChangesets)
        .set({ state: "invalid", updatedAt: now() })
        .where(eq(npAgentChangesets.id, row.id));
      for (const op of ops) {
        const relevant = issues.filter(
          (issue) => issue.operationOrdinal === null || issue.operationOrdinal === op.ordinal,
        );
        await db
          .update(npAgentChangesetOperations)
          .set({
            state: relevant.length ? "invalid" : "draft",
            issues: relevant.map(json),
            updatedAt: now(),
          })
          .where(eq(npAgentChangesetOperations.id, op.id));
      }
      await db.insert(npAuditEvents).values({
        siteId: row.siteId,
        actorKind: "system",
        action: "agents.changesets.validation_finished",
        targetType: "agent-changeset",
        targetId: row.id,
        payload: {
          generation: attempt.generation,
          outcome: "invalid",
          issueCount: issues.length,
        },
        createdAt: now(),
      });
      return { state: "invalid" as const };
    }
    if (attempt.expiresAt <= now() || row.expiresAt <= now())
      throw new NpAgentGatewayError("VALIDATION_EXPIRED", 409, "Validation expired.");
    const requiredApplyScopes: NpAgentScope[] = [
      ...new Set<NpAgentScope>(["changeset:apply", ...checked.requiredApplyScopes]),
    ].sort();
    const plan = npRequireAgentChangeSetPlanCanonical({
      schemaVersion: "np.agent-changeset-plan.v1",
      planKind: "changeset",
      siteId: row.siteId,
      changeSetId: row.id,
      body: {
        draftVersion: row.draftVersion,
        draftHash: row.draftHash,
        validationGeneration: attempt.generation,
        baseFingerprint: checked.baseFingerprint,
        operations: checked.operations,
        risk: checked.risk,
        requiredScopes: requiredApplyScopes,
        requiredHumanCapabilities: [
          ...new Set(requiredApplyScopes.map((scope) => npAgentScopeStaffCapability[scope])),
        ].sort(),
        requiredHumanPredicates: [],
        policyHashes: checked.policyHashes,
        expiresAt: row.expiresAt.toISOString(),
        rollbackWindowSeconds: rollbackWindow,
      },
    });
    const planHash = await npDigestAgentChangeSetPlanCanonical(plan);
    const resultDigest = hash("np.agent-changeset-validation-result.v1", {
      generation: attempt.generation,
      draftHash: attempt.draftHash,
      planHash,
      issues: [],
    });
    for (const op of checked.operations) {
      const snapshot = checked.snapshots.find(
        (snapshot) => snapshot.operationOrdinal === op.ordinal,
      );
      if (
        !snapshot ||
        (await npDigestAgentChangeSetSnapshotCanonical(snapshot)) !== op.snapshotHash
      )
        throw missing();
      await db
        .update(npAgentChangesetOperations)
        .set({
          state: "valid",
          beforeHash: op.beforeHash,
          beforeSnapshot: snapshot,
          snapshotHash: op.snapshotHash,
          issues: [],
          updatedAt: now(),
        })
        .where(
          and(
            eq(npAgentChangesetOperations.siteId, row.siteId),
            eq(npAgentChangesetOperations.changesetId, row.id),
            eq(npAgentChangesetOperations.ordinal, op.ordinal),
          ),
        );
    }
    await db
      .update(npAgentChangesets)
      .set({
        state: "ready",
        planHash,
        sealedPlanBody: plan,
        baseFingerprint: checked.baseFingerprint,
        riskSummary: checked.risk,
        rollbackWindowSeconds: rollbackWindow,
        updatedAt: now(),
      })
      .where(eq(npAgentChangesets.id, row.id));
    await db
      .update(npAgentChangesetValidationAttempts)
      .set({ state: "ready", riskSummary: checked.risk, resultDigest, finishedAt: now() })
      .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
    await db.insert(npAuditEvents).values({
      siteId: row.siteId,
      actorKind: "system",
      action: "agents.changesets.validation_finished",
      targetType: "agent-changeset",
      targetId: row.id,
      payload: { generation: attempt.generation, outcome: "ready" },
      createdAt: now(),
    });
    return { state: "ready" as const };
  }
  async function failValidation(
    seed: typeof npAgentChangesetValidationAttempts.$inferSelect,
    code: string,
  ) {
    return getDb().transaction(async (db) => {
      const [row] = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, seed.siteId),
            eq(npAgentChangesets.id, seed.changesetId),
          ),
        )
        .for("update")
        .limit(1);
      const [attempt] = await db
        .select()
        .from(npAgentChangesetValidationAttempts)
        .where(
          and(
            eq(npAgentChangesetValidationAttempts.siteId, seed.siteId),
            eq(npAgentChangesetValidationAttempts.id, seed.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!row || !attempt || !["queued", "validating"].includes(attempt.state))
        return { state: attempt?.state ?? "stale" };
      if (
        row.validationGeneration !== attempt.generation ||
        row.draftVersion !== attempt.draftVersion ||
        row.draftHash !== attempt.draftHash ||
        row.state !== "validating"
      )
        return { state: "stale" };
      await db
        .update(npAgentChangesetValidationAttempts)
        .set({
          state: "failed",
          errorCode: code,
          issues: [
            json(
              validationFailure(
                code === "AUTHORITY_REVOKED" ? "ACCESS_DENIED" : "VALIDATION_FAILED",
              ),
            ),
          ],
          finishedAt: now(),
        })
        .where(eq(npAgentChangesetValidationAttempts.id, attempt.id));
      await db
        .update(npAgentChangesets)
        .set({ state: "invalid", updatedAt: now() })
        .where(eq(npAgentChangesets.id, row.id));
      await db.insert(npAuditEvents).values({
        siteId: row.siteId,
        actorKind: "system",
        action: "agents.changesets.validation_finished",
        targetType: "agent-changeset",
        targetId: row.id,
        payload: { generation: attempt.generation, outcome: "failed", code },
        createdAt: now(),
      });
      return { state: "failed" };
    });
  }
  async function processValidationOnce(input: { siteId: string; attemptId: string }) {
    if (!uuid.test(input.attemptId)) throw missing();
    const [attempt] = await getDb()
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, input.siteId),
          eq(npAgentChangesetValidationAttempts.id, input.attemptId),
        ),
      )
      .limit(1);
    if (!attempt) throw missing();
    if (!["queued", "validating"].includes(attempt.state)) return { state: attempt.state };
    let admitted = false;
    try {
      if (attempt.authorityRef.kind === "staff-session")
        return await getDb().transaction(
          async (db) => {
            const actor = await storedStaff(
              db,
              attempt.authorizationContextBody,
              attempt.authorizationContextFingerprint,
            );
            admitted = true;
            const result = await performValidation(db, actor, attempt);
            await storedStaff(
              db,
              attempt.authorizationContextBody,
              attempt.authorizationContextFingerprint,
            );
            return result;
          },
          { isolationLevel: "serializable" },
        );
      if (!options.admission || !options.gateway) throw denied();
      return await options.admission.withStoredAuthority({
        authorizationContext: attempt.authorizationContextBody,
        authorizationContextFingerprint: attempt.authorizationContextFingerprint,
        requiredScopes: ["changeset:read"],
        minimumExposure: "propose",
        resolveTransportAudience: options.gateway.getTransportAudience,
        mutate: async (db, _time, authentication) => {
          const userId =
            authentication.principal.authority.kind === "user"
              ? authentication.principal.authority.userId
              : null;
          if (!userId) throw denied();
          const authority = await npResolveLiveAgentStaffAuthorizationV1(
            db,
            attempt.siteId,
            userId,
          );
          const [user] = await db.select().from(npUsers).where(eq(npUsers.id, userId)).limit(1);
          if (!user) throw denied();
          const actor: Actor = {
            siteId: attempt.siteId,
            user: {
              ...user,
              role:
                authority.authority.kind === "super-admin"
                  ? "admin"
                  : (authority.authority.role as NpAuthUser["role"]),
            },
            fingerprint: attempt.requesterFingerprint,
            scopes: authentication.scopes,
            principalId: authentication.principal.id,
            authorization: serializeAgentCanonicalJson(authority),
          };
          admitted = true;
          return performValidation(db, actor, attempt);
        },
      });
    } catch (error) {
      const dbError = error as { code?: string; cause?: { code?: string } };
      if (["40001", "40P01"].includes(dbError.cause?.code ?? dbError.code ?? "")) throw conflict();
      const code =
        error instanceof NpAgentGatewayError && error.code === "VALIDATION_EXPIRED"
          ? "VALIDATION_EXPIRED"
          : !admitted ||
              (error instanceof NpAgentGatewayError &&
                [
                  "AUTHORIZATION_CHANGED",
                  "CHANGESET_ACCESS_DENIED",
                  "STAFF_AUTHORIZATION_REQUIRED",
                  "SITE_ACCESS_DENIED",
                  "CAPABILITY_UNAVAILABLE",
                ].includes(error.code))
            ? "AUTHORITY_REVOKED"
            : "VALIDATION_FAILED";
      return failValidation(attempt, code);
    }
  }
  async function processValidation(input: { siteId: string; attemptId: string }) {
    for (let retry = 0; ; retry++) {
      try {
        return await processValidationOnce(input);
      } catch (error) {
        if (
          retry >= 2 ||
          !(error instanceof NpAgentGatewayError) ||
          error.code !== "CHANGESET_CONFLICT"
        )
          throw error;
      }
    }
  }
  async function validate(input: { actor: NpAgentChangeSetActorV1; id: string; command: unknown }) {
    if (!uuid.test(input.id)) throw missing();
    const command = npRequireAgentChangeSetValidateRequestV1(input.command);
    const actor = await resolve(input.actor, false);
    let result: { changeSetId: string; attemptId?: string } | undefined;
    for (let retry = 0; retry < 3; retry++) {
      try {
        if (input.actor.kind === "staff") {
          const admission = await admin({
            siteId: actor.siteId,
            actor: input.actor.actor,
            operationId: "agents.changesets.validate",
            targetId: input.id,
            command,
            mutate: async ({ db, invocationId }) => {
              const output = await admitValidation(db, actor, input.id, command, invocationId);
              await same(input.actor, actor);
              return { resourceId: input.id, output };
            },
          });
          result = { changeSetId: admission.resourceId, attemptId: admission.output.attemptId };
        } else
          result = await invokePrincipal(
            input.actor,
            actor,
            command,
            "validate",
            (db, _time, invocationId) =>
              admitValidation(db, actor, input.id, command, invocationId),
            input.id,
          );
        break;
      } catch (error) {
        const cause = error as { code?: string; cause?: { code?: string } };
        if (retry === 2 || !["40001", "23505"].includes(cause.cause?.code ?? cause.code ?? ""))
          throw error;
        await same(input.actor, actor);
      }
    }
    if (!result?.attemptId) throw conflict();
    const [attempt] = await getDb()
      .select()
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, actor.siteId),
          eq(npAgentChangesetValidationAttempts.id, result.attemptId),
        ),
      )
      .limit(1);
    if (!attempt) throw missing();
    if (attempt.state === "queued") {
      const [row] = await getDb()
        .select()
        .from(npAgentChangesets)
        .where(eq(npAgentChangesets.id, attempt.changesetId))
        .limit(1);
      if (!row) throw missing();
      if ((await operations(getDb(), row)).length <= inlineLimit)
        await processValidation({ siteId: actor.siteId, attemptId: attempt.id });
      else if (options.enqueueValidation) {
        try {
          await options.enqueueValidation({
            siteId: actor.siteId,
            attemptId: attempt.id,
            changeSetId: row.id,
            generation: attempt.generation,
            draftVersion: attempt.draftVersion,
            draftHash: attempt.draftHash,
          });
        } catch {
          /* Durable queued admission is retried by the explicit host processor. */
        }
      }
    }
    return get({ actor: input.actor, id: result.changeSetId });
  }
  /** Host-invoked recovery for queued admissions, including failed enqueue notifications. */
  async function reconcileValidations(input: { siteId: string; limit?: number }) {
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Validation reconciliation limit must be 1..100.");
    const attempts = await getDb()
      .select({ id: npAgentChangesetValidationAttempts.id })
      .from(npAgentChangesetValidationAttempts)
      .where(
        and(
          eq(npAgentChangesetValidationAttempts.siteId, input.siteId),
          eq(npAgentChangesetValidationAttempts.state, "queued"),
        ),
      )
      .orderBy(
        asc(npAgentChangesetValidationAttempts.createdAt),
        asc(npAgentChangesetValidationAttempts.id),
      )
      .limit(limit);
    let completed = 0;
    for (const attempt of attempts) {
      try {
        const result = await processValidation({ siteId: input.siteId, attemptId: attempt.id });
        if (["ready", "invalid", "failed"].includes(result.state)) completed++;
      } catch (error) {
        if (!(error instanceof NpAgentGatewayError) || error.code !== "CHANGESET_CONFLICT")
          throw error;
      }
    }
    return { examined: attempts.length, completed };
  }
  /** Host-invoked, bounded pre-execution expiry maintenance. No worker is registered. */
  async function reconcileExpired(input: { siteId: string; limit?: number }) {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("ChangeSet reconciliation limit must be 1..100.");
    return getDb().transaction(async (db) => {
      const time = now();
      const rows = await db
        .select()
        .from(npAgentChangesets)
        .where(
          and(
            eq(npAgentChangesets.siteId, input.siteId),
            inArray(npAgentChangesets.state, ["draft", "invalid", "ready"]),
            lte(npAgentChangesets.expiresAt, time),
          ),
        )
        .orderBy(asc(npAgentChangesets.expiresAt), asc(npAgentChangesets.id))
        .limit(limit)
        .for("update", { skipLocked: true });
      let cancelled = 0;
      for (const row of rows) {
        // Approval lifecycle has a later owner; never overwrite its evidence here.
        const [approval] = await db
          .select({ id: npAgentApprovals.id })
          .from(npAgentApprovals)
          .where(
            and(eq(npAgentApprovals.siteId, row.siteId), eq(npAgentApprovals.targetId, row.id)),
          )
          .limit(1);
        if (approval) continue;
        await db
          .update(npAgentChangesets)
          .set({ state: "cancelled", cancellationCode: "CHANGESET_EXPIRED", updatedAt: time })
          .where(
            and(
              eq(npAgentChangesets.id, row.id),
              eq(npAgentChangesets.draftVersion, row.draftVersion),
            ),
          );
        await db.insert(npAuditEvents).values({
          siteId: row.siteId,
          actorKind: "system",
          action: "agents.changesets.expire",
          targetType: "agent-changeset",
          targetId: row.id,
          payload: { code: "CHANGESET_EXPIRED", draftVersion: row.draftVersion },
          createdAt: time,
        });
        cancelled++;
      }
      return { examined: rows.length, cancelled };
    });
  }
  return {
    create: (input: { actor: NpAgentChangeSetActorV1; command: unknown }) => write(input),
    update: (input: {
      actor: Extract<NpAgentChangeSetActorV1, { kind: "staff" }>;
      id: string;
      command: unknown;
    }) => write(input),
    get,
    list,
    reconcileExpired,
    validate,
    processValidation,
    reconcileValidations,
  };
}
export type NpAgentChangeSetServiceV1 = ReturnType<typeof createAgentChangeSetServiceV1>;
