import { describe, expect, it } from "vitest";

import {
  NP_SHOP_RETURN_TRACKING_CONTRACT,
  NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT,
  NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT,
  npAnalyzeShopReturnTracking,
  npRequireFreshShopReturnTrackingEvent,
  npRequireShopReturnTrackingPollRequest,
  npRequireShopReturnTrackingPollResult,
  npRequireShopReturnTrackingPollCursor,
  npRequireShopReturnTrackingReconcileActionInput,
  npRequireStoredShopReturnTracking,
  npRequireStoredShopReturnTrackingPoll,
  npRequireStoredShopReturnTrackingReceipt,
  npShopReturnTrackingEventDigest,
  npShopReturnTrackingPollStorageKey,
  npShopReturnTrackingReceiptStorageKey,
  npShopReturnTrackingStorageKey,
} from "./return-tracking-contract.js";

const logisticsId = "10000000-0000-4000-8000-000000000001";
const returnId = "20000000-0000-4000-8000-000000000002";
const orderId = "30000000-0000-4000-8000-000000000003";
const now = new Date("2026-08-05T00:00:00.000Z");

const event = {
  contract: NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT,
  eventId: "return_event_1",
  logisticsId,
  returnId,
  orderId,
  returnReference: "RETURN-REF-1",
  trackingNumber: "RETURN-TRACK-1",
  status: "in-transit" as const,
  occurredAt: "2026-08-04T23:59:00.000Z",
  signedAt: now.toISOString(),
};

