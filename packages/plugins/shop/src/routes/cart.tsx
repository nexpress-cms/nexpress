import type { NpRouteRenderProps } from "@nexpress/next";

import { npEmptyShopCartQuote } from "../cart-service.js";
import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopCartSurface } from "../skins/shared.js";

export function createShopCartRoute(runtime: NpShopRuntime) {
  return async function ShopCartRoute(_props: NpRouteRenderProps) {
    const messages = await getShopMessages();
    const skin = resolveShopSkin(runtime);
    const props = {
      basePath: runtime.basePath,
      apiPath: "/api/plugins/shop/cart",
      checkoutApiPath: "/api/plugins/shop/checkout",
      quote: npEmptyShopCartQuote(),
      messages,
    };
    return skin.renderCart?.(props) ?? <ShopCartSurface {...props} skin={skin.id} />;
  };
}
