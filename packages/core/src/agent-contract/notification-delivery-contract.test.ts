import { describe, expect, it } from "vitest";
import { npRequireAgentNotificationDeliveryResultV1 } from "./notification-delivery-contract.js";
import { npRequireAgentIncidentNotificationDeliveriesV1 } from "./incident-notification-deliveries-contract.js";

const id = "d4cafb07-c120-4503-90fa-6d6fc4104ce3";
const at = "2026-10-16T00:00:00.000Z";
function projection() {
  return {
    schemaVersion: "np.agent-incident-notification-deliveries.v1",
    incidentId: id,
    nextCursor: null,
    items: [
      {
        notificationId: id,
        connectionId: id,
        channel: "email",
        incidentVersion: 1,
        state: "queued",
        outcome: "pending",
        attempts: 0,
        lastErrorCode: null,
        nextAttemptAt: null,
        sentAt: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
}
describe("external notification delivery evidence", () => {
  it("accepts each exact transport outcome without converting ambiguity into not-sent", () => {
    for (const value of [
      { state: "confirmed", providerMessageId: null },
      { state: "confirmed", providerMessageId: "opaque-receipt" },
      { state: "retryable_not_sent", errorCode: "NOT_SENT" },
      { state: "permanent_failure", errorCode: "REJECTED" },
      { state: "ambiguous", errorCode: "UNKNOWN" },
    ])
      expect(npRequireAgentNotificationDeliveryResultV1(value)).toEqual(value);
  });
  it("rejects secret-bearing or malformed receipt shapes instead of projecting arbitrary errors", () => {
    for (const value of [
      { state: "confirmed" },
      { state: "confirmed", providerMessageId: "x".repeat(257) },
      { state: "ambiguous", errorCode: "secret in an error" },
      { state: "confirmed", providerMessageId: null, recipient: "hidden@example.invalid" },
      { state: "unknown", errorCode: "UNKNOWN" },
    ])
      expect(() => npRequireAgentNotificationDeliveryResultV1(value)).toThrow();
  });
  it("keeps current-authorized delivery projection exact and free of transport destinations", () => {
    expect(npRequireAgentIncidentNotificationDeliveriesV1(projection())).toEqual(projection());
    for (const field of [
      "destinationDescriptor",
      "providerMessageId",
      "secretVersionId",
      "recipient",
    ]) {
      const value = projection();
      Object.assign(value.items[0], { [field]: "private" });
      expect(() => npRequireAgentIncidentNotificationDeliveriesV1(value)).toThrow();
    }
  });
  it("rejects false confirmation, unbounded attempts, unsupported channels and impossible retry clocks", () => {
    for (const delta of [
      { state: "sent", outcome: "pending", sentAt: at },
      { outcome: "confirmed" },
      { attempts: 6 },
      { channel: "admin" },
      { state: "sending", outcome: "not-sent", attempts: 1 },
      { state: "failed", attempts: 1, outcome: "unknown", nextAttemptAt: at },
    ]) {
      const value = projection();
      Object.assign(value.items[0], delta);
      expect(() => npRequireAgentIncidentNotificationDeliveriesV1(value)).toThrow();
    }
  });
});
