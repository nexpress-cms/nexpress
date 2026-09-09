import { npAgentAdminOperationsV1 } from "./admin-operation-registry.js";
import { npAgentChangeSetReviewSchemaV1 } from "./changeset-review-contract.js";
import { describe, it, expect } from "vitest";
import {
  npRequireAgentVerificationChecksV1,
  npDigestAgentVerificationResultV1,
  npRequireAgentChangeSetApplyInputV1,
  npRequireAgentChangeSetScheduleInputV1,
  npRequireAgentChangeSetCancelInputV1,
  npRequireAgentChangeSetExecutionDetailV1,
  npAgentChangeSetExecutionDetailSchemaV1,
  npAgentVerificationCheckIdsV1,
  type NpAgentChangeSetExecutionDetailV1,
} from "./changeset-execution-contract.js";
import { npAnalyzeAgentJsonSchema } from "./contract.js";
const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  hash = `cj1:sha256:${"A".repeat(43)}`,
  time = "2026-09-09T00:00:00.000Z";
const apply = {
  schemaVersion: "np.agent-changeset-apply-input.v1",
  expectedDraftVersion: 1,
  planHash: hash,
  approvalId: id,
  statementHash: hash,
  idempotencyKey: "apply-1",
};
function detail(): NpAgentChangeSetExecutionDetailV1 {
  return {
    schemaVersion: "np.agent-changeset-execution.v1",
    changeSetId: id,
    execution: {
      executionId: id,
      state: "reserved",
      resultDigest: null,
      startedAt: time,
      finishedAt: null,
    },
    approvalId: id,
    planHash: hash,
    scheduledFor: null,
    committedAt: null,
    rollbackEligibleUntil: null,
    errorCode: null,
    verification: null,
    checks: [],
  };
}
describe("ChangeSet execution contracts", () => {
  it("uses exact review outputs and sealed version preconditions on existing Admin rows", () => {
    for (const id of [
      "agents.changesets.apply",
      "agents.changesets.schedule",
      "agents.changesets.cancel",
    ] as const) {
      expect(npAgentAdminOperationsV1[id].preconditions.map((p) => p.field)).toEqual([
        "expectedDraftVersion",
        "planHash",
      ]);
      expect(npAgentAdminOperationsV1[id].schemas.output.schema).toEqual(
        npAgentChangeSetReviewSchemaV1,
      );
    }
  });
  it("requires exact apply and schedule approval bindings", () => {
    expect(npRequireAgentChangeSetApplyInputV1(apply)).toEqual(apply);
    const schedule = {
      ...apply,
      schemaVersion: "np.agent-changeset-schedule-input.v1",
      scheduledFor: time,
    };
    expect(npRequireAgentChangeSetScheduleInputV1(schedule)).toEqual(schedule);
    for (const bad of [
      { ...apply, expectedDraftVersion: 0 },
      { ...apply, scheduledFor: time },
      { ...apply, siteId: "tenant" },
      { ...apply, statementHash: "raw" },
    ])
      expect(() => npRequireAgentChangeSetApplyInputV1(bad)).toThrow();
    expect(() =>
      npRequireAgentChangeSetScheduleInputV1({ ...schedule, scheduledFor: null }),
    ).toThrow();
  });
  it("closes cancellation to the exact current cancellable state and sealedness", () => {
    const cancel = {
      schemaVersion: "np.agent-changeset-cancel-input.v1",
      expectedDraftVersion: 1,
      expectedState: "draft",
      planHash: null,
      reasonCode: "OPERATOR_CANCELLED",
      reason: null,
      idempotencyKey: "cancel-1",
    };
    expect(npRequireAgentChangeSetCancelInputV1(cancel)).toEqual(cancel);
    expect(
      npRequireAgentChangeSetCancelInputV1({
        ...cancel,
        expectedState: "scheduled",
        planHash: hash,
      }).expectedState,
    ).toBe("scheduled");
    for (const bad of [
      { ...cancel, expectedState: "applying" },
      { ...cancel, expectedState: "approved" },
      { ...cancel, planHash: hash },
      { ...cancel, reasonCode: "INTERNAL_ERROR" },
    ])
      expect(() => npRequireAgentChangeSetCancelInputV1(bad)).toThrow();
  });
  it("distinguishes database commit and verification without leaking raw evidence", () => {
    expect(npRequireAgentChangeSetExecutionDetailV1(detail())).toEqual(detail());
    const committed = {
      ...detail(),
      execution: { ...detail().execution, state: "committed" as const, resultDigest: hash },
      committedAt: time,
      rollbackEligibleUntil: "2026-09-10T00:00:00.000Z",
    };
    expect(npRequireAgentChangeSetExecutionDetailV1(committed).committedAt).toBe(time);
    for (const bad of [
      { ...detail(), credential: "hidden" },
      { ...detail(), committedAt: time },
      {
        ...detail(),
        verification: {
          state: "queued",
          requiredPassed: 0,
          requiredFailed: 0,
          advisoryWarnings: 0,
          digest: null,
          completedAt: null,
        },
      },
      { ...committed, rollbackEligibleUntil: null },
    ])
      expect(() => npRequireAgentChangeSetExecutionDetailV1(bad)).toThrow();
  });
  it("locks check identities, ordinal evidence and fixed order", () => {
    const check = {
      checkId: "resource_after_hashes" as const,
      required: true,
      severity: "error" as const,
      status: "passed" as const,
      evidenceRefs: [{ kind: "operation" as const, id: "1" }],
      nextAction: "none" as const,
    };
    const value = {
      ...detail(),
      execution: { ...detail().execution, state: "verifying" as const, resultDigest: hash },
      committedAt: time,
      rollbackEligibleUntil: "2026-09-10T00:00:00.000Z",
      checks: [check],
    };
    expect(npRequireAgentChangeSetExecutionDetailV1(value).checks).toEqual([check]);
    for (const checks of [
      [check, check],
      [{ ...check, checkId: "raw_provider" }],
      [{ ...check, evidenceRefs: [{ kind: "operation", id: "501" }] }],
      [{ ...check, rawBody: {} }],
    ])
      expect(() => npRequireAgentChangeSetExecutionDetailV1({ ...value, checks })).toThrow();
    expect(npAgentVerificationCheckIdsV1).toEqual([
      "resource_after_hashes",
      "revisions_audit",
      "post_commit_hooks",
      "cache",
      "search",
      "media",
      "public_routes",
    ]);
    expect(npAnalyzeAgentJsonSchema(npAgentChangeSetExecutionDetailSchemaV1).ok).toBe(true);
  });
});

