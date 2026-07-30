import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CHECKOUT_INTENT_CONTRACT,
  npAnalyzeShopCheckoutIntent,
  npRequireShopCheckoutCancelInput,
  npRequireShopCheckoutCreateInput,
  npRequireShopCheckoutIntent,
  npRequireShopCheckoutReadQuery,
} from "./checkout-contract.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const intentId = "223e4567-e89b-42d3-a456-426614174000";

function intent() {
  return {
    contract: NP_SHOP_CHECKOUT_INTENT_CONTRACT,
    id: intentId,
    status: "open",
    cartRevision: 2,
    cartFingerprint: "a".repeat(64),
    currency: "KRW",
    subtotalMinor: 50_000,
    totalUnits: 2,
    lines: [
      {
        key: `${productId}:_`,
        productId,
        productSlug: "everyday-cup",
        productName: "Everyday cup",
        variantSku: null,
        variantName: null,
        quantity: 2,
        unitPriceMinor: 25_000,
        lineTotalMinor: 50_000,
      },
    ],
    createdAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2026-07-30T00:15:00.000Z",
    cancelledAt: null,
  };
}

describe("shop checkout intent contract", () => {
  it("accepts one exact bounded intent snapshot", () => {
    expect(npRequireShopCheckoutIntent(intent())).toEqual(intent());
  });

  it("rejects unknown fields and inconsistent totals or lifecycle state", () => {
    expect(
      npAnalyzeShopCheckoutIntent({
        ...intent(),
        extra: true,
        subtotalMinor: 1,
        status: "cancelled",
      }),
    ).toEqual(
      expect.arrayContaining([
        "intent.extra is not supported.",
        "intent.cancelledAt is required when status is cancelled.",
        "intent.subtotalMinor does not match its lines.",
      ]),
    );
  });

  it("requires exact idempotent create and cancel inputs", () => {
    expect(
      npRequireShopCheckoutCreateInput({
        idempotencyKey: intentId,
        expectedRevision: 2,
        expectedFingerprint: "b".repeat(64),
      }),
    ).toEqual({
      idempotencyKey: intentId,
      expectedRevision: 2,
      expectedFingerprint: "b".repeat(64),
    });
    expect(npRequireShopCheckoutCancelInput({ intentId })).toEqual({ intentId });
    expect(npRequireShopCheckoutReadQuery({ id: intentId })).toBe(intentId);
    expect(() => npRequireShopCheckoutReadQuery({ id: intentId, owner: "other" })).toThrow(
      /Invalid checkout read query/u,
    );
    expect(() =>
      npRequireShopCheckoutCreateInput({
        idempotencyKey: intentId,
        expectedRevision: 2,
        expectedFingerprint: "b".repeat(64),
        amount: 1,
      }),
    ).toThrow(/Invalid checkout create request/u);
  });
});
