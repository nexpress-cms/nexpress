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

- product, category, promotion, private shipping-policy, and verified-purchase
  review collections;
- exact integer-minor-unit prices and bounded variants;
- on-hand inventory projection plus transaction-safe pending-order
  reservations;
- catalog, category, product, member wishlist, restock-alert,
  catalog-price-alert, cart, checkout-intent, private order-draft,
  order-history, and order-detail routes;
- authenticated saved products over the shared site-scoped community follow
  graph, with one bounded batch state read for catalog cards, public-product
  hydration at `/shop/wishlist`, and PII-free Admin totals;
- independent member-owned one-shot alerts for exact out-of-stock tracked
  products or enabled variants, with 180-day subscriptions, fast product-update
  processing, five-minute bounded reconciliation, preference-aware inbox
  delivery, stable-event dedupe, 30-day receipts, and PII-free Admin/Doctor health;
- independent member-owned one-shot alerts when an exact product or enabled
  variant catalog price falls below its captured same-currency baseline, with
  180-day subscriptions, fast product-update processing, five-minute bounded
  reconciliation, stable-event inbox dedupe, 30-day receipts, and PII-free
  Admin/Doctor health;
- bounded guest/member carts with revision-safe mutations, live price/stock
  quotes, exact source-cart consumption only on the first durable order commit,
  and explicit owner re-add from non-pending orders;
- automatic and code-based fixed/percentage promotions with time, target,
  minimum-spend, cap, stacking, global/per-owner usage, deterministic line
  allocation, and atomic reservation/redemption/release counters;
- one member-owned review per shipped purchase line, with 1–5 ratings,
  bounded text and photos, exact public aggregates, safe author projection,
  audited Admin hide/restore, and no order/member identifier in the public
  contract;
- an optional structural inquiry renderer plus a batched published-product
  context source, allowing Forum to reuse one ordinary board for signed product
  questions and official answers without either package importing the other;
- local base-rate and additive-surcharge delivery methods with destination,
  product/category, time, priority, delivery-estimate, and gross/discounted
  free-shipping-threshold rules; external quote adapters override these rules;
- owner-scoped, idempotent 15-minute checkout intents that become stale when
  the cart or live commercial state changes;
- owner-scoped 24-hour order drafts with revision-safe, bounded customer and
  shipping details, optional provider-neutral delivery quotes and selection,
  optional provider-neutral additional-tax quotes,
  immediate cancellation deletion, and hourly expiry cleanup;
- owner-scoped durable pending orders with immutable commercial snapshots,
  exact gross item subtotal, promotion discount, shipping amount, additional
  tax, and payment total,
  separate pending-payment private sidecars, revision-safe cancellation, bounded
  history/Admin views, transaction-safe product/variant holds, cancellation
  release, exact transactional source-cart deletion, replay-safe preservation of
  newer carts, no automatic cart restoration, and normally 365-day commercial
  cleanup; relationship-nonterminal packing work—including a `cancelled`
  shipment attachment whose exact carrier compensation is unfinished—is the
  narrow external-effect exception that retains its exact commercial source
  order until resolution;
- `POST /api/plugins/shop/cart/re-add` with owner identity, CSRF, and expected
  cart revision; it rebuilds available immutable order-line identities from
  current published products/enabled variants and current names/prices, keeps
  current cart coupons, enforces 50-line/99-unit bounds with closed per-line
  added/skipped issues, and copies no old commercial values, reservation, or PII;
- a PII-free durable order timeline plus transactional member-inbox and direct-email
  outbox for order, payment, fulfillment, delivery, return, and refund transitions;
  raw guest/member email is isolated only within the existing private-data
  window in a maximum-24-hour sidecar and deleted immediately after successful
  delivery or any order PII redaction;
