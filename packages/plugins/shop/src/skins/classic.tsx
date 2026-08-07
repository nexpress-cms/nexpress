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

export const classicShopSkin: NpShopSkin = {
  id: "classic",
  label: "Classic catalog",
  renderCatalog: (props) => <ShopCatalogSurface {...props} skin="classic" />,
  renderCategory: (props) => <ShopCategorySurface {...props} skin="classic" />,
  renderProduct: (props) => <ShopProductSurface {...props} skin="classic" />,
  renderWishlist: (props) => <ShopWishlistSurface {...props} skin="classic" />,
  renderCart: (props) => <ShopCartSurface {...props} skin="classic" />,
  renderCheckout: (props) => <ShopCheckoutSurface {...props} skin="classic" />,
  renderOrderDraft: (props) => <ShopOrderDraftSurface {...props} skin="classic" />,
  renderOrders: (props) => <ShopOrdersSurface {...props} skin="classic" />,
  renderOrder: (props) => <ShopOrderSurface {...props} skin="classic" />,
};
