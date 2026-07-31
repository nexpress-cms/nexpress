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
- on-hand inventory projection plus transaction-safe pending-order
  reservations;
- catalog, category, product, cart, checkout-intent, private order-draft,
  order-history, and order-detail routes;
- bounded guest/member carts with revision-safe mutations and live price/stock quotes;
- owner-scoped, idempotent 15-minute checkout intents that become stale when
  the cart or live commercial state changes;
- owner-scoped 24-hour order drafts with revision-safe, bounded customer and
  shipping details, immediate cancellation deletion, and hourly expiry cleanup;
- owner-scoped durable pending orders with immutable commercial snapshots,
  separate 24-hour private sidecars, revision-safe cancellation, bounded
  history/Admin views, transaction-safe product/variant holds, cancellation
  release, and 365-day commercial cleanup;
- an optional build-time payment adapter with bounded owner-scoped initiation
  attempts, exact raw webhook intake, five-minute event replay bound,
  idempotent PII-free receipts, `paid` / `payment-failed` transitions, and
  atomic reservation consumption or release;
- classic and storefront-full skins;
- featured-product and category-grid blocks.

Provider-specific browser/server protocols, signature algorithms, credentials
and rotation, refunds/reversals, tax, shipping rates, and fulfillment remain
outside this package. `@nexpress/shop-payment-toss` is the bundled Toss
Payments v2 adapter. Customer/shipping PII exists only in the short-lived
private draft or order sidecar and stays outside content search, revisions,
payment receipts, and transfer. A durable `pending-payment` order reference
still does not imply that a visitor paid for a product.

See the [live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md)
for the exact price, SKU, inventory, cart, checkout-intent, private-draft,
pending-order, payment-attempt, skin, block, and theme-integration contracts.
