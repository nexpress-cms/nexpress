import { and, asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npAgentEvents } from "../db/schema/agent.js";
import {
  npRequireAgentEventCanonical,
  npDigestAgentEventCanonical,
} from "../agent-contract/canonical-events.js";
import { NpAgentGatewayError } from "./admin-admission.js";
type Event = typeof npAgentEvents.$inferSelect;
/** One retained Event envelope; no dispatch, source ACL or current-content assertion. */
export function npAgentEventRowEnvelopeV1(row: Event) {
  return npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: row.siteId,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    source: { kind: row.sourceKind, component: row.sourceComponent },
    subject: row.subject,
    actor: row.actor,
    causation: row.causation,
    correlationId: row.correlationId,
    deduplicationKey: row.deduplicationKey,
    privacy: row.privacy,
    payload: row.payload,
  });
}
export async function npReadAgentEventRowEvidenceV1(row: Event) {
  const event = npAgentEventRowEnvelopeV1(row);
  if ((await npDigestAgentEventCanonical(event)) !== row.eventHash)
    throw new NpAgentGatewayError(
      "INCIDENT_EVIDENCE_UNAVAILABLE",
      409,
      "Incident evidence is unavailable.",
    );
  return event;
}
export async function npReadAgentEventRowsV1(
  db: ReturnType<typeof getDb>,
  siteId: string,
  ids: readonly string[],
) {
  const rows: Event[] = [];
  for (let offset = 0; offset < ids.length; offset += 100)
    rows.push(
      ...(await db
        .select()
        .from(npAgentEvents)
        .where(
          and(
            eq(npAgentEvents.siteId, siteId),
            inArray(npAgentEvents.id, ids.slice(offset, offset + 100)),
          ),
        )
        .orderBy(asc(npAgentEvents.id))),
    );
  return rows;
}
