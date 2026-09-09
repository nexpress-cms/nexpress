import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import {
  npAgentExecutionSummarySchemaV1,
  npAgentVerificationSummarySchemaV1,
} from "./changeset-capability-schema.js";
import { npRequireAgentContractResult, npAnalyzeAgentJsonSchema } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodySha256Digest,
  canonicalBodyArray,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  canonicalRuntimeText,
} from "./canonical-runtime-primitives.js";
import {
  npRequireAgentExecutionSummaryV1,
  npRequireAgentVerificationSummaryV1,
  npAgentChangeSetLimits,
  type NpAgentExecutionSummary,
  type NpAgentVerificationSummary,
  type NpAgentChangeSetState,
} from "./changeset-wire-contract.js";
import type { NpAgentJsonSchema } from "./types.js";
export interface NpAgentChangeSetApplyInputV1 {
  schemaVersion: "np.agent-changeset-apply-input.v1";
  expectedDraftVersion: number;
  planHash: string;
  approvalId: string;
  statementHash: string;
  idempotencyKey: string;
}
export interface NpAgentChangeSetScheduleInputV1 extends Omit<
  NpAgentChangeSetApplyInputV1,
  "schemaVersion"
> {
  schemaVersion: "np.agent-changeset-schedule-input.v1";
  scheduledFor: string;
}
export const npAgentChangeSetCancellableStatesV1 = [
  "draft",
  "invalid",
  "ready",
  "approval_pending",
  "approved",
  "scheduled",
] as const satisfies readonly NpAgentChangeSetState[];
export interface NpAgentChangeSetCancelInputV1 {
  schemaVersion: "np.agent-changeset-cancel-input.v1";
  expectedDraftVersion: number;
  expectedState: (typeof npAgentChangeSetCancellableStatesV1)[number];
  planHash: string | null;
  reasonCode: "OPERATOR_CANCELLED";
  reason: string | null;
  idempotencyKey: string;
}
export const npAgentVerificationCheckIdsV1 = [
  "resource_after_hashes",
  "revisions_audit",
  "post_commit_hooks",
  "cache",
  "search",
  "media",
  "public_routes",
] as const;
export const npAgentVerificationNextActionsV1 = [
  "retry_verification",
  "inspect_effect",
  "refresh_plan",
  "reapprove",
  "none",
] as const;
export interface NpAgentVerificationCheckV1 {
  checkId: (typeof npAgentVerificationCheckIdsV1)[number];
  required: boolean;
  severity: "error" | "warning" | "info";
  status: "pending" | "running" | "passed" | "failed" | "unavailable";
  evidenceRefs: Array<{ kind: "operation" | "artifact"; id: string }>;
  nextAction: (typeof npAgentVerificationNextActionsV1)[number];
}
export const npAgentExecutionErrorCodesV1 = [
  "APPROVAL_EXPIRED",
  "APPROVAL_REVOKED",
  "APPROVAL_REQUIRED",
  "APPROVAL_INTEGRITY_INVALID",
  "PREVIEW_REQUIRED",
  "BASE_CONFLICT",
  "AUTHORIZATION_CHANGED",
  "POLICY_CHANGED",
  "EXECUTION_CANCELLED",
  "APPLY_FAILED",
  "VERIFICATION_FAILED",
  "EFFECT_AMBIGUOUS",
  "DEPENDENCY_UNAVAILABLE",
] as const;
export interface NpAgentChangeSetExecutionDetailV1 {
  schemaVersion: "np.agent-changeset-execution.v1";
  changeSetId: string;
  execution: NpAgentExecutionSummary;
  approvalId: string;
  planHash: string;
  scheduledFor: string | null;
  committedAt: string | null;
  rollbackEligibleUntil: string | null;
  errorCode: (typeof npAgentExecutionErrorCodesV1)[number] | null;
  verification: NpAgentVerificationSummary | null;
  checks: NpAgentVerificationCheckV1[];
}
export function npRequireAgentVerificationChecksV1(input: unknown): NpAgentVerificationCheckV1[] {
  const p = "agent.changeset.verification.checks";
  const value = cloneCanonicalRuntimeInput(input, p, 256 * 1024);
  const checks = canonicalBodyArray(value, p, npAgentVerificationCheckIdsV1.length, state()).map(
    (v): NpAgentVerificationCheckV1 => {
      const row = record(v, p, [
          "checkId",
          "required",
          "severity",
          "status",
          "evidenceRefs",
          "nextAction",
        ]),
        checkId = en(row.checkId, p, npAgentVerificationCheckIdsV1);
      if (typeof row.required !== "boolean")
        failCanonicalBody("invalid-field", p, "Check requirement must be boolean");
      const evidenceRefs = canonicalBodyArray(
        row.evidenceRefs,
        p,
        npAgentChangeSetLimits.operations,
        state(),
      ).map((v) => {
        const ref = record(v, p, ["kind", "id"]),
          kind = en(ref.kind, p, ["operation", "artifact"]);
        const id =
          kind === "artifact" ? canonicalBodyUuid(ref.id, p) : canonicalRuntimeText(ref.id, p, 3);
        if (
          kind === "operation" &&
          (!/^[1-9][0-9]{0,2}$/u.test(id) || Number(id) > npAgentChangeSetLimits.operations)
        )
          failCanonicalBody("invalid-field", p, "Invalid operation evidence ordinal");
        return { kind, id };
      });
      if (new Set(evidenceRefs.map((ref) => `${ref.kind}:${ref.id}`)).size !== evidenceRefs.length)
        failCanonicalBody("duplicate", p, "Duplicate check evidence");
      return {
        checkId,
        required: row.required,
        severity: en(row.severity, p, ["error", "warning", "info"]),
        status: en(row.status, p, ["pending", "running", "passed", "failed", "unavailable"]),
        evidenceRefs,
        nextAction: en(row.nextAction, p, npAgentVerificationNextActionsV1),
      };
    },
  );
  if (
    checks.some(
      (c, i) =>
        i > 0 &&
        npAgentVerificationCheckIdsV1.indexOf(checks[i - 1].checkId) >=
          npAgentVerificationCheckIdsV1.indexOf(c.checkId),
    )
  )
    failCanonicalBody("order", p, "Checks must follow the fixed unique inventory");

  return checks;
}
const state = () => ({ seen: new WeakSet<object>() });
const record = (v: unknown, p: string, keys: readonly string[]) =>
  canonicalBodyRecord(v, p, keys, keys, state());
