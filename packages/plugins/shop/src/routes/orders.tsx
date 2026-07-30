import type { NpRouteRenderProps } from "@nexpress/next";

import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopOrdersSurface } from "../skins/shared.js";

export function createShopOrdersRoute(runtime: NpShopRuntime) {
  return async function ShopOrdersRoute(_props: NpRouteRenderProps) {
    const messages = await getShopMessages();
    const skin = resolveShopSkin(runtime);
    const props = {
      basePath: runtime.basePath,
      apiPath: "/api/plugins/shop/orders",
      messages,
    };
    return skin.renderOrders?.(props) ?? <ShopOrdersSurface {...props} skin={skin.id} />;
  };
}
