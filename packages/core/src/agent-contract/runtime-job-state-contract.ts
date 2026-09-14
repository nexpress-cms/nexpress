import {
  analyzeCanonicalBody,
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import { npRequireAgentContractResult } from "./contract.js";
import type { NpAgentContractResult } from "./types.js";

export const NP_AGENT_RUNTIME_JOBS_SETTING_KEY = "agents.runtime.jobs" as const;
export interface NpAgentRuntimeJobStateV1 {
  schemaVersion: "np.agent-runtime-jobs.v1";
  cursors: {
    eventSites: string | null;
    scheduleSites: string | null;
    retentionSites: string | null;
    events: string | null;
    runs: string | null;
    triggers: string | null;
    retention: string | null;
  };
}
const cursorKeys = [
  "eventSites",
  "scheduleSites",
  "retentionSites",
  "events",
  "runs",
  "triggers",
  "retention",
] as const;
/** Empty processing metadata only; creating this value never installs jobs or persists settings. */
export function npCreateAgentRuntimeJobStateV1(): NpAgentRuntimeJobStateV1 {
  return {
    schemaVersion: "np.agent-runtime-jobs.v1",
    cursors: {
      eventSites: null,
      scheduleSites: null,
      retentionSites: null,
      events: null,
      runs: null,
      triggers: null,
      retention: null,
    },
  };
}
export function npAnalyzeAgentRuntimeJobStateV1(
  value: unknown,
): NpAgentContractResult<NpAgentRuntimeJobStateV1> {
  return analyzeCanonicalBody("agent.runtime.jobs", () => {
    const path = "agent.runtime.jobs";
    const state: CanonicalBodyInspectionState = { seen: new WeakSet() };
    const row = canonicalBodyRecord(
      cloneCanonicalRuntimeInput(value, path, 2048),
      path,
      ["schemaVersion", "cursors"],
      ["schemaVersion", "cursors"],
      state,
    );
    if (row.schemaVersion !== "np.agent-runtime-jobs.v1")
      failCanonicalBody(
        "invalid-field",
        `${path}.schemaVersion`,
        "must be the runtime jobs schema version",
      );
    const cursors = canonicalBodyRecord(
      row.cursors,
      `${path}.cursors`,
      cursorKeys,
      cursorKeys,
      state,
    );
    const result = npCreateAgentRuntimeJobStateV1();
    for (const key of cursorKeys) {
      result.cursors[key] =
        cursors[key] === null
          ? null
          : key === "eventSites" || key === "scheduleSites" || key === "retentionSites"
            ? canonicalBodySiteId(cursors[key], `${path}.cursors.${key}`)
            : canonicalBodyUuid(cursors[key], `${path}.cursors.${key}`);
    }
    return result;
  });
}
export function npRequireAgentRuntimeJobStateV1(value: unknown): NpAgentRuntimeJobStateV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentRuntimeJobStateV1(value),
    "Invalid Agent runtime job state",
  );
}
