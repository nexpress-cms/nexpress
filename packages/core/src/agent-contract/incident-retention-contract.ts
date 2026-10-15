import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyInteger,
  canonicalBodyRecord,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";

/** Explicit trusted host policy. Absence never opts a host into R6 pruning.
 * These are minimum ages; dependencies and unresolved evidence always pin rows. */
export interface NpAgentIncidentRetentionPolicyV1 {
  signalDays: number;
  historyDays: number;
}

export function npRequireAgentIncidentRetentionPolicyV1(
  value: unknown,
): NpAgentIncidentRetentionPolicyV1 {
  return npRequireAgentContractResult(
    analyzeCanonicalBody("agent.incident.retention", () => {
      const path = "agent.incident.retention";
      const keys = ["signalDays", "historyDays"];
      const raw = canonicalBodyRecord(
        cloneCanonicalRuntimeInput(value, path, 1024),
        path,
        keys,
        keys,
        { seen: new WeakSet<object>() },
      );
      return {
        signalDays: canonicalBodyInteger(raw.signalDays, `${path}.signalDays`, 1, 90),
        historyDays: canonicalBodyInteger(raw.historyDays, `${path}.historyDays`, 1, 365),
      };
    }),
    "Invalid Incident retention policy",
  );
}
