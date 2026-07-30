import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { npRequireShopOrderDraftId } from "../order-draft-contract.js";
import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopOrderDraftSurface } from "../skins/shared.js";

export function createShopOrderDraftRoute(runtime: NpShopRuntime) {
  return async function ShopOrderDraftRoute({ params }: NpRouteRenderProps) {
    let draftId: string;
    try {
      draftId = npRequireShopOrderDraftId(params.draftId);
    } catch {
      notFound();
    }
    const messages = await getShopMessages();
    const skin = resolveShopSkin(runtime);
    const props = {
      basePath: runtime.basePath,
      apiPath: "/api/plugins/shop/order-drafts",
      orderApiPath: "/api/plugins/shop/orders",
      draftId,
      messages,
    };
    return skin.renderOrderDraft?.(props) ?? <ShopOrderDraftSurface {...props} skin={skin.id} />;
  };
}
