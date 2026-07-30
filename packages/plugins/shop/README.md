# @nexpress/plugin-shop

First-party NexPress catalog and storefront plugin.

Generated projects register it by default. For a custom project:

```ts
import { defineConfig } from "@nexpress/core";
import { createShop } from "@nexpress/plugin-shop";

const shop = createShop({ basePath: "/catalog", defaultSkinId: "storefront-full" });

export default defineConfig({
  collections: [...shop.collections],
  plugins: [shop.plugin],
});
```

Run `pnpm schema:gen && pnpm db:generate && pnpm db:migrate` after adding the
collections.

It provides:

- product and category collections;
- exact integer-minor-unit prices and bounded variants;
- inventory availability projection;
- catalog, category, product, cart, and checkout-intent routes;
- bounded guest/member carts with revision-safe mutations and live price/stock quotes;
- owner-scoped, idempotent 15-minute checkout intents that become stale when
  the cart or live commercial state changes;
- classic and storefront-full skins;
- featured-product and category-grid blocks.

Payment, orders, customer PII, inventory reservation, and fulfillment remain
outside this package. A checkout intent is a short-lived quote snapshot and
does not imply that a visitor purchased or reserved a product.

See the [live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md)
for the exact price, SKU, inventory, cart, checkout-intent, skin, block, and
theme-integration contracts.
