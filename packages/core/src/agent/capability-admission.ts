import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type {
  NpAgentRuntimeAdmissionV1,
  NpAgentRuntimeRunContextV1,
  NpAgentRuntimeExecutionClaimV1,
} from "./runtime-admission.js";
import { npAgentMcpToolDefinitionsV1 } from "../agent-contract/contract.js";
import type { NpAgentMcpTaskV1 } from "../agent-contract/index.js";
import type { NpAgentMcpTaskRequestV1 } from "./mcp-task-service.js";
import { createHash, randomUUID } from "node:crypto";
import {
  npDigestAgentCapabilityRegistryCanonical,
  npRequireAgentCapabilityRegistryCanonical,
} from "../agent-contract/canonical-capability-registry.js";
import {
  npIsAgentChangeSetCapabilityIdV1,
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  type NpAgentInstalledCapabilityIdV1,
  type NpAgentInstalledCapabilityInvocationRequestV1,
  type NpAgentChangeSetCapabilityInvocationResultV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../agent-contract/installed-capability-contract.js";
import type { NpAgentChangeSetCapabilityFacadeV1 } from "./changeset-capability.js";

import { and, eq, desc, count } from "drizzle-orm";

import {
  npAgentScopeStaffCapability,
  npDigestAgentActionCanonical,
  npDigestAgentAuthorizationContextCanonical,
  npDigestAgentInvocationRequestCanonical,
  npRequireAgentAuthorizationContextCanonical,
  npRequireAgentGatewaySettings,
  npRequireAgentScopesV1,
  npRequireAgentActionCanonical,
  npRequireAgentInvocationRequestCanonical,
  npRequireAgentReadCapabilityInvocationRequestV1,
  type NpAgentActionCanonicalV1,
  type NpAgentJsonObject,
  type NpAgentReadCapabilityIdV1,
  type NpAgentReadCapabilityInvocationRequestV1,
  type NpAgentScope,
  type NpAgentAuthorizationContextCanonicalV1,
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
  type NpAgentResolvedRuntimePrincipalV1,
} from "./capability-registry.js";
import {
  npProjectAgentPrincipalV1,
  npProjectAgentServiceTokenV1,
  type NpAgentGatewayServiceV1,
  type NpAgentAuthenticatedServicePrincipalV1,
} from "./gateway-service.js";
import {
  npProjectAgentOauthClientV1,
  type NpAgentAuthenticatedOauthPrincipalV1,
} from "./oauth-service.js";

type Db = ReturnType<typeof getDb>;

export type NpAgentCapabilityAuthenticationV1 =
  NpAgentAuthenticatedServicePrincipalV1 | NpAgentAuthenticatedOauthPrincipalV1;

function isOauthAuthentication(
  authentication: NpAgentCapabilityAuthenticationV1,
): authentication is NpAgentAuthenticatedOauthPrincipalV1 {
  return "kind" in authentication && authentication.kind === "oauth";
}

export interface NpAgentCapabilityAdmissionOptionsV1 {
  runtimeAdmission?: NpAgentRuntimeAdmissionV1;
  registry: NpAgentReadCapabilityRegistryV1;
  resolveChangeSetCapabilities?: () => NpAgentChangeSetCapabilityFacadeV1 | null;
  resolveGatewaySettings: (
    siteId: string,
  ) => NpAgentGatewaySettingsV1 | Promise<NpAgentGatewaySettingsV1>;
  now?: () => Date;
  invocationRetentionSeconds?: number;
}

export type { NpAgentReadCapabilityInvocationResultV1 } from "../agent-contract/agent-http-contract.js";
import type { NpAgentReadCapabilityInvocationResultV1 } from "../agent-contract/agent-http-contract.js";

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
  nowFn: () => Date,
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
  const now = nowFn();
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
    token.expiresAt <= nowFn() ||
    (token.status === "overlap" &&
      (!token.overlapExpiresAt || token.overlapExpiresAt <= nowFn())) ||
    requiredScopes.some((scope) => !can(effectiveUser, npAgentScopeStaffCapability[scope]))
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
}

