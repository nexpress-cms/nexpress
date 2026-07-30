import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { npRequireShopOrderId } from "../order-contract.js";
import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopOrderSurface } from "../skins/shared.js";

export function createShopOrderRoute(runtime: NpShopRuntime) {
  return async function ShopOrderRoute({ params }: NpRouteRenderProps) {
    let orderId: string;
    try {
      orderId = npRequireShopOrderId(params.orderId);
    } catch {
      notFound();
    }
    const messages = await getShopMessages();
    const skin = resolveShopSkin(runtime);
    const props = {
      basePath: runtime.basePath,
      apiPath: "/api/plugins/shop/orders",
      orderId,
      messages,
    };
    return skin.renderOrder?.(props) ?? <ShopOrderSurface {...props} skin={skin.id} />;
  };
}
