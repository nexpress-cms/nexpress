import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { npRequireShopCheckoutIntentId } from "../checkout-contract.js";
import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopCheckoutSurface } from "../skins/shared.js";

export function createShopCheckoutRoute(runtime: NpShopRuntime) {
  return async function ShopCheckoutRoute({ params }: NpRouteRenderProps) {
    let intentId: string;
    try {
      intentId = npRequireShopCheckoutIntentId(params.intentId);
    } catch {
      notFound();
    }
    const messages = await getShopMessages();
    const skin = resolveShopSkin(runtime);
    const props = {
      basePath: runtime.basePath,
      apiPath: "/api/plugins/shop/checkout",
      intentId,
      messages,
    };
    return skin.renderCheckout?.(props) ?? <ShopCheckoutSurface {...props} skin={skin.id} />;
  };
}
