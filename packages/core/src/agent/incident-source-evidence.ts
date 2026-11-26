import { and, asc, eq } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentIncidentSignals, npAgentSignals } from "../db/schema/agent.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "./incident-service.js";
import { npReadAgentEventRowEvidenceV1, npReadAgentEventRowsV1 } from "./event-evidence.js";
import { NpAgentGatewayError } from "./admin-admission.js";

/** Whole canonical source union. Callers independently own current ACL and policy admission. */
export async function npReadAgentIncidentCanonicalSourcesV1(input: {
  db: ReturnType<typeof getDb>;
  siteId: string;
  incident: NpAgentIncidentV1;
}) {
  const fail = (): never => {
    throw new NpAgentGatewayError(
      "INCIDENT_EVIDENCE_UNAVAILABLE",
      409,
      "Incident evidence is unavailable.",
    );
  };
  if (input.incident.siteId !== input.siteId) fail();
  const joined = await input.db
    .select({ signal: npAgentSignals })
    .from(npAgentIncidentSignals)
    .innerJoin(
      npAgentSignals,
      and(
        eq(npAgentSignals.siteId, npAgentIncidentSignals.siteId),
        eq(npAgentSignals.id, npAgentIncidentSignals.signalId),
      ),
    )
    .where(
      and(
        eq(npAgentIncidentSignals.siteId, input.siteId),
        eq(npAgentIncidentSignals.incidentId, input.incident.id),
      ),
    )
    .orderBy(asc(npAgentSignals.id))
    .limit(101);
  if (
    joined.length > 100 ||
    !joined.length ||
    serializeAgentCanonicalJson(joined.map((r) => r.signal.id)) !==
      serializeAgentCanonicalJson(input.incident.signalIds)
  )
    fail();
  const signals = await Promise.all(
    joined.map(({ signal }) => npReadAgentIncidentSignalEvidenceV1(signal)),
  );
  const refs = signals.flatMap((s) => s.evidence).filter((r) => r.kind === "event");
  const ids = [...new Set(refs.map((r) => r.eventId))].sort();
  if (ids.length > 10000 || ids.length !== input.incident.eventCount) fail();
  const rows = await npReadAgentEventRowsV1(input.db, input.siteId, ids);
  if (rows.length !== ids.length) fail();
  const events = await Promise.all(
    rows.map(async (row) => {
      const event = await npReadAgentEventRowEvidenceV1(row);
      const digest = Buffer.from(row.eventHash.slice("cj1:sha256:".length), "base64url").toString(
        "hex",
      );
      if (
        refs.some(
          (ref) =>
            ref.eventId === row.id &&
            (ref.digest !== digest ||
              ref.eventKind !== event.kind ||
              ref.observedAt !== event.occurredAt),
        )
      )
        fail();
      return event;
    }),
  );
  return { signals, events };
}
