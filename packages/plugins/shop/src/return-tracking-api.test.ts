import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NpShopCarrierReturnTrackingAdapter } from "./carrier-contract.js";
import { createShopReturnTrackingApiHandler } from "./return-tracking-api.js";
import {
  NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
  npShopReturnTrackingEventDigest,
} from "./return-tracking-contract.js";
import { NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT } from "./tracking-contract.js";

const applyReturnTrackingEvent = vi.fn();

vi.mock("./return-tracking-service.js", () => ({
  npApplyShopReturnTrackingEvent: (...args: unknown[]) => applyReturnTrackingEvent(...args),
}));

const event = {
  contract: NP_SHOP_RETURN_TRACKING_EVENT_CONTRACT,
  eventId: "return_tracking_evt_123",
  logisticsId: "123e4567-e89b-42d3-a456-426614174000",
  returnId: "223e4567-e89b-42d3-a456-426614174000",
  orderId: "323e4567-e89b-42d3-a456-426614174000",
  returnReference: "return_123",
  trackingNumber: "RETURN-TRACK-123",
  status: "in-transit",
  occurredAt: new Date().toISOString(),
  signedAt: new Date().toISOString(),
} as const;

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    path: "/carrier/return-tracking/webhook",
    params: {},
    query: {},
    bodyMode: "raw",
    body: undefined,
    rawBody: new TextEncoder().encode('{"id":"return_tracking_evt_123"}'),
    headers: { "x-carrier-signature": "valid" },
    ...overrides,
  } as never;
}

function adapter(
  verifyReturnTrackingWebhook: NpShopCarrierReturnTrackingAdapter["verifyReturnTrackingWebhook"],
): NpShopCarrierReturnTrackingAdapter {
  return {
    id: "test-carrier",
    bookShipment: () => Promise.reject(new Error("not called")),
    createReturnShipment: () => Promise.reject(new Error("not called")),
    cancelReturnShipment: () => Promise.reject(new Error("not called")),
    verifyReturnTrackingWebhook,
  };
}

describe("Shop carrier return-tracking webhook", () => {
  beforeEach(() => applyReturnTrackingEvent.mockReset());

  it("passes exact bytes and returns one bounded reverse-shipment receipt", async () => {
    applyReturnTrackingEvent.mockResolvedValue({
      duplicate: false,
      tracking: { status: "in-transit" },
      receipt: {
        contract: NP_SHOP_RETURN_TRACKING_RECEIPT_CONTRACT,
        providerId: "test-carrier",
        event,
        eventDigest: npShopReturnTrackingEventDigest(event),
        outcome: "advanced",
        trackingStatus: "in-transit",
        processedAt: new Date().toISOString(),
        purgeAt: "2027-08-05T00:00:00.000Z",
      },
    });
    const verifyReturnTrackingWebhook = vi.fn(() => event);
    const response = await createShopReturnTrackingApiHandler(adapter(verifyReturnTrackingWebhook))(
      request(),
    );
    expect(response).toMatchObject({
      status: 200,
      body: {
        receipt: { providerId: "test-carrier", eventId: event.eventId, outcome: "advanced" },
        duplicate: false,
      },
    });
    expect(verifyReturnTrackingWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: expect.any(Uint8Array),
        headers: { "x-carrier-signature": "valid" },
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("x-carrier-signature");
  });

  it("rejects non-raw and unverifiable callbacks before storage", async () => {
    const configured = adapter(vi.fn(() => null));
    expect(
      (
        await createShopReturnTrackingApiHandler(configured)(
          request({ bodyMode: "json", rawBody: undefined }),
        )
      ).status,
    ).toBe(400);
    expect((await createShopReturnTrackingApiHandler(configured)(request())).status).toBe(401);
    expect(applyReturnTrackingEvent).not.toHaveBeenCalled();
  });

  it("acknowledges authenticated unsupported callbacks without storage", async () => {
    const response = await createShopReturnTrackingApiHandler(
      adapter(
        vi.fn(
          () =>
            ({
              contract: NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT,
              ignored: true,
              reason: "unsupported-event",
            }) as const,
        ),
      ),
    )(request());
    expect(response).toMatchObject({ status: 200, body: { ignored: true } });
    expect(applyReturnTrackingEvent).not.toHaveBeenCalled();
  });
});
