import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { decodeProtectedHeader, exportJWK, jwtVerify, SignJWT, type JWK } from "jose";

import {
  npAgentOauthGatewayModesV1,
  npAgentOauthLimitsV1,
  npAgentOauthResourceV1,
  npAgentScopeStaffCapability,
  npDigestAgentAuthorizationContextCanonical,
  npRequireAgentAuthorizationContextCanonical,
  npRequireAgentOauthClientV1,
  npRequireAgentPrincipalV1,
  type NpAgentAuthorizationContextCanonicalV1,
  type NpAgentEnabledGatewayExposureMode,
  type NpAgentGatewayAdminOperationIdV1,
  type NpAgentJsonObject,
  type NpAgentOauthClientTransportV1,
  type NpAgentOauthClientV1,
  type NpAgentPrincipalV1,
  type NpAgentScope,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentOauthClients,
  npAgentOauthCodes,
  npAgentOauthGrants,
  npAgentOauthRefreshTokens,
  npAgentOauthRequests,
  npAgentPrincipals,
} from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";

import {
  createAgentAdminAdmissionV1,
  npResolveLiveAgentStaffAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
  type NpAgentAdminExecutionResultV1,
  type NpAgentStaffPrimaryReauthenticationVerifierV1,
} from "./admin-admission.js";
import type {
  NpAgentAuthenticatedServicePrincipalV1,
  NpAgentGatewayServiceV1,
} from "./gateway-service.js";
import {
  npMintAgentOpaqueVerifierV1,
  npParseAgentOpaqueVerifierV1,
  npVerifyAgentOpaqueVerifierV1,
  type NpAgentTokenHashKeyring,
} from "./opaque-verifier.js";

type NpAgentDb = ReturnType<typeof getDb>;
type OauthClientRow = typeof npAgentOauthClients.$inferSelect;
type OauthGrantRow = typeof npAgentOauthGrants.$inferSelect;
type PrincipalRow = typeof npAgentPrincipals.$inferSelect;

const UUID_PATTERN = new RegExp(npAuthUuidPattern, "u");
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const JTI_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const EXPOSURE_RANK = { read: 1, propose: 2, "approved-execute": 3 } as const;
const EXACT_ACCESS_CLAIMS = new Set([
  "aud",
  "client_id",
  "exp",
  "gateway_mode",
  "grant_id",
  "grant_version",
  "iat",
  "iss",
  "jti",
  "principal_version",
  "scope",
  "site_id",
  "sub",
]);

export interface NpAgentOauthSigningKeyV1 {
  kid: string;
  publicKey: CryptoKey;
}

export interface NpAgentOauthSigningKeyringV1 {
  active: NpAgentOauthSigningKeyV1 & { privateKey: CryptoKey };
  retiring?: readonly NpAgentOauthSigningKeyV1[];
}

export interface NpAgentOauthServiceOptionsV1 {
  gateway: NpAgentGatewayServiceV1;
  tokenHashKeyring: NpAgentTokenHashKeyring;
  signingKeyring: NpAgentOauthSigningKeyringV1;
  reauthentication?: NpAgentStaffPrimaryReauthenticationVerifierV1;
  now?: () => Date;
}

export interface NpAgentOauthAuthorizationRequestV1 {
  responseType: unknown;
  clientId: unknown;
  redirectUri: unknown;
  state: unknown;
  scope: unknown;
  resource: unknown;
  codeChallenge: unknown;
  codeChallengeMethod: unknown;
  gatewayMode?: unknown;
}

export interface NpAgentOauthConsentViewV1 {
  requestId: string;
  consentChallenge: string;
  siteId: string;
  client: NpAgentOauthClientV1;
  redirectUri: string;
  redirectHost: string;
  requestedScopes: NpAgentScope[];
  resource: string;
  gatewayMode: NpAgentEnabledGatewayExposureMode;
  expiresAt: string;
}

export interface NpAgentOauthRedirectV1 {
  redirectUri: string;
}

export interface NpAgentOauthTokenResponseV1 {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token: string;
}

export interface NpAgentAuthenticatedOauthPrincipalV1 {
  kind: "oauth";
  principal: NpAgentPrincipalV1;
  client: NpAgentOauthClientV1;
  grantId: string;
  scopes: NpAgentScope[];
  authorizationContext: NpAgentAuthorizationContextCanonicalV1;
  authorizationContextFingerprint: string;
}

export type NpAgentRemoteAuthenticationV1 =
  | NpAgentAuthenticatedOauthPrincipalV1
  | { kind: "service"; authentication: NpAgentAuthenticatedServicePrincipalV1 };

interface AccessClaims {
  iss: string;
  aud: string;
  sub: string;
  client_id: string;
  site_id: string;
  scope: string;
  gateway_mode: NpAgentEnabledGatewayExposureMode;
  grant_id: string;
  grant_version: number;
  principal_version: number;
  iat: number;
  exp: number;
  jti: string;
}

function cloneHashKeyring(value: NpAgentTokenHashKeyring): NpAgentTokenHashKeyring {
  return {
    active: { id: value.active.id, key: new Uint8Array(value.active.key) },
    previous: Object.fromEntries(
      Object.entries(value.previous ?? {}).map(([id, key]) => [id, new Uint8Array(key)]),
    ),
  };
}

function requireEcKey(key: CryptoKey, use: "private" | "public"): void {
  const algorithm = key.algorithm as { name?: string; namedCurve?: string };
  if (
    key.type !== use ||
    algorithm.name !== "ECDSA" ||
    algorithm.namedCurve !== "P-256" ||
    (use === "private" && !key.usages.includes("sign")) ||
    (use === "public" && !key.usages.includes("verify"))
  ) {
    throw new Error("Agent OAuth signing keys must be ES256 P-256 sign/verify keys.");
  }
}

function cloneSigningKeyring(value: NpAgentOauthSigningKeyringV1): NpAgentOauthSigningKeyringV1 {
  const retiring = [...(value.retiring ?? [])];
  const ids = [value.active.kid, ...retiring.map(({ kid }) => kid)];
  if (ids.some((kid) => !KID_PATTERN.test(kid)) || new Set(ids).size !== ids.length) {
    throw new Error("Agent OAuth signing key ids must be canonical and unique.");
  }
  requireEcKey(value.active.privateKey, "private");
  requireEcKey(value.active.publicKey, "public");
  for (const key of retiring) requireEcKey(key.publicKey, "public");
  return Object.freeze({
    active: Object.freeze({ ...value.active }),
    retiring: Object.freeze(retiring.map((key) => Object.freeze({ ...key }))),
  });
}

function sha256Canonical(domain: string, value: unknown): `cj1:sha256:${string}` {
  const hash = createHash("sha256");
  hash.update(`${domain}\0`, "utf8");
  hash.update(serializeAgentCanonicalJson(value), "utf8");
  return `cj1:sha256:${hash.digest("base64url")}`;
}

