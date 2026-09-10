import { npRequireAgentContractResult, npAnalyzeAgentJsonSchema } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyArray,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodyUuid,
  canonicalBodySha256Digest,
  canonicalBodyCapabilities,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import {
  cloneCanonicalRuntimeInput,
  canonicalRuntimeText,
} from "./canonical-runtime-primitives.js";
import {
  npRequireAgentRollbackSummaryV1,
  npRequireAgentApprovalWire,
  npRequireAgentExecutionSummaryV1,
  npRequireAgentVerificationSummaryV1,
  npAgentChangeSetLimits,
  type NpAgentRollbackSummary,
  type NpAgentApprovalWire,
  type NpAgentExecutionSummary,
  type NpAgentVerificationSummary,
} from "./changeset-wire-contract.js";
import {
  npRequireAgentVerificationChecksV1,
  type NpAgentVerificationCheckV1,
  npAgentChangeSetExecutionDetailSchemaV1,
} from "./changeset-execution-contract.js";
import {
  npRequireAgentChangeSetReviewOperationsV1,
  npAgentChangeSetReviewOperationSchemaV1,
  type NpAgentChangeSetReviewOperationV1,
} from "./changeset-review-operations.js";
import {
  npAgentChangeSetWireSchemaV1,
  npAgentApprovalWireSchemaV1,
  npAgentExecutionSummarySchemaV1,
  npAgentVerificationSummarySchemaV1,
  npAgentSchemaObjectV1,
} from "./changeset-capability-schema.js";
import {
  npAgentScopes,
  npAgentRiskLevels,
  npAgentRiskReasonCodes,
  type NpAgentScope,
  type NpAgentRiskSummary,
  type NpAgentJsonObject,
  type NpAgentJsonValue,
} from "./types.js";
import type { NpCapability } from "../auth/capabilities.js";
export interface NpAgentRollbackPlanCreateInputV1 {
  schemaVersion: "np.agent-rollback-plan-create-input.v1";
  expectedVersion: number;
  planHash: string;
  idempotencyKey: string;
}
export interface NpAgentRollbackPlanRequestApprovalInputV1 extends Omit<
  NpAgentRollbackPlanCreateInputV1,
  "schemaVersion"
> {
  schemaVersion: "np.agent-rollback-plan-request-approval-input.v1";
}
export interface NpAgentRollbackPlanExecuteInputV1 extends Omit<
  NpAgentRollbackPlanCreateInputV1,
  "schemaVersion"
> {
  schemaVersion: "np.agent-rollback-plan-execute-input.v1";
  approvalId: string;
  statementHash: string;
}
export interface NpAgentRollbackDetailV1 {
  schemaVersion: "np.agent-rollback-detail.v1";
  changeSetId: string;
  summary: NpAgentRollbackSummary;
  version: number;
  compensatesExecutionId: string;
  originalPlanHash: string;
  appliedResultDigest: string;
  baseFingerprint: string | null;
  risk: NpAgentRiskSummary | null;
  requiredScopes: NpAgentScope[];
  requiredHumanCapabilities: NpCapability[];
  requiredHumanPredicates: Array<"is-super-admin">;
  policyHashes: string[];
  operations: Array<{
    review: NpAgentChangeSetReviewOperationV1;
    originalOperationOrdinal: number;
    rollbackClass: "full" | "residual" | "unavailable";
    residualCodes: string[];
  }>;
  approval: NpAgentApprovalWire | null;
  execution: NpAgentExecutionSummary | null;
  verification: NpAgentVerificationSummary | null;
  checks: NpAgentVerificationCheckV1[];
}
const state = () => ({ seen: new WeakSet<object>() });
const record = (v: unknown, p: string, k: string[]) => canonicalBodyRecord(v, p, k, k, state());
const en = <T extends string>(v: unknown, p: string, a: readonly T[]) =>
  canonicalBodyEnum<T>(v, p, new Set(a));
const positive = (v: unknown, p: string) => canonicalBodyInteger(v, p, 1, 2147483647);
const sorted = <T>(v: T[], p: string) => {
  if (v.some((x, i) => i > 0 && String(x) <= String(v[i - 1])))
    failCanonicalBody("order", p, "Values must be sorted and unique");
  return v;
};
function input(v: unknown, kind: "create" | "request-approval" | "execute") {
  const p = "agent.rollback.input";
  const schemaVersion = `np.agent-rollback-plan-${kind}-input.v1`;
  const r = record(cloneCanonicalRuntimeInput(v, p, 16384), p, [
    "schemaVersion",
    "expectedVersion",
    "planHash",
    "idempotencyKey",
    ...(kind === "execute" ? ["approvalId", "statementHash"] : []),
  ]);
  const idempotencyKey = canonicalRuntimeText(r.idempotencyKey, p, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(idempotencyKey))
    failCanonicalBody("invalid-field", p, "Invalid idempotency key");
  return {
    schemaVersion: en(r.schemaVersion, p, [schemaVersion]),
    expectedVersion: positive(r.expectedVersion, p),
    planHash: canonicalBodySha256Digest(r.planHash, p),
    idempotencyKey,
    ...(kind === "execute"
      ? {
          approvalId: canonicalBodyUuid(r.approvalId, p),
          statementHash: canonicalBodySha256Digest(r.statementHash, p),
        }
      : {}),
  };
}
export const npRequireAgentRollbackPlanCreateInputV1 = (v: unknown) =>
  input(v, "create") as NpAgentRollbackPlanCreateInputV1;
