import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  npAgentScopeStaffCapability,
  npDigestAgentActionCanonical,
  npDigestAgentAuthorizationContextCanonical,
  npDigestAgentInvocationRequestCanonical,
  npRequireAgentAuthorizationContextCanonical,
  npRequireAgentGatewaySettings,
  npRequireAgentActionCanonical,
  npRequireAgentInvocationRequestCanonical,
  npRequireAgentReadCapabilityInvocationRequestV1,
  type NpAgentActionCanonicalV1,
  type NpAgentJsonObject,
  type NpAgentReadCapabilityIdV1,
  type NpAgentReadCapabilityInvocationRequestV1,
  type NpAgentReadCapabilityOutputMapV1,
  type NpAgentScope,
} from "../agent-contract/index.js";
import { can } from "../auth/capabilities.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentInvocations,
  npAgentPrincipals,
  npAgentOauthClients,
  npAgentOauthGrants,
  npAgentServiceTokens,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npSiteMemberships, npUsers } from "../db/schema/system.js";
import type { NpAgentGatewaySettingsV1 } from "../agent-contract/types.js";
import { NpError } from "../errors.js";
import { NP_DEFAULT_SITE_ID } from "../sites/id-contract.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import {
  npRequireAgentReadDerivedRequirementsV1,
  type NpAgentReadCapabilityRegistryV1,
  type NpAgentResolvedGatewayPrincipalV1,
} from "./capability-registry.js";
import type { NpAgentAuthenticatedServicePrincipalV1 } from "./gateway-service.js";
import type { NpAgentAuthenticatedOauthPrincipalV1 } from "./oauth-service.js";

type Db = ReturnType<typeof getDb>;

export type NpAgentCapabilityAuthenticationV1 =
  NpAgentAuthenticatedServicePrincipalV1 | NpAgentAuthenticatedOauthPrincipalV1;

function isOauthAuthentication(
  authentication: NpAgentCapabilityAuthenticationV1,
): authentication is NpAgentAuthenticatedOauthPrincipalV1 {
  return "kind" in authentication && authentication.kind === "oauth";
}

export interface NpAgentCapabilityAdmissionOptionsV1 {
  registry: NpAgentReadCapabilityRegistryV1;
  resolveGatewaySettings: (
    siteId: string,
  ) => NpAgentGatewaySettingsV1 | Promise<NpAgentGatewaySettingsV1>;
  now?: () => Date;
  invocationRetentionSeconds?: number;
}

export interface NpAgentReadCapabilityInvocationResultV1<
  C extends NpAgentReadCapabilityIdV1 = NpAgentReadCapabilityIdV1,
> {
  schemaVersion: "np.agent-read-invocation-result.v1";
  invocationId: string;
  actionId: string;
  capabilityId: C;
  output: NpAgentReadCapabilityOutputMapV1[C];
}