const en = <T extends string>(v: unknown, p: string, values: readonly T[]) =>
  canonicalBodyEnum<T>(v, p, new Set(values));
const positive = (v: unknown, p: string) => canonicalBodyInteger(v, p, 1, 2_147_483_647);
const nullableUtc = (v: unknown, p: string) => (v === null ? null : canonicalBodyUtc(v, p));
const nullableDigest = (v: unknown, p: string) =>
  v === null ? null : canonicalBodySha256Digest(v, p);
const idem = (v: unknown, p: string) => {
  const key = canonicalRuntimeText(v, p, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(key))
    failCanonicalBody("invalid-field", p, "Invalid idempotency key");
  return key;
};
function analyze<T>(
  path: string,
  value: unknown,
  keys: readonly string[],
  parse: (r: Record<string, unknown>, p: string) => T,
) {
  return analyzeCanonicalBody(path, () =>
    parse(record(cloneCanonicalRuntimeInput(value, path, 256 * 1024), path, keys), path),
  );
}
const executionInputKeys = [
  "schemaVersion",
  "expectedDraftVersion",
  "planHash",
  "approvalId",
  "statementHash",
  "idempotencyKey",
];
const baseInput = (r: Record<string, unknown>, p: string) => ({
  expectedDraftVersion: positive(r.expectedDraftVersion, p),
  planHash: canonicalBodySha256Digest(r.planHash, p),
  approvalId: canonicalBodyUuid(r.approvalId, p),
  statementHash: canonicalBodySha256Digest(r.statementHash, p),
  idempotencyKey: idem(r.idempotencyKey, p),
});
export function npAnalyzeAgentChangeSetApplyInputV1(value: unknown) {
  return analyze(
    "agent.changeset.apply",
    value,
    executionInputKeys,
    (r, p): NpAgentChangeSetApplyInputV1 => ({
      ...baseInput(r, p),
      schemaVersion: en(r.schemaVersion, p, ["np.agent-changeset-apply-input.v1"]),
    }),
  );
}
export const npRequireAgentChangeSetApplyInputV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentChangeSetApplyInputV1(v), "Invalid apply request");
export function npAnalyzeAgentChangeSetScheduleInputV1(value: unknown) {
  return analyze(
    "agent.changeset.schedule",
    value,
    [...executionInputKeys, "scheduledFor"],
    (r, p): NpAgentChangeSetScheduleInputV1 => ({
      ...baseInput(r, p),
      schemaVersion: en(r.schemaVersion, p, ["np.agent-changeset-schedule-input.v1"]),
      scheduledFor: canonicalBodyUtc(r.scheduledFor, p),
    }),
  );
}
export const npRequireAgentChangeSetScheduleInputV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentChangeSetScheduleInputV1(v),
    "Invalid schedule request",
  );
