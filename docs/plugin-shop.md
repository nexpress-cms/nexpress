# Shop plugin and Storefront theme

`@nexpress/plugin-shop` is the first-party catalog foundation for NexPress.
It owns product, category, promotion, local shipping-policy, and verified-purchase review data, inventory projection, public catalog
routes, bounded guest/member carts, checkout intents, private order drafts,
durable orders, transaction-safe inventory reservations, local or optional
external provider-neutral shipping quotes and selected delivery snapshots, an optional
provider-neutral additional-tax quote and frozen tax snapshot, an optional
provider-neutral payment initiation and verified-event boundary, revision-safe
fulfillment operations, optional provider-neutral carrier booking,
revision-safe PII-free fulfillment parcel snapshots,
optional read-only outbound and replacement packaging proposals,
durable provider-neutral shipping-label purchase/regeneration with transient retrieval,
provider-neutral carrier pickup scheduling and cancellation,
verified or reconciled carrier tracking events and owner-visible delivery state,
provider-neutral full refunds with safe inventory
compensation, owner-scoped item return intake with audited receipt inventory,
provider-neutral partial refunds linked to received returns with optional
quote-backed merchant/customer return-postage settlement,
optional owner-scoped return shipment/drop-off or pickup creation with transient labels,
member-owned saved products over the shared follow graph, independent one-shot
restock and catalog price-drop alerts, Admin collection
forms and health actions, blocks, and skins.

`@nexpress/theme-storefront` is a separate brand/content theme. It works with
ordinary pages and posts when Shop is absent. When both packages are active,
the theme enhances Shop through documented CSS variables, classes, data
attributes, and optional page blocks; neither package imports the other.

The cart, checkout intent, and order draft are deliberately **pre-order
state**. A reviewable draft can create a durable `pending-payment` order that
reserves tracked product or variant inventory for its 24-hour lifetime. An
optional build-time adapter may prepare a provider handoff, confirm the
browser return on the server, authenticate an external callback, and project
the exact provider-neutral event that moves that order to `paid` or
`payment-failed`. A refund-capable adapter may also cancel one entire provider
payment or one exact amount linked to a received physical return. Shop owns attempts, order/refund transitions, fulfillment and return
state, carrier booking/pickup/tracking/return-logistics receipts, and local compensation, but does not choose a provider protocol, remit
or file tax, issue tax invoices, decide exemptions, physically fulfill goods,
choose label billing, paper layout, or void/refund policy, schedule recurring pickups, implement a provider protocol, or decide jurisdiction-specific return eligibility.

## Default setup

Fresh NexPress projects receive one paired Shop factory result and
`storefrontTheme` through the framework defaults. That default Shop result is
structurally wired to Forum for optional product inquiries, while either
package remains independently replaceable. After applying the generated migration:

1. Open Admin → Commerce → Shop categories and publish categories.
2. Open Admin → Commerce → Products and publish products.
3. Optionally publish automatic promotions or coupon codes under Commerce → Promotions.
4. Optionally publish a base delivery rule and regional surcharges under
   Commerce → Shipping policies.
5. Ship a member order to make its purchased line eligible for one product
   review; merely paid or unfulfilled orders are not eligible.
6. Visit `/shop`.
7. Sign in, save a product from any catalog surface, and visit
   `/shop/wishlist`.
8. Set one tracked product or enabled variant to zero stock and use its product
   page to request a one-shot restock alert.
9. Request a one-shot catalog price alert for a product or enabled variant,
   then lower that exact catalog price below its captured baseline.
10. Add a product to the cart, visit `/shop/cart`, create a short-lived
    checkout intent, continue to the 24-hour private order draft, and optionally
    create a durable pending order reference.
11. Optionally activate Storefront from Admin → Appearance.
12. Add the `shop.category-grid` and `shop.featured-products` blocks to a page,
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

Catalog cards and the `stock=available` filter intentionally describe
persisted on-hand stock. Active pending-order holds are transient and are not
folded into collection pagination totals. Cart quotes subtract active holds,
and order creation rechecks that sellable quantity under product locks before
committing, so the order boundary remains authoritative even when a catalog
page is older or another visitor is ordering concurrently.

Categories cannot be deleted while any product still references them. Move or
remove the relationship first.

## Member wishlists

Products opt into the existing `community.follows` document contract. Shop
does not add a wishlist table or duplicate authentication endpoint: its buttons
use the authenticated `POST` / `DELETE /api/follows` routes, the member CSRF
cookie, and the configured product collection slug. Core therefore enforces
site scope, published/readable product existence, and the product's validated
local `seo.urlPath` before a save is persisted.

Catalog, category, and product routes render a sign-in link for visitors. For
members, each card window resolves saved state in one bounded query of at most
200 unique product IDs rather than one request per product. `/shop/wishlist`
reads deterministic newest-first follow windows of 24, hydrates only currently
published products, preserves save order, and omits unavailable or malformed
documents without exposing the member ID. Removing a save from that page
refreshes the bounded window after the exact API response validates.

This is a saved-product contract only. It does not emit `follow.activity` or
couple saves to the separate restock-alert contract, carts, orders, pricing,
or inventory reservations. Unpublishing a product hides it while retaining the
member relation; republishing makes it visible again. Product deletion uses
Core's existing transactional polymorphic-follow cleanup.

Admin exposes a site-scoped saved-product count and status without follower
identity. Generic plugin Doctor follow diagnostics continue to report malformed
and orphaned relations, so Shop does not maintain a second integrity scanner.

## Member restock alerts

Restock alerts are independent of wishlists. An authenticated member may use
`POST /api/plugins/shop/restock-alerts` with the member CSRF token and exact
`{ productId, variantSku }` body only when that published target tracks
inventory and is currently at zero. Products with enabled variants require one
exact enabled SKU; products without enabled variants require `variantSku:
null`. `GET` lists the current member's active targets for one product and
`DELETE` cancels an alert before delivery processing claims it. No member id is
accepted from or returned to the browser.

Each active plugin-storage row is site-scoped, PII-free, and expires after 180
days. A product update hook checks the changed product immediately. The
`reconcile-restock-alerts` task also scans one oldest-first bounded batch every
five minutes so Admin SQL updates, cancellation/refund restoration, imports,
or other writes that do not dispatch content hooks still converge. Invalid or
deleted member/product/variant targets fail closed and reach Admin Health;
product deletion removes its remaining alert rows.

When the exact target is published and positive again, Shop leases the row and
creates one `shop.product-restocked` inbox notification. Its stable per-alert
`eventId` is checked before retrying after a worker crash, and the completed
receipt is retained for 30 days. A disabled notification preference records a
suppressed completion instead of retrying forever. The existing optional daily
or weekly community digest can carry unread alerts; Shop does not add a direct
marketing-email, SMS, or push channel.

Admin exposes only aggregate active/completed counts and bounded malformed,
orphan, ready, expired, and stale-lease health. The manual reconcile action and
scheduled task share the same processor. Plugin Doctor validates the declared
API route, content hooks, schedule, metric, status, and action registries before
runtime; setup registers the bounded notification-kind metadata. The contract
never reserves inventory, inserts an item into a cart, changes a wishlist,
watches price, guarantees availability, or repeats after one completion; a
later stock cycle requires a new request.

## Member catalog price-drop alerts

Price-drop alerts are independent of wishlists, restock alerts, carts, and
promotions. An authenticated member may send `POST /api/plugins/shop/price-alerts`
with the member CSRF token and exact
`{ productId, variantSku }`. `variantSku: null` selects the product's own
published catalog price even when variants exist; an exact enabled SKU selects
its override or the product-price fallback. The response exposes only the
target, currency, captured baseline, and expiry. `GET` lists the current
member's active targets for one product, while `DELETE` cancels an unclaimed
request. Zero-price and unpublished targets fail closed.

Each request captures the current integer-minor-unit catalog price and currency
for 180 days. It completes once, and only when that exact target remains
published in the same currency and its current catalog price is strictly below
the baseline. Compare-at prices, promotion/coupon results, cart allocation,
shipping, and tax do not participate. Reposting an active target is idempotent;
cancel and subscribe again to capture a new baseline.

Product update hooks provide the fast path, and the five-minute
`reconcile-price-alerts` task catches direct SQL changes, imports, or other
writes that bypass content hooks. A due row is leased before delivery and uses
one stable `eventId` to deduplicate the `shop.product-price-dropped` member
inbox notification after crashes. Disabled inbox preferences produce a
suppressed completion. Completed receipts remain for 30 days; currency
changes remain active and reach health diagnostics instead of comparing
unlike units.

Admin exposes PII-free active totals and bounded malformed, orphan, due,
currency-mismatch, expiry, and stale-lease health plus one manual reconcile
action. Plugin Doctor validates the API routes, hooks, schedule, notification
kind, and exact action registry. The contract does not reserve inventory,
guarantee a future price, add an item to a cart, send direct marketing email,
or recur after completion.

## Verified-purchase reviews

The fifth Commerce collection, `shop-product-reviews`, owns product reviews
without coupling the catalog to a payment or carrier provider. Eligibility
requires an authenticated member order whose current fulfillment is exactly
`shipped`; a paid, processing, cancelled, or guest order is not enough. The
product page issues a 30-minute HMAC purchase token for each eligible order
line. Create rechecks the live order owner, product/line snapshot, paid or
refunded commercial state, and shipped fulfillment before committing.

Each purchased line can create at most one review. Persistence stores only a
site-unique SHA-256 purchase key plus the product, rating, title, body, photos,
and verified flag. It never stores the raw token, order id, line key, or another
purchase/customer snapshot in the review document. Reviews therefore remain
valid after the normal 365-day order purge without extending commerce or PII
retention. Product deletion is blocked while reviews still reference it.

The exact author contract is:

- integer rating from 1 through 5;
- title from 1 through 120 trimmed characters;
- body from 1 through 2,000 trimmed characters;
- at most five member-owned, ready image uploads, each limited to 5 MiB by the
  member upload endpoint and revalidated against media ownership on the server;
- member-owned edit and delete, with product, purchase key, author, and
  verified state immutable.

`GET /api/plugins/shop/reviews?productId=...&page=...` returns
`np.shop-product-review-page.v1`. Public rows expose a safe member profile or
`null`, photo URLs, ownership boolean, and review text. They never expose the
member id, purchase key, order id, or line key. Counts use exact SQL over only
published, verified, non-hidden rows. The average is integer basis points
(`5000 = 5.0`) derived from `ratingTotal / count`; the response also includes
the exact 1–5 distribution, avoiding persisted floating-point drift. Catalog,
category, featured-product cards, and product detail share this aggregate.

Create, update, and delete use the same route with `POST`, `PATCH`, and
`DELETE`, the existing `np-mb-csrf` double-submit cookie, and exact request
shapes. Unknown fields fail closed. Document update/delete releases removed
media after the collection transaction while shared references remain safe.

Admin → Health shows total/published/pending/hidden and malformed review
counts. The recent-review table excludes purchase and member identities.
Direct staff **Hide** removes a review from every public list and aggregate and
records the reason in the normal community audit trail. **Restore** uses the
existing member-document promotion contract, so a restored review is not
credited twice. Plugin Doctor validates the declared collection, Admin surface,
route, and typed action inventory; runtime health reports malformed hashes,
flags, ratings, and text bounds. Product and media foreign keys prevent
persisted orphan relationships.

`@nexpress/theme-storefront` remains independently usable. It imports no Shop
code and enhances reviews only through `[data-np-shop-reviews]`,
`[data-np-shop-review]`, `[data-np-shop-review-form]`, and the plugin's CSS
variables. Both bundled Shop skins render the complete fallback surface when
Storefront is absent.

## Forum-backed product inquiries

The default project reuses the Forum `forum-posts` collection for product
inquiries instead of creating a Shop-only inquiry table. Publish one Forum
board with key `product-questions`, audience `public` or `members`, and member
posting enabled. The product detail route then renders the board's newest ten
readable questions, a composer or sign-in link, private-author visibility,
waiting/answered state, and official staff answers. If the board or Forum is
absent, Shop simply omits this optional surface.

