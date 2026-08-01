import { describe, expect, it } from "vitest";

import {
  NP_SHOP_REFUND_RESULT_CONTRACT,
  NP_SHOP_REFUND_STORAGE_CONTRACT,
  npAnalyzeStoredShopRefund,
  npProjectShopRefund,
  npRequireShopPaymentRefundResult,
  npRequireShopRefundActionInput,
  npRequireStoredShopRefund,
  type NpShopStoredRefund,
} from "./refund-contract.js";

const refund: NpShopStoredRefund = {
  contract: NP_SHOP_REFUND_STORAGE_CONTRACT,
  id: "323e4567-e89b-42d3-a456-426614174000",
  orderId: "123e4567-e89b-42d3-a456-426614174000",
  providerId: "test-pay",
  status: "refunded",
  orderRevision: 3,
  paymentReference: "payment_123",
  refundReference: "refund_123",
  currency: "KRW",
  amountMinor: 25_000,
  reason: "Customer requested cancellation",
  inventoryOutcome: "restocked",
  fulfillmentOutcome: "cancelled",
  providerErrorCode: null,
  requestedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:05:00.000Z",
  refundedAt: "2026-08-01T00:04:59.000Z",
  purgeAt: "2027-07-31T00:00:00.000Z",
};

describe("Shop refund contract", () => {
  it("accepts one exact completed full-refund record and bounded public projection", () => {
    expect(npAnalyzeStoredShopRefund(refund)).toEqual([]);
    expect(npRequireStoredShopRefund(refund)).toBe(refund);
    expect(npProjectShopRefund(refund)).toEqual({
      contract: "np.shop-refund.v1",
      id: refund.id,
      status: "refunded",
      currency: "KRW",
      amountMinor: 25_000,
      inventoryOutcome: "restocked",
      fulfillmentOutcome: "cancelled",
      requestedAt: refund.requestedAt,
      refundedAt: refund.refundedAt,
    });
  });

  it("rejects partial or internally inconsistent terminal state", () => {
    expect(
      npAnalyzeStoredShopRefund({
        ...refund,
        amountMinor: 10_000,
        inventoryOutcome: "pending",
        unexpected: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        "refund.unexpected is not supported.",
        "refunded records require terminal provider and compensation metadata.",
      ]),
    );
  });

  it("persists provider success before local compensation is reconciled", () => {
    expect(
      npAnalyzeStoredShopRefund({
        ...refund,
        status: "provider-confirmed",
        orderRevision: 2,
        inventoryOutcome: "pending",
        fulfillmentOutcome: "pending",
      }),
    ).toEqual([]);
  });

  it("validates provider results and generic Admin row payloads exactly", () => {
    expect(
      npRequireShopPaymentRefundResult({
        contract: NP_SHOP_REFUND_RESULT_CONTRACT,
        refundId: refund.id,
        orderId: refund.orderId,
        paymentReference: refund.paymentReference,
        refundReference: refund.refundReference,
        currency: refund.currency,
        amountMinor: refund.amountMinor,
        refundedAt: refund.refundedAt,
      }),
    ).toMatchObject({ refundId: refund.id, amountMinor: 25_000 });
    expect(
      npRequireShopRefundActionInput({
        row: { id: refund.orderId, revision: 2 },
        values: { reason: "Customer requested cancellation" },
      }),
    ).toEqual({
      orderId: refund.orderId,
      expectedRevision: 2,
      reason: "Customer requested cancellation",
    });
    expect(() =>
      npRequireShopRefundActionInput({
        row: { id: refund.orderId, revision: 2 },
        values: { reason: "Customer requested cancellation", cancelAmount: 1 },
      }),
    ).toThrow(/Invalid Shop refund action/u);
  });
});
