import type { NpShopSkin } from "../types.js";
import { ShopCatalogSurface, ShopCategorySurface, ShopProductSurface } from "./shared.js";

export const classicShopSkin: NpShopSkin = {
  id: "classic",
  label: "Classic catalog",
  renderCatalog: (props) => <ShopCatalogSurface {...props} skin="classic" />,
  renderCategory: (props) => <ShopCategorySurface {...props} skin="classic" />,
  renderProduct: (props) => <ShopProductSurface {...props} skin="classic" />,
};
