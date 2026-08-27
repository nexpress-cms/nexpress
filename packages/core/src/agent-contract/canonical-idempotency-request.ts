import { npAgentAdminOperationIdsV1 } from "./admin-operation-registry.js";
import {
  analyzeCanonicalBody,
  canonicalBodyAscii,
  canonicalBodyCapabilityId,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  analyzeAgentCanonicalJsonValueWithLimits,
  buildAgentCanonicalFoundationBytes,
} from "./canonical-foundation.js";
import { npAgentContractLimits, npRequireAgentContractResult } from "./contract.js";
import type {
  NpAgentCanonicalBodyBytesV1,
  NpAgentContractResult,
  NpAgentInvocationRequestCanonicalV1,
  NpAgentJsonObject,
} from "./types.js";

const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const ACTOR_KINDS = new Set<string>(["principal", "staff"]);
const OPERATION_KINDS = new Set<string>(["capability", "admin"]);
const ADMIN_OPERATION_IDS = new Set<string>(npAgentAdminOperationIdsV1);
const INPUT_LIMITS = {
  maximumDepth: npAgentContractLimits.invocationDepth,
  maximumNodes: npAgentContractLimits.invocationNodes,
  maximumArrayItems: npAgentContractLimits.invocationArrayItems,
  maximumObjectProperties: npAgentContractLimits.invocationObjectProperties,
  maximumStringCharacters: npAgentContractLimits.invocationStringCharacters,
  maximumCanonicalBytes: npAgentContractLimits.invocationBytes,
} as const;

export const npAgentInvocationRequestCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "actorKind",
  "actorFingerprint",
  "authorizationContextFingerprint",
  "operationKind",
  "operationId",
  "contractVersion",
  "contractFingerprint",
  "effectProfile",
  "input",
] as const satisfies readonly (keyof NpAgentInvocationRequestCanonicalV1)[];

export const npAgentInvocationRequestCanonicalExcludedKeysV1 = [
  "requestHash",
  "idempotencyKey",
  "transport",
  "mcpExecutionMode",
  "mcpRequestedTaskTtlMs",
  "jsonRpcId",
  "requestId",
  "taskId",
  "invocationId",
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

export const npAgentInvocationRequestCanonicalEffectProfileIncludedKeysV1 = [
  "id",
  "contractVersion",
] as const satisfies readonly (keyof NonNullable<
  NpAgentInvocationRequestCanonicalV1["effectProfile"]
>)[];

function parseEffectProfile(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NonNullable<NpAgentInvocationRequestCanonicalV1["effectProfile"]> {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentInvocationRequestCanonicalEffectProfileIncludedKeysV1,
    npAgentInvocationRequestCanonicalEffectProfileIncludedKeysV1,
    state,
  );
  return {
    id: canonicalBodyIdentifier(record.id, `${path}.id`),
    contractVersion: canonicalBodyInteger(
      record.contractVersion,
      `${path}.contractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
  };
}

function parseInput(value: unknown, path: string): NpAgentJsonObject {
  const result = npRequireAgentContractResult(
    analyzeAgentCanonicalJsonValueWithLimits(value, path, INPUT_LIMITS),
    "Invalid Agent invocation canonical input",
  );
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    failCanonicalBody("shape", path, "must be an object-root canonical input");
  }
  return result;
}

function parseInvocationRequestCanonical(value: unknown): NpAgentInvocationRequestCanonicalV1 {
  const path = "agent.canonical.idempotencyRequest";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentInvocationRequestCanonicalIncludedKeysV1,
    npAgentInvocationRequestCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== "np.agent-idempotency-request.v1") {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      "must be np.agent-idempotency-request.v1",
    );
  }

  const common = {
    schemaVersion: "np.agent-idempotency-request.v1" as const,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    actorKind: canonicalBodyEnum<"principal" | "staff">(
      record.actorKind,
      `${path}.actorKind`,
      ACTOR_KINDS,
    ),
    actorFingerprint: canonicalBodyAscii(record.actorFingerprint, `${path}.actorFingerprint`, 256),
    authorizationContextFingerprint: canonicalBodySha256Digest(
      record.authorizationContextFingerprint,
      `${path}.authorizationContextFingerprint`,
    ),
    contractVersion: canonicalBodyInteger(
      record.contractVersion,
      `${path}.contractVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    contractFingerprint: canonicalBodySha256Digest(
      record.contractFingerprint,
      `${path}.contractFingerprint`,
    ),
    input: parseInput(record.input, `${path}.input`),
  };
  const operationKind = canonicalBodyEnum<"capability" | "admin">(
    record.operationKind,
    `${path}.operationKind`,
    OPERATION_KINDS,
  );

  let result: NpAgentInvocationRequestCanonicalV1;
  if (operationKind === "capability") {
    result = {
      ...common,
      operationKind,
      operationId: canonicalBodyCapabilityId(record.operationId, `${path}.operationId`),
      effectProfile: parseEffectProfile(record.effectProfile, `${path}.effectProfile`, state),
    };
  } else {
    const operationId = canonicalBodyIdentifier(record.operationId, `${path}.operationId`);
    if (!ADMIN_OPERATION_IDS.has(operationId)) {
      failCanonicalBody(
        "invalid-field",
        `${path}.operationId`,
        "must select one registered Admin operation id",
      );
    }
    result = {
      ...common,
      operationKind,
      operationId,
      effectProfile: null,
    };
  }

  if (operationKind === "admin" && record.effectProfile !== null) {
    failCanonicalBody(
      "invalid-field",
      `${path}.effectProfile`,
      "must be null for an Admin operation",
    );
  }

  buildAgentCanonicalFoundationBytes("np.agent-idempotency-request.v1", result);
  return result;
}

export function npAnalyzeAgentInvocationRequestCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentInvocationRequestCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.idempotencyRequest", () =>
    parseInvocationRequestCanonical(value),
  );
}

export function npRequireAgentInvocationRequestCanonical(
  value: unknown,
): NpAgentInvocationRequestCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentInvocationRequestCanonical(value),
    "Invalid Agent invocation-request canonical body",
  );
}

export function npBuildAgentInvocationRequestCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<
  "np.agent-idempotency-request.v1",
  NpAgentInvocationRequestCanonicalV1
> {
  return buildAgentCanonicalFoundationBytes(
    "np.agent-idempotency-request.v1",
    npRequireAgentInvocationRequestCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-idempotency-request.v1",
    NpAgentInvocationRequestCanonicalV1
  >;
}

export async function npDigestAgentInvocationRequestCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentInvocationRequestCanonicalBytes(value).domainSeparatedUtf8,
  );
}
