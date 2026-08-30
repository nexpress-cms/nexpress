import {
  analyzeCanonicalBody,
  canonicalBodyInteger,
  canonicalBodyRecord,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import {
  canonicalRuntimeIdempotencyKey,
  canonicalRuntimeText,
  parseCanonicalSha256,
} from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import type { NpAgentContractResult } from "./types.js";

export const npAgentConnectionAdminOperationIdsV1 = [
  "agents.connections.create",
  "agents.connections.update",
  "agents.connections.oauth_start",
  "agents.connections.test",
  "agents.connections.rotate",
  "agents.connections.disable",
  "agents.connections.enable",
  "agents.connections.revoke",
] as const;

export type NpAgentConnectionAdminOperationIdV1 =
  (typeof npAgentConnectionAdminOperationIdsV1)[number];

interface NpAgentConnectionAdminBaseInputV1 {
  idempotencyKey: string;
}

interface NpAgentConnectionAdminVersionInputV1 extends NpAgentConnectionAdminBaseInputV1 {
  expectedVersion: number;
}

interface NpAgentConnectionAdminConfigInputV1 extends NpAgentConnectionAdminVersionInputV1 {
  configHash: string;
}

export interface NpAgentConnectionCreateAdminInputV1 extends NpAgentConnectionAdminBaseInputV1 {
  credential: string;
  definitionHash: string;
  definitionJson: string;
  vaultOperationId: string;
}

export interface NpAgentConnectionUpdateAdminInputV1 extends NpAgentConnectionAdminConfigInputV1 {
  definitionHash: string;
  definitionJson: string;
}

export interface NpAgentConnectionRotateAdminInputV1 extends NpAgentConnectionAdminConfigInputV1 {
  credential: string;
  vaultOperationId: string;
}

export interface NpAgentConnectionReasonAdminInputV1 extends NpAgentConnectionAdminVersionInputV1 {
  reason: string;
}

export interface NpAgentConnectionAdminInputMapV1 {
  "agents.connections.create": NpAgentConnectionCreateAdminInputV1;
  "agents.connections.update": NpAgentConnectionUpdateAdminInputV1;
  "agents.connections.oauth_start": NpAgentConnectionAdminConfigInputV1;
  "agents.connections.test": NpAgentConnectionAdminConfigInputV1;
  "agents.connections.rotate": NpAgentConnectionRotateAdminInputV1;
  "agents.connections.disable": NpAgentConnectionReasonAdminInputV1;
  "agents.connections.enable": NpAgentConnectionAdminConfigInputV1;
  "agents.connections.revoke": NpAgentConnectionReasonAdminInputV1;
}

const OPERATION_IDS = new Set<string>(npAgentConnectionAdminOperationIdsV1);
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function record(
  value: unknown,
  path: string,
  keys: readonly string[],
  state: CanonicalBodyInspectionState,
): Record<string, unknown> {
  return canonicalBodyRecord(value, path, keys, keys, state);
}

function idempotency(value: unknown, path: string): string {
  return canonicalRuntimeIdempotencyKey(value, `${path}.idempotencyKey`);
}

function version(value: unknown, path: string): number {
  return canonicalBodyInteger(value, `${path}.expectedVersion`, 1, SIGNED_32_BIT_MAXIMUM);
}

function safeId(value: unknown, path: string, field: string): string {
  const parsed = text(value, path, field, 128);
  if (!SAFE_ID_PATTERN.test(parsed)) {
    return failCanonicalBody(
      "invalid-field",
      `${path}.${field}`,
      "must use the canonical safe-id grammar",
    );
  }
  return parsed;
}

function text(
  value: unknown,
  path: string,
  field: string,
  maximum: number,
  allowEmpty = false,
): string {
  return canonicalRuntimeText(value, `${path}.${field}`, maximum, {
    allowEmpty,
    requireTrimmed: false,
  });
}

function configBase(
  source: Record<string, unknown>,
  path: string,
): NpAgentConnectionAdminConfigInputV1 {
  return {
    idempotencyKey: idempotency(source.idempotencyKey, path),
    expectedVersion: version(source.expectedVersion, path),
    configHash: parseCanonicalSha256(source.configHash, `${path}.configHash`),
  };
}

function parseConnectionAdminInput(
  operationId: NpAgentConnectionAdminOperationIdV1,
  value: unknown,
) {
  const path = `agent.connectionAdmin.${operationId}`;
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  switch (operationId) {
    case "agents.connections.create": {
      const source = record(
        value,
        path,
        ["credential", "definitionHash", "definitionJson", "idempotencyKey", "vaultOperationId"],
        state,
      );
      return {
        idempotencyKey: idempotency(source.idempotencyKey, path),
        credential: text(source.credential, path, "credential", 65_536, true),
        definitionHash: parseCanonicalSha256(source.definitionHash, `${path}.definitionHash`),
        definitionJson: text(source.definitionJson, path, "definitionJson", 262_144, true),
        vaultOperationId: safeId(source.vaultOperationId, path, "vaultOperationId"),
      };
    }
    case "agents.connections.update": {
      const source = record(
        value,
        path,
        ["configHash", "definitionHash", "definitionJson", "expectedVersion", "idempotencyKey"],
        state,
      );
      return {
        ...configBase(source, path),
        definitionHash: parseCanonicalSha256(source.definitionHash, `${path}.definitionHash`),
        definitionJson: text(source.definitionJson, path, "definitionJson", 262_144, true),
      };
    }
    case "agents.connections.oauth_start":
    case "agents.connections.test":
    case "agents.connections.enable": {
      const source = record(
        value,
        path,
        ["configHash", "expectedVersion", "idempotencyKey"],
        state,
      );
      return configBase(source, path);
    }
    case "agents.connections.rotate": {
      const source = record(
        value,
        path,
        ["configHash", "credential", "expectedVersion", "idempotencyKey", "vaultOperationId"],
        state,
      );
      return {
        ...configBase(source, path),
        credential: text(source.credential, path, "credential", 65_536, true),
        vaultOperationId: safeId(source.vaultOperationId, path, "vaultOperationId"),
      };
    }
    case "agents.connections.disable":
    case "agents.connections.revoke": {
      const source = record(value, path, ["expectedVersion", "idempotencyKey", "reason"], state);
      return {
        idempotencyKey: idempotency(source.idempotencyKey, path),
        expectedVersion: version(source.expectedVersion, path),
        reason: text(source.reason, path, "reason", 2_000, true),
      };
    }
  }
}

export function npAnalyzeAgentConnectionAdminInputV1<I extends NpAgentConnectionAdminOperationIdV1>(
  operationId: I,
  value: unknown,
): NpAgentContractResult<NpAgentConnectionAdminInputMapV1[I]> {
  if (!OPERATION_IDS.has(operationId)) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.connectionAdmin.operationId",
          message: "is not an AP-106 connection Admin operation",
        },
      ],
    };
  }
  return analyzeCanonicalBody(`agent.connectionAdmin.${operationId}`, () =>
    parseConnectionAdminInput(operationId, value),
  ) as NpAgentContractResult<NpAgentConnectionAdminInputMapV1[I]>;
}

export function npRequireAgentConnectionAdminInputV1<I extends NpAgentConnectionAdminOperationIdV1>(
  operationId: I,
  value: unknown,
): NpAgentConnectionAdminInputMapV1[I] {
  return npRequireAgentContractResult(
    npAnalyzeAgentConnectionAdminInputV1(operationId, value),
    `Invalid ${operationId} input`,
  );
}