The integration is structural and build-time: Shop exports
`createShopProductInquiryContextSource()` but imports no Forum code, while
Forum returns a renderer adapter but imports no Shop code. The complete wiring
example and signed-context rules are in the
[Forum contextual Q&A guide](plugin-forum.md#contextual-qa-and-shop-product-inquiries).
Custom Shop paths or collection slugs must be passed to the source factory:

```ts
const productSource = createShopProductInquiryContextSource({
  basePath: "/catalog",
  productsCollection: "catalog-products",
});
```

The source resolves only currently published products and returns a local
product URL. Forum verifies that live result when issuing and consuming its
one-hour site-bound proof. Product deletion or unpublishing leaves historical
questions intact but marks their context unavailable. Forum Admin Health
reports unavailable targets without exposing question authors or product data.

## Public routes and discovery

| Route                            | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `/shop`                          | Published product catalog             |
| `/shop/categories/:categorySlug` | One published category                |
| `/shop/products/:productSlug`    | Product detail, variants, and gallery |
| `/shop/cart`                     | Current guest or member cart          |
| `/shop/checkout/:intentId`       | Owner-scoped checkout intent snapshot |
| `/shop/order-drafts/:draftId`    | Private customer and delivery draft   |
| `/shop/orders`                   | Bounded owner-scoped order history    |
| `/shop/orders/:orderId`          | Owner-scoped durable order detail     |

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

Shop exposes `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` at
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
insufficient stock, and mixed currencies do. Order creation quotes again;
payment initiation, delivery quotes, and additional-tax quotes retain their
own contracts, while the optional verified event boundary owns terminal
idempotency and reservation consumption. Quotes subtract every unexpired
pending-order reservation for the same product or canonical variant SKU.

### Promotions and coupons

The third Commerce collection, `shop-promotions`, defines automatic campaigns
and explicit coupon codes. Codes normalize to uppercase letters, digits,
dashes, or underscores and each cart stores at most five. `PUT /cart` replaces
the complete canonical code set under the same CSRF and `expectedRevision`
contract as line mutations.

A published promotion chooses a fixed minor-unit amount or percentage in basis
points (`100 = 1%`), one currency, an optional minimum subtotal, optional
percentage cap, an active time window, priority, and one target: whole order,
selected products, or selected categories. `0` means unlimited for global and
per-owner usage. Automatic promotions need no code; a code is required
otherwise. Invalid documents fail closed during author writes and runtime
normalization. The write hook forces promotion documents to private visibility,
so generic public collection reads and search never enumerate coupon codes.

Stackable promotions are evaluated in priority/id order against remaining
eligible line amounts. Every non-stackable promotion is evaluated alone; Shop
chooses the largest deterministic discount between that exclusive offer and
the full stack. Fixed discounts use proportional largest-remainder line
allocation. Percentage discounts floor each line result before applying an
optional cap. The immutable `np.shop-promotion-snapshot.v1` records
requested/rejected codes, applied campaign identity, total discount, and exact
per-line allocations. It participates in the cart fingerprint and is copied
through checkout intent, private draft, and durable order.

Order creation locks campaigns in canonical order and reserves global and
hashed-owner counters atomically. Payment success converts reservations to
redeemed uses. Payment failure, owner cancellation, payment timeout, and an
unpaid provider reversal release them. Counters contain no owner id or private
order data. Admin/Doctor health reports malformed counters and aggregate
reserved/redeemed usage. Partial return refunds subtract the proportional
frozen line discount; returning a full line receives its exact allocation.

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
  integer prices, gross subtotal, promotion snapshot, discount, net total,
  quantity, cart revision, and cart fingerprint;
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

## Private order draft and PII lifecycle

Shop exposes `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` at
`/api/plugins/shop/order-drafts`. The exact owner-facing envelope is
`np.shop-order-draft.v1`.

- `POST { idempotencyKey, checkoutIntentId }` accepts only an `open`,
  same-owner checkout intent. The canonical UUID idempotency key becomes the
  draft id. Repeating the same pair converges on one draft; reusing the key
  for another intent returns HTTP 409.
- A newly created draft is `collecting` and contains no PII.
- `PATCH { draftId, expectedRevision, customer, shipping }` atomically
  replaces the complete bounded customer/shipping pair. Shop first uses a
  configured external shipping adapter, otherwise evaluates published local
  shipping policies. With neither, it requests any configured tax quote and
  makes the draft `reviewable` with zero shipping amount. Fresh methods are
  persisted only after rechecking the same draft revision, so stale results
  cannot overwrite a newer address.
- A quoted draft becomes `shipping-selection-required`. `PUT { draftId,
expectedRevision, methodId }` accepts only one method from the current,
  unexpired quote, requests any configured tax quote outside the transaction,
  and freezes both PII-free snapshots. The exact invariant is
  `subtotalMinor - discountMinor + shippingMinor + taxMinor = totalMinor`. It then becomes
  `reviewable`.
- A `reviewable` draft means only that its fields and any configured delivery
  selection and tax quote satisfy the draft contract; it does not mean that
  payment, inventory, carrier booking, tax compliance, or legal policy is ready.
- Any cart, price, inventory, product, or option change makes the owner-facing
  projection `stale` and blocks another private-data save.
- `DELETE { draftId }` is idempotent and physically removes the owner-scoped
  row immediately. It returns only `{ deleted: true }`, including when no
  same-owner row remains.

Each owner may retain at most three unexpired drafts. Every draft expires
exactly 24 hours after creation. A read at or after expiry physically deletes
the row before returning HTTP 410. An hourly oldest-first task and the
confirmed Admin action permanently delete at most 500 expired
`order-draft:%` rows per site. Framework site deletion also removes every
site-scoped plugin-storage row.

The only private fields are:

- customer full name, canonical lowercase email, and phone;
- recipient name and phone;
- two-letter country code, postal code, address line, optional address detail,
  locality, and optional administrative area.

Names are limited to 120 characters, email to 254, phone to 32, address lines
to 200, locality/administrative area to 100, and postal code to 20. Unknown
fields fail closed. Validation diagnostics name fields but never echo their
values.

Private drafts use site-scoped `np_plugin_storage`, not collections. Their
values therefore stay out of public discovery, search indexes, revisions,
content transfer, document quotas, job payloads, and Shop logs. Owner API
responses are `private, no-store`. Admin and Doctor expose only contract
and non-PII operational metadata: Admin reports aggregate `collecting` /
`shipping-selection-required` / `reviewable` / `expired` / `invalid` counts,
plus the configured provider id and its last closed success/failure code.
Doctor inspects the declarative route, action, Admin, and scheduled-task
inventory without executing a PII read. Neither surface lists names, email
addresses, phone numbers, addresses, owner ids, or draft ids.

This is an application retention boundary, not a complete privacy-compliance
policy. Operators remain responsible for their lawful basis, privacy notice,
database access, encryption and backup-retention policy. Restoring a database
backup can restore data that existed when that backup was taken, so backup
expiry and deletion procedures must match the site's policy.

## Local shipping policies

The private `shop-shipping-policies` Commerce collection provides a built-in,
provider-neutral rate engine for common Korean delivery rules. A site may
publish up to 500 rules. Every rule belongs to one lowercase `methodCode` such
as `standard` or `express` and is either:

- a **base** rule: the highest-priority matching base becomes that method's
  label, delivery estimate, base amount, and optional free-shipping threshold;
- a **surcharge** rule: every matching surcharge with the same method code is
  added after the base is selected.

Rules can match all destinations, one ISO country, normalized postal-code
prefixes, or normalized administrative-area names. They can independently
match every cart, selected products, or selected categories, and may have an
active time window and priority. A free-shipping threshold can use either the
gross product subtotal or the subtotal after promotions. It waives only the
base amount; island, mountain, oversize, refrigerated, or other applicable
surcharges remain payable.

For a typical Korean setup, publish a `standard` KR base rule for 3,000 KRW
with a 50,000 KRW discounted-subtotal threshold, then add `standard` surcharge
rules for the site's maintained 제주/도서산간 postal prefixes. Postal codes are
normalized by removing spaces and hyphens before prefix matching. Do not treat
example prefixes as a permanent carrier coverage list: operators must maintain
their own current service areas and amounts.

Only method codes with a matching base are offered. If at least one local rule
is published but no base method serves the current cart and destination, Shop
fails closed with `shipping_unavailable`; it does not silently make shipping
free. With no published local rules and no external adapter, the prior
zero-shipping fallback remains. An external `shipping.adapter` always wins;
local rules remain stored but inactive, and Admin health warns about the
override rather than combining two pricing authorities.

Policy writes normalize and validate all scopes, amounts, estimates, dates,
relationships, and destination rows before persistence and force private
visibility. Generic public reads, discovery, and search therefore do not expose
the operational rule set. The runtime revalidates published documents, bounds
methods and components, produces a PII-free `shop-policy` quote id, and limits
its expiry to both the draft quote window and every applied rule's end time.
Admin exposes published count and closed policy health; surcharge-only method
codes are errors. Plugin Doctor verifies the collection plus matching typed
metric/status declarations without reading customer destinations.

## External shipping quote and delivery selection

A project that needs live carrier/rate-service quotes can register one
server-only adapter on the same `createShop()` factory used for collections
and routes. It replaces, rather than augments, the local policy engine:

```ts
import {
  NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
  createShop,
  type NpShopShippingAdapter,
} from "@nexpress/plugin-shop";

const shippingAdapter: NpShopShippingAdapter = {
  id: "my-shipping",
  async quoteShipping(request) {
    // request.destination is private and must never enter logs or provider
    // metadata. Query the carrier/rate service with server credentials.
    const quote = await quoteProvider(request);
    return {
      contract: NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
      quoteId: quote.id,
      methods: quote.methods.map((method) => ({
        id: method.id,
        label: method.label,
        amountMinor: method.amountMinor,
        estimatedDelivery: method.days
          ? { minimumDays: method.days.minimum, maximumDays: method.days.maximum }
          : null,
      })),
      expiresAt: quote.expiresAt,
    };
  },
};

const shop = createShop({ shipping: { adapter: shippingAdapter } });
```

The exact request includes draft id/revision, currency, item subtotal, unit
count, immutable checkout lines, the private destination, request time, and a
maximum allowed expiry. Adapter results contain one opaque quote id and 1–20
methods. Method ids and labels are bounded; amounts are non-negative safe
integers; optional minimum/maximum delivery estimates are 0–365 days; ids are
unique. A quote must expire after the request and no later than either one hour
or the private draft expiry. Unknown fields, duplicated methods, invalid money,
and out-of-window expiry fail closed as HTTP 503.

External adapter ids use the normal lowercase provider-id contract;
`shop-policy` is reserved for the built-in engine so adapter removal cannot
reinterpret an older external quote as a local one.

Shop never holds a database transaction open across the provider call. After a
successful selection, `np.shop-delivery-method.v1` copies only provider/quote/
method ids, label, amount, estimate, and quote timestamps into the durable
commercial order. It contains no destination or owner identity. The immutable
order stores `subtotalMinor`, `discountMinor`, `shippingMinor`, `taxMinor`, and
`totalMinor`;
payment preparation, verified event matching, and full refunds use
`totalMinor`.

The PII-free `shipping-health` row records only provider id, `ok | error`, the
closed `provider-error | invalid-result` code, and timestamps. Admin health can
expose that state without reading a destination; plugin doctor verifies the
declarative health action and route contracts without executing them. Carrier
booking, labels, pickup, tracking API integration, customs, and jurisdiction
rules remain separate from this quote/selection boundary.

## Additional-tax quote and frozen total

Tax quoting is disabled by default, preserving zero additional tax on top of
the product prices displayed by Shop. A project may register one server-only
adapter independently of shipping and payment:

```ts
import {
  NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
  createShop,
  type NpShopTaxAdapter,
} from "@nexpress/plugin-shop";

const taxAdapter: NpShopTaxAdapter = {
  id: "my-tax",
  async quoteTax(request) {
    // request.destination is private. Never log it or copy it into results.
    const quote = await quoteTaxProvider(request);
    return {
      contract: NP_SHOP_TAX_QUOTE_RESULT_CONTRACT,
      quoteId: quote.id,
      components: quote.lines.map((line) => ({
        id: line.id,
        label: line.label,
        amountMinor: line.amountMinor,
      })),
      amountMinor: quote.amountMinor,
      expiresAt: quote.expiresAt,
    };
  },
};

const shop = createShop({ tax: { adapter: taxAdapter } });
```

The request contains the draft id/revision, currency, immutable checkout
lines, item subtotal, selected shipping amount, pre-tax total, private
destination, optional PII-free delivery method, request time, and maximum
expiry. With no offered shipping method it runs after address `PATCH`; with
local or external shipping methods it runs only after one is selected. Provider calls do
not hold database transactions, and Shop rechecks the draft revision, cart,
delivery quote, selection, and expiry before persisting the result.

Results contain one bounded opaque quote id, 0–20 unique PII-free components,
their exact non-negative integer sum, and an expiry. Empty components are
valid only with zero added tax. A tax quote cannot outlive one hour, the
private draft, or its selected delivery quote. Unknown fields, invalid money,
component-total mismatch, and out-of-window expiry fail closed as HTTP 503.

`NpShopTaxAdapter` reports **only additional tax charged on top of displayed
product prices**. It does not reinterpret an already tax-inclusive catalog
price. The durable `np.shop-tax-quote.v1` snapshot contains no destination or
owner identity. Drafts and orders enforce
`subtotalMinor - discountMinor + shippingMinor + taxMinor = totalMinor`; payment preparation,
verified event matching, and full refunds continue to use that frozen
`totalMinor`.

The PII-free `tax-health` row stores only provider id, `ok | error`, the closed
`provider-error | invalid-result` code, and timestamps. Admin health reports
that state without reading private draft data, while plugin doctor validates
the declarative diagnostic surface. Calculation does not implement remittance,
filing, invoices or tax bills, exemption/nexus policy, customs or duties, or
jurisdiction-specific compliance.

## Durable pending order and PII separation

Shop exposes `GET`, `POST`, and `DELETE` at
`/api/plugins/shop/orders`. The exact owner-facing commercial envelope is
`np.shop-order.v1`; bounded history uses `np.shop-order-list.v1`.

- `POST { idempotencyKey, draftId, expectedRevision }` accepts only a
  same-owner `reviewable` draft whose cart revision and fingerprint still
  match a fresh live quote.
- The canonical idempotency UUID becomes the order id. Repeating the same
  order-id/draft pair converges on one row. Reusing it for another draft
  returns HTTP 409.
- Draft, cart, owner, order, and canonical product-id locks serialize the
  transition. A fresh quote subtracts existing active holds. Commercial
  snapshot creation, PII-free product/variant reservation rows,
  private-sidecar creation, pending-expiry marker creation, and source-draft
  deletion commit atomically.
- If another order consumed the final sellable unit first, creation returns
  HTTP 409 `order_inventory_unavailable`. Deterministic product locking keeps
  multi-line orders deadlock-safe and prevents two pending orders from holding
  the same final unit.
- Each owner may have at most three unexpired pending orders. A different key
  cannot bypass the limit under concurrent creation.
- `GET ?id=<uuid>` reads one same-owner order. `GET` without an id returns the
  newest 20 same-owner orders and an exact total.
- `DELETE { orderId, expectedRevision }` is revision-safe. Repeating a
  successful cancellation is idempotent.

The only browser-creatable status is `pending-payment`. It means that the
immutable product, option, item subtotal, selected delivery method and amount,
additional-tax snapshot and amount, exact total, currency, quantity, cart
revision, and cart fingerprint snapshot has a durable order reference. Tracked
lines have
`inventoryReservationStatus: "held"`; an untracked-only order uses
`"not-required"`. `inventoryReservationLineKeys` records exactly which
commercial lines require matching PII-free holds. This does **not** mean that
payment was initiated or authorized, and no on-hand quantity is decremented
yet. A verified `payment.succeeded` event moves only a live pending order to
`paid`, changes held inventory to `consumed`, and decrements every exact
product/variant quantity in the same transaction. A verified `payment.failed`
event moves it to terminal `payment-failed`, releases its holds, and deletes
its private sidecar. Owner or timeout cancellation remains `cancelled`.
Payment status remains independent from fulfillment. A successful payment
atomically creates `np.shop-fulfillment-storage.v1` in `awaiting` state; staff
can revision-safely move it to `processing` and then `shipped` without changing
the paid meaning. A completed full refund moves the order to `refunded`; an
unshipped fulfillment moves to `cancelled`, while an already shipped
fulfillment stays shipped and is never silently reopened.

Storage separates commercial and private values:

- `np.shop-order-storage.v1` contains the owner storage segment, source ids,
  commercial snapshot, status, revision, timestamps, and private-data state.
  It contains no name, email, phone, or address.
- `np.shop-order-private.v1` is a separate same-owner sidecar containing the
  customer and shipping pair copied from the draft while payment is pending.
- verified payment promotes that sidecar to `np.shop-order-private.v2`, with a
  fixed 30-day maximum fulfillment retention measured from payment resolution.
  The PII-free fulfillment row stores status, revision, bounded carrier,
  tracking, PII-free operator note, and timestamps.
- a global PII-free order lookup lets callbacks locate the otherwise
  owner-scoped commercial row; a maintenance marker indexes the next private
  deletion or timeout without duplicating private or commercial values.
- `np.shop-inventory-reservation.v1` rows contain only order ownership,
  product id, optional canonical variant SKU, quantity, and timestamps. They
  contain no customer or shipping values and expire with the pending order.
- `np.shop-payment-receipt.v1` stores only the canonical provider/event/order
  references, integer amount/currency, digest, outcome, order revision, and
  timestamps. Raw bytes, headers, signatures, names, email, phone, address,
  and owner segment are never retained.
- `np.shop-carrier-booking-storage.v1` stores one stable shipment UUID, order
  and fulfillment revision, provider id, closed status/error code, provider
  booking reference, carrier, tracking number, and timestamps. It never stores
  the destination, customer values, provider response bodies, credentials, or
  owner segment.
- `np.shop-fulfillment-parcels-storage.v1` stores one revision-safe package
  snapshot per order: bounded lowercase parcel ids, integer millimetre
  dimensions, integer gram weights, exact order-line quantity allocations,
  and an optional locking shipment UUID. It contains no customer, destination,
  product name, provider response, credential, or owner segment.
- `np.shop-refund-storage.v1` stores one stable refund UUID, exact payment and
  amount identity, PII-free reason, provider result reference, local
  fulfillment/inventory outcomes, and timestamps. It never stores raw provider
  bodies, credentials, customer values, addresses, or owner segments.
- `np.shop-return-storage.v1` stores one return UUID per order, its owner
  segment, exact order revision and item quantities, a closed PII-free reason,
  bounded optional customer detail/operator note, revision-safe status,
  inventory outcome, and timestamps. Owner projection omits the owner segment
  and operator note. Doctor/health withholds both free-text fields as well as
  every shipping address and payment/provider value.

Pending orders expire after 24 hours. Owner cancellation, lazy read after that
deadline, and the hourly maintenance job all atomically change the durable
order to `cancelled`, mark private data `redacted`, and physically delete both
the private sidecar and maintenance marker. They also release every matching
inventory row and change the order reservation state to `released`. Paid
orders retain their promoted private sidecar until shipment or at most 30 days
after verified payment. Marking a fulfillment shipped atomically stores
carrier/tracking, redacts both order and fulfillment projections, and
physically deletes the private sidecar. Owner reads and hourly maintenance
enforce the same maximum deadline without changing the paid state. The
commercial snapshot, matching payment receipts, refund record, and physical
return record remain for 365 days and are then physically purged. Each
scheduled or confirmed Admin pass
cancels at most 500 due orders and purges at most 500 expired commercial
snapshots, oldest first. Site deletion remains the final tenant-wide deletion
boundary.

### Order updates and delivery outbox

Every successful order creation/cancellation, payment result, fulfillment
processing/shipment, delivered carrier event, physical-return transition, and
full or return-linked partial refund atomically stages one
`np.shop-order-notification.v1` event in the same transaction as the state
change. The owner order API returns an exact PII-free timeline, and both
bundled skins render it through `[data-np-shop-order-notifications]`.

The site-scoped `process-order-notifications` task leases at most 100 due
events each minute. Member orders receive the registered
`shop.order-update` inbox kind subject to the member's normal notification
preference. Transactional email is independent of that inbox preference:
guest/member email copied from retained order data lives only in a separate
`np.shop-order-notification-private.v1` sidecar for at most 24 hours and is
physically deleted after a successful send. The built-in noop email adapter is
treated as a suppressed channel and is never called, so recipient PII is not
printed to development logs. Once normal order PII is redacted,
active members can use their current account email; a guest event without a
live private sidecar remains timeline-only. Any transition that redacts normal
order PII (cancellation, payment failure, shipment, or refund) also deletes all
still-pending notification recipient sidecars for that order immediately.

Delivery failures use fixed bounded backoff and stop after five attempts in
the PII-free `attention` state. Admin Health exposes counts, stale leases,
malformed samples, and expired private rows without exposing a recipient, and
offers bounded reconcile and explicit retry actions. The email adapter has no
provider receipt/idempotency field, so processing is at-least-once: a worker
crash after provider acceptance but before the local completion write can
duplicate an email. Each message includes the stable event UUID for support
reconciliation and uses the validated `SITE_URL` origin when configured;
Admin warns about possible duplication before retrying an attention event.
Commercial purge deletes timeline, outbox, and private rows.

Owner responses are `private, no-store`. Owner history can include private
details only while their matching sidecar exists; failed/cancelled/refunded/shipped
orders always return `customer: null` and `shipping: null`. Admin exposes
aggregate counts and bounded commercial/fulfillment tables. Normal rows never
read or return names, email addresses, phone numbers, addresses, or owner
segments. Explicit shipping-data access requires a direct staff action,
matches the current fulfillment revision, and commits an append-only audit row
before private values are returned. Inter-plugin dispatch cannot invoke these
staff operations.
Doctor inspects only the declarative API—including the conditional exact-raw
webhook—action, table, page-route, and scheduled-task inventory.

Guest ownership remains bound to the signed `np-shop-cart` browser cookie.
That cookie uses a rolling 30-day lifetime, so a guest who clears it or does
not revisit before it expires cannot recover the otherwise-retained commercial
snapshot. Member ownership remains tied to the authenticated member id.

The 24-hour pending-private, 30-day fulfillment-private, and 365-day commercial
defaults are application cleanup guarantees, not jurisdiction-specific
accounting or privacy advice. Backup retention can outlive physical row
deletion and must be governed separately.

## Verified payment-event and adjustment contracts

Payment processing is disabled in the default `shopPlugin`. A custom project
enables `/api/plugins/shop/payments/webhook` by passing one server-only adapter
to the same `createShop()` call used for its collections and plugin:

```ts
import {
  NP_SHOP_PAYMENT_EVENT_CONTRACT,
  createShop,
  type NpShopPaymentAdapter,
} from "@nexpress/plugin-shop";

const adapter: NpShopPaymentAdapter = {
  id: "my-provider",
  async verifyWebhook({ rawBody, headers, receivedAt }) {
    // Authenticate the exact bytes/signature, or query the provider with
    // server credentials and compare its authoritative payment projection.
    // Return null for unverifiable input; never project unverified fields.
    const verified = await verifyProviderCallback(rawBody, headers, receivedAt);
    return verified
      ? {
          contract: NP_SHOP_PAYMENT_EVENT_CONTRACT,
          eventId: verified.eventId,
          type: verified.succeeded ? "payment.succeeded" : "payment.failed",
          orderId: verified.orderId,
          paymentReference: verified.paymentReference,
          currency: verified.currency,
          amountMinor: verified.amountMinor,
          signedAt: verified.signedAt,
        }
      : null;
  },
};

const shop = createShop({ payment: { adapter } });
```

The adapter owns the provider endpoint format, signature or authenticated-query
algorithm, constant-time comparison where applicable, credentials and
rotation, and the mapping from provider fields to `np.shop-payment-event.v1`.
Its event and payment references
must be opaque non-PII identifiers using only letters, numbers, `.`, `_`, `:`,
or `-`. The framework first bounds the
raw body to 1 MiB. Shop then requires an exact canonical event, accepts its
provider-authenticated effective timestamp at most five minutes old (with 30
seconds of future clock tolerance), requires exact order currency and integer
minor-unit amount, and serializes each provider/event id. An adapter that
authoritatively re-queries a provider without signed webhook timestamps uses
the server receive time after the query succeeds.

The first exact event writes one PII-free receipt. Repeating the same
provider/event id and canonical digest returns that receipt without another
stock or order mutation. Provider redelivery may carry a fresh signed
timestamp; that transport timestamp is replay-checked but deliberately omitted
from the semantic event digest. Reusing an event id for different commercial
content returns HTTP 409. A verified event for an unknown, commercially expired, or
mismatched-amount order also returns HTTP 409. An event arriving after the
24-hour pending deadline but before commercial purge cancels the order and is
recorded as `ignored-terminal`; any event for another terminal order is also
recorded without reviving or overwriting it. Operators must
reconcile such external effects with the provider. `payment.failed` is
terminal in v1, so adapters must project it only for a definitive failure; a
retry requires a new order.

The same authenticated callback may instead return one exact cumulative
`np.shop-payment-adjustment-event.v1` when the provider proves that captured
money was cancelled after payment. The event carries the immutable order and
payment identity, original and remaining minor-unit amounts, and 1–100 unique,
canonically ordered completed cancellations. Every cancellation has only an
opaque reference, positive amount, and UTC timestamp. Their exact sum must be
`originalAmountMinor - remainingAmountMinor`; the snapshot must reverse a
positive amount and may never regress or change a retained cancellation.

Shop serializes each provider/event id and stores both an idempotent PII-free
receipt and one latest order adjustment state. Redelivery of the same semantic
snapshot is a no-op even when its transport timestamp changes. A snapshot that
exactly equals the amount and cancellation reference of an existing durable
full refund or received-return partial refund is recorded as `matched-refund`;
Shop does not repeat order, fulfillment, return, or inventory transitions.

If no local refund exists, only a single cancellation that reverses the entire
captured payment can be compensated automatically. For a paid unshipped order,
Shop atomically creates the normal owner-visible full-refund projection,
changes the order to `refunded`, cancels fulfillment, deletes retained private
data, and attempts the same all-or-none tracked-inventory restoration used by
staff full refunds. A shipped order retains shipped fulfillment and inventory.
The transition has a system audit row and closed compensation outcomes.
An adjustment received while the local order is still `pending-payment` closes
that unpaid order as `payment-failed` and releases exact holds because Shop
never consumed on-hand inventory locally.

Unknown partial reversals, multiple cancellations without matching local
refund history, conflicting refund state, and later snapshots extending an
already manual adjustment remain `manual-review`. They do not invent item,
shipping, or tax allocation and do not restore inventory. While manual review
exists, fulfillment changes and new full/partial refunds fail closed. Admin
exposes aggregate count, bounded PII-free recent receipts, and error/warning
health; Doctor verifies those declarative metric/status/table actions. Order
cleanup removes adjustment state and receipts with the commercial snapshot.

This boundary proves callback authentication and local cancellation
convergence; it does not prove settlement, initiate payment, model
authorization/capture, allocate arbitrary partial reversals, resolve disputes
or chargebacks, or book a carrier shipment.

## Carrier shipment booking and local completion

Carrier booking is disabled in the default `shopPlugin`; staff can continue to
enter a bounded carrier and tracking number manually. A custom project may
instead pass one server-only adapter to the same `createShop()` factory:

```ts
import {
  NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT,
  NP_SHOP_CARRIER_LABEL_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
  NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
  NP_SHOP_TRACKING_POLL_RESULT_CONTRACT,
  NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
  createShop,
  type NpShopCarrierAdapter,
} from "@nexpress/plugin-shop";

const carrier: NpShopCarrierAdapter = {
  id: "my-carrier",
  async bookShipment(request) {
    // Use request.shipmentId as the provider idempotency key. Never log the
    // request destination or copy it into errors or the returned result.
    const booking = await bookProviderShipment(request);
    return {
      contract: NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: booking.reference,
      carrier: booking.carrier,
      trackingNumber: booking.trackingNumber,
      bookedAt: booking.bookedAt,
    };
  },
  async bookShipmentWithParcels(request) {
    // This additive v2 path receives the same private destination plus one
    // locked, PII-free parcelRevision/parcels snapshot. Use shipmentId as the
    // provider idempotency key exactly as in bookShipment.
    const booking = await bookProviderParcelShipment(request);
    return {
      contract: NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: booking.reference,
      carrier: booking.carrier,
      trackingNumber: booking.trackingNumber,
      bookedAt: booking.bookedAt,
    };
  },
  async verifyTrackingWebhook(input) {
    // Authenticate input.rawBody with the provider signature or a
    // server-authenticated provider query. Never trust parsed fields first.
    const providerEvent = await verifyProviderTracking(input);
    if (!providerEvent) return null;
    return {
      contract: "np.shop-tracking-event.v1",
      eventId: providerEvent.id,
      shipmentId: providerEvent.shipmentId,
      orderId: providerEvent.orderId,
      bookingReference: providerEvent.bookingReference,
      trackingNumber: providerEvent.trackingNumber,
      status: providerEvent.status,
      occurredAt: providerEvent.occurredAt,
      signedAt: providerEvent.signedAt,
    };
  },
  async readTracking(request) {
    // Apply a provider timeout. This request is PII-free and already contains
    // the exact durable provider references; do not load private order data.
    const providerEvent = await readProviderTracking(request);
    const checkedAt = new Date().toISOString();
    return {
      contract: NP_SHOP_TRACKING_POLL_RESULT_CONTRACT,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      checkedAt,
      event: providerEvent
        ? {
            contract: "np.shop-tracking-event.v1",
            eventId: providerEvent.id,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            bookingReference: request.bookingReference,
            trackingNumber: request.trackingNumber,
            status: providerEvent.status,
            occurredAt: providerEvent.occurredAt,
            signedAt: checkedAt,
          }
        : null,
    };
  },
  async readShippingLabel(request) {
    // request contains only durable provider references. Apply a provider
    // timeout and return transient bytes; never persist or log label content.
    const label = await readProviderShippingLabel(request.bookingReference);
    return {
      contract: NP_SHOP_CARRIER_LABEL_RESULT_CONTRACT,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      format: "pdf",
      content: label.bytes,
      retrievedAt: new Date().toISOString(),
    };
  },
  async acquireShippingLabel(request) {
    // acquisitionId is stable across retries. For regeneration the provider
    // must atomically replace replacesLabelReference rather than create two
    // simultaneously current labels. Return no bytes or URL here.
    const label = await acquireProviderShippingLabel({
      idempotencyKey: request.acquisitionId,
      bookingReference: request.bookingReference,
      replacesLabelReference: request.replacesLabelReference,
    });
    return {
      contract: NP_SHOP_CARRIER_LABEL_ACQUISITION_RESULT_CONTRACT,
      acquisitionId: request.acquisitionId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      generation: request.generation,
      operation: request.operation,
      labelReference: label.reference,
      acquiredAt: new Date().toISOString(),
    };
  },
  async schedulePickup(request) {
    // pickupId is the provider idempotency key. The request contains only
    // durable references, an opaque origin token, a UTC window, and PII-free
    // package dimensions/weights.
    const pickup = await scheduleProviderPickup(request);
    return {
      contract: NP_SHOP_CARRIER_PICKUP_RESULT_CONTRACT,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      pickupReference: pickup.reference,
      readyAt: request.readyAt,
      closeAt: request.closeAt,
      scheduledAt: pickup.scheduledAt,
    };
  },
  async listPickupWindows(request) {
    // This exact booked-shipment read contains only the opaque origin and
    // PII-free parcel summaries. Return ordered UTC windows valid for at most
    // the requested one-hour lifetime.
    const availability = await listProviderPickupWindows(request);
    return {
      contract: NP_SHOP_CARRIER_PICKUP_AVAILABILITY_RESULT_CONTRACT,
      availabilityId: request.availabilityId,
      windows: availability.windows.map((window) => ({
        id: window.id,
        readyAt: window.readyAt,
        closeAt: window.closeAt,
      })),
      expiresAt: availability.expiresAt,
    };
  },
  async cancelPickup(request) {
    // cancellationId is a separate stable provider idempotency key.
    const cancellation = await cancelProviderPickup(request);
    return {
      contract: NP_SHOP_CARRIER_PICKUP_CANCEL_RESULT_CONTRACT,
      cancellationId: request.cancellationId,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      cancelledAt: cancellation.cancelledAt,
    };
  },
};

const shop = createShop({
  carrier: {
    adapter: carrier,
    // Provider-owned server-side token. Never put an address or PII here.
    pickupLocationReference: "warehouse-seoul-1",
  },
});
```

The direct-staff action accepts only an unchanged `processing` fulfillment.
Shop first writes one PII-free `pending` booking and audit event, then calls
the adapter outside the database transaction with exact immutable order lines,
the selected delivery snapshot, and the retained private destination. Every
retry reuses the same shipment UUID. Adapters must use that UUID as the
provider idempotency key and must keep destination PII out of logs, thrown
errors, and results.

An exact matching provider result becomes `provider-confirmed` before local
completion. The final transaction rechecks the fulfillment revision, marks it
`shipped`, stores carrier/tracking, redacts the order and fulfillment, deletes
the private sidecar, completes the PII-free booking, and appends the normal
shipment audit. If the final database transaction fails unexpectedly, the
provider-confirmed row remains resumable without a second provider call. A
malformed/conflicting result, definitive closed provider rejection, or known
local state conflict moves the row to `manual-review`; retryable ambiguity
remains `pending`. Only lowercase closed error codes are persisted, never
provider messages.

The PII-free booking metric, health, bounded table, and resume action remain
declared even when no adapter is configured, so removing a provider cannot hide
an unresolved durable row. When configured, the adapter-backed action replaces
the manual shipped action in the fulfillment table. A `provider-confirmed` row
can finish local completion after adapter removal; a `pending` row requires its
original provider.

### Fulfillment parcel snapshot

Processing fulfillments expose an audited direct-staff **Save parcel
snapshot** action. Its bounded JSON array uses this exact shape:

```json
[
  {
    "id": "parcel-1",
    "lengthMm": 300,
    "widthMm": 200,
    "heightMm": 100,
    "weightGrams": 1500,
    "items": [{ "lineKey": "<immutable-order-line-key>", "quantity": 1 }]
  }
]
```

One snapshot contains 1–20 parcels and at most 100 allocations. Dimensions
are positive integer millimetres up to 3,000; weight is positive integer grams
up to 500,000. Parcel ids are unique lowercase segments. Every immutable order
line must be present, unknown lines fail, and quantities summed across parcels
must equal the order exactly. The action checks both the fulfillment and parcel
revision, so concurrent edits fail instead of overwriting one another.

The standalone snapshot is useful for packing operations even with manual or
v1 carrier completion. When `bookShipmentWithParcels` is configured, a new
carrier booking additionally requires a current snapshot. The transaction that
creates the durable shipment UUID locks the snapshot to that UUID before any
provider call. Retries reuse the same UUID, parcel revision, dimensions,
weights, allocations, immutable order lines, and retained destination. Once
locked it cannot be edited; old v1 bookings remain on `bookShipment` and are
not reinterpreted as v2.

Admin exposes PII-free parcel counts, bounded rows, and health for malformed,
orphaned, allocation-mismatched, and shipment-lock-mismatched snapshots.
Rows distinguish an editable `prepared` snapshot from a v1-booking `frozen`,
terminal manual `archived`, or v2 shipment-`locked` snapshot.
Doctor verifies the matching declarative metric/status/table/action kinds.
Commercial expiry removes the parcel row with the fulfillment and carrier
state. The manual contract records prepared packages without calculating them;
the optional proposal adapter below can suggest the same canonical snapshot
without changing carrier, warehouse, or material state.

### Packaging proposal adapter

Packaging proposals are an independent build-time capability. They do not
require a carrier adapter, and enabling a carrier does not enable proposals. A
project registers one server-only adapter on the same `createShop()` result:

```ts
import {
  NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT,
  createShop,
  type NpShopPackagingAdapter,
} from "@nexpress/plugin-shop";

const packaging: NpShopPackagingAdapter = {
  id: "my-packaging-catalog",
  async proposeParcels(request) {
    // This must be a read-only calculation. Use proposalId only to correlate
    // this call; do not reserve boxes, create WMS work, or charge a rate.
    const proposal = await calculateParcelsFromProviderCatalog(request.lines);
    return {
      contract: NP_SHOP_PACKAGING_PROPOSAL_RESULT_CONTRACT,
      proposalId: request.proposalId,
      orderId: request.orderId,
      target: request.target,
      exchangeId: request.exchangeId,
      sourceRevision: request.sourceRevision,
      expectedParcelRevision: request.expectedParcelRevision,
      parcels: proposal.parcels,
      proposedAt: new Date().toISOString(),
      expiresAt: request.expiresAt,
    };
  },
};

const shop = createShop({ packaging: { adapter: packaging } });
```

`proposeParcels` is deliberately read-only and side-effect-free. Shop may make
more than one concurrent calculation for one row; parcel compare-and-swap
allows only one result to be saved. The fresh proposal UUID is a trace id, not
a durable provider-effect idempotency key. A provider that reserves packaging
material, creates warehouse work, or charges for a selection needs a separate
durable prepare/confirm/reconcile contract.

The exact `np.shop-packaging-proposal-request.v1` contains the proposal and
order ids, an `outbound | replacement` target, a replacement exchange id only
for that target, the current fulfillment or exchange revision, the expected
parcel revision, and 1–100 immutable lines. Each line contains only its line
key, product id, product slug, optional variant SKU, and quantity. Customer and
member identity, product names, prices, addresses, delivery methods, private
order data, and operator notes are excluded. The request expires exactly 60
seconds after `requestedAt`.

The provider returns `np.shop-packaging-proposal-result.v1`, echoes every
request identity and revision plus that exact expiry, and supplies the normal
bounded parcel array with a fresh `proposedAt`. Shop rejects expired or
future-dated results, extra fields, malformed dimensions or weights, unknown
lines, and any allocation that does not cover every requested line and exact
quantity. Shop stops awaiting the call at the request expiry; adapters should
also apply a transport timeout so their own network work is cancelled. No
provider label, explanatory text, URL, raw payload, or credential
can enter the result, parcel snapshot, audit, or Admin health surface.

Shop performs a short preflight transaction to capture the current processing
outbound fulfillment or awaiting same-item replacement and its unlocked parcel
revision. Provider I/O runs outside every database transaction. A second short
transaction then rechecks the source and parcel revisions, exact allocations,
commercial relationship, carrier-booking absence, and shipment lock before
writing the next ordinary parcel revision and one PII-free audit. A concurrent
manual edit, proposal, fulfillment/exchange transition, or carrier booking wins
normally and causes the stale provider result to be discarded rather than
overwriting newer state.

The saved result is the same provider-neutral parcel snapshot as a manual
entry. Staff can replace it through the manual JSON action until carrier
booking locks it; proposal controls do not replace that fallback when the
configured provider is unavailable. Admin health keeps independent latest
`outbound` and `replacement` receipts with only provider id, closed
`provider-error | invalid-result` state, and attempt time; diagnostics perform
no provider reads and take no order locks.

Shop has no immutable product dimensions or weights in the order contract. The
adapter therefore maps the exact product id/slug and optional SKU to its own
physical catalog and owns the quality of the recommendation. NexPress validates
the bounded shape and allocation, but does not prove that items fit, mutate a
WMS, book a carrier, calculate shipping rates, read an address, buy or render a
label, reserve packaging material, or claim that a parcel was physically
packed.

`readShippingLabel` is another independent additive capability. When present,
completed rows in the outbound carrier-booking table and completed or shipped
provider-booked rows in the exchange table expose a label download action.
The linked `GET /api/plugins/shop/carrier/shipping-label` route requires a
staff session and accepts only the exact order/shipment query projected from
that row. Shop rechecks the current site, exactly one completed booking,
shipment id, configured provider, and—when it is a replacement—the matching
exchange identity, state, revision, carrier, and tracking tuple. It appends a
direct-staff audit event, then calls the provider outside the database transaction with the PII-free
`np.shop-carrier-label-request.v1` tuple. It contains only shipment/order ids,
booking reference, carrier, tracking number, and request time.

The provider returns `np.shop-carrier-label-result.v1` with matching ids, a
fresh retrieval timestamp, one closed `pdf | png | zpl` format, and 1 byte–5
MiB of `Uint8Array` content. Shop delivers those bytes through the framework's
bounded binary route response with attachment, private/no-store, and nosniff
headers only after the full outbound or replacement relationship is rechecked and successful
delivery is audited with format and byte count. Label bytes and URLs are never stored, projected through Admin JSON,
logged, or placed in public media. On its own this capability reads a label
that the existing provider booking already owns. It remains valid without the
separate acquisition method below.

`acquireShippingLabel` is an additive capability that requires
`readShippingLabel`. A read-only adapter remains valid, while an acquisition
method without the transient read method fails during `createShop()` so an
operator cannot purchase an inaccessible label. Completed outbound and
replacement bookings with no verified tracking state expose **Purchase
label**. Shop stores one shipment-keyed
`np.shop-carrier-label-acquisition-storage.v1` row before provider I/O. It
contains only the exact booking/exchange tuple, stable acquisition UUID,
`purchase` operation, generation 1, provider id, and PII-free lifecycle data.

The exact `np.shop-carrier-label-acquisition-request.v1` uses the acquisition
UUID as provider idempotency and contains no destination, owner, line item,
label bytes, or URL. A matching result returns one opaque bounded
`labelReference` and fresh confirmation time. Shop persists
`provider-confirmed` before local `completed`, so retries reuse the same UUID
and the provider must return the exact same result for that UUID. Concurrent
identical results converge as duplicate success; an inconsistent result enters
manual review. Provider-confirmed retries perform local completion only. Retryable
ambiguity remains `pending`; closed rejection, malformed results, or
post-provider local conflict become PII-free `manual-review`.

After completion the same action creates generation N+1 with operation
`regenerate` and the current opaque reference as `replacesLabelReference`.
The provider contract requires an atomic replacement: the result identifies
the new current label and must not leave two labels current under this
contract. Shop retains only the latest generation snapshot; audit events retain
the purchase/regeneration trail without label bytes. Any verified outbound or
replacement tracking state blocks a new purchase, regeneration, or resume.
When acquisition is configured, the binary route also requires a completed
acquisition and rechecks the same generation, revision, and opaque reference
after provider I/O before delivering bytes. Read-only adapters retain their
existing completed-booking behavior.

Admin exposes a metric, health status, newest-50 acquisition table, actions on
both booking surfaces, and an independent reconciliation action on the
acquisition table. Doctor uses the same declarative inventory and checks
malformed/orphan/provider/booking mismatches even after the adapter is removed.
Commercial order cleanup deletes label acquisition state. Provider billing,
paper size/layout, label rendering, void/refund policy, and provider-specific
protocols remain outside this contract; binary delivery still uses the
independent bounded read route above.

### Carrier pickup scheduling

`schedulePickup` and `cancelPickup` form one paired additive capability. Shop
rejects a partial pair and also requires `bookShipmentWithParcels` and/or
`bookExchangeShipmentWithParcels` plus one build-time
`pickupLocationReference`. That reference is a provider-owned opaque
warehouse/account token, not an address: it is retained server-side and must
contain no customer, staff, or location PII that NexPress would need to
interpret. Existing carrier adapters remain valid without these methods.

`listPickupWindows` is an independent additive read on top of that complete
pair. When present, Shop removes arbitrary UTC inputs from the outbound and
replacement booking tables. A direct staff action sends one exact
`np.shop-carrier-pickup-availability-request.v1` outside the transaction with a
fresh trace UUID, completed booking references, the opaque origin token, parcel
revision, and the same at-most-20 PII-free package summaries. The request also
bounds the result to one hour and the existing 14-day scheduling horizon.

The provider returns `np.shop-carrier-pickup-availability-result.v1` with 1–20
uniquely identified, ordered, non-overlapping UTC windows. Each window remains
15 minutes–12 hours long. Result expiry must
be after the request, no later than the requested one-hour maximum, and before
every offered window. Shop rechecks booking, tracking, provider, location,
parcel revision, package summaries, and commercial retention after provider
I/O, then stores one short-lived one-way booking fingerprint and
`np.shop-carrier-pickup-availability-storage.v1` snapshot.

Admin lists each offered window without addresses. Selection sends only the
snapshot UUID/revision and provider window id; clients cannot replace its UTC
bounds. Shop rechecks the full snapshot before passing those unchanged bounds
to the existing `schedulePickup` v1 method. Creating the durable pickup intent
consumes the availability even when a retryable provider ambiguity must later
be resumed from the pickup table. Expired rows use bounded oldest-first hourly
cleanup. Metric, health, table, provider-health receipt, Doctor inventory,
audit, and adapter-removal diagnostics remain PII-free.

A completed outbound or same-item replacement parcel-aware booking with no
verified tracking state exposes **Schedule pickup**. The direct-staff action
accepts one selected provider window, or when `listPickupWindows` is omitted,
one canonical UTC `readyAt`/`closeAt` window: 15 minutes–12 hours long, live,
and starting within 14 days. Shop locks the completed booking and its
already shipment-locked parcel snapshot, writes
`np.shop-carrier-pickup-storage.v2` with a stable
pickup UUID and an explicit `outbound | replacement` target, then calls the
provider outside the transaction. Storage is keyed by shipment UUID, so one
order's outbound and replacement pickups remain independent. The exact
`np.shop-carrier-pickup-request.v1` includes booking/carrier/tracking
references, the opaque origin token, parcel revision, and at most 20 package
summaries with id, integer millimetre dimensions, and gram weight. It excludes
allocations, products, owners, customer data, and shipping addresses.

The provider must treat `pickupId` as its idempotency key and return an exact
matching window and fresh confirmation in `np.shop-carrier-pickup-result.v1`.
Shop persists `provider-confirmed` before the final local `scheduled` state.
Retries preserve the same UUID and package snapshot; a confirmed retry performs
only local completion. Retryable provider ambiguity stays `pending`, while
malformed/contradictory results, definitive closed rejection, or a post-provider
local conflict become `manual-review` with a closed PII-free error code.

Cancellation uses a separately persisted stable `cancellationId` and exact
`np.shop-carrier-pickup-cancel-request.v1` / result pair. It moves through
`cancel-pending` and `cancel-confirmed` before `cancelled`, so provider success
survives a failed local completion without a second external cancellation.
Scheduling and cancellation both fail closed once any verified tracking state
exists; Shop does not claim that an in-transit parcel remains at the pickup
origin. Cancellation after carrier movement is provider/customer-service
policy outside this contract.

A replacement pickup additionally locks the exact completed exchange booking,
exchange identity, processing-or-shipped commercial state, and replacement
parcel snapshot. The provider still receives the unchanged generic v1 pickup
request because the shipment UUID is sufficient for fulfillment; `exchangeId`
remains Shop-owned diagnostic state. Provider cancellation and automatic
replacement inventory restoration are blocked until any durable replacement
pickup has reached `cancelled`, and that relationship is rechecked again after
provider cancellation before local compensation.

The baseline PII-free pickup metric, health widget, newest-50 table, and Doctor
inventory stay declared after adapter removal so pending durable effects remain
visible. With the adapter enabled, the table adds revision-safe resume and
cancel actions and labels outbound versus replacement shipments. Health samples
malformed rows, missing bookings/parcels, provider mismatch, exact parcel
mismatch, reconciliation state, and manual review. Commercial order purge
removes pickup state with its booking. This contract does not buy labels,
create recurring pickups, schedule return pickups, expose a general provider
calendar outside exact booked shipments, store addresses, calculate pickup
charges, or implement provider-specific pickup protocols.

### Approved-return logistics and transient labels

`createReturnShipment` and `cancelReturnShipment` form a separate paired
carrier capability. `createShop()` rejects a partial pair and requires one
server-only `returnLocationReference`: an opaque provider-owned warehouse or
returns-account token, never a postal address. `readReturnLabel` is an optional
third method and cannot be enabled without the pair. Existing carrier adapters
remain valid when all three are omitted.

After staff approves an item return, its owner may choose `dropoff` or
`pickup`, enter one exact return-origin address, and optionally provide a live
15-minute–12-hour UTC pickup window starting within 14 days. Shop locks the
owner/order/return and completed outbound carrier booking, writes a stable
PII-free `np.shop-return-logistics-storage.v1` intent, and places the origin in
a separate `np.shop-return-logistics-private.v1` sidecar. The sidecar expires
within 24 hours; an hourly bounded cleanup permanently deletes expired origins
and closes their pending intents for manual review. Shop never writes the
origin to Admin rows, public order JSON, provider results, audit payloads,
framework logs, or commercial cleanup diagnostics; carrier implementations
must likewise avoid logging the private request.

The provider call runs outside the database transaction. Its exact
`np.shop-return-logistics-request.v1` uses the logistics UUID as the
idempotency key and contains the approved immutable item subset, original
shipment/booking ids, opaque return destination, short-lived origin, mode, and
optional pickup window. A matching result supplies one return reference,
carrier, tracking number, confirmed window, and fresh timestamp. Shop persists
`provider-confirmed`, deletes the private sidecar, and only then advances the
owner-visible state to `active`. Retryable ambiguity keeps the same `pending`
intent and private sidecar for retry; definitive closed failure or malformed
state becomes operator-visible instead of claiming success.

Owners resume a retryable `pending` intent through its stable creation UUID;
an ambiguous provider result is never discarded through local-only cancellation.
They may cancel an active provider shipment through a separate stable
cancellation UUID and the `cancel-pending` → `cancel-confirmed` → `cancelled`
sequence. Provider success
therefore survives local completion failure without a second external effect.
Cancellation does not cancel the physical return, issue a refund, restore
inventory, or make a jurisdiction decision. Staff receipt remains the sole
operation that completes the existing return and performs all-or-none tracked
inventory restoration.

When `readReturnLabel` exists, an active owner-scoped return exposes a private
download link. Shop rechecks browser/member ownership and the exact active
shipment tuple before requesting 1 byte–5 MiB of `pdf | png | zpl` bytes. The
binary response is attachment/no-store/nosniff; label bytes and URLs are never
persisted or exposed through Admin JSON. Admin instead receives PII-free
metric, health, and bounded rows covering reconciliation, provider mismatch,
orphans, malformed values, and private-sidecar lifetime. Doctor validates the
same declarative metric/status/table and API inventory.

Once the first verified reverse-tracking event exists, return-shipment
cancellation closes: local cancellation can no longer safely claim that the
physical parcel stopped moving.

### Return-postage quote and selection

Carrier adapters that already implement paired return logistics may add
`quoteReturnShipping` and `createQuotedReturnShipment` together. The pair is
additive: omitting both preserves the existing v1 return-creation flow, while
providing only one fails during `createShop()` configuration. Quoting also
requires the same completed outbound booking, approved physical return, and
opaque server-only `returnLocationReference` as return logistics.

```ts
const carrier: NpShopCarrierAdapter = {
  // bookShipment, createReturnShipment, cancelReturnShipment omitted here
  async quoteReturnShipping(request) {
    const quote = await quoteProviderReturn({
      quoteId: request.quoteId,
      origin: request.origin,
      destinationReference: "configured-server-side",
      mode: request.mode,
      items: request.items,
    });
    return {
      contract: "np.shop-return-postage-quote-result.v1",
      quoteId: request.quoteId,
      methods: quote.methods.map((method) => ({
        id: method.id,
        label: method.label,
        amountMinor: method.amountMinor,
        estimatedTransit: method.estimatedTransit,
      })),
      expiresAt: quote.expiresAt,
    };
  },
  async createQuotedReturnShipment(request) {
    return createProviderReturn({
      ...request,
      selectedPostage: request.postageMethod,
    });
  },
};
```

`np.shop-return-postage-quote-request.v1` contains one fresh quote UUID, the
approved immutable line subset, outbound shipment/booking tuple, order
currency, drop-off or pickup mode, optional window, and exact private origin.
The provider call occurs outside a database transaction. Its exact result has
1–20 unique methods, integer minor-unit amounts in the same order currency,
optional bounded transit days, and an expiry no later than one hour after the
request. Provider results cannot echo an address, customer identity, opaque
destination token, URL, or arbitrary metadata.

Shop re-locks the order, return, and outbound booking after provider I/O, then
stores `np.shop-return-postage-storage.v1` separately from the private origin.
The public quote is PII-free. Its sidecar expires with the quote within one
hour, and bounded scheduled cleanup deletes both rows. Owner selection is an
exact quote-revision compare-and-swap and freezes
`np.shop-return-postage-method.v1`: provider, quote/method ids, label,
currency, integer amount, transit estimate, and quote timestamps.

Quoted logistics creation consumes that selected snapshot and origin in the
same transaction that creates the durable logistics intent, permanently
deletes both quote rows, then calls `createQuotedReturnShipment` outside the
transaction with `np.shop-return-logistics-request.v2`. Provider retry keeps
the same logistics UUID, private logistics sidecar, and selected method. The
existing v1 method remains the path for a return created without a quote.

The owner order page exposes quote, selection, and creation controls only when
the capability is configured. Classic and storefront-full skins share the
same prepared UI contract, while the independent Storefront theme consumes
only `[data-np-shop-return-postage-status]`. Admin and Doctor expose PII-free counts,
health, newest rows, API/action inventory, provider mismatch, malformed rows,
private-sidecar mismatch, and expired cleanup state.

The quoted amount is informational logistics state. This carrier contract does
not charge a payment method, change frozen order totals, automatically deduct a
refund or choose a responsible party, implement jurisdiction policy, recur a
quote, or define provider-specific protocols. A payment adapter may separately
opt into the staff-designated settlement contract described below.

### Reverse-shipment tracking

`verifyReturnTrackingWebhook` and `readReturnTracking` are independent,
additive capabilities over the paired return-logistics methods. Both consume
the active PII-free logistics tuple: logistics/return/order ids, provider-owned
return reference, tracking number, and timestamps. Neither receives the
short-lived origin address, customer identity, item details, or payment data.

```ts
const carrier: NpShopCarrierAdapter = {
  // bookShipment, createReturnShipment, and cancelReturnShipment omitted here
  async verifyReturnTrackingWebhook(input) {
    const providerEvent = await verifyProviderReturnTracking(input.rawBody, input.headers);
    if (!providerEvent) return null;
    return {
      contract: "np.shop-return-tracking-event.v1",
      eventId: providerEvent.id,
      logisticsId: providerEvent.logisticsId,
      returnId: providerEvent.returnId,
      orderId: providerEvent.orderId,
      returnReference: providerEvent.returnReference,
      trackingNumber: providerEvent.trackingNumber,
      status: providerEvent.status,
      occurredAt: providerEvent.occurredAt,
      signedAt: providerEvent.signedAt,
    };
  },
  async readReturnTracking(request) {
    const providerEvent = await readProviderReturnTracking(request);
    const checkedAt = new Date().toISOString();
    return {
      contract: NP_SHOP_RETURN_TRACKING_POLL_RESULT_CONTRACT,
      logisticsId: request.logisticsId,
      returnId: request.returnId,
      orderId: request.orderId,
      checkedAt,
      event: providerEvent
        ? {
            contract: "np.shop-return-tracking-event.v1",
            eventId: providerEvent.id,
            logisticsId: request.logisticsId,
            returnId: request.returnId,
            orderId: request.orderId,
            returnReference: request.returnReference,
            trackingNumber: request.trackingNumber,
            status: providerEvent.status,
            occurredAt: providerEvent.occurredAt,
            signedAt: checkedAt,
          }
        : null,
    };
  },
};
```

The raw callback route is `/api/plugins/shop/carrier/return-tracking/webhook`.
It authenticates exact bytes before accepting one
`np.shop-return-tracking-event.v1`, hashes the external event id, rejects
conflicting replay, and advances only the independent return-shipment state.
Stale, regressive, and post-delivery events remain immutable receipts with a
closed outcome. `delivered` means only that the carrier delivered the reverse
shipment; the physical return remains `approved` until a direct staff receipt
performs warehouse inspection and any all-or-none tracked inventory restore.
It never changes the order payment status or creates a refund/exchange.

Polling uses the same 25-item batch, 500-row cursor scan, five-minute lease,
ten-minute interval, bounded exponential backoff, and provider-I/O-outside-
transaction rules as outbound tracking, but stores independent
`np.shop-return-tracking-poll-storage.v1` rows and a separate cursor. Admin
adds PII-free event/poll metrics, health, newest-50 tables, and an audited
manual poll action; Doctor validates the same optional route, scheduled task,
and action-kind inventory after adapter removal.

This boundary assumes one completed outbound booking from the same configured
carrier. It does not buy or regenerate the outbound label, charge return postage,
schedule recurring pickups, inspect warehouse contents, implement
exchanges/refunds, or decide return eligibility and customer-service policy.

`readTracking` is a separate additive capability from callback verification.
When present, Shop registers a ten-minute UTC scheduled task and an audited
direct-staff **Poll tracking now** row action. Each request is the exact
`np.shop-tracking-poll-request.v1` shipment/order/reference/tracking tuple,
optional current event cursor, and request timestamp; it contains no customer,
destination, or line data. The result is an exact
`np.shop-tracking-poll-result.v1`. Its `checkedAt` must be within the live
request window, and a returned canonical event must match the request exactly
and use the same timestamp as `signedAt`. Returning `event: null` is a
successful unchanged observation.

Scheduled reconciliation claims at most 25 due shipments per run while a
persisted site/provider cursor walks at most 500 completed outbound and
replacement booking rows, so a large early key range cannot starve later
shipments. A five-minute persisted
lease is committed before the adapter call, and provider I/O occurs outside a
database transaction. Successful active shipments become due again after ten
minutes; failures retain only `provider-error`, `invalid-result`, or
`state-conflict` and back off exponentially from five minutes to six hours.
Expired leases are reclaimable. Delivery stops further polling, and the poll
state expires with its shipment. Adapter implementations remain responsible
for a finite provider timeout shorter than the lease.

Polling feeds the same digest, idempotent receipt, monotonic state, and owner
projection engine as webhooks. It can create the initial state when callbacks
are unavailable, while a later callback may advance it; neither capability
requires the other. The persisted poll row, scan cursor, request, result,
audit payload, Admin table, and health diagnostics are PII-free.

`verifyTrackingWebhook` is an additive capability. When present, Shop declares
the unauthenticated transport route `POST /carrier/tracking/webhook` in exact
raw-body mode; the adapter must authenticate those bytes before returning a
canonical event. `signedAt` is bounded to a five-minute callback replay window,
while `occurredAt` may precede it by at most 30 days for delayed carrier
delivery. That transport timestamp is replay-checked but omitted from the
semantic digest, allowing an authenticated provider retry to refresh only its
signature time. The event must exactly match the current site and exactly one
completed outbound or same-item replacement shipment UUID, order, booking
reference, and tracking number. A replacement additionally rechecks its
exchange identity, processing-or-shipped state, completed booking revision,
carrier, and tracking tuple. Ambiguous matches fail closed.

Shop hashes external event ids into storage keys. Replaying the same id and
content is idempotent; reusing an id for different content returns HTTP 409.
PII-free receipts record `advanced`, `ignored-stale`, `ignored-regression`, or
`ignored-terminal`. The current `in-transit | out-for-delivery | delivered |
exception` state is stored separately for outbound and replacement shipments
and advances independently of fulfillment or exchange state, so `shipped`
keeps its existing carrier-handoff meaning. Replacement delivery stages an
owner update but never changes `processing` or `shipped`. `delivered` is
terminal; stale and regressive events remain diagnosable without rolling the
owner-visible state backward. The order detail shared by both bundled skins
exposes the latest state through `data-np-shop-tracking-status` or
`data-np-shop-exchange-tracking`.

Tracking metrics, health, and a newest-50 receipt table remain declared after
adapter removal. Doctor verifies their action kinds and route declaration;
health samples malformed, orphaned, provider-mismatched, and booking-state-
mismatched rows without reading private data. Admin event and poll tables label
outbound versus replacement shipments, and the exchange row exposes the latest
closed tracking state. Once any replacement tracking state is durable, provider
cancellation and automatic inventory restock fail closed. Polling has an
independent health
widget and newest-50 state table, including due/backoff/lease state, malformed
or orphan samples, provider/booking mismatches, and completed bookings not yet
polled. Doctor verifies both conditional action/schedule declarations. The
tracking contract does not buy labels, derive package dimensions or weight,
calculate delivery price, or implement provider-specific, customs, jurisdiction, or
customer-service policy.

## Full refunds and inventory compensation

`refundPayment` is an additive adapter capability. When present, the recent
orders table exposes a direct-staff-only **Full refund** action for `paid`
orders. Arbitrary partial refund amounts are deliberately absent from the action and
adapter input. Shop first writes one PII-free `pending` refund with a canonical
UUID and append-only staff audit event, then calls the provider outside the
database transaction. Every retry reuses that UUID as the provider idempotency
key; a second local refund cannot be created for the order.

The provider must return one exact `np.shop-refund-result.v1` matching the
stored order id, payment reference, currency, and complete order amount.
Retryable ambiguity leaves the durable refund pending. A definitive provider
rejection moves it to `manual-review` with only a bounded error code. A
matching provider success is durably stored as `provider-confirmed` before
local reconciliation, so a delayed retry no longer needs another provider
call. Any unresolved refund blocks fulfillment changes until provider or
operator reconciliation establishes a terminal result. One local transaction
then:

- changes the commercial order from `paid` to `refunded` and deletes any
  retained customer/shipping sidecar;
- changes an awaiting/processing fulfillment to `cancelled`; an already
  shipped fulfillment remains `shipped`;
- for an unshipped tracked order, locks every product id, preflights every
  exact product/variant and integer bound, and restores all quantities or none;
- records `restocked`, `not-required`, `not-applicable-shipped`, or
  `manual-required` so catalog drift never hides a partial compensation; and
- writes a second append-only staff audit event without PII or provider body.

Provider cancellation cannot be rolled back by PostgreSQL. If the process
stops after the provider succeeds, the pending record and stable idempotency
key make the same action safe to retry and converge. Operators must treat a
pending or manual compensation diagnostic as reconciliation work; Shop never
claims inventory was restored when exact catalog rows no longer match.

## Physical returns and receipt inventory

A shipped `paid` or post-shipment `refunded` order may create one durable,
owner-scoped item return through `POST /api/plugins/shop/returns`. The request
must match the current commercial order revision and select one or more exact
order line keys with quantities no greater than the immutable purchase
snapshot. Reasons are closed to `damaged`, `defective`, `wrong-item`,
`changed-mind`, or `other`; optional detail is bounded customer-supplied text
and should not contain sensitive data. It is visible only to that owner and
direct staff, never Doctor/health output. Creating a return does not alter the
order, fulfillment, payment, refund, or inventory. While status is
`requested`, the owner may revision-safely cancel it through
`DELETE /api/plugins/shop/returns`.

Admin exposes three direct-staff-only, audited transitions:

- `requested → approved` records an optional PII-free receiving note;
- `requested → rejected` requires a bounded PII-free reason; and
- `approved → received` confirms all requested physical units arrived.

Only the final receipt transition can restore inventory. Shop derives the
tracked subset from the original order's `inventoryReservationLineKeys`, locks
catalog rows in canonical order, and preflights every exact product/variant,
quantity, and integer bound before the first update. It then restores every
tracked requested quantity or none. The return records `restocked`,
`not-required`, or `manual-required`; catalog drift never produces a partial
restock or an implied success. Payment refunds remain a separate explicit
staff/provider operation, and a received return does not change the shipped
fulfillment.

This intake contract deliberately does not by itself implement exchanges, automatic approval
windows, return shipping fees, labels, pickup booking, warehouse inspection
policy, or automatic payment refunds. Sites must publish and enforce their own legal and
customer-service policy around this neutral intake state machine.

## Same-item replacement exchanges

After staff mark one return `received`, Admin may create one exact same-item
replacement when the commercial order is still `paid`, the original fulfillment
is `shipped`, receipt inventory is `restocked` or `not-required`, and no full or
partial refund owns the payment. The replacement copies only the immutable
product, SKU, variant, and received quantity snapshot. Staff cannot substitute a
different item, change quantities, collect a price difference, or create store
credit through this contract.

Creation locks the order, return, and every tracked product in canonical order.
It protects quantities already reserved by pending orders, then consumes every
exact replacement unit or none. One durable `np.shop-exchange-storage.v1` row
moves revision-safely through `awaiting → processing → shipped`. Creation does
not reuse the original order address. Instead, owner order reads issue a
15-minute, one-use HMAC authority bound to the site, owner, order, exchange, and
current destination revisions. The owner submits one exact replacement address
under CSRF protection. Shop stores it only in a separate
`np.shop-exchange-destination-private.v1` sidecar for at most 24 hours and never
beyond commercial order retention. A stale or expired authority fails closed;
an expired address may be submitted again under a newly issued authority. Staff
supply a bounded PII-free note and may use the existing manual
processing/carrier/tracking flow. Before shipment, cancellation restores every
tracked replacement unit or records `manual-required` without claiming a
partial restoration. Shipped and cancelled states are terminal.

A carrier adapter may independently implement `bookExchangeShipment` and
`cancelExchangeShipment` together. Shop creates one durable
`np.shop-exchange-carrier-booking-storage.v1` intent with a stable replacement
shipment UUID before provider I/O. Booking receives the immutable replacement
lines and the current staff-accessed private destination through the exact
`np.shop-exchange-carrier-booking-request.v1` contract. It runs outside the
database transaction and must use `shipmentId` as its provider idempotency key.
The result contains only a bounded booking reference, carrier, tracking number,
and timestamp; returning an address or any additional field fails closed.

The same adapter may add `bookExchangeShipmentWithParcels`. When present, a
new booking first requires direct staff to save one exact
`np.shop-exchange-parcels-storage.v1` snapshot. It reuses the outbound parcel
shape and bounds, but allocation is checked against every immutable exchange
line and exact replacement quantity rather than the full order. Exchange and
parcel revisions are compare-and-swap inputs, and an existing durable booking
or shipment lock makes the snapshot immutable.

The booking transaction locks that snapshot to the stable replacement shipment
UUID before provider I/O. The provider then receives
`np.shop-exchange-carrier-booking-request.v2`, which adds only the parcel
revision and exact parcel array to the v1 request. Retryable ambiguity reuses
the same UUID, destination revision, parcel revision, dimensions, weights, and
allocations. A pending locked booking requires its original parcel-aware
capability. When the additive method is absent, v1 remains authoritative and
does not reinterpret or lock an independently prepared snapshot.

Shop durably records `provider-confirmed` before deleting the destination
sidecar and completing the exchange as `processing`. A crash in between can be
resumed without retaining or rereading the address. Retryable ambiguity remains
`pending`; definitive provider failure, malformed output, result mismatch, or a
post-confirmation local conflict becomes closed `manual-review` work. Once an
intent exists, the manual process/cancel actions and address replacement are
blocked so they cannot race a provider result. Staff may explicitly mark a
completed booking shipped with its exact stored carrier/tracking pair.

Provider cancellation likewise persists one stable cancellation UUID before
calling `cancelExchangeShipment` outside the transaction. Only a matching
durable confirmation permits the final atomic exchange cancellation and exact
inventory restoration. `cancel-pending` and `cancel-confirmed` are resumable;
Shop never treats an ambiguous provider response as a cancelled shipment.
Manual exchange processing remains available when this paired capability is
not used.

When that carrier also implements the independent `readShippingLabel`
capability, a completed provider booking exposes **Download replacement
label** to direct staff through the same authenticated binary route used for
outbound labels. Shop supplies only the PII-free booking tuple, performs the
provider call outside the transaction, and revalidates the booking/exchange
identity, state, revisions, carrier, and tracking before delivering at most 5
MiB of PDF, PNG, or ZPL bytes. Read and delivery audits include the exchange
and shipment ids, provider id, and—on delivery—format and byte count; no label
bytes or URL are persisted or logged.

The owner projection omits staff notes and identity, exposes the exact lines,
status, inventory outcome, and optional tracking through
`[data-np-shop-exchange]`. A provider-booked processing or shipped replacement
also exposes `[data-np-shop-exchange-carrier-booking]` without identifying the
adapter. The flow stages the same preference-aware member-inbox and
email events as other order transitions. Admin exposes bounded PII-free totals,
recent rows, destination and carrier-booking lifecycle,
parcel revision/lock state, malformed/orphan/provider-mismatched samples,
parcel allocation or lock mismatches, expired sidecars, and manual
reconciliation/inventory work. Doctor validates the matching declarative
metric, status, table, and conditional action inventory without provider I/O.
The address itself is
withheld from tables and diagnostics. A direct-staff **View replacement
address** action performs the only Admin read and audits every access.
Processing is blocked until a current sidecar has been accessed, then
atomically deletes it as the exchange leaves `awaiting`; cancellation, expiry
cleanup, and order cleanup also delete it. Exchange creation, address
submission/access, processing, shipment, and cancellation write PII-free audit
metadata.

The original shipping address has already been deleted at first shipment and
is never reused. The shared label-acquisition capability may purchase or
atomically regenerate the provider-backed replacement label before verified
tracking starts. Automatic address correction, different-item substitutions, payment
differences, store credit, legal eligibility rules, and automatic approval
remain separate additive contracts.

## Received-return partial refunds

`refundPaymentPartially` is an additive payment-adapter capability independent
of `refundPayment`. When present, a received physical return gains one
direct-staff **Refund returned items** action. Shop automatically allocates the
original immutable unit price times every received return quantity. Staff
cannot alter those item amounts; they provide canonical non-negative minor-unit
shipping and additional-tax allocations, each bounded by the corresponding
frozen order component, plus one bounded PII-free provider reason.

The resulting amount must be positive and strictly smaller than the order
total. An exact-total request must use the full-refund contract instead. A
full-refund record and a partial-refund record are mutually exclusive, and this
bounded v1 contract permits only one partial refund for one received return on
an order. Repeated partial refunds, goodwill adjustments, and refunds without a
received return remain external.

Shop first stores one `np.shop-partial-refund-storage.v1` row and staff audit,
then calls the provider outside the transaction using its stable refund UUID as
the idempotency key. The provider result must exactly match refund, order,
return, payment reference, currency, amount, and timestamp. Shop persists a
valid success as `provider-confirmed` before the final local transaction;
retryable ambiguity remains `pending`, while a definitive rejection or result
mismatch becomes bounded `manual-review` work. Recovery rows reuse the same
action and immutable allocation.

Local completion increments the commercial order revision only. It does not
change the paid order status, shipped fulfillment, return state, or inventory:
the warehouse receipt already performed the one allowed all-or-none inventory
restoration. Owner order detail receives only the bounded allocation, status,
amount, and timestamps. Provider references, operator reason, owner identity,
and provider errors stay out of that projection and out of Doctor diagnostics.

### Quote-backed return-postage settlement

`refundReturnSettlement` is a second additive payment-adapter capability. It
does not replace `refundPaymentPartially`, and a carrier that only implements
return-postage quote/create remains independently usable. The direct-staff
action appears only when the payment capability is configured and the return
has been physically received with one active quote-backed return shipment.

Staff explicitly designate `merchant` or `customer` responsibility. Shop
copies the immutable `np.shop-return-postage-method.v1` snapshot into one
optional `np.shop-return-postage-settlement.v1` field on the existing durable
partial-refund row:

- merchant responsibility records the exact quote and deducts zero;
- customer responsibility deducts exactly the quoted same-currency amount;
- the provider receives one net refund equal to returned post-discount items
  plus explicit refundable outbound shipping and added tax, minus that exact
  deduction.

The net refund must remain positive and strictly below the original order
total. A quote that consumes the refundable allocation fails closed for manual
resolution; Shop never creates a zero/negative refund or a separate/off-session
charge. One order still owns at most one return-linked refund, and full-refund
exclusion, provider-confirmed recovery, cancellation reconciliation, retention,
and inventory/fulfillment boundaries remain the same as the base partial-refund
contract. Re-entry must match the durable responsibility and exact logistics
quote. Owner detail projects the PII-free responsibility, method, quoted amount,
deduction, and net refund through
`[data-np-shop-return-postage-settlement]`; Admin and Doctor expose only bounded
PII-free counts and snapshots.

This capability is a staff designation and refund-settlement primitive, not a
legal or automatic returns policy. Eligibility rules, fault determination,
jurisdiction/consumer-law decisions, separate postage collection, different-item exchanges,
and provider-specific protocols remain outside Shop. The bundled Toss adapter
maps the validated net amount to its existing partial-cancellation request and
keeps the durable refund UUID as the idempotency key.

## Payment initiation and Toss Payments

An adapter can add initiation without changing the verified-event contract by
implementing all three optional methods together:

- `preparePayment` creates either bounded public client handoff data or an
  HTTPS redirect for the exact stored order;
- `renderPaymentLauncher` receives prepared labels and the owner-scoped
  attempt API path, then renders the provider UI;
- `confirmPayment` validates provider-returned fields on the server and emits
  one canonical successful event. It must never trust a browser amount or
  order id as the commercial source of truth.

When those methods exist, Shop exposes owner-scoped `GET`, `POST`, and `PATCH`
at `/api/plugins/shop/payments/attempts`. `POST` prepares one idempotent
`np.shop-payment-attempt.v1` for the current `pending-payment` order. The
attempt lasts 15 minutes, snapshots the exact order revision/currency/amount,
contains only bounded public handoff data, and is capped at five active
prepared attempts and 100 retained attempts per order. Attempts are purged
with the commercial order. `PATCH` calls the adapter on the server and feeds its
canonical success event into the same serialized receipt, order, and inventory
transition as a webhook. Provider timeouts and ambiguous failures leave the
order pending with its inventory reservation held so the visitor can retry.
After a provider success redirect, the launcher retains the exact return
parameters until server confirmation succeeds and retries that same attempt;
it does not prepare a second payment after an ambiguous confirmation failure.

The bundled Korean provider implementation uses Toss Payments v2:

```bash
pnpm add @nexpress/shop-payment-toss
```

```ts
import { defineConfig } from "@nexpress/core";
import { defaultCollections, defaultPlugins } from "@nexpress/app/config-defaults";
import { createShop } from "@nexpress/plugin-shop";
import { tossPaymentsFromEnv } from "@nexpress/shop-payment-toss";

const shop = createShop({
  payment: {
    adapter: tossPaymentsFromEnv({
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
    }),
  },
});

export default defineConfig({
  // Keep the rest of the site config unchanged.
  collections: [
    ...defaultCollections.filter(
      (collection) => !shop.collections.some((item) => item.slug === collection.slug),
    ),
    ...shop.collections,
  ],
  plugins: [...defaultPlugins.filter((plugin) => plugin.manifest.id !== "shop"), shop.plugin],
});
```

Set matching `NP_TOSS_PAYMENTS_CLIENT_KEY` and
`NP_TOSS_PAYMENTS_SECRET_KEY` values from the same test/live mode and key
family (`ck`/`sk` or `gck`/`gsk`). Only the client key is included in the
browser handoff. The adapter currently supports KRW standard card/easy-pay
requests. Its success redirect retrieves the stored attempt and confirms it
server-side with the secret key and attempt UUID idempotency key. General
payment webhooks are not accepted at face value: the adapter queries Toss with
the secret key, compares the exact payment projection, and only then emits a
terminal event. Query-verified `CANCELED` and `PARTIAL_CANCELED` results instead
emit cumulative adjustment snapshots whose completed cancellation keys,
amounts, UTC timestamps, and sum match `balanceAmount`. Unsupported or
unverifiable callbacks fail closed.
The same adapter implements `refundPayment` with Toss's full-cancel endpoint,
the Shop refund UUID as `Idempotency-Key`, no `cancelAmount`, and exact
validation of `CANCELED`, zero remaining balance, completed cancellation
amount, transaction key, and timestamp. A partial cancellation response fails
closed and cannot become a Shop refund.
For a received return, `refundPaymentPartially` sends the exact Shop amount as
`cancelAmount` with the partial-refund UUID as `Idempotency-Key`. It accepts
only a matching `PARTIAL_CANCELED` payment, one completed cancellation for that
amount, and a consistent remaining balance. Any mismatch fails closed before
Shop records provider confirmation.

The same cancellation may arrive after Shop's synchronous refund call or may
have originated in the Toss console. Shop matches the former to its durable
refund without repeating compensation. For the latter, only a safe single
full reversal is applied automatically; partial or multi-cancellation history
stays blocked manual review.

In a generated project, `defaultCollections` and `defaultPlugins` already
contain the default Shop instance. Filter the five Shop collections
and the plugin whose manifest id is `shop`, then append `shop.collections` and
`shop.plugin` from the single configured factory above. Do not register both
Shop instances.

## Admin surfaces

The five collections appear in the Commerce group. Product editing includes
price, tax-display, media, SKU, inventory, variants, featured state, and skin
selection. Operator-only derived fields stay hidden.

The plugin declares these baseline typed dashboard metric actions:

- total product rows;
- published low-stock products;
- published promotions plus PII-free promotion reservation/redemption health;
- published local shipping policies plus base/surcharge/method health;
- verified-purchase reviews split across published, pending, hidden, and
  malformed states, with PII-free recent rows and audited hide/restore;
- active unexpired carts;
- unexpired non-cancelled checkout-intent records (public reads still
  revalidate the current cart).
- unexpired private order-draft records, without any customer or shipping
  values.
- same-item replacements split across awaiting, processing, shipped, cancelled,
  and manual-inventory states, with PII-free recent rows and direct-staff
  create/process/ship/cancel actions.
- durable pending, paid, refunded, failed, and cancelled commercial order records, without owner or PII
  values.
- active PII-free inventory reservation rows.
- fulfillment rows split across awaiting, processing, and shipped states.
- PII-free fulfillment parcel snapshots and their shipment-lock state.
- durable carrier shipment attempts and completed bookings, including when
  the adapter is currently disabled.
- durable PII-free carrier pickup scheduling/cancellation attempts, including
  when the adapter is currently disabled.
- verified PII-free tracking-event receipts and separate current outbound and
  replacement shipment states.
- verified PII-free reverse-tracking receipts, current return-shipment states,
  and durable polling leases/backoff.
- verified PII-free payment-event receipts.
- provider payment-adjustment receipts and reconciled/manual order state.
- durable full-refund attempts and compensation outcomes.
- durable received-return partial-refund attempts and exact item/shipping/tax
  allocations.
- item-level physical returns split across requested, approved, rejected,
  received, and owner-cancelled states.

A complete initiation adapter adds an additional metric for PII-free payment
attempts, a bounded recent-attempt table, and payment-attempt health. Attempt
diagnostics expose provider, status, order id, exact amount, and timestamps;
they withhold owner segments, private order data, and provider handoff values.
Carrier booking independently has a metric, health status, newest-50 table,
and resume action even while its adapter is disabled. Health reports malformed, orphaned,
provider-mismatched, fulfillment-state-mismatched, pending,
provider-confirmed, completed, and manual-review rows without reading a
destination. Pending and provider-confirmed table rows reuse the same audited
direct-staff action; a confirmed row performs local completion only.
Carrier pickup independently has a metric, health status, newest-50 table, and
Doctor inventory even when scheduling is disabled. Pending and confirmed rows
remain visible for reconciliation; configured adapters add schedule, resume,
and cancel actions without exposing the origin token or parcel allocations.
Carrier tracking has its own metric, health status, and newest-50 receipt table
even when the callback capability is disabled. It reports current delivered
and exception counts plus bounded malformed, orphaned, provider, and shipment
state mismatches across outbound and replacement bookings. Polling adds a
separate health widget, newest-50 poll table,
audited manual row action, and scheduled reconciliation inventory only when
`readTracking` is configured; durable rows remain visible after removal.
Return tracking mirrors that operational surface with separate event and poll
contracts keyed to active return logistics. It reports malformed/orphaned,
provider/logistics mismatches, delivery exceptions, due work, expired leases,
and unpolled active return shipments without reading the private origin.
Carrier-delivered state is explicitly not a warehouse receipt or inventory
operation.

Admin also exposes separate cart, checkout-intent, and private-order-draft
storage health plus configured shipping-provider success/failure state and
confirmed bounded expiry cleanup actions. Order health,
the confirmed maintenance action, and the newest-50 table expose only
commercial metadata. Inventory reservation health reports malformed, expired,
order-orphaned, or pending-order-missing rows from bounded samples, and its
newest-50 table exposes only order id, product id, variant SKU, quantity, and
expiry. Payment health reports malformed or order-orphaned receipts from a
bounded sample; its newest-50 table exposes only provider, event/type, order,
outcome/status, and processing time. Order-draft, order, inventory, and
payment diagnostics withhold private and owner values. Fulfillment health
reports malformed, orphaned, paid/refunded-without-fulfillment, and overdue-private rows
from bounded samples. Its row actions support processing, shipment, and an
audited explicit private read; every mutation uses the current fulfillment
revision. The scheduled-task and
action registries make these contracts visible to plugin doctor without
executing them.
Payment-adjustment health independently reports malformed or orphan state and
any manual-review order that blocks fulfillment/refunds. Its newest-50 receipt
table contains only provider/event/order ids, exact currency amounts,
cancellation count, closed outcome/order status, and processing time. It never
returns provider callback bodies, refund reasons, owner segments, or private
order values.
Refund health reports pending provider calls, definitive provider review,
manual inventory compensation, malformed rows, and missing order lookups. Its
bounded table contains only provider/order/refund ids, integer amount,
terminal outcomes, bounded error code, and timestamps. Starting a full refund
from the order table remains conditional on `refundPayment`; the refund table
always references the same direct-staff handler so a `provider-confirmed` row
can finish local reconciliation even after the provider adapter is removed.
Doctor therefore sees neither a dangling handler nor a missing recovery path.
Partial-refund health independently reports pending provider calls,
provider-confirmed local reconciliation, definitive manual review, malformed
rows, and missing or mismatched lookup/order/return/fulfillment relationships. Its bounded table exposes only provider,
order, return and refund ids, exact allocation amounts, status, bounded error
code, and timestamps. The received-return action appears only when
`refundPaymentPartially` is configured; its recovery table retains the typed
handler inventory even when the adapter is later removed.
Return health reports only counts for malformed/orphan rows, requests awaiting
review, approved returns awaiting receipt, and manual inventory reconciliation.
The direct-staff bounded table additionally exposes order/return ids,
revisions, closed reason, bounded customer request detail, unit count, status,
inventory outcome, bounded operator note, and timestamp while withholding
shipping, payment, provider, and owner-identity values.
The same definition-level registry binds approve/reject/receive row actions to
their exact handlers, so Doctor validates them before an operator click.

The manifest-level action registry binds each metric widget to its exact
handler kind, so plugin validation and doctor can inspect the relationship
before a click.

## Skins and theme integration

Every Shop factory registers:

| ID                | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `classic`         | Compact, neutral catalog and detail fallback               |
| `storefront-full` | Larger editorial header and image-led product presentation |

Both skins implement catalog, category, product, wishlist, prepared restock
and price-alert actions, cart, checkout-intent,
private order-draft, order-history, and order-detail rendering, including the
`[data-np-shop-exchange]` replacement state and independent
`[data-np-shop-exchange-destination]` intake/status hook. They receive
prepared products, localized messages, safe formatted money, and rendered
rich text; they do not own identity, private-data, collection, or transaction
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
`[data-np-shop-surface="wishlist"]`, `[data-np-shop-wishlist-action]`,
`[data-np-shop-restock-alert]`,
`[data-np-shop-price-alert]`,
`[data-np-shop-cart-line]`,
`.np-shop-checkout-client`, `[data-np-shop-checkout-line]`,
`[data-np-shop-checkout-status]`,
`.np-shop-order-draft-client`, `[data-np-shop-order-draft-line]`,
`[data-np-shop-order-draft-status]`,
`.np-shop-order-list`, `.np-shop-order-client`,
`.np-shop-payment-action`, `.np-shop-toss-payment`,
`[data-np-shop-order-line]`, `[data-np-shop-order-status]`,
`[data-np-shop-fulfillment-status]`,
`[data-np-shop-partial-refund]`,
`.np-shop-return-form`, `.np-shop-return-summary`,
`[data-np-shop-return-status]`,
`[data-np-shop-return-postage-status]`,
`[data-np-shop-return-postage-settlement]`,
`[data-np-shop-return-tracking-status]`,
`[data-np-shop-surface]`, `[data-np-shop-skin]`,
`[data-np-shop-inventory]`, `[data-np-shop-block]`, and
`[data-np-forum-context-questions]`.

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
    promotions: "catalog-promotions",
    shippingPolicies: "catalog-shipping-policies",
    reviews: "catalog-reviews",
  },
  defaultSkinId: "storefront-full",
  payment: { adapter }, // optional; omitted means the webhook route does not exist
  // Optional external override; omitted uses local policies or zero fallback.
  shipping: { adapter: shippingAdapter },
  // Independent read-only parcel calculation; manual parcel JSON remains available.
  packaging: { adapter: packagingAdapter },
  carrier: {
    adapter: carrierAdapter,
    // Required only with paired schedulePickup/cancelPickup methods.
    pickupLocationReference: "warehouse-seoul-1",
    // Required only with paired createReturnShipment/cancelReturnShipment.
    returnLocationReference: "returns-seoul-1",
  },
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
factory's `skins` option. `renderCart`, `renderCheckout`, `renderOrderDraft`,
`renderOrders`, and `renderOrder` are additive and optional; when omitted, the
complete shared surfaces are used. Routes own identity, mutation,
private-data, and quote policy while skins receive prepared client surfaces.
Existing `classic` and `storefront-full` ids cannot be replaced.

## Next commerce slices

Future transaction work should remain separable from this foundation:

1. additional provider packages for Stripe or KG Inicis;
2. authorization/capture, settlement corrections, disputes/chargebacks, and
   initiating repeated or non-return partial-refund contracts;
3. recurring pickup, provider-specific tracking packages,
   replacement-address/carrier automation, different-item exchanges, and
   customer-service policy;
4. tax remittance/filing, invoices, exemptions/nexus, customs/duties, and
   carrier-owned dynamic rate integrations;
5. warehouse mutations, physical packing automation, and packaging-material
   reservation or purchasing.

Those features require their own payment, security, and operational contracts.
The provider-neutral event boundary does not pre-authorize or emulate them.
