import { beforeEach, describe, expect, it, vi } from "vitest";

import { createShopPaymentApiHandler } from "./payment-api.js";
import {
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
  npShopPaymentEventDigest,
} from "./payment-contract.js";

const applyPaymentEvent = vi.fn();

vi.mock("./order-service.js", () => ({
  npApplyShopPaymentEvent: (...args: unknown[]) => applyPaymentEvent(...args),
}));

const event = {
  contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
  eventId: "evt_123",
  type: "payment.succeeded",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  paymentReference: "pay_123",
  currency: "KRW",
  amountMinor: 25_000,
  signedAt: new Date().toISOString(),
} as const;

function runtime(verifyWebhook: () => unknown) {
  return {
    basePath: "/shop",
    collections: { categories: "shop-categories", products: "shop-products" },
    defaultSkinId: "classic",
    skins: new Map(),
    paymentAdapter: { id: "test-pay", verifyWebhook },
  } as never;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "POST",
    path: "/payments/webhook",
    params: {},
    query: {},
    bodyMode: "raw",
    body: undefined,
    rawBody: new TextEncoder().encode('{"id":"evt_123"}'),
    headers: { "x-test-signature": "valid" },
    ...overrides,
  } as never;
}

describe("Shop payment webhook", () => {
  beforeEach(() => {
    applyPaymentEvent.mockReset();
  });

  it("passes exact bytes to the adapter and returns a bounded receipt", async () => {
    applyPaymentEvent.mockResolvedValue({
      duplicate: false,
      orderStatus: "paid",
      receipt: {
        contract: NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
        providerId: "test-pay",
        event,
        eventDigest: npShopPaymentEventDigest(event),
        outcome: "paid",
        orderStatus: "paid",
        orderRevision: 2,
        processedAt: new Date().toISOString(),
        purgeAt: "2027-07-31T00:00:00.000Z",
      },
    });
    const verifyWebhook = vi.fn(() => event);
    const response = await createShopPaymentApiHandler(runtime(verifyWebhook))(request());

    expect(response.status).toBe(200);
    expect(verifyWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: expect.any(Uint8Array),
        headers: { "x-test-signature": "valid" },
      }),
    );
    expect(response.body).toEqual({
      receipt: expect.objectContaining({
        providerId: "test-pay",
        eventId: "evt_123",
        outcome: "paid",
      }),
      duplicate: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("x-test-signature");
  });

  it("rejects invalid signatures and non-raw dispatch before mutation", async () => {
    expect(
      (
        await createShopPaymentApiHandler(runtime(() => null))(
          request({ bodyMode: "json", rawBody: undefined }),
        )
      ).status,
    ).toBe(400);
    expect((await createShopPaymentApiHandler(runtime(() => null))(request())).status).toBe(401);
    expect(applyPaymentEvent).not.toHaveBeenCalled();
  });
});
