import { createHash } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import {
  npDigestAgentAuthorizationContextCanonical,
  npDigestAgentInvocationRequestCanonical,
  npDigestAgentStaffSiteAuthorizationCanonical,
  npGetAgentAdminOperationV1,
  npRequireAgentAuthorizationContextCanonical,
  npRequireAgentGatewayAdminInputV1,
  npRequireAgentInvocationRequestCanonical,
  npRequireAgentStaffSiteAuthorizationCanonical,
  npResolveAgentAdminOperationFingerprintsV1,
  type NpAgentGatewayAdminInputMapV1,
  type NpAgentGatewayAdminOperationIdV1,
  type NpAgentJsonObject,
  type NpAgentStaffSiteAuthorizationCanonicalV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { NpCapability } from "../auth/capabilities.js";
import type { NpAuthUser, NpUserRole } from "../config/types.js";
import { getDb } from "../db/runtime.js";
import { npAgentInvocations } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSessions, npSiteMemberships, npSites, npUsers } from "../db/schema/system.js";
import { NP_DEFAULT_SITE_ID } from "../sites/id-contract.js";

type NpAgentDb = ReturnType<typeof getDb>;

export class NpAgentGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "NpAgentGatewayError";
  }
}

export interface NpAgentAdminActorV1 {
  user: NpAuthUser;
  sessionId: string;
}

export interface NpAgentStaffPrimaryReauthenticationVerifierV1 {
  verify(input: {
    siteId: string;
    userId: string;
    sessionId: string;
    operationId: NpAgentGatewayAdminOperationIdV1;
    maximumAgeSeconds: number;
    now: Date;
  }): boolean | Promise<boolean>;
}

export interface NpAgentAdminMutationResultV1<T extends NpAgentJsonObject> {
  resourceId: string;
  output: T;
  oneTimeValue?: string;
}

export interface NpAgentAdminExecutionResultV1<T extends NpAgentJsonObject> {
  resourceId: string;
  output: T;
  oneTimeValue?: string;
  replayed: boolean;
}

export interface NpAgentAdminAdmissionOptionsV1 {
  reauthentication?: NpAgentStaffPrimaryReauthenticationVerifierV1;
  now?: () => Date;
  idempotencyLifetimeSeconds?: number;
}

const roleCapabilities: Readonly<Record<NpUserRole, readonly NpCapability[]>> = Object.freeze({
  admin: ["admin.manage", "community.moderate", "content.author", "content.publish", "site.access"],
  editor: ["community.moderate", "content.author", "content.publish", "site.access"],
  moderator: ["community.moderate", "content.author", "site.access"],
  author: ["content.author", "site.access"],
  viewer: ["site.access"],
});

