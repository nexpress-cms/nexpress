import {
  npRequireAgentRollbackDetailV1,
  npAgentRollbackDetailSchemaV1,
  type NpAgentRollbackDetailV1,
} from "./rollback-contract.js";
import {
  npRequireAgentChangeSetReviewOperationsV1,
  npAgentChangeSetReviewOperationSchemaV1,
  type NpAgentChangeSetReviewOperationV1,
} from "./changeset-review-operations.js";
export type {
  NpAgentChangeSetReviewOperationV1,
  NpAgentChangeSetReviewValueV1,
} from "./changeset-review-operations.js";
import {
  npRequireAgentChangeSetExecutionDetailV1,
  npAgentChangeSetExecutionDetailSchemaV1,
  type NpAgentChangeSetExecutionDetailV1,
} from "./changeset-execution-contract.js";
import {
  npAgentChangeSetWireSchemaV1,
  npAgentApprovalWireSchemaV1,
  npAgentSchemaObjectV1,
  npCompactAgentWireSchemaV1,
} from "./changeset-capability-schema.js";
import type { NpAgentJsonSchema, NpAgentJsonObject } from "./types.js";
import type { NpCapability } from "../auth/capabilities.js";
import { npCollectionContractLimits } from "../collection-contract/contract.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyArray,
  canonicalBodyCapabilities,
  canonicalBodyEnum,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import {
  npAgentChangeSetLimits,
  npRequireAgentChangeSetWire,
  type NpAgentChangeSetWire,
} from "./changeset-wire-contract.js";

export interface NpAgentChangeSetReviewV1 {
  schemaVersion: "np.agent-changeset-review.v1";
  changeSet: NpAgentChangeSetWire;
  requiredStaffCapabilities: NpCapability[];
  operations: NpAgentChangeSetReviewOperationV1[];
  rollbackDetail: NpAgentRollbackDetailV1 | null;
  rollbackActions: Array<"prepare" | "request_approval" | "execute" | "cancel">;
  executionDetail: NpAgentChangeSetExecutionDetailV1 | null;
  executionActions: Array<"apply" | "schedule" | "cancel">;
}
const state = () => ({ seen: new WeakSet<object>() });
function record(value: unknown, path: string, keys: string[]) {
  return canonicalBodyRecord(value, path, keys, keys, state());
}
export function npAnalyzeAgentChangeSetReviewV1(input: unknown) {
  return analyzeCanonicalBody("agent.changeset.review", () => {
    const path = "agent.changeset.review";
    const cloned = cloneCanonicalRuntimeInput(input, path, npAgentChangeSetLimits.wireBytes, {
      maximumDepth: npCollectionContractLimits.jsonDepth + 20,
      maximumNodes: npAgentChangeSetLimits.wireBytes,
      maximumArrayItems: npCollectionContractLimits.arrayRows,
      maximumObjectProperties: npCollectionContractLimits.jsonKeys,
      maximumStringCharacters: npCollectionContractLimits.stringLength,
    });
    const r = record(cloned, path, [
      "schemaVersion",
      "changeSet",
      "requiredStaffCapabilities",
      "operations",
      "rollbackDetail",
      "rollbackActions",
      "executionDetail",
      "executionActions",
    ]);
    const changeSet = npRequireAgentChangeSetWire(r.changeSet);
    const operations = npRequireAgentChangeSetReviewOperationsV1(r.operations);
    if (operations.length !== changeSet.operations.length)
      failCanonicalBody("invalid-field", path, "Review must cover every operation");
    const executionActions = canonicalBodyArray(r.executionActions, path, 3, state()).map((value) =>
      canonicalBodyEnum<"apply" | "schedule" | "cancel">(
        value,
        path,
        new Set(["apply", "schedule", "cancel"]),
      ),
    );
    const actionOrder = ["apply", "schedule", "cancel"];
    if (
      executionActions.some(
        (action, index) =>
          index > 0 &&
          actionOrder.indexOf(executionActions[index - 1]) >= actionOrder.indexOf(action),
      )
    )
      failCanonicalBody("order", path, "Execution actions must follow the fixed unique inventory");
    const executionDetail =
      r.executionDetail === null
        ? null
        : npRequireAgentChangeSetExecutionDetailV1(r.executionDetail);
    if (
      executionDetail &&
      (executionDetail.changeSetId !== changeSet.id ||
        executionDetail.planHash !== changeSet.planHash ||
        executionDetail.execution.executionId !== changeSet.execution?.executionId)
    )
      failCanonicalBody("invalid-field", path, "Execution detail must match the ChangeSet");
    const rollbackDetail =
      r.rollbackDetail === null ? null : npRequireAgentRollbackDetailV1(r.rollbackDetail);
    if (
      rollbackDetail &&
      (rollbackDetail.changeSetId !== changeSet.id ||
        rollbackDetail.originalPlanHash !== changeSet.planHash ||
        rollbackDetail.summary.rollbackPlanId !== changeSet.rollback?.rollbackPlanId)
    )
      failCanonicalBody("invalid-field", path, "Rollback detail must match parent");
    const rollbackOrder = ["prepare", "request_approval", "execute", "cancel"];
    const rollbackActions = canonicalBodyArray(r.rollbackActions, path, 4, state()).map((x) =>
      canonicalBodyEnum<"prepare" | "request_approval" | "execute" | "cancel">(
        x,
        path,
        new Set(rollbackOrder),
      ),
    );
    if (
      rollbackActions.some(
        (x, i) =>
          i > 0 && rollbackOrder.indexOf(x) <= rollbackOrder.indexOf(rollbackActions[i - 1]),
      )
    )
      failCanonicalBody("order", path, "Rollback actions must be ordered unique");
    return {
      rollbackDetail,
      rollbackActions,
      executionDetail,
      executionActions,
      schemaVersion: canonicalBodyEnum<"np.agent-changeset-review.v1">(
        r.schemaVersion,
        `${path}.schemaVersion`,
        new Set(["np.agent-changeset-review.v1"]),
      ),
      changeSet,
      requiredStaffCapabilities: canonicalBodyCapabilities(
        r.requiredStaffCapabilities,
        `${path}.requiredStaffCapabilities`,
        state(),
      ),
      operations,
    } satisfies NpAgentChangeSetReviewV1;
  });
}
export function npRequireAgentChangeSetReviewV1(value: unknown): NpAgentChangeSetReviewV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentChangeSetReviewV1(value),
    "Invalid ChangeSet review",
  );
}

