import { describe, expect, it } from "vitest";

import {
  NP_SHOP_ORDER_CONTRACT,
  NP_SHOP_ORDER_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_STORAGE_CONTRACT,
  npAnalyzeShopOrder,
  npAnalyzeStoredShopOrder,
  npAnalyzeStoredShopOrderPrivate,
  npRequireShopOrderCancelInput,
  npRequireShopOrderCreateInput,
  npRequireShopOrderList,
} from "./order-contract.js";

const createdAt = "2026-07-30T00:00:00.000Z";
const pendingExpiresAt = "2026-07-31T00:00:00.000Z";
const purgeAt = "2027-07-30T00:00:00.000Z";
const orderId = "123e4567-e89b-42d3-a456-426614174000";
const draftId = "223e4567-e89b-42d3-a456-426614174000";
const intentId = "323e4567-e89b-42d3-a456-426614174000";
const productId = "423e4567-e89b-42d3-a456-426614174000";

const line = {
  key: `${productId}:base`,
  productId,
  productSlug: "daily-cup",
  productName: "Daily cup",
  variantSku: null,
  variantName: null,
  quantity: 2,
  unitPriceMinor: 12_000,
  lineTotalMinor: 24_000,
};

const storedOrder = {
  contract: NP_SHOP_ORDER_STORAGE_CONTRACT,
  id: orderId,
  status: "pending-payment",
  revision: 1,
  ownerSegment: `guest:${"a".repeat(64)}`,
  sourceDraftId: draftId,
  checkoutIntentId: intentId,
  cartRevision: 2,
  cartFingerprint: "b".repeat(64),
  currency: "KRW",
  subtotalMinor: 24_000,
  shippingMinor: 0,
  totalMinor: 24_000,
  totalUnits: 2,
  lines: [line],
  deliveryMethod: null,
  privateDataStatus: "retained",
  inventoryReservationStatus: "held",
  inventoryReservationLineKeys: [line.key],
  createdAt,
  updatedAt: createdAt,
  pendingExpiresAt,
  paymentProvider: null,
  paymentReference: null,
  paymentEventId: null,
  paymentResolvedAt: null,
  cancelledAt: null,
  cancellationReason: null,
  purgeAt,
} as const;

const privateData = {
  contract: NP_SHOP_ORDER_PRIVATE_CONTRACT,
  orderId,
  customer: {
    fullName: "Kim Nexpress",
    email: "kim@example.com",
    phone: "010-1234-5678",
  },
  shipping: {
    recipientName: "Kim Nexpress",
    phone: "010-1234-5678",
    countryCode: "KR",
    postalCode: "04524",
    addressLine1: "1 Sejong-daero",
    addressLine2: null,
    locality: "Jung-gu",
    administrativeArea: "Seoul",
  },
  createdAt,
  expiresAt: pendingExpiresAt,
} as const;

const publicOrder = {
  ...storedOrder,
  contract: NP_SHOP_ORDER_CONTRACT,
  ownerSegment: undefined,
  customer: privateData.customer,
  shipping: privateData.shipping,
};
delete (publicOrder as { ownerSegment?: unknown }).ownerSegment;

