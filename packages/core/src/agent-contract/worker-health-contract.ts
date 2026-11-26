import { NP_AGENT_WORKER_QUEUE_NAMES } from "../jobs-contract/worker-subscription-contract.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyInteger,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

export const NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT = 100;

/** Aggregate subscription observations, never proof of progress or admission readiness. */
export interface NpAgentWorkerHealthV1 {
  schemaVersion: "np.agent-worker-health.v1";
  generatedAt: string;
  state: "observed" | "unavailable";
  sampledWorkers: number | null;
  hasMore: boolean | null;
  subscribedWorkers: number | null;
  pausedWorkers: number | null;
  inactiveWorkers: number | null;
  staleWorkers: number | null;
  stoppedWorkers: number | null;
  unknownWorkers: number | null;
}

export function npRequireAgentWorkerHealthV1(value: unknown): NpAgentWorkerHealthV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.worker.health", () => {
      const path = "agent.worker.health";
      const keys = [
        "schemaVersion",
        "generatedAt",
        "state",
        "sampledWorkers",
        "hasMore",
        "subscribedWorkers",
        "pausedWorkers",
        "inactiveWorkers",
        "staleWorkers",
        "stoppedWorkers",
        "unknownWorkers",
      ];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(value, path, 2048),
        path,
        keys,
        keys,
        { seen: new WeakSet() },
      );
      const invalid = (): never =>
        failCanonicalBody("invalid-field", path, "invalid worker measurement evidence");
      if (
        row.schemaVersion !== "np.agent-worker-health.v1" ||
        (row.state !== "observed" && row.state !== "unavailable")
      )
        return invalid();
      const count = (v: unknown) =>
        v === null ? null : canonicalBodyInteger(v, path, 0, NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT);
      const result: NpAgentWorkerHealthV1 = {
        schemaVersion: "np.agent-worker-health.v1",
        generatedAt: canonicalBodyUtc(row.generatedAt, `${path}.generatedAt`),
        state: row.state,
        sampledWorkers: count(row.sampledWorkers),
        hasMore:
          row.hasMore === null ? null : typeof row.hasMore === "boolean" ? row.hasMore : invalid(),
        subscribedWorkers: count(row.subscribedWorkers),
        pausedWorkers: count(row.pausedWorkers),
        inactiveWorkers: count(row.inactiveWorkers),
        staleWorkers: count(row.staleWorkers),
        stoppedWorkers: count(row.stoppedWorkers),
        unknownWorkers: count(row.unknownWorkers),
      };
      const {
        sampledWorkers,
        subscribedWorkers,
        pausedWorkers,
        inactiveWorkers,
        staleWorkers,
        stoppedWorkers,
        unknownWorkers,
        hasMore,
      } = result;
      if (result.state === "unavailable") {
        if (
          [
            sampledWorkers,
            subscribedWorkers,
            pausedWorkers,
            inactiveWorkers,
            staleWorkers,
            stoppedWorkers,
            unknownWorkers,
            hasMore,
          ].some((v) => v !== null)
        )
          invalid();
      } else if (
        sampledWorkers === null ||
        subscribedWorkers === null ||
        pausedWorkers === null ||
        inactiveWorkers === null ||
        staleWorkers === null ||
        stoppedWorkers === null ||
        unknownWorkers === null ||
        hasMore === null ||
        subscribedWorkers +
          pausedWorkers +
          inactiveWorkers +
          staleWorkers +
          stoppedWorkers +
          unknownWorkers !==
          sampledWorkers ||
        (hasMore && sampledWorkers !== NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT)
      )
        invalid();
      return result;
    }),
    "Invalid Agent worker measurement evidence",
  );
}

/** Per-queue counts overlap across queues, but only describe the same bounded sample. */
export interface NpAgentWorkerQueueObservationV1 {
  queue: (typeof NP_AGENT_WORKER_QUEUE_NAMES)[number];
  subscribedWorkers: number | null;
  pausedRegisteredWorkers: number | null;
  staleRegisteredWorkers: number | null;
  stoppedRegisteredWorkers: number | null;
}

/** Additive reader version; the exact v1 aggregate and heartbeat envelopes remain unchanged. */
export interface NpAgentWorkerHealthV2 {
  schemaVersion: "np.agent-worker-health.v2";
  summary: NpAgentWorkerHealthV1;
  queues: NpAgentWorkerQueueObservationV1[];
}

export function npRequireAgentWorkerHealthV2(value: unknown): NpAgentWorkerHealthV2 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.worker.queues", () => {
      const path = "agent.worker.queues";
      const invalid = (): never =>
        failCanonicalBody("invalid-field", path, "invalid queue observation evidence");
      const keys = ["schemaVersion", "summary", "queues"];
      const row = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(value, path, 16384),
        path,
        keys,
        keys,
        { seen: new WeakSet() },
      );
      if (row.schemaVersion !== "np.agent-worker-health.v2") return invalid();
      const summary = npRequireAgentWorkerHealthV1(row.summary);
      if (!Array.isArray(row.queues) || row.queues.length !== NP_AGENT_WORKER_QUEUE_NAMES.length)
        return invalid();
      const fields = [
        "subscribedWorkers",
        "pausedRegisteredWorkers",
        "staleRegisteredWorkers",
        "stoppedRegisteredWorkers",
      ] as const;
      const limits = [
        summary.subscribedWorkers,
        summary.pausedWorkers,
        summary.staleWorkers,
        summary.stoppedWorkers,
      ];
      const queues = row.queues.map((value, index): NpAgentWorkerQueueObservationV1 => {
        const keys = ["queue", ...fields];
        const item = canonicalBodyRecord(value, `${path}.${index}`, keys, keys, {
          seen: new WeakSet(),
        });
        const queue = NP_AGENT_WORKER_QUEUE_NAMES[index];
        if (item.queue !== queue) return invalid();
        const counts = fields.map((field, i) => {
          if (summary.state === "unavailable") return item[field] === null ? null : invalid();
          const count = canonicalBodyInteger(
            item[field],
            `${path}.${index}.${field}`,
            0,
            NP_AGENT_WORKER_HEALTH_SAMPLE_LIMIT,
          );
          if (count > (limits[i] ?? 0)) return invalid();
          return count;
        });
        return {
          queue,
          subscribedWorkers: counts[0],
          pausedRegisteredWorkers: counts[1],
          staleRegisteredWorkers: counts[2],
          stoppedRegisteredWorkers: counts[3],
        };
      });
      if (
        summary.state === "observed" &&
        (queues.reduce((sum, queue) => sum + (queue.subscribedWorkers ?? 0), 0) <
          (summary.subscribedWorkers ?? 0) ||
          queues.reduce((sum, queue) => sum + (queue.pausedRegisteredWorkers ?? 0), 0) <
            (summary.pausedWorkers ?? 0))
      )
        return invalid();
      return { schemaVersion: "np.agent-worker-health.v2", summary, queues };
    }),
    "Invalid Agent queue observation evidence",
  );
}
