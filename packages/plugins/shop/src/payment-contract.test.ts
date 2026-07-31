import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
  NpShopPaymentVerificationError,
  npAnalyzeShopPaymentEvent,
  npAnalyzeStoredShopPaymentReceipt,
  npRequireFreshShopPaymentEvent,
  npShopPaymentEventDigest,
  npShopPaymentReceiptStorageKey,
} from "./payment-contract.js";

const event = {
  contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
  eventId: "evt_123",
  type: "payment.succeeded",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  paymentReference: "pay_123",
  currency: "KRW",
  amountMinor: 25_000,
  signedAt: "2026-07-31T00:00:00.000Z",
} as const;

describe("Shop payment event contract", () => {
  it("accepts one exact verified provider-neutral event", () => {
    expect(npAnalyzeShopPaymentEvent(event)).toEqual([]);
    expect(npRequireFreshShopPaymentEvent(event, new Date("2026-07-31T00:04:59.000Z"))).toEqual(
      event,
    );
    expect(npShopPaymentReceiptStorageKey("test-pay", event.eventId)).toMatch(
      /^payment-event:test-pay:[0-9a-f]{64}$/u,
    );
  });

  it("rejects stale signatures and provider-specific payload leakage", () => {
    expect(() =>
      npRequireFreshShopPaymentEvent(event, new Date("2026-07-31T00:05:01.000Z")),
    ).toThrow(NpShopPaymentVerificationError);
    expect(() => npRequireFreshShopPaymentEvent(event, new Date(Number.NaN))).toThrow(
      NpShopPaymentVerificationError,
    );
    expect(npAnalyzeShopPaymentEvent({ ...event, cardNumber: "not-supported" })).toContain(
      "payment event.cardNumber is not supported.",
    );
    expect(
      npAnalyzeShopPaymentEvent({ ...event, paymentReference: "buyer@example.com" }),
    ).toContain("payment event.paymentReference is invalid.");
  });

  it("requires a PII-free receipt whose digest matches the canonical event", () => {
    const receipt = {
      contract: NP_SHOP_PAYMENT_RECEIPT_CONTRACT,
      providerId: "test-pay",
      event,
      eventDigest: npShopPaymentEventDigest(event),
      outcome: "paid",
      orderStatus: "paid",
      orderRevision: 2,
      processedAt: "2026-07-31T00:00:01.000Z",
      purgeAt: "2027-07-30T00:00:00.000Z",
    };
    expect(npAnalyzeStoredShopPaymentReceipt(receipt)).toEqual([]);
    expect(
      npAnalyzeStoredShopPaymentReceipt({ ...receipt, eventDigest: "a".repeat(64) }),
    ).toContain("payment receipt.eventDigest must match its canonical event.");
    expect(
      npShopPaymentEventDigest({
        signedAt: event.signedAt,
        amountMinor: event.amountMinor,
        currency: event.currency,
        paymentReference: event.paymentReference,
        orderId: event.orderId,
        type: event.type,
        eventId: event.eventId,
        contract: event.contract,
      }),
    ).toBe(receipt.eventDigest);
    expect(
      npShopPaymentEventDigest({
        ...event,
        signedAt: "2026-07-31T00:04:00.000Z",
      }),
    ).toBe(receipt.eventDigest);
    expect(
      npAnalyzeStoredShopPaymentReceipt({
        ...receipt,
        event: { ...event, type: "payment.failed" },
        eventDigest: npShopPaymentEventDigest({ ...event, type: "payment.failed" }),
      }),
    ).toContain("paid receipts require a succeeded event and paid order status.");
    expect(
      npAnalyzeStoredShopPaymentReceipt({
        ...receipt,
        processedAt: "2026-07-31T00:05:01.000Z",
      }),
    ).toContain("payment receipt event timestamp is outside its processing replay window.");
  });
});
