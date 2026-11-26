import type { getDb } from "../db/runtime.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  npRequireAgentGuardianSessionEvidenceV1,
  type NpAgentGuardianSessionEvidenceV1,
} from "../agent-contract/guardian-session-contract.js";
import { npReadGuardianSessionIncidentEvidenceV1 } from "./guardian-session-observation.js";

/** Caller owns current Incident/viewer authorization; historical targets never cross this projection. */
export async function npReadAgentGuardianSessionSafeEvidenceV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  incident: NpAgentIncidentV1;
}): Promise<NpAgentGuardianSessionEvidenceV1[]> {
  const verified = await npReadGuardianSessionIncidentEvidenceV1(input);
  return [
    npRequireAgentGuardianSessionEvidenceV1({
      schemaVersion: "np.agent-guardian-session-evidence.v1",
      signalId: input.incident.signalIds[0],
      detectorId: "guardian.login-after-failures",
      detectorVersion: 1,
      audience: verified.actorKind,
      window: { startedAt: input.incident.firstObservedAt, endedAt: input.incident.lastObservedAt },
      successfulLoginAt: verified.createdAt,
      precedingFailureCount: 5,
      countBasis: "at-least",
      sourceDigest: verified.sourceDigest,
    }),
  ];
}
