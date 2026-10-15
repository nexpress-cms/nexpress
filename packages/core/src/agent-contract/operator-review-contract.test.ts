import { describe, expect, it } from "vitest";
import { npRequireAgentOperatorReviewV1 } from "./operator-review-contract.js";
const id = "11111111-1111-4111-8111-111111111111";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const base = {
  schemaVersion: "np.agent-operator-review.v1",
  capabilityId: "ops.plan",
  checks: [{ id: "jobs.contract", state: "fail" }],
  plan: {
    schemaVersion: "np.agent-ops-plan.v1",
    planId: id,
    planDigest: digest,
    checks: [{ id: "queue.current-observation", status: "pass" }],
    expiresAt: "2026-10-16T01:00:00.000Z",
    operation: {
      action: "queue.global.plan",
      target: { kind: "queue", operation: "drain", jobName: null },
    },
    execution: {
      kind: "local-cli-handoff",
      contractId: "runbook",
      planArtifactId: id,
      projectCommand: "pnpm --silent run ops:runbook -- worker-not-draining --json",
    },
  },
  queue: { observedAt: "2026-10-16T00:00:00.000Z", paused: false, ready: 10, active: 1 },
  recovery: null,
  execution: null,
};
describe("safe retained Operator review", () => {
  it("retains exact failed check IDs and rejects private/foreign fields rather than widening evidence", () => {
    expect(npRequireAgentOperatorReviewV1(base).checks).toEqual([
      { id: "jobs.contract", state: "fail" },
    ]);
    expect(() =>
      npRequireAgentOperatorReviewV1({ ...base, artifact: { path: "/private/secret" } }),
    ).toThrow();
    expect(() =>
      npRequireAgentOperatorReviewV1({
        ...base,
        queue: { ...base.queue, workers: ["private-worker"] },
      }),
    ).toThrow();
    expect(() => npRequireAgentOperatorReviewV1({ ...base, capabilityId: "ops.status" })).toThrow();
  });
  it("rejects forged recovery relationships and non-decreasing recovery claims", () => {
    const recovery = {
      monitorId: id,
      state: "recovered",
      reason: "backlog-decreased-with-live-worker",
      startedAt: "2026-10-16T00:00:00.000Z",
      sampledAt: "2026-10-16T00:01:00.000Z",
      deadline: "2026-10-16T00:15:00.000Z",
      beforePending: 11,
      afterPending: 5,
    };
    expect(npRequireAgentOperatorReviewV1({ ...base, recovery }).recovery?.state).toBe("recovered");
    expect(() =>
      npRequireAgentOperatorReviewV1({ ...base, recovery: { ...recovery, afterPending: 11 } }),
    ).toThrow();
    expect(() =>
      npRequireAgentOperatorReviewV1({
        ...base,
        recovery: { ...recovery, monitorId: "22222222-2222-4222-8222-222222222222" },
      }),
    ).toThrow();
  });
});
