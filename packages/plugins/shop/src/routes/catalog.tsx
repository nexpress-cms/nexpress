import { findDocuments } from "@nexpress/core/collections";
import { buildPageMetadata } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import {
  getShopMessages,
  listShopCategories,
  normalizeShopProductSummary,
  npShopCatalogLimits,
  parseShopCatalogQuery,
  resolveShopSkin,
  shopCatalogSort,
  type NpShopRuntime,
  type ShopProductDocument,
} from "../runtime.js";
import { npAttachShopProductReviewAggregates } from "../review-service.js";

export function createShopCatalogMetadata(runtime: NpShopRuntime) {
  return async function shopCatalogMetadata() {
    const messages = await getShopMessages();
    return buildPageMetadata({
      title: messages.catalog,
      description: "Browse the published product catalog.",
      path: runtime.basePath,
    });
  };
}

export function createShopCatalogRoute(runtime: NpShopRuntime) {
  return async function ShopCatalogRoute({ searchParams }: NpRouteRenderProps) {
    const query = parseShopCatalogQuery(searchParams);
    if (!query) notFound();
    const where: Record<string, unknown> = { status: "published" };
    if (query.inStockOnly) where.available = true;
    const [result, categories, messages] = await Promise.all([
      findDocuments<ShopProductDocument>(runtime.collections.products, {
        where,
        ...(query.search ? { search: query.search } : {}),
        sort: shopCatalogSort(query.sort),
        page: query.page,
        limit: npShopCatalogLimits.pageSize,
      }),
      listShopCategories(runtime),
      getShopMessages(),
    ]);
    if (query.page > Math.max(1, result.totalPages)) notFound();
    const products = await npAttachShopProductReviewAggregates(
      runtime,
      await Promise.all(result.docs.map(normalizeShopProductSummary)),
    );
    return resolveShopSkin(runtime).renderCatalog({
      basePath: runtime.basePath,
      products,
      categories,
      query,
      totalPages: result.totalPages,
      totalProducts: result.totalDocs,
      messages,
    });
  };
}