function digest(domain: string, value: unknown): `cj1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function asJsonObject(value: object): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}

function resolvedPrincipal(
  authentication: NpAgentCapabilityAuthenticationV1,
): NpAgentResolvedGatewayPrincipalV1 {
  if (isOauthAuthentication(authentication)) {
    const authority = authentication.principal.authority;
    if (authority.kind !== "user" || authority.userId === null) {
      throw new NpAgentGatewayError(
        "PRINCIPAL_AUTHORITY_UNAVAILABLE",
        403,
        "Principal authority is unavailable.",
      );
    }
    return {
      kind: "oauth-user",
      principalId: authentication.principal.id,
      siteId: authentication.principal.siteId,
      authority: { kind: "user", userId: authority.userId },
      credentialId: authentication.grantId,
      gatewayExposureCeiling: authentication.authorizationContext.gatewayExposure!,
      scopes: authentication.scopes,
    };
  }
  const authority = authentication.principal.authority;
  if (authority.kind === "user") {
    if (authority.userId === null) {
      throw new NpAgentGatewayError(
        "PRINCIPAL_AUTHORITY_UNAVAILABLE",
        403,
        "Principal authority is unavailable.",
      );
    }
    return {
      kind: "service",
      principalId: authentication.principal.id,
      siteId: authentication.principal.siteId,
      authority: { kind: "user", userId: authority.userId },
      credentialId: authentication.serviceToken.id,
      gatewayExposureCeiling: authentication.serviceToken.exposureMode,
      scopes: authentication.scopes,
    };
  }
  return {
    kind: "service",
    principalId: authentication.principal.id,
    siteId: authentication.principal.siteId,
    authority: { kind: "deployment", policyId: authority.policyId },
    credentialId: authentication.serviceToken.id,
    gatewayExposureCeiling: authentication.serviceToken.exposureMode,
    scopes: authentication.scopes,
  };
}

function transportSettingsKey(
  transport: NpAgentCapabilityAuthenticationV1["authorizationContext"]["transport"],
): "stdio" | "mcpHttp" | "agentHttp" {
  if (transport === "stdio") return "stdio";
  if (transport === "mcp-service") return "mcpHttp";
  if (transport === "mcp-oauth") return "mcpHttp";
  if (transport === "agent-api") return "agentHttp";
  throw new NpAgentGatewayError("TRANSPORT_UNAVAILABLE", 404, "Capability is unavailable.");
}

function descriptorTransport(
  transport: NpAgentCapabilityAuthenticationV1["authorizationContext"]["transport"],
): "stdio" | "mcp-http" | "agent-http" {
  if (transport === "stdio") return "stdio";
  if (transport === "mcp-service") return "mcp-http";
  if (transport === "mcp-oauth") return "mcp-http";
  if (transport === "agent-api") return "agent-http";
  throw new NpAgentGatewayError("TRANSPORT_UNAVAILABLE", 404, "Capability is unavailable.");
}

function authorizationTransport(
  transport: "stdio" | "mcp-http" | "agent-http",
): "stdio" | "mcp-service" | "agent-api" {
  return transport === "mcp-http"
    ? "mcp-service"
    : transport === "agent-http"
      ? "agent-api"
      : "stdio";
}

function safeFailure(error: unknown): { code: string; outward: Error } {
  if (error instanceof NpAgentGatewayError) {
    return { code: error.code, outward: error };
  }
  if (error instanceof NpError && error.statusCode < 500) {
    const outward = new NpAgentGatewayError(
      String(error.code),
      error.statusCode,
      "Capability request was rejected.",
    );
    return { code: String(error.code), outward };
  }
  const outward = new NpAgentGatewayError(
    "CAPABILITY_EXECUTION_FAILED",
    500,
    "Capability execution failed.",
  );
  return { code: outward.code, outward };
}

async function assertCurrentServiceAuthority(
  tx: Db,
  authentication: NpAgentAuthenticatedServicePrincipalV1,
  requiredScopes: readonly NpAgentScope[],
  now: Date,
): Promise<void> {
  const authorityRef = authentication.authorizationContext.authorityRef;
  if (authorityRef.kind !== "service-family") {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  const [principal] = await tx
    .select()
    .from(npAgentPrincipals)
    .where(
      and(
        eq(npAgentPrincipals.siteId, authentication.principal.siteId),
        eq(npAgentPrincipals.id, authentication.principal.id),
      ),
    )
    .for("update")
    .limit(1);
  const [token] = await tx
    .select()
    .from(npAgentServiceTokens)
    .where(
      and(
        eq(npAgentServiceTokens.siteId, authentication.serviceToken.siteId),
        eq(npAgentServiceTokens.id, authentication.serviceToken.id),
        eq(npAgentServiceTokens.principalId, authentication.principal.id),
      ),
    )
    .for("update")
    .limit(1);
  const activeToken =
    token !== undefined &&
    token.expiresAt > now &&
    (token.status === "active_head" ||
      (token.status === "overlap" &&
        token.overlapExpiresAt !== null &&
        token.overlapExpiresAt > now));
  if (
    !principal ||
    principal.status !== "active" ||
    principal.tokenVersion !== authorityRef.principalTokenVersion ||
    principal.tokenVersion !== authentication.principal.tokenVersion ||
    !activeToken ||
    token.rotationFamilyId !== authorityRef.rotationFamilyId ||
    token.familyAuthorityVersion !== authorityRef.familyAuthorityVersion ||
    token.principalTokenVersion !== authorityRef.principalTokenVersion ||
    token.exposureMode !== authorityRef.exposureMode ||
    token.audience !== authorityRef.audience ||
    token.transport !== authentication.serviceToken.transport ||
    authentication.principal.authority.kind !== "user" ||
    authentication.principal.authority.userId !== principal.authorityUserId ||
    authentication.principal.authority.fingerprint !== principal.authorityFingerprint ||
    authentication.principal.scopes.length !== principal.scopes.length ||
    authentication.principal.scopes.some((scope, index) => scope !== principal.scopes[index]) ||
    token.scopes.length !== authentication.scopes.length ||
    token.scopes.some((scope, index) => scope !== authentication.scopes[index]) ||
    token.scopes.some((scope) => !principal.scopes.includes(scope))
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  const expectedAuthorizationContext = npRequireAgentAuthorizationContextCanonical({
    schemaVersion: "np.agent-authorization-context.v1",
    siteId: principal.siteId,
    actor: {
      kind: "principal",
      principalId: principal.id,
      actorFingerprint: digest("np.agent-principal-actor.v1", {
        siteId: principal.siteId,
        principalId: principal.id,
      }),
    },
    transport: authorizationTransport(token.transport),
    gatewayExposure: token.exposureMode,
    authorityRef: {
      kind: "service-family",
      principalId: principal.id,
      rotationFamilyId: token.rotationFamilyId,
      familyAuthorityVersion: token.familyAuthorityVersion,
      principalTokenVersion: token.principalTokenVersion,
      exposureMode: token.exposureMode,
      audience: token.audience,
    },
  });
  if (
    serializeAgentCanonicalJson(expectedAuthorizationContext) !==
      serializeAgentCanonicalJson(authentication.authorizationContext) ||
    (await npDigestAgentAuthorizationContextCanonical(expectedAuthorizationContext)) !==
      authentication.authorizationContextFingerprint
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  if (principal.authorityKind !== "user" || principal.authorityUserId === null) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  const [user] = await tx
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
      isSuperAdmin: npUsers.isSuperAdmin,
    })
    .from(npUsers)
    .where(eq(npUsers.id, principal.authorityUserId))
    .for("update")
    .limit(1);
  const [membership] = await tx
    .select({ role: npSiteMemberships.role })
    .from(npSiteMemberships)
    .where(
      and(
        eq(npSiteMemberships.siteId, principal.siteId),
        eq(npSiteMemberships.userId, principal.authorityUserId),
      ),
    )
    .for("update")
    .limit(1);
  const effectiveRole = user
    ? user.isSuperAdmin
      ? "admin"
      : (membership?.role ?? (principal.siteId === NP_DEFAULT_SITE_ID ? user.role : null))
    : null;
  const effectiveUser = user && effectiveRole ? { ...user, role: effectiveRole } : null;
  if (
    !effectiveUser ||
    requiredScopes.some((scope) => !can(effectiveUser, npAgentScopeStaffCapability[scope]))
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
}

async function assertCurrentOauthAuthority(
  tx: Db,
  authentication: NpAgentAuthenticatedOauthPrincipalV1,
  requiredScopes: readonly NpAgentScope[],
  now: Date,
): Promise<void> {
  const authorityRef = authentication.authorizationContext.authorityRef;
  const projectedAuthority = authentication.principal.authority;
  if (authorityRef.kind !== "oauth-grant") {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  // Keep the lock order deterministic across every OAuth authority recheck.
  const [principal] = await tx
    .select()
    .from(npAgentPrincipals)
    .where(
      and(
        eq(npAgentPrincipals.siteId, authentication.principal.siteId),
        eq(npAgentPrincipals.id, authentication.principal.id),
      ),
    )
    .for("update")
    .limit(1);
  const [grant] = await tx
    .select()
    .from(npAgentOauthGrants)
    .where(
      and(
        eq(npAgentOauthGrants.siteId, authentication.principal.siteId),
        eq(npAgentOauthGrants.id, authentication.grantId),
        eq(npAgentOauthGrants.principalId, authentication.principal.id),
      ),
    )
    .for("update")
    .limit(1);
  const [client] = await tx
    .select()
    .from(npAgentOauthClients)
    .where(
      and(
        eq(npAgentOauthClients.siteId, authentication.principal.siteId),
        eq(npAgentOauthClients.id, authentication.client.id),
      ),
    )
    .for("update")
    .limit(1);
  if (
    !principal ||
    !grant ||
    !client ||
    principal.status !== "active" ||
    principal.authorityKind !== "user" ||
    principal.authorityUserId === null ||
    principal.authorityUserId !== grant.staffUserId ||
    projectedAuthority.kind !== "user" ||
    principal.authorityUserId !== projectedAuthority.userId ||
    principal.authorityFingerprint !== projectedAuthority.fingerprint ||
    principal.tokenVersion !== authorityRef.principalTokenVersion ||
    principal.tokenVersion !== authentication.principal.tokenVersion ||
    grant.status !== "active" ||
    grant.expiresAt <= now ||
    grant.clientId !== client.id ||
    grant.authorityVersion !== authorityRef.grantVersion ||
    grant.exposureMode !== authorityRef.exposureMode ||
    grant.audience !== authorityRef.audience ||
    grant.scopes.length !== authentication.scopes.length ||
    grant.scopes.some((scope, index) => scope !== authentication.scopes[index]) ||
    grant.scopes.some((scope) => !principal.scopes.includes(scope)) ||
    client.status !== "active" ||
    client.clientId !== authorityRef.clientId ||
    client.clientId !== authentication.client.clientId ||
    client.rowVersion !== authentication.client.rowVersion
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  const expectedAuthorizationContext = npRequireAgentAuthorizationContextCanonical({
    schemaVersion: "np.agent-authorization-context.v1",
    siteId: principal.siteId,
    actor: {
      kind: "principal",
      principalId: principal.id,
      actorFingerprint: digest("np.agent-principal-actor.v1", {
        siteId: principal.siteId,
        principalId: principal.id,
      }),
    },
    transport: "mcp-oauth",
    gatewayExposure: grant.exposureMode,
    authorityRef: {
      kind: "oauth-grant",
      principalId: principal.id,
      clientId: client.clientId,
      grantId: grant.id,
      grantVersion: grant.authorityVersion,
      principalTokenVersion: principal.tokenVersion,
      exposureMode: grant.exposureMode,
      audience: grant.audience,
    },
  });
  if (
    serializeAgentCanonicalJson(expectedAuthorizationContext) !==
      serializeAgentCanonicalJson(authentication.authorizationContext) ||
    (await npDigestAgentAuthorizationContextCanonical(expectedAuthorizationContext)) !==
      authentication.authorizationContextFingerprint
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
  const [user] = await tx
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
      isSuperAdmin: npUsers.isSuperAdmin,
    })
    .from(npUsers)
    .where(eq(npUsers.id, principal.authorityUserId))
    .for("update")
    .limit(1);
  const [membership] = await tx
    .select({ role: npSiteMemberships.role })
    .from(npSiteMemberships)
    .where(
      and(
        eq(npSiteMemberships.siteId, principal.siteId),
        eq(npSiteMemberships.userId, principal.authorityUserId),
      ),
    )
    .for("update")
    .limit(1);
  const effectiveRole = user
    ? user.isSuperAdmin
      ? "admin"
      : (membership?.role ?? (principal.siteId === NP_DEFAULT_SITE_ID ? user.role : null))
    : null;
  const effectiveUser = user && effectiveRole ? { ...user, role: effectiveRole } : null;
  if (
    !effectiveUser ||
    requiredScopes.some((scope) => !can(effectiveUser, npAgentScopeStaffCapability[scope]))
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
}

async function assertCurrentAuthentication(
  tx: Db,
  authentication: NpAgentCapabilityAuthenticationV1,
  requiredScopes: readonly NpAgentScope[],
  now: Date,
): Promise<void> {
  if (isOauthAuthentication(authentication)) {
    return assertCurrentOauthAuthority(tx, authentication, requiredScopes, now);
  }
  return assertCurrentServiceAuthority(tx, authentication, requiredScopes, now);
}

export function createAgentCapabilityAdmissionServiceV1(
  options: NpAgentCapabilityAdmissionOptionsV1,
) {
  const nowFn = options.now ?? (() => new Date());
  const retentionSeconds = options.invocationRetentionSeconds ?? 60 * 60;
  if (
    !Number.isSafeInteger(retentionSeconds) ||
    retentionSeconds < 60 ||
    retentionSeconds > 86_400
  ) {
    throw new Error("Agent invocation retention must be 60..86400 seconds.");
  }

  return {
    async project(input: { authentication: NpAgentCapabilityAuthenticationV1 }) {
      const authentication = input.authentication;
      const principal = resolvedPrincipal(authentication);
      const settings = npRequireAgentGatewaySettings(
        await options.resolveGatewaySettings(principal.siteId),
      );
      const settingsKey = transportSettingsKey(authentication.authorizationContext.transport);
      if (settings[settingsKey] === "disabled") {
        throw new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Capability is unavailable.");
      }
      await getDb().transaction(async (rawTx) => {
        await assertCurrentAuthentication(rawTx, authentication, authentication.scopes, nowFn());
      });
      const transport = descriptorTransport(authentication.authorizationContext.transport);
      return {
        principal,
        settings,
        registryFingerprint: options.registry.registryFingerprint,
        entries: options.registry.ids
          .map((id) => options.registry.get(id))
          .filter(
            (entry) =>
              entry.definition.descriptor.gateway?.transports.includes(transport) === true &&
              entry.definition.descriptor.requiredScopes.every((scope) =>
                authentication.scopes.includes(scope),
              ),
          ),
      };
    },
    async invoke<C extends NpAgentReadCapabilityIdV1>(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      request: NpAgentReadCapabilityInvocationRequestV1 & { capabilityId: C };
      abortSignal?: AbortSignal;
    }): Promise<NpAgentReadCapabilityInvocationResultV1<C>> {
      const request = npRequireAgentReadCapabilityInvocationRequestV1(input.request);
      const capabilityId = request.capabilityId as C;
      const entry = options.registry.get(capabilityId);
      const authentication = input.authentication;
      const principal = resolvedPrincipal(authentication);
      if (principal.siteId !== authentication.authorizationContext.siteId) {
        throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
      }
      const settings = npRequireAgentGatewaySettings(
        await options.resolveGatewaySettings(principal.siteId),
      );
      const settingsKey = transportSettingsKey(authentication.authorizationContext.transport);
      if (
        settings[settingsKey] === "disabled" ||
        !entry.definition.descriptor.gateway?.transports.includes(
          descriptorTransport(authentication.authorizationContext.transport),
        )
      ) {
        throw new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Capability is unavailable.");
      }
      const parsedInput = entry.definition.parseInput(request.arguments.input);
      const now = nowFn();
      const requestedAt = now.toISOString();
      const requirements = npRequireAgentReadDerivedRequirementsV1(
        (await entry.definition.deriveRequirements?.(parsedInput, {
          siteId: principal.siteId,
          principal,
          requestedAt,
        })) ?? { additionalScopes: [], targetRefs: [], riskFloor: "read", approvalFloor: "none" },
      );
      const requiredScopes = [
        ...new Set<NpAgentScope>([
          ...entry.definition.descriptor.requiredScopes,
          ...requirements.additionalScopes,
        ]),
      ].sort();
      if (requiredScopes.some((scope) => !authentication.scopes.includes(scope))) {
        throw new NpAgentGatewayError(
          "INSUFFICIENT_SCOPE",
          403,
          "Required capability scope is absent.",
        );
      }
      const authorizationFingerprint = await npDigestAgentAuthorizationContextCanonical(
        authentication.authorizationContext,
      );
      if (authorizationFingerprint !== authentication.authorizationContextFingerprint) {
        throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
      }
      const actorFingerprint = authentication.authorizationContext.actor.actorFingerprint;
      const requestBody = npRequireAgentInvocationRequestCanonical({
        schemaVersion: "np.agent-idempotency-request.v1",
        siteId: principal.siteId,
        actorKind: "principal",
        actorFingerprint,
        authorizationContextFingerprint: authorizationFingerprint,
        operationKind: "capability",
        operationId: capabilityId,
        contractVersion: entry.definition.descriptor.contractVersion,
        contractFingerprint: entry.capabilityFingerprint,
        effectProfile: { id: "domain.read", contractVersion: 1 },
        input: asJsonObject(parsedInput),
      });
      const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
      const invocationId = randomUUID();
      const actionId = randomUUID();
      const actionCanonical: NpAgentActionCanonicalV1 = npRequireAgentActionCanonical({
        schemaVersion: "np.agent-action.v1",
        siteId: principal.siteId,
        actionId,
        invocationFingerprint: requestHash,
        runFingerprint: null,
        sequence: 1,
        capabilityId,
        capabilityContractVersion: entry.definition.descriptor.contractVersion,
        capabilityFingerprint: entry.capabilityFingerprint,
        effectProfile: { id: "domain.read", contractVersion: 1 },
        risk: "read",
        requiredScopes,
        targetRefs: requirements.targetRefs,
        targetVersionFacts: [],
        input: asJsonObject(parsedInput),
      });
      const actionHash = await npDigestAgentActionCanonical(actionCanonical);
      const db = getDb();
      const expiresAt = new Date(now.getTime() + retentionSeconds * 1_000);
      await db.transaction(
        async (rawTx) => {
          const tx = rawTx as Db;
          await assertCurrentAuthentication(tx, authentication, requiredScopes, now);
          const [audit] = await tx
            .insert(npAuditEvents)
            .values({
              actorKind: "agent-principal",
              action: "agents.capability.invoke",
              targetType: "agent-capability",
              targetId: capabilityId,
              siteId: principal.siteId,
              payload: {
                schemaVersion: "np.agent-capability-audit.v1",
                outcome: "started",
                capabilityId,
                invocationId,
                actionId,
                requestHash,
                authorizationContextFingerprint: authorizationFingerprint,
              },
              createdAt: now,
            })
            .returning({ id: npAuditEvents.id });
          if (!audit) throw new Error("Failed to persist Agent capability audit admission.");
          await tx.insert(npAgentInvocations).values({
            id: invocationId,
            siteId: principal.siteId,
            actorKind: "principal",
            principalId: principal.principalId,
            actorFingerprint,
            authorizationContextBody: authentication.authorizationContext,
            authorizationContextFingerprint: authorizationFingerprint,
            authorityRef: authentication.authorizationContext.authorityRef,
            operationKind: "capability",
            operationId: capabilityId,
            contractVersion: entry.definition.descriptor.contractVersion,
            contractFingerprint: entry.capabilityFingerprint,
            capabilityDefinitionBody: entry.definitionCanonical,
            effectProfileId: "domain.read",
            effectContractVersion: 1,
            transport: authentication.authorizationContext.transport,
            mcpExecutionMode:
              authentication.authorizationContext.transport === "mcp-service" ||
              authentication.authorizationContext.transport === "mcp-oauth"
                ? "normal"
                : null,
            idempotencyKey: null,
            requestBody,
            requestHash,
            state: "started",
            auditEventId: audit.id,
            requestedAt: now,
            expiresAt,
          });
          await tx.insert(npAgentActions).values({
            id: actionId,
            siteId: principal.siteId,
            runId: null,
            runFingerprint: null,
            invocationId,
            invocationFingerprint: requestHash,
            sequence: 1,
            capabilityId,
            capabilityContractVersion: entry.definition.descriptor.contractVersion,
            capabilityFingerprint: entry.capabilityFingerprint,
            capabilityDefinitionBody: entry.definitionCanonical,
            effectProfileId: "domain.read",
            effectContractVersion: 1,
            risk: "read",
            state: "executing",
            idempotencyKey: null,
            inputRedacted: asJsonObject(parsedInput),
            inputCanonical: asJsonObject(parsedInput),
            requiredScopes,
            targetRefs: requirements.targetRefs,
            targetVersionFacts: [],
            inputHash: actionHash,
            auditEventId: audit.id,
            startedAt: now,
            createdAt: now,
          });
        },
        { isolationLevel: "serializable" },
      );
      try {
        const execution = await entry.definition.execute(parsedInput, {
          siteId: principal.siteId,
          principal,
          requestedAt,
          invocationId,
          idempotencyKey: null,
          abortSignal: input.abortSignal ?? new AbortController().signal,
        });
        const output = entry.definition.parseOutput(execution.output);
        const outputObject = asJsonObject(output);
        const outputHash = digest("np.agent-capability-output.v1", outputObject);
        const finishedAt = nowFn();
        await db.transaction(async (rawTx) => {
          const tx = rawTx as Db;
          const [audit] = await tx
            .insert(npAuditEvents)
            .values({
              actorKind: "agent-principal",
              action: "agents.capability.complete",
              targetType: "agent-capability",
              targetId: capabilityId,
              siteId: principal.siteId,
              payload: {
                schemaVersion: "np.agent-capability-audit.v1",
                outcome: "completed",
                capabilityId,
                invocationId,
                actionId,
                outputHash,
              },
              createdAt: finishedAt,
            })
            .returning({ id: npAuditEvents.id });
          if (!audit) throw new Error("Failed to persist Agent capability completion audit.");
          const actions = await tx
            .update(npAgentActions)
            .set({ state: "succeeded", outputRedacted: outputObject, outputHash, finishedAt })
            .where(
              and(
                eq(npAgentActions.siteId, principal.siteId),
                eq(npAgentActions.id, actionId),
                eq(npAgentActions.state, "executing"),
              ),
            )
            .returning({ id: npAgentActions.id });
          const invocations = await tx
            .update(npAgentInvocations)
            .set({
              state: "completed",
              resultKind: "action",
              resultId: actionId,
              outputRedacted: outputObject,
              outputHash,
              completedAt: finishedAt,
            })
            .where(
              and(
                eq(npAgentInvocations.siteId, principal.siteId),
                eq(npAgentInvocations.id, invocationId),
                eq(npAgentInvocations.state, "started"),
              ),
            )
            .returning({ id: npAgentInvocations.id });
          if (actions.length !== 1 || invocations.length !== 1) {
            throw new Error("Agent capability completion lost its admission rows.");
          }
        });
        return {
          schemaVersion: "np.agent-read-invocation-result.v1",
          invocationId,
          actionId,
          capabilityId,
          output,
        };
      } catch (error) {
        const failure = safeFailure(error);
        const finishedAt = nowFn();
        await db.transaction(async (rawTx) => {
          const tx = rawTx as Db;
          const [audit] = await tx
            .insert(npAuditEvents)
            .values({
              actorKind: "agent-principal",
              action: "agents.capability.fail",
              targetType: "agent-capability",
              targetId: capabilityId,
              siteId: principal.siteId,
              payload: {
                schemaVersion: "np.agent-capability-audit.v1",
                outcome: "failed",
                capabilityId,
                invocationId,
                actionId,
                errorCode: failure.code,
              },
              createdAt: finishedAt,
            })
            .returning({ id: npAuditEvents.id });
          if (!audit) throw new Error("Failed to persist Agent capability failure audit.");
          const actions = await tx
            .update(npAgentActions)
            .set({ state: "failed", errorCode: failure.code, finishedAt })
            .where(
              and(
                eq(npAgentActions.siteId, principal.siteId),
                eq(npAgentActions.id, actionId),
                eq(npAgentActions.state, "executing"),
              ),
            )
            .returning({ id: npAgentActions.id });
          const invocations = await tx
            .update(npAgentInvocations)
            .set({ state: "failed", errorCode: failure.code, completedAt: finishedAt })
            .where(
              and(
                eq(npAgentInvocations.siteId, principal.siteId),
                eq(npAgentInvocations.id, invocationId),
                eq(npAgentInvocations.state, "started"),
              ),
            )
            .returning({ id: npAgentInvocations.id });
          if (actions.length !== 1 || invocations.length !== 1) {
            throw new Error("Agent capability failure lost its admission rows.");
          }
        });
        throw failure.outward;
      }
    },
  };
}

export type NpAgentCapabilityAdmissionServiceV1 = ReturnType<
  typeof createAgentCapabilityAdmissionServiceV1
>;
