import { describe, expect, it } from "vitest";

import {
  NP_SHOP_PARTIAL_REFUND_RESULT_CONTRACT,
  NP_SHOP_PARTIAL_REFUND_STORAGE_CONTRACT,
  NP_SHOP_RETURN_POSTAGE_SETTLEMENT_CONTRACT,
  npAnalyzeStoredShopPartialRefund,
  npProjectShopPartialRefund,
  npRequireShopPartialRefund,
  npRequireShopPartialRefundActionInput,
  npRequireShopPaymentPartialRefundResult,
  npRequireShopReturnSettlementRefundActionInput,
  npRequireStoredShopPartialRefund,
  type NpShopStoredPartialRefund,
} from "./partial-refund-contract.js";
import { npDeriveShopPartialRefundAllocation } from "./partial-refund-service.js";

const refundId = "123e4567-e89b-42d3-a456-426614174000";
const orderId = "223e4567-e89b-42d3-a456-426614174000";
const returnId = "323e4567-e89b-42d3-a456-426614174000";
const quoteId = "423e4567-e89b-42d3-a456-426614174000";

const postageMethod = {
  contract: "np.shop-return-postage-method.v1" as const,
  providerId: "test-carrier",
  quoteId,
  methodId: "dropoff-standard",
  label: "Standard return",
  currency: "KRW" as const,
  amountMinor: 4_000,
  estimatedTransit: { minimumDays: 1, maximumDays: 3 },
  quotedAt: "2026-08-04T23:00:00.000Z",
  quoteExpiresAt: "2026-08-05T00:00:00.000Z",
};

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

  it("freezes exact merchant/customer return-postage settlement into the net refund", () => {
    const customer = stored({
      amountMinor: 7_000,
      postageSettlement: {
        contract: NP_SHOP_RETURN_POSTAGE_SETTLEMENT_CONTRACT,
        responsibility: "customer",
        method: postageMethod,
        deductionMinor: 4_000,
        designatedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    expect(npRequireStoredShopPartialRefund(customer).postageSettlement).toMatchObject({
      responsibility: "customer",
      deductionMinor: 4_000,
      method: { quoteId, amountMinor: 4_000 },
    });
    expect(npRequireShopPartialRefund(npProjectShopPartialRefund(customer))).toMatchObject({
      amountMinor: 7_000,
      postageSettlement: { responsibility: "customer", deductionMinor: 4_000 },
    });
    expect(
      npRequireStoredShopPartialRefund({
        ...customer,
        amountMinor: 11_000,
        postageSettlement: {
          ...customer.postageSettlement!,
          responsibility: "merchant",
          deductionMinor: 0,
        },
      }).amountMinor,
    ).toBe(11_000);
  });

  it("rejects settlement deduction, currency, and method drift", () => {
    const settlement = {
      contract: NP_SHOP_RETURN_POSTAGE_SETTLEMENT_CONTRACT,
      responsibility: "customer" as const,
      method: postageMethod,
      deductionMinor: 4_000,
      designatedAt: "2026-08-05T00:00:00.000Z",
    };
    expect(
      npAnalyzeStoredShopPartialRefund(
        stored({ amountMinor: 7_001, postageSettlement: { ...settlement, deductionMinor: 3_999 } }),
      ).join(" "),
    ).toMatch(/deduction|net allocation/u);
    expect(
      npAnalyzeStoredShopPartialRefund(
        stored({
          amountMinor: 7_000,
          postageSettlement: {
            ...settlement,
            method: { ...postageMethod, currency: "USD" },
          },
        }),
      ).join(" "),
    ).toMatch(/currency/u);
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
    expect(
      npRequireShopReturnSettlementRefundActionInput({
        row: { id: orderId, orderRevision: 2, returnId, returnRevision: 3 },
        values: {
          responsibility: "customer",
          shippingMinor: "500",
          taxMinor: "0",
          reason: "Received return",
        },
      }),
    ).toMatchObject({ responsibility: "customer", shippingMinor: 500, taxMinor: 0 });
    try {
      npRequireShopReturnSettlementRefundActionInput({
        row: { id: orderId, orderRevision: 2, returnId, returnRevision: 3 },
        values: {
          responsibility: "platform",
          shippingMinor: "500",
          taxMinor: "0",
          reason: "Received return",
        },
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([expect.stringMatching(/responsibility/u)]),
      });
    }
  });
});