export const npRequireAgentRollbackPlanRequestApprovalInputV1 = (v: unknown) =>
  input(v, "request-approval") as NpAgentRollbackPlanRequestApprovalInputV1;
export const npRequireAgentRollbackPlanExecuteInputV1 = (v: unknown) =>
  input(v, "execute") as NpAgentRollbackPlanExecuteInputV1;
export function npAnalyzeAgentRollbackDetailV1(v: unknown) {
  return analyzeCanonicalBody("agent.rollback.detail", () => {
    const p = "agent.rollback.detail";
    const r = record(
      cloneCanonicalRuntimeInput(v, p, npAgentChangeSetLimits.wireBytes, {
        maximumDepth: 64,
        maximumNodes: npAgentChangeSetLimits.wireBytes,
        maximumArrayItems: 500,
        maximumObjectProperties: 10000,
        maximumStringCharacters: 1000000,
      }),
      p,
      [
        "schemaVersion",
        "changeSetId",
        "summary",
        "version",
        "compensatesExecutionId",
        "originalPlanHash",
        "appliedResultDigest",
        "baseFingerprint",
        "risk",
        "requiredScopes",
        "requiredHumanCapabilities",
        "requiredHumanPredicates",
        "policyHashes",
        "operations",
        "approval",
        "execution",
        "verification",
        "checks",
      ],
    );
    const summary = npRequireAgentRollbackSummaryV1(r.summary);
    const risk =
      r.risk === null
        ? null
        : (() => {
            const x = record(r.risk, p, ["level", "reasonCodes", "approvalMode", "reversible"]);
            if (typeof x.reversible !== "boolean")
              failCanonicalBody("invalid-field", p, "Invalid risk");
            return {
              level: en(x.level, p, npAgentRiskLevels),
              reasonCodes: sorted(
                canonicalBodyArray(x.reasonCodes, p, npAgentRiskReasonCodes.length, state()).map(
                  (x) => en(x, p, npAgentRiskReasonCodes),
                ),
                p,
              ),
              approvalMode: en(x.approvalMode, p, ["human"]),
              reversible: x.reversible,
            };
          })();
    const rawOps = canonicalBodyArray(r.operations, p, 500, state()).map((x) =>
      record(x, p, ["review", "originalOperationOrdinal", "rollbackClass", "residualCodes"]),
    );
    const reviews = npRequireAgentChangeSetReviewOperationsV1(rawOps.map((x) => x.review));
    const operations = rawOps.map((x, i) => ({
      review: reviews[i],
      originalOperationOrdinal: canonicalBodyInteger(x.originalOperationOrdinal, p, 1, 500),
      rollbackClass: en(x.rollbackClass, p, ["full", "residual", "unavailable"]),
      residualCodes: sorted(
        canonicalBodyArray(x.residualCodes, p, 64, state()).map((x) => {
          const code = canonicalRuntimeText(x, p, 128);
          if (!/^[A-Z][A-Z0-9_]*$/u.test(code))
            failCanonicalBody("invalid-field", p, "Invalid residual code");
          return code;
        }),
        p,
      ),
    }));
    if (
      operations.length !== summary.operationCount ||
      new Set(operations.map((x) => x.originalOperationOrdinal)).size !== operations.length
    )
      failCanonicalBody("invalid-field", p, "Operation inventory mismatch");
    if (operations.some((x) => x.rollbackClass === "residual" && !x.residualCodes.length))
      failCanonicalBody("invalid-field", p, "Residual compensation requires warnings");
    const approval = r.approval === null ? null : npRequireAgentApprovalWire(r.approval);
    if (approval?.id !== undefined && approval.id !== summary.approvalId)
      failCanonicalBody("invalid-field", p, "Approval mismatch");
    const baseFingerprint =
      r.baseFingerprint === null ? null : canonicalBodySha256Digest(r.baseFingerprint, p);
    if (
      (summary.planHash === null) !== (baseFingerprint === null) ||
      (summary.planHash === null) !== (risk === null)
    )
      failCanonicalBody("invalid-field", p, "Sealed facts must appear together");
    return {
      schemaVersion: en(r.schemaVersion, p, ["np.agent-rollback-detail.v1"]),
      changeSetId: canonicalBodyUuid(r.changeSetId, p),
      summary,
      version: positive(r.version, p),
      compensatesExecutionId: canonicalBodyUuid(r.compensatesExecutionId, p),
      originalPlanHash: canonicalBodySha256Digest(r.originalPlanHash, p),
      appliedResultDigest: canonicalBodySha256Digest(r.appliedResultDigest, p),
      baseFingerprint,
      risk,
      operations,
      approval,
      requiredScopes: sorted(
        canonicalBodyArray(r.requiredScopes, p, npAgentScopes.length, state()).map((x) =>
          en(x, p, npAgentScopes),
        ),
        p,
      ),
      requiredHumanCapabilities: canonicalBodyCapabilities(r.requiredHumanCapabilities, p, state()),
      requiredHumanPredicates: sorted(
        canonicalBodyArray(r.requiredHumanPredicates, p, 1, state()).map((x) =>
          en(x, p, ["is-super-admin"]),
        ),
        p,
      ),
      policyHashes: sorted(
        canonicalBodyArray(r.policyHashes, p, 64, state()).map((x) =>
          canonicalBodySha256Digest(x, p),
        ),
        p,
      ),
      execution: r.execution === null ? null : npRequireAgentExecutionSummaryV1(r.execution),
      verification:
        r.verification === null ? null : npRequireAgentVerificationSummaryV1(r.verification),
      checks: npRequireAgentVerificationChecksV1(r.checks),
    } satisfies NpAgentRollbackDetailV1;
  });
}
export const npRequireAgentRollbackDetailV1 = (v: unknown) =>
  npRequireAgentContractResult(npAnalyzeAgentRollbackDetailV1(v));
