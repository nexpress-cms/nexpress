import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { canonicalRuntimeText } from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  npCanonicalAgentOauthRedirectUriV1,
  npAgentOauthClientTransportsV1,
  type NpAgentOauthClientTransportV1,
} from "./gateway-admin-contract.js";
import {
  npAgentScopes,
  type NpAgentContractResult,
  type NpAgentEnabledGatewayExposureMode,
} from "./types.js";

export const npAgentOauthGatewayModesV1 = ["read", "propose", "approved-execute"] as const;

export const npAgentOauthLimitsV1 = Object.freeze({
  authorizationRequestSeconds: 10 * 60,
  authorizationCodeSeconds: 5 * 60,
  accessTokenSeconds: 10 * 60,
  refreshIdleSeconds: 7 * 24 * 60 * 60,
  refreshFamilySeconds: 30 * 24 * 60 * 60,
  clockSkewSeconds: 60,
  stateBytes: 1_024,
  clientIdBytes: 256,
  pkceVerifierBytes: 128,
  bearerBytes: 8_192,
} as const);

export interface NpAgentOauthClientV1 {
  schemaVersion: "np.agent-oauth-client.v1";
  id: string;
  siteId: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  transports: NpAgentOauthClientTransportV1[];
  status: "active" | "revoked";
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface NpAgentOauthProtectedResourceMetadataV1 {
  resource: string;
  authorization_servers: [string];
  scopes_supported: typeof npAgentScopes;
  bearer_methods_supported: ["header"];
}

export interface NpAgentOauthAuthorizationServerMetadataV1 {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
  response_types_supported: ["code"];
  grant_types_supported: ["authorization_code", "refresh_token"];
  code_challenge_methods_supported: ["S256"];
  token_endpoint_auth_methods_supported: ["none"];
  revocation_endpoint_auth_methods_supported: ["none"];
  scopes_supported: typeof npAgentScopes;
  nexpress_gateway_modes_supported: typeof npAgentOauthGatewayModesV1;
}

const OAUTH_CLIENT_STATUSES = new Set<string>(["active", "revoked"]);
const OAUTH_CLIENT_TRANSPORTS = new Set<string>(npAgentOauthClientTransportsV1);
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;

export function npCanonicalAgentOauthOriginV1(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== value.replace(/\/$/u, "")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function npAgentOauthResourceV1(origin: string): string {
  const canonical = npCanonicalAgentOauthOriginV1(origin);
  if (!canonical) throw new Error("Agent OAuth requires one canonical HTTPS origin.");
  return `${canonical}/api/mcp`;
}

export function npAgentOauthProtectedResourceMetadataV1(
  origin: string,
): NpAgentOauthProtectedResourceMetadataV1 {
  const canonical = npCanonicalAgentOauthOriginV1(origin);
  if (!canonical) throw new Error("Agent OAuth requires one canonical HTTPS origin.");
  return Object.freeze({
    resource: npAgentOauthResourceV1(canonical),
    authorization_servers: [canonical] as [string],
    scopes_supported: npAgentScopes,
    bearer_methods_supported: ["header"] as ["header"],
  });
}

export function npAgentOauthAuthorizationServerMetadataV1(
  origin: string,
): NpAgentOauthAuthorizationServerMetadataV1 {
  const canonical = npCanonicalAgentOauthOriginV1(origin);
  if (!canonical) throw new Error("Agent OAuth requires one canonical HTTPS origin.");
  return Object.freeze({
    issuer: canonical,
    authorization_endpoint: `${canonical}/api/agent-oauth/authorize`,
    token_endpoint: `${canonical}/api/agent-oauth/token`,
    revocation_endpoint: `${canonical}/api/agent-oauth/revoke`,
    jwks_uri: `${canonical}/api/agent-oauth/jwks`,
    response_types_supported: ["code"] as ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"] as [
      "authorization_code",
      "refresh_token",
    ],
    code_challenge_methods_supported: ["S256"] as ["S256"],
    token_endpoint_auth_methods_supported: ["none"] as ["none"],
    revocation_endpoint_auth_methods_supported: ["none"] as ["none"],
    scopes_supported: npAgentScopes,
    nexpress_gateway_modes_supported: npAgentOauthGatewayModesV1,
  });
}

function parseOauthClient(value: unknown): NpAgentOauthClientV1 {
  const path = "agent.oauthClient";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    [
      "clientId",
      "createdAt",
      "id",
      "name",
      "redirectUris",
      "revokedAt",
      "rowVersion",
      "schemaVersion",
      "siteId",
      "status",
      "transports",
      "updatedAt",
    ],
    [
      "clientId",
      "createdAt",
      "id",
      "name",
      "redirectUris",
      "revokedAt",
      "rowVersion",
      "schemaVersion",
      "siteId",
      "status",
      "transports",
      "updatedAt",
    ],
    state,
  );
  if (record.schemaVersion !== "np.agent-oauth-client.v1") {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, "must be np.agent-oauth-client.v1");
  }
  const redirects = canonicalBodyArray(record.redirectUris, `${path}.redirectUris`, 16, state).map(
    (item, index) => canonicalRuntimeText(item, `${path}.redirectUris[${index}]`, 2_048),
  );
  const transports = canonicalBodyArray(record.transports, `${path}.transports`, 2, state).map(
    (item, index) =>
      canonicalBodyEnum<NpAgentOauthClientTransportV1>(
        item,
        `${path}.transports[${index}]`,
        OAUTH_CLIENT_TRANSPORTS,
      ),
  );
  if (redirects.some((item) => !npCanonicalAgentOauthRedirectUriV1(item))) {
    failCanonicalBody(
      "invalid-field",
      `${path}.redirectUris`,
      "must contain only canonical HTTPS or explicit loopback HTTP URIs",
    );
  }
  if (
    redirects.length === 0 ||
    new Set(redirects).size !== redirects.length ||
    redirects.some((item, index) => index > 0 && redirects[index - 1] >= item) ||
    transports.length === 0 ||
    new Set(transports).size !== transports.length ||
    transports.some((item, index) => index > 0 && transports[index - 1] >= item)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      "redirects and transports must be non-empty, sorted, and unique",
    );
  }
  const status = canonicalBodyEnum<"active" | "revoked">(
    record.status,
    `${path}.status`,
    OAUTH_CLIENT_STATUSES,
  );
  const revokedAt =
    record.revokedAt === null ? null : canonicalBodyUtc(record.revokedAt, `${path}.revokedAt`);
  if ((status === "revoked") !== (revokedAt !== null)) {
    failCanonicalBody("invalid-field", `${path}.revokedAt`, "must match status");
  }
  return {
    schemaVersion: "np.agent-oauth-client.v1",
    id: canonicalBodyUuid(record.id, `${path}.id`),
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    clientId: canonicalRuntimeText(
      record.clientId,
      `${path}.clientId`,
      npAgentOauthLimitsV1.clientIdBytes,
    ),
    name: canonicalRuntimeText(record.name, `${path}.name`, 120, { requireTrimmed: true }),
    redirectUris: redirects,
    transports,
    status,
    rowVersion: canonicalBodyInteger(
      record.rowVersion,
      `${path}.rowVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    createdAt: canonicalBodyUtc(record.createdAt, `${path}.createdAt`),
    updatedAt: canonicalBodyUtc(record.updatedAt, `${path}.updatedAt`),
    revokedAt,
  };
}

export function npAnalyzeAgentOauthClientV1(
  value: unknown,
): NpAgentContractResult<NpAgentOauthClientV1> {
  return analyzeCanonicalBody("agent.oauthClient", () => parseOauthClient(value));
}

export function npRequireAgentOauthClientV1(value: unknown): NpAgentOauthClientV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentOauthClientV1(value),
    "Invalid Agent OAuth client",
  );
}

export type NpAgentOauthGatewayModeV1 = NpAgentEnabledGatewayExposureMode;