describe("Shop return tracking contract", () => {
  it("accepts one fresh exact reverse-shipment event and rejects stale or extra fields", () => {
    expect(npRequireFreshShopReturnTrackingEvent(event, now)).toEqual(event);
    expect(
      npRequireFreshShopReturnTrackingEvent({ ...event, trackingNumber: "RETURN TRACK 1" }, now)
        .trackingNumber,
    ).toBe("RETURN TRACK 1");
    expect(() =>
      npRequireFreshShopReturnTrackingEvent(
        { ...event, signedAt: "2026-08-04T23:50:00.000Z" },
        now,
      ),
    ).toThrow(/Stale Shop return-tracking event/u);
    expect(() =>
      npRequireFreshShopReturnTrackingEvent({ ...event, address: "private" }, now),
    ).toThrow(/Invalid Shop return-tracking event/u);
    expect(() =>
      npRequireFreshShopReturnTrackingEvent(
        { ...event, contract: "np.shop-tracking-event.v1" },
        now,
      ),
    ).toThrow(/Invalid Shop return-tracking event/u);
  });

  it("binds polling results to the exact live return-logistics request", () => {
    const request = npRequireShopReturnTrackingPollRequest({
      contract: NP_SHOP_RETURN_TRACKING_POLL_REQUEST_CONTRACT,
      logisticsId,
      returnId,
      orderId,
      returnReference: event.returnReference,
      trackingNumber: event.trackingNumber,
      current: null,
      requestedAt: now.toISOString(),
    });
    const checkedAt = "2026-08-05T00:00:01.000Z";
    expect(
      npRequireShopReturnTrackingPollResult(
        {
          contract: NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
          logisticsId,
          returnId,
          orderId,
          checkedAt,
          event: { ...event, eventId: "poll-1", signedAt: checkedAt },
        },
        { request, receivedAt: new Date(checkedAt) },
      ),
    ).toMatchObject({ logisticsId, event: { eventId: "poll-1" } });
    expect(() =>
      npRequireShopReturnTrackingPollResult(
        {
          contract: NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
          logisticsId,
          returnId,
          orderId,
          checkedAt,
          event: { ...event, eventId: "poll-2", trackingNumber: "OTHER", signedAt: checkedAt },
        },
        { request, receivedAt: new Date(checkedAt) },
      ),
    ).toThrow(/Invalid return-tracking poll result/u);
    expect(() =>
      npRequireShopReturnTrackingPollResult(
        {
          contract: NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
          logisticsId,
          returnId,
          orderId,
          checkedAt,
          event: {
            ...event,
            eventId: "poll-delayed",
            occurredAt: "2026-06-01T00:00:00.000Z",
            signedAt: checkedAt,
          },
        },
        { request, receivedAt: new Date(checkedAt) },
      ),
    ).toThrow(/Invalid return-tracking poll result/u);
  });

  it("validates durable state, receipts, poll leases, projections, and canonical keys", () => {
    const purgeAt = "2027-08-05T00:00:00.000Z";
    const stored = {
      contract: NP_SHOP_RETURN_TRACKING_STORAGE_CONTRACT,
      orderId,
      returnId,
      logisticsId,
      providerId: "carrier",
      returnReference: event.returnReference,
      trackingNumber: event.trackingNumber,
      status: "in-transit" as const,
      latestEventId: event.eventId,
      occurredAt: event.occurredAt,
      deliveredAt: null,
      updatedAt: now.toISOString(),
      purgeAt,
    };
    expect(npRequireStoredShopReturnTracking(stored)).toEqual(stored);
    expect(npShopReturnTrackingStorageKey(orderId)).toBe(`return-tracking:${orderId}`);
    expect(() => npShopReturnTrackingStorageKey("not-an-order-id")).toThrow(
      /Invalid return-tracking order id/u,
    );
    expect(
      npAnalyzeShopReturnTracking({
        contract: NP_SHOP_RETURN_TRACKING_CONTRACT,
        logisticsId,
        status: "in-transit",
        occurredAt: event.occurredAt,
        deliveredAt: null,
        updatedAt: now.toISOString(),
      }),
    ).toEqual([]);
    expect(() =>
      npRequireStoredShopReturnTracking({ ...stored, status: "delivered", deliveredAt: null }),
    ).toThrow(/Invalid stored return tracking/u);

    const digest = npShopReturnTrackingEventDigest(event);
    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      npShopReturnTrackingEventDigest({
        ...event,
        signedAt: "2026-08-05T00:00:01.000Z",
      }),
    ).toBe(digest);
    expect(
      npRequireStoredShopReturnTrackingReceipt({
        contract: NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
        providerId: "carrier",
        event,
        eventDigest: digest,
        outcome: "advanced",
        trackingStatus: "in-transit",
        processedAt: now.toISOString(),
        purgeAt,
      }),
    ).toMatchObject({ eventDigest: digest });
    expect(() =>
      npRequireStoredShopReturnTrackingReceipt({
        contract: NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
        providerId: "carrier",
        event,
        eventDigest: "0".repeat(64),
        outcome: "advanced",
        trackingStatus: "in-transit",
        processedAt: now.toISOString(),
        purgeAt,
      }),
    ).toThrow(/Invalid stored return-tracking receipt/u);
    expect(npShopReturnTrackingReceiptStorageKey("carrier", event.eventId)).toMatch(
      /^return-tracking-event:carrier:[0-9a-f]{64}$/u,
    );
    expect(() => npShopReturnTrackingReceiptStorageKey("Carrier", event.eventId)).toThrow(
      /Invalid return-tracking provider id/u,
    );

    const poll = {
      contract: NP_SHOP_RETURN_TRACKING_POLL_STORAGE_CONTRACT,
      orderId,
      returnId,
      logisticsId,
      providerId: "carrier",
      consecutiveFailures: 0,
      lastAttemptAt: now.toISOString(),
      lastSuccessAt: null,
      nextAttemptAt: "2026-08-05T00:05:00.000Z",
      lastErrorCode: null,
      leaseId: logisticsId,
      leaseExpiresAt: "2026-08-05T00:05:00.000Z",
      updatedAt: now.toISOString(),
      purgeAt,
    };
    expect(npRequireStoredShopReturnTrackingPoll(poll)).toEqual(poll);
    expect(npShopReturnTrackingPollStorageKey(orderId)).toBe(`return-tracking-poll:${orderId}`);
    expect(() => npRequireStoredShopReturnTrackingPoll({ ...poll, leaseExpiresAt: null })).toThrow(
      /Invalid stored return-tracking poll/u,
    );
    expect(() =>
      npRequireStoredShopReturnTrackingPoll({
        ...poll,
        leaseId: null,
        leaseExpiresAt: null,
      }),
    ).toThrow(/Invalid stored return-tracking poll/u);

    expect(
      npRequireShopReturnTrackingPollCursor({
        contract: NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT,
        providerId: "carrier",
        lastLogisticsKey: `return-logistics:${orderId}`,
        updatedAt: now.toISOString(),
      }),
    ).toMatchObject({ lastLogisticsKey: `return-logistics:${orderId}` });
    expect(() =>
      npRequireShopReturnTrackingPollCursor({
        contract: NP_SHOP_RETURN_TRACKING_POLL_CURSOR_CONTRACT,
        providerId: "carrier",
        lastLogisticsKey: "return-logistics:not-an-order-id",
        updatedAt: now.toISOString(),
      }),
    ).toThrow(/Invalid return-tracking poll cursor/u);
  });

  it("accepts only exact Admin reconciliation row identities", () => {
    expect(
      npRequireShopReturnTrackingReconcileActionInput({
        row: { id: orderId, returnId, logisticsId },
        values: {},
      }),
    ).toEqual({ orderId, returnId, logisticsId });
    expect(() =>
      npRequireShopReturnTrackingReconcileActionInput({
        row: { id: orderId, returnId, logisticsId, customer: "private" },
        values: {},
      }),
    ).toThrow(/Invalid return-tracking action/u);
  });
});