export function npAnalyzeAgentChangeSetCancelInputV1(value: unknown) {
  return analyze(
    "agent.changeset.cancel",
    value,
    [
      "schemaVersion",
      "expectedDraftVersion",
      "expectedState",
      "planHash",
      "reasonCode",
      "reason",
      "idempotencyKey",
    ],
    (r, p): NpAgentChangeSetCancelInputV1 => {
      const expectedState = en(r.expectedState, p, npAgentChangeSetCancellableStatesV1),
        planHash = nullableDigest(r.planHash, p);
      if (["draft", "invalid"].includes(expectedState) !== (planHash === null))
        failCanonicalBody("invalid-field", p, "Plan hash must match expected state");
      return {
        schemaVersion: en(r.schemaVersion, p, ["np.agent-changeset-cancel-input.v1"]),
        expectedDraftVersion: positive(r.expectedDraftVersion, p),
        expectedState,
        planHash,
        reasonCode: en(r.reasonCode, p, ["OPERATOR_CANCELLED"]),
        reason: r.reason === null ? null : canonicalRuntimeText(r.reason, p, 2000),
        idempotencyKey: idem(r.idempotencyKey, p),
      };
    },
  );
}
export const npRequireAgentChangeSetCancelInputV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentChangeSetCancelInputV1(v),
    "Invalid cancellation request",
  );
export function npAnalyzeAgentChangeSetExecutionDetailV1(value: unknown) {
  return analyze(
    "agent.changeset.execution",
    value,
    [
      "schemaVersion",
      "changeSetId",
      "execution",
      "approvalId",
      "planHash",
      "scheduledFor",
      "committedAt",
      "rollbackEligibleUntil",
      "errorCode",
      "verification",
      "checks",
    ],
    (r, p): NpAgentChangeSetExecutionDetailV1 => {
      const execution = npRequireAgentExecutionSummaryV1(r.execution),
        committedAt = nullableUtc(r.committedAt, p),
        rollbackEligibleUntil = nullableUtc(r.rollbackEligibleUntil, p);
      const verification =
        r.verification === null ? null : npRequireAgentVerificationSummaryV1(r.verification);
      const errorCode =
        r.errorCode === null ? null : en(r.errorCode, p, npAgentExecutionErrorCodesV1);
      if (
        (committedAt === null) !== (rollbackEligibleUntil === null) ||
        (committedAt !== null &&
          (committedAt < execution.startedAt ||
            rollbackEligibleUntil! < committedAt ||
            (execution.finishedAt !== null && execution.finishedAt < committedAt)))
      )
        failCanonicalBody("invalid-field", p, "Commit timestamps must agree");
      if (
        (["committed", "verifying", "succeeded"].includes(execution.state) &&
          committedAt === null) ||
        (execution.state === "reserved" && committedAt !== null)
      )
        failCanonicalBody("invalid-field", p, "Execution state must match commit");
      if (committedAt === null && verification !== null)
        failCanonicalBody("invalid-field", p, "Uncommitted execution cannot have verification");
      if (
        execution.state === "succeeded" &&
        (verification?.state !== "passed" || errorCode !== null)
      )
        failCanonicalBody("invalid-field", p, "Successful execution requires passed verification");
      const checks = npRequireAgentVerificationChecksV1(r.checks);
      if (committedAt === null && checks.length > 0)
        failCanonicalBody("invalid-field", p, "Uncommitted execution has no verification checks");
      if (
        verification?.state === "passed" &&
        checks.some((c) => c.required && c.status !== "passed")
      )
        failCanonicalBody("invalid-field", p, "Required checks must pass");
      return {
        schemaVersion: en(r.schemaVersion, p, ["np.agent-changeset-execution.v1"]),
        changeSetId: canonicalBodyUuid(r.changeSetId, p),
        execution,
        approvalId: canonicalBodyUuid(r.approvalId, p),
        planHash: canonicalBodySha256Digest(r.planHash, p),
        scheduledFor: nullableUtc(r.scheduledFor, p),
        committedAt,
        rollbackEligibleUntil,
        errorCode,
        verification,
        checks,
      };
    },
  );
}
export const npRequireAgentChangeSetExecutionDetailV1 = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentChangeSetExecutionDetailV1(v),
    "Invalid execution detail",
  );
