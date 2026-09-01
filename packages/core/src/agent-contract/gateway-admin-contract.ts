import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeIdempotencyKey,
  canonicalRuntimeText,
  parseSortedScopes,
} from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import type {
  NpAgentContractResult,
  NpAgentEnabledGatewayExposureMode,
  NpAgentScope,
} from "./types.js";

export const npAgentGatewayAdminOperationIdsV1 = [
  "agents.gateway.oauth_clients.create",
  "agents.gateway.oauth_clients.revoke",
  "agents.gateway.principals.create",
  "agents.gateway.principals.update",
  "agents.gateway.principal_tokens.create",
  "agents.gateway.principal_tokens.rotate",
  "agents.gateway.principal_tokens.revoke",
  "agents.gateway.principals.suspend",
  "agents.gateway.principals.resume",
  "agents.gateway.principals.revoke",
] as const;

export type NpAgentGatewayAdminOperationIdV1 = (typeof npAgentGatewayAdminOperationIdsV1)[number];

export const npAgentServiceTokenTransportsV1 = ["stdio", "mcp-http", "agent-http"] as const;
export type NpAgentServiceTokenTransportV1 = (typeof npAgentServiceTokenTransportsV1)[number];

export const npAgentOauthClientTransportsV1 = ["agent-http", "mcp-http"] as const;
export type NpAgentOauthClientTransportV1 = (typeof npAgentOauthClientTransportsV1)[number];

export const npAgentServiceTokenLimits = {
  productionMaxLifetimeSeconds: 90 * 24 * 60 * 60,
  developmentMaxLifetimeSeconds: 365 * 24 * 60 * 60,
  rotationOverlapDefaultSeconds: 15 * 60,
  rotationOverlapMaxSeconds: 60 * 60,
} as const;

interface NpAgentAdminIdempotentInputV1 {
  idempotencyKey: string;
}

interface NpAgentAdminVersionedInputV1 extends NpAgentAdminIdempotentInputV1 {
  expectedVersion: number;
}

export interface NpAgentPrincipalCreateAdminInputV1 extends NpAgentAdminIdempotentInputV1 {
  name: string;
  description: string | null;
  scopes: NpAgentScope[];
}

export interface NpAgentOauthClientCreateAdminInputV1 extends NpAgentAdminIdempotentInputV1 {
  name: string;
  redirectUris: string[];
  transports: NpAgentOauthClientTransportV1[];
}

export interface NpAgentPrincipalUpdateAdminInputV1 extends NpAgentAdminVersionedInputV1 {
  name: string;
  description: string | null;
  scopes: NpAgentScope[];
}

export interface NpAgentServiceTokenCreateAdminInputV1 extends NpAgentAdminVersionedInputV1 {
  name: string;
  scopes: NpAgentScope[];
  transport: NpAgentServiceTokenTransportV1;
  exposure: NpAgentEnabledGatewayExposureMode;
  expiresAt: string;
}

export interface NpAgentServiceTokenRotateAdminInputV1 extends NpAgentAdminVersionedInputV1 {
  overlapSeconds: number;
}

export interface NpAgentReasonAdminInputV1 extends NpAgentAdminVersionedInputV1 {
  reason: string;
}

export type NpAgentGatewayAdminInputV1 =
  | NpAgentOauthClientCreateAdminInputV1
  | NpAgentPrincipalCreateAdminInputV1
  | NpAgentPrincipalUpdateAdminInputV1
  | NpAgentServiceTokenCreateAdminInputV1
  | NpAgentServiceTokenRotateAdminInputV1
  | NpAgentReasonAdminInputV1
  | NpAgentAdminVersionedInputV1;

export interface NpAgentGatewayAdminInputMapV1 {
  "agents.gateway.oauth_clients.create": NpAgentOauthClientCreateAdminInputV1;
  "agents.gateway.oauth_clients.revoke": NpAgentReasonAdminInputV1;
  "agents.gateway.principals.create": NpAgentPrincipalCreateAdminInputV1;
  "agents.gateway.principals.update": NpAgentPrincipalUpdateAdminInputV1;
  "agents.gateway.principal_tokens.create": NpAgentServiceTokenCreateAdminInputV1;
  "agents.gateway.principal_tokens.rotate": NpAgentServiceTokenRotateAdminInputV1;
  "agents.gateway.principal_tokens.revoke": NpAgentReasonAdminInputV1;
  "agents.gateway.principals.suspend": NpAgentReasonAdminInputV1;
  "agents.gateway.principals.resume": NpAgentAdminVersionedInputV1;
  "agents.gateway.principals.revoke": NpAgentReasonAdminInputV1;
}

