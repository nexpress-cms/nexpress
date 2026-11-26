import { and, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentSignals } from "../db/schema/agent.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import type { NpIncidentObservationCandidate } from "./incident-observation-service.js";

export interface NpGuardianSignalRuleVerificationV1 {
  db: ReturnType<typeof getDb>;
  siteId: string;
  signalId: string;
}
/** Called only by an installed source's actual rule builder. Event proof is a separate required gate. */
export async function npVerifyGuardianSignalRuleV1(
  input: NpGuardianSignalRuleVerificationV1,
  build: (
    row: typeof npAgentSignals.$inferSelect,
    eventIds: string[],
  ) => Promise<NpIncidentObservationCandidate>,
): Promise<boolean> {
  canonicalBodySiteId(input.siteId, "guardian.retention.siteId");
  canonicalBodyUuid(input.signalId, "guardian.retention.signalId");
  try {
    const [row] = await input.db
      .select()
      .from(npAgentSignals)
      .where(and(eq(npAgentSignals.siteId, input.siteId), eq(npAgentSignals.id, input.signalId)))
      .limit(1);
    if (!row) return false;
    const evidence = await npReadAgentIncidentSignalEvidenceV1(row);
    if (
      !row.evidence.length ||
      row.evidence.length > 100 ||
      row.evidence.some((ref) => ref.kind !== "event")
    )
      return false;
    const ids = row.evidence.flatMap((ref) => (ref.kind === "event" ? [ref.eventId] : []));
    if (new Set(ids).size !== ids.length) return false;
    const actual = await build(row, ids);
    return (
      serializeAgentCanonicalJson(actual.canonicalEvidence) ===
        serializeAgentCanonicalJson(evidence) &&
      actual.evidenceDigest === row.evidenceDigest &&
      actual.fingerprint === row.fingerprint &&
      actual.severity === row.severity &&
      actual.confidenceBasis === row.confidenceBasis &&
      actual.scoreBasisPoints === row.scoreBasisPoints
    );
  } catch {
    return false;
  }
}
