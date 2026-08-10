import { describe, expect, it } from "vitest";

import {
  NP_SHOP_TRACKING_EVENT_CONTRACT,
  NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
  NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT,
  NP_SHOP_TRACKING_POLL_RESULT_CONTRACT,
  NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT,
  NP_SHOP_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_TRACKING_STORAGE_CONTRACT,
  NpShopTrackingContractError,
  npAnalyzeShopTrackingPollRequest,
  npAnalyzeStoredShopTrackingReceipt,
  npAnalyzeStoredShopTracking,
  npAnalyzeStoredShopTrackingPoll,
  npRequireFreshShopTrackingEvent,
  npRequireShopTrackingPollRequest,
  npRequireShopTrackingPollResult,
  npRequireShopTrackingPollCursor,
  npRequireShopTrackingReconcileActionInput,
  npRequireStoredShopTrackingReceipt,
  npShopTrackingEventDigest,
  npShopExchangeTrackingPollStorageKey,
  npShopExchangeTrackingStorageKey,
  npShopTrackingPollBackoffSeconds,
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

  it("accepts one exact PII-free tracking poll request", () => {
    const request = {
      contract: NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT,
      shipmentId: event.shipmentId,
      orderId: event.orderId,
      bookingReference: event.bookingReference,
      trackingNumber: event.trackingNumber,
      current: {
        eventId: event.eventId,
        status: event.status,
        occurredAt: event.occurredAt,
      },
      requestedAt: now.toISOString(),
    } as const;
    expect(npRequireShopTrackingPollRequest(request)).toEqual(request);
    expect(npAnalyzeShopTrackingPollRequest({ ...request, recipient: "hidden" })).toContain(
      "tracking poll request.recipient is not supported.",
    );
  });

  it("requires poll results and canonical events to match the exact request", () => {
    const request = npRequireShopTrackingPollRequest({
      contract: NP_SHOP_TRACKING_POLL_REQUEST_CONTRACT,
      shipmentId: event.shipmentId,
      orderId: event.orderId,
      bookingReference: event.bookingReference,
      trackingNumber: event.trackingNumber,
      current: null,
      requestedAt: now.toISOString(),
    });
    const receivedAt = new Date("2026-08-02T12:00:02.000Z");
    const result = {
      contract: NP_SHOP_TRACKING_POLL_RESULT_CONTRACT,
      shipmentId: event.shipmentId,
      orderId: event.orderId,
      checkedAt: now.toISOString(),
      event,
    } as const;
    expect(npRequireShopTrackingPollResult(result, { request, receivedAt })).toEqual(result);
    expect(() =>
      npRequireShopTrackingPollResult(
        {
          ...result,
          checkedAt: receivedAt.toISOString(),
        },
        { request, receivedAt },
      ),
    ).toThrow(/poll result/u);
    expect(() =>
      npRequireShopTrackingPollResult(
        {
          ...result,
          event: { ...event, trackingNumber: "different" },
        },
        { request, receivedAt },
      ),
    ).toThrow(/poll result/u);
    expect(() =>
      npRequireShopTrackingPollResult({ ...result, recipient: "hidden" }, { request, receivedAt }),
    ).toThrow(/poll result/u);
  });

  it("validates leased, successful, and failed tracking poll state", () => {
    const leased = {
      contract: NP_SHOP_TRACKING_POLL_STORAGE_CONTRACT,
      orderId: event.orderId,
      shipmentId: event.shipmentId,
      providerId: "test-carrier",
      consecutiveFailures: 0,
      lastAttemptAt: now.toISOString(),
      lastSuccessAt: null,
      nextAttemptAt: "2026-08-02T12:05:00.000Z",
      lastErrorCode: null,
      leaseId: "123e4567-e89b-42d3-a456-426614174002",
      leaseExpiresAt: "2026-08-02T12:05:00.000Z",
      updatedAt: now.toISOString(),
      purgeAt: "2027-08-02T12:00:00.000Z",
    } as const;
    expect(npAnalyzeStoredShopTrackingPoll(leased)).toEqual([]);
    expect(
      npAnalyzeStoredShopTrackingPoll({
        ...leased,
        lastSuccessAt: now.toISOString(),
        nextAttemptAt: "2026-08-02T12:10:00.000Z",
        leaseId: null,
        leaseExpiresAt: null,
      }),
    ).toEqual([]);
    expect(
      npAnalyzeStoredShopTrackingPoll({
        ...leased,
        consecutiveFailures: 1,
        lastErrorCode: "provider-error",
        leaseId: null,
        leaseExpiresAt: null,
      }),
    ).toEqual([]);
    expect(npAnalyzeStoredShopTrackingPoll({ ...leased, leaseId: null })).toContain(
      "tracking poll state lease fields must be both null or both present.",
    );
    expect(
      npAnalyzeStoredShopTrackingPoll({
        ...leased,
        nextAttemptAt: "2026-08-02T11:59:00.000Z",
        leaseExpiresAt: "2026-08-02T11:59:00.000Z",
      }),
    ).toContain("tracking poll state.nextAttemptAt cannot precede updatedAt.");
  });

  it("bounds exponential tracking poll backoff and exact Admin action inputs", () => {
    expect([1, 2, 3, 7, 16].map(npShopTrackingPollBackoffSeconds)).toEqual([
      300, 600, 1_200, 19_200, 21_600,
    ]);
    expect(() => npShopTrackingPollBackoffSeconds(0)).toThrow(/failure count/u);
    expect(
      npRequireShopTrackingReconcileActionInput({
        row: { id: event.orderId, shipmentId: event.shipmentId },
        values: {},
      }),
    ).toEqual({ orderId: event.orderId, shipmentId: event.shipmentId });
    expect(() =>
      npRequireShopTrackingReconcileActionInput({
        row: { id: event.orderId, shipmentId: event.shipmentId },
        values: { force: true },
      }),
    ).toThrow(/reconcile action/u);
    expect(
      npRequireShopTrackingPollCursor({
        contract: NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
        providerId: "test-carrier",
        lastBookingKey: `carrier-booking:${event.orderId}`,
        updatedAt: now.toISOString(),
      }),
    ).toMatchObject({ lastBookingKey: `carrier-booking:${event.orderId}` });
    expect(
      npRequireShopTrackingPollCursor({
        contract: NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
        providerId: "test-carrier",
        lastBookingKey: `exchange-carrier-booking:${event.orderId}`,
        updatedAt: now.toISOString(),
      }),
    ).toMatchObject({ lastBookingKey: `exchange-carrier-booking:${event.orderId}` });
    expect(npShopExchangeTrackingStorageKey(event.orderId)).toBe(
      `exchange-tracking:${event.orderId}`,
    );
    expect(npShopExchangeTrackingPollStorageKey(event.orderId)).toBe(
      `exchange-tracking-poll:${event.orderId}`,
    );
    expect(() =>
      npRequireShopTrackingPollCursor({
        contract: NP_SHOP_TRACKING_POLL_CURSOR_CONTRACT,
        providerId: "test-carrier",
        lastBookingKey: "carrier-booking:00000000-0000-0000-0000-000000000000",
        updatedAt: now.toISOString(),
      }),
    ).toThrow(/poll cursor/u);
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
