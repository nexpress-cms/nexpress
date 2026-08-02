import { describe, expect, it } from "vitest";

import {
  NP_SHOP_TRACKING_EVENT_CONTRACT,
  NP_SHOP_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_TRACKING_STORAGE_CONTRACT,
  NpShopTrackingContractError,
  npAnalyzeStoredShopTrackingReceipt,
  npAnalyzeStoredShopTracking,
  npRequireFreshShopTrackingEvent,
  npRequireStoredShopTrackingReceipt,
  npShopTrackingEventDigest,
  npShopTrackingReceiptStorageKey,
} from "./tracking-contract.js";

const now = new Date("2026-08-02T12:00:00.000Z");
const event = {
  contract: NP_SHOP_TRACKING_EVENT_CONTRACT,
  eventId: "tracking_evt_123",
  shipmentId: "123e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174001",
  bookingReference: "booking_123",
  trackingNumber: "TRACK-123",
  status: "in-transit",
  occurredAt: "2026-08-02T11:55:00.000Z",
  signedAt: now.toISOString(),
} as const;

describe("Shop carrier tracking contract", () => {
  it("accepts one exact fresh PII-free event", () => {
    expect(npRequireFreshShopTrackingEvent(event, now)).toEqual(event);
    expect(
      npRequireFreshShopTrackingEvent({ ...event, trackingNumber: "KR/운송장 123" }, now)
        .trackingNumber,
    ).toBe("KR/운송장 123");
  });

  it("rejects replayed, excessively delayed, and extended events", () => {
    for (const [candidate, issue] of [
      [{ ...event, signedAt: "2026-08-02T11:50:00.000Z" }, "replay window"],
      [{ ...event, occurredAt: "2026-06-01T00:00:00.000Z" }, "provider delay"],
      [{ ...event, destination: {} }, "not supported"],
    ] as const) {
      try {
        npRequireFreshShopTrackingEvent(candidate, now);
        throw new Error("Expected tracking contract rejection.");
      } catch (error) {
        expect(error).toBeInstanceOf(NpShopTrackingContractError);
        expect((error as NpShopTrackingContractError).issues.join(" ")).toContain(issue);
      }
    }
  });

  it("validates durable state and ties deliveredAt to terminal delivery", () => {
    const state = {
      contract: NP_SHOP_TRACKING_STORAGE_CONTRACT,
      orderId: event.orderId,
      shipmentId: event.shipmentId,
      providerId: "test-carrier",
      bookingReference: event.bookingReference,
      trackingNumber: event.trackingNumber,
      status: "delivered",
      latestEventId: event.eventId,
      occurredAt: event.occurredAt,
      deliveredAt: event.occurredAt,
      updatedAt: now.toISOString(),
      purgeAt: "2027-08-02T12:00:00.000Z",
    } as const;
    expect(npAnalyzeStoredShopTracking(state)).toEqual([]);
    expect(npAnalyzeStoredShopTracking({ ...state, deliveredAt: null })).toContain(
      "delivered tracking state requires deliveredAt equal to occurredAt.",
    );
  });

  it("hashes external event ids and rejects receipt digest drift", () => {
    const key = npShopTrackingReceiptStorageKey("test-carrier", event.eventId);
    expect(key).toMatch(/^tracking-event:test-carrier:[0-9a-f]{64}$/u);
    const receipt = {
      contract: NP_SHOP_TRACKING_RECEIPT_CONTRACT,
      providerId: "test-carrier",
      event,
      eventDigest: npShopTrackingEventDigest(event),
      outcome: "advanced",
      trackingStatus: "in-transit",
      processedAt: now.toISOString(),
      purgeAt: "2027-08-02T12:00:00.000Z",
    } as const;
    expect(npRequireStoredShopTrackingReceipt(receipt)).toEqual(receipt);
    expect(npShopTrackingEventDigest({ ...event, signedAt: "2026-08-02T12:00:01.000Z" })).toBe(
      receipt.eventDigest,
    );
    expect(
      npAnalyzeStoredShopTrackingReceipt({ ...receipt, eventDigest: "0".repeat(64) }),
    ).toContain("tracking receipt.eventDigest must match its canonical event.");
  });
});
