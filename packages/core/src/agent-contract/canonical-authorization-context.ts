import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import type {
  NpAgentAuthorizationContextCanonicalV1,
  NpAgentCanonicalBodyBytesV1,
  NpAgentContractResult,
  NpAgentEnabledGatewayExposureMode,
  NpAgentInvocationAuthorityRefV1,
} from "./types.js";

const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const ACTOR_KINDS = new Set<string>(["principal", "staff"]);
const AUTHORITY_KINDS = new Set<string>([
  "staff-session",
  "service-family",
  "oauth-grant",
  "runtime-run",
]);
const TRANSPORTS = new Set<string>([
  "mcp-oauth",
  "mcp-service",
  "stdio",
  "agent-api",
  "runtime",
  "admin",
]);
const ENABLED_EXPOSURES = new Set<string>(["read", "propose", "approved-execute"]);

export const npAgentAuthorizationContextCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "actor",
  "transport",
  "gatewayExposure",
  "authorityRef",
] as const satisfies readonly (keyof NpAgentAuthorizationContextCanonicalV1)[];

export const npAgentAuthorizationContextCanonicalExcludedKeysV1 = [
  "authorizationContextFingerprint",
  "requestHash",
  "invocationId",
  "idempotencyKey",
  "state",
  "runId",
  "resultKind",
  "resultId",
  "outputRedacted",
  "outputHash",
  "auditEventId",
  "errorCode",
  "requestedAt",
  "completedAt",
  "expiresAt",
] as const;

export const npAgentAuthorizationContextCanonicalPrincipalActorIncludedKeysV1 = [
  "kind",
  "principalId",
  "actorFingerprint",
] as const satisfies readonly (keyof Extract<
  NpAgentAuthorizationContextCanonicalV1["actor"],
  { kind: "principal" }
>)[];

export const npAgentAuthorizationContextCanonicalStaffActorIncludedKeysV1 = [
  "kind",
  "userId",
  "actorFingerprint",
] as const satisfies readonly (keyof Extract<
  NpAgentAuthorizationContextCanonicalV1["actor"],
  { kind: "staff" }
>)[];

export const npAgentAuthorizationContextCanonicalStaffSessionIncludedKeysV1 = [
  "kind",
  "userId",
  "sessionId",
  "userTokenVersion",
  "siteAuthorizationDigest",
] as const satisfies readonly (keyof Extract<
  NpAgentInvocationAuthorityRefV1,
  { kind: "staff-session" }
>)[];

export const npAgentAuthorizationContextCanonicalServiceFamilyIncludedKeysV1 = [
  "kind",
  "principalId",
  "rotationFamilyId",
  "familyAuthorityVersion",
  "principalTokenVersion",
  "exposureMode",
  "audience",
] as const satisfies readonly (keyof Extract<
  NpAgentInvocationAuthorityRefV1,
  { kind: "service-family" }
>)[];

export const npAgentAuthorizationContextCanonicalOauthGrantIncludedKeysV1 = [
  "kind",
  "principalId",
  "clientId",
  "grantId",
  "grantVersion",
  "principalTokenVersion",
  "exposureMode",
  "audience",
] as const satisfies readonly (keyof Extract<
  NpAgentInvocationAuthorityRefV1,
  { kind: "oauth-grant" }
>)[];

export const npAgentAuthorizationContextCanonicalRuntimeRunIncludedKeysV1 = [
  "kind",
  "principalId",
  "runId",
  "agentVersionId",
  "deadlineAt",
] as const satisfies readonly (keyof Extract<
  NpAgentInvocationAuthorityRefV1,
  { kind: "runtime-run" }
>)[];

const ACTOR_KEYS = ["kind", "principalId", "userId", "actorFingerprint"] as const;
const AUTHORITY_KEYS = [
  "kind",
  "userId",
  "sessionId",
  "userTokenVersion",
  "siteAuthorizationDigest",
  "principalId",
  "rotationFamilyId",
  "familyAuthorityVersion",
  "principalTokenVersion",
  "exposureMode",
  "audience",
  "clientId",
  "grantId",
  "grantVersion",
  "runId",
  "agentVersionId",
  "deadlineAt",
] as const;

type AuthorizationTransport = NpAgentAuthorizationContextCanonicalV1["transport"];
type AuthorizationActor = NpAgentAuthorizationContextCanonicalV1["actor"];

interface ParsedAuthority {
  value: NpAgentInvocationAuthorityRefV1;
  actorKind: AuthorizationActor["kind"];
  actorId: string;
  transport: AuthorizationTransport;
  gatewayExposure: NpAgentEnabledGatewayExposureMode | null;
}