async function assertCurrentOauthAuthority(
  tx: Db,
  authentication: NpAgentAuthenticatedOauthPrincipalV1,
  requiredScopes: readonly NpAgentScope[],
  nowFn: () => Date,
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
    grant.expiresAt <= nowFn() ||
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
    grant.expiresAt <= nowFn() ||
    requiredScopes.some((scope) => !can(effectiveUser, npAgentScopeStaffCapability[scope]))
  ) {
    throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
  }
}

async function assertCurrentAuthentication(
  tx: Db,
  authentication: NpAgentCapabilityAuthenticationV1,
  requiredScopes: readonly NpAgentScope[],
  nowFn: () => Date,
): Promise<void> {
  if (isOauthAuthentication(authentication)) {
    return assertCurrentOauthAuthority(tx, authentication, requiredScopes, nowFn);
  }
  return assertCurrentServiceAuthority(tx, authentication, requiredScopes, nowFn);
}

export function createAgentCapabilityAdmissionServiceV1(
  options: NpAgentCapabilityAdmissionOptionsV1,
) {
  const definitionCache = new Map<string, Promise<{ canonical: string; fingerprint: string }>>();
  function expectedDefinition(id: NpAgentChangeSetCapabilityInvocationRequestV1["capabilityId"]) {
    let cached = definitionCache.get(id);
    if (!cached) {
      cached = (async () => {
        const definition = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(id);
        return {
          canonical: serializeAgentCanonicalJson(definition),
          fingerprint: await npDigestAgentCapabilityRegistryCanonical(
            definition,
            definition.capabilities,
          ),
        };
      })();
      definitionCache.set(id, cached);
    }
    return cached;
  }
  const nowFn = options.now ?? (() => new Date());
  const retentionSeconds = options.invocationRetentionSeconds ?? 60 * 60;
  if (
    !Number.isSafeInteger(retentionSeconds) ||
    retentionSeconds < 60 ||
    retentionSeconds > 86_400
  ) {
    throw new Error("Agent invocation retention must be 60..86400 seconds.");
  }

  function runtimePrincipal(
    context: Pick<NpAgentRuntimeRunContextV1, "evidence" | "run" | "siteId">,
  ): NpAgentResolvedRuntimePrincipalV1 {
    const principal = context.evidence.principal;
    const authority =
      principal.authorityKind === "user" && principal.authorityUserId
        ? { kind: "user" as const, userId: principal.authorityUserId }
        : principal.authorityPolicyId
          ? { kind: "deployment" as const, policyId: principal.authorityPolicyId }
          : null;
    if (!authority)
      throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
    return {
      kind: "runtime",
      principalId: principal.id,
      siteId: context.siteId,
      authority,
      scopes: context.evidence.definition.scopes,
      runId: context.run.id,
    };
  }
  async function runtimeAuthentication(context: NpAgentRuntimeRunContextV1) {
    const authorizationContext = npRequireAgentAuthorizationContextCanonical({
      schemaVersion: "np.agent-authorization-context.v1",
      siteId: context.siteId,
      actor: {
        kind: "principal",
        principalId: context.evidence.principal.id,
        actorFingerprint: digest("np.agent-principal-actor.v1", {
          siteId: context.siteId,
          principalId: context.evidence.principal.id,
        }),
      },
      transport: "runtime",
      gatewayExposure: null,
      authorityRef: {
        kind: "runtime-run",
        principalId: context.evidence.principal.id,
        runId: context.run.id,
        agentVersionId: context.evidence.version.id,
        deadlineAt: context.run.deadlineAt.toISOString(),
      },
    });
    return {
      kind: "runtime" as const,
      scopes: context.evidence.definition.scopes,
      authorizationContext,
      authorizationContextFingerprint:
        await npDigestAgentAuthorizationContextCanonical(authorizationContext),
    };
  }
  async function currentRuntimeAction(
    context: NpAgentRuntimeRunContextV1,
    action: typeof npAgentActions.$inferSelect,
  ) {
    if (
      !options.registry.ids.includes(action.capabilityId as NpAgentReadCapabilityIdV1) ||
      action.siteId !== context.siteId ||
      action.runId !== context.run.id ||
      action.runFingerprint !== context.run.admissionFingerprint ||
      !action.invocationId ||
      action.idempotencyKey !== `runtime:${context.run.id}:${action.sequence.toString()}`
    )
      throw new NpAgentGatewayError(
        "RUNTIME_ACTION_CONFLICT",
        409,
        "Runtime action is unavailable.",
      );
    const entry = options.registry.get(action.capabilityId as NpAgentReadCapabilityIdV1);
    if (
      !service
        .sourceEntries(context)
        .some((item) => item.canonical.descriptor.id === action.capabilityId) ||
      entry.capabilityFingerprint !== action.capabilityFingerprint ||
      serializeAgentCanonicalJson(entry.definitionCanonical) !==
        serializeAgentCanonicalJson(action.capabilityDefinitionBody)
    )
      throw new NpAgentGatewayError(
        "RUNTIME_ACTION_CONFLICT",
        409,
        "Runtime action is unavailable.",
      );
    const canonical = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: action.siteId,
      actionId: action.id,
      invocationFingerprint: action.invocationFingerprint,
      runFingerprint: action.runFingerprint,
      sequence: action.sequence,
      capabilityId: action.capabilityId,
      capabilityContractVersion: action.capabilityContractVersion,
      capabilityFingerprint: action.capabilityFingerprint,
      effectProfile: { id: action.effectProfileId, contractVersion: action.effectContractVersion },
      risk: action.risk,
      requiredScopes: action.requiredScopes,
      targetRefs: action.targetRefs,
      targetVersionFacts: action.targetVersionFacts,
      input: action.inputCanonical,
    });
    const [invocation] = await context.db
      .select()
      .from(npAgentInvocations)
      .where(
        and(
          eq(npAgentInvocations.siteId, context.siteId),
          eq(npAgentInvocations.id, action.invocationId),
        ),
      )
      .limit(1);
    const auth = await runtimeAuthentication(context);
    if (
      (await npDigestAgentActionCanonical(canonical)) !== action.inputHash ||
      !invocation ||
      invocation.transport !== "runtime" ||
      invocation.principalId !== context.evidence.principal.id ||
      invocation.authorizationContextFingerprint !== auth.authorizationContextFingerprint ||
      serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
        serializeAgentCanonicalJson(auth.authorizationContext) ||
      invocation.requestHash !== action.invocationFingerprint ||
      (await npDigestAgentInvocationRequestCanonical(
        npRequireAgentInvocationRequestCanonical(invocation.requestBody),
      )) !== invocation.requestHash ||
      invocation.outputHash !== action.outputHash ||
      action.outputRedacted === null ||
      digest("np.agent-capability-output.v1", action.outputRedacted) !== action.outputHash ||
      serializeAgentCanonicalJson(invocation.outputRedacted) !==
        serializeAgentCanonicalJson(action.outputRedacted) ||
      invocation.expiresAt <= context.now ||
      invocation.operationId !== action.capabilityId ||
      invocation.resultId !== action.id ||
      invocation.state !== "completed" ||
      action.state !== "succeeded"
    )
      throw new NpAgentGatewayError(
        "RUNTIME_ACTION_CONFLICT",
        409,
        "Runtime action is unavailable.",
      );
    const input = entry.definition.parseInput(action.inputCanonical);
    const principal = runtimePrincipal(context);
    const requirements = npRequireAgentReadDerivedRequirementsV1(
      (await entry.definition.deriveRequirements?.(input, {
        siteId: context.siteId,
        principal,
        requestedAt: context.now.toISOString(),
      })) ?? { additionalScopes: [], targetRefs: [], riskFloor: "read", approvalFloor: "none" },
    );
    if (
      [...entry.definition.descriptor.requiredScopes, ...requirements.additionalScopes].some(
        (scope) => !principal.scopes.includes(scope),
      )
    )
      throw new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Capability is unavailable.");
    const current = await entry.definition.execute(input, {
      siteId: context.siteId,
      principal,
      requestedAt: context.now.toISOString(),
      invocationId: invocation.id,
      idempotencyKey: null,
      abortSignal: new AbortController().signal,
      transaction: context.db,
    });
    return { entry, output: entry.definition.parseOutput(current.output), invocation };
  }
  async function invokeRead<C extends NpAgentReadCapabilityIdV1>(
    input: {
      request: NpAgentReadCapabilityInvocationRequestV1 & { capabilityId: C };
      abortSignal?: AbortSignal;
    } & (
      | { authentication: NpAgentCapabilityAuthenticationV1 }
      | {
          runtime: NpAgentRuntimeRunContextV1;
          sequence: number;
        }
    ),
  ): Promise<NpAgentReadCapabilityInvocationResultV1<C>> {
    const request = npRequireAgentReadCapabilityInvocationRequestV1(input.request);
    const capabilityId = request.capabilityId as C;
    const entry = options.registry.get(capabilityId);
    const runtime = "runtime" in input ? input.runtime : undefined;
    const runtimeSequence = "sequence" in input ? input.sequence : 1;
    const runtimeKey = runtime ? `runtime:${runtime.run.id}:${runtimeSequence.toString()}` : null;
    const authentication =
      "authentication" in input ? input.authentication : await runtimeAuthentication(input.runtime);
    const principal =
      "authentication" in input
        ? resolvedPrincipal(input.authentication)
        : runtimePrincipal(input.runtime);
    const transaction = async <T>(
      operation: (db: Db) => Promise<T>,
      isolationLevel?: "serializable",
    ): Promise<T> =>
      runtime
        ? operation(runtime.db)
        : getDb().transaction(
            (db) => operation(db as Db),
            isolationLevel ? { isolationLevel } : undefined,
          );
    if (principal.siteId !== authentication.authorizationContext.siteId)
      throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
    if (runtime) {
      if (
        !service
          .sourceEntries(runtime)
          .some((item) => item.canonical.descriptor.id === capabilityId)
      )
        throw new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Capability is unavailable.");
    } else {
      const settings = npRequireAgentGatewaySettings(
        await options.resolveGatewaySettings(principal.siteId),
      );
      const settingsKey = transportSettingsKey(authentication.authorizationContext.transport);
      if (
        settings[settingsKey] === "disabled" ||
        !entry.definition.descriptor.gateway?.transports.includes(
          descriptorTransport(authentication.authorizationContext.transport),
        )
      )
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
    if (runtime) {
      const [previous] = await runtime.db
        .select()
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, runtime.siteId),
            eq(npAgentActions.runId, runtime.run.id),
            eq(npAgentActions.sequence, runtimeSequence),
          ),
        )
        .limit(1);
      if (previous) {
        if (
          previous.capabilityId !== capabilityId ||
          previous.invocationFingerprint !== requestHash ||
          previous.runFingerprint !== runtime.run.admissionFingerprint ||
          previous.idempotencyKey !== runtimeKey ||
          previous.state !== "succeeded" ||
          !previous.invocationId ||
          !previous.outputRedacted
        )
          throw new NpAgentGatewayError(
            "RUNTIME_ACTION_CONFLICT",
            409,
            "Runtime action is unavailable.",
          );
        const current = await currentRuntimeAction(runtime, previous);
        const output = entry.definition.parseOutput(current.output);
        if (digest("np.agent-capability-output.v1", asJsonObject(output)) !== previous.outputHash)
          throw new NpAgentGatewayError(
            "RUNTIME_ACTION_CONFLICT",
            409,
            "Runtime action is unavailable.",
          );
        return {
          schemaVersion: "np.agent-read-invocation-result.v1",
          invocationId: previous.invocationId,
          actionId: previous.id,
          capabilityId,
          output,
        };
      }
    }
    const invocationId = randomUUID();
    const actionId = randomUUID();
    const actionCanonical: NpAgentActionCanonicalV1 = npRequireAgentActionCanonical({
      schemaVersion: "np.agent-action.v1",
      siteId: principal.siteId,
      actionId,
      invocationFingerprint: requestHash,
      runFingerprint: runtime?.run.admissionFingerprint ?? null,
      sequence: runtimeSequence,
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
    const expiresAt = new Date(now.getTime() + retentionSeconds * 1_000);
    await transaction(async (rawTx) => {
      const tx = rawTx;
      if ("authentication" in input)
        await assertCurrentAuthentication(tx, input.authentication, requiredScopes, nowFn);
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
        idempotencyKey: runtimeKey,
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
        runId: runtime?.run.id ?? null,
        runFingerprint: runtime?.run.admissionFingerprint ?? null,
        invocationId,
        invocationFingerprint: requestHash,
        sequence: runtimeSequence,
        capabilityId,
        capabilityContractVersion: entry.definition.descriptor.contractVersion,
        capabilityFingerprint: entry.capabilityFingerprint,
        capabilityDefinitionBody: entry.definitionCanonical,
        effectProfileId: "domain.read",
        effectContractVersion: 1,
        risk: "read",
        state: "executing",
        idempotencyKey: runtimeKey,
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
    }, "serializable");
    try {
      const execution = await entry.definition.execute(parsedInput, {
        siteId: principal.siteId,
        principal,
        requestedAt,
        invocationId,
        idempotencyKey: null,
        abortSignal: input.abortSignal ?? new AbortController().signal,
        ...(runtime ? { transaction: runtime.db } : {}),
      });
      const output = entry.definition.parseOutput(execution.output);
      const outputObject = asJsonObject(output);
      const outputHash = digest("np.agent-capability-output.v1", outputObject);
      const finishedAt = nowFn();
      await transaction(async (rawTx) => {
        const tx = rawTx;
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
      await transaction(async (rawTx) => {
        const tx = rawTx;
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
  }

  const service = {
    sourceEntries(context: Readonly<Omit<NpAgentRuntimeRunContextV1, "db">>) {
      return options.registry.ids
        .map((id) => options.registry.get(id))
        .filter(
          (entry) =>
            (context.evidence.principal.authorityKind === "user" ||
              entry.definition.descriptor.id === "content.query") &&
            context.evidence.definition.scopes.length > 0 &&
            context.policy.effective.capabilityModes.some(
              (mode) => mode.capabilityId === entry.definition.descriptor.id,
            ) &&
            entry.definition.descriptor.requiredScopes.every((scope) =>
              context.evidence.definition.scopes.includes(scope),
            ),
        );
    },
    async runtimeActionOutcomes(context: NpAgentRuntimeRunContextV1): Promise<
      readonly {
        capabilityId: NpAgentReadCapabilityIdV1;
        state: "succeeded";
        safeCode: null;
      }[]
    > {
      npAssertAgentPreviewEffectsAllowed();
      const rows = await context.db
        .select()
        .from(npAgentActions)
        .where(
          and(eq(npAgentActions.siteId, context.siteId), eq(npAgentActions.runId, context.run.id)),
        )
        .orderBy(desc(npAgentActions.sequence))
        .limit(32);
      const result: {
        capabilityId: NpAgentReadCapabilityIdV1;
        state: "succeeded";
        safeCode: null;
      }[] = [];
      for (const row of rows.reverse()) {
        try {
          await currentRuntimeAction(context, row);
          result.push({
            capabilityId: row.capabilityId as NpAgentReadCapabilityIdV1,
            state: "succeeded",
            safeCode: null,
          });
        } catch {
          /* Missing, expired, modified or currently hidden action evidence is not provider input. */
        }
      }
      return result;
    },
    async invokeRuntime<C extends NpAgentInstalledCapabilityIdV1>(input: {
      siteId: string;
      runId: string;
      claim: NpAgentRuntimeExecutionClaimV1;
      sequence: number;
      request: NpAgentInstalledCapabilityInvocationRequestV1 & { capabilityId: C };
      abortSignal?: AbortSignal;
    }) {
      npAssertAgentPreviewEffectsAllowed();
      if (!options.runtimeAdmission || !Number.isSafeInteger(input.sequence) || input.sequence < 1)
        throw new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Capability is unavailable.");
      const request = npRequireAgentInstalledCapabilityInvocationRequestV1(input.request);
      if (npIsAgentChangeSetCapabilityIdV1(request.capabilityId))
        throw new NpAgentGatewayError("CAPABILITY_UNAVAILABLE", 404, "Capability is unavailable.");
      const result = await options.runtimeAdmission.withCurrentRun(
        { siteId: input.siteId, runId: input.runId, claim: input.claim },
        async (context) => {
          const [existing] = await context.db
            .select({ id: npAgentActions.id })
            .from(npAgentActions)
            .where(
              and(
                eq(npAgentActions.siteId, context.siteId),
                eq(npAgentActions.runId, context.run.id),
                eq(npAgentActions.sequence, input.sequence),
              ),
            )
            .limit(1);
          const [used] = await context.db
            .select({ total: count() })
            .from(npAgentActions)
            .where(
              and(
                eq(npAgentActions.siteId, context.siteId),
                eq(npAgentActions.runId, context.run.id),
              ),
            );
          if (!existing && used.total >= context.limits.maxCapabilityCalls)
            throw new NpAgentGatewayError(
              "RUNTIME_BUDGET_EXCEEDED",
              409,
              "Runtime action limit reached.",
            );
          try {
            return {
              value: await invokeRead({
                runtime: context,
                sequence: input.sequence,
                request: request as NpAgentReadCapabilityInvocationRequestV1,
                abortSignal: input.abortSignal,
              }),
            };
          } catch (error) {
            return { error };
          }
        },
      );
      if ("error" in result) throw result.error;
      return result.value;
    },

    /** Resume an admitted server job from persisted authority; never accepts a presented credential. */
    async withStoredAuthority<T>(input: {
      authorizationContext: NpAgentAuthorizationContextCanonicalV1;
      authorizationContextFingerprint: string;
      requiredScopes: readonly NpAgentScope[];
      minimumExposure: "read" | "propose" | "approved-execute";
      resolveTransportAudience: NpAgentGatewayServiceV1["getTransportAudience"];
      mutate: (db: Db, now: Date, authentication: NpAgentCapabilityAuthenticationV1) => Promise<T>;
    }): Promise<T> {
      const context = npRequireAgentAuthorizationContextCanonical(input.authorizationContext);
      const ref = context.authorityRef;
      if (
        context.actor.kind !== "principal" ||
        !["service-family", "oauth-grant"].includes(ref.kind) ||
        (await npDigestAgentAuthorizationContextCanonical(context)) !==
          input.authorizationContextFingerprint
      )
        throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
      const [principal] = await getDb()
        .select()
        .from(npAgentPrincipals)
        .where(
          and(
            eq(npAgentPrincipals.siteId, context.siteId),
            eq(npAgentPrincipals.id, context.actor.principalId),
          ),
        )
        .limit(1);
      if (!principal)
        throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
      let authentication: NpAgentCapabilityAuthenticationV1;
      if (ref.kind === "service-family") {
        const [token] = await getDb()
          .select()
          .from(npAgentServiceTokens)
          .where(
            and(
              eq(npAgentServiceTokens.siteId, context.siteId),
              eq(npAgentServiceTokens.principalId, principal.id),
              eq(npAgentServiceTokens.rotationFamilyId, ref.rotationFamilyId),
              eq(npAgentServiceTokens.status, "active_head"),
            ),
          )
          .limit(1);
        const projectedToken = token ? npProjectAgentServiceTokenV1(token) : null;
        if (
          !projectedToken ||
          (await input.resolveTransportAudience(context.siteId, projectedToken.transport)) !==
            ref.audience
        )
          throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
        authentication = {
          principal: npProjectAgentPrincipalV1(principal),
          serviceToken: projectedToken,
          scopes: projectedToken.scopes,
          authorizationContext: context,
          authorizationContextFingerprint: input.authorizationContextFingerprint,
        };
      } else if (ref.kind === "oauth-grant") {
        const [grant] = await getDb()
          .select()
          .from(npAgentOauthGrants)
          .where(
            and(
              eq(npAgentOauthGrants.siteId, context.siteId),
              eq(npAgentOauthGrants.id, ref.grantId),
            ),
          )
          .limit(1);
        const [client] = grant
          ? await getDb()
              .select()
              .from(npAgentOauthClients)
              .where(
                and(
                  eq(npAgentOauthClients.siteId, context.siteId),
                  eq(npAgentOauthClients.id, grant.clientId),
                ),
              )
              .limit(1)
          : [];
        if (
          !grant ||
          !client ||
          (await input.resolveTransportAudience(context.siteId, "mcp-http")) !== ref.audience
        )
          throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
        authentication = {
          kind: "oauth",
          principal: npProjectAgentPrincipalV1(principal),
          client: npProjectAgentOauthClientV1(client),
          grantId: grant.id,
          scopes: npRequireAgentScopesV1(grant.scopes),
          authorizationContext: context,
          authorizationContextFingerprint: input.authorizationContextFingerprint,
        };
      } else throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
      return service.withCurrentAuthority({
        authentication,
        requiredScopes: input.requiredScopes,
        minimumExposure: input.minimumExposure,
        mutate: async (db, time) => {
          const result = await input.mutate(db, time, authentication);
          if (
            (await input.resolveTransportAudience(
              context.siteId,
              descriptorTransport(context.transport),
            )) !== ref.audience
          )
            throw new NpAgentGatewayError("AUTHORIZATION_CHANGED", 409, "Authorization changed.");
          return result;
        },
      });
    },
    /** Server-only domain transaction seam; installing it does not advertise a capability. */
    async withCurrentAuthority<T>(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      requiredScopes: readonly NpAgentScope[];
      minimumExposure: "read" | "propose" | "approved-execute";
      mutate: (db: Db, now: Date) => Promise<T>;
    }): Promise<T> {
      const authentication = input.authentication;
      const siteId = resolvedPrincipal(authentication).siteId;
      const key = transportSettingsKey(authentication.authorizationContext.transport);
      const exposure = { disabled: 0, read: 1, propose: 2, "approved-execute": 3 } as const;
      const assertExposure = async () => {
        const settings = npRequireAgentGatewaySettings(
          await options.resolveGatewaySettings(siteId),
        );
        const ceiling = authentication.authorizationContext.gatewayExposure;
        if (
          ceiling === null ||
          exposure[ceiling] < exposure[input.minimumExposure] ||
          exposure[settings[key]] < exposure[input.minimumExposure] ||
          input.requiredScopes.some((scope) => !authentication.scopes.includes(scope))
        ) {
          throw new NpAgentGatewayError(
            "CAPABILITY_UNAVAILABLE",
            404,
            "Capability is unavailable.",
          );
        }
      };
      await assertExposure();
      return getDb().transaction(
        async (tx) => {
          await assertCurrentAuthentication(tx, authentication, input.requiredScopes, nowFn);
          const result = await input.mutate(tx, nowFn());
          await assertExposure();
          await assertCurrentAuthentication(tx, authentication, input.requiredScopes, nowFn);
          return result;
        },
        { isolationLevel: "serializable" },
      );
    },
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
        await assertCurrentAuthentication(rawTx, authentication, authentication.scopes, nowFn);
      });
      const transport = descriptorTransport(authentication.authorizationContext.transport);
      const facade = options.resolveChangeSetCapabilities?.();
      const extra = facade ? await Promise.all(facade.ids.map((id) => facade.entry(id))) : [];
      for (const [index, entry] of extra.entries()) {
        const id = facade!.ids[index];
        if (!npIsAgentChangeSetCapabilityIdV1(id) || (index > 0 && facade!.ids[index - 1] >= id))
          throw new NpAgentGatewayError(
            "CAPABILITY_UNAVAILABLE",
            404,
            "Capability is unavailable.",
          );
        const expected = await expectedDefinition(id);
        if (
          !npIsAgentChangeSetCapabilityIdV1(id) ||
          (index > 0 && facade!.ids[index - 1] >= id) ||
          serializeAgentCanonicalJson(entry.definitionCanonical) !== expected.canonical ||
          serializeAgentCanonicalJson(entry.canonical) !==
            serializeAgentCanonicalJson(entry.definitionCanonical.capabilities[0]) ||
          serializeAgentCanonicalJson(entry.definition) !==
            serializeAgentCanonicalJson(entry.canonical) ||
          entry.capabilityFingerprint !== expected.fingerprint
        )
          throw new NpAgentGatewayError(
            "CAPABILITY_UNAVAILABLE",
            404,
            "Capability is unavailable.",
          );
      }
      const all = [...options.registry.ids.map((id) => options.registry.get(id)), ...extra].sort(
        (a, b) => a.definition.descriptor.id.localeCompare(b.definition.descriptor.id),
      );
      const levels = { disabled: 0, read: 1, propose: 2, "approved-execute": 3 } as const;
      const currentLevel = Math.min(
        levels[settings[settingsKey]],
        levels[authentication.authorizationContext.gatewayExposure ?? "disabled"],
      );
      const registry = npRequireAgentCapabilityRegistryCanonical({
        schemaVersion: "np.agent-capability-registry.v1",
        projection: "registry",
        capabilities: all.map((entry) => entry.canonical),
      });
      return {
        principal,
        settings,
        registryFingerprint: extra.length
          ? await npDigestAgentCapabilityRegistryCanonical(registry, registry.capabilities)
          : options.registry.registryFingerprint,
        entries: all.filter(
          (entry) =>
            entry.definition.descriptor.gateway?.transports.includes(transport) === true &&
            entry.definition.descriptor.requiredScopes.every((scope) =>
              authentication.scopes.includes(scope),
            ) &&
            (() => {
              const tool = npAgentMcpToolDefinitionsV1.find((definition) =>
                definition.capabilityIds.includes(entry.definition.descriptor.id),
              );
              return tool
                ? levels[tool.listedFrom] <= currentLevel
                : entry.definition.descriptor.effectProfiles.some(
                    (profile) =>
                      profile.minimumGatewayExposure !== null &&
                      levels[profile.minimumGatewayExposure] <= currentLevel,
                  );
            })(),
        ),
      };
    },
    async invoke<C extends NpAgentInstalledCapabilityIdV1>(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      request: NpAgentInstalledCapabilityInvocationRequestV1 & { capabilityId: C };
      abortSignal?: AbortSignal;
      taskRequest?: NpAgentMcpTaskRequestV1;
    }): Promise<
      C extends NpAgentReadCapabilityIdV1
        ? NpAgentReadCapabilityInvocationResultV1<C>
        : NpAgentChangeSetCapabilityInvocationResultV1 & {
            task?: NpAgentMcpTaskV1;
          }
    > {
      type Result = C extends NpAgentReadCapabilityIdV1
        ? NpAgentReadCapabilityInvocationResultV1<C>
        : NpAgentChangeSetCapabilityInvocationResultV1;
      const request = npRequireAgentInstalledCapabilityInvocationRequestV1(input.request);
      if (npIsAgentChangeSetCapabilityIdV1(request.capabilityId)) {
        const facade = options.resolveChangeSetCapabilities?.();
        const projection = await service.project({ authentication: input.authentication });
        if (
          !facade ||
          !projection.entries.some(
            (entry) => entry.definition.descriptor.id === request.capabilityId,
          )
        )
          throw new NpAgentGatewayError(
            "CAPABILITY_UNAVAILABLE",
            404,
            "Capability is unavailable.",
          );
        return (await facade.invoke(
          input.authentication,
          request as NpAgentChangeSetCapabilityInvocationRequestV1,
          input.taskRequest,
        )) as Result;
      }
      return (await invokeRead({
        ...input,
        request: request as NpAgentReadCapabilityInvocationRequestV1,
      })) as Result;
    },
  };
  return service;
}

export type NpAgentCapabilityAdmissionServiceV1 = ReturnType<
  typeof createAgentCapabilityAdmissionServiceV1
>;
