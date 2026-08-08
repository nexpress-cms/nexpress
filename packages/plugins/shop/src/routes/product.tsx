import { isNpRichTextContent } from "@nexpress/core/fields";
import { renderRichText } from "@nexpress/editor/server";
import { buildPageMetadata, getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { ShopAddToCart, ShopProductReviews } from "@nexpress/plugin-shop/client";
import { ShopRestockAlert } from "@nexpress/plugin-shop/restock-alert-client";
import { ShopPriceAlert } from "@nexpress/plugin-shop/price-alert-client";

import { npGetShopProductReviewPage } from "../review-service.js";
import { npListShopRestockAlerts } from "../restock-alert-service.js";
import { npListShopPriceAlerts } from "../price-alert-service.js";

import {
  findShopProduct,
  getShopMessages,
  listShopCategories,
  resolveShopSkin,
  type NpShopRuntime,
} from "../runtime.js";
import { getShopCartClientMessages } from "../skins/shared.js";
import { npCreateShopWishlistActions } from "../wishlist-actions.js";

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
    const [allCategories, messages, reviews, inquiryAction, restockAlerts, priceAlerts] =
      await Promise.all([
        listShopCategories(runtime),
        getShopMessages(),
        npGetShopProductReviewPage(runtime, product.id, member?.id ?? null, reviewPageNumber),
        runtime.inquiryAdapter?.renderContextQuestions({
          contextType: "shop-product",
          contextId: product.id,
          memberId: member?.id ?? null,
        }) ?? Promise.resolve(null),
        member ? npListShopRestockAlerts(member.id, product.id) : Promise.resolve([]),
        member ? npListShopPriceAlerts(member.id, product.id) : Promise.resolve([]),
      ]);
    const categories = allCategories.filter((category) =>
      product.categoryIds.includes(category.id),
    );
    const description = isNpRichTextContent(product.description)
      ? renderRichText(product.description)
      : null;
    const productPath = `${runtime.basePath}/products/${product.slug}`;
    const wishlistActions = await npCreateShopWishlistActions(
      runtime,
      [product],
      member?.id ?? null,
      productPath,
      messages,
    );
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
          productPath={productPath}
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
      wishlistAction: wishlistActions[product.id],
      restockAction: (
        <ShopRestockAlert
          apiPath="/api/plugins/shop/restock-alerts"
          product={product}
          initialVariantSkus={restockAlerts.map((alert) => alert.variantSku)}
          signedIn={member !== null}
          loginHref={`/members/login?next=${encodeURIComponent(productPath)}`}
          labels={{
            heading: messages.restockHeading,
            select: messages.restockSelect,
            subscribe: messages.restockSubscribe,
            subscribed: messages.restockSubscribed,
            saving: messages.restockSaving,
            signIn: messages.restockSignIn,
            unavailable: messages.restockUnavailable,
            failed: messages.restockFailed,
          }}
        />
      ),
      priceAlertAction: (
        <ShopPriceAlert
          apiPath="/api/plugins/shop/price-alerts"
          product={product}
          initialVariantSkus={priceAlerts.map((alert) => alert.variantSku)}
          signedIn={member !== null}
          loginHref={`/members/login?next=${encodeURIComponent(productPath)}`}
          labels={{
            heading: messages.priceAlertHeading,
            select: messages.priceAlertSelect,
            subscribe: messages.priceAlertSubscribe,
            subscribed: messages.priceAlertSubscribed,
            saving: messages.priceAlertSaving,
            signIn: messages.priceAlertSignIn,
            unavailable: messages.priceAlertUnavailable,
            failed: messages.priceAlertFailed,
          }}
        />
      ),
      messages,
    });
  };
}