function asJsonObject<T extends object>(value: T): NpAgentJsonObject {
  return value as unknown as NpAgentJsonObject;
}

function oauthFailure(code = "invalid_grant", status = 400): NpAgentGatewayError {
  return new NpAgentGatewayError(code, status, "OAuth request was rejected.");
}

function requireAscii(value: unknown, maximum: number, code = "invalid_request"): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximum ||
    !/^[\x20-\x7E]+$/u.test(value)
  ) {
    throw oauthFailure(code);
  }
  return value;
}

function parseScopes(value: unknown): NpAgentScope[] {
  const text = requireAscii(value, 2_048, "invalid_scope");
  const scopes = text.split(" ");
  if (
    scopes.length === 0 ||
    scopes.length > 64 ||
    scopes.join(" ") !== text ||
    new Set(scopes).size !== scopes.length ||
    scopes.some(
      (scope, index) =>
        !(npAgentScopeStaffCapability as Record<string, unknown>)[scope] ||
        (index > 0 && scopes[index - 1] >= scope),
    ) ||
    !scopes.includes("site:read")
  ) {
    throw oauthFailure("invalid_scope");
  }
  return scopes as NpAgentScope[];
}

function parseScopeSelection(value: unknown): NpAgentScope[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 64 ||
    value.some((scope) => typeof scope !== "string")
  ) {
    throw oauthFailure("invalid_scope");
  }
  return parseScopes(value.join(" "));
}

function clientMetadata(row: OauthClientRow): { transports: NpAgentOauthClientTransportV1[] } {
  const metadata = row.metadata;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.keys(metadata).sort().join(",") !== "schemaVersion,transports" ||
    (metadata as { schemaVersion?: unknown }).schemaVersion !==
      "np.agent-oauth-client-metadata.v1" ||
    !Array.isArray((metadata as { transports?: unknown }).transports)
  ) {
    throw new NpAgentGatewayError("OAUTH_CLIENT_CORRUPT", 500, "OAuth client is unavailable.");
  }
  const transports = (metadata as { transports: unknown[] }).transports;
  if (
    transports.length < 1 ||
    transports.length > 2 ||
    transports.some(
      (item, index) =>
        !["agent-http", "mcp-http"].includes(String(item)) ||
        (index > 0 && String(transports[index - 1]) >= String(item)),
    )
  ) {
    throw new NpAgentGatewayError("OAUTH_CLIENT_CORRUPT", 500, "OAuth client is unavailable.");
  }
  return { transports: transports as NpAgentOauthClientTransportV1[] };
}