describe("Shop order contract", () => {
  it("accepts exact commercial, private, and owner-facing values", () => {
    expect(npAnalyzeStoredShopOrder(storedOrder)).toEqual([]);
    expect(npAnalyzeStoredShopOrderPrivate(privateData)).toEqual([]);
    expect(npAnalyzeShopOrder(publicOrder)).toEqual([]);
    expect(
      npRequireShopOrderList({
        contract: "np.shop-order-list.v1",
        orders: [publicOrder],
        total: 1,
      }),
    ).toMatchObject({ total: 1 });
  });

  it("rejects impossible totals, cancellation state, and leaked private values", () => {
    expect(
      npAnalyzeStoredShopOrder({
        ...storedOrder,
        subtotalMinor: 1,
        status: "cancelled",
      }),
    ).toEqual(
      expect.arrayContaining([
        "cancelled orders require cancellation metadata, redacted private data, and no held inventory.",
        "order.subtotalMinor must equal line totals.",
      ]),
    );
    expect(
      npAnalyzeShopOrder({
        ...publicOrder,
        privateDataStatus: "redacted",
      }),
    ).toContain("redacted orders cannot expose customer or shipping data.");
  });

  it("accepts exact paid and failed terminal payment states", () => {
    const payment = {
      paymentProvider: "test-pay",
      paymentReference: "pay_123",
      paymentEventId: "evt_123",
      paymentResolvedAt: "2026-07-30T00:05:00.000Z",
      updatedAt: "2026-07-30T00:05:00.000Z",
    };
    expect(
      npAnalyzeStoredShopOrder({
        ...storedOrder,
        ...payment,
        status: "paid",
        revision: 2,
        inventoryReservationStatus: "consumed",
      }),
    ).toEqual([]);
    const paidPublicOrder = {
      ...publicOrder,
      ...payment,
      status: "paid",
      revision: 2,
      inventoryReservationStatus: "consumed",
      fulfillment: {
        contract: "np.shop-fulfillment.v1",
        orderId,
        status: "awaiting",
        revision: 1,
        privateDataStatus: "retained",
        carrier: null,
        trackingNumber: null,
        createdAt: payment.paymentResolvedAt,
        updatedAt: payment.paymentResolvedAt,
        shippedAt: null,
      },
    } as const;
    expect(npAnalyzeShopOrder(paidPublicOrder)).toEqual([]);
    expect(
      npAnalyzeShopOrder({
        ...paidPublicOrder,
        status: "refunded",
        revision: 3,
        privateDataStatus: "redacted",
        customer: null,
        shipping: null,
        fulfillment: {
          ...paidPublicOrder.fulfillment,
          status: "cancelled",
          revision: 2,
          privateDataStatus: "redacted",
          updatedAt: "2026-07-30T00:10:00.000Z",
        },
        updatedAt: "2026-07-30T00:10:00.000Z",
        refund: {
          contract: "np.shop-refund.v1",
          id: "523e4567-e89b-42d3-a456-426614174000",
          status: "refunded",
          currency: "KRW",
          amountMinor: 24_000,
          inventoryOutcome: "restocked",
          fulfillmentOutcome: "cancelled",
          requestedAt: "2026-07-30T00:09:00.000Z",
          refundedAt: "2026-07-30T00:09:59.000Z",
        },
      }),
    ).toEqual([]);
    expect(
      npAnalyzeShopOrder({
        ...paidPublicOrder,
        fulfillment: { ...paidPublicOrder.fulfillment, orderId: draftId },
      }),
    ).toContain(
      "order.fulfillment must match the paid order id, payment timestamp, and private-data state.",
    );
    expect(
      npAnalyzeStoredShopOrder({
        ...storedOrder,
        ...payment,
        status: "payment-failed",
        revision: 2,
        privateDataStatus: "redacted",
        inventoryReservationStatus: "released",
      }),
    ).toEqual([]);
  });

  it("requires canonical guest hashes or member UUIDs for stored ownership", () => {
    expect(
      npAnalyzeStoredShopOrder({
        ...storedOrder,
        ownerSegment: "member:not-a-canonical-member-uuid---",
      }),
    ).toContain("order.ownerSegment is invalid.");
    expect(
      npAnalyzeStoredShopOrder({
        ...storedOrder,
        ownerSegment: "member:123e4567-e89b-42d3-a456-426614174000",
      }),
    ).not.toContain("order.ownerSegment is invalid.");
  });

  it("validates exact idempotent creation and revision-safe cancellation inputs", () => {
    expect(
      npRequireShopOrderCreateInput({
        idempotencyKey: orderId,
        draftId,
        expectedRevision: 2,
      }),
    ).toEqual({ idempotencyKey: orderId, draftId, expectedRevision: 2 });
    expect(npRequireShopOrderCancelInput({ orderId, expectedRevision: 1 })).toEqual({
      orderId,
      expectedRevision: 1,
    });
    expect(() =>
      npRequireShopOrderCreateInput({
        idempotencyKey: orderId,
        draftId,
        expectedRevision: 0,
        extra: true,
      }),
    ).toThrow(/Invalid order create request/u);
  });

  it("requires private expiry to follow creation", () => {
    expect(
      npAnalyzeStoredShopOrderPrivate({
        ...privateData,
        expiresAt: createdAt,
      }),
    ).toContain("private.expiresAt must equal the fixed pending lifetime.");
  });

  it("accepts the paid fulfillment private sidecar for exactly 30 days", () => {
    expect(
      npAnalyzeStoredShopOrderPrivate({
        ...privateData,
        contract: NP_SHOP_ORDER_FULFILLMENT_PRIVATE_CONTRACT,
        retainedAt: "2026-07-30T00:05:00.000Z",
        expiresAt: "2026-08-29T00:05:00.000Z",
      }),
    ).toEqual([]);
  });
});
