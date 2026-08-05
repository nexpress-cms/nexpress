import { describe, expect, it } from "vitest";

import {
  NP_SHOP_CART_STORAGE_CONTRACT,
  npAnalyzeShopCartStorageValue,
  npRequireShopCartAddInput,
  npRequireShopCartDeleteInput,
  npRequireShopCartQuote,
  npRequireShopCartSetQuantityInput,
  npRequireShopCartStorageValue,
  npShopCartLineKey,
} from "./cart-contract.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const promotions = {
  contract: "np.shop-promotion-snapshot.v1",
  couponCodes: [],
  rejectedCouponCodes: [],
  applied: [],
  discountMinor: 0,
} as const;

function storedCart() {
  return {
    contract: NP_SHOP_CART_STORAGE_CONTRACT,
    revision: 1,
    lines: [
      {
        key: `${productId}:CUP-S`,
        productId,
        productSlug: "everyday-cup",
        productName: "Everyday cup",
        variantSku: "CUP-S",
        variantName: "Small",
        quantity: 2,
        currency: "KRW",
        unitPriceMinor: 25_000,
      },
    ],
    couponCodes: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:01.000Z",
  };
}

describe("shop cart contract", () => {
  it("accepts one exact persisted v1 envelope", () => {
    expect(npRequireShopCartStorageValue(storedCart())).toEqual(storedCart());
    expect(npShopCartLineKey(productId, " cup-s ")).toBe(`${productId}:CUP-S`);
  });

  it("rejects unknown fields, duplicate lines, non-canonical keys, and unsafe quantities", () => {
    const value = storedCart();
    const invalid = {
      ...value,
      extra: true,
      lines: [
        value.lines[0],
        {
          ...value.lines[0],
          key: `${productId}:wrong`,
          quantity: 100,
        },
      ],
    };
    expect(npAnalyzeShopCartStorageValue(invalid)).toEqual(
      expect.arrayContaining([
        "cart.extra is not supported.",
        "cart.lines[1].quantity is invalid.",
        "cart.lines[1].key does not match its product option.",
      ]),
    );
  });

  it("normalizes exact mutation inputs and rejects stale-shaped payloads", () => {
    expect(
      npRequireShopCartAddInput({
        productId,
        variantSku: "cup-s",
        quantity: 2,
        expectedRevision: 0,
      }),
    ).toEqual({ productId, variantSku: "CUP-S", quantity: 2, expectedRevision: 0 });
    expect(
      npRequireShopCartSetQuantityInput({
        lineKey: `${productId}:CUP-S`,
        quantity: 3,
        expectedRevision: 1,
      }),
    ).toMatchObject({ quantity: 3, expectedRevision: 1 });
    expect(
      npRequireShopCartDeleteInput({
        lineKey: null,
        expectedRevision: 2,
      }),
    ).toEqual({ lineKey: null, expectedRevision: 2 });
    expect(() =>
      npRequireShopCartAddInput({
        productId,
        variantSku: null,
        quantity: 1,
        expectedRevision: 0,
        priceMinor: 1,
      }),
    ).toThrow(/Invalid cart add request/u);
  });

  it("validates the client-safe quote envelope before rendering", () => {
    const line = {
      ...storedCart().lines[0],
      lineTotalMinor: 50_000,
      imageUrl: null,
      available: true,
      stockQuantity: 4,
      issues: [],
    };
    const quote = {
      contract: "np.shop-cart-quote.v1",
      revision: 1,
      lines: [line],
      promotions,
      totals: [{ currency: "KRW", subtotalMinor: 50_000, discountMinor: 0, totalMinor: 50_000 }],
      totalUnits: 2,
      ready: true,
      issues: [],
      fingerprint: "a".repeat(64),
      updatedAt: "2026-07-29T00:00:01.000Z",
    };
    expect(npRequireShopCartQuote(quote)).toEqual(quote);
    expect(() => npRequireShopCartQuote({ ...quote, fingerprint: "unsafe" })).toThrow(
      /Invalid shop cart quote/u,
    );
    expect(() =>
      npRequireShopCartQuote({
        ...quote,
        totalUnits: 3,
        totals: [{ currency: "KRW", subtotalMinor: 1, discountMinor: 0, totalMinor: 1 }],
      }),
    ).toThrow(/Invalid shop cart quote/u);
  });
});