- an optional build-time payment adapter with bounded owner-scoped initiation
  attempts, exact raw webhook intake, five-minute event replay bound,
  idempotent PII-free receipts, `paid` / `payment-failed` transitions, and
  atomic reservation consumption or release; authenticated provider
  cancellation snapshots reconcile exact Shop refunds, safely compensate one
  previously unknown full reversal, and block fulfillment/refunds for
  ambiguous partial or cumulative adjustments; authenticated provider dispute
  events add bounded PII-free evidence and block new fulfillment, refund,
  exchange, label, and pickup effects until a won, warning-closed, or prevented
  outcome, without automatic commercial compensation;
- independent revision-safe `awaiting` / `processing` / `shipped` fulfillment,
  audited direct-staff shipping-data access, owner-visible tracking, and
  shipment-or-30-day private-data deletion;
- revision-safe PII-free fulfillment parcel snapshots with bounded integer
  millimetre dimensions, gram weights, exact order-line allocations, Admin
  health, and optional atomic locking to one durable carrier shipment;
- an independent optional read-only packaging adapter for processing outbound
  fulfillments and awaiting same-item replacements, with exact PII-free
  product/SKU/quantity inputs, a 60-second proposal expiry, provider I/O outside
  database transactions, revision-safe parcel compare-and-swap, per-target
  health, and the existing manual JSON fallback;
- an independent optional paired packing-work adapter for processing outbound
  fulfillments and awaiting same-item replacements, with exact PII-free lines
  and parcels, stable create/cancel UUIDs, provider I/O outside transactions,
  durable confirmation and cancellation-dominant tombstones, parcel-edit
  exclusion, exact carrier attachment/consumption, tracking-aware
  cancellation-before-compensation ordering, adapter-free local confirmation
  recovery, an optional authenticated raw callback for monotonic PII-free
  `accepted | picking | failed | packed` evidence, always-declared
  Admin/Doctor diagnostics, and cleanup; only an unattached cancelled tombstone
  reopens the manual fallback, and packed evidence never completes shipment;
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
- optional durable shipping-label purchase and atomic regeneration for outbound
  and provider-booked same-item replacements, with one shipment-keyed generation,
  stable provider idempotency, an opaque PII-free current-label reference,
  tracking-start closure, Admin/Doctor reconciliation, and transient bytes only;
- optional provider-neutral pickup scheduling for parcel-aware completed
  outbound and same-item replacement bookings, with shipment-keyed independent
  state, a server-only opaque origin reference, exact PII-free package
  summaries, stable schedule/cancellation idempotency, provider calls outside
  transactions, revision-safe reconciliation, Admin/Doctor diagnostics, and a
  tracking-start cancellation boundary;
- optional provider pickup availability over that scheduling capability, with
  exact shipment/location/parcel requests, at most 20 ordered UTC windows,
  one-hour PII-free snapshots with one-way booking fingerprints, revision-safe staff selection, bounded cleanup,
  and Admin/Doctor health without addresses or provider calendar protocols;
- provider-neutral, staff-audited full refunds with one durable idempotency id,
  cancelled unshipped fulfillment, all-or-none tracked-inventory restoration,
  and explicit manual-compensation diagnostics;
- owner-scoped item-level physical return requests for shipped orders, with
  revision-safe cancellation, audited staff approval/rejection/receipt,
  all-or-none tracked-inventory restoration, and manual-reconciliation health;
- one direct-staff same-item exchange after a received return, with exact
  immutable lines, reservation-aware all-or-none replacement inventory,
  revision-safe awaiting/processing/shipped/cancelled state, manual tracking or
  an optional paired provider-neutral booking/cancellation capability with
  durable idempotency and reconciliation plus optional transient staff label
  retrieval through the existing PII-free label-read capability; the existing
  callback and bounded polling methods also advance a separate owner-visible
  replacement tracking state without changing exchange status,
  owner notifications, a 15-minute one-use owner authority, one maximum-24-hour
  replacement-address sidecar, audited staff access required before processing,
  deletion on processing/cancellation/expiry, PII-free Admin/Doctor/audit, and
  cancellation restock only before verified carrier tracking state;
- optional provider-neutral partial refunds linked to one received physical
  return, with exact post-discount line allocation, explicit shipping/tax
  allocation, one durable idempotency id, and no second inventory or
  fulfillment transition;
