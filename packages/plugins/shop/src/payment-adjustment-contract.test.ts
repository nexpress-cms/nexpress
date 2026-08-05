import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT,
  NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT,
  NpShopPaymentAdjustmentVerificationError,
  npAnalyzeShopPaymentAdjustmentEvent,
  npRequireFreshShopPaymentAdjustmentEvent,
  npProjectShopPaymentAdjustment,
  npRequireStoredShopPaymentAdjustment,
  npRequireStoredShopPaymentAdjustmentReceipt,
  npShopPaymentAdjustmentEventDigest,
  npShopPaymentAdjustmentReceiptStorageKey,
  type NpShopVerifiedPaymentAdjustmentEvent,
} from "./payment-adjustment-contract.js";

const event: NpShopVerifiedPaymentAdjustmentEvent = {
  contract: NP_SHOP_PAYMENT_ADJUSTMENT_EVENT_CONTRACT,
  eventId: "adjustment:abc123",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  paymentReference: "payment_123",
  currency: "KRW",
  originalAmountMinor: 25_000,
  remainingAmountMinor: 15_000,
  cancellations: [
    {
      reference: "cancel_123",
      amountMinor: 10_000,
      cancelledAt: "2026-08-05T00:04:00.000Z",
    },
  ],
  signedAt: "2026-08-05T00:05:00.000Z",
};

describe("Shop payment adjustment contract", () => {
  it("accepts one exact cumulative cancellation snapshot", () => {
    expect(npAnalyzeShopPaymentAdjustmentEvent(event)).toEqual([]);
    expect(
      npRequireFreshShopPaymentAdjustmentEvent(event, new Date("2026-08-05T00:09:59.000Z")),
    ).toEqual(event);
    expect(() =>
      npRequireFreshShopPaymentAdjustmentEvent(event, new Date("2026-08-05T00:10:01.000Z")),
    ).toThrow(NpShopPaymentAdjustmentVerificationError);
    expect(npShopPaymentAdjustmentReceiptStorageKey("test-pay", event.eventId)).toMatch(
      /^payment-adjustment-event:test-pay:[0-9a-f]{64}$/u,
    );
  });

  it("rejects inconsistent totals, duplicate references, and noncanonical ordering", () => {
    expect(
      npAnalyzeShopPaymentAdjustmentEvent({ ...event, remainingAmountMinor: 14_999 }),
    ).toContain(
      "payment adjustment event cancellation total must equal original minus remaining amount.",
    );
    expect(
      npAnalyzeShopPaymentAdjustmentEvent({
        ...event,
        cancellations: [
          { ...event.cancellations[0], cancelledAt: "2026-08-05T00:05:00.000Z" },
          { ...event.cancellations[0], amountMinor: 5_000 },
        ],
        remainingAmountMinor: 10_000,
      }),
    ).toEqual(
      expect.arrayContaining([
        "payment adjustment event.cancellations[1].reference is duplicated.",
        "payment adjustment event.cancellations must be canonically ordered.",
      ]),
    );
    expect(
      npAnalyzeShopPaymentAdjustmentEvent({
        ...event,
        cancellations: [{ ...event.cancellations[0], cancelledAt: "2026-08-05T00:05:31.000Z" }],
      }),
    ).toContain("payment adjustment event.cancellations[0].cancelledAt cannot be in the future.");
  });

  it("binds receipts and durable state to exact PII-free content", () => {
    const digest = npShopPaymentAdjustmentEventDigest(event);
    expect(
      npRequireStoredShopPaymentAdjustmentReceipt({
        contract: NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT,
        providerId: "test-pay",
        event,
        eventDigest: digest,
        outcome: "manual-review",
        orderStatus: "paid",
        orderRevision: 2,
        processedAt: "2026-08-05T00:05:01.000Z",
        purgeAt: "2027-08-05T00:00:00.000Z",
      }),
    ).toMatchObject({ eventDigest: digest, outcome: "manual-review" });
    expect(() =>
      npRequireStoredShopPaymentAdjustmentReceipt({
        contract: NP_SHOP_PAYMENT_ADJUSTMENT_RECEIPT_CONTRACT,
        providerId: "test-pay",
        event,
        eventDigest: "a".repeat(64),
        outcome: "manual-review",
        orderStatus: "paid",
        orderRevision: 2,
        processedAt: "2026-08-05T00:05:01.000Z",
        purgeAt: "2027-08-05T00:00:00.000Z",
      }),
    ).toThrow(/Invalid Shop payment adjustment receipt/u);
    const stored = npRequireStoredShopPaymentAdjustment({
      contract: NP_SHOP_PAYMENT_ADJUSTMENT_STORAGE_CONTRACT,
      providerId: "test-pay",
      orderId: event.orderId,
      paymentReference: event.paymentReference,
      currency: event.currency,
      originalAmountMinor: event.originalAmountMinor,
      remainingAmountMinor: event.remainingAmountMinor,
      cancellations: event.cancellations,
      status: "manual-review",
      latestEventId: event.eventId,
      orderRevision: 2,
      inventoryOutcome: "pending",
      fulfillmentOutcome: "pending",
      updatedAt: "2026-08-05T00:05:01.000Z",
      purgeAt: "2027-08-05T00:00:00.000Z",
    });
    expect(stored).toMatchObject({ status: "manual-review", remainingAmountMinor: 15_000 });
    expect(npProjectShopPaymentAdjustment(stored)).toEqual({
      contract: "np.shop-payment-adjustment.v1",
      status: "manual-review",
      currency: "KRW",
      originalAmountMinor: 25_000,
      reversedAmountMinor: 10_000,
      remainingAmountMinor: 15_000,
      cancellationCount: 1,
      inventoryOutcome: "pending",
      fulfillmentOutcome: "pending",
      updatedAt: "2026-08-05T00:05:01.000Z",
    });
  });
});
