import { isNpRichTextContent } from "@nexpress/core/fields";
import { renderRichText } from "@nexpress/editor/server";
import { buildPageMetadata, getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { ShopAddToCart, ShopProductReviews } from "@nexpress/plugin-shop/client";

import { npGetShopProductReviewPage } from "../review-service.js";

import {
  findShopProduct,
  getShopMessages,
  listShopCategories,
  resolveShopSkin,
  type NpShopRuntime,
} from "../runtime.js";
import { getShopCartClientMessages } from "../skins/shared.js";

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
  return async function ShopProductRoute({ params, searchParams }: NpRouteRenderProps) {
    const product = await findShopProduct(runtime, params.productSlug ?? "");
    if (!product) notFound();
    const member = await getSiteMember();
    const rawReviewPage = Array.isArray(searchParams.reviewPage)
      ? searchParams.reviewPage[0]
      : searchParams.reviewPage;
    const reviewPageNumber = Number(rawReviewPage ?? "1");
    const [allCategories, messages, reviews, inquiryAction] = await Promise.all([
      listShopCategories(runtime),
      getShopMessages(),
      npGetShopProductReviewPage(runtime, product.id, member?.id ?? null, reviewPageNumber),
      runtime.inquiryAdapter?.renderContextQuestions({
        contextType: "shop-product",
        contextId: product.id,
        memberId: member?.id ?? null,
      }) ?? Promise.resolve(null),
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
      cartAction: (
        <ShopAddToCart
          apiPath="/api/plugins/shop/cart"
          product={product}
          messages={getShopCartClientMessages(messages)}
        />
      ),
      reviewAction: (
        <ShopProductReviews
          apiPath="/api/plugins/shop/reviews"
          productId={product.id}
          productPath={`${runtime.basePath}/products/${product.slug}`}
          initialPage={reviews}
          messages={{
            locale: messages.locale,
            heading: messages.reviewHeading,
            verified: messages.reviewVerified,
            empty: messages.reviewEmpty,
            write: messages.reviewWrite,
            edit: messages.reviewEdit,
            login: messages.reviewLogin,
            unavailable: messages.reviewUnavailable,
            purchase: messages.reviewPurchase,
            rating: messages.reviewRating,
            title: messages.reviewTitle,
            body: messages.reviewBody,
            photos: messages.reviewPhotos,
            upload: messages.reviewUpload,
            remove: messages.reviewRemove,
            save: messages.reviewSave,
            saving: messages.reviewSaving,
            delete: messages.reviewDelete,
            failed: messages.reviewFailed,
            previous: messages.previous,
            next: messages.next,
          }}
          signedIn={member !== null}
        />
      ),
      reviews,
      inquiryAction,
      messages,
    });
  };
}
