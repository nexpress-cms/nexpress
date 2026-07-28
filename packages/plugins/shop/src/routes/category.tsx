import { findDocuments } from "@nexpress/core/collections";
import { buildPageMetadata } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import {
  findShopCategory,
  getShopMessages,
  normalizeShopProductSummary,
  npShopCatalogLimits,
  parseShopCatalogQuery,
  resolveShopSkin,
  shopCatalogSort,
  type NpShopRuntime,
  type ShopProductDocument,
} from "../runtime.js";

export function createShopCategoryMetadata(runtime: NpShopRuntime) {
  return async function shopCategoryMetadata({ params }: NpRouteRenderProps) {
    const category = await findShopCategory(runtime, params.categorySlug ?? "");
    return buildPageMetadata({
      title: category?.name ?? "Shop category",
      description: category?.description ?? null,
      path: category ? `${runtime.basePath}/categories/${category.slug}` : runtime.basePath,
    });
  };
}

export function createShopCategoryRoute(runtime: NpShopRuntime) {
  return async function ShopCategoryRoute({ params, searchParams }: NpRouteRenderProps) {
    const [category, messages] = await Promise.all([
      findShopCategory(runtime, params.categorySlug ?? ""),
      getShopMessages(),
    ]);
    const query = parseShopCatalogQuery(searchParams);
    if (!category || !query) notFound();
    const where: Record<string, unknown> = {
      status: "published",
      categories: category.id,
    };
    if (query.inStockOnly) where.available = true;
    const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
      where,
      ...(query.search ? { search: query.search } : {}),
      sort: shopCatalogSort(query.sort),
      page: query.page,
      limit: npShopCatalogLimits.pageSize,
    });
    if (query.page > Math.max(1, result.totalPages)) notFound();
    const products = await Promise.all(result.docs.map(normalizeShopProductSummary));
    return resolveShopSkin(runtime).renderCategory({
      basePath: runtime.basePath,
      category,
      products,
      query,
      totalPages: result.totalPages,
      totalProducts: result.totalDocs,
      messages,
    });
  };
}