/** Closed review-only additions; the embedded ChangeSet retains its existing contract. */
export const npAgentChangeSetReviewInventoryV1 = Object.freeze({
  schemaVersion: "np.agent-changeset-review.v1",
  keys: [
    "schemaVersion",
    "changeSet",
    "requiredStaffCapabilities",
    "operations",
    "rollbackDetail",
    "rollbackActions",
    "executionDetail",
    "executionActions",
  ],
  operationKeys: ["ordinal", "evidence", "fields"],
  fieldKeys: ["path", "before", "after"],
  valueKeys: ["presence", "value"],
  evidence: ["available", "not_validated", "redacted", "expired"],
  presence: ["present", "absent", "redacted"],
  maximumOperations: npAgentChangeSetLimits.operations,
  maximumFields: npCollectionContractLimits.jsonKeys,
  maximumPathCharacters: 512,
  maximumBytes: npAgentChangeSetLimits.wireBytes,
} as const);

/** Discovery projection of the existing safe review; canonical analyzers own semantic checks. */
const {
  $defs: reviewWireDefinitions,
  $schema: reviewWireDialect,
  ...reviewWireNode
} = npAgentChangeSetWireSchemaV1;
const reviewObject = npAgentSchemaObjectV1;
const reviewSchemaSource: NpAgentJsonSchema = JSON.parse(
  JSON.stringify({
    $schema: reviewWireDialect,
    ...reviewObject({
      schemaVersion: { const: npAgentChangeSetReviewInventoryV1.schemaVersion },
      changeSet: { $ref: "#/$defs/changeset" },
      rollbackDetail: { anyOf: [{ $ref: "#/$defs/rollbackDetail" }, { type: "null" }] },
      rollbackActions: {
        type: "array",
        maxItems: 4,
        uniqueItems: true,
        items: { enum: ["prepare", "request_approval", "execute", "cancel"] },
      },
      executionDetail: { anyOf: [{ $ref: "#/$defs/executionDetail" }, { type: "null" }] },
      executionActions: {
        type: "array",
        maxItems: 3,
        uniqueItems: true,
        items: { enum: ["apply", "schedule", "cancel"] },
      },
      requiredStaffCapabilities: (npAgentApprovalWireSchemaV1.properties as NpAgentJsonObject)
        .requiredHumanCapabilities,
      operations: {
        type: "array",
        maxItems: npAgentChangeSetLimits.operations,
        items: npAgentChangeSetReviewOperationSchemaV1,
      },
    }),
    $defs: {
      ...(reviewWireDefinitions as NpAgentJsonObject),
      changeset: reviewWireNode,
      rollbackDetail: npAgentRollbackDetailSchemaV1,
      executionDetail: npAgentChangeSetExecutionDetailSchemaV1,
    },
  }),
) as NpAgentJsonSchema;

export const npAgentChangeSetReviewSchemaV1 = npCompactAgentWireSchemaV1(reviewSchemaSource);
