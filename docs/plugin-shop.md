# Shop plugin and Storefront theme

`@nexpress/plugin-shop` is the first-party catalog foundation for NexPress.
It owns product and category data, inventory projection, public catalog
routes, bounded guest/member carts, checkout intents, private order drafts,
durable orders, transaction-safe inventory reservations, an optional
provider-neutral shipping quote and selected delivery snapshot, an optional
provider-neutral additional-tax quote and frozen tax snapshot, an optional
provider-neutral payment initiation and verified-event boundary, revision-safe
fulfillment operations, optional provider-neutral carrier booking,
verified or reconciled carrier tracking events and owner-visible delivery state,
provider-neutral full refunds with safe inventory
compensation, owner-scoped item return intake with audited receipt inventory,
Admin collection forms and health actions, blocks, and skins.

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
payment. Shop owns attempts, order/refund transitions, fulfillment and return
state, carrier booking/tracking receipts, and local compensation, but does not choose a provider protocol, remit
or file tax, issue tax invoices, decide exemptions, physically fulfill goods,
buy labels/schedule pickup, implement a provider protocol, or decide jurisdiction-specific return eligibility.

## Default setup

Fresh NexPress projects receive `shopCollections`, `shopPlugin`, and
`storefrontTheme` through the framework defaults. After applying the generated
migration:

1. Open Admin → Commerce → Shop categories and publish categories.
2. Open Admin → Commerce → Products and publish products.
3. Visit `/shop`.
4. Add a product to the cart, visit `/shop/cart`, create a short-lived
   checkout intent, continue to the 24-hour private order draft, and optionally
   create a durable pending order reference.
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

Catalog cards and the `stock=available` filter intentionally describe
persisted on-hand stock. Active pending-order holds are transient and are not
folded into collection pagination totals. Cart quotes subtract active holds,
and order creation rechecks that sellable quantity under product locks before
committing, so the order boundary remains authoritative even when a catalog
page is older or another visitor is ordering concurrently.

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
insufficient stock, and mixed currencies do. Order creation quotes again;
payment initiation, delivery quotes, and additional-tax quotes retain their
own contracts, while the optional verified event boundary owns terminal
idempotency and reservation consumption. Quotes subtract every unexpired
pending-order reservation for the same product or canonical variant SKU.

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
  replaces the complete bounded customer/shipping pair. With no shipping
  adapter, Shop requests any configured tax quote and then makes the draft
  `reviewable` with zero shipping amount. With a shipping adapter, Shop
  requests fresh methods outside the database transaction and persists them
  only after rechecking the same draft revision. Stale provider responses
  therefore cannot overwrite a newer address.
- A quoted draft becomes `shipping-selection-required`. `PUT { draftId,
expectedRevision, methodId }` accepts only one method from the current,
  unexpired quote, requests any configured tax quote outside the transaction,
  and freezes both PII-free snapshots. The exact invariant is
  `subtotalMinor + shippingMinor + taxMinor = totalMinor`. It then becomes
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

## Shipping quote and delivery selection

Shipping is disabled in the default `shopPlugin`, preserving the existing
zero-shipping checkout. A project can register one server-only adapter on the
same `createShop()` factory used for collections and routes:

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

Shop never holds a database transaction open across the provider call. After a
successful selection, `np.shop-delivery-method.v1` copies only provider/quote/
method ids, label, amount, estimate, and quote timestamps into the durable
commercial order. It contains no destination or owner identity. The immutable
order stores `subtotalMinor`, `shippingMinor`, `taxMinor`, and `totalMinor`;
payment preparation, verified event matching, and full refunds use
`totalMinor`.

The PII-free `shipping-health` row records only provider id, `ok | error`, the
closed `provider-error | invalid-result` code, and timestamps. Admin health can
expose that state without reading a destination; plugin doctor verifies the
declarative health action and route contracts without executing them. Carrier
booking, labels, pickup, tracking API integration, customs, free-shipping
policy, and jurisdiction rules remain separate from this quote/selection
boundary.

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
expiry. With no shipping adapter it runs after address `PATCH`; with shipping
enabled it runs only after one delivery method is selected. Provider calls do
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
`subtotalMinor + shippingMinor + taxMinor = totalMinor`; payment preparation,
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

## Verified payment-event contract

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

This boundary proves callback authentication and one local transition; it does
not prove settlement, initiate payment, model authorization/capture,
compensate provider-initiated reversals, or book a carrier shipment.

## Carrier shipment booking and local completion

Carrier booking is disabled in the default `shopPlugin`; staff can continue to
enter a bounded carrier and tracking number manually. A custom project may
instead pass one server-only adapter to the same `createShop()` factory:

