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
- catalog, category, product, cart, checkout-intent, private order-draft,
  order-history, and order-detail routes;
- bounded guest/member carts with revision-safe mutations and live price/stock quotes;
- owner-scoped, idempotent 15-minute checkout intents that become stale when
  the cart or live commercial state changes;
- owner-scoped 24-hour order drafts with revision-safe, bounded customer and
  shipping details, immediate cancellation deletion, and hourly expiry cleanup;
- owner-scoped durable pending orders with immutable commercial snapshots,
  separate 24-hour private sidecars, revision-safe cancellation, bounded
  history/Admin views, and 365-day commercial cleanup;
- classic and storefront-full skins;
- featured-product and category-grid blocks.

Payment success, inventory reservation, fulfillment, and refunds remain
outside this package. Customer/shipping PII exists only in the short-lived
private draft or pending-order sidecar and stays outside content search,
revisions, and transfer. A durable `pending-payment` order reference still
does not imply that a visitor paid for or reserved a product.

See the [live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md)
for the exact price, SKU, inventory, cart, checkout-intent, private-draft,
pending-order, skin, block, and theme-integration contracts.
