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
  shipping details, optional provider-neutral delivery quotes and selection,
  optional provider-neutral additional-tax quotes,
  immediate cancellation deletion, and hourly expiry cleanup;
- owner-scoped durable pending orders with immutable commercial snapshots,
  exact item subtotal, shipping amount, additional tax, and payment total,
  separate pending-payment private sidecars, revision-safe cancellation, bounded
  history/Admin views, transaction-safe product/variant holds, cancellation
  release, and 365-day commercial cleanup;
- an optional build-time payment adapter with bounded owner-scoped initiation
  attempts, exact raw webhook intake, five-minute event replay bound,
  idempotent PII-free receipts, `paid` / `payment-failed` transitions, and
  atomic reservation consumption or release;
- independent revision-safe `awaiting` / `processing` / `shipped` fulfillment,
  audited direct-staff shipping-data access, owner-visible tracking, and
  shipment-or-30-day private-data deletion;
- revision-safe PII-free fulfillment parcel snapshots with bounded integer
  millimetre dimensions, gram weights, exact order-line allocations, Admin
  health, and optional atomic locking to one durable carrier shipment;
- an optional provider-neutral carrier adapter with one durable shipment UUID,
  calls outside database transactions, resumable provider confirmation,
  atomic tracking/shipped completion and private-data deletion, and closed
  PII-free reconciliation diagnostics; an additive exact raw-body callback
  capability may authenticate PII-free tracking events into conflict-safe
  receipts and a monotonic owner-visible delivery state, while an independent
  PII-free polling capability uses persisted leases, cursor-fair batches,
  bounded backoff, Admin/Doctor health, and the same event engine;
- optional transient shipping-label retrieval for completed carrier bookings,
  with a PII-free provider request, direct-staff audit, bounded PDF/PNG/ZPL
  bytes, authenticated Admin download, and no durable label storage;
- optional provider-neutral pickup scheduling for parcel-aware completed
  bookings, with a server-only opaque origin reference, exact PII-free package
  summaries, stable schedule/cancellation idempotency, provider calls outside
  transactions, revision-safe reconciliation, Admin/Doctor diagnostics, and a
  tracking-start cancellation boundary;
- provider-neutral, staff-audited full refunds with one durable idempotency id,
  cancelled unshipped fulfillment, all-or-none tracked-inventory restoration,
  and explicit manual-compensation diagnostics;
- owner-scoped item-level physical return requests for shipped orders, with
  revision-safe cancellation, audited staff approval/rejection/receipt,
  all-or-none tracked-inventory restoration, and manual-reconciliation health;
- optional provider-neutral partial refunds linked to one received physical
  return, with exact original-price line allocation, explicit shipping/tax
  allocation, one durable idempotency id, and no second inventory or
  fulfillment transition;
- optional owner-scoped return logistics for approved returns, with paired
  provider create/cancel idempotency, drop-off or bounded pickup mode, a
  maximum-24-hour private origin sidecar deleted on confirmation, transient
  owner label downloads, and PII-free Admin/Doctor diagnostics;
- optional exact raw-body and bounded polling reverse tracking over active
  return logistics, with idempotent receipts, persisted leases/backoff,
  owner-visible status, and no automatic receipt, restock, refund, or exchange;
- classic and storefront-full skins;
- featured-product and category-grid blocks.

Provider-specific browser/server protocols, signature algorithms, credentials
and rotation, repeated or non-return partial refunds, reversals, exchanges, carrier label purchase,
recurring pickup,
provider-specific tracking protocols,
tax remittance/filing, invoices, exemptions, customs, and shipping policy
remain outside this package. A server-only `NpShopShippingAdapter` may supply
exact bounded delivery methods, and `NpShopTaxAdapter` may return only tax
added on top of displayed product prices. `NpShopCarrierAdapter` may book one
shipment with its stable shipment UUID as the provider idempotency key and may
consume a locked parcel snapshot through additive `bookShipmentWithParcels`,
authenticate tracking callbacks or reconcile tracking through bounded
server-only reads, and may retrieve an already-booked label through
`readShippingLabel`. A parcel-aware adapter may additionally implement both
`schedulePickup` and `cancelPickup`; `createShop()` then requires one opaque
`pickupLocationReference` that only the provider can resolve. Shop owns
revision-safe selection and both PII-free commercial snapshots. Approved
returns may independently add paired `createReturnShipment` /
`cancelReturnShipment` methods with one opaque `returnLocationReference`;
optional `readReturnLabel` bytes are delivered only to the owner and never
persisted. The same paired capability may independently add
`verifyReturnTrackingWebhook` and `readReturnTracking`; those methods receive
only the PII-free active return-shipment tuple and cannot complete warehouse
receipt, inventory restoration, or payment compensation.
`@nexpress/shop-payment-toss` is the bundled Toss
Payments v2 initiation, full-refund, and received-return partial-refund adapter. Customer/shipping PII exists only in the short-lived
private draft or order sidecar and stays outside content search, revisions,
payment receipts, and transfer. A durable `pending-payment` order reference
still does not imply that a visitor paid for a product.

See the [live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md)
for the exact price, SKU, inventory, cart, checkout-intent, private-draft,
shipping-quote, tax-quote, pending-order, payment-attempt, fulfillment, parcel, carrier, pickup, tracking/polling, full-refund, return-linked partial-refund, return, return-logistics,
skin, block, and theme-integration contracts.
