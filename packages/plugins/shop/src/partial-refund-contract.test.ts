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
import { npDeriveShopPartialRefundAllocation } from "./partial-refund-service.js";

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
  it("allocates returned items after their frozen promotion discount", () => {
    const allocation = npDeriveShopPartialRefundAllocation(
      {
        shippingMinor: 0,
        taxMinor: 0,
        totalMinor: 17_000,
        lines: [
          {
            key: "product:_",
            productId: "423e4567-e89b-42d3-a456-426614174000",
            productSlug: "product",
            productName: "Product",
            variantSku: null,
            variantName: null,
            quantity: 2,
            unitPriceMinor: 10_000,
            lineTotalMinor: 20_000,
          },
        ],
        promotions: {
          contract: "np.shop-promotion-snapshot.v1",
          couponCodes: ["WELCOME"],
          rejectedCouponCodes: [],
          applied: [
            {
              id: "523e4567-e89b-42d3-a456-426614174000",
              name: "Welcome",
              code: "WELCOME",
              kind: "fixed",
              target: "order",
              discountMinor: 3_000,
              lineDiscounts: [{ lineKey: "product:_", discountMinor: 3_000 }],
            },
          ],
          discountMinor: 3_000,
        },
      },
      { lines: [{ lineKey: "product:_", quantity: 1 }] },
      { shippingMinor: 0, taxMinor: 0 },
    );
    expect(allocation).toEqual({
      lines: [{ lineKey: "product:_", quantity: 1, amountMinor: 8_500 }],
      itemAmountMinor: 8_500,
      shippingMinor: 0,
      taxMinor: 0,
    });
  });

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
