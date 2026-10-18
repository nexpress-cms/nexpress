import {
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npAgentActorRestrictionScopes,
  type NpAgentActorRestrictionScope,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
} from "./types.js";

export const npAgentGuardianResponseCapabilityIdsV1 = [
  "security.limitActor",
  "security.removeActorLimit",
] as const;
export type NpAgentGuardianResponseCapabilityIdV1 =
  (typeof npAgentGuardianResponseCapabilityIdsV1)[number];
export type NpAgentGuardianResponseOperationV1 =
  | { kind: "limit"; durationSeconds: number; actionScopes: NpAgentActorRestrictionScope[] }
  | { kind: "remove"; sourceActionId: string; restrictionId: string };
export interface NpAgentGuardianResponsePlanInputV1 {
  schemaVersion: "np.agent-guardian-response-plan-input.v1";
  expectedVersion: number;
  expectedTargetVersionDigest: string;
  operation: NpAgentGuardianResponseOperationV1;
  idempotencyKey: string;
}
export interface NpAgentGuardianResponseExecuteInputV1 {
  schemaVersion: "np.agent-guardian-response-execute-input.v1";
  expectedVersion: number;
  actionId: string;
  approvalId: string;
  proposalHash: string;
  idempotencyKey: string;
}
export interface NpAgentGuardianResponsePlanV1 {
  actionId: string;
  approvalId: string;
  proposalHash: string;
  capabilityId: NpAgentGuardianResponseCapabilityIdV1;
  operation: NpAgentGuardianResponseOperationV1;
  state: "approval_pending" | "approved" | "executing" | "succeeded" | "compensated" | "failed";
  approvalExpiresAt: string;
  canExecute: boolean;
}
export interface NpAgentGuardianResponseV1 {
  schemaVersion: "np.agent-guardian-response.v1";
  incidentId: string;
  incidentVersion: number;
  targetVersionDigest: string;
  maximumDurationSeconds: number;
  canLimit: boolean;
  allowedScopes: NpAgentActorRestrictionScope[];
  restrictions: NpAgentGuardianRestrictionV1[];
  plans: NpAgentGuardianResponsePlanV1[];
  truncated: boolean;
}
/** A distinct approval review branch; this is never projected as content containment. */
export interface NpAgentApprovalGuardianResponseActionReviewV1 {
  actionId: string;
  proposalHash: string;
  capabilityId: NpAgentGuardianResponseCapabilityIdV1;
  incidentId: string;
  expectedTargetVersionDigest: string;
  operation: NpAgentGuardianResponseOperationV1;
  policyDigest: string;
}

const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, "guardianResponse", keys, keys, { seen: new WeakSet<object>() });
const positive = (value: unknown) =>
  canonicalBodyInteger(value, "guardianResponse.version", 1, 2147483647);
const duration = (value: unknown) =>
  canonicalBodyInteger(value, "guardianResponse.durationSeconds", 60, 3600);