const integer = { type: "integer", minimum: 1, maximum: 2_147_483_647 },
  digest = { type: "string", maxLength: 54, pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$" },
  uuid = { type: "string", format: "uuid", maxLength: 36 },
  utc = { type: "string", format: "date-time", maxLength: 24 },
  idempotency = { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
const nullable = (value: unknown) => ({ anyOf: [value, { type: "null" }] });
const schema = (properties: Record<string, unknown>): NpAgentJsonSchema =>
  npRequireAgentContractResult(
    npAnalyzeAgentJsonSchema(
      JSON.parse(
        JSON.stringify({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        }),
      ),
    ),
    "Invalid execution schema",
  );
const baseSchema = {
  expectedDraftVersion: integer,
  planHash: digest,
  approvalId: uuid,
  statementHash: digest,
  idempotencyKey: idempotency,
};
export const npAgentChangeSetApplyInputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-changeset-apply-input.v1" },
  ...baseSchema,
});
export const npAgentChangeSetScheduleInputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-changeset-schedule-input.v1" },
  ...baseSchema,
  scheduledFor: utc,
});
export const npAgentChangeSetCancelInputSchemaV1 = schema({
  schemaVersion: { const: "np.agent-changeset-cancel-input.v1" },
  expectedDraftVersion: integer,
  expectedState: { enum: [...npAgentChangeSetCancellableStatesV1] },
  planHash: nullable(digest),
  reasonCode: { const: "OPERATOR_CANCELLED" },
  reason: nullable({ type: "string", minLength: 1, maxLength: 2000 }),
  idempotencyKey: idempotency,
});
export const npAgentChangeSetExecutionDetailSchemaV1 = schema({
  schemaVersion: { const: "np.agent-changeset-execution.v1" },
  changeSetId: uuid,
  execution: npAgentExecutionSummarySchemaV1,
  approvalId: uuid,
  planHash: digest,
  scheduledFor: nullable(utc),
  committedAt: nullable(utc),
  rollbackEligibleUntil: nullable(utc),
  errorCode: { enum: [...npAgentExecutionErrorCodesV1, null] },
  verification: nullable(npAgentVerificationSummarySchemaV1),
  checks: {
    type: "array",
    maxItems: npAgentVerificationCheckIdsV1.length,
    items: schema({
      checkId: { enum: [...npAgentVerificationCheckIdsV1] },
      required: { type: "boolean" },
      severity: { enum: ["error", "warning", "info"] },
      status: { enum: ["pending", "running", "passed", "failed", "unavailable"] },
      evidenceRefs: {
        type: "array",
        maxItems: npAgentChangeSetLimits.operations,
        items: {
          oneOf: [
            schema({
              kind: { const: "operation" },
              id: { type: "string", maxLength: 3, pattern: "^[1-9][0-9]{0,2}$" },
            }),
            schema({ kind: { const: "artifact" }, id: uuid }),
          ],
        },
      },
      nextAction: { enum: [...npAgentVerificationNextActionsV1] },
    }),
  },
});

export async function npDigestAgentVerificationResultV1(
  input: unknown,
): Promise<`cj1:sha256:${string}`> {
  const p = "agent.changeset.verification";
  const r = record(cloneCanonicalRuntimeInput(input, p, 256 * 1024), p, [
    "siteId",
    "changeSetId",
    "executionId",
    "verificationContractFingerprint",
    "checks",
  ]);
  const body = {
    schemaVersion: "np.agent-changeset-verification.v1",
    siteId: canonicalBodySiteId(r.siteId, p),
    changeSetId: canonicalBodyUuid(r.changeSetId, p),
    executionId: canonicalBodyUuid(r.executionId, p),
    verificationContractFingerprint: canonicalBodySha256Digest(
      r.verificationContractFingerprint,
      p,
    ),
    checks: npRequireAgentVerificationChecksV1(r.checks),
  };
  return digestAgentCanonicalSha256(
    new TextEncoder().encode(
      `np.agent-changeset-verification.v1\0${serializeAgentCanonicalJson(body)}`,
    ),
  );
}
