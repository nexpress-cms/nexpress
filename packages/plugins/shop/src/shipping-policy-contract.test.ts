import { describe, expect, it } from "vitest";

import {
  npEvaluateShopShippingPolicies,
  npNormalizeShopShippingPolicy,
  type NpShopShippingPolicyDefinition,
} from "./shipping-policy-contract.js";

const baseId = "123e4567-e89b-42d3-a456-426614174000";
const surchargeId = "223e4567-e89b-42d3-a456-426614174000";
const productId = "323e4567-e89b-42d3-a456-426614174000";
const categoryId = "423e4567-e89b-42d3-a456-426614174000";

function definition(
  overrides: Partial<NpShopShippingPolicyDefinition> = {},
): NpShopShippingPolicyDefinition {
  return {
    id: baseId,
    name: "Standard delivery",
    methodCode: "standard",
    kind: "base",
    label: "Standard delivery",
    currency: "KRW",
    amountMinor: 3_000,
    freeThresholdMinor: 50_000,
    thresholdBasis: "discounted-subtotal",
    minimumDays: 1,
    maximumDays: 3,
    destinationScope: "country",
    countryCode: "KR",
    postalPrefixes: [],
    administrativeAreas: [],
    cartScope: "all",
    productIds: [],
    categoryIds: [],
    startsAt: null,
    endsAt: null,
    priority: 0,
    ...overrides,
  };
}

const destination = {
  recipientName: "홍길동",
  phone: "010-1234-5678",
  countryCode: "KR",
  postalCode: "63000",
  addressLine1: "제주특별자치도 제주시",
  addressLine2: null,
  locality: "제주시",
  administrativeArea: "제주특별자치도",
};

const lines = [
  {
    key: `${productId}:_`,
    productId,
    productSlug: "cup",
    productName: "Cup",
    variantSku: null,
    variantName: null,
    quantity: 2,
    unitPriceMinor: 25_000,
    lineTotalMinor: 50_000,
    categoryIds: [categoryId],
  },
];

describe("Shop shipping policies", () => {
  it("uses discounted subtotal for free-shipping and keeps matched surcharges", () => {
    const result = npEvaluateShopShippingPolicies({
      definitions: [
        definition(),
        definition({
          id: surchargeId,
          name: "Jeju surcharge",
          kind: "surcharge",
          label: "Jeju surcharge",
          amountMinor: 3_000,
          freeThresholdMinor: null,
          minimumDays: null,
          maximumDays: null,
          destinationScope: "postal-prefixes",
          postalPrefixes: ["63"],
          priority: 10,
        }),
      ],
      currency: "KRW",
      grossSubtotalMinor: 50_000,
      discountMinor: 5_000,
      lines,
      destination,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(result).toEqual({
      methods: [
        {
          id: "standard",
          label: "Standard delivery",
          amountMinor: 6_000,
          estimatedDelivery: { minimumDays: 1, maximumDays: 3 },
        },
      ],
      appliedPolicyIds: [baseId, surchargeId],
    });
  });

  it("can waive the base amount on gross subtotal without waiving a surcharge", () => {
    const result = npEvaluateShopShippingPolicies({
      definitions: [
        definition({ thresholdBasis: "gross-subtotal" }),
        definition({
          id: surchargeId,
          kind: "surcharge",
          freeThresholdMinor: null,
          minimumDays: null,
          maximumDays: null,
          amountMinor: 3_000,
        }),
      ],
      currency: "KRW",
      grossSubtotalMinor: 50_000,
      discountMinor: 5_000,
      lines,
      destination,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(result.methods[0]?.amountMinor).toBe(3_000);
  });

  it("applies product/category filters and highest-priority matching base", () => {
    const result = npEvaluateShopShippingPolicies({
      definitions: [
        definition(),
        definition({
          id: "523e4567-e89b-42d3-a456-426614174000",
          label: "Oversize delivery",
          amountMinor: 10_000,
          cartScope: "products",
          productIds: [productId],
          priority: 20,
        }),
        definition({
          id: surchargeId,
          kind: "surcharge",
          freeThresholdMinor: null,
          minimumDays: null,
          maximumDays: null,
          amountMinor: 2_000,
          cartScope: "categories",
          categoryIds: [categoryId],
        }),
      ],
      currency: "KRW",
      grossSubtotalMinor: 20_000,
      discountMinor: 0,
      lines,
      destination,
      now: new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(result.methods[0]).toMatchObject({ label: "Oversize delivery", amountMinor: 12_000 });
  });

  it("normalizes Korean destination rows and rejects surcharge-only base fields", () => {
    expect(
      npNormalizeShopShippingPolicy({
        ...definition(),
        postalPrefixes: [{ prefix: "63-0" }],
        destinationScope: "postal-prefixes",
        countryCode: "kr",
      }),
    ).toMatchObject({ countryCode: "KR", postalPrefixes: ["630"] });
    expect(() =>
      npNormalizeShopShippingPolicy({
        ...definition({ kind: "surcharge" }),
        freeThresholdMinor: 50_000,
      }),
    ).toThrow(/cannot define free thresholds/u);
  });
});
