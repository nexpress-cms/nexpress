import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
  NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT,
  npAnalyzeStoredShopPartialRefund,
  npRequireShopPartialRefundActionInput,
  npRequireShopPaymentPartialRefundResult,
  npRequireStoredShopPartialRefund,
  type NpShopStoredPartialRefund,
} from "./partial-refund-contract.js";

const refundId = "123e4567-e89b-42d3-a456-426614174000";
const orderId = "223e4567-e89b-42d3-a456-426614174000";
const returnId = "323e4567-e89b-42d3-a456-426614174000";

function stored(overrides: Partial<NpShopStoredPartialRefund> = {}): NpShopStoredPartialRefund {
  return {
    contract: NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT,
    id: refundId,
    orderId,
    returnId,
    providerId: "test-pay",
    status: "pending",
    orderRevision: 2,
    returnRevision: 3,
    paymentReference: "payment_1",
    refundReference: null,
    currency: "KRW",
    amountMinor: 11_000,
    allocation: {
      lines: [{ lineKey: "product:_", quantity: 1, amountMinor: 10_000 }],
      itemAmountMinor: 10_000,
      shippingMinor: 500,
      taxMinor: 500,
    },
    reason: "Received defective return",
    providerErrorCode: null,
    requestedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    refundedAt: null,
    purgeAt: "2027-08-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("Shop partial refund contract", () => {
  it("accepts one exact received-return allocation", () => {
    expect(npRequireStoredShopPartialRefund(stored())).toMatchObject({
      amountMinor: 11_000,
      allocation: { itemAmountMinor: 10_000, shippingMinor: 500, taxMinor: 500 },
    });
    expect(
      npRequireShopPaymentPartialRefundResult({
        contract: NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
        refundId,
        orderId,
        returnId,
        paymentReference: "payment_1",
        refundReference: "partial_refund_1",
        currency: "KRW",
        amountMinor: 11_000,
        refundedAt: "2026-08-05T00:01:00.000Z",
      }),
    ).toMatchObject({ refundId, returnId, amountMinor: 11_000 });
  });

  it("rejects allocation drift, duplicate lines, unknown keys, and invalid states", () => {
    expect(
      npAnalyzeStoredShopPartialRefund(
        stored({
          amountMinor: 10_999,
          allocation: {
            lines: [
              { lineKey: "product:_", quantity: 1, amountMinor: 10_000 },
              { lineKey: "product:_", quantity: 1, amountMinor: 1 },
            ],
            itemAmountMinor: 10_000,
            shippingMinor: 500,
            taxMinor: 500,
          },
        }),
      ).join(" "),
    ).toMatch(/duplicated|sum|equal/u);
    expect(() => npRequireStoredShopPartialRefund({ ...stored(), secret: "leak" })).toThrow();
    expect(() =>
      npRequireStoredShopPartialRefund(
        stored({ status: "refunded", refundReference: null, refundedAt: null }),
      ),
    ).toThrow();
  });

  it("parses canonical minor-unit text from generic Admin row actions", () => {
    expect(
      npRequireShopPartialRefundActionInput({
        row: { id: orderId, orderRevision: 2, returnId, returnRevision: 3 },
        values: { shippingMinor: "500", taxMinor: "0", reason: "Received return" },
      }),
    ).toEqual({
      orderId,
      orderRevision: 2,
      returnId,
      returnRevision: 3,
      shippingMinor: 500,
      taxMinor: 0,
      reason: "Received return",
    });
    expect(() =>
      npRequireShopPartialRefundActionInput({
        row: { id: orderId, orderRevision: 2, returnId, returnRevision: 3 },
        values: { shippingMinor: "01", taxMinor: "0", reason: "Received return" },
      }),
    ).toThrow();
  });
});
