import { describe, expect, it } from "vitest";

import { npShopWishlistLimits, parseShopWishlistPage } from "./wishlist-service.js";

describe("shop wishlist query contract", () => {
  it("accepts only one bounded positive decimal page", () => {
    expect(parseShopWishlistPage(undefined)).toBe(1);
    expect(parseShopWishlistPage("1")).toBe(1);
    expect(parseShopWishlistPage(npShopWishlistLimits.maximumPage.toString())).toBe(
      npShopWishlistLimits.maximumPage,
    );
    for (const value of ["0", "01", "-1", "1.5", "NaN", "10001"] as const) {
      expect(parseShopWishlistPage(value)).toBeNull();
    }
    expect(parseShopWishlistPage(["1", "2"])).toBeNull();
  });

  it("keeps card and page reads inside the shared follow batch bound", () => {
    expect(npShopWishlistLimits.pageSize).toBe(24);
    expect(npShopWishlistLimits.maximumCardTargets).toBe(200);
  });
});
