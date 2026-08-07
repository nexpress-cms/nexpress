import { getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { getShopMessages, resolveShopSkin, type NpShopRuntime } from "../runtime.js";
import { ShopWishlistSurface } from "../skins/shared.js";
import { npCreateShopWishlistActions } from "../wishlist-actions.js";
import { npGetShopWishlistPage, parseShopWishlistPage } from "../wishlist-service.js";

export function createShopWishlistRoute(runtime: NpShopRuntime) {
  return async function ShopWishlistRoute({ searchParams }: NpRouteRenderProps) {
    const pageNumber = parseShopWishlistPage(searchParams.page);
    if (pageNumber === null) notFound();
    const [member, messages] = await Promise.all([getSiteMember(), getShopMessages()]);
    const page = member
      ? await npGetShopWishlistPage(runtime, member.id, pageNumber)
      : { products: [], page: pageNumber, hasPrevious: false, hasNext: false };
    const routePath = `${runtime.basePath}/wishlist`;
    const wishlistActions = await npCreateShopWishlistActions(
      runtime,
      page.products,
      member?.id ?? null,
      page.page > 1 ? `${routePath}?page=${page.page.toString()}` : routePath,
      messages,
      page.products.map((product) => product.id),
      true,
    );
    const skin = resolveShopSkin(runtime);
    const props = {
      basePath: runtime.basePath,
      page,
      signedIn: member !== null,
      loginHref: `/members/login?next=${encodeURIComponent(routePath)}`,
      wishlistActions,
      messages,
    };
    return skin.renderWishlist?.(props) ?? <ShopWishlistSurface {...props} skin={skin.id} />;
  };
}