it("bounds execution keys and treats ambiguity as finished but fenced", () => {
  expect(
    npRequireAgentChangeSetApplyInputV1({ ...apply, idempotencyKey: "a".repeat(128) })
      .idempotencyKey,
  ).toHaveLength(128);
  expect(() =>
    npRequireAgentChangeSetApplyInputV1({ ...apply, idempotencyKey: "a".repeat(129) }),
  ).toThrow();
  const ambiguous = detail();
  ambiguous.execution.state = "ambiguous";
  ambiguous.errorCode = "EFFECT_AMBIGUOUS";
  expect(() => npRequireAgentChangeSetExecutionDetailV1(ambiguous)).toThrow();
  ambiguous.execution.finishedAt = time;
  expect(npRequireAgentChangeSetExecutionDetailV1(ambiguous).execution.state).toBe("ambiguous");
});
it("binds exact ordered verification checks to site, execution and contract", async () => {
  const check = {
    checkId: "resource_after_hashes",
    required: true,
    severity: "error",
    status: "passed",
    evidenceRefs: [],
    nextAction: "none",
  };
  expect(npRequireAgentVerificationChecksV1([check])).toEqual([check]);
  expect(() => npRequireAgentVerificationChecksV1([check, check])).toThrow();
  expect(() => npRequireAgentVerificationChecksV1([{ ...check, rawBody: "hidden" }])).toThrow();
  const body = {
    siteId: "default",
    changeSetId: id,
    executionId: id,
    verificationContractFingerprint: hash,
    checks: [check],
  };
  const digest = await npDigestAgentVerificationResultV1(body);
  expect(digest).not.toBe(
    await npDigestAgentVerificationResultV1({ ...body, siteId: "another-site" }),
  );
  await expect(npDigestAgentVerificationResultV1({ ...body, locator: "hidden" })).rejects.toThrow();
});
