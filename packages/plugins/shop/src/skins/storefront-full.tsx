import type { NpShopSkin } from "../types.js";
import {
  ShopCartSurface,
  ShopCheckoutSurface,
  ShopOrderDraftSurface,
  ShopOrderSurface,
  ShopOrdersSurface,
  ShopCatalogSurface,
  ShopCategorySurface,
  ShopProductSurface,
  ShopWishlistSurface,
} from "./shared.js";

export const storefrontFullShopSkin: NpShopSkin = {
  id: "storefront-full",
  label: "Storefront full",
  renderCatalog: (props) => <ShopCatalogSurface {...props} skin="storefront-full" />,
  renderCategory: (props) => <ShopCategorySurface {...props} skin="storefront-full" />,
  renderProduct: (props) => <ShopProductSurface {...props} skin="storefront-full" />,
  renderWishlist: (props) => <ShopWishlistSurface {...props} skin="storefront-full" />,
  renderCart: (props) => <ShopCartSurface {...props} skin="storefront-full" />,
  renderCheckout: (props) => <ShopCheckoutSurface {...props} skin="storefront-full" />,
  renderOrderDraft: (props) => <ShopOrderDraftSurface {...props} skin="storefront-full" />,
  renderOrders: (props) => <ShopOrdersSurface {...props} skin="storefront-full" />,
  renderOrder: (props) => <ShopOrderSurface {...props} skin="storefront-full" />,
};
