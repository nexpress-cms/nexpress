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
import type { NpAgentJsonObject, NpAgentJsonSchema } from "./types.js";

export const npAgentMemberResponseCapabilityIdsV1 = [
  "moderation.member.restrict",
  "moderation.member.revoke",
] as const;
export type NpAgentMemberResponseCapabilityIdV1 =
  (typeof npAgentMemberResponseCapabilityIdsV1)[number];
export type NpAgentMemberResponseOperationV1 =
  | { kind: "restrict"; durationSeconds: number }
  | { kind: "revoke"; sourceActionId: string; banId: string };
export interface NpAgentMemberResponsePlanInputV1 {
  schemaVersion: "np.agent-member-response-plan-input.v1";
  expectedVersion: number;
  memberId: string;
  expectedMemberVersionDigest: string;
  operation: NpAgentMemberResponseOperationV1;
  idempotencyKey: string;
}
export interface NpAgentMemberResponseExecuteInputV1 {
  schemaVersion: "np.agent-member-response-execute-input.v1";
  expectedVersion: number;
  actionId: string;
  approvalId: string;
  proposalHash: string;
  idempotencyKey: string;
}
export interface NpAgentMemberResponsePlanV1 {
  actionId: string;
  approvalId: string;
  proposalHash: string;
  capabilityId: NpAgentMemberResponseCapabilityIdV1;
  operation: NpAgentMemberResponseOperationV1;
  state: "approval_pending" | "approved" | "succeeded" | "failed";
  approvalExpiresAt: string;
  canExecute: boolean;
}
export interface NpAgentMemberResponseV1 {
  schemaVersion: "np.agent-member-response.v1";
  incidentId: string;
  incidentVersion: number;
  memberId: string;
  memberVersionDigest: string;
  maximumDurationSeconds: number;
  canRestrict: boolean;
  revocable: Array<{ sourceActionId: string; banId: string; expiresAt: string }>;
  plans: NpAgentMemberResponsePlanV1[];
  truncated: boolean;
}
/** A distinct approval review branch; this is never projected as content containment. */
export interface NpAgentApprovalMemberResponseActionReviewV1 {
  actionId: string;
  proposalHash: string;
  capabilityId: NpAgentMemberResponseCapabilityIdV1;
  incidentId: string;
  memberId: string;
  expectedMemberVersionDigest: string;
  operation: NpAgentMemberResponseOperationV1;
  policyDigest: string;
}

const record = (value: unknown, keys: string[]) =>
  canonicalBodyRecord(value, "memberResponse", keys, keys, { seen: new WeakSet<object>() });
const positive = (value: unknown) =>
  canonicalBodyInteger(value, "memberResponse.version", 1, 2147483647);
const duration = (value: unknown) =>
  canonicalBodyInteger(value, "memberResponse.durationSeconds", 1, 2592000);
