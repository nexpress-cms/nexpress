"use client";

import { npRequireShopPriceAlertMutationWire } from "./price-alert-contract.js";
import { ShopProductAlert } from "./product-alert-client.js";
import type { NpShopProduct, NpShopProductSummary } from "./types.js";

export interface ShopPriceAlertProps {
  apiPath: string;
  product: NpShopProduct | NpShopProductSummary;
  initialVariantSkus: Array<string | null>;
  signedIn: boolean;
  loginHref: string;
  labels: {
    heading: string;
    select: string;
    subscribe: string;
    subscribed: string;
    saving: string;
    signIn: string;
    unavailable: string;
    failed: string;
  };
}

export function ShopPriceAlert(props: ShopPriceAlertProps) {
  const variants =
    "variants" in props.product ? props.product.variants.filter((variant) => variant.enabled) : [];
  const targets = [
    { variantSku: null, label: props.product.name, priceMinor: props.product.priceMinor },
    ...variants.map((variant) => ({
      variantSku: variant.sku,
      label: variant.optionSummary ?? variant.name,
      priceMinor: variant.priceMinor ?? props.product.priceMinor,
    })),
  ].filter((target) => target.priceMinor > 0);
  return (
    <ShopProductAlert
      {...props}
      productId={props.product.id}
      kind="price"
      targets={targets}
      readMutation={npRequireShopPriceAlertMutationWire}
    />
  );
}
