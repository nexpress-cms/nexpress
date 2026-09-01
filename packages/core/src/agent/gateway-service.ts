import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";

import {
  npAgentDisabledGatewaySettingsV1,
  npRequireAgentGatewaySettings,
  npAgentServiceTokenLimits,
  npDigestAgentAuthorizationContextCanonical,
  npRequireAgentAuthorizationContextCanonical,
  npRequireAgentPrincipalV1,
  npRequireAgentServiceTokenV1,
  type NpAgentAuthorizationContextCanonicalV1,
  type NpAgentEnabledGatewayExposureMode,
  type NpAgentGatewayAdminOperationIdV1,
  type NpAgentGatewaySettingsV1,
  type NpAgentJsonObject,
  type NpAgentPrincipalV1,
  type NpAgentScope,
  type NpAgentServiceTokenTransportV1,
  type NpAgentServiceTokenV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import type { NpAuthUser } from "../config/types.js";
import { getDb } from "../db/runtime.js";
import { npAgentPrincipals, npAgentServiceTokens } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";

import {
  createAgentAdminAdmissionV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminExecutionResultV1,
  type NpAgentStaffPrimaryReauthenticationVerifierV1,
} from "./admin-admission.js";
import {
  npMintAgentOpaqueVerifierV1,
  npParseAgentOpaqueVerifierV1,
  npVerifyAgentOpaqueVerifierV1,
  type NpAgentTokenHashKeyring,
} from "./opaque-verifier.js";

type NpAgentDb = ReturnType<typeof getDb>;
type PrincipalRow = typeof npAgentPrincipals.$inferSelect;
type ServiceTokenRow = typeof npAgentServiceTokens.$inferSelect;

const EXPOSURE_RANK = { disabled: 0, read: 1, propose: 2, "approved-execute": 3 } as const;
const UUID_PATTERN = new RegExp(npAuthUuidPattern, "u");

export interface NpAgentGatewayServiceOptionsV1 {
  tokenHashKeyring: NpAgentTokenHashKeyring;
  environment?: "production" | "development";
  deploymentGatewaySettings?: NpAgentGatewaySettingsV1;
  resolveSiteGatewaySettings?: (
    siteId: string,
  ) => NpAgentGatewaySettingsV1 | Promise<NpAgentGatewaySettingsV1>;
  resolveCanonicalSiteOrigin?: (siteId: string) => string | null | Promise<string | null>;
  reauthentication?: NpAgentStaffPrimaryReauthenticationVerifierV1;
  now?: () => Date;
}

export interface NpAgentAuthenticatedServicePrincipalV1 {
  principal: NpAgentPrincipalV1;
  serviceToken: NpAgentServiceTokenV1;
  scopes: NpAgentScope[];
  authorizationContext: NpAgentAuthorizationContextCanonicalV1;
  authorizationContextFingerprint: string;
}

type NpAgentServiceGatewayAdminOperationIdV1 = Exclude<
  NpAgentGatewayAdminOperationIdV1,
  "agents.gateway.oauth_clients.create" | "agents.gateway.oauth_clients.revoke"
>;

function sha256Canonical(domain: string, value: unknown): `cj1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function toJsonObject<T extends object>(value: T): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function principalProjection(row: PrincipalRow): NpAgentPrincipalV1 {
  if (row.kind !== "external") {
    throw new NpAgentGatewayError(
      "PRINCIPAL_KIND_UNSUPPORTED",
      409,
      "Gateway lifecycle reads only external principals.",
    );
  }
  const authority =
    row.authorityKind === "user"
      ? {
          kind: "user" as const,
          userId: row.authorityUserId,
          fingerprint: row.authorityFingerprint,
          deletedAt: row.authorityDeletedAt?.toISOString() ?? null,
        }
      : {
          kind: "deployment" as const,
          policyId: row.authorityPolicyId ?? "invalid",
          fingerprint: row.authorityFingerprint,
        };
  return npRequireAgentPrincipalV1({
    schemaVersion: "np.agent-principal.v1",
    id: row.id,
    siteId: row.siteId,
    kind: "external",
    name: row.name,
    description: row.description,
    status: row.status,
    scopes: row.scopes,
    authority,
    rowVersion: row.rowVersion,
    tokenVersion: row.tokenVersion,
    autonomy: null,
    gatewayExposureCeiling: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}

function tokenProjection(row: ServiceTokenRow): NpAgentServiceTokenV1 {
  return npRequireAgentServiceTokenV1({
    schemaVersion: "np.agent-service-token.v1",
    id: row.id,
    siteId: row.siteId,
    principalId: row.principalId,
    name: row.name,
    prefix: row.prefix,
    status: row.status,
    scopes: row.scopes,
    transport: row.transport,
    exposureMode: row.exposureMode,
    audience: row.audience,
    rowVersion: row.rowVersion,
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    overlapExpiresAt: row.overlapExpiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}

function requireSubset(scopes: readonly NpAgentScope[], ceiling: readonly string[]): void {
  if (scopes.some((scope) => !ceiling.includes(scope))) {
    throw new NpAgentGatewayError(
      "SCOPE_ESCALATION_DENIED",
      403,
      "Requested scopes must narrow the principal authority.",
    );
  }
}

function transportSetting(
  settings: NpAgentGatewaySettingsV1,
  transport: NpAgentServiceTokenTransportV1,
) {
  return transport === "stdio"
    ? settings.stdio
    : transport === "mcp-http"
      ? settings.mcpHttp
      : settings.agentHttp;
}

function minimumExposure(
  left: keyof typeof EXPOSURE_RANK,
  right: keyof typeof EXPOSURE_RANK,
): keyof typeof EXPOSURE_RANK {
  return EXPOSURE_RANK[left] <= EXPOSURE_RANK[right] ? left : right;
}

function canonicalOrigin(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== value.replace(/\/$/u, "")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isActiveTokenAt(row: ServiceTokenRow, now: Date): boolean {
  if (row.expiresAt <= now) return false;
  if (row.status === "active_head") return true;
  return row.status === "overlap" && row.overlapExpiresAt !== null && row.overlapExpiresAt > now;
}

function transportForAuthorization(
  transport: NpAgentServiceTokenTransportV1,
): "mcp-service" | "stdio" | "agent-api" {
  return transport === "mcp-http"
    ? "mcp-service"
    : transport === "agent-http"
      ? "agent-api"
      : "stdio";
}

export function createAgentGatewayServiceV1(options: NpAgentGatewayServiceOptionsV1) {
  const nowFn = options.now ?? (() => new Date());
  const tokenHashKeyring: NpAgentTokenHashKeyring = {
    active: {
      id: options.tokenHashKeyring.active.id,
      key: new Uint8Array(options.tokenHashKeyring.active.key),
    },
    previous: Object.fromEntries(
      Object.entries(options.tokenHashKeyring.previous ?? {}).map(([id, key]) => [
        id,
        new Uint8Array(key),
      ]),
    ),
  };
  const deployment = npRequireAgentGatewaySettings(
    options.deploymentGatewaySettings ?? npAgentDisabledGatewaySettingsV1,
  );
  const environment = options.environment ?? "production";
  const admit = createAgentAdminAdmissionV1({
    reauthentication: options.reauthentication,
    now: nowFn,
  });

  const siteSettings = async (siteId: string) =>
    npRequireAgentGatewaySettings(
      (await options.resolveSiteGatewaySettings?.(siteId)) ?? npAgentDisabledGatewaySettingsV1,
    );

  const effectiveCeiling = async (siteId: string, transport: NpAgentServiceTokenTransportV1) =>
    minimumExposure(
      transportSetting(deployment, transport),
      transportSetting(await siteSettings(siteId), transport),
    );

  async function getEffectiveGatewaySettings(siteId: string): Promise<NpAgentGatewaySettingsV1> {
    if (!npIsCanonicalSiteId(siteId)) {
      throw new NpAgentGatewayError("INVALID_SITE", 400, "Site id is not canonical.");
    }
    const settings = await siteSettings(siteId);
    return npRequireAgentGatewaySettings({
      schemaVersion: "np.agent-gateway-settings.v1",
      stdio: minimumExposure(deployment.stdio, settings.stdio),
      mcpHttp: minimumExposure(deployment.mcpHttp, settings.mcpHttp),
      agentHttp: minimumExposure(deployment.agentHttp, settings.agentHttp),
    });
  }

  const audienceFor = async (siteId: string, transport: NpAgentServiceTokenTransportV1) => {
    if (transport === "stdio") return "urn:nexpress:agent-gateway:stdio";
    const origin = canonicalOrigin((await options.resolveCanonicalSiteOrigin?.(siteId)) ?? null);
    if (!origin) {
      throw new NpAgentGatewayError(
        "CANONICAL_SITE_ORIGIN_REQUIRED",
        409,
        "Remote service tokens require one canonical HTTPS site origin.",
      );
    }
    return `${origin}${transport === "mcp-http" ? "/api/mcp" : "/api/agent/v1"}`;
  };

  async function requireExposure(
    siteId: string,
    transport: NpAgentServiceTokenTransportV1,
    exposure: NpAgentEnabledGatewayExposureMode,
  ): Promise<void> {
    const ceiling = await effectiveCeiling(siteId, transport);
    if (ceiling === "disabled" || EXPOSURE_RANK[exposure] > EXPOSURE_RANK[ceiling]) {
      throw new NpAgentGatewayError(
        "GATEWAY_EXPOSURE_DENIED",
        403,
        "The requested transport or exposure exceeds its effective ceiling.",
      );
    }
  }

  async function executeAdmin<I extends NpAgentServiceGatewayAdminOperationIdV1>(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    operationId: I;
    parentTargetId?: string | null;
    targetId: string | null;
    command: unknown;
  }): Promise<NpAgentAdminExecutionResultV1<NpAgentJsonObject>> {
    const targetRequired = input.operationId !== "agents.gateway.principals.create";
    const parentRequired =
      input.operationId === "agents.gateway.principal_tokens.rotate" ||
      input.operationId === "agents.gateway.principal_tokens.revoke";
    if (
      !npIsCanonicalSiteId(input.siteId) ||
      (targetRequired && !isCanonicalUuid(input.targetId)) ||
      (!targetRequired && input.targetId !== null) ||
      (parentRequired && !isCanonicalUuid(input.parentTargetId ?? null)) ||
      (!parentRequired && input.parentTargetId != null)
    ) {
      throw new NpAgentGatewayError(
        "INVALID_ADMIN_TARGET",
        400,
        "Site and target identifiers must match the selected operation.",
      );
    }
    return admit({
      ...input,
      mutate: async ({ db, now, command }) => {
        switch (input.operationId) {
          case "agents.gateway.principals.create": {
            const value = command as {
              name: string;
              description: string | null;
              scopes: NpAgentScope[];
            };
            const id = randomUUID();
            const authorityFingerprint = sha256Canonical("np.agent-principal-authority.v1", {
              siteId: input.siteId,
              userId: input.actor.user.id,
            });
            const [row] = await db
              .insert(npAgentPrincipals)
              .values({
                id,
                siteId: input.siteId,
                kind: "external",
                name: value.name,
                description: value.description,
                status: "active",
                scopes: value.scopes,
                authorityKind: "user",
                authorityUserId: input.actor.user.id,
                authorityFingerprint,
                ownerUserId: input.actor.user.id,
                createdAt: now,
                updatedAt: now,
              })
              .returning();
            if (!row) throw new Error("Failed to create Agent principal.");
            return { resourceId: row.id, output: toJsonObject(principalProjection(row)) };
          }
          case "agents.gateway.principals.update": {
            const value = command as {
              expectedVersion: number;
              name: string;
              description: string | null;
              scopes: NpAgentScope[];
            };
            const [current] = await db
              .select()
              .from(npAgentPrincipals)
              .where(
                and(
                  eq(npAgentPrincipals.siteId, input.siteId),
                  eq(npAgentPrincipals.id, input.targetId ?? ""),
                  eq(npAgentPrincipals.kind, "external"),
                ),
              )
              .for("update")
              .limit(1);
            if (!current || current.status === "revoked") {
              throw new NpAgentGatewayError(
                "PRINCIPAL_NOT_FOUND",
                404,
                "Principal is unavailable.",
              );
            }
            if (current.rowVersion !== value.expectedVersion) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Principal version changed.");
            }
            const scopesChanged = JSON.stringify(current.scopes) !== JSON.stringify(value.scopes);
            const status = value.scopes.includes("site:read") ? current.status : "suspended";
            const [row] = await db
              .update(npAgentPrincipals)
              .set({
                name: value.name,
                description: value.description,
                scopes: value.scopes,
                status,
                rowVersion: current.rowVersion + 1,
                tokenVersion: current.tokenVersion + (scopesChanged ? 1 : 0),
                updatedAt: now,
              })
              .where(
                and(
                  eq(npAgentPrincipals.siteId, current.siteId),
                  eq(npAgentPrincipals.id, current.id),
                  eq(npAgentPrincipals.rowVersion, current.rowVersion),
                ),
              )
              .returning();
            if (!row)
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Principal version changed.");
            return { resourceId: row.id, output: toJsonObject(principalProjection(row)) };
          }
          case "agents.gateway.principal_tokens.create": {
            const value = command as {
              expectedVersion: number;
              name: string;
              scopes: NpAgentScope[];
              transport: NpAgentServiceTokenTransportV1;
              exposure: NpAgentEnabledGatewayExposureMode;
              expiresAt: string;
            };
            const [principal] = await db
              .select()
              .from(npAgentPrincipals)
              .where(
                and(
                  eq(npAgentPrincipals.siteId, input.siteId),
                  eq(npAgentPrincipals.id, input.targetId ?? ""),
                  eq(npAgentPrincipals.kind, "external"),
                ),
              )
              .for("update")
              .limit(1);
            if (!principal || principal.status !== "active" || principal.authorityUserId === null) {
              throw new NpAgentGatewayError(
                "PRINCIPAL_NOT_ACTIVE",
                409,
                "Principal is not active.",
              );
            }
            if (principal.rowVersion !== value.expectedVersion) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Principal version changed.");
            }
            requireSubset(value.scopes, principal.scopes);
            await requireExposure(input.siteId, value.transport, value.exposure);
            const expiresAt = new Date(value.expiresAt);
            const maximumSeconds =
              environment === "development"
                ? npAgentServiceTokenLimits.developmentMaxLifetimeSeconds
                : npAgentServiceTokenLimits.productionMaxLifetimeSeconds;
            if (expiresAt <= now || expiresAt.getTime() > now.getTime() + maximumSeconds * 1_000) {
              throw new NpAgentGatewayError(
                "TOKEN_LIFETIME_INVALID",
                400,
                "Service-token lifetime exceeds the deployment bound.",
              );
            }
            const audience = await audienceFor(input.siteId, value.transport);
            const tokenId = randomUUID();
            const minted = npMintAgentOpaqueVerifierV1({
              purpose: "service-token",
              siteId: input.siteId,
              publicId: tokenId,
              keyring: tokenHashKeyring,
            });
            const [row] = await db
              .insert(npAgentServiceTokens)
              .values({
                id: tokenId,
                siteId: input.siteId,
                principalId: principal.id,
                name: value.name,
                prefix: minted.prefix,
                tokenHash: minted.verifier,
                hashKeyId: minted.hashKeyId,
                rotationFamilyId: randomUUID(),
                familyAuthorityVersion: 1,
                familyGeneration: 1,
                principalTokenVersion: principal.tokenVersion,
                status: "active_head",
                scopes: value.scopes,
                transport: value.transport,
                exposureMode: value.exposure,
                audience,
                expiresAt,
                createdBy: input.actor.user.id,
                createdAt: now,
              })
              .returning();
            if (!row) throw new Error("Failed to create Agent service token.");
            const updated = await db
              .update(npAgentPrincipals)
              .set({ rowVersion: principal.rowVersion + 1, updatedAt: now })
              .where(
                and(
                  eq(npAgentPrincipals.siteId, principal.siteId),
                  eq(npAgentPrincipals.id, principal.id),
                  eq(npAgentPrincipals.rowVersion, principal.rowVersion),
                ),
              )
              .returning({ id: npAgentPrincipals.id });
            if (updated.length !== 1) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Principal version changed.");
            }
            return {
              resourceId: row.id,
              output: toJsonObject(tokenProjection(row)),
              oneTimeValue: minted.value,
            };
          }
          case "agents.gateway.principal_tokens.rotate": {
            const value = command as { expectedVersion: number; overlapSeconds: number };
            const [current] = await db
              .select()
              .from(npAgentServiceTokens)
              .where(
                and(
                  eq(npAgentServiceTokens.siteId, input.siteId),
                  eq(npAgentServiceTokens.id, input.targetId ?? ""),
                  eq(npAgentServiceTokens.principalId, input.parentTargetId ?? ""),
                ),
              )
              .for("update")
              .limit(1);
            if (!current || current.status !== "active_head" || current.expiresAt <= now) {
              throw new NpAgentGatewayError(
                "TOKEN_NOT_ACTIVE",
                409,
                "Token is not an active family head.",
              );
            }
            if (current.rowVersion !== value.expectedVersion) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Token version changed.");
            }
            const [principal] = await db
              .select()
              .from(npAgentPrincipals)
              .where(
                and(
                  eq(npAgentPrincipals.siteId, current.siteId),
                  eq(npAgentPrincipals.id, current.principalId),
                ),
              )
              .for("update")
              .limit(1);
            if (
              !principal ||
              principal.status !== "active" ||
              principal.authorityUserId === null ||
              current.principalTokenVersion !== principal.tokenVersion
            ) {
              throw new NpAgentGatewayError(
                "TOKEN_AUTHORITY_LOST",
                409,
                "Token authority is no longer current.",
              );
            }
            requireSubset(current.scopes as NpAgentScope[], principal.scopes);
            await requireExposure(
              input.siteId,
              current.transport as NpAgentServiceTokenTransportV1,
              current.exposureMode as NpAgentEnabledGatewayExposureMode,
            );
            const tokenId = randomUUID();
            const minted = npMintAgentOpaqueVerifierV1({
              purpose: "service-token",
              siteId: input.siteId,
              publicId: tokenId,
              keyring: tokenHashKeyring,
            });
            const overlapExpiresAt = new Date(
              Math.min(current.expiresAt.getTime(), now.getTime() + value.overlapSeconds * 1_000),
            );
            const oldStatus = value.overlapSeconds === 0 ? "revoked" : "overlap";
            const updated = await db
              .update(npAgentServiceTokens)
              .set({
                status: oldStatus,
                overlapExpiresAt: oldStatus === "overlap" ? overlapExpiresAt : null,
                revokedAt: oldStatus === "revoked" ? now : null,
                rowVersion: current.rowVersion + 1,
              })
              .where(
                and(
                  eq(npAgentServiceTokens.siteId, current.siteId),
                  eq(npAgentServiceTokens.id, current.id),
                  eq(npAgentServiceTokens.rowVersion, current.rowVersion),
                  eq(npAgentServiceTokens.status, "active_head"),
                ),
              )
              .returning({ id: npAgentServiceTokens.id });
            if (updated.length !== 1) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Token version changed.");
            }
            const [replacement] = await db
              .insert(npAgentServiceTokens)
              .values({
                id: tokenId,
                siteId: current.siteId,
                principalId: current.principalId,
                name: current.name,
                prefix: minted.prefix,
                tokenHash: minted.verifier,
                hashKeyId: minted.hashKeyId,
                rotationFamilyId: current.rotationFamilyId,
                familyAuthorityVersion: current.familyAuthorityVersion,
                familyGeneration: current.familyGeneration + 1,
                principalTokenVersion: current.principalTokenVersion,
                replacesTokenId: current.id,
                status: "active_head",
                scopes: current.scopes,
                transport: current.transport,
                exposureMode: current.exposureMode,
                audience: current.audience,
                expiresAt: current.expiresAt,
                createdBy: input.actor.user.id,
                createdAt: now,
              })
              .returning();
            if (!replacement) throw new Error("Failed to rotate Agent service token.");
            return {
              resourceId: replacement.id,
              output: toJsonObject(tokenProjection(replacement)),
              oneTimeValue: minted.value,
            };
          }
          case "agents.gateway.principal_tokens.revoke": {
            const value = command as { expectedVersion: number };
            const [current] = await db
              .select()
              .from(npAgentServiceTokens)
              .where(
                and(
                  eq(npAgentServiceTokens.siteId, input.siteId),
                  eq(npAgentServiceTokens.id, input.targetId ?? ""),
                  eq(npAgentServiceTokens.principalId, input.parentTargetId ?? ""),
                ),
              )
              .for("update")
              .limit(1);
            if (!current || !["active_head", "overlap"].includes(current.status)) {
              throw new NpAgentGatewayError("TOKEN_NOT_ACTIVE", 409, "Token is not active.");
            }
            if (current.rowVersion !== value.expectedVersion) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Token version changed.");
            }
            const [row] = await db
              .update(npAgentServiceTokens)
              .set({
                status: "revoked",
                overlapExpiresAt: null,
                revokedAt: now,
                rowVersion: current.rowVersion + 1,
              })
              .where(
                and(
                  eq(npAgentServiceTokens.siteId, current.siteId),
                  eq(npAgentServiceTokens.id, current.id),
                  eq(npAgentServiceTokens.rowVersion, current.rowVersion),
                ),
              )
              .returning();
            if (!row)
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Token version changed.");
            return { resourceId: row.id, output: toJsonObject(tokenProjection(row)) };
          }
          case "agents.gateway.principals.suspend":
          case "agents.gateway.principals.resume":
          case "agents.gateway.principals.revoke": {
            const value = command as { expectedVersion: number };
            const [current] = await db
              .select()
              .from(npAgentPrincipals)
              .where(
                and(
                  eq(npAgentPrincipals.siteId, input.siteId),
                  eq(npAgentPrincipals.id, input.targetId ?? ""),
                  eq(npAgentPrincipals.kind, "external"),
                ),
              )
              .for("update")
              .limit(1);
            if (!current || current.status === "revoked") {
              throw new NpAgentGatewayError(
                "PRINCIPAL_NOT_FOUND",
                404,
                "Principal is unavailable.",
              );
            }
            if (current.rowVersion !== value.expectedVersion) {
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Principal version changed.");
            }
            const nextStatus = input.operationId.endsWith(".suspend")
              ? "suspended"
              : input.operationId.endsWith(".resume")
                ? "active"
                : "revoked";
            let hasLiveCredential = true;
            if (nextStatus === "active") {
              const candidates = await db
                .select()
                .from(npAgentServiceTokens)
                .where(
                  and(
                    eq(npAgentServiceTokens.siteId, current.siteId),
                    eq(npAgentServiceTokens.principalId, current.id),
                    eq(npAgentServiceTokens.principalTokenVersion, current.tokenVersion),
                    inArray(npAgentServiceTokens.status, ["active_head", "overlap"]),
                    gt(npAgentServiceTokens.expiresAt, now),
                  ),
                )
                .for("update");
              hasLiveCredential = false;
              for (const candidate of candidates) {
                if (!isActiveTokenAt(candidate, now)) continue;
                if (candidate.scopes.some((scope) => !current.scopes.includes(scope))) continue;
                try {
                  const transport = candidate.transport as NpAgentServiceTokenTransportV1;
                  if (candidate.audience !== (await audienceFor(input.siteId, transport))) continue;
                  await requireExposure(
                    input.siteId,
                    transport,
                    candidate.exposureMode as NpAgentEnabledGatewayExposureMode,
                  );
                  hasLiveCredential = true;
                  break;
                } catch {
                  continue;
                }
              }
            }
            if (
              (nextStatus === "suspended" && current.status !== "active") ||
              (nextStatus === "active" &&
                (current.status !== "suspended" ||
                  !current.scopes.includes("site:read") ||
                  current.authorityUserId === null ||
                  !hasLiveCredential))
            ) {
              throw new NpAgentGatewayError(
                "INVALID_PRINCIPAL_TRANSITION",
                409,
                "Principal transition is invalid.",
              );
            }
            const [row] = await db
              .update(npAgentPrincipals)
              .set({
                status: nextStatus,
                rowVersion: current.rowVersion + 1,
                tokenVersion: current.tokenVersion + (nextStatus === "revoked" ? 1 : 0),
                updatedAt: now,
                revokedAt: nextStatus === "revoked" ? now : null,
              })
              .where(
                and(
                  eq(npAgentPrincipals.siteId, current.siteId),
                  eq(npAgentPrincipals.id, current.id),
                  eq(npAgentPrincipals.rowVersion, current.rowVersion),
                ),
              )
              .returning();
            if (!row)
              throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "Principal version changed.");
            if (nextStatus === "revoked") {
              await db
                .update(npAgentServiceTokens)
                .set({
                  status: "revoked",
                  overlapExpiresAt: null,
                  revokedAt: now,
                  rowVersion: sql`${npAgentServiceTokens.rowVersion} + 1`,
                })
                .where(
                  and(
                    eq(npAgentServiceTokens.siteId, row.siteId),
                    eq(npAgentServiceTokens.principalId, row.id),
                    inArray(npAgentServiceTokens.status, ["active_head", "overlap"]),
                  ),
                );
            }
            return { resourceId: row.id, output: toJsonObject(principalProjection(row)) };
          }
        }
      },
    });
  }

  async function listPrincipals(siteId: string, limit = 100): Promise<NpAgentPrincipalV1[]> {
    if (!npIsCanonicalSiteId(siteId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new NpAgentGatewayError("INVALID_LIST_REQUEST", 400, "List request is invalid.");
    }
    const rows = await getDb()
      .select()
      .from(npAgentPrincipals)
      .where(and(eq(npAgentPrincipals.siteId, siteId), eq(npAgentPrincipals.kind, "external")))
      .orderBy(asc(npAgentPrincipals.createdAt), asc(npAgentPrincipals.id))
      .limit(limit);
    return rows.map(principalProjection);
  }

  async function getPrincipal(
    siteId: string,
    principalId: string,
  ): Promise<NpAgentPrincipalV1 | null> {
    if (!npIsCanonicalSiteId(siteId) || !isCanonicalUuid(principalId)) {
      throw new NpAgentGatewayError("INVALID_READ_REQUEST", 400, "Read request is invalid.");
    }
    const [row] = await getDb()
      .select()
      .from(npAgentPrincipals)
      .where(
        and(
          eq(npAgentPrincipals.siteId, siteId),
          eq(npAgentPrincipals.id, principalId),
          eq(npAgentPrincipals.kind, "external"),
        ),
      )
      .limit(1);
    return row ? principalProjection(row) : null;
  }

  async function listServiceTokens(
    siteId: string,
    principalId: string,
    limit = 100,
  ): Promise<NpAgentServiceTokenV1[]> {
    if (!npIsCanonicalSiteId(siteId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new NpAgentGatewayError("INVALID_LIST_REQUEST", 400, "List request is invalid.");
    }
    const rows = await getDb()
      .select()
      .from(npAgentServiceTokens)
      .where(
        and(
          eq(npAgentServiceTokens.siteId, siteId),
          eq(npAgentServiceTokens.principalId, principalId),
        ),
      )
      .orderBy(asc(npAgentServiceTokens.createdAt), asc(npAgentServiceTokens.id))
      .limit(limit);
    return rows.map(tokenProjection);
  }

  async function getServiceToken(
    siteId: string,
    principalId: string,
    tokenId: string,
  ): Promise<NpAgentServiceTokenV1 | null> {
    if (
      !npIsCanonicalSiteId(siteId) ||
      !isCanonicalUuid(principalId) ||
      !isCanonicalUuid(tokenId)
    ) {
      throw new NpAgentGatewayError("INVALID_READ_REQUEST", 400, "Read request is invalid.");
    }
    const [row] = await getDb()
      .select()
      .from(npAgentServiceTokens)
      .where(
        and(
          eq(npAgentServiceTokens.siteId, siteId),
          eq(npAgentServiceTokens.principalId, principalId),
          eq(npAgentServiceTokens.id, tokenId),
        ),
      )
      .limit(1);
    return row ? tokenProjection(row) : null;
  }

  async function authenticateServiceToken(input: {
    siteId: string;
    credential: unknown;
    transport: NpAgentServiceTokenTransportV1;
    audience: string;
  }): Promise<NpAgentAuthenticatedServicePrincipalV1> {
    const parsed = npParseAgentOpaqueVerifierV1("service-token", input.credential);
    if (!npIsCanonicalSiteId(input.siteId) || !parsed) {
      throw new NpAgentGatewayError("SERVICE_TOKEN_INVALID", 401, "Service credential is invalid.");
    }
    const db = getDb();
    return db.transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const now = nowFn();
      const [token] = await tx
        .select()
        .from(npAgentServiceTokens)
        .where(
          and(
            eq(npAgentServiceTokens.siteId, input.siteId),
            eq(npAgentServiceTokens.id, parsed.publicId),
          ),
        )
        .for("update")
        .limit(1);
      if (!token || !isActiveTokenAt(token, now)) {
        throw new NpAgentGatewayError(
          "SERVICE_TOKEN_INVALID",
          401,
          "Service credential is invalid.",
        );
      }
      const [principal] = await tx
        .select()
        .from(npAgentPrincipals)
        .where(
          and(
            eq(npAgentPrincipals.siteId, token.siteId),
            eq(npAgentPrincipals.id, token.principalId),
            eq(npAgentPrincipals.kind, "external"),
          ),
        )
        .for("update")
        .limit(1);
      const verified = npVerifyAgentOpaqueVerifierV1({
        purpose: "service-token",
        siteId: input.siteId,
        publicId: token.id,
        secret: parsed.secret,
        storedVerifier: token.tokenHash,
        storedHashKeyId: token.hashKeyId,
        keyring: tokenHashKeyring,
      });
      if (
        !verified ||
        !principal ||
        principal.status !== "active" ||
        principal.authorityUserId === null ||
        token.principalTokenVersion !== principal.tokenVersion ||
        token.transport !== input.transport ||
        token.audience !== input.audience ||
        token.audience !== (await audienceFor(input.siteId, input.transport)) ||
        token.scopes.some((scope) => !principal.scopes.includes(scope))
      ) {
        throw new NpAgentGatewayError(
          "SERVICE_TOKEN_INVALID",
          401,
          "Service credential is invalid.",
        );
      }
      await requireExposure(
        input.siteId,
        input.transport,
        token.exposureMode as NpAgentEnabledGatewayExposureMode,
      );
      const actorFingerprint = sha256Canonical("np.agent-principal-actor.v1", {
        siteId: input.siteId,
        principalId: principal.id,
      });
      const authorizationContext = npRequireAgentAuthorizationContextCanonical({
        schemaVersion: "np.agent-authorization-context.v1",
        siteId: input.siteId,
        actor: { kind: "principal", principalId: principal.id, actorFingerprint },
        transport: transportForAuthorization(input.transport),
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
      const authorizationContextFingerprint =
        await npDigestAgentAuthorizationContextCanonical(authorizationContext);
      const [used] = await tx
        .update(npAgentServiceTokens)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(npAgentServiceTokens.siteId, token.siteId),
            eq(npAgentServiceTokens.id, token.id),
            or(
              eq(npAgentServiceTokens.status, "active_head"),
              and(
                eq(npAgentServiceTokens.status, "overlap"),
                gt(npAgentServiceTokens.overlapExpiresAt, now),
              ),
            ),
            gt(npAgentServiceTokens.expiresAt, now),
          ),
        )
        .returning();
      if (!used) {
        throw new NpAgentGatewayError(
          "SERVICE_TOKEN_INVALID",
          401,
          "Service credential is invalid.",
        );
      }
      return {
        principal: principalProjection(principal),
        serviceToken: tokenProjection(used),
        scopes: token.scopes as NpAgentScope[],
        authorizationContext,
        authorizationContextFingerprint,
      };
    });
  }

  /**
   * Stdio has no trusted request host or caller-supplied site selector. Resolve
   * the globally unique public token id first, then run the normal
   * site/audience/transport verifier. The second transaction repeats every
   * live row and exposure check, so the lookup cannot grant authority or race
   * a rotation/revocation.
   */
  async function authenticateStdioServiceToken(input: {
    credential: unknown;
  }): Promise<NpAgentAuthenticatedServicePrincipalV1> {
    const parsed = npParseAgentOpaqueVerifierV1("service-token", input.credential);
    if (!parsed) {
      throw new NpAgentGatewayError("SERVICE_TOKEN_INVALID", 401, "Service credential is invalid.");
    }
    const [token] = await getDb()
      .select({ siteId: npAgentServiceTokens.siteId })
      .from(npAgentServiceTokens)
      .where(eq(npAgentServiceTokens.id, parsed.publicId))
      .limit(1);
    if (!token) {
      throw new NpAgentGatewayError("SERVICE_TOKEN_INVALID", 401, "Service credential is invalid.");
    }
    return authenticateServiceToken({
      siteId: token.siteId,
      credential: input.credential,
      transport: "stdio",
      audience: "urn:nexpress:agent-gateway:stdio",
    });
  }

  /**
   * Contain a staff-authority deletion before the user row is removed. The
   * immutable fingerprint remains, while every affected principal and live
   * service credential loses authority in the same serializable transaction.
   */
  async function containUserAuthorityLoss(userId: string): Promise<{ principalIds: string[] }> {
    if (!isCanonicalUuid(userId)) {
      throw new NpAgentGatewayError("INVALID_USER", 400, "User id is not canonical.");
    }
    const db = getDb();
    return db.transaction(
      async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        const now = nowFn();
        const principals = await tx
          .select()
          .from(npAgentPrincipals)
          .where(
            and(
              eq(npAgentPrincipals.kind, "external"),
              eq(npAgentPrincipals.authorityKind, "user"),
              eq(npAgentPrincipals.authorityUserId, userId),
            ),
          )
          .orderBy(asc(npAgentPrincipals.siteId), asc(npAgentPrincipals.id))
          .for("update");
        for (const principal of principals) {
          const [contained] = await tx
            .update(npAgentPrincipals)
            .set({
              status: principal.status === "active" ? "suspended" : principal.status,
              authorityUserId: null,
              authorityDeletedAt: now,
              rowVersion: principal.rowVersion + 1,
              tokenVersion: principal.tokenVersion + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(npAgentPrincipals.siteId, principal.siteId),
                eq(npAgentPrincipals.id, principal.id),
                eq(npAgentPrincipals.rowVersion, principal.rowVersion),
                eq(npAgentPrincipals.authorityUserId, userId),
              ),
            )
            .returning({ id: npAgentPrincipals.id });
          if (!contained) {
            throw new NpAgentGatewayError(
              "AUTHORITY_CONTAINMENT_CONFLICT",
              409,
              "Principal authority changed during containment.",
            );
          }
          await tx
            .update(npAgentServiceTokens)
            .set({
              status: "revoked",
              overlapExpiresAt: null,
              revokedAt: now,
              rowVersion: sql`${npAgentServiceTokens.rowVersion} + 1`,
            })
            .where(
              and(
                eq(npAgentServiceTokens.siteId, principal.siteId),
                eq(npAgentServiceTokens.principalId, principal.id),
                inArray(npAgentServiceTokens.status, ["active_head", "overlap"]),
              ),
            );
          await tx.insert(npAuditEvents).values({
            actorKind: "system",
            action: "agents.gateway.principals.authority_loss",
            targetType: "agent-principal",
            targetId: principal.id,
            siteId: principal.siteId,
            payload: {
              operationId: "agents.gateway.principals.authority_loss",
              outcome: "contained",
              siteId: principal.siteId,
              authorityFingerprint: principal.authorityFingerprint,
            },
            createdAt: now,
          });
        }
        return { principalIds: principals.map(({ id }) => id) };
      },
      { isolationLevel: "serializable" },
    );
  }

  return Object.freeze({
    executeAdmin,
    getEffectiveGatewaySettings,
    getTransportAudience: audienceFor,
    listPrincipals,
    getPrincipal,
    listServiceTokens,
    getServiceToken,
    authenticateServiceToken,
    authenticateStdioServiceToken,
    containUserAuthorityLoss,
  });
}

export type NpAgentGatewayServiceV1 = ReturnType<typeof createAgentGatewayServiceV1>;
export type NpAgentGatewayStaffActorV1 = { user: NpAuthUser; sessionId: string };