function sha256Canonical(domain: string, value: unknown): `cj1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

async function resolveStaffAuthorization(
  db: NpAgentDb,
  siteId: string,
  actor: NpAgentAdminActorV1,
  now: Date,
): Promise<NpAgentStaffSiteAuthorizationCanonicalV1> {
  const [[user], [site], [session], [membership]] = await Promise.all([
    db
      .select({
        id: npUsers.id,
        role: npUsers.role,
        tokenVersion: npUsers.tokenVersion,
        isSuperAdmin: npUsers.isSuperAdmin,
      })
      .from(npUsers)
      .where(eq(npUsers.id, actor.user.id))
      .limit(1),
    db.select({ id: npSites.id }).from(npSites).where(eq(npSites.id, siteId)).limit(1),
    db
      .select({ id: npSessions.id, userId: npSessions.userId })
      .from(npSessions)
      .where(
        and(
          eq(npSessions.id, actor.sessionId),
          eq(npSessions.userId, actor.user.id),
          gt(npSessions.accessExpiresAt, now),
          gt(npSessions.refreshExpiresAt, now),
        ),
      )
      .limit(1),
    db
      .select({ role: npSiteMemberships.role })
      .from(npSiteMemberships)
      .where(and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, actor.user.id)))
      .limit(1),
  ]);
  if (!user || !site || !session || actor.user.tokenVersion !== user.tokenVersion) {
    throw new NpAgentGatewayError("STAFF_AUTHORIZATION_REQUIRED", 401, "Staff session is invalid.");
  }

  if (user.isSuperAdmin) {
    return npRequireAgentStaffSiteAuthorizationCanonical({
      schemaVersion: "np.agent-staff-site-authorization.v1",
      siteId,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      authority: { kind: "super-admin", capabilities: [...roleCapabilities.admin] },
    });
  }
  const source = membership
    ? "membership"
    : siteId === NP_DEFAULT_SITE_ID
      ? "default-site-fallback"
      : null;
  const role = membership?.role ?? (source === "default-site-fallback" ? user.role : null);
  if (!source || !role) {
    throw new NpAgentGatewayError("SITE_ACCESS_DENIED", 403, "Site authorization is unavailable.");
  }
  return npRequireAgentStaffSiteAuthorizationCanonical({
    schemaVersion: "np.agent-staff-site-authorization.v1",
    siteId,
    userId: user.id,
    userTokenVersion: user.tokenVersion,
    authority: { kind: "site-role", source, role, capabilities: [...roleCapabilities[role]] },
  });
}

function replayResult<T extends NpAgentJsonObject>(
  row: typeof npAgentInvocations.$inferSelect,
  requestHash: string,
): NpAgentAdminExecutionResultV1<T> {
  if (row.requestHash !== requestHash) {
    throw new NpAgentGatewayError(
      "IDEMPOTENCY_KEY_REUSED",
      409,
      "The idempotency key is already bound to a different request.",
    );
  }
  if (row.oneTimeValueIssued) {
    throw new NpAgentGatewayError(
      "ONE_TIME_VALUE_ALREADY_ISSUED",
      409,
      "The one-time value was already issued.",
      {
        resourceId: row.oneTimeResourceId,
        recoveryOperationId: row.oneTimeRecoveryOperationId,
      },
    );
  }
  if (row.state === "failed") {
    throw new NpAgentGatewayError(
      row.errorCode ?? "ADMIN_OPERATION_FAILED",
      409,
      "Operation failed.",
    );
  }
  if (row.state !== "completed" || !row.resultId || !row.outputRedacted) {
    throw new NpAgentGatewayError(
      "IDEMPOTENCY_IN_PROGRESS",
      409,
      "Operation is still in progress.",
    );
  }
  return {
    resourceId: row.resultId,
    output: row.outputRedacted as T,
    replayed: true,
  };
}

export function createAgentAdminAdmissionV1(options: NpAgentAdminAdmissionOptionsV1 = {}) {
  const nowFn = options.now ?? (() => new Date());
  const idempotencyLifetimeSeconds = options.idempotencyLifetimeSeconds ?? 24 * 60 * 60;

  return async function execute<
    I extends NpAgentGatewayAdminOperationIdV1,
    T extends NpAgentJsonObject,
  >(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    operationId: I;
    parentTargetId?: string | null;
    targetId: string | null;
    command: unknown;
    mutate: (context: {
      db: NpAgentDb;
      now: Date;
      command: NpAgentGatewayAdminInputMapV1[I];
    }) => Promise<NpAgentAdminMutationResultV1<T>>;
  }): Promise<NpAgentAdminExecutionResultV1<T>> {
    const now = nowFn();
    const command = npRequireAgentGatewayAdminInputV1(input.operationId, input.command);
    const operation = npGetAgentAdminOperationV1(input.operationId);
    const fingerprints = await npResolveAgentAdminOperationFingerprintsV1(operation);
    const db = getDb();
    const authorization = await resolveStaffAuthorization(db, input.siteId, input.actor, now);
    if (!authorization.authority.capabilities.includes(operation.requiredCapability)) {
      throw new NpAgentGatewayError("SITE_ACCESS_DENIED", 403, "Required capability is absent.");
    }
    if (operation.approval.reauthenticationFloor === "recent-staff-primary") {
      const accepted = await options.reauthentication?.verify({
        siteId: input.siteId,
        userId: input.actor.user.id,
        sessionId: input.actor.sessionId,
        operationId: input.operationId,
        maximumAgeSeconds: 300,
        now,
      });
      if (accepted !== true) {
        throw new NpAgentGatewayError(
          "RECENT_REAUTHENTICATION_REQUIRED",
          403,
          "Recent staff-primary reauthentication is required.",
        );
      }
    }

    const authorizationDigest = await npDigestAgentStaffSiteAuthorizationCanonical(authorization);
    const actorFingerprint = sha256Canonical("np.agent-staff-actor.v1", {
      siteId: input.siteId,
      userId: input.actor.user.id,
    });
    const authorizationContext = npRequireAgentAuthorizationContextCanonical({
      schemaVersion: "np.agent-authorization-context.v1",
      siteId: input.siteId,
      actor: { kind: "staff", userId: input.actor.user.id, actorFingerprint },
      transport: "admin",
      gatewayExposure: null,
      authorityRef: {
        kind: "staff-session",
        userId: input.actor.user.id,
        sessionId: input.actor.sessionId,
        userTokenVersion: authorization.userTokenVersion,
        siteAuthorizationDigest: authorizationDigest,
      },
    });
    const authorizationContextFingerprint =
      await npDigestAgentAuthorizationContextCanonical(authorizationContext);
    const requestBody = npRequireAgentInvocationRequestCanonical({
      schemaVersion: "np.agent-idempotency-request.v1",
      siteId: input.siteId,
      actorKind: "staff",
      actorFingerprint,
      authorizationContextFingerprint,
      operationKind: "admin",
      operationId: input.operationId,
      contractVersion: operation.contractVersion,
      contractFingerprint: fingerprints.contract,
      effectProfile: null,
      input: {
        ...(command as unknown as NpAgentJsonObject),
        parentTargetId: input.parentTargetId ?? null,
        targetId: input.targetId,
      },
    });
    const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
    const idempotencyKey = command.idempotencyKey;

    const findReplay = async () => {
      const [row] = await db
        .select()
        .from(npAgentInvocations)
        .where(
          and(
            eq(npAgentInvocations.siteId, input.siteId),
            eq(npAgentInvocations.actorKind, "staff"),
            eq(npAgentInvocations.actorFingerprint, actorFingerprint),
            eq(npAgentInvocations.authorizationContextFingerprint, authorizationContextFingerprint),
            eq(npAgentInvocations.operationKind, "admin"),
            eq(npAgentInvocations.operationId, input.operationId),
            eq(npAgentInvocations.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return row ?? null;
    };
    const existing = await findReplay();
    if (existing) return replayResult<T>(existing, requestHash);

    try {
      return await db.transaction(
        async (rawTx) => {
          const tx = rawTx as NpAgentDb;
          const currentAuthorization = await resolveStaffAuthorization(
            tx,
            input.siteId,
            input.actor,
            now,
          );
          if (
            (await npDigestAgentStaffSiteAuthorizationCanonical(currentAuthorization)) !==
            authorizationDigest
          ) {
            throw new NpAgentGatewayError(
              "STAFF_AUTHORIZATION_CHANGED",
              409,
              "Staff site authorization changed during admission.",
            );
          }
          const [audit] = await tx
            .insert(npAuditEvents)
            .values({
              actorKind: "staff",
              actorUserId: input.actor.user.id,
              action: operation.audit.eventId,
              targetType: input.operationId.includes("principal_tokens")
                ? "agent-service-token"
                : "agent-principal",
              targetId: input.targetId,
              siteId: input.siteId,
              payload: {
                operationId: input.operationId,
                outcome: "completed",
                siteId: input.siteId,
                staffUserId: input.actor.user.id,
                idempotencyFingerprint: requestHash,
              },
              createdAt: now,
            })
            .returning({ id: npAuditEvents.id });
          if (!audit) throw new Error("Failed to create Agent Admin audit event.");

          const expiresAt = new Date(now.getTime() + idempotencyLifetimeSeconds * 1_000);
          const [invocation] = await tx
            .insert(npAgentInvocations)
            .values({
              siteId: input.siteId,
              actorKind: "staff",
              staffUserId: input.actor.user.id,
              actorFingerprint,
              authorizationContextBody: authorizationContext,
              authorizationContextFingerprint,
              authorityRef: authorizationContext.authorityRef,
              operationKind: "admin",
              operationId: input.operationId,
              contractVersion: operation.contractVersion,
              contractFingerprint: fingerprints.contract,
              transport: "admin",
              idempotencyKey,
              requestBody,
              requestHash,
              state: "started",
              auditEventId: audit.id,
              requestedAt: now,
              expiresAt,
            })
            .returning({ id: npAgentInvocations.id });
          if (!invocation) throw new Error("Failed to create Agent Admin invocation.");

          const result = await input.mutate({ db: tx, now, command });
          const oneTimeValueIssued = result.oneTimeValue !== undefined;
          if (oneTimeValueIssued !== operation.idempotency.oneTimeOutput) {
            throw new Error("Agent Admin mutation output does not match its one-time contract.");
          }
          const updatedAudits = await tx
            .update(npAuditEvents)
            .set({ targetId: result.resourceId })
            .where(eq(npAuditEvents.id, audit.id))
            .returning({ id: npAuditEvents.id });
          if (updatedAudits.length !== 1) {
            throw new Error("Failed to finalize Agent Admin audit event.");
          }
          const outputHash = oneTimeValueIssued
            ? null
            : sha256Canonical("np.agent-admin-output.v1", result.output);
          const updatedInvocations = await tx
            .update(npAgentInvocations)
            .set({
              state: "completed",
              resultKind: "admin_resource",
              resultId: result.resourceId,
              outputRedacted: oneTimeValueIssued ? null : result.output,
              outputHash,
              oneTimeValueIssued,
              oneTimeResourceId: oneTimeValueIssued ? result.resourceId : null,
              oneTimeRecoveryOperationId: oneTimeValueIssued
                ? operation.idempotency.recoveryOperationId
                : null,
              completedAt: now,
            })
            .where(eq(npAgentInvocations.id, invocation.id))
            .returning({ id: npAgentInvocations.id });
          if (updatedInvocations.length !== 1) {
            throw new Error("Failed to finalize Agent Admin invocation.");
          }
          return { ...result, replayed: false };
        },
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      const raced = await findReplay();
      if (raced) return replayResult<T>(raced, requestHash);
      throw error;
    }
  };
}
