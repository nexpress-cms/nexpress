import type { NpShopSkin } from "../types.js";
import {
  ShopCartSurface,
  ShopCheckoutSurface,
  ShopOrderDraftSurface,
  ShopCatalogSurface,
  ShopCategorySurface,
  ShopProductSurface,
} from "./shared.js";

export const classicShopSkin: NpShopSkin = {
  id: "classic",
  label: "Classic catalog",
  renderCatalog: (props) => <ShopCatalogSurface {...props} skin="classic" />,
  renderCategory: (props) => <ShopCategorySurface {...props} skin="classic" />,
  renderProduct: (props) => <ShopProductSurface {...props} skin="classic" />,
  renderCart: (props) => <ShopCartSurface {...props} skin="classic" />,
  renderCheckout: (props) => <ShopCheckoutSurface {...props} skin="classic" />,
  renderOrderDraft: (props) => <ShopOrderDraftSurface {...props} skin="classic" />,
};