const OPERATION_IDS = new Set<string>(npAgentGatewayAdminOperationIdsV1);
const TRANSPORTS = new Set<string>(npAgentServiceTokenTransportsV1);
const OAUTH_CLIENT_TRANSPORTS = new Set<string>(npAgentOauthClientTransportsV1);
const EXPOSURES = new Set<string>(["read", "propose", "approved-execute"]);
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;

function parseCommon(
  value: unknown,
  path: string,
  required: readonly string[],
  state: CanonicalBodyInspectionState,
): Record<string, unknown> {
  return canonicalBodyRecord(value, path, required, required, state);
}

function parseIdempotency(record: Record<string, unknown>, path: string): string {
  return canonicalRuntimeIdempotencyKey(record.idempotencyKey, `${path}.idempotencyKey`);
}

function parseExpectedVersion(record: Record<string, unknown>, path: string): number {
  return canonicalBodyInteger(
    record.expectedVersion,
    `${path}.expectedVersion`,
    1,
    SIGNED_32_BIT_MAXIMUM,
  );
}

function parseName(record: Record<string, unknown>, path: string): string {
  return canonicalRuntimeText(record.name, `${path}.name`, 120, { requireTrimmed: true });
}

function parseDescription(record: Record<string, unknown>, path: string): string | null {
  if (record.description === null) return null;
  return canonicalRuntimeText(record.description, `${path}.description`, 4_096, {
    allowEmpty: true,
    requireTrimmed: true,
  });
}

function parseScopes(
  record: Record<string, unknown>,
  path: string,
  state: CanonicalBodyInspectionState,
  requireSiteRead: boolean,
): NpAgentScope[] {
  const scopes = parseSortedScopes(record.scopes, `${path}.scopes`, state);
  if (scopes.length === 0) {
    failCanonicalBody("invalid-field", `${path}.scopes`, "must contain at least one scope");
  }
  if (requireSiteRead && !scopes.includes("site:read")) {
    failCanonicalBody("invalid-field", `${path}.scopes`, "must contain site:read");
  }
  return scopes;
}

function parseReason(record: Record<string, unknown>, path: string): string {
  return canonicalRuntimeText(record.reason, `${path}.reason`, 2_000, {
    allowEmpty: true,
    requireTrimmed: true,
  });
}

