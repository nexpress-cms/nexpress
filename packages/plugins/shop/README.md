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
- catalog, category, product, cart, checkout-intent, and private order-draft routes;
- bounded guest/member carts with revision-safe mutations and live price/stock quotes;
- owner-scoped, idempotent 15-minute checkout intents that become stale when
  the cart or live commercial state changes;
- owner-scoped 24-hour order drafts with revision-safe, bounded customer and
  shipping details, immediate cancellation deletion, and hourly expiry cleanup;
- classic and storefront-full skins;
- featured-product and category-grid blocks.

Payment, finalized orders, inventory reservation, and fulfillment remain
outside this package. Customer/shipping PII exists only in the short-lived
private draft contract and stays outside content search, revisions, and
transfer. Neither a checkout intent nor a saved draft implies that a visitor
purchased or reserved a product.

See the [live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md)
for the exact price, SKU, inventory, cart, checkout-intent, private-draft,
skin, block, and theme-integration contracts.