- optional quote-backed return-postage settlement through an independent
  payment-adapter method: staff designate merchant or customer responsibility,
  merchant responsibility absorbs the immutable quote, customer responsibility
  deducts exactly that same-currency quote from one positive net refund, and no
  separate charge or automatic payer policy is created;
- optional owner-scoped return logistics for approved returns, with paired
  provider create/cancel idempotency, drop-off or bounded pickup mode, a
  maximum-24-hour private origin sidecar deleted on confirmation, transient
  owner label downloads, and PII-free Admin/Doctor diagnostics;
- optional return-postage quoting over that capability, with paired
  `quoteReturnShipping`/`createQuotedReturnShipment` methods, exact bounded
  same-currency methods, revision-safe owner selection, a maximum-one-hour
  private origin, an immutable PII-free logistics snapshot, and no implied
  automatic charge, refund deduction, or payer policy by the carrier capability;
- optional exact raw-body and bounded polling reverse tracking over active
  return logistics, with idempotent receipts, persisted leases/backoff,
  owner-visible status, and no automatic receipt, restock, refund, or exchange transition;
- classic and storefront-full skins;
- featured-product and category-grid blocks.

Provider-specific browser/server protocols, signature algorithms, credentials
and rotation, initiating repeated or non-return partial refunds, submitting
dispute evidence, accepting liability, automatic chargeback compensation,
different-item or price-difference exchanges,
separate return-postage charges, automatic or
jurisdictional responsibility policy, carrier label billing/void policy,
recurring pickup,
provider-specific tracking protocols,
tax remittance/filing, invoices, exemptions, customs, and carrier-owned dynamic
rate policy, authoritative physical packing completion, picking/bin/worker
coordination, packaging-material inventory/reservation/purchase, and
provider-specific WMS protocols remain outside this package. A
server-only `NpShopShippingAdapter` may supply
exact bounded delivery methods, and `NpShopTaxAdapter` may return only tax
added on top of displayed product prices. An independent server-only
`NpShopPackagingAdapter` may map Shop's exact immutable line keys, product
ids/slugs, optional SKUs, and quantities to its own physical catalog and return
the ordinary bounded parcel shape. Register it separately with
`createShop({ packaging: { adapter: packagingAdapter } })`; it does not require
a carrier. Its `proposeParcels` call is a
side-effect-free read: the fresh proposal UUID is a trace id, its exact result
expires after 60 seconds, Shop stops awaiting at that boundary, and the adapter
should also cancel its own network I/O. It must not reserve materials, mutate a WMS, book
a shipment, calculate a rate, receive an address, or buy a label. Shop calls it
outside transactions, then rechecks source/parcel revisions and booking locks
before saving; any saved snapshot remains replaceable through the manual parcel
action. Shop validates shape and allocation but cannot prove physical fit or
weight because product measurements remain provider-catalog data.

