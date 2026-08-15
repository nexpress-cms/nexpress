import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT,
  NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT,
  NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT,
  NpShopPaymentDisputeContractError,
  NpShopPaymentDisputeVerificationError,
  npAnalyzeShopPaymentDisputeEvent,
  npIsShopPaymentDisputeEvent,
  npRequireFreshShopPaymentDisputeEvent,
  npRequireShopPaymentDisputeEvent,
  npRequireStoredShopPaymentDispute,
  npRequireStoredShopPaymentDisputeReceipt,
  npShopPaymentDisputeEventDigest,
  npShopPaymentDisputeReceiptStorageKey,
  npShopPaymentDisputeRequiresReview,
  npShopPaymentDisputeStorageKey,
  type NpShopVerifiedPaymentDisputeEvent,
} from "./payment-dispute-contract.js";

const event: NpShopVerifiedPaymentDisputeEvent = {
  contract: NP_SHOP_PAYMENT_DISPUTE_EVENT_CONTRACT,
  eventId: "evt_dispute_123",
  disputeReference: "dp_1234567890",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  paymentReference: "payment_123",
  currency: "USD",
  amountMinor: 2_500,
  status: "needs-response",
  reasonCode: "fraudulent",
  occurredAt: "2026-08-15T00:04:00.000Z",
  signedAt: "2026-08-15T00:05:00.000Z",
};

describe("Shop payment dispute evidence contract", () => {
  it("accepts fresh PII-free evidence and derives opaque storage keys", () => {
    expect(npAnalyzeShopPaymentDisputeEvent(event)).toEqual([]);
    expect(
      npRequireFreshShopPaymentDisputeEvent(event, new Date("2026-08-15T00:09:59.000Z")),
    ).toEqual(event);
    expect(() =>
      npRequireFreshShopPaymentDisputeEvent(event, new Date("2026-08-15T00:10:01.000Z")),
    ).toThrow(NpShopPaymentDisputeVerificationError);
    expect(npShopPaymentDisputeStorageKey("stripe", event.disputeReference)).toMatch(
      /^payment-dispute:stripe:[0-9a-f]{64}$/u,
    );
    expect(npShopPaymentDisputeReceiptStorageKey("stripe", event.eventId)).toMatch(
      /^payment-dispute-event:stripe:[0-9a-f]{64}$/u,
    );
  });

  it("rejects unsupported statuses, reason text, and unauthenticated future evidence", () => {
    expect(npAnalyzeShopPaymentDisputeEvent({ ...event, status: "closed" })).toContain(
      "payment dispute event.status is invalid.",
    );
    expect(npAnalyzeShopPaymentDisputeEvent({ ...event, reasonCode: "Card stolen" })).toContain(
      "payment dispute event.reasonCode is invalid.",
    );
    expect(
      npAnalyzeShopPaymentDisputeEvent({
        ...event,
        occurredAt: "2026-08-15T00:05:31.000Z",
      }),
    ).toContain("payment dispute event.occurredAt cannot follow its authenticated timestamp.");
  });

  it("copies descriptor-safe input without invoking hostile accessors or coercion", () => {
    let propertyReads = 0;
    const proxiedEvent = new Proxy(event, {
      get() {
        propertyReads += 1;
        throw new Error("hostile get");
      },
    });

    expect(npAnalyzeShopPaymentDisputeEvent(proxiedEvent)).toEqual([]);
    expect(npIsShopPaymentDisputeEvent(proxiedEvent)).toBe(true);
    const canonical = npRequireShopPaymentDisputeEvent(proxiedEvent);
    expect(canonical).toEqual(event);
    expect(Object.is(canonical, proxiedEvent)).toBe(false);
    expect(propertyReads).toBe(0);

    const hostilePrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("hostile prototype");
        },
      },
    );
    expect(() => npAnalyzeShopPaymentDisputeEvent(hostilePrototype)).not.toThrow();
    expect(npAnalyzeShopPaymentDisputeEvent(hostilePrototype)).toEqual([
      "payment dispute event could not be inspected safely.",
    ]);
    expect(npIsShopPaymentDisputeEvent(hostilePrototype)).toBe(false);
    expect(() => npShopPaymentDisputeStorageKey(Symbol("provider") as never, "dp_123")).toThrow(
      NpShopPaymentDisputeContractError,
    );
  });

  it("binds durable state and receipts to exact canonical evidence", () => {
    const state = npRequireStoredShopPaymentDispute({
      contract: NP_SHOP_PAYMENT_DISPUTE_STORAGE_CONTRACT,
      providerId: "stripe",
      disputeReference: event.disputeReference,
      orderId: event.orderId,
      paymentReference: event.paymentReference,
      currency: event.currency,
      amountMinor: event.amountMinor,
      status: event.status,
      reasonCode: event.reasonCode,
      latestEventId: event.eventId,
      openedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      purgeAt: "2027-08-15T00:00:00.000Z",
    });
    expect(npShopPaymentDisputeRequiresReview(state)).toBe(true);
    expect(npShopPaymentDisputeRequiresReview("lost")).toBe(true);
    expect(npShopPaymentDisputeRequiresReview("won")).toBe(false);
    expect(npShopPaymentDisputeRequiresReview("warning-closed")).toBe(false);
    expect(npShopPaymentDisputeRequiresReview("prevented")).toBe(false);

    const digest = npShopPaymentDisputeEventDigest(event);
    expect(
      npRequireStoredShopPaymentDisputeReceipt({
        contract: NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT,
        providerId: "stripe",
        event,
        eventDigest: digest,
        outcome: "opened",
        orderStatus: "paid",
        orderRevision: 2,
        processedAt: "2026-08-15T00:05:01.000Z",
        purgeAt: "2027-08-15T00:00:00.000Z",
      }),
    ).toMatchObject({ eventDigest: digest, outcome: "opened" });
    expect(() =>
      npRequireStoredShopPaymentDisputeReceipt({
        contract: NP_SHOP_PAYMENT_DISPUTE_RECEIPT_CONTRACT,
        providerId: "stripe",
        event,
        eventDigest: "a".repeat(64),
        outcome: "opened",
        orderStatus: "paid",
        orderRevision: 2,
        processedAt: "2026-08-15T00:05:01.000Z",
        purgeAt: "2027-08-15T00:00:00.000Z",
      }),
    ).toThrow(/Invalid Shop payment dispute receipt/u);
  });
});
