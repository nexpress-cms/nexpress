import { isNpRichTextContent } from "@nexpress/core/fields";
import { renderRichText } from "@nexpress/editor/server";
import { buildPageMetadata } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import {
  findShopProduct,
  getShopMessages,
  listShopCategories,
  resolveShopSkin,
  type NpShopRuntime,
} from "../runtime.js";

export function createShopProductMetadata(runtime: NpShopRuntime) {
  return async function shopProductMetadata({ params }: NpRouteRenderProps) {
    const product = await findShopProduct(runtime, params.productSlug ?? "");
    return buildPageMetadata({
      title: product?.name ?? "Product",
      description: product?.summary ?? null,
      path: product ? `${runtime.basePath}/products/${product.slug}` : runtime.basePath,
      ogType: "website",
      ogImage: product?.imageUrl ?? null,
    });
  };
}

export function createShopProductRoute(runtime: NpShopRuntime) {
  return async function ShopProductRoute({ params }: NpRouteRenderProps) {
    const product = await findShopProduct(runtime, params.productSlug ?? "");
    if (!product) notFound();
    const [allCategories, messages] = await Promise.all([
      listShopCategories(runtime),
      getShopMessages(),
    ]);
    const categories = allCategories.filter((category) =>
      product.categoryIds.includes(category.id),
    );
    const description = isNpRichTextContent(product.description)
      ? renderRichText(product.description)
      : null;
    return resolveShopSkin(runtime, product.skinId).renderProduct({
      basePath: runtime.basePath,
      product,
      categories,
      description,
      messages,
    });
  };
}