const key = (value: unknown) => {
  const result = canonicalBodyAscii(value, "guardianResponse.idempotencyKey", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result))
    failCanonicalBody(
      "invalid-field",
      "guardianResponse.idempotencyKey",
      "Invalid stable idempotency key",
    );
  return result;
};
export function npRequireAgentGuardianResponseOperationV1(
  value: unknown,
): NpAgentGuardianResponseOperationV1 {
  const cloned = cloneCanonicalRuntimeInput(value, "guardianResponse.operation", 4096);
  const kind =
    typeof cloned === "object" && cloned !== null && !Array.isArray(cloned)
      ? cloned.kind
      : undefined;
  if (kind === "limit") {
    const row = record(cloned, ["kind", "durationSeconds", "actionScopes"]);
    return {
      kind: "limit",
      durationSeconds: duration(row.durationSeconds),
      actionScopes: scopes(row.actionScopes, false),
    };
  }
  const row = record(cloned, ["kind", "sourceActionId", "restrictionId"]);
  return {
    kind: canonicalBodyEnum<"remove">(row.kind, "guardianResponse.operation", new Set(["remove"])),
    sourceActionId: canonicalBodyUuid(row.sourceActionId, "guardianResponse.sourceActionId"),
    restrictionId: canonicalBodyUuid(row.restrictionId, "guardianResponse.restrictionId"),
  };
}
export function npRequireAgentGuardianResponsePlanInputV1(
  value: unknown,
): NpAgentGuardianResponsePlanInputV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "guardianResponse.plan", 16384), [
    "schemaVersion",
    "expectedVersion",
    "expectedTargetVersionDigest",
    "operation",
    "idempotencyKey",
  ]);
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      "guardianResponse.schemaVersion",
      new Set(["np.agent-guardian-response-plan-input.v1"] as const),
    ),
    expectedVersion: positive(row.expectedVersion),
    expectedTargetVersionDigest: canonicalBodySha256Digest(
      row.expectedTargetVersionDigest,
      "guardianResponse.targetVersionDigest",
    ),
    operation: npRequireAgentGuardianResponseOperationV1(row.operation),
    idempotencyKey: key(row.idempotencyKey),
  };
}
export function npRequireAgentGuardianResponseExecuteInputV1(
  value: unknown,
): NpAgentGuardianResponseExecuteInputV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "guardianResponse.execute", 16384), [
    "schemaVersion",
    "expectedVersion",
    "actionId",
    "approvalId",
    "proposalHash",
    "idempotencyKey",
  ]);
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      "guardianResponse.schemaVersion",
      new Set(["np.agent-guardian-response-execute-input.v1"] as const),
    ),
    expectedVersion: positive(row.expectedVersion),
    actionId: canonicalBodyUuid(row.actionId, "guardianResponse.actionId"),
    approvalId: canonicalBodyUuid(row.approvalId, "guardianResponse.approvalId"),
    proposalHash: canonicalBodySha256Digest(row.proposalHash, "guardianResponse.proposalHash"),
    idempotencyKey: key(row.idempotencyKey),
  };
}
export function npRequireAgentApprovalGuardianResponseActionReviewV1(
  value: unknown,
): NpAgentApprovalGuardianResponseActionReviewV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "guardianResponse.review", 16384), [
    "actionId",
    "proposalHash",
    "capabilityId",
    "incidentId",
    "expectedTargetVersionDigest",
    "operation",
    "policyDigest",
  ]);
  const operation = npRequireAgentGuardianResponseOperationV1(row.operation);
  const capabilityId = canonicalBodyEnum<NpAgentGuardianResponseCapabilityIdV1>(
    row.capabilityId,
    "guardianResponse.capabilityId",
    new Set(npAgentGuardianResponseCapabilityIdsV1),
  );
  if (
    capabilityId !==
    (operation.kind === "limit" ? "security.limitActor" : "security.removeActorLimit")
  )
    failCanonicalBody(
      "invalid-field",
      "guardianResponse.capabilityId",
      "Guardian response operation must match its capability",
    );
  return {
    actionId: canonicalBodyUuid(row.actionId, "guardianResponse.actionId"),
    proposalHash: canonicalBodySha256Digest(row.proposalHash, "guardianResponse.proposalHash"),
    capabilityId,
    incidentId: canonicalBodyUuid(row.incidentId, "guardianResponse.incidentId"),
    expectedTargetVersionDigest: canonicalBodySha256Digest(
      row.expectedTargetVersionDigest,
      "guardianResponse.targetVersionDigest",
    ),
    operation,
    policyDigest: canonicalBodySha256Digest(row.policyDigest, "guardianResponse.policyDigest"),
  };
}
export interface NpAgentGuardianRestrictionV1 {
  restrictionId: string;
  sourceActionId: string;
  expiresAt: string;
  state: "pending" | "active" | "removing" | "removed" | "expired" | "failed";
  rowVersion: number;
  lastErrorCode: string | null;
  canRemove: boolean;
}
function scopes(value: unknown, allowEmpty: boolean): NpAgentActorRestrictionScope[] {
  if (
    !Array.isArray(value) ||
    value.length > npAgentActorRestrictionScopes.length ||
    (!allowEmpty && value.length === 0)
  )
    failCanonicalBody(
      "invalid-field",
      "guardianResponse.actionScopes",
      "Use bounded sorted unique action scopes",
    );
  let previous = "";
  return value.map((item) => {
    const scope = canonicalBodyEnum<NpAgentActorRestrictionScope>(
      item,
      "guardianResponse.actionScopes",
      new Set(npAgentActorRestrictionScopes),
    );
    if (scope <= previous)
      failCanonicalBody(
        "invalid-field",
        "guardianResponse.actionScopes",
        "Scopes must be sorted and unique",
      );
    previous = scope;
    return scope;
  });
}
export function npRequireAgentGuardianResponseV1(value: unknown): NpAgentGuardianResponseV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "guardianResponse", 65536), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "targetVersionDigest",
    "maximumDurationSeconds",
    "allowedScopes",
    "canLimit",
    "restrictions",
    "plans",
    "truncated",
  ]);
  if (
    !Array.isArray(row.restrictions) ||
    row.restrictions.length > 25 ||
    !Array.isArray(row.plans) ||
    row.plans.length > 25 ||
    typeof row.canLimit !== "boolean" ||
    typeof row.truncated !== "boolean"
  )
    failCanonicalBody("invalid-field", "guardianResponse", "Invalid bounded Guardian response");
  const allowedScopes = scopes(row.allowedScopes, true);
  const uniqueIds = (rows: unknown[], field: string) => {
    const ids = rows.map((entry) =>
      entry !== null && typeof entry === "object" ? Reflect.get(entry, field) : undefined,
    );
    if (new Set(ids).size !== ids.length)
      failCanonicalBody("invalid-field", "guardianResponse", "Duplicate response identities");
  };
  uniqueIds(row.restrictions, "restrictionId");
  uniqueIds(row.plans, "actionId");
  if (row.canLimit && !allowedScopes.length)
    failCanonicalBody("invalid-field", "guardianResponse", "Limiting requires installed scopes");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      "guardianResponse.schemaVersion",
      new Set(["np.agent-guardian-response.v1"] as const),
    ),
    incidentId: canonicalBodyUuid(row.incidentId, "guardianResponse.incidentId"),
    incidentVersion: positive(row.incidentVersion),
    targetVersionDigest: canonicalBodySha256Digest(
      row.targetVersionDigest,
      "guardianResponse.targetVersionDigest",
    ),
    maximumDurationSeconds: duration(row.maximumDurationSeconds),
    allowedScopes,
    canLimit: row.canLimit,
    truncated: row.truncated,
    restrictions: row.restrictions.map((value) => {
      const entry = record(value, [
        "restrictionId",
        "sourceActionId",
        "expiresAt",
        "state",
        "rowVersion",
        "lastErrorCode",
        "canRemove",
      ]);
      const state = canonicalBodyEnum<NpAgentGuardianRestrictionV1["state"]>(
        entry.state,
        "guardianResponse.restriction.state",
        new Set(["pending", "active", "removing", "removed", "expired", "failed"]),
      );
      if (
        typeof entry.canRemove !== "boolean" ||
        (entry.canRemove && !["active", "pending", "removing"].includes(state))
      )
        failCanonicalBody(
          "invalid-field",
          "guardianResponse.restriction",
          "Invalid restriction removal availability",
        );
      const lastErrorCode =
        entry.lastErrorCode === null
          ? null
          : canonicalBodyAscii(entry.lastErrorCode, "guardianResponse.lastErrorCode", 64);
      if (lastErrorCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/u.test(lastErrorCode))
        failCanonicalBody(
          "invalid-field",
          "guardianResponse.lastErrorCode",
          "Invalid safe error code",
        );
      return {
        restrictionId: canonicalBodyUuid(entry.restrictionId, "guardianResponse.restrictionId"),
        sourceActionId: canonicalBodyUuid(entry.sourceActionId, "guardianResponse.sourceActionId"),
        expiresAt: canonicalBodyUtc(entry.expiresAt, "guardianResponse.expiresAt"),
        state,
        rowVersion: positive(entry.rowVersion),
        lastErrorCode,
        canRemove: entry.canRemove,
      };
    }),
    plans: (row.plans as unknown[]).map((value) => {
      const entry = record(value, [
        "actionId",
        "approvalId",
        "proposalHash",
        "capabilityId",
        "operation",
        "state",
        "approvalExpiresAt",
        "canExecute",
      ]);
      const operation = npRequireAgentGuardianResponseOperationV1(entry.operation);
      const capabilityId = canonicalBodyEnum<NpAgentGuardianResponseCapabilityIdV1>(
        entry.capabilityId,
        "guardianResponse.capabilityId",
        new Set(npAgentGuardianResponseCapabilityIdsV1),
      );
      const state = canonicalBodyEnum<NpAgentGuardianResponsePlanV1["state"]>(
        entry.state,
        "guardianResponse.state",
        new Set([
          "approval_pending",
          "approved",
          "executing",
          "succeeded",
          "compensated",
          "failed",
        ]),
      );
      if (
        capabilityId !==
          (operation.kind === "limit" ? "security.limitActor" : "security.removeActorLimit") ||
        typeof entry.canExecute !== "boolean" ||
        (entry.canExecute && !["approved", "executing"].includes(state))
      )
        failCanonicalBody(
          "invalid-field",
          "guardianResponse.plan",
          "Invalid Guardian response execution availability",
        );
      return {
        actionId: canonicalBodyUuid(entry.actionId, "guardianResponse.actionId"),
        approvalId: canonicalBodyUuid(entry.approvalId, "guardianResponse.approvalId"),
        proposalHash: canonicalBodySha256Digest(
          entry.proposalHash,
          "guardianResponse.proposalHash",
        ),
        capabilityId,
        operation,
        state,
        approvalExpiresAt: canonicalBodyUtc(
          entry.approvalExpiresAt,
          "guardianResponse.approvalExpiresAt",
        ),
        canExecute: entry.canExecute,
      };
    }),
  };
}
const integerSchema = { type: "integer", minimum: 1, maximum: 2147483647 };
const uuidSchema = () => ({ type: "string", format: "uuid", maxLength: 36 });
const digestSchema = { type: "string", pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$", maxLength: 54 };
const keySchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
};
export const npAgentGuardianResponseOperationSchemaV1 = (): NpAgentJsonObject => ({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "limit" },
        durationSeconds: { type: "integer", minimum: 60, maximum: 3600 },
        actionScopes: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: { enum: [...npAgentActorRestrictionScopes] },
        },
      },
      required: ["kind", "durationSeconds", "actionScopes"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "remove" },
        sourceActionId: uuidSchema(),
        restrictionId: uuidSchema(),
      },
      required: ["kind", "sourceActionId", "restrictionId"],
    },
  ],
});
export function npAgentGuardianResponsePlanInputSchemaV1(): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { const: "np.agent-guardian-response-plan-input.v1" },
      expectedVersion: { ...integerSchema },
      expectedTargetVersionDigest: { ...digestSchema },
      operation: npAgentGuardianResponseOperationSchemaV1(),
      idempotencyKey: { ...keySchema },
    },
    required: [
      "schemaVersion",
      "expectedVersion",
      "expectedTargetVersionDigest",
      "operation",
      "idempotencyKey",
    ],
  };
}
export function npAgentGuardianResponseExecuteInputSchemaV1(): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { const: "np.agent-guardian-response-execute-input.v1" },
      expectedVersion: { ...integerSchema },
      actionId: uuidSchema(),
      approvalId: uuidSchema(),
      proposalHash: { ...digestSchema },
      idempotencyKey: { ...keySchema },
    },
    required: [
      "schemaVersion",
      "expectedVersion",
      "actionId",
      "approvalId",
      "proposalHash",
      "idempotencyKey",
    ],
  };
}