const key = (value: unknown) => {
  const result = canonicalBodyAscii(value, "memberResponse.idempotencyKey", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result))
    failCanonicalBody(
      "invalid-field",
      "memberResponse.idempotencyKey",
      "Invalid stable idempotency key",
    );
  return result;
};
export function npRequireAgentMemberResponseOperationV1(
  value: unknown,
): NpAgentMemberResponseOperationV1 {
  const cloned = cloneCanonicalRuntimeInput(value, "memberResponse.operation", 4096);
  const kind =
    typeof cloned === "object" && cloned !== null && !Array.isArray(cloned)
      ? cloned.kind
      : undefined;
  if (kind === "restrict") {
    const row = record(cloned, ["kind", "durationSeconds"]);
    return { kind: "restrict", durationSeconds: duration(row.durationSeconds) };
  }
  const row = record(cloned, ["kind", "sourceActionId", "banId"]);
  return {
    kind: canonicalBodyEnum<"revoke">(row.kind, "memberResponse.operation", new Set(["revoke"])),
    sourceActionId: canonicalBodyUuid(row.sourceActionId, "memberResponse.sourceActionId"),
    banId: canonicalBodyUuid(row.banId, "memberResponse.banId"),
  };
}
export function npRequireAgentMemberResponsePlanInputV1(
  value: unknown,
): NpAgentMemberResponsePlanInputV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "memberResponse.plan", 16384), [
    "schemaVersion",
    "expectedVersion",
    "memberId",
    "expectedMemberVersionDigest",
    "operation",
    "idempotencyKey",
  ]);
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      "memberResponse.schemaVersion",
      new Set(["np.agent-member-response-plan-input.v1"] as const),
    ),
    expectedVersion: positive(row.expectedVersion),
    memberId: canonicalBodyUuid(row.memberId, "memberResponse.memberId"),
    expectedMemberVersionDigest: canonicalBodySha256Digest(
      row.expectedMemberVersionDigest,
      "memberResponse.memberVersionDigest",
    ),
    operation: npRequireAgentMemberResponseOperationV1(row.operation),
    idempotencyKey: key(row.idempotencyKey),
  };
}
export function npRequireAgentMemberResponseExecuteInputV1(
  value: unknown,
): NpAgentMemberResponseExecuteInputV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "memberResponse.execute", 16384), [
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
      "memberResponse.schemaVersion",
      new Set(["np.agent-member-response-execute-input.v1"] as const),
    ),
    expectedVersion: positive(row.expectedVersion),
    actionId: canonicalBodyUuid(row.actionId, "memberResponse.actionId"),
    approvalId: canonicalBodyUuid(row.approvalId, "memberResponse.approvalId"),
    proposalHash: canonicalBodySha256Digest(row.proposalHash, "memberResponse.proposalHash"),
    idempotencyKey: key(row.idempotencyKey),
  };
}
export function npRequireAgentApprovalMemberResponseActionReviewV1(
  value: unknown,
): NpAgentApprovalMemberResponseActionReviewV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "memberResponse.review", 16384), [
    "actionId",
    "proposalHash",
    "capabilityId",
    "incidentId",
    "memberId",
    "expectedMemberVersionDigest",
    "operation",
    "policyDigest",
  ]);
  const operation = npRequireAgentMemberResponseOperationV1(row.operation);
  const capabilityId = canonicalBodyEnum<NpAgentMemberResponseCapabilityIdV1>(
    row.capabilityId,
    "memberResponse.capabilityId",
    new Set(npAgentMemberResponseCapabilityIdsV1),
  );
  if (capabilityId !== `moderation.member.${operation.kind}`)
    failCanonicalBody(
      "invalid-field",
      "memberResponse.capabilityId",
      "Member response operation must match its capability",
    );
  return {
    actionId: canonicalBodyUuid(row.actionId, "memberResponse.actionId"),
    proposalHash: canonicalBodySha256Digest(row.proposalHash, "memberResponse.proposalHash"),
    capabilityId,
    incidentId: canonicalBodyUuid(row.incidentId, "memberResponse.incidentId"),
    memberId: canonicalBodyUuid(row.memberId, "memberResponse.memberId"),
    expectedMemberVersionDigest: canonicalBodySha256Digest(
      row.expectedMemberVersionDigest,
      "memberResponse.memberVersionDigest",
    ),
    operation,
    policyDigest: canonicalBodySha256Digest(row.policyDigest, "memberResponse.policyDigest"),
  };
}
export function npRequireAgentMemberResponseV1(value: unknown): NpAgentMemberResponseV1 {
  const row = record(cloneCanonicalRuntimeInput(value, "memberResponse", 65536), [
    "schemaVersion",
    "incidentId",
    "incidentVersion",
    "memberId",
    "memberVersionDigest",
    "maximumDurationSeconds",
    "canRestrict",
    "revocable",
    "plans",
    "truncated",
  ]);
  if (
    !Array.isArray(row.revocable) ||
    row.revocable.length > 25 ||
    !Array.isArray(row.plans) ||
    row.plans.length > 25 ||
    typeof row.canRestrict !== "boolean" ||
    typeof row.truncated !== "boolean"
  )
    failCanonicalBody("invalid-field", "memberResponse", "Invalid bounded member response");
  return {
    schemaVersion: canonicalBodyEnum(
      row.schemaVersion,
      "memberResponse.schemaVersion",
      new Set(["np.agent-member-response.v1"] as const),
    ),
    incidentId: canonicalBodyUuid(row.incidentId, "memberResponse.incidentId"),
    incidentVersion: positive(row.incidentVersion),
    memberId: canonicalBodyUuid(row.memberId, "memberResponse.memberId"),
    memberVersionDigest: canonicalBodySha256Digest(
      row.memberVersionDigest,
      "memberResponse.memberVersionDigest",
    ),
    maximumDurationSeconds: duration(row.maximumDurationSeconds),
    canRestrict: row.canRestrict,
    truncated: row.truncated,
    revocable: (row.revocable as unknown[]).map((value) => {
      const entry = record(value, ["sourceActionId", "banId", "expiresAt"]);
      return {
        sourceActionId: canonicalBodyUuid(entry.sourceActionId, "memberResponse.sourceActionId"),
        banId: canonicalBodyUuid(entry.banId, "memberResponse.banId"),
        expiresAt: canonicalBodyUtc(entry.expiresAt, "memberResponse.expiresAt"),
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
      const operation = npRequireAgentMemberResponseOperationV1(entry.operation);
      const capabilityId = canonicalBodyEnum<NpAgentMemberResponseCapabilityIdV1>(
        entry.capabilityId,
        "memberResponse.capabilityId",
        new Set(npAgentMemberResponseCapabilityIdsV1),
      );
      const state = canonicalBodyEnum<NpAgentMemberResponsePlanV1["state"]>(
        entry.state,
        "memberResponse.state",
        new Set(["approval_pending", "approved", "succeeded", "failed"]),
      );
      if (
        capabilityId !== `moderation.member.${operation.kind}` ||
        typeof entry.canExecute !== "boolean" ||
        (entry.canExecute && state !== "approved")
      )
        failCanonicalBody(
          "invalid-field",
          "memberResponse.plan",
          "Invalid member response execution availability",
        );
      return {
        actionId: canonicalBodyUuid(entry.actionId, "memberResponse.actionId"),
        approvalId: canonicalBodyUuid(entry.approvalId, "memberResponse.approvalId"),
        proposalHash: canonicalBodySha256Digest(entry.proposalHash, "memberResponse.proposalHash"),
        capabilityId,
        operation,
        state,
        approvalExpiresAt: canonicalBodyUtc(
          entry.approvalExpiresAt,
          "memberResponse.approvalExpiresAt",
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
export const npAgentMemberResponseOperationSchemaV1 = (): NpAgentJsonObject => ({
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "restrict" },
        durationSeconds: { type: "integer", minimum: 1, maximum: 2592000 },
      },
      required: ["kind", "durationSeconds"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: { kind: { const: "revoke" }, sourceActionId: uuidSchema(), banId: uuidSchema() },
      required: ["kind", "sourceActionId", "banId"],
    },
  ],
});
export function npAgentMemberResponsePlanInputSchemaV1(): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { const: "np.agent-member-response-plan-input.v1" },
      expectedVersion: { ...integerSchema },
      memberId: uuidSchema(),
      expectedMemberVersionDigest: { ...digestSchema },
      operation: npAgentMemberResponseOperationSchemaV1(),
      idempotencyKey: { ...keySchema },
    },
    required: [
      "schemaVersion",
      "expectedVersion",
      "memberId",
      "expectedMemberVersionDigest",
      "operation",
      "idempotencyKey",
    ],
  };
}
export function npAgentMemberResponseExecuteInputSchemaV1(): NpAgentJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      schemaVersion: { const: "np.agent-member-response-execute-input.v1" },
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