```ts
import {
  NP_SHOP_CARRIER_BOOKING_RESULT_CONTRACT,
  NP_SHOP_TRACKING_POLL_RESULT_CONTRACT,
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
};

const shop = createShop({ carrier: { adapter: carrier } });
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
persisted site/provider cursor walks at most 500 completed booking rows, so a
large early key range cannot starve later shipments. A five-minute persisted
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
signature time. The event must exactly match the current site, completed shipment
UUID, order, booking reference, and tracking number.

Shop hashes external event ids into storage keys. Replaying the same id and
content is idempotent; reusing an id for different content returns HTTP 409.
PII-free receipts record `advanced`, `ignored-stale`, `ignored-regression`, or
`ignored-terminal`. The current `in-transit | out-for-delivery | delivered |
exception` state advances independently of fulfillment, so `shipped` keeps its
existing carrier-handoff and private-data-deletion meaning. `delivered` is
terminal; stale and regressive events remain diagnosable without rolling the
owner-visible state backward. The order detail shared by both bundled skins
exposes the latest state through `data-np-shop-tracking-status`.

Tracking metrics, health, and a newest-50 receipt table remain declared after
adapter removal. Doctor verifies their action kinds and route declaration;
health samples malformed, orphaned, provider-mismatched, and booking-state-
mismatched rows without reading private data. Polling has an independent health
widget and newest-50 state table, including due/backoff/lease state, malformed
or orphan samples, provider/booking mismatches, and completed bookings not yet
polled. Doctor verifies both conditional action/schedule declarations. The
contract does not buy or render labels, schedule pickup, choose packaging, calculate
delivery price, or implement provider-specific, customs, jurisdiction, or
customer-service policy.

## Full refunds and inventory compensation

`refundPayment` is an additive adapter capability. When present, the recent
orders table exposes a direct-staff-only **Full refund** action for `paid`
orders. Partial refund amounts are deliberately absent from the action and
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

This contract deliberately does not implement exchanges, automatic approval
windows, return shipping fees, labels, pickup booking, warehouse inspection
policy, or payment refunds. Sites must publish and enforce their own legal and
customer-service policy around this neutral intake state machine.

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
terminal event. Unsupported or unverifiable callbacks fail closed.
The same adapter implements `refundPayment` with Toss's full-cancel endpoint,
the Shop refund UUID as `Idempotency-Key`, no `cancelAmount`, and exact
validation of `CANCELED`, zero remaining balance, completed cancellation
amount, transaction key, and timestamp. A partial cancellation response fails
closed and cannot become a Shop refund.

In a generated project, `defaultCollections` and `defaultPlugins` already
contain the disabled default Shop instance. Filter the two Shop collections
and the plugin whose manifest id is `shop`, then append `shop.collections` and
`shop.plugin` from the single configured factory above. Do not register both
Shop instances.

## Admin surfaces

The two collections appear in the Commerce group. Product editing includes
price, tax-display, media, SKU, inventory, variants, featured state, and skin
selection. Operator-only derived fields stay hidden.

The plugin declares thirteen baseline typed dashboard metric actions:

- total product rows;
- published low-stock products;
- active unexpired carts;
- unexpired non-cancelled checkout-intent records (public reads still
  revalidate the current cart).
- unexpired private order-draft records, without any customer or shipping
  values.
- durable pending, paid, refunded, failed, and cancelled commercial order records, without owner or PII
  values.
- active PII-free inventory reservation rows.
- fulfillment rows split across awaiting, processing, and shipped states.
- durable carrier shipment attempts and completed bookings, including when
  the adapter is currently disabled.
- verified PII-free tracking-event receipts and current shipment states.
- PII-free carrier polling state, bounded retry/lease health, and scan cursor.
- verified PII-free payment-event receipts.
- durable full-refund attempts and compensation outcomes.
- item-level physical returns split across requested, approved, rejected,
  received, and owner-cancelled states.

A complete initiation adapter adds a fourteenth metric for PII-free payment
attempts, a bounded recent-attempt table, and payment-attempt health. Attempt
diagnostics expose provider, status, order id, exact amount, and timestamps;
they withhold owner segments, private order data, and provider handoff values.
Carrier booking independently has a metric, health status, newest-50 table,
and resume action even while its adapter is disabled. Health reports malformed, orphaned,
provider-mismatched, fulfillment-state-mismatched, pending,
provider-confirmed, completed, and manual-review rows without reading a
destination. Pending and provider-confirmed table rows reuse the same audited
direct-staff action; a confirmed row performs local completion only.
Carrier tracking has its own metric, health status, and newest-50 receipt table
even when the callback capability is disabled. It reports current delivered
and exception counts plus bounded malformed, orphaned, provider, and shipment
state mismatches. Polling adds a separate health widget, newest-50 poll table,
audited manual row action, and scheduled reconciliation inventory only when
`readTracking` is configured; durable rows remain visible after removal.

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
Refund health reports pending provider calls, definitive provider review,
manual inventory compensation, malformed rows, and missing order lookups. Its
bounded table contains only provider/order/refund ids, integer amount,
terminal outcomes, bounded error code, and timestamps. Starting a full refund
from the order table remains conditional on `refundPayment`; the refund table
always references the same direct-staff handler so a `provider-confirmed` row
can finish local reconciliation even after the provider adapter is removed.
Doctor therefore sees neither a dangling handler nor a missing recovery path.
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

Both skins implement catalog, category, product, cart, checkout-intent,
private order-draft, order-history, and order-detail rendering. They receive
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
`[data-np-shop-cart-line]`,
`.np-shop-checkout-client`, `[data-np-shop-checkout-line]`,
`[data-np-shop-checkout-status]`,
`.np-shop-order-draft-client`, `[data-np-shop-order-draft-line]`,
`[data-np-shop-order-draft-status]`,
`.np-shop-order-list`, `.np-shop-order-client`,
`.np-shop-payment-action`, `.np-shop-toss-payment`,
`[data-np-shop-order-line]`, `[data-np-shop-order-status]`,
`[data-np-shop-fulfillment-status]`,
`.np-shop-return-form`, `.np-shop-return-summary`,
`[data-np-shop-return-status]`,
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
  payment: { adapter }, // optional; omitted means the webhook route does not exist
  shipping: { adapter: shippingAdapter }, // optional; omitted means zero shipping
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
2. authorization/capture, settlement, provider-initiated reversal, and partial
   refund contracts;
3. carrier labels, pickup, provider-specific tracking packages,
   exchanges, and customer-service policy;
4. tax remittance/filing, invoices, exemptions/nexus, customs/duties, and
   shipping-policy integrations.

Those features require their own payment, security, and operational contracts.
The provider-neutral event boundary does not pre-authorize or emulate them.