function requireBranchKeys(
  record: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      failCanonicalBody("unknown-field", `${path}.${key}`, "is not part of this exact branch");
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      failCanonicalBody("missing-field", `${path}.${key}`, "is required");
    }
  }
}

function parseActor(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): AuthorizationActor {
  const record = canonicalBodyRecord(value, path, ACTOR_KEYS, ["kind"], state);
  const kind = canonicalBodyEnum<AuthorizationActor["kind"]>(
    record.kind,
    `${path}.kind`,
    ACTOR_KINDS,
  );
  if (kind === "principal") {
    requireBranchKeys(
      record,
      path,
      npAgentAuthorizationContextCanonicalPrincipalActorIncludedKeysV1,
    );
    return {
      kind,
      principalId: canonicalBodyUuid(record.principalId, `${path}.principalId`),
      actorFingerprint: canonicalBodyAscii(
        record.actorFingerprint,
        `${path}.actorFingerprint`,
        256,
      ),
    };
  }
  requireBranchKeys(record, path, npAgentAuthorizationContextCanonicalStaffActorIncludedKeysV1);
  return {
    kind,
    userId: canonicalBodyUuid(record.userId, `${path}.userId`),
    actorFingerprint: canonicalBodyAscii(record.actorFingerprint, `${path}.actorFingerprint`, 256),
  };
}

function parseHttpsAudience(value: unknown, path: string): "mcp-service" | "agent-api" {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    failCanonicalBody("invalid-field", path, "must be one bounded canonical Gateway audience");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    failCanonicalBody("invalid-field", path, "must be one bounded canonical Gateway audience");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.href !== value
  ) {
    failCanonicalBody("invalid-field", path, "must be one canonical queryless HTTPS audience");
  }
  if (parsed.pathname === "/api/mcp") return "mcp-service";
  if (parsed.pathname === "/api/agent/v1") return "agent-api";
  failCanonicalBody("invalid-field", path, "must select the MCP or Agent HTTP resource path");
}

function parseExposure(value: unknown, path: string): NpAgentEnabledGatewayExposureMode {
  return canonicalBodyEnum(value, path, ENABLED_EXPOSURES);
}

function parseAuthority(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): ParsedAuthority {
  const record = canonicalBodyRecord(value, path, AUTHORITY_KEYS, ["kind"], state);
  const kind = canonicalBodyEnum<NpAgentInvocationAuthorityRefV1["kind"]>(
    record.kind,
    `${path}.kind`,
    AUTHORITY_KINDS,
  );

  if (kind === "staff-session") {
    requireBranchKeys(record, path, npAgentAuthorizationContextCanonicalStaffSessionIncludedKeysV1);
    const userId = canonicalBodyUuid(record.userId, `${path}.userId`);
    return {
      value: {
        kind,
        userId,
        sessionId: canonicalBodyUuid(record.sessionId, `${path}.sessionId`),
        userTokenVersion: canonicalBodyInteger(
          record.userTokenVersion,
          `${path}.userTokenVersion`,
          0,
          SIGNED_32_BIT_MAXIMUM,
        ),
        siteAuthorizationDigest: canonicalBodySha256Digest(
          record.siteAuthorizationDigest,
          `${path}.siteAuthorizationDigest`,
        ),
      },
      actorKind: "staff",
      actorId: userId,
      transport: "admin",
      gatewayExposure: null,
    };
  }

  if (kind === "service-family") {
    requireBranchKeys(
      record,
      path,
      npAgentAuthorizationContextCanonicalServiceFamilyIncludedKeysV1,
    );
    const principalId = canonicalBodyUuid(record.principalId, `${path}.principalId`);
    const exposureMode = parseExposure(record.exposureMode, `${path}.exposureMode`);
    const audience = canonicalBodyAscii(record.audience, `${path}.audience`, 2_048);
    const transport =
      audience === "urn:nexpress:agent-gateway:stdio"
        ? "stdio"
        : parseHttpsAudience(audience, `${path}.audience`);
    return {
      value: {
        kind,
        principalId,
        rotationFamilyId: canonicalBodyUuid(record.rotationFamilyId, `${path}.rotationFamilyId`),
        familyAuthorityVersion: canonicalBodyInteger(
          record.familyAuthorityVersion,
          `${path}.familyAuthorityVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        ),
        principalTokenVersion: canonicalBodyInteger(
          record.principalTokenVersion,
          `${path}.principalTokenVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        ),
        exposureMode,
        audience,
      },
      actorKind: "principal",
      actorId: principalId,
      transport,
      gatewayExposure: exposureMode,
    };
  }

  if (kind === "oauth-grant") {
    requireBranchKeys(record, path, npAgentAuthorizationContextCanonicalOauthGrantIncludedKeysV1);
    const principalId = canonicalBodyUuid(record.principalId, `${path}.principalId`);
    const exposureMode = parseExposure(record.exposureMode, `${path}.exposureMode`);
    const audience = canonicalBodyAscii(record.audience, `${path}.audience`, 2_048);
    if (parseHttpsAudience(audience, `${path}.audience`) !== "mcp-service") {
      failCanonicalBody("invalid-field", `${path}.audience`, "OAuth grants are MCP-only in v1");
    }
    return {
      value: {
        kind,
        principalId,
        clientId: canonicalBodyAscii(record.clientId, `${path}.clientId`, 256),
        grantId: canonicalBodyUuid(record.grantId, `${path}.grantId`),
        grantVersion: canonicalBodyInteger(
          record.grantVersion,
          `${path}.grantVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        ),
        principalTokenVersion: canonicalBodyInteger(
          record.principalTokenVersion,
          `${path}.principalTokenVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        ),
        exposureMode,
        audience,
      },
      actorKind: "principal",
      actorId: principalId,
      transport: "mcp-oauth",
      gatewayExposure: exposureMode,
    };
  }

  requireBranchKeys(record, path, npAgentAuthorizationContextCanonicalRuntimeRunIncludedKeysV1);
  const principalId = canonicalBodyUuid(record.principalId, `${path}.principalId`);
  return {
    value: {
      kind,
      principalId,
      runId: canonicalBodyUuid(record.runId, `${path}.runId`),
      agentVersionId: canonicalBodyUuid(record.agentVersionId, `${path}.agentVersionId`),
      deadlineAt: canonicalBodyUtc(record.deadlineAt, `${path}.deadlineAt`),
    },
    actorKind: "principal",
    actorId: principalId,
    transport: "runtime",
    gatewayExposure: null,
  };
}

