import {
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
} from "./canonical-body-validation.js";
import { cloneCanonicalRuntimeInput } from "./canonical-runtime-primitives.js";
import type { NpAgentExternalNotificationChannelV1 } from "./notification-delivery-contract.js";

export interface NpAgentIncidentNotificationDeliveryItemV1 {
  notificationId: string;
  connectionId: string;
  channel: NpAgentExternalNotificationChannelV1;
  incidentVersion: number;
  state: "queued" | "sending" | "sent" | "failed" | "suppressed";
  outcome: "pending" | "confirmed" | "not-sent" | "unknown" | "suppressed";
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface NpAgentIncidentNotificationDeliveriesV1 {
  schemaVersion: "np.agent-incident-notification-deliveries.v1";
  incidentId: string;
  items: NpAgentIncidentNotificationDeliveryItemV1[];
  nextCursor: string | null;
}
/** Current-authorized delivery facts; no recipients, descriptors, credentials or raw receipts. */
export function npRequireAgentIncidentNotificationDeliveriesV1(
  value: unknown,
): NpAgentIncidentNotificationDeliveriesV1 {
  const record = (v: unknown, keys: string[]) =>
    canonicalBodyRecord(v, "incident.deliveries", keys, keys, { seen: new WeakSet<object>() });
  const bad = (): never =>
    failCanonicalBody("invalid-field", "incident.deliveries", "Invalid delivery projection");
  const r = record(cloneCanonicalRuntimeInput(value, "incident.deliveries", 65536), [
    "schemaVersion",
    "incidentId",
    "items",
    "nextCursor",
  ]);
  if (
    r.schemaVersion !== "np.agent-incident-notification-deliveries.v1" ||
    !Array.isArray(r.items) ||
    r.items.length > 20
  )
    bad();
  const ids = new Set<string>();
  const items = (r.items as unknown[]).map((value): NpAgentIncidentNotificationDeliveryItemV1 => {
    const x = record(value, [
      "notificationId",
      "connectionId",
      "channel",
      "incidentVersion",
      "state",
      "outcome",
      "attempts",
      "lastErrorCode",
      "nextAttemptAt",
      "sentAt",
      "createdAt",
      "updatedAt",
    ]);
    const notificationId = canonicalBodyUuid(x.notificationId, "delivery.id");
    if (ids.has(notificationId)) bad();
    ids.add(notificationId);
    const state = canonicalBodyEnum<NpAgentIncidentNotificationDeliveryItemV1["state"]>(
      x.state,
      "delivery.state",
      new Set(["queued", "sending", "sent", "failed", "suppressed"]),
    );
    const outcome = canonicalBodyEnum<NpAgentIncidentNotificationDeliveryItemV1["outcome"]>(
      x.outcome,
      "delivery.outcome",
      new Set(["pending", "confirmed", "not-sent", "unknown", "suppressed"]),
    );
    const attempts = canonicalBodyInteger(x.attempts, "delivery.attempts", 0, 5);
    const lastErrorCode =
      x.lastErrorCode === null ? null : canonicalBodyAscii(x.lastErrorCode, "delivery.error", 64);
    const date = (v: unknown) => (v === null ? null : canonicalBodyUtc(v, "delivery.time"));
    const nextAttemptAt = date(x.nextAttemptAt);
    const sentAt = date(x.sentAt);
    if (lastErrorCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/u.test(lastErrorCode)) bad();
    if (
      (state === "sent") !== (sentAt !== null) ||
      (state === "sent") !== (outcome === "confirmed") ||
      (state === "suppressed") !== (outcome === "suppressed") ||
      (nextAttemptAt !== null && state !== "queued") ||
      (state === "sending" && outcome !== "unknown") ||
      (state === "failed" && !["unknown", "not-sent"].includes(outcome)) ||
      (state !== "queued" && attempts === 0 && state !== "suppressed")
    )
      bad();
    return {
      notificationId,
      connectionId: canonicalBodyUuid(x.connectionId, "delivery.connection"),
      channel: canonicalBodyEnum<NpAgentExternalNotificationChannelV1>(
        x.channel,
        "delivery.channel",
        new Set(["email", "slack", "webhook", "siem"]),
      ),
      incidentVersion: canonicalBodyInteger(
        x.incidentVersion,
        "delivery.incidentVersion",
        1,
        2147483647,
      ),
      state,
      outcome,
      attempts,
      lastErrorCode,
      nextAttemptAt,
      sentAt,
      createdAt: canonicalBodyUtc(x.createdAt, "delivery.createdAt"),
      updatedAt: canonicalBodyUtc(x.updatedAt, "delivery.updatedAt"),
    };
  });
  return {
    schemaVersion: "np.agent-incident-notification-deliveries.v1",
    incidentId: canonicalBodyUuid(r.incidentId, "delivery.incidentId"),
    items,
    nextCursor:
      r.nextCursor === null ? null : canonicalBodyAscii(r.nextCursor, "delivery.cursor", 2048),
  };
}
