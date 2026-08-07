import { findDocuments } from "@nexpress/core/collections";
import { countFollows, listFollowing, listFollowingTargetIds } from "@nexpress/core/community";
import { npCommunityContractLimits } from "@nexpress/core/community-contract";

import { npAttachShopProductReviewAggregates } from "./review-service.js";
import {
  normalizeShopProductSummary,
  type NpShopRuntime,
  type ShopProductDocument,
} from "./runtime.js";
import type { NpShopWishlistPage } from "./types.js";

export const npShopWishlistLimits = Object.freeze({
  pageSize: 24,
  maximumPage: 10_000,
  maximumCardTargets: npCommunityContractLimits.pageRows,
});

export function parseShopWishlistPage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (Array.isArray(value) || !/^[1-9][0-9]*$/u.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= npShopWishlistLimits.maximumPage ? page : null;
}

export async function npListShopWishlistSavedProductIds(
  runtime: NpShopRuntime,
  memberId: string,
  productIds: readonly string[],
): Promise<string[]> {
  if (productIds.length > npShopWishlistLimits.maximumCardTargets) {
    throw new Error(
      `Shop wishlist card windows accept at most ${npShopWishlistLimits.maximumCardTargets.toString()} products.`,
    );
  }
  return listFollowingTargetIds(memberId, runtime.collections.products, productIds);
}

export async function npGetShopWishlistPage(
  runtime: NpShopRuntime,
  memberId: string,
  page: number,
): Promise<NpShopWishlistPage> {
  if (!Number.isSafeInteger(page) || page < 1 || page > npShopWishlistLimits.maximumPage) {
    throw new Error("Shop wishlist page is invalid.");
  }
  const offset = (page - 1) * npShopWishlistLimits.pageSize;
  const follows = await listFollowing(memberId, {
    targetType: runtime.collections.products,
    limit: npShopWishlistLimits.pageSize + 1,
    offset,
  });
  const window = follows.slice(0, npShopWishlistLimits.pageSize);
  const ids = window.map((row) => row.targetId);
  if (ids.length === 0) {
    return { products: [], page, hasPrevious: page > 1, hasNext: false };
  }
  const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
    where: { id: ids, status: "published" },
    page: 1,
    limit: npShopWishlistLimits.pageSize,
  });
  const normalized = await npAttachShopProductReviewAggregates(
    runtime,
    await Promise.all(result.docs.map(normalizeShopProductSummary)),
  );
  const productsById = new Map(normalized.map((product) => [product.id, product]));
  return {
    products: ids.flatMap((id) => {
      const product = productsById.get(id);
      return product ? [product] : [];
    }),
    page,
    hasPrevious: page > 1,
    hasNext: follows.length > npShopWishlistLimits.pageSize,
  };
}

export async function npCountShopWishlistSaves(runtime: NpShopRuntime): Promise<number> {
  return countFollows(runtime.collections.products);
}
