import type { NpShopSkin } from "../types.js";
import { ShopCatalogSurface, ShopCategorySurface, ShopProductSurface } from "./shared.js";

export const storefrontFullShopSkin: NpShopSkin = {
  id: "storefront-full",
  label: "Storefront full",
  renderCatalog: (props) => <ShopCatalogSurface {...props} skin="storefront-full" />,
  renderCategory: (props) => <ShopCategorySurface {...props} skin="storefront-full" />,
  renderProduct: (props) => <ShopProductSurface {...props} skin="storefront-full" />,
};
