import { beforeEach, describe, expect, it, vi } from "vitest";

import { createShopTrackingApiHandler } from "./tracking-api.js";
import {
  NP_SHOP_TRACKING_EVENT_CONTRACT,
  NP_SHOP_TRACKING_RECEIPT_CONTRACT,
  NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT,
  npShopTrackingEventDigest,
} from "./tracking-contract.js";

const applyTrackingEvent = vi.fn();

vi.mock("./tracking-service.js", () => ({
  npApplyShopTrackingEvent: (...args: unknown[]) => applyTrackingEvent(...args),
}));

const event = {
  contract: NP_SHOP_TRACKING_EVENT_CONTRACT,
  eventId: "tracking_evt_123",
  shipmentId: "123e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174001",
  bookingReference: "booking_123",
  trackingNumber: "TRACK-123",
  status: "in-transit",
  occurredAt: new Date().toISOString(),
  signedAt: new Date().toISOString(),
} as const;

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    path: "/carrier/tracking/webhook",
    params: {},
    query: {},
    bodyMode: "raw",
    body: undefined,
    rawBody: new TextEncoder().encode('{"id":"tracking_evt_123"}'),
    headers: { "x-carrier-signature": "valid" },
    ...overrides,
  } as never;
}

describe("Shop carrier tracking webhook", () => {
  beforeEach(() => applyTrackingEvent.mockReset());

  it("passes exact bytes and returns one bounded receipt", async () => {
    applyTrackingEvent.mockResolvedValue({
      duplicate: false,
      tracking: { status: "in-transit" },
      receipt: {
        contract: NP_SHOP_TRACKING_RECEIPT_CONTRACT,
        providerId: "test-carrier",
        event,
        eventDigest: npShopTrackingEventDigest(event),
        outcome: "advanced",
        trackingStatus: "in-transit",
        processedAt: new Date().toISOString(),
        purgeAt: "2027-08-02T00:00:00.000Z",
      },
    });
    const verifyTrackingWebhook = vi.fn(() => event);
    const response = await createShopTrackingApiHandler({
      id: "test-carrier",
      bookShipment: vi.fn(),
      verifyTrackingWebhook,
    })(request());
    expect(response).toMatchObject({
      status: 200,
      body: {
        receipt: { providerId: "test-carrier", eventId: event.eventId, outcome: "advanced" },
        duplicate: false,
      },
    });
    expect(verifyTrackingWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: expect.any(Uint8Array),
        headers: { "x-carrier-signature": "valid" },
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("x-carrier-signature");
  });

  it("rejects non-raw and unverifiable callbacks before storage", async () => {
    const adapter = {
      id: "test-carrier",
      bookShipment: vi.fn(),
      verifyTrackingWebhook: vi.fn(() => null),
    };
    expect(
      (
        await createShopTrackingApiHandler(adapter)(
          request({ bodyMode: "json", rawBody: undefined }),
        )
      ).status,
    ).toBe(400);
    expect((await createShopTrackingApiHandler(adapter)(request())).status).toBe(401);
    expect(applyTrackingEvent).not.toHaveBeenCalled();
  });

  it("acknowledges authenticated unsupported callbacks without storage", async () => {
    const response = await createShopTrackingApiHandler({
      id: "test-carrier",
      bookShipment: vi.fn(),
      verifyTrackingWebhook: vi.fn(
        () =>
          ({
            contract: NP_SHOP_TRACKING_WEBHOOK_IGNORED_CONTRACT,
            ignored: true,
            reason: "unsupported-event",
          }) as const,
      ),
    })(request());
    expect(response).toMatchObject({ status: 200, body: { ignored: true } });
    expect(applyTrackingEvent).not.toHaveBeenCalled();
  });
});
