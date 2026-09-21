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
