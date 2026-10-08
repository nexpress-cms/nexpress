"use client";

import { npRequireShopRestockAlertMutationWire } from "./restock-alert-contract.js";
import { ShopProductAlert } from "./product-alert-client.js";
import type { NpShopProduct } from "./types.js";

export interface ShopRestockAlertProps {
  apiPath: string;
  product: NpShopProduct;
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

export function ShopRestockAlert(props: ShopRestockAlertProps) {
  const enabledVariants = props.product.variants.filter((variant) => variant.enabled);
  const targets =
    enabledVariants.length > 0
      ? enabledVariants
          .filter((variant) => variant.stockQuantity === 0)
          .map((variant) => ({
            variantSku: variant.sku,
            label: variant.optionSummary ?? variant.name,
          }))
      : props.product.inventoryState === "out-of-stock"
        ? [{ variantSku: null, label: props.product.name }]
        : [];
  return (
    <ShopProductAlert
      {...props}
      productId={props.product.id}
      kind="restock"
      targets={targets}
      readMutation={npRequireShopRestockAlertMutationWire}
    />
  );
}
