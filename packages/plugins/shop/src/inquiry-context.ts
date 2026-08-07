import { findDocuments } from "@nexpress/core/collections";

import type { ShopProductDocument } from "./runtime.js";
import type { NpShopProductInquiryContextSource } from "./types.js";

const SAFE_SEGMENT = /^[a-z][a-z0-9-]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface NpShopProductInquiryContextSourceOptions {
  basePath?: string;
  productsCollection?: string;
}

export function createShopProductInquiryContextSource(
  options: NpShopProductInquiryContextSourceOptions = {},
): NpShopProductInquiryContextSource {
  const basePath = options.basePath ?? "/shop";
  const productsCollection = options.productsCollection ?? "shop-products";
  if (
    basePath === "/" ||
    basePath.endsWith("/") ||
    !basePath.startsWith("/") ||
    !basePath
      .slice(1)
      .split("/")
      .every((segment) => SAFE_SEGMENT.test(segment)) ||
    !SAFE_SEGMENT.test(productsCollection)
  ) {
    throw new Error("Shop product inquiry context source options are invalid.");
  }
  return {
    type: "shop-product",
    async resolve(ids) {
      const unique = [...new Set(ids)];
      if (unique.length > 100 || unique.some((id) => !UUID.test(id))) {
        throw new Error("Shop product inquiry context source accepts up to 100 UUIDs.");
      }
      if (unique.length === 0) return [];
      const result = await findDocuments<ShopProductDocument>(productsCollection, {
        where: { id: unique, status: "published" },
        sort: "name",
        page: 1,
        limit: 100,
      });
      return result.docs.map((product) => ({
        id: product.id,
        label: product.name.trim(),
        href: `${basePath}/products/${product.slug}`,
      }));
    },
  };
}