An independent server-only `NpShopPackingWorkAdapter` may accept those already
prepared parcels through
`createShop({ packing: { adapter: packingAdapter } })`.
`createPackingWork` and `cancelPackingWork` must be implemented together. An
optional `verifyPackingStatusWebhook` authenticates exact raw provider bytes
and returns one canonical PII-free status event. Optional `readPackingStatus`
adds lease-safe, cursor-fair scheduled and direct-staff reconciliation with
bounded exponential backoff over the same monotonic evidence engine. Shop
allows exactly one durable work identity per `target + orderId`, writes a
stable packing-work or cancellation UUID before provider I/O, calls the adapter
outside every database transaction, and persists exact provider confirmation
before local `active` or `cancelled` state. Requests freeze the
`outbound | replacement` identity, source and parcel revisions, one-way parcel
fingerprint, immutable lines, and complete parcel allocation without owner,
address, delivery, price, label, credential, note, or provider payload data.
Retryable ambiguity remains pending; stored `provider-confirmed` and
`cancel-confirmed` transitions are locally finalizable after adapter removal
without repeating the provider effect, and closed or conflicting outcomes
reach PII-free manual review. Shop does not impose an adapter-call timeout, so
the adapter must bound every network operation; timeout or transport ambiguity
must remain retryable under the stable `pending` / `cancel-pending` identity.
Unresolved or active work blocks parcel edits. An
exact parcel-aware carrier booking attaches the same source/parcel revision
and fingerprint before provider I/O; outbound completion consumes it
immediately, while a replacement remains active until its explicit ship
action. Manual ship also consumes active work, and a carrier without the
parcel-aware capability fails closed. Direct full refund or replacement
cancellation resolves packing cancellation before existing downstream
payment, carrier, or inventory compensation. Admin, Doctor, commercial
cleanup, and provider-removal visibility share that durable contract. The
provider must retain a cancellation-dominant tombstone for each exact
`workId + cancellationId`, so a delayed or retried create can never resurrect
cancelled work. Shop keeps that single `cancelled` target/order tombstone until
order cleanup and rejects another packing-work create. Only an unattached
`cancelled` tombstone reopens manual parcel, carrier, refund, or replacement
inventory fallback. When cancellation is attached, its exact shipment identity
and parcel fingerprint remain fail-closed. Before verified tracking, only
cancellation of that exact carrier shipment may unwind it. After verified
tracking, carrier cancellation and automatic inventory restock fail closed;
only exact booked shipment completion may proceed, and that completion leaves
the packing conflict visible in diagnostics and retention. A packing
cancellation started before tracking may still retry, reconcile, or finish its
local `cancel-confirmed` transition after tracking with the same cancellation
UUID. Tracking never creates a replacement cancellation identity.
Metric/status/table diagnostics remain declared after adapter removal.
Any create, cancel, or reconciliation action that still needs provider I/O,
including applicable `pending`, `cancel-pending`, or `manual-review` recovery,
remains conditional on the original adapter, while stored confirmations finish
locally without it.

When `verifyPackingStatusWebhook` is present, Shop exposes
`POST /api/plugins/shop/packing/status/webhook` as an unauthenticated host route
whose adapter must authenticate the exact raw bytes and headers. The canonical
event binds one provider event id to the exact work/order/target, optional
exchange, opaque provider work reference, `accepted | picking | failed |
packed` evidence, occurrence time, and five-minute signature freshness.
Event-id receipts make retries conflict-safe; older, regressive, or post-packed
events are acknowledged without regressing the latest state. Raw callback
bodies, signatures, free-text provider payloads, people, locations, and
addresses are never stored. `packed` is evidence only: it does not ship an
order, consume work, refund payment, restore inventory, or bypass the existing
exact manual/carrier completion boundary. A picking/packed event that conflicts
with cancellation remains visible as a warning.
When `readPackingStatus` is present, a ten-minute scheduled task and an exact
direct-staff action reconcile the same evidence through five-minute leases,
provider-scoped cursor fairness, and bounded five-minute-to-six-hour backoff.
Poll requests contain only the exact work identity, opaque provider reference,
latest evidence, and request time. Provider I/O stays outside transactions;
poll state and diagnostics remain PII-free after method removal.
Every relationship-nonterminal packing work is a narrow exception to the normal
365-day commercial cleanup. That includes a `cancelled` shipment attachment
until exact replacement carrier cancellation/restock or exact tracking-won
booked completion; an attached outbound cancellation stays retained for
diagnosis because v1 has no outbound carrier-cancellation operation. Shop
preserves its commercial source order, including a
member-linked owner segment, until an exact `provider-confirmed` or
`cancel-confirmed` transition is finalized locally, the original adapter
returns for provider I/O with the existing stable UUID, exact `active` work is
consumed through the existing manual ship path, or site deletion removes the
tenant. There is no generic override that terminalizes
`pending` or `manual-review`. Private customer/shipping retention is not
extended; privacy-only redaction preserves the commercial order/fulfillment
revisions so exact parcel, carrier, and packing recovery remains usable.
Terminal order purge remains bounded and non-starving. Omitting the adapter
preserves the normal manual flow.
Packing-work acceptance or packed status evidence does not prove commercial
shipment completion or add picking queues, bin/worker assignment, address,
rate, label, material inventory/reservation/purchase, or provider-specific WMS
protocols.

