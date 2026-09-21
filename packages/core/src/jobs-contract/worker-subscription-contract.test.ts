import { describe, expect, it, vi } from "vitest";
import { npRequireWorkerSubscriptionV1 } from "./worker-subscription-contract.js";
const evidence = {
  schemaVersion: "np.worker-subscription.v1",
  state: "active",
  registeredAgentQueues: ["agent.runExecute"],
  agentQueues: ["agent.runExecute"],
};
describe("worker subscription metadata", () => {
  it("copies validated evidence and rejects ambiguous, unsupported or extra facts", () => {
    const result = npRequireWorkerSubscriptionV1(evidence);
    expect(result).toEqual(evidence);
    expect(result.agentQueues).not.toBe(evidence.agentQueues);
    const getter = vi.fn(() => "active");
    const accessor = { ...evidence };
    Object.defineProperty(accessor, "state", { get: getter, enumerable: true });
    for (const invalid of [
      accessor,
      Object.assign(Object.create({ inherited: true }), evidence),
      { ...evidence, [Symbol("extra")]: true },
      { ...evidence, state: { toString: () => "active" }, agentQueues: [] },
      { ...evidence, schemaVersion: "np.worker-subscription.v2" },
      { ...evidence, hostname: "private" },
      { ...evidence, agentQueues: ["agent.custom"] },
      { ...evidence, agentQueues: ["agent.runExecute", "agent.runExecute"] },
      { ...evidence, registeredAgentQueues: [] },
      { ...evidence, state: "paused" },
      { ...evidence, state: "producer", agentQueues: [] },
    ])
      expect(() => npRequireWorkerSubscriptionV1(invalid)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(
      npRequireWorkerSubscriptionV1({ ...evidence, state: "paused", agentQueues: [] })
        .registeredAgentQueues,
    ).toEqual(["agent.runExecute"]);
  });
});
