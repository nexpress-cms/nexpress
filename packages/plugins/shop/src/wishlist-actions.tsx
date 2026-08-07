import type { ReactNode } from "react";

import { ShopWishlistAction } from "@nexpress/plugin-shop/client";

import type { NpShopRuntime } from "./runtime.js";
import type { NpShopMessages, NpShopProductSummary } from "./types.js";
import { npListShopWishlistSavedProductIds } from "./wishlist-service.js";

export async function npCreateShopWishlistActions(
  runtime: NpShopRuntime,
  products: readonly NpShopProductSummary[],
  memberId: string | null,
  returnHref: string,
  messages: NpShopMessages,
  knownSavedProductIds?: readonly string[],
  reloadOnChange = false,
): Promise<Readonly<Record<string, ReactNode>>> {
  const productIds = products.map((product) => product.id);
  const savedIds =
    memberId === null
      ? []
      : (knownSavedProductIds ??
        (await npListShopWishlistSavedProductIds(runtime, memberId, productIds)));
  const saved = new Set(savedIds);
  const loginHref = `/members/login?next=${encodeURIComponent(returnHref)}`;
  return Object.freeze(
    Object.fromEntries(
      products.map((product) => [
        product.id,
        <ShopWishlistAction
          key={product.id}
          targetType={runtime.collections.products}
          productId={product.id}
          initialSaved={saved.has(product.id)}
          signedIn={memberId !== null}
          loginHref={loginHref}
          reloadOnChange={reloadOnChange}
          labels={{
            save: messages.wishlistSave,
            saved: messages.wishlistSaved,
            saving: messages.wishlistSaving,
            signIn: messages.wishlistSignIn,
            failed: messages.wishlistFailed,
          }}
        />,
      ]),
    ),
  );
}
