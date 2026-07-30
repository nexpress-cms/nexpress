# Shop plugin and Storefront theme

`@nexpress/plugin-shop` is the first-party catalog foundation for NexPress.
It owns product and category data, inventory projection, public catalog
routes, bounded guest/member carts and checkout intents, Admin collection forms
and health actions, blocks, and skins.

`@nexpress/theme-storefront` is a separate brand/content theme. It works with
ordinary pages and posts when Shop is absent. When both packages are active,
the theme enhances Shop through documented CSS variables, classes, data
attributes, and optional page blocks; neither package imports the other.

The cart and checkout intent are deliberately **pre-transaction state**. They
do not reserve or decrement inventory, collect customer PII, create orders,
take payments, fulfill, refund, or claim that a visitor completed a purchase.

## Default setup

Fresh NexPress projects receive `shopCollections`, `shopPlugin`, and
`storefrontTheme` through the framework defaults. After applying the generated
migration:

1. Open Admin → Commerce → Shop categories and publish categories.
2. Open Admin → Commerce → Products and publish products.
3. Visit `/shop`.
4. Add a product to the cart, visit `/shop/cart`, and create a short-lived
   checkout intent.
5. Optionally activate Storefront from Admin → Appearance.
6. Add the `shop.category-grid` and `shop.featured-products` blocks to a page,
   or insert the `shop.storefront-home` pattern.

Sites upgrading from a version without Shop must generate, review, and apply
the collection migration:

```bash
pnpm schema:gen
pnpm db:generate
pnpm db:migrate
```

## Product contract

Prices are safe integers in the currency's minor unit:

- KRW and JPY use whole currency units.
- USD and EUR use cents.
- Values range from `0` through `2,147,483,647`, matching the generated
  PostgreSQL `integer` column exactly.
- `compareAtPriceMinor`, when present, must be greater than `priceMinor`.

The product SKU is optional, normalized to uppercase, and unique within one
site. Variant SKUs are required, uppercase, unique within the product, and
must differ from the product SKU. Product names accept up to 180 characters,
variant names up to 120, SKUs up to 64, galleries up to 12 images, and
products up to 100 variants.

Inventory has one exact projection:

- With no enabled variants, `stockQuantity` is the product stock.
- With enabled variants, aggregate stock is the sum of enabled variant stock;
  the standalone product quantity is not double-counted.
- When tracking is off, state is `untracked` and the product remains
  available.
- Tracked zero stock becomes `out-of-stock`.
- Tracked positive stock at or below `lowStockThreshold` becomes `low-stock`.
- Higher tracked stock becomes `in-stock`.

The write hook derives hidden `available` and `inventoryState` fields before
persistence. Public queries use those stored fields for bounded filtering,
while the runtime recomputes and validates the projection before rendering so
malformed persisted commercial values fail closed.

Categories cannot be deleted while any product still references them. Move or
remove the relationship first.

## Public routes and discovery

| Route                            | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `/shop`                          | Published product catalog             |
| `/shop/categories/:categorySlug` | One published category                |
| `/shop/products/:productSlug`    | Product detail, variants, and gallery |
| `/shop/cart`                     | Current guest or member cart          |
| `/shop/checkout/:intentId`       | Owner-scoped checkout intent snapshot |

Catalog and category routes recognize:

| Query   | Contract                                                      |
| ------- | ------------------------------------------------------------- |
| `q`     | Whitespace-normalized full-text query, at most 120 characters |
| `sort`  | `newest`, `price-asc`, `price-desc`, or `name`                |
| `stock` | The literal `available`                                       |
| `page`  | Canonical positive integer from 1 through 10,000              |

Duplicated or malformed recognized parameters fail closed. Unknown campaign
parameters are ignored. Filter state survives pagination. Collection SEO paths
feed the shared sitemap/search contracts, and product metadata includes its
summary and primary image.

## Cart and quote contract

