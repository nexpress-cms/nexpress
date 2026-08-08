import type { ReactNode } from "react";

import { ShopPriceAlert } from "@nexpress/plugin-shop/price-alert-client";

import { npListShopPriceAlertsForProducts } from "./price-alert-service.js";
import type { NpShopMessages, NpShopProductSummary } from "./types.js";

export async function npCreateShopPriceAlertActions(
  products: readonly NpShopProductSummary[],
  memberId: string | null,
  returnHref: string,
  messages: NpShopMessages,
): Promise<Readonly<Record<string, ReactNode>>> {
  const alerts =
    memberId === null
      ? {}
      : await npListShopPriceAlertsForProducts(
          memberId,
          products.map((product) => product.id),
        );
  const loginHref = `/members/login?next=${encodeURIComponent(returnHref)}`;
  return Object.freeze(
    Object.fromEntries(
      products.map((product) => [
        product.id,
        <ShopPriceAlert
          key={product.id}
          apiPath="/api/plugins/shop/price-alerts"
          product={product}
          initialVariantSkus={(alerts[product.id] ?? []).map((alert) => alert.variantSku)}
          signedIn={memberId !== null}
          loginHref={loginHref}
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
        />,
      ]),
    ),
  );
}
