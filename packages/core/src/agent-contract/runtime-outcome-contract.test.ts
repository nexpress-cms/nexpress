import { describe, expect, it } from "vitest";
import {
  NP_AGENT_RUNTIME_OUTCOME_STATES,
  npRequireAgentRuntimeOutcomeV1,
  type NpAgentRuntimeOutcomeV1,
} from "./runtime-outcome-contract.js";

function evidence(): NpAgentRuntimeOutcomeV1 {
  return {
    schemaVersion: "np.agent-runtime-outcome.v1",
    source: "runtime-records",
    generatedAt: "2026-09-25T00:00:00.000Z",
    windowStart: "2026-09-24T00:00:00.000Z",
    state: "observed",
    outcomes: NP_AGENT_RUNTIME_OUTCOME_STATES.map((state) => ({
      state,
      count: 0,
      lastFinishedAt: null,
    })),
    active: { unfinished: 3, deadlineElapsed: 2, executing: 2, leaseElapsed: 1, leaseMissing: 1 },
  };
}
describe("Runtime outcome wire", () => {
  it("accepts exact window boundaries and explicit unknown facts", () => {
    const value = evidence();
    value.outcomes[0] = { state: "succeeded", count: 2, lastFinishedAt: value.generatedAt };
    value.outcomes[1] = { state: "failed", count: 1, lastFinishedAt: value.windowStart };
    expect(npRequireAgentRuntimeOutcomeV1(value)).toEqual(value);
    for (const state of ["unsupported", "unavailable"] as const) {
      const unknown = {
        ...value,
        state,
        outcomes: value.outcomes.map((row) => ({ ...row, count: null, lastFinishedAt: null })),
        active: {
          unfinished: null,
          deadlineElapsed: null,
          executing: null,
          leaseElapsed: null,
          leaseMissing: null,
        },
      };
      expect(npRequireAgentRuntimeOutcomeV1(unknown)).toEqual(unknown);
      expect(() => npRequireAgentRuntimeOutcomeV1({ ...unknown, active: value.active })).toThrow();
    }
  });
  it("rejects private additions, partial facts, contradictory counts and chronology", () => {
    const value = evidence();
    for (const invalid of [
      { ...value, id: "private" },
      { ...value, source: "provider" },
      { ...value, windowStart: value.generatedAt },
      { ...value, generatedAt: "2026-02-30T00:00:00.000Z" },
      { ...value, outcomes: [...value.outcomes].reverse() },
      ...[null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((count) => ({
        ...value,
        outcomes: [{ ...value.outcomes[0], count }, ...value.outcomes.slice(1)],
      })),
      { ...value, outcomes: [{ ...value.outcomes[0], count: 1 }, ...value.outcomes.slice(1)] },
      ...[value.generatedAt, "2026-09-23T23:59:59.999Z", "2026-09-25T00:00:00.001Z"].map(
        (lastFinishedAt) => ({
          ...value,
          outcomes: [
            {
              ...value.outcomes[0],
              count: lastFinishedAt === value.generatedAt ? 0 : 1,
              lastFinishedAt,
            },
            ...value.outcomes.slice(1),
          ],
        }),
      ),
      { ...value, active: { ...value.active, deadlineElapsed: 4 } },
      { ...value, active: { ...value.active, executing: 4 } },
      { ...value, active: { ...value.active, leaseMissing: 2 } },
    ])
      expect(() => npRequireAgentRuntimeOutcomeV1(invalid)).toThrow();
  });
});