function parseAuthorizationContextCanonical(
  value: unknown,
): NpAgentAuthorizationContextCanonicalV1 {
  const path = "agent.canonical.authorizationContext";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentAuthorizationContextCanonicalIncludedKeysV1,
    npAgentAuthorizationContextCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== "np.agent-authorization-context.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-authorization-context.v1",
    );
  }
  const actor = parseActor(record.actor, `${path}.actor`, state);
  const authority = parseAuthority(record.authorityRef, `${path}.authorityRef`, state);
  const transport = canonicalBodyEnum<AuthorizationTransport>(
    record.transport,
    `${path}.transport`,
    TRANSPORTS,
  );
  const gatewayExposure =
    record.gatewayExposure === null
      ? null
      : parseExposure(record.gatewayExposure, `${path}.gatewayExposure`);

  if (actor.kind !== authority.actorKind) {
    failCanonicalBody("invalid-field", `${path}.actor.kind`, "does not match authorityRef");
  }
  const actorId = actor.kind === "staff" ? actor.userId : actor.principalId;
  if (actorId !== authority.actorId) {
    failCanonicalBody("invalid-field", `${path}.actor`, "identity does not match authorityRef");
  }
  if (transport !== authority.transport) {
    failCanonicalBody("invalid-field", `${path}.transport`, "does not match authorityRef audience");
  }
  if (gatewayExposure !== authority.gatewayExposure) {
    failCanonicalBody(
      "invalid-field",
      `${path}.gatewayExposure`,
      "does not match authorityRef exposure",
    );
  }

  return {
    schemaVersion: "np.agent-authorization-context.v1",
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    actor,
    transport,
    gatewayExposure,
    authorityRef: authority.value,
  };
}

export function npAnalyzeAgentAuthorizationContextCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentAuthorizationContextCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.authorizationContext", () =>
    parseAuthorizationContextCanonical(value),
  );
}

export function npRequireAgentAuthorizationContextCanonical(
  value: unknown,
): NpAgentAuthorizationContextCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentAuthorizationContextCanonical(value),
    "Invalid Agent authorization-context canonical body",
  );
}

export function npBuildAgentAuthorizationContextCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-authorization-context.v1",
  NpAgentAuthorizationContextCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    "np.agent-authorization-context.v1",
    npRequireAgentAuthorizationContextCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-authorization-context.v1",
    NpAgentAuthorizationContextCanonicalV1
  >;
}

export async function npDigestAgentAuthorizationContextCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentAuthorizationContextCanonicalBytes(value).domainSeparatedUtf8,
  );
}
