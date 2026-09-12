import { describe, expect, it } from "vitest";
import { createAgentRuntimeExecutionStoreV1 } from "./runtime-execution-store.js";
import { createAgentRuntimeBreakersV1 } from "./runtime-breakers.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";
const admission: NpAgentRuntimeAdmissionV1 = {
  admit: () => Promise.reject(new Error("unused")),
  withCurrentRun: () => Promise.reject(new Error("unused")),
};
describe("explicit runtime execution construction", () => {
  it.each([0, -1, 91, Infinity, 1.5])("rejects unbounded lease %s", (leaseSeconds) => {
    expect(() => createAgentRuntimeExecutionStoreV1({ admission, leaseSeconds })).toThrow();
  });
  it.each([0, -1, 1001, Infinity, 1.5])(
    "rejects unbounded breaker failure threshold %s",
    (failureThreshold) => {
      expect(() =>
        createAgentRuntimeBreakersV1({ failureThreshold, windowSeconds: 60, cooldownSeconds: 60 }),
      ).toThrow();
    },
  );
  it("constructs no database, provider or worker on valid explicit configuration", () => {
    expect(Object.keys(createAgentRuntimeExecutionStoreV1({ admission }))).toContain("claim");
    expect(
      Object.keys(
        createAgentRuntimeBreakersV1({
          failureThreshold: 3,
          windowSeconds: 60,
          cooldownSeconds: 60,
        }),
      ),
    ).toContain("observeCall");
  });
  it("rejects unknown input fields without touching the database", () => {
    const store = createAgentRuntimeExecutionStoreV1({ admission });
    const input = {
      siteId: "default",
      runId: "00000000-0000-4000-8000-000000000001",
      credential: "forbidden",
    };
    expect(() => store.claim(input)).toThrow();
  });
});