export function npCanonicalAgentOauthRedirectUriV1(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const loopback =
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]" ||
        parsed.hostname === "localhost");
    if (
      (parsed.protocol !== "https:" && !loopback) ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.href !== value
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function parseRedirectUris(
  record: Record<string, unknown>,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] {
  const values = canonicalBodyArray(record.redirectUris, `${path}.redirectUris`, 16, state);
  if (values.length === 0) {
    failCanonicalBody("invalid-field", `${path}.redirectUris`, "must contain at least one URI");
  }
  const redirects = values.map((value, index) => {
    const candidate = canonicalRuntimeText(value, `${path}.redirectUris[${index}]`, 2_048, {
      requireTrimmed: true,
    });
    if (!npCanonicalAgentOauthRedirectUriV1(candidate)) {
      failCanonicalBody(
        "invalid-field",
        `${path}.redirectUris[${index}]`,
        "must be canonical HTTPS or an explicit loopback HTTP URI without userinfo or fragment",
      );
    }
    return candidate;
  });
  if (
    new Set(redirects).size !== redirects.length ||
    redirects.some((value, index) => index > 0 && redirects[index - 1] >= value)
  ) {
    failCanonicalBody("invalid-field", `${path}.redirectUris`, "must be sorted and unique");
  }
  return redirects;
}

function parseOauthClientTransports(
  record: Record<string, unknown>,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentOauthClientTransportV1[] {
  const values = canonicalBodyArray(record.transports, `${path}.transports`, 2, state);
  if (values.length === 0) {
    failCanonicalBody("invalid-field", `${path}.transports`, "must contain at least one transport");
  }
  const transports = values.map((value, index) =>
    canonicalBodyEnum<NpAgentOauthClientTransportV1>(
      value,
      `${path}.transports[${index}]`,
      OAUTH_CLIENT_TRANSPORTS,
    ),
  );
  if (
    new Set(transports).size !== transports.length ||
    transports.some((value, index) => index > 0 && transports[index - 1] >= value)
  ) {
    failCanonicalBody("invalid-field", `${path}.transports`, "must be sorted and unique");
  }
  return transports;
}

function parseGatewayAdminInput(
  operationId: NpAgentGatewayAdminOperationIdV1,
  value: unknown,
): NpAgentGatewayAdminInputV1 {
  const path = `agent.gatewayAdmin.${operationId}`;
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  switch (operationId) {
    case "agents.gateway.oauth_clients.create": {
      const record = parseCommon(
        value,
        path,
        ["idempotencyKey", "name", "redirectUris", "transports"],
        state,
      );
      return {
        idempotencyKey: parseIdempotency(record, path),
        name: parseName(record, path),
        redirectUris: parseRedirectUris(record, path, state),
        transports: parseOauthClientTransports(record, path, state),
      };
    }
    case "agents.gateway.principals.create": {
      const record = parseCommon(
        value,
        path,
        ["description", "idempotencyKey", "name", "scopes"],
        state,
      );
      return {
        idempotencyKey: parseIdempotency(record, path),
        name: parseName(record, path),
        description: parseDescription(record, path),
        scopes: parseScopes(record, path, state, true),
      };
    }
    case "agents.gateway.principals.update": {
      const record = parseCommon(
        value,
        path,
        ["description", "expectedVersion", "idempotencyKey", "name", "scopes"],
        state,
      );
      return {
        idempotencyKey: parseIdempotency(record, path),
        expectedVersion: parseExpectedVersion(record, path),
        name: parseName(record, path),
        description: parseDescription(record, path),
        scopes: parseScopes(record, path, state, false),
      };
    }
    case "agents.gateway.principal_tokens.create": {
      const record = parseCommon(
        value,
        path,
        [
          "expectedVersion",
          "expiresAt",
          "exposure",
          "idempotencyKey",
          "name",
          "scopes",
          "transport",
        ],
        state,
      );
      return {
        idempotencyKey: parseIdempotency(record, path),
        expectedVersion: parseExpectedVersion(record, path),
        name: parseName(record, path),
        scopes: parseScopes(record, path, state, true),
        transport: canonicalBodyEnum<NpAgentServiceTokenTransportV1>(
          record.transport,
          `${path}.transport`,
          TRANSPORTS,
        ),
        exposure: canonicalBodyEnum<NpAgentEnabledGatewayExposureMode>(
          record.exposure,
          `${path}.exposure`,
          EXPOSURES,
        ),
        expiresAt: canonicalBodyUtc(record.expiresAt, `${path}.expiresAt`),
      };
    }
    case "agents.gateway.principal_tokens.rotate": {
      const record = parseCommon(
        value,
        path,
        ["expectedVersion", "idempotencyKey", "overlapSeconds"],
        state,
      );
      return {
        idempotencyKey: parseIdempotency(record, path),
        expectedVersion: parseExpectedVersion(record, path),
        overlapSeconds: canonicalBodyInteger(
          record.overlapSeconds,
          `${path}.overlapSeconds`,
          0,
          npAgentServiceTokenLimits.rotationOverlapMaxSeconds,
        ),
      };
    }
    case "agents.gateway.oauth_clients.revoke":
    case "agents.gateway.principal_tokens.revoke":
    case "agents.gateway.principals.suspend":
    case "agents.gateway.principals.revoke": {
      const record = parseCommon(
        value,
        path,
        ["expectedVersion", "idempotencyKey", "reason"],
        state,
      );
      return {
        idempotencyKey: parseIdempotency(record, path),
        expectedVersion: parseExpectedVersion(record, path),
        reason: parseReason(record, path),
      };
    }
    case "agents.gateway.principals.resume": {
      const record = parseCommon(value, path, ["expectedVersion", "idempotencyKey"], state);
      return {
        idempotencyKey: parseIdempotency(record, path),
        expectedVersion: parseExpectedVersion(record, path),
      };
    }
  }
}

export function npAnalyzeAgentGatewayAdminInputV1<I extends NpAgentGatewayAdminOperationIdV1>(
  operationId: I,
  value: unknown,
): NpAgentContractResult<NpAgentGatewayAdminInputMapV1[I]> {
  if (!OPERATION_IDS.has(operationId)) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.gatewayAdmin.operationId",
          message: "is not an AP-104 Gateway Admin operation",
        },
      ],
    };
  }
  return analyzeCanonicalBody(`agent.gatewayAdmin.${operationId}`, () =>
    parseGatewayAdminInput(operationId, value),
  ) as NpAgentContractResult<NpAgentGatewayAdminInputMapV1[I]>;
}

export function npRequireAgentGatewayAdminInputV1<I extends NpAgentGatewayAdminOperationIdV1>(
  operationId: I,
  value: unknown,
): NpAgentGatewayAdminInputMapV1[I] {
  return npRequireAgentContractResult(
    npAnalyzeAgentGatewayAdminInputV1(operationId, value),
    `Invalid ${operationId} input`,
  );
}