`NpShopCarrierAdapter` may book one
shipment with its stable shipment UUID as the provider idempotency key and may
consume a locked parcel snapshot through additive `bookShipmentWithParcels`,
authenticate tracking callbacks or reconcile tracking through bounded
server-only reads, and may retrieve an already-booked outbound or replacement
label through `readShippingLabel`. It may add `acquireShippingLabel` only with
that read capability; Shop then owns stable purchase/regeneration generations
and the adapter atomically replaces the opaque current label reference. A
parcel-aware adapter may additionally implement both
`schedulePickup` and `cancelPickup`; `createShop()` then requires at least one
outbound or replacement parcel-booking capability and one opaque
`pickupLocationReference` that only the provider can resolve. Shop owns
revision-safe selection and both PII-free commercial snapshots. The adapter
may additionally implement `listPickupWindows`; Shop then replaces arbitrary
Admin time input with a bounded short-lived provider-window inventory and
passes only the selected canonical UTC bounds to the unchanged scheduling
method. Approved
returns may independently add paired `createReturnShipment` /
`cancelReturnShipment` methods with one opaque `returnLocationReference`;
optional `readReturnLabel` bytes are delivered only to the owner and never
persisted. It may add `quoteReturnShipping` and `createQuotedReturnShipment`
together to freeze one short-lived exact postage method before v2 logistics
creation; v1 logistics creation remains valid. The same paired capability may independently add
`verifyReturnTrackingWebhook` and `readReturnTracking`; those methods receive
only the PII-free active return-shipment tuple and cannot complete warehouse
receipt, inventory restoration, or payment compensation.
The same carrier may add `bookExchangeShipment` and
`cancelExchangeShipment` together. Shop supplies one exact staff-accessed
replacement destination outside a transaction, deletes it only after durable
provider confirmation, persists stable booking/cancellation idempotency keys,
and blocks manual exchange operations while that provider intent exists.
It may additionally implement `bookExchangeShipmentWithParcels`; new provider
bookings then require an exact, revision-safe mm/gram parcel allocation over
every immutable replacement line. Shop locks that PII-free snapshot to the
durable replacement shipment UUID before provider I/O and reuses it unchanged
for every retry. The v1 replacement method remains valid when the additive v2
method is absent.
Replacement label bytes remain transient and direct-staff-only; the same
optional acquisition method serves the exact replacement booking before
verified tracking starts. The generic pickup methods consume
the exact locked replacement parcels without receiving exchange or PII data,
and an active pickup must be cancelled before provider shipment cancellation
or automatic inventory restoration. The existing tracking callback and polling
capabilities already serve completed replacement bookings without changing
exchange commercial state.
`@nexpress/shop-payment-stripe` is the bundled Stripe PaymentIntent initiation,
signed-webhook, full-refund, received-return partial-refund/return-postage
settlement, cumulative refund-reconciliation, and authenticated dispute-evidence adapter.
`@nexpress/shop-payment-toss` is the bundled Toss Payments v2 initiation,
full-refund, received-return partial-refund/return-postage settlement, and
query-verified cancellation reconciliation adapter. Customer/shipping PII exists only in the short-lived
private draft or order sidecar and stays outside content search, revisions,
payment receipts, and transfer. A durable `pending-payment` order reference
still does not imply that a visitor paid for a product.

See the [live Shop guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-shop.md)
for the exact price, SKU, inventory, wishlist, restock-alert, price-alert, review, Forum-backed inquiry, cart,
promotion, checkout-intent, private-draft, shipping-quote, tax-quote,
pending-order, payment-attempt/event/adjustment/dispute, fulfillment, parcel, carrier,
packaging-proposal, packing-work, label acquisition/read, pickup,
tracking/polling, full-refund, return-linked partial-refund, return,
same-item exchange, return-logistics, return-postage, return-postage settlement, skin, block, and
theme-integration contracts.