const obj = npAgentSchemaObjectV1;
const digest = { type: "string", maxLength: 54, pattern: "^cj1:sha256:[A-Za-z0-9_-]{43}$" },
  uuid = { type: "string", maxLength: 36, format: "uuid" },
  pos = { type: "integer", minimum: 1, maximum: 2147483647 };
const nullable = (x: NpAgentJsonValue) => ({ anyOf: [x, { type: "null" }] });
const makeInput = (kind: string, execute = false) =>
  obj({
    schemaVersion: { const: `np.agent-rollback-plan-${kind}-input.v1` },
    expectedVersion: pos,
    planHash: digest,
    idempotencyKey: {
      type: "string",
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    },
    ...(execute ? { approvalId: uuid, statementHash: digest } : {}),
  });
const schema = (v: unknown) =>
  npRequireAgentContractResult(
    npAnalyzeAgentJsonSchema(
      JSON.parse(
        JSON.stringify({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          ...(v as object),
        }),
      ),
    ),
  );
export const npAgentRollbackPlanCreateInputSchemaV1 = schema(makeInput("create"));
export const npAgentRollbackPlanRequestApprovalInputSchemaV1 = schema(
  makeInput("request-approval"),
);
export const npAgentRollbackPlanExecuteInputSchemaV1 = schema(makeInput("execute", true));
const props = npAgentChangeSetWireSchemaV1.properties as NpAgentJsonObject;
const approvalProps = npAgentApprovalWireSchemaV1.properties as NpAgentJsonObject;
export const npAgentRollbackDetailSchemaV1 = schema({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...obj({
    schemaVersion: { const: "np.agent-rollback-detail.v1" },
    changeSetId: uuid,
    summary:
      (props.rollback as NpAgentJsonObject).anyOf instanceof Array
        ? ((props.rollback as NpAgentJsonObject).anyOf as NpAgentJsonValue[])[0]
        : props.rollback,
    version: pos,
    compensatesExecutionId: uuid,
    originalPlanHash: digest,
    appliedResultDigest: digest,
    baseFingerprint: nullable(digest),
    risk: props.risk,
    requiredScopes: {
      type: "array",
      maxItems: npAgentScopes.length,
      uniqueItems: true,
      items: { enum: [...npAgentScopes] },
    },
    requiredHumanCapabilities: approvalProps.requiredHumanCapabilities,
    requiredHumanPredicates: approvalProps.requiredHumanPredicates,
    policyHashes: { type: "array", maxItems: 64, uniqueItems: true, items: digest },
    operations: {
      type: "array",
      maxItems: 500,
      items: obj({
        review: npAgentChangeSetReviewOperationSchemaV1,
        originalOperationOrdinal: { type: "integer", minimum: 1, maximum: 500 },
        rollbackClass: { enum: ["full", "residual", "unavailable"] },
        residualCodes: {
          type: "array",
          maxItems: 64,
          uniqueItems: true,
          items: { type: "string", maxLength: 128, pattern: "^[A-Z][A-Z0-9_]*$" },
        },
      }),
    },
    approval: nullable(npAgentApprovalWireSchemaV1),
    execution: nullable(npAgentExecutionSummarySchemaV1),
    verification: nullable(npAgentVerificationSummarySchemaV1),
    checks: (npAgentChangeSetExecutionDetailSchemaV1.properties as NpAgentJsonObject).checks,
  }),
  $defs: { json: (npAgentChangeSetWireSchemaV1.$defs as NpAgentJsonObject).json },
});
