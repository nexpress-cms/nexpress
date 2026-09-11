import { describe, expect, it } from "vitest";
import { npHasFreshChangeSetExecutionOutputV1 } from "./changeset-execution-projection.js";

describe("ChangeSet terminal transport evidence", () => {
  const execution = {
    id: "execution",
    purpose: "apply",
    rollbackPlanId: null,
    planHash: "plan",
    resultDigest: "result",
  };
  const snapshot = {
    execution: {
      executionId: "execution",
      state: "succeeded" as const,
      resultDigest: "result",
      startedAt: "2026-09-11T00:00:00.000Z",
      finishedAt: "2026-09-11T00:00:01.000Z",
    },
    rollback: null,
  };
  it("leaves a concurrent successful commit pending when the caller still holds accepted output", () => {
    expect(
      npHasFreshChangeSetExecutionOutputV1(execution, { state: "accepted", changeSet: snapshot }),
    ).toBe(false);
    expect(
      npHasFreshChangeSetExecutionOutputV1(execution, {
        state: "completed",
        changeSet: {
          ...snapshot,
          execution: { ...snapshot.execution, state: "reserved", resultDigest: null },
        },
      }),
    ).toBe(false);
    expect(
      npHasFreshChangeSetExecutionOutputV1(execution, {
        state: "completed",
        changeSet: { ...snapshot, execution: { ...snapshot.execution, resultDigest: "other" } },
      }),
    ).toBe(false);
    expect(
      npHasFreshChangeSetExecutionOutputV1(execution, { state: "completed", changeSet: snapshot }),
    ).toBe(true);
  });
  it("never uses the original successful apply result as rollback completion evidence", () => {
    const rollback = { ...execution, purpose: "rollback", rollbackPlanId: "rollback" };
    expect(
      npHasFreshChangeSetExecutionOutputV1(rollback, { state: "completed", changeSet: snapshot }),
    ).toBe(false);
    const plan = {
      rollbackPlanId: "rollback",
      generation: 1,
      state: "verified" as const,
      planHash: "plan",
      approvalId: null,
      operationCount: 1,
      createdAt: "2026-09-11T00:00:00.000Z",
      expiresAt: "2026-09-12T00:00:00.000Z",
      finishedAt: "2026-09-11T00:00:01.000Z",
      terminalReason: null,
    };
    expect(
      npHasFreshChangeSetExecutionOutputV1(rollback, {
        state: "completed",
        changeSet: { ...snapshot, rollback: plan },
      }),
    ).toBe(true);
    expect(
      npHasFreshChangeSetExecutionOutputV1(rollback, {
        state: "completed",
        changeSet: { ...snapshot, rollback: { ...plan, state: "executing", finishedAt: null } },
      }),
    ).toBe(false);
  });
});
