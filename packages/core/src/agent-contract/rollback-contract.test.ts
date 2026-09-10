import { describe, it, expect } from "vitest";
import {
  npRequireAgentRollbackDetailV1,
  npRequireAgentRollbackPlanCreateInputV1,
  npRequireAgentRollbackPlanRequestApprovalInputV1,
  npRequireAgentRollbackPlanExecuteInputV1,
  npAgentRollbackDetailSchemaV1,
} from "./rollback-contract.js";
import { npRequireAgentChangeSetRollbackCompensationInputV1 } from "./canonical-changeset.js";
import { npAnalyzeAgentChangeSetOperationInput } from "./changeset-contract.js";
import { npAnalyzeAgentJsonSchema } from "./contract.js";
import { npNormalizeJobPayload } from "../jobs-contract/contract.js";
const id = "11111111-1111-4111-8111-111111111111",
  hash = `cj1:sha256:${"A".repeat(43)}`,
  time = "2026-09-10T00:00:00.000Z";
function detail() {
  return {
    schemaVersion: "np.agent-rollback-detail.v1",
    changeSetId: id,
    summary: {
      rollbackPlanId: id,
      generation: 1,
      state: "ready",
      planHash: hash,
      approvalId: null,
      operationCount: 1,
      createdAt: time,
      expiresAt: "2026-09-10T01:00:00.000Z",
      finishedAt: null,
      terminalReason: null,
    },
    version: 1,
    compensatesExecutionId: id,
    originalPlanHash: hash,
    appliedResultDigest: hash,
    baseFingerprint: hash,
    risk: { level: "low", reasonCodes: [], approvalMode: "human", reversible: true },
    requiredScopes: ["changeset:apply"],
    requiredHumanCapabilities: ["content.publish"],
    requiredHumanPredicates: [],
    policyHashes: [],
    operations: [
      {
        review: { ordinal: 1, evidence: "available", fields: [] },
        originalOperationOrdinal: 1,
        rollbackClass: "full",
        residualCodes: [],
      },
    ],
    approval: null,
    execution: null,
    verification: null,
    checks: [],
  };
}
describe("rollback contracts", () => {
  it("binds exact current versions/hashes with128 character idempotency", () => {
    const common = { expectedVersion: 1, planHash: hash, idempotencyKey: "a".repeat(128) };
    expect(
      npRequireAgentRollbackPlanCreateInputV1({
        ...common,
        schemaVersion: "np.agent-rollback-plan-create-input.v1",
      }),
    ).toMatchObject(common);
    expect(
      npRequireAgentRollbackPlanRequestApprovalInputV1({
        ...common,
        schemaVersion: "np.agent-rollback-plan-request-approval-input.v1",
      }),
    ).toMatchObject(common);
    const execute = {
      ...common,
      schemaVersion: "np.agent-rollback-plan-execute-input.v1",
      approvalId: id,
      statementHash: hash,
    };
    expect(npRequireAgentRollbackPlanExecuteInputV1(execute)).toEqual(execute);
    for (const bad of [
      { ...execute, expectedVersion: 0 },
      { ...execute, siteId: "other" },
      { ...execute, idempotencyKey: "a".repeat(129) },
      { ...execute, statementHash: null },
    ])
      expect(() => npRequireAgentRollbackPlanExecuteInputV1(bad)).toThrow();
  });
  it("requires exact safe rollback evidence and original operation mapping", () => {
    expect(npRequireAgentRollbackDetailV1(detail())).toEqual(detail());
    expect(npAnalyzeAgentJsonSchema(npAgentRollbackDetailSchemaV1).ok).toBe(true);
    for (const bad of [
      { ...detail(), snapshot: {} },
      { ...detail(), baseFingerprint: null },
      { ...detail(), operations: [] },
      { ...detail(), operations: [{ ...detail().operations[0], rollbackClass: "residual" }] },
    ])
      expect(() => npRequireAgentRollbackDetailV1(bad)).toThrow();
  });
  it("keeps full snapshot restore inside rollback compensation only", () => {
    for (const restore of [
      { kind: "document", operation: "restore", resource: { collection: "posts", documentId: id } },
      { kind: "theme_tokens", operation: "restore", resource: { themeId: "default" } },
    ]) {
      expect(npRequireAgentChangeSetRollbackCompensationInputV1(restore)).toEqual(restore);
      expect(npAnalyzeAgentChangeSetOperationInput(restore).ok).toBe(false);
      expect(() =>
        npRequireAgentChangeSetRollbackCompensationInputV1({
          ...restore,
          input: { rawSnapshot: {} },
        }),
      ).toThrow();
    }
  });
  it("uses one exact host rollback job payload", () => {
    const job = {
      siteId: "default",
      changeSetId: id,
      rollbackPlanId: id,
      planHash: hash,
      approvalId: id,
      idempotencyKey: "rollback-1",
    };
    expect(npNormalizeJobPayload("agent:changesetRollback", job)).toEqual(job);
    expect(() =>
      npNormalizeJobPayload("agent:changesetRollback", { ...job, scheduledFor: time }),
    ).toThrow();
  });
});
