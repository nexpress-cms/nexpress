import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NpOperatorProgressObservationV1 } from "@nexpress/core/jobs";
const owners = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("@nexpress/core/jobs", () => ({
  npCollectOperatorProgressObservationV1: owners.collect,
}));
import {
  collectOperatorProgressObservation,
  projectOperatorProgressObservation,
} from "./operator-progress-observation";

function fixture(): NpOperatorProgressObservationV1 {
  return {
    schemaVersion: "np.operator-progress-observation.v1",
    source: "pg-boss",
    scope: { kind: "site", siteId: "default" },
    state: "observed",
    generatedAt: "2026-10-15T01:00:00.000Z",
    windowStart: "2026-10-15T00:45:00.000Z",
    windowSeconds: 900,
    coveredQueues: ["agent.runExecute"],
    complete: true,
    inspectedCount: 5,
    started: 3,
    completed: 1,
    failed: 1,
    cancelled: 2,
  };
}

describe("Operator retained transition evidence", () => {
  beforeEach(() => vi.resetAllMocks());
  it("projects actual timestamps separately from failure and cancellation without a worker-health conclusion", () => {
    const result = projectOperatorProgressObservation(fixture());
    expect(result.check.id).toBe("operator.jobs.progress");
    expect(result.check.detail).toContain("Actual transition timestamps");
    expect(result.check.state).toBe("warn");
    expect(result.check.detail?.length).toBeLessThanOrEqual(500);
    expect(result.evidenceRefs).toContain("progress:observed");
    expect(result.evidenceRefs).toContain("fact:cancelled:2");
    expect(result.evidenceRefs.length).toBeLessThanOrEqual(32);
    expect(result.targetCount).toBe(5);
  });
  it("keeps zero, partial and unavailable history unknown instead of declaring a stalled worker", () => {
    const zero = { ...fixture(), started: 0, completed: 0 };
    for (const input of [
      zero,
      { ...fixture(), complete: false },
      { ...fixture(), state: "unavailable" as const },
    ]) {
      const result = projectOperatorProgressObservation(input);
      expect(result.evidenceRefs).toContain("progress:unknown");
      expect(result.check.detail).toContain("Progress is unknown");
      expect(result.check.detail).not.toContain("establish sampled progress");
    }
    const deployment = projectOperatorProgressObservation({
      ...zero,
      scope: { kind: "deployment" },
    });
    expect(deployment.check.id).toBe("operator.worker.progress");
    expect(deployment.check.detail).toContain("Deployment Agent");
    const unknown = projectOperatorProgressObservation(
      {
        ...fixture(),
        state: "unavailable",
        inspectedCount: null,
        started: null,
        completed: null,
        failed: null,
        cancelled: null,
      },
      100,
    );
    expect(unknown).toMatchObject({ targetCount: 0, consumedTargets: 100 });
    expect(unknown.evidenceRefs).toContain("fact:inspectedCount:unknown");
  });
  it("collects only after current authority and withholds results on authority loss or cancellation", async () => {
    owners.collect.mockResolvedValue(fixture());
    const authorize = vi.fn(async () => {});
    const options = {
      scope: { kind: "site" as const, siteId: "default" },
      maxTargets: 10,
      authorize,
      abortSignal: new AbortController().signal,
    };
    await collectOperatorProgressObservation(options);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(owners.collect).toHaveBeenCalledExactlyOnceWith({
      scope: options.scope,
      maxTargets: 10,
    });
    authorize.mockRejectedValueOnce(new Error("denied"));
    owners.collect.mockClear();
    await expect(collectOperatorProgressObservation(options)).rejects.toThrow("denied");
    expect(owners.collect).not.toHaveBeenCalled();
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(collectOperatorProgressObservation(options)).rejects.toThrow("revoked");
    const controller = new AbortController();
    owners.collect.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(fixture());
    });
    await expect(
      collectOperatorProgressObservation({ ...options, abortSignal: controller.signal }),
    ).rejects.toThrow();
  });
});
