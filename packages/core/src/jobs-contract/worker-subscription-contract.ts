import { npNormalizeJobData } from "./contract.js";

/** Versioned optional heartbeat metadata, not worker or provider readiness. */
export const NP_WORKER_SUBSCRIPTION_META_KEY = "npWorkerSubscription";
export const NP_AGENT_WORKER_QUEUE_NAMES = [
  "agent.changesetApply",
  "agent.changesetRollback",
  "agent.changesetVerify",
  "agent.eventDispatch",
  "agent.eventReconcile",
  "agent.retentionPrune",
  "agent.retentionTick",
  "agent.runExecute",
  "agent.scheduleTick",
] as const;
export interface NpWorkerSubscriptionV1 {
  schemaVersion: "np.worker-subscription.v1";
  state: "active" | "paused" | "transitioning" | "unavailable" | "stopped" | "producer";
  /** Successful initial registrations retained as the intended resume set. */
  registeredAgentQueues: string[];
  /** Confirmed subscriptions; empty unless the complete operation succeeded. */
  agentQueues: string[];
}
export function npIsAgentWorkerQueueName(value: unknown): value is string {
  return typeof value === "string" && NP_AGENT_WORKER_QUEUE_NAMES.some((name) => name === value);
}
export function npRequireWorkerSubscriptionV1(value: unknown): NpWorkerSubscriptionV1 {
  const fail = (): never => {
    throw new Error("Invalid worker subscription evidence.");
  };
  const row = npNormalizeJobData(value, "worker.subscription");
  if (
    Object.keys(row).sort().join(",") !== "agentQueues,registeredAgentQueues,schemaVersion,state" ||
    row.schemaVersion !== "np.worker-subscription.v1" ||
    typeof row.state !== "string" ||
    !["active", "paused", "transitioning", "unavailable", "stopped", "producer"].includes(row.state)
  )
    return fail();
  const queues = (input: unknown): string[] => {
    if (!Array.isArray(input) || input.length > NP_AGENT_WORKER_QUEUE_NAMES.length) return fail();
    const result: string[] = [];
    for (const item of input) {
      if (
        !npIsAgentWorkerQueueName(item) ||
        (result.length > 0 && result[result.length - 1] >= item)
      )
        return fail();
      result.push(item);
    }
    return result;
  };
  const registeredAgentQueues = queues(row.registeredAgentQueues);
  const agentQueues = queues(row.agentQueues);
  if (
    (row.state !== "active" && agentQueues.length > 0) ||
    agentQueues.some((name) => !registeredAgentQueues.includes(name)) ||
    (row.state === "producer" && registeredAgentQueues.length > 0)
  )
    return fail();
  return {
    schemaVersion: "np.worker-subscription.v1",
    state: row.state as NpWorkerSubscriptionV1["state"],
    registeredAgentQueues,
    agentQueues,
  };
}
