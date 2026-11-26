import { npNormalizeJobData } from "./contract.js";
import { NP_AGENT_WORKER_QUEUE_NAMES } from "./worker-subscription-contract.js";

export interface NpAgentQueueBacklogRowV1 {
  queue: (typeof NP_AGENT_WORKER_QUEUE_NAMES)[number];
  createdReady: number | null;
  createdScheduled: number | null;
  retryReady: number | null;
  retryScheduled: number | null;
  active: number | null;
  oldestReadyAgeSeconds: number | null;
  oldestActiveAgeSeconds: number | null;
}

/** Host-wide retained pg-boss facts, not progress, readiness or tenant attribution. */
export interface NpAgentQueueBacklogV1 {
  schemaVersion: "np.agent-queue-backlog.v1";
  source: "pg-boss";
  generatedAt: string;
  state: "observed" | "unsupported" | "unavailable";
  queues: NpAgentQueueBacklogRowV1[];
}

export function npRequireAgentQueueBacklogV1(value: unknown): NpAgentQueueBacklogV1 {
  const fail = (): never => {
    throw new Error("Invalid Agent queue backlog evidence.");
  };
  const row = npNormalizeJobData(value, "agent.queue.backlog");
  if (
    Object.keys(row).sort().join(",") !== "generatedAt,queues,schemaVersion,source,state" ||
    row.schemaVersion !== "np.agent-queue-backlog.v1" ||
    row.source !== "pg-boss" ||
    (row.state !== "observed" && row.state !== "unsupported" && row.state !== "unavailable") ||
    typeof row.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.generatedAt) ||
    !Number.isFinite(Date.parse(row.generatedAt)) ||
    new Date(row.generatedAt).toISOString() !== row.generatedAt ||
    !Array.isArray(row.queues) ||
    row.queues.length !== NP_AGENT_WORKER_QUEUE_NAMES.length
  )
    return fail();
  const queues = row.queues.map((value, index): NpAgentQueueBacklogRowV1 => {
    const item = npNormalizeJobData(value, "agent.queue.backlog.row");
    const fields = [
      "createdReady",
      "createdScheduled",
      "retryReady",
      "retryScheduled",
      "active",
      "oldestReadyAgeSeconds",
      "oldestActiveAgeSeconds",
    ] as const;
    if (
      Object.keys(item).sort().join(",") !== ["queue", ...fields].sort().join(",") ||
      item.queue !== NP_AGENT_WORKER_QUEUE_NAMES[index]
    )
      return fail();
    const count = (field: (typeof fields)[number]): number | null => {
      const n = item[field];
      if (n === null) return null;
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return fail();
      return n;
    };
    const result: NpAgentQueueBacklogRowV1 = {
      queue: NP_AGENT_WORKER_QUEUE_NAMES[index],
      createdReady: count("createdReady"),
      createdScheduled: count("createdScheduled"),
      retryReady: count("retryReady"),
      retryScheduled: count("retryScheduled"),
      active: count("active"),
      oldestReadyAgeSeconds: count("oldestReadyAgeSeconds"),
      oldestActiveAgeSeconds: count("oldestActiveAgeSeconds"),
    };
    if (row.state !== "observed") {
      if (fields.some((field) => result[field] !== null)) return fail();
    } else {
      if (
        [
          result.createdReady,
          result.createdScheduled,
          result.retryReady,
          result.retryScheduled,
          result.active,
        ].some((n) => n === null)
      )
        return fail();
      const ready = (result.createdReady ?? 0) + (result.retryReady ?? 0);
      if (
        !Number.isSafeInteger(ready) ||
        (ready === 0) !== (result.oldestReadyAgeSeconds === null) ||
        (result.active === 0) !== (result.oldestActiveAgeSeconds === null)
      )
        return fail();
    }
    return result;
  });
  return {
    schemaVersion: "np.agent-queue-backlog.v1",
    source: "pg-boss",
    generatedAt: row.generatedAt,
    state: row.state,
    queues,
  };
}
