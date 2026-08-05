import { describe, expect, it } from "vitest";

import {
  npAnalyzeShopPromotionSnapshot,
  npEvaluateShopPromotions,
  npNormalizeShopCouponCodes,
  type NpShopPromotionDefinition,
} from "./promotion-contract.js";

const productA = "123e4567-e89b-42d3-a456-426614174000";
const productB = "223e4567-e89b-42d3-a456-426614174000";
const category = "323e4567-e89b-42d3-a456-426614174000";

function promotion(overrides: Partial<NpShopPromotionDefinition> = {}): NpShopPromotionDefinition {
  return {
    id: "423e4567-e89b-42d3-a456-426614174000",
    name: "Launch offer",
    code: "WELCOME",
    automatic: false,
    kind: "fixed",
    currency: "KRW",
    value: 3_000,
    maximumDiscountMinor: null,
    minimumSubtotalMinor: 10_000,
    target: "order",
    productIds: [],
    categoryIds: [],
    startsAt: null,
    endsAt: null,
    priority: 10,
    stackable: false,
    totalUsageLimit: 0,
    perOwnerUsageLimit: 0,
    ...overrides,
  };
}

const lines = [
  { key: `${productA}:_`, productId: productA, categoryIds: [category], lineTotalMinor: 20_000 },
  { key: `${productB}:_`, productId: productB, categoryIds: [], lineTotalMinor: 10_000 },
];

describe("Shop promotion contract", () => {
  it("normalizes bounded coupon codes", () => {
    expect(npNormalizeShopCouponCodes([" welcome ", "SAVE-10", "WELCOME"])).toEqual([
      "SAVE-10",
      "WELCOME",
    ]);
    expect(() => npNormalizeShopCouponCodes(["not valid!"])).toThrow(/Coupon code/u);
  });

  it("allocates fixed discounts deterministically across eligible product lines", () => {
    const snapshot = npEvaluateShopPromotions({
      definitions: [promotion({ target: "products", productIds: [productA] })],
      couponCodes: ["WELCOME"],
      currency: "KRW",
      subtotalMinor: 30_000,
      lines,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(snapshot).toMatchObject({ discountMinor: 3_000, rejectedCouponCodes: [] });
    expect(snapshot.applied[0]?.lineDiscounts).toEqual([
      { lineKey: `${productA}:_`, discountMinor: 3_000 },
    ]);
    expect(npAnalyzeShopPromotionSnapshot(snapshot)).toEqual([]);
  });

  it("chooses the best exclusive offer over a stack and honors percentage caps", () => {
    const snapshot = npEvaluateShopPromotions({
      definitions: [
        promotion({
          id: "523e4567-e89b-42d3-a456-426614174000",
          code: null,
          automatic: true,
          kind: "percentage",
          value: 2_000,
          maximumDiscountMinor: 4_000,
          target: "categories",
          categoryIds: [category],
          stackable: true,
        }),
        promotion({ value: 5_000 }),
      ],
      couponCodes: ["WELCOME", "MISSING"],
      currency: "KRW",
      subtotalMinor: 30_000,
      lines,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(snapshot.discountMinor).toBe(5_000);
    expect(snapshot.applied.map((entry) => entry.code)).toEqual(["WELCOME"]);
    expect(snapshot.rejectedCouponCodes).toEqual(["MISSING"]);
  });

  it("fails closed on unavailable, expired, or below-threshold promotions", () => {
    const definition = promotion({
      endsAt: "2026-08-04T00:00:00.000Z",
      minimumSubtotalMinor: 40_000,
    });
    const snapshot = npEvaluateShopPromotions({
      definitions: [definition],
      couponCodes: ["WELCOME"],
      currency: "KRW",
      subtotalMinor: 30_000,
      lines,
      now: new Date("2026-08-05T00:00:00.000Z"),
      unavailablePromotionIds: new Set([definition.id]),
    });
    expect(snapshot).toMatchObject({ discountMinor: 0, rejectedCouponCodes: ["WELCOME"] });
  });

  it("keeps proportional arithmetic exact above Number multiplication safety", () => {
    const snapshot = npEvaluateShopPromotions({
      definitions: [
        promotion({
          value: 2_147_483_647,
          minimumSubtotalMinor: 0,
          target: "order",
        }),
      ],
      couponCodes: ["WELCOME"],
      currency: "KRW",
      subtotalMinor: 4_294_967_294,
      lines: [
        {
          key: `${productA}:_`,
          productId: productA,
          categoryIds: [],
          lineTotalMinor: 2_147_483_647,
        },
        {
          key: `${productB}:_`,
          productId: productB,
          categoryIds: [],
          lineTotalMinor: 2_147_483_647,
        },
      ],
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(snapshot.applied[0]?.lineDiscounts).toEqual([
      { lineKey: `${productA}:_`, discountMinor: 1_073_741_824 },
      { lineKey: `${productB}:_`, discountMinor: 1_073_741_823 },
    ]);
    expect(snapshot.discountMinor).toBe(2_147_483_647);
  });
});