Shop exposes `GET`, `POST`, `PATCH`, and `DELETE` at
`/api/plugins/shop/cart`. The public route is browser-oriented and owns its
CSRF checks because plugin API routes are framework-CSRF-exempt:

- guests receive an HttpOnly, SameSite=Lax `np-shop-cart` cookie containing a
  random opaque id and HMAC signature; only its SHA-256 digest reaches storage;
- guest mutation tokens are derived from that signed identity and returned by
  the cart `GET`;
- active members use their site-scoped member id and the existing
  `np-mb-csrf` double-submit token;
- signing requires the framework `NP_SECRET` (at least 32 characters).

Cart rows live in site-scoped `np_plugin_storage`, not content collections.
They therefore do not enter search, revisions, content export, or document
quotas. Guest carts expire after 30 days and member carts after 180 days.
Every mutation refreshes expiry. Each cart accepts at most 50 distinct product
option lines and 99 units per line. An hourly scheduled task deletes at most
500 expired rows per active site, while Admin offers the same bounded cleanup.

Every write includes `expectedRevision`. A stale concurrent write receives
HTTP 409 and must refresh before retrying. When an authenticated member first
reads a browser's guest cart, Shop locks both owner keys in canonical order,
merges quantities deterministically while retaining the member's existing
lines first, caps the public bounds, deletes the guest row, and expires the
guest cookie.

Stored cart lines contain only display snapshots and identity:

- product id, slug, and name;
- optional canonical variant SKU and name;
- quantity, currency, and integer unit price.

Every response re-reads published products and enabled variants. The returned
`np.shop-cart-quote.v1` quote recomputes current prices, stock, per-currency
subtotals, total units, a deterministic fingerprint, and exact issue codes:
`product-unavailable`, `variant-required`, `variant-unavailable`,
`insufficient-stock`, `price-changed`, and `mixed-currency`. Price changes are
visible but do not alone block readiness. Unavailable products/options,
insufficient stock, and mixed currencies do. Checkout integrations must quote
again and establish their own order, payment, inventory reservation,
idempotency, tax, and shipping contracts.

## Checkout intent contract

Shop exposes `GET`, `POST`, and `DELETE` at
`/api/plugins/shop/checkout`. A checkout intent is an exact,
owner-scoped snapshot of one current cart quote:

- `POST` accepts only `idempotencyKey`, `expectedRevision`, and
  `expectedFingerprint`;
- the idempotency key is a canonical UUID and also becomes the opaque public
  intent id;
- the current cart must be non-empty, ready, and use exactly one currency;
- the snapshot stores product identity/display fields, canonical variant SKU,
  integer prices, subtotal, quantity, cart revision, and cart fingerprint;
- each owner may hold at most five unexpired, non-cancelled intents and 20
  total unexpired records including cancellations;
- every intent expires exactly 15 minutes after creation;
- `GET ?id=<uuid>` and `DELETE { intentId }` require the same signed guest or
  active member identity that created it;
- mutation requests reuse the Shop CSRF token returned by cart/checkout reads.

The exact public envelope is `np.shop-checkout-intent.v1`. Its status is
derived as:

| Status      | Meaning                                                             |
| ----------- | ------------------------------------------------------------------- |
| `open`      | Current cart remains ready and its revision/fingerprint still match |
| `stale`     | Cart contents, price, inventory, publication, or options changed    |
| `cancelled` | The owner explicitly cancelled the intent                           |
| `expired`   | The fixed 15-minute lifetime elapsed                                |

Creation and repeated use of the same idempotency key serialize per owner and
converge on one stored row. Reusing it for a different cart snapshot fails with
HTTP 409. Different keys are admitted under an owner-level lock so concurrent
requests cannot exceed the five-intent limit. The intent remains only a quote
boundary: it does not clear the cart, create an order, reserve inventory, or
authorize later payment. Every future consumer must read it again and require
`open` immediately before its own external effect.