function clientProjection(row: OauthClientRow): NpAgentOauthClientV1 {
  return npRequireAgentOauthClientV1({
    schemaVersion: "np.agent-oauth-client.v1",
    id: row.id,
    siteId: row.siteId,
    clientId: row.clientId,
    name: row.name,
    redirectUris: row.redirectUris,
    transports: clientMetadata(row).transports,
    status: row.status,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}

function principalProjection(row: PrincipalRow): NpAgentPrincipalV1 {
  return npRequireAgentPrincipalV1({
    schemaVersion: "np.agent-principal.v1",
    id: row.id,
    siteId: row.siteId,
    kind: "external",
    name: row.name,
    description: row.description,
    status: row.status,
    scopes: row.scopes,
    authority: {
      kind: "user",
      userId: row.authorityUserId,
      fingerprint: row.authorityFingerprint,
      deletedAt: row.authorityDeletedAt?.toISOString() ?? null,
    },
    rowVersion: row.rowVersion,
    tokenVersion: row.tokenVersion,
    autonomy: null,
    gatewayExposureCeiling: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}

function appendRedirect(
  redirectUri: string,
  values: Readonly<Record<string, string>>,
): NpAgentOauthRedirectV1 {
  const redirect = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) redirect.searchParams.set(key, value);
  return { redirectUri: redirect.href };
}

function pkceMatches(verifier: unknown, challenge: string): boolean {
  return (
    typeof verifier === "string" &&
    PKCE_VERIFIER_PATTERN.test(verifier) &&
    createHash("sha256").update(verifier, "ascii").digest("base64url") === challenge
  );
}

function grantExpiresAt(now: Date): Date {
  return new Date(now.getTime() + npAgentOauthLimitsV1.refreshFamilySeconds * 1_000);
}

function refreshExpiresAt(now: Date, familyStartedAt: Date, grant: OauthGrantRow): Date {
  return new Date(
    Math.min(
      now.getTime() + npAgentOauthLimitsV1.refreshIdleSeconds * 1_000,
      familyStartedAt.getTime() + npAgentOauthLimitsV1.refreshFamilySeconds * 1_000,
      grant.expiresAt.getTime(),
    ),
  );
}

export function createAgentOauthServiceV1(options: NpAgentOauthServiceOptionsV1) {
  const nowFn = options.now ?? (() => new Date());
  const hashKeyring = cloneHashKeyring(options.tokenHashKeyring);
  const signingKeyring = cloneSigningKeyring(options.signingKeyring);
  const admit = createAgentAdminAdmissionV1({
    now: nowFn,
    reauthentication: options.reauthentication,
  });
  const verificationKeys = new Map<string, CryptoKey>([
    [signingKeyring.active.kid, signingKeyring.active.publicKey],
    ...(signingKeyring.retiring ?? []).map(({ kid, publicKey }) => [kid, publicKey] as const),
  ]);

  async function resourceFor(siteId: string): Promise<string> {
    const settings = await options.gateway.getEffectiveGatewaySettings(siteId);
    if (settings.mcpHttp === "disabled") {
      throw new NpAgentGatewayError("OAUTH_SURFACE_DISABLED", 404, "Not found.");
    }
    const resource = await options.gateway.getTransportAudience(siteId, "mcp-http");
    const origin = new URL(resource).origin;
    if (npAgentOauthResourceV1(origin) !== resource) {
      throw new NpAgentGatewayError("OAUTH_SURFACE_DISABLED", 404, "Not found.");
    }
    return resource;
  }

  async function originFor(siteId: string): Promise<string> {
    return new URL(await resourceFor(siteId)).origin;
  }

  async function assertStaffScopes(
    db: NpAgentDb,
    siteId: string,
    userId: string,
    scopes: readonly NpAgentScope[],
  ): Promise<void> {
    const authorization = await npResolveLiveAgentStaffAuthorizationV1(db, siteId, userId);
    if (
      scopes.some(
        (scope) =>
          !authorization.authority.capabilities.includes(npAgentScopeStaffCapability[scope]),
      )
    ) {
      throw new NpAgentGatewayError("OAUTH_SCOPE_DENIED", 403, "Requested scope is unavailable.");
    }
  }

  async function assertExposure(
    siteId: string,
    exposure: NpAgentEnabledGatewayExposureMode,
  ): Promise<void> {
    const settings = await options.gateway.getEffectiveGatewaySettings(siteId);
    if (
      settings.mcpHttp === "disabled" ||
      EXPOSURE_RANK[exposure] > EXPOSURE_RANK[settings.mcpHttp]
    ) {
      throw new NpAgentGatewayError("OAUTH_EXPOSURE_DENIED", 403, "Gateway mode is unavailable.");
    }
  }

  async function getJwks(siteId: string): Promise<{ keys: JWK[] }> {
    await resourceFor(siteId);
    const keys: JWK[] = [];
    for (const { kid, publicKey } of [signingKeyring.active, ...(signingKeyring.retiring ?? [])]) {
      const jwk = await exportJWK(publicKey);
      keys.push({ ...jwk, alg: "ES256", kid, use: "sig" });
    }
    return { keys };
  }

  async function executeAdmin<
    I extends Extract<
      NpAgentGatewayAdminOperationIdV1,
      "agents.gateway.oauth_clients.create" | "agents.gateway.oauth_clients.revoke"
    >,
  >(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    operationId: I;
    targetId: string | null;
    command: unknown;
  }): Promise<NpAgentAdminExecutionResultV1<NpAgentJsonObject>> {
    const create = input.operationId === "agents.gateway.oauth_clients.create";
    if (
      !npIsCanonicalSiteId(input.siteId) ||
      (create && input.targetId !== null) ||
      (!create && !UUID_PATTERN.test(input.targetId ?? ""))
    ) {
      throw new NpAgentGatewayError("INVALID_ADMIN_TARGET", 400, "OAuth client target is invalid.");
    }
    return admit({
      ...input,
      parentTargetId: null,
      mutate: async ({ db, now, command }) => {
        if (input.operationId === "agents.gateway.oauth_clients.create") {
          const value = command as {
            name: string;
            redirectUris: string[];
            transports: NpAgentOauthClientTransportV1[];
          };
          const id = randomUUID();
          const [row] = await db
            .insert(npAgentOauthClients)
            .values({
              id,
              siteId: input.siteId,
              clientId: id,
              name: value.name,
              redirectUris: value.redirectUris,
              metadata: {
                schemaVersion: "np.agent-oauth-client-metadata.v1",
                transports: value.transports,
              },
              registrationSource: "admin",
              status: "active",
              rowVersion: 1,
              createdByUserId: input.actor.user.id,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!row) throw new Error("Failed to create Agent OAuth client.");
          return { resourceId: row.id, output: asJsonObject(clientProjection(row)) };
        }
        const value = command as { expectedVersion: number };
        const [current] = await db
          .select()
          .from(npAgentOauthClients)
          .where(
            and(
              eq(npAgentOauthClients.siteId, input.siteId),
              eq(npAgentOauthClients.id, input.targetId ?? ""),
            ),
          )
          .for("update")
          .limit(1);
        if (!current || current.status !== "active") {
          throw new NpAgentGatewayError(
            "OAUTH_CLIENT_NOT_FOUND",
            404,
            "OAuth client is unavailable.",
          );
        }
        if (current.rowVersion !== value.expectedVersion) {
          throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "OAuth client version changed.");
        }
        const grants = await db
          .select()
          .from(npAgentOauthGrants)
          .where(
            and(
              eq(npAgentOauthGrants.siteId, current.siteId),
              eq(npAgentOauthGrants.clientId, current.id),
              eq(npAgentOauthGrants.status, "active"),
            ),
          )
          .for("update");
        const [row] = await db
          .update(npAgentOauthClients)
          .set({
            status: "revoked",
            rowVersion: current.rowVersion + 1,
            updatedAt: now,
            revokedAt: now,
          })
          .where(
            and(
              eq(npAgentOauthClients.siteId, current.siteId),
              eq(npAgentOauthClients.id, current.id),
              eq(npAgentOauthClients.rowVersion, current.rowVersion),
            ),
          )
          .returning();
        if (!row)
          throw new NpAgentGatewayError("VERSION_CONFLICT", 409, "OAuth client version changed.");
        if (grants.length > 0) {
          const grantIds = grants.map(({ id }) => id);
          const principalIds = grants.map(({ principalId }) => principalId);
          await db
            .update(npAgentOauthGrants)
            .set({
              status: "revoked",
              authorityVersion: sql`${npAgentOauthGrants.authorityVersion} + 1`,
              tokenVersion: sql`${npAgentOauthGrants.tokenVersion} + 1`,
              revokedAt: now,
            })
            .where(inArray(npAgentOauthGrants.id, grantIds));
          await db
            .update(npAgentOauthRefreshTokens)
            .set({ status: "revoked", revokedAt: now })
            .where(
              and(
                inArray(npAgentOauthRefreshTokens.grantId, grantIds),
                eq(npAgentOauthRefreshTokens.status, "active"),
              ),
            );
          await db
            .update(npAgentPrincipals)
            .set({
              status: "revoked",
              rowVersion: sql`${npAgentPrincipals.rowVersion} + 1`,
              tokenVersion: sql`${npAgentPrincipals.tokenVersion} + 1`,
              updatedAt: now,
              revokedAt: now,
            })
            .where(inArray(npAgentPrincipals.id, principalIds));
        }
        return { resourceId: row.id, output: asJsonObject(clientProjection(row)) };
      },
    });
  }

  async function listClients(siteId: string, limit = 100): Promise<NpAgentOauthClientV1[]> {
    if (!npIsCanonicalSiteId(siteId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new NpAgentGatewayError("INVALID_LIST_REQUEST", 400, "OAuth client list is invalid.");
    }
    const rows = await getDb()
      .select()
      .from(npAgentOauthClients)
      .where(eq(npAgentOauthClients.siteId, siteId))
      .orderBy(asc(npAgentOauthClients.createdAt), asc(npAgentOauthClients.id))
      .limit(limit);
    return rows.map(clientProjection);
  }

  async function startAuthorization(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    request: NpAgentOauthAuthorizationRequestV1;
  }): Promise<NpAgentOauthConsentViewV1> {
    if (!npIsCanonicalSiteId(input.siteId)) throw oauthFailure("invalid_request");
    const resource = await resourceFor(input.siteId);
    const request = input.request;
    if (request.responseType !== "code") {
      throw oauthFailure("unsupported_response_type");
    }
    if (request.codeChallengeMethod !== "S256") throw oauthFailure("invalid_request");
    const clientId = requireAscii(request.clientId, npAgentOauthLimitsV1.clientIdBytes);
    const redirectUri = requireAscii(request.redirectUri, 2_048);
    const state = requireAscii(request.state, npAgentOauthLimitsV1.stateBytes);
    const requestedResource = requireAscii(request.resource, 2_048);
    const codeChallenge = requireAscii(request.codeChallenge, 128);
    const scopes = parseScopes(request.scope);
    const gatewayMode = (request.gatewayMode ?? "read") as string;
    if (
      requestedResource !== resource ||
      !PKCE_CHALLENGE_PATTERN.test(codeChallenge) ||
      !npAgentOauthGatewayModesV1.includes(gatewayMode as NpAgentEnabledGatewayExposureMode)
    ) {
      throw oauthFailure("invalid_request");
    }
    await assertExposure(input.siteId, gatewayMode as NpAgentEnabledGatewayExposureMode);
    const db = getDb();
    await assertStaffScopes(db, input.siteId, input.actor.user.id, scopes);
    const [client] = await db
      .select()
      .from(npAgentOauthClients)
      .where(
        and(
          eq(npAgentOauthClients.siteId, input.siteId),
          eq(npAgentOauthClients.clientId, clientId),
          eq(npAgentOauthClients.status, "active"),
        ),
      )
      .limit(1);
    if (
      !client ||
      !client.redirectUris.includes(redirectUri) ||
      !clientMetadata(client).transports.includes("mcp-http")
    ) {
      throw oauthFailure("invalid_request");
    }
    const now = nowFn();
    const id = randomUUID();
    const consent = npMintAgentOpaqueVerifierV1({
      purpose: "oauth-consent",
      siteId: input.siteId,
      publicId: id,
      keyring: hashKeyring,
    });
    const expiresAt = new Date(
      now.getTime() + npAgentOauthLimitsV1.authorizationRequestSeconds * 1_000,
    );
    const [created] = await db
      .insert(npAgentOauthRequests)
      .values({
        id,
        siteId: input.siteId,
        clientId: client.id,
        staffUserId: input.actor.user.id,
        staffSessionId: input.actor.sessionId,
        redirectUri,
        clientState: state,
        requestedScopes: scopes,
        resource,
        exposureMode: gatewayMode,
        pkceMethod: "S256",
        pkceChallenge: codeChallenge,
        consentChallengeHash: consent.verifier,
        consentHashKeyId: consent.hashKeyId,
        status: "pending",
        createdAt: now,
        expiresAt,
      })
      .returning({ id: npAgentOauthRequests.id });
    if (!created) throw new Error("Failed to create OAuth authorization request.");
    return {
      requestId: id,
      consentChallenge: consent.value,
      siteId: input.siteId,
      client: clientProjection(client),
      redirectUri,
      redirectHost: new URL(redirectUri).host,
      requestedScopes: scopes,
      resource,
      gatewayMode: gatewayMode as NpAgentEnabledGatewayExposureMode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async function decideAuthorization(input: {
    siteId: string;
    actor: NpAgentAdminActorV1;
    consentChallenge: unknown;
    approve: boolean;
    scopes?: unknown;
    gatewayMode?: unknown;
  }): Promise<NpAgentOauthRedirectV1> {
    const parsed = npParseAgentOpaqueVerifierV1("oauth-consent", input.consentChallenge);
    if (!npIsCanonicalSiteId(input.siteId) || !parsed || typeof input.approve !== "boolean") {
      throw oauthFailure("invalid_request");
    }
    const db = getDb();
    return db.transaction(
      async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        const now = nowFn();
        const [request] = await tx
          .select()
          .from(npAgentOauthRequests)
          .where(
            and(
              eq(npAgentOauthRequests.siteId, input.siteId),
              eq(npAgentOauthRequests.id, parsed.publicId),
            ),
          )
          .for("update")
          .limit(1);
        if (
          !request ||
          request.status !== "pending" ||
          request.expiresAt <= now ||
          request.staffUserId !== input.actor.user.id ||
          request.staffSessionId !== input.actor.sessionId ||
          !npVerifyAgentOpaqueVerifierV1({
            purpose: "oauth-consent",
            siteId: input.siteId,
            publicId: request.id,
            secret: parsed.secret,
            storedVerifier: request.consentChallengeHash,
            storedHashKeyId: request.consentHashKeyId,
            keyring: hashKeyring,
          })
        ) {
          throw oauthFailure("invalid_request");
        }
        const [client] = await tx
          .select()
          .from(npAgentOauthClients)
          .where(
            and(
              eq(npAgentOauthClients.siteId, request.siteId),
              eq(npAgentOauthClients.id, request.clientId),
              eq(npAgentOauthClients.status, "active"),
            ),
          )
          .for("update")
          .limit(1);
        if (!client || !client.redirectUris.includes(request.redirectUri)) {
          throw oauthFailure("invalid_request");
        }
        if (!input.approve) {
          const [denied] = await tx
            .update(npAgentOauthRequests)
            .set({ status: "denied", deniedAt: now })
            .where(
              and(
                eq(npAgentOauthRequests.id, request.id),
                eq(npAgentOauthRequests.status, "pending"),
              ),
            )
            .returning({ id: npAgentOauthRequests.id });
          if (!denied) throw oauthFailure("invalid_request");
          return appendRedirect(request.redirectUri, {
            error: "access_denied",
            state: request.clientState,
          });
        }
        const scopes = parseScopeSelection(input.scopes);
        const gatewayMode = input.gatewayMode;
        if (
          typeof gatewayMode !== "string" ||
          !npAgentOauthGatewayModesV1.includes(gatewayMode as NpAgentEnabledGatewayExposureMode) ||
          EXPOSURE_RANK[gatewayMode as NpAgentEnabledGatewayExposureMode] >
            EXPOSURE_RANK[request.exposureMode as NpAgentEnabledGatewayExposureMode] ||
          scopes.some((scope) => !request.requestedScopes.includes(scope))
        ) {
          throw oauthFailure("invalid_scope");
        }
        await assertExposure(request.siteId, gatewayMode as NpAgentEnabledGatewayExposureMode);
        await assertStaffScopes(tx, request.siteId, input.actor.user.id, scopes);
        const scopeHash = sha256Canonical("np.agent-oauth-scope.v1", scopes);
        const prior = await tx
          .select()
          .from(npAgentOauthGrants)
          .where(
            and(
              eq(npAgentOauthGrants.siteId, request.siteId),
              eq(npAgentOauthGrants.clientId, request.clientId),
              eq(npAgentOauthGrants.staffUserId, input.actor.user.id),
              eq(npAgentOauthGrants.resource, request.resource),
              eq(npAgentOauthGrants.scopeHash, scopeHash),
              eq(npAgentOauthGrants.exposureMode, gatewayMode),
            ),
          )
          .orderBy(asc(npAgentOauthGrants.consentGeneration))
          .for("update");
        const active = prior.find(({ status }) => status === "active");
        if (active) {
          await tx
            .update(npAgentOauthGrants)
            .set({
              status: "revoked",
              authorityVersion: active.authorityVersion + 1,
              tokenVersion: active.tokenVersion + 1,
              revokedAt: now,
            })
            .where(
              and(eq(npAgentOauthGrants.id, active.id), eq(npAgentOauthGrants.status, "active")),
            );
          await tx
            .update(npAgentOauthRefreshTokens)
            .set({ status: "revoked", revokedAt: now })
            .where(
              and(
                eq(npAgentOauthRefreshTokens.grantId, active.id),
                eq(npAgentOauthRefreshTokens.status, "active"),
              ),
            );
          await tx
            .update(npAgentPrincipals)
            .set({
              status: "revoked",
              rowVersion: sql`${npAgentPrincipals.rowVersion} + 1`,
              tokenVersion: sql`${npAgentPrincipals.tokenVersion} + 1`,
              updatedAt: now,
              revokedAt: now,
            })
            .where(eq(npAgentPrincipals.id, active.principalId));
        }
        const principalId = randomUUID();
        const authorityFingerprint = sha256Canonical("np.agent-oauth-user-authority.v1", {
          siteId: request.siteId,
          userId: input.actor.user.id,
        });
        const [principal] = await tx
          .insert(npAgentPrincipals)
          .values({
            id: principalId,
            siteId: request.siteId,
            kind: "external",
            name: client.name,
            description: null,
            status: "active",
            scopes,
            authorityKind: "user",
            authorityUserId: input.actor.user.id,
            authorityFingerprint,
            rowVersion: 1,
            tokenVersion: 1,
            ownerUserId: input.actor.user.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!principal) throw new Error("Failed to create OAuth principal.");
        const grantId = randomUUID();
        const [grant] = await tx
          .insert(npAgentOauthGrants)
          .values({
            id: grantId,
            siteId: request.siteId,
            clientId: request.clientId,
            staffUserId: input.actor.user.id,
            principalId,
            scopes,
            scopeHash,
            exposureMode: gatewayMode,
            resource: request.resource,
            audience: request.resource,
            tokenVersion: 1,
            consentGeneration: (prior.at(-1)?.consentGeneration ?? 0) + 1,
            authorityVersion: 1,
            status: "active",
            createdAt: now,
            expiresAt: grantExpiresAt(now),
          })
          .returning();
        if (!grant) throw new Error("Failed to create OAuth grant.");
        const codeId = randomUUID();
        const code = npMintAgentOpaqueVerifierV1({
          purpose: "authorization-code",
          siteId: request.siteId,
          publicId: codeId,
          keyring: hashKeyring,
        });
        const codeExpiresAt = new Date(
          now.getTime() + npAgentOauthLimitsV1.authorizationCodeSeconds * 1_000,
        );
        await tx.insert(npAgentOauthCodes).values({
          id: codeId,
          siteId: request.siteId,
          requestId: request.id,
          grantId: grant.id,
          staffSessionId: request.staffSessionId,
          clientId: request.clientId,
          redirectUri: request.redirectUri,
          scopes,
          exposureMode: gatewayMode,
          resource: request.resource,
          pkceMethod: "S256",
          pkceChallenge: request.pkceChallenge,
          codeHash: code.verifier,
          hashKeyId: code.hashKeyId,
          status: "active",
          createdAt: now,
          expiresAt: codeExpiresAt,
        });
        const [authorized] = await tx
          .update(npAgentOauthRequests)
          .set({ status: "authorized", authorizedAt: now })
          .where(
            and(
              eq(npAgentOauthRequests.id, request.id),
              eq(npAgentOauthRequests.status, "pending"),
            ),
          )
          .returning({ id: npAgentOauthRequests.id });
        if (!authorized) throw oauthFailure("invalid_request");
        await tx.insert(npAuditEvents).values({
          actorKind: "staff",
          actorUserId: input.actor.user.id,
          action: "agents.gateway.oauth_grants.authorize",
          targetType: "agent-oauth-grant",
          targetId: grant.id,
          siteId: request.siteId,
          payload: {
            operationId: "agents.gateway.oauth_grants.authorize",
            outcome: "completed",
            clientId: client.clientId,
            scopes,
            exposureMode: gatewayMode,
            resource: request.resource,
          },
          createdAt: now,
        });
        return appendRedirect(request.redirectUri, {
          code: code.value,
          state: request.clientState,
        });
      },
      { isolationLevel: "serializable" },
    );
  }

  async function mintAccessToken(input: {
    grant: OauthGrantRow;
    client: OauthClientRow;
    principal: PrincipalRow;
    now: Date;
  }): Promise<{ token: string; claims: AccessClaims }> {
    const issuedAt = Math.floor(input.now.getTime() / 1_000);
    const claims: AccessClaims = {
      iss: new URL(input.grant.resource).origin,
      aud: input.grant.resource,
      sub: input.principal.id,
      client_id: input.client.clientId,
      site_id: input.grant.siteId,
      scope: input.grant.scopes.join(" "),
      gateway_mode: input.grant.exposureMode as NpAgentEnabledGatewayExposureMode,
      grant_id: input.grant.id,
      grant_version: input.grant.authorityVersion,
      principal_version: input.principal.tokenVersion,
      iat: issuedAt,
      exp: issuedAt + npAgentOauthLimitsV1.accessTokenSeconds,
      jti: randomBytes(16).toString("base64url"),
    };
    const token = await new SignJWT({
      client_id: claims.client_id,
      site_id: claims.site_id,
      scope: claims.scope,
      gateway_mode: claims.gateway_mode,
      grant_id: claims.grant_id,
      grant_version: claims.grant_version,
      principal_version: claims.principal_version,
    })
      .setProtectedHeader({ alg: "ES256", kid: signingKeyring.active.kid, typ: "at+jwt" })
      .setIssuer(claims.iss)
      .setAudience(claims.aud)
      .setSubject(claims.sub)
      .setIssuedAt(claims.iat)
      .setExpirationTime(claims.exp)
      .setJti(claims.jti)
      .sign(signingKeyring.active.privateKey);
    return { token, claims };
  }

  async function requireCurrentGrant(
    db: NpAgentDb,
    grant: OauthGrantRow,
    client: OauthClientRow,
    principal: PrincipalRow,
    now: Date,
  ): Promise<void> {
    if (
      grant.status !== "active" ||
      grant.expiresAt <= now ||
      client.status !== "active" ||
      principal.status !== "active" ||
      principal.authorityKind !== "user" ||
      principal.authorityUserId === null ||
      principal.authorityUserId !== grant.staffUserId ||
      principal.tokenVersion < 1 ||
      grant.audience !== grant.resource ||
      grant.resource !== (await resourceFor(grant.siteId)) ||
      grant.scopes.length !== principal.scopes.length ||
      grant.scopes.some((scope, index) => scope !== principal.scopes[index])
    ) {
      throw oauthFailure();
    }
    await assertExposure(grant.siteId, grant.exposureMode as NpAgentEnabledGatewayExposureMode);
    await assertStaffScopes(
      db,
      grant.siteId,
      principal.authorityUserId,
      grant.scopes as NpAgentScope[],
    );
  }

  async function exchangeAuthorizationCode(input: {
    siteId: string;
    clientId: unknown;
    code: unknown;
    redirectUri: unknown;
    codeVerifier: unknown;
    resource: unknown;
  }): Promise<NpAgentOauthTokenResponseV1> {
    const clientId = requireAscii(input.clientId, npAgentOauthLimitsV1.clientIdBytes);
    const redirectUri = requireAscii(input.redirectUri, 2_048);
    const resource = requireAscii(input.resource, 2_048);
    const parsed = npParseAgentOpaqueVerifierV1("authorization-code", input.code);
    if (
      !npIsCanonicalSiteId(input.siteId) ||
      !parsed ||
      resource !== (await resourceFor(input.siteId))
    ) {
      throw oauthFailure();
    }
    return getDb().transaction(
      async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        const now = nowFn();
        const [code] = await tx
          .select()
          .from(npAgentOauthCodes)
          .where(
            and(
              eq(npAgentOauthCodes.siteId, input.siteId),
              eq(npAgentOauthCodes.id, parsed.publicId),
            ),
          )
          .for("update")
          .limit(1);
        if (
          !code ||
          code.status !== "active" ||
          code.expiresAt <= now ||
          code.redirectUri !== redirectUri ||
          code.resource !== resource ||
          !pkceMatches(input.codeVerifier, code.pkceChallenge) ||
          !npVerifyAgentOpaqueVerifierV1({
            purpose: "authorization-code",
            siteId: input.siteId,
            publicId: code.id,
            secret: parsed.secret,
            storedVerifier: code.codeHash,
            storedHashKeyId: code.hashKeyId,
            keyring: hashKeyring,
          })
        ) {
          throw oauthFailure();
        }
        const [request] = await tx
          .select()
          .from(npAgentOauthRequests)
          .where(eq(npAgentOauthRequests.id, code.requestId))
          .for("update")
          .limit(1);
        const [grant] = await tx
          .select()
          .from(npAgentOauthGrants)
          .where(eq(npAgentOauthGrants.id, code.grantId))
          .for("update")
          .limit(1);
        const [client] = await tx
          .select()
          .from(npAgentOauthClients)
          .where(eq(npAgentOauthClients.id, code.clientId))
          .for("update")
          .limit(1);
        if (
          !request ||
          request.status !== "authorized" ||
          request.expiresAt <= now ||
          !grant ||
          !client ||
          client.clientId !== clientId ||
          request.clientId !== client.id ||
          grant.clientId !== client.id ||
          grant.staffUserId !== request.staffUserId ||
          code.staffSessionId !== request.staffSessionId ||
          code.redirectUri !== request.redirectUri ||
          code.resource !== request.resource ||
          grant.resource !== request.resource ||
          code.pkceMethod !== request.pkceMethod ||
          code.pkceChallenge !== request.pkceChallenge ||
          code.scopes.join(" ") !== grant.scopes.join(" ") ||
          code.exposureMode !== grant.exposureMode
        ) {
          throw oauthFailure();
        }
        const [principal] = await tx
          .select()
          .from(npAgentPrincipals)
          .where(
            and(
              eq(npAgentPrincipals.siteId, grant.siteId),
              eq(npAgentPrincipals.id, grant.principalId),
            ),
          )
          .for("update")
          .limit(1);
        if (!principal) throw oauthFailure();
        await requireCurrentGrant(tx, grant, client, principal, now);
        const refreshRowId = randomUUID();
        const tokenId = randomUUID();
        const familyId = randomUUID();
        const refresh = npMintAgentOpaqueVerifierV1({
          purpose: "refresh-token",
          siteId: grant.siteId,
          publicId: tokenId,
          keyring: hashKeyring,
        });
        await tx.insert(npAgentOauthRefreshTokens).values({
          id: refreshRowId,
          siteId: grant.siteId,
          grantId: grant.id,
          familyId,
          tokenId,
          tokenHash: refresh.verifier,
          hashKeyId: refresh.hashKeyId,
          grantAuthorityVersion: grant.authorityVersion,
          familyGeneration: 1,
          status: "active",
          createdAt: now,
          expiresAt: refreshExpiresAt(now, now, grant),
        });
        const [consumedCode] = await tx
          .update(npAgentOauthCodes)
          .set({ status: "consumed", consumedAt: now })
          .where(and(eq(npAgentOauthCodes.id, code.id), eq(npAgentOauthCodes.status, "active")))
          .returning({ id: npAgentOauthCodes.id });
        const [consumedRequest] = await tx
          .update(npAgentOauthRequests)
          .set({ status: "consumed", consumedAt: now })
          .where(
            and(
              eq(npAgentOauthRequests.id, request.id),
              eq(npAgentOauthRequests.status, "authorized"),
            ),
          )
          .returning({ id: npAgentOauthRequests.id });
        if (!consumedCode || !consumedRequest) throw oauthFailure();
        const access = await mintAccessToken({ grant, client, principal, now });
        return {
          access_token: access.token,
          token_type: "Bearer",
          expires_in: npAgentOauthLimitsV1.accessTokenSeconds,
          scope: grant.scopes.join(" "),
          refresh_token: refresh.value,
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  async function exchangeRefreshToken(input: {
    siteId: string;
    clientId: unknown;
    refreshToken: unknown;
    resource: unknown;
  }): Promise<NpAgentOauthTokenResponseV1> {
    const clientId = requireAscii(input.clientId, npAgentOauthLimitsV1.clientIdBytes);
    const resource = requireAscii(input.resource, 2_048);
    const parsed = npParseAgentOpaqueVerifierV1("refresh-token", input.refreshToken);
    if (
      !npIsCanonicalSiteId(input.siteId) ||
      !parsed ||
      resource !== (await resourceFor(input.siteId))
    ) {
      throw oauthFailure();
    }
    const outcome = await getDb().transaction(
      async (rawTx) => {
        const tx = rawTx as NpAgentDb;
        const now = nowFn();
        const [current] = await tx
          .select()
          .from(npAgentOauthRefreshTokens)
          .where(
            and(
              eq(npAgentOauthRefreshTokens.siteId, input.siteId),
              eq(npAgentOauthRefreshTokens.tokenId, parsed.publicId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current) throw oauthFailure();
        if (
          !npVerifyAgentOpaqueVerifierV1({
            purpose: "refresh-token",
            siteId: input.siteId,
            publicId: current.tokenId,
            secret: parsed.secret,
            storedVerifier: current.tokenHash,
            storedHashKeyId: current.hashKeyId,
            keyring: hashKeyring,
          })
        ) {
          throw oauthFailure();
        }
        const family = await tx
          .select()
          .from(npAgentOauthRefreshTokens)
          .where(
            and(
              eq(npAgentOauthRefreshTokens.siteId, current.siteId),
              eq(npAgentOauthRefreshTokens.familyId, current.familyId),
            ),
          )
          .orderBy(asc(npAgentOauthRefreshTokens.familyGeneration))
          .for("update");
        if (current.status === "consumed") {
          await tx
            .update(npAgentOauthRefreshTokens)
            .set({ status: "revoked", revokedAt: now })
            .where(
              and(
                eq(npAgentOauthRefreshTokens.familyId, current.familyId),
                eq(npAgentOauthRefreshTokens.status, "active"),
              ),
            );
          await tx
            .update(npAgentOauthGrants)
            .set({
              authorityVersion: sql`${npAgentOauthGrants.authorityVersion} + 1`,
              tokenVersion: sql`${npAgentOauthGrants.tokenVersion} + 1`,
            })
            .where(eq(npAgentOauthGrants.id, current.grantId));
          return { replay: true as const };
        }
        if (current.status !== "active" || current.expiresAt <= now) {
          throw oauthFailure();
        }
        const [grant] = await tx
          .select()
          .from(npAgentOauthGrants)
          .where(eq(npAgentOauthGrants.id, current.grantId))
          .for("update")
          .limit(1);
        const [client] = await tx
          .select()
          .from(npAgentOauthClients)
          .where(eq(npAgentOauthClients.clientId, clientId))
          .for("update")
          .limit(1);
        if (
          !grant ||
          !client ||
          client.siteId !== input.siteId ||
          grant.clientId !== client.id ||
          grant.resource !== resource ||
          current.grantAuthorityVersion !== grant.authorityVersion
        ) {
          throw oauthFailure();
        }
        const [principal] = await tx
          .select()
          .from(npAgentPrincipals)
          .where(eq(npAgentPrincipals.id, grant.principalId))
          .for("update")
          .limit(1);
        if (!principal) throw oauthFailure();
        await requireCurrentGrant(tx, grant, client, principal, now);
        const nextRowId = randomUUID();
        const nextTokenId = randomUUID();
        const replacement = npMintAgentOpaqueVerifierV1({
          purpose: "refresh-token",
          siteId: grant.siteId,
          publicId: nextTokenId,
          keyring: hashKeyring,
        });
        const familyStartedAt = family[0]?.createdAt;
        if (!familyStartedAt) throw oauthFailure();
        const expiry = refreshExpiresAt(now, familyStartedAt, grant);
        if (expiry <= now) throw oauthFailure();
        const [consumed] = await tx
          .update(npAgentOauthRefreshTokens)
          .set({ status: "consumed", consumedAt: now })
          .where(
            and(
              eq(npAgentOauthRefreshTokens.id, current.id),
              eq(npAgentOauthRefreshTokens.status, "active"),
            ),
          )
          .returning({ id: npAgentOauthRefreshTokens.id });
        if (!consumed) throw oauthFailure();
        await tx.insert(npAgentOauthRefreshTokens).values({
          id: nextRowId,
          siteId: grant.siteId,
          grantId: grant.id,
          familyId: current.familyId,
          tokenId: nextTokenId,
          parentTokenId: current.tokenId,
          tokenHash: replacement.verifier,
          hashKeyId: replacement.hashKeyId,
          grantAuthorityVersion: grant.authorityVersion,
          familyGeneration: current.familyGeneration + 1,
          status: "active",
          createdAt: now,
          expiresAt: expiry,
        });
        const [linked] = await tx
          .update(npAgentOauthRefreshTokens)
          .set({ replacementTokenId: nextTokenId })
          .where(
            and(
              eq(npAgentOauthRefreshTokens.id, current.id),
              eq(npAgentOauthRefreshTokens.status, "consumed"),
              eq(npAgentOauthRefreshTokens.consumedAt, now),
            ),
          )
          .returning({ id: npAgentOauthRefreshTokens.id });
        if (!linked) throw oauthFailure();
        const access = await mintAccessToken({ grant, client, principal, now });
        return {
          replay: false as const,
          response: {
            access_token: access.token,
            token_type: "Bearer" as const,
            expires_in: npAgentOauthLimitsV1.accessTokenSeconds,
            scope: grant.scopes.join(" "),
            refresh_token: replacement.value,
          },
        };
      },
      { isolationLevel: "serializable" },
    );
    if (outcome.replay) throw oauthFailure();
    return outcome.response;
  }

  function exactAccessClaims(payload: Record<string, unknown>): AccessClaims {
    if (
      Object.keys(payload).length !== EXACT_ACCESS_CLAIMS.size ||
      Object.keys(payload).some((key) => !EXACT_ACCESS_CLAIMS.has(key)) ||
      typeof payload.iss !== "string" ||
      typeof payload.aud !== "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.client_id !== "string" ||
      typeof payload.site_id !== "string" ||
      typeof payload.scope !== "string" ||
      typeof payload.gateway_mode !== "string" ||
      typeof payload.grant_id !== "string" ||
      !Number.isSafeInteger(payload.grant_version) ||
      !Number.isSafeInteger(payload.principal_version) ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      typeof payload.jti !== "string" ||
      !JTI_PATTERN.test(payload.jti) ||
      !UUID_PATTERN.test(payload.sub) ||
      !UUID_PATTERN.test(payload.grant_id) ||
      !npIsCanonicalSiteId(payload.site_id) ||
      !npAgentOauthGatewayModesV1.includes(
        payload.gateway_mode as NpAgentEnabledGatewayExposureMode,
      ) ||
      (payload.grant_version as number) < 1 ||
      (payload.principal_version as number) < 1 ||
      (payload.exp as number) <= (payload.iat as number) ||
      (payload.exp as number) - (payload.iat as number) > npAgentOauthLimitsV1.accessTokenSeconds
    ) {
      throw oauthFailure("invalid_token", 401);
    }
    try {
      parseScopes(payload.scope);
    } catch {
      throw oauthFailure("invalid_token", 401);
    }
    return payload as unknown as AccessClaims;
  }

  async function authenticateOauthAccessToken(input: {
    siteId: string;
    token: unknown;
  }): Promise<NpAgentAuthenticatedOauthPrincipalV1> {
    if (
      !npIsCanonicalSiteId(input.siteId) ||
      typeof input.token !== "string" ||
      input.token.length > npAgentOauthLimitsV1.bearerBytes ||
      input.token.split(".").length !== 3
    ) {
      throw oauthFailure("invalid_token", 401);
    }
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(input.token);
    } catch {
      throw oauthFailure("invalid_token", 401);
    }
    if (
      Object.keys(header).sort().join(",") !== "alg,kid,typ" ||
      header.alg !== "ES256" ||
      header.typ !== "at+jwt" ||
      typeof header.kid !== "string"
    ) {
      throw oauthFailure("invalid_token", 401);
    }
    const key = verificationKeys.get(header.kid);
    if (!key) throw oauthFailure("invalid_token", 401);
    const resource = await resourceFor(input.siteId);
    const now = nowFn();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(input.token, key, {
        algorithms: ["ES256"],
        issuer: new URL(resource).origin,
        audience: resource,
        clockTolerance: npAgentOauthLimitsV1.clockSkewSeconds,
        currentDate: now,
        typ: "at+jwt",
      });
      payload = verified.payload;
    } catch {
      throw oauthFailure("invalid_token", 401);
    }
    const claims = exactAccessClaims(payload);
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (
      claims.site_id !== input.siteId ||
      claims.iss !== new URL(resource).origin ||
      claims.aud !== resource ||
      claims.iat > nowSeconds + npAgentOauthLimitsV1.clockSkewSeconds ||
      claims.exp <= nowSeconds - npAgentOauthLimitsV1.clockSkewSeconds
    ) {
      throw oauthFailure("invalid_token", 401);
    }
    const db = getDb();
    const [[grant], [client], [principal]] = await Promise.all([
      db
        .select()
        .from(npAgentOauthGrants)
        .where(
          and(
            eq(npAgentOauthGrants.siteId, input.siteId),
            eq(npAgentOauthGrants.id, claims.grant_id),
          ),
        )
        .limit(1),
      db
        .select()
        .from(npAgentOauthClients)
        .where(
          and(
            eq(npAgentOauthClients.siteId, input.siteId),
            eq(npAgentOauthClients.clientId, claims.client_id),
          ),
        )
        .limit(1),
      db
        .select()
        .from(npAgentPrincipals)
        .where(
          and(eq(npAgentPrincipals.siteId, input.siteId), eq(npAgentPrincipals.id, claims.sub)),
        )
        .limit(1),
    ]);
    if (
      !grant ||
      !client ||
      !principal ||
      grant.clientId !== client.id ||
      grant.principalId !== principal.id ||
      grant.authorityVersion !== claims.grant_version ||
      principal.tokenVersion !== claims.principal_version ||
      grant.exposureMode !== claims.gateway_mode ||
      grant.scopes.join(" ") !== claims.scope
    ) {
      throw oauthFailure("invalid_token", 401);
    }
    await requireCurrentGrant(db, grant, client, principal, now);
    const actorFingerprint = sha256Canonical("np.agent-principal-actor.v1", {
      siteId: input.siteId,
      principalId: principal.id,
    });
    const authorizationContext = npRequireAgentAuthorizationContextCanonical({
      schemaVersion: "np.agent-authorization-context.v1",
      siteId: input.siteId,
      actor: { kind: "principal", principalId: principal.id, actorFingerprint },
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
    return {
      kind: "oauth",
      principal: principalProjection(principal),
      client: clientProjection(client),
      grantId: grant.id,
      scopes: grant.scopes as NpAgentScope[],
      authorizationContext,
      authorizationContextFingerprint:
        await npDigestAgentAuthorizationContextCanonical(authorizationContext),
    };
  }

  async function authenticateRemoteBearer(input: {
    siteId: string;
    authorization: unknown;
  }): Promise<NpAgentRemoteAuthenticationV1> {
    if (
      typeof input.authorization !== "string" ||
      input.authorization.length > npAgentOauthLimitsV1.bearerBytes
    ) {
      throw oauthFailure("invalid_token", 401);
    }
    const match = /^Bearer ([\x21-\x7E]+)$/iu.exec(input.authorization);
    if (!match || match[1].includes(",")) throw oauthFailure("invalid_token", 401);
    const token = match[1];
    const resource = await resourceFor(input.siteId);
    if (token.startsWith("npst1_")) {
      return {
        kind: "service",
        authentication: await options.gateway.authenticateServiceToken({
          siteId: input.siteId,
          credential: token,
          transport: "mcp-http",
          audience: resource,
        }),
      };
    }
    if (token.split(".").length === 3) {
      return authenticateOauthAccessToken({ siteId: input.siteId, token });
    }
    throw oauthFailure("invalid_token", 401);
  }

  async function revokeToken(input: {
    siteId: string;
    clientId: unknown;
    token: unknown;
  }): Promise<void> {
    if (!npIsCanonicalSiteId(input.siteId)) return;
    let clientId: string;
    try {
      clientId = requireAscii(input.clientId, npAgentOauthLimitsV1.clientIdBytes);
    } catch {
      return;
    }
    const parsed = npParseAgentOpaqueVerifierV1("refresh-token", input.token);
    if (!parsed) return;
    await getDb().transaction(async (rawTx) => {
      const tx = rawTx as NpAgentDb;
      const now = nowFn();
      const [refresh] = await tx
        .select()
        .from(npAgentOauthRefreshTokens)
        .where(
          and(
            eq(npAgentOauthRefreshTokens.siteId, input.siteId),
            eq(npAgentOauthRefreshTokens.tokenId, parsed.publicId),
          ),
        )
        .for("update")
        .limit(1);
      if (!refresh) return;
      const [grant] = await tx
        .select()
        .from(npAgentOauthGrants)
        .where(eq(npAgentOauthGrants.id, refresh.grantId))
        .for("update")
        .limit(1);
      const [client] = await tx
        .select()
        .from(npAgentOauthClients)
        .where(eq(npAgentOauthClients.clientId, clientId))
        .for("update")
        .limit(1);
      if (
        !grant ||
        !client ||
        grant.clientId !== client.id ||
        !npVerifyAgentOpaqueVerifierV1({
          purpose: "refresh-token",
          siteId: input.siteId,
          publicId: refresh.tokenId,
          secret: parsed.secret,
          storedVerifier: refresh.tokenHash,
          storedHashKeyId: refresh.hashKeyId,
          keyring: hashKeyring,
        })
      ) {
        return;
      }
      await tx
        .update(npAgentOauthRefreshTokens)
        .set({ status: "revoked", revokedAt: now })
        .where(
          and(
            eq(npAgentOauthRefreshTokens.familyId, refresh.familyId),
            eq(npAgentOauthRefreshTokens.status, "active"),
          ),
        );
      await tx
        .update(npAgentOauthGrants)
        .set({
          status: "revoked",
          authorityVersion: grant.authorityVersion + 1,
          tokenVersion: grant.tokenVersion + 1,
          revokedAt: now,
        })
        .where(and(eq(npAgentOauthGrants.id, grant.id), eq(npAgentOauthGrants.status, "active")));
    });
  }

  return Object.freeze({
    executeAdmin,
    listClients,
    resourceFor,
    originFor,
    getJwks,
    startAuthorization,
    decideAuthorization,
    exchangeAuthorizationCode,
    exchangeRefreshToken,
    authenticateOauthAccessToken,
    authenticateRemoteBearer,
    revokeToken,
  });
}

export type NpAgentOauthServiceV1 = ReturnType<typeof createAgentOauthServiceV1>;
