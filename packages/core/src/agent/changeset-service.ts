import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, lte, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentChangesets,
  npAgentChangesetOperations,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentApprovals,
} from "../db/schema/agent.js";
import { npUsers } from "../db/schema/system.js";
import { npAuditEvents } from "../db/schema/community.js";
import { can } from "../auth/capabilities.js";
import type { NpAuthUser } from "../config/types.js";
import {
  npRequireAgentChangeSetWire,
  npAnalyzeAgentChangeSetWire,
  npVerifyAgentChangeSetAdminProposalV1,
  npDigestAgentChangeSetDraftInputV1,
  npAgentChangeSetLimits,
  type NpAgentChangeSetDraftInputV1,
  type NpAgentChangeSetWire,
  type NpAgentChangeSetAdminInputV1,
} from "../agent-contract/changeset-wire-contract.js";
import {
  npDigestAgentChangeSetProposalCanonical,
  npRequireAgentChangeSetProposalCanonical,
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
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAnalyzeAgentCursorPageV1 } from "../agent-contract/wire-contract.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
import {
  npAgentScopeStaffCapability,
  type NpAgentJsonObject,
  type NpAgentChangeSetProposalOperationCanonicalV1,
  type NpAgentScope,
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
    // Later phases install the validation/execution owners; this draft service does not invent their evidence.
    if (
      !["draft", "invalid", "cancelled"].includes(row.state) ||
      row.planHash !== null ||
      row.sealedPlanBody !== null
    )
      throw missing();
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
      planHash: null,
      baseFingerprint: null,
      draftVersion: row.draftVersion,
      draftHash: row.draftHash,
      risk: null,
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
      validation: null,
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
  const definitionBody = npRequireAgentCapabilityRegistryCanonical({
    schemaVersion: "np.agent-capability-registry.v1",
    projection: "definition",
    capabilities: [
      {
        descriptor: {
          schemaVersion: "np.agent-capability.v1",
          id: "changeset.create",
          contractVersion: 1,
          source: "core",
          title: "Create ChangeSet draft",
          description: "Persist a canonical draft without applying content changes.",
          requiredScopes: ["changeset:write"],
          scopeDerivation: "changeset-resources",
          risk: "reversible",
          approval: "none",
          effectProfiles: [
            {
              id: "changeset.draft-create",
              kind: "mutation",
              reversibility: "none",
              minimumGatewayExposure: "propose",
              verifierId: "changeset.draft.verify",
              compensatorId: null,
            },
          ],
          bootstrapIntent: "write",
          execution: "inline",
          idempotency: "required",
          gateway: { transports: ["agent-http", "mcp-http", "stdio"] },
          inputSchema: npGetAgentAdminOperationV1("agents.changesets.create").schemas.input.schema,
          outputSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            additionalProperties: false,
            properties: { changeSetId: { type: "string", format: "uuid", maxLength: 36 } },
            required: ["changeSetId"],
          },
        },
        implementationVersion: 1,
        effectProfiles: [
          {
            schemaVersion: "np.agent-effect-profile.v1",
            capabilityId: "changeset.create",
            capabilityContractVersion: 1,
            implementationVersion: 1,
            profileId: "changeset.draft-create",
            kind: "mutation",
            reversibility: "none",
            minimumGatewayExposure: "propose",
            effectContractVersion: 1,
            verifierId: "changeset.draft.verify",
            compensatorId: null,
          },
        ],
      },
    ],
  });
  async function createForPrincipal(
    input: Extract<NpAgentChangeSetActorV1, { kind: "principal" }>,
    actor: Actor,
    request: NpAgentChangeSetAdminInputV1<"create">,
    draft: NpAgentChangeSetDraftInputV1,
  ) {
    if (!options.admission) throw missing();
    const authentication = input.authentication;
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
      operationId: "changeset.create",
      contractVersion: 1,
      contractFingerprint: fingerprint,
      effectProfile: { id: "changeset.draft-create", contractVersion: 1 },
      input: json(request),
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
              eq(npAgentInvocations.operationId, "changeset.create"),
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
          return previous.resultId;
        }
        const [audit] = await db
          .insert(npAuditEvents)
          .values({
            siteId: actor.siteId,
            actorKind: "agent-principal",
            action: "agents.changesets.create",
            targetType: "agent-changeset",
            targetId: null,
            payload: { requestHash, operationId: "changeset.create", outcome: "completed" },
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
          operationId: "changeset.create",
          contractVersion: 1,
          contractFingerprint: fingerprint,
          capabilityDefinitionBody: definitionBody,
          effectProfileId: "changeset.draft-create",
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
        const id = await mutate(db, time, actor, draft, request, null, invocationId);
        await db.update(npAuditEvents).set({ targetId: id }).where(eq(npAuditEvents.id, audit.id));
        await db
          .update(npAgentInvocations)
          .set({
            state: "completed",
            resultKind: "changeset",
            resultId: id,
            outputRedacted: { changeSetId: id },
            outputHash: hash("np.agent-changeset-result.v1", { changeSetId: id }),
            completedAt: time,
          })
          .where(eq(npAgentInvocations.id, invocationId));
        return id;
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
        } else id = await createForPrincipal(input.actor, actor, request, draft);
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
  /** Host-invoked, bounded draft expiry maintenance. No worker is registered. */
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
            inArray(npAgentChangesets.state, ["draft", "invalid"]),
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
  };
}
export type NpAgentChangeSetServiceV1 = ReturnType<typeof createAgentChangeSetServiceV1>;