Checkout intent rows share site-scoped `np_plugin_storage` with carts and stay
outside content search, revisions, transfer, and document quotas. An hourly
oldest-first task and confirmed Admin action each delete at most 500 expired
`checkout-intent:%` rows per site without touching other Shop KV data.

## Admin surfaces

The two collections appear in the Commerce group. Product editing includes
price, tax-display, media, SKU, inventory, variants, featured state, and skin
selection. Operator-only derived fields stay hidden.

The plugin declares four typed dashboard metric actions:

- total product rows;
- published low-stock products;
- active unexpired carts;
- unexpired non-cancelled checkout-intent records (public reads still
  revalidate the current cart).

Admin also exposes separate cart and checkout-intent storage health
(active/cancelled/expired/invalid rows) plus confirmed bounded expiry cleanup
actions. The scheduled-task and action registries make these contracts visible
to plugin doctor without executing them.

The manifest-level action registry binds each metric widget to its exact
handler kind, so plugin validation and doctor can inspect the relationship
before a click.

## Skins and theme integration

Every Shop factory registers:

| ID                | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `classic`         | Compact, neutral catalog and detail fallback               |
| `storefront-full` | Larger editorial header and image-led product presentation |

Both skins implement catalog, category, product, cart, and checkout-intent
rendering. They receive prepared products, localized messages, safe formatted
money, and rendered rich text; they do not own collection or transaction
policy.

Plugin structure ships in `@layer np-blocks` and consumes stable properties
with core-token fallbacks:

```css
--np-shop-content-max
--np-shop-gutter
--np-shop-surface
--np-shop-soft
--np-shop-ink
--np-shop-subtle
--np-shop-line
--np-shop-accent
--np-shop-accent-foreground
```

The main public hooks are `.np-shop`, `.np-shop-product-card`,
`.np-shop-product-grid`, `.np-shop-category-grid`, `.np-shop-filters`,
`.np-shop-cart-client`, `[data-np-shop-cart-action]`,
`[data-np-shop-cart-line]`,
`.np-shop-checkout-client`, `[data-np-shop-checkout-line]`,
`[data-np-shop-checkout-status]`,
`[data-np-shop-surface]`, `[data-np-shop-skin]`,
`[data-np-shop-inventory]`, and `[data-np-shop-block]`.

Storefront sets those variables on its shell and adds optional selectors, but
declares no Shop collection requirement. Shop uses core theme-token fallbacks
and remains complete under Default, Community, Magazine, Portfolio, Docs, or
a third-party theme.

## Customized registration

Use one factory result for both collections and plugin:

```ts
import { defineConfig } from "@nexpress/core";
import { createShop } from "@nexpress/plugin-shop";

const shop = createShop({
  basePath: "/catalog",
  collections: {
    categories: "catalog-categories",
    products: "catalog-products",
  },
  defaultSkinId: "storefront-full",
});

export default defineConfig({
  collections: [...shop.collections],
  plugins: [shop.plugin],
});
```

Collection slugs and the route root are code/schema decisions. Change them
before the first migration. Do not call `createShop()` separately for the
collection and plugin arrays: handlers, relationships, routes, blocks, and
Admin actions intentionally close over one runtime definition.

Custom build-time skins implement `NpShopSkin` and may be added through the
factory's `skins` option. `renderCart` and `renderCheckout` are additive and
optional; when omitted, the complete shared surfaces are used. Routes own
identity, mutation, and quote policy while skins receive prepared client
surfaces. Existing `classic` and `storefront-full` ids cannot be replaced.

## Next commerce slices

Future transaction work should remain separable from this foundation:

1. order draft plus customer/shipping PII lifecycle and deletion policy;
2. payment-provider adapters and idempotent webhook intake;
3. order, refund, fulfillment, and customer Admin workflows;
4. stock reservation and transactional decrement;
5. legal/tax/shipping policy integrations.

Those features require explicit payment, security, and operational contracts.
The current catalog/cart/checkout-intent data and independent theme do not
pre-authorize or emulate them.
