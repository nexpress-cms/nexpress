import { describe, expect, it } from "vitest";

import { npResolveShopPriceAlertTarget } from "./price-alert-service.js";
import type { ShopProductDocument } from "./runtime.js";

function product(overrides: Partial<ShopProductDocument> = {}): ShopProductDocument {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "mug",
    name: "Mug",
    status: "published",
    currency: "KRW",
    priceMinor: 20_000,
    variants: [],
    ...overrides,
  };
}

describe("Shop price alert target resolution", () => {
  it("uses the root catalog price independently of variants", () => {
    expect(npResolveShopPriceAlertTarget(product(), null)).toEqual({
      currency: "KRW",
      priceMinor: 20_000,
      label: "Mug",
    });
  });

  it("uses an exact enabled variant override or the root fallback", () => {
    const withVariants = product({
      variants: [
        {
          name: "Blue",
          sku: "MUG-BLUE",
          optionSummary: "Blue / 300 ml",
          priceMinor: 23_000,
          stockQuantity: 0,
          enabled: true,
        },
        {
          name: "Red",
          sku: "MUG-RED",
          optionSummary: null,
          priceMinor: null,
          stockQuantity: 0,
          enabled: true,
        },
      ],
    });
    expect(npResolveShopPriceAlertTarget(withVariants, "MUG-BLUE")).toEqual({
      currency: "KRW",
      priceMinor: 23_000,
      label: "Blue / 300 ml",
    });
    expect(npResolveShopPriceAlertTarget(withVariants, "MUG-RED")?.priceMinor).toBe(20_000);
    expect(npResolveShopPriceAlertTarget(withVariants, "MISSING")).toBeNull();
  });
});
