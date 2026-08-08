import { describe, expect, it } from "vitest";

import { npResolveShopRestockTarget } from "./restock-alert-service.js";
import type { ShopProductDocument } from "./runtime.js";

function product(overrides: Partial<ShopProductDocument> = {}): ShopProductDocument {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "mug",
    name: "Mug",
    status: "published",
    trackInventory: true,
    stockQuantity: 0,
    variants: [],
    ...overrides,
  } as ShopProductDocument;
}

describe("Shop restock alert target resolution", () => {
  it("resolves one root target only for tracked products without enabled variants", () => {
    expect(npResolveShopRestockTarget(product(), null)).toEqual({
      available: false,
      label: "Mug",
    });
    expect(npResolveShopRestockTarget(product({ stockQuantity: 4 }), null)?.available).toBe(true);
    expect(npResolveShopRestockTarget(product({ trackInventory: false }), null)).toBeNull();
    expect(npResolveShopRestockTarget(product(), "MUG-BLUE")).toBeNull();
  });

  it("requires an exact enabled SKU and evaluates variant stock independently", () => {
    const withVariants = product({
      stockQuantity: 99,
      variants: [
        {
          name: "Blue",
          sku: "MUG-BLUE",
          optionSummary: "Blue / 300 ml",
          priceMinor: null,
          stockQuantity: 0,
          enabled: true,
        },
        {
          name: "Red",
          sku: "MUG-RED",
          optionSummary: null,
          priceMinor: null,
          stockQuantity: 3,
          enabled: true,
        },
        {
          name: "Retired",
          sku: "MUG-OLD",
          optionSummary: null,
          priceMinor: null,
          stockQuantity: 5,
          enabled: false,
        },
      ],
    });

    expect(npResolveShopRestockTarget(withVariants, "MUG-BLUE")).toEqual({
      available: false,
      label: "Blue / 300 ml",
    });
    expect(npResolveShopRestockTarget(withVariants, "MUG-RED")?.available).toBe(true);
    expect(npResolveShopRestockTarget(withVariants, "MUG-OLD")).toBeNull();
    expect(npResolveShopRestockTarget(withVariants, null)).toBeNull();
  });
});
