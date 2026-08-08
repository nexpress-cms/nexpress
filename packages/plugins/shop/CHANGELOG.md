# @nexpress/plugin-shop

## 0.4.3

### Patch Changes

- ae2cd03: Add provider-neutral cumulative payment-adjustment events that reconcile known
  refunds, safely compensate unknown single full reversals, block ambiguous
  partial adjustments, and expose exact Toss, Admin, Doctor, scaffold, and
  PostgreSQL coverage.
- 5560f00: Add exact Admin table row actions and trusted action invocation context, then use them for revision-safe Shop fulfillment, audited staff-only shipping-data access, shipment/30-day private-data deletion, owner tracking status, diagnostics, scaffolds, and documentation.
- b2121ee: Add private Admin-managed Shop shipping policies with deterministic base rates, free-shipping thresholds, Korean destination and cart surcharges, external-adapter precedence, frozen order totals, diagnostics, generated schema, and scaffold guidance.
- 5e01252: Add automatic and coupon-based Shop promotions with deterministic discount snapshots, bounded usage reservations, Admin diagnostics, storefront controls, generated schema, and scaffold guidance.
- 9c0fc98: Add transaction-safe Shop inventory reservations for durable pending orders.
  Tracked product and variant quantities now subtract active PII-free holds at
  the cart and order boundary, concurrent orders serialize by product, and
  cancellation or timeout atomically releases reservations. Admin health,
  bounded recent rows, docs, scaffold guidance, and Postgres integration
  coverage expose the same contract without implying payment or on-hand stock
  decrement.
- b867ddc: Reuse one ordinary Forum board for optional Shop product inquiries. The
  independent packages now share a structural build-time bridge with signed live
  product context, existing Forum audience/moderation/attachment policy,
  staff-owned rich-text answers, author notifications, bounded Admin health,
  complete skin fallbacks, Storefront hooks, generated schema, and scaffold
  guidance without adding a parallel inquiry collection.
- 1b34745: Add bounded site-owned Shop carts for guests and members, including signed
  guest identity, revision-safe mutations, live product/variant quotes, cart
  skins, Admin health and cleanup, an hourly expiry task, and member identity on
  plugin API route requests. Checkout, payment, orders, and inventory reservation
  remain explicitly outside the contract.
- 559fb31: Add a durable PII-free Shop order-update timeline and bounded transactional
  member-inbox/email outbox across order, payment, fulfillment, delivery, return,
  and refund transitions. Recipient email stays in a maximum-24-hour private
  sidecar, Admin and Doctor expose only closed delivery health, and generated
  project guidance documents the at-least-once email boundary.
- a487b2f: Add one provider-neutral partial refund contract linked to a received physical
  return, including exact allocation, durable reconciliation, Admin and Doctor
  diagnostics, owner projection, Toss cancellation support, and scaffold guidance.
- 25f8112: Add an optional provider-neutral carrier tracking webhook contract with exact raw callback verification, idempotent PII-free receipts, monotonic owner-visible delivery state, Admin and Doctor diagnostics, scaffold guidance, and integration coverage.
- 33d4c85: Add member Shop wishlists over the shared site-scoped follow graph, including bounded batch state reads, complete Shop skin routes and actions, PII-free Admin diagnostics, independent Storefront styling, and scaffold guidance.
- 44cb5e7: Add exact owner-scoped durable pending Shop orders with atomic draft
  conversion, immutable commercial snapshots, separate short-lived private
  sidecars, bounded history and PII-free Admin diagnostics, revision-safe
  cancellation, 24-hour private-data deletion, and 365-day commercial cleanup.
  Payment success, inventory reservation, tax, shipping, fulfillment, and
  refunds remain explicitly outside the contract.
- d5ebd9b: Add provider-neutral, PII-free carrier tracking polling with persisted leases, cursor-fair scheduled batches, bounded retry backoff, audited manual reconciliation, and Admin/Doctor diagnostics, and update generated project guidance for the additive adapter capability.
- ef03370: Add independent one-shot member alerts when an exact Shop product or enabled
  variant catalog price falls below its captured same-currency baseline. Product
  hooks and bounded reconciliation share stable inbox dedupe, Admin and Doctor
  diagnostics, both Shop skins, Storefront hooks, and generated-project guidance.
- 9470eee: Add provider-neutral, owner-scoped Shop payment attempts with bounded public
  handoffs, server-side confirmation, exact stored-order matching, retry-safe
  provider failures, PII-free Admin diagnostics, and the existing atomic
  receipt/inventory transition. Ship the first Toss Payments v2 adapter with KRW
  browser initiation, secret-key idempotent confirmation, query-verified terminal
  webhooks, scaffold guidance, and complete tests and live documentation.
- 6b8cd26: Add the first-party Shop catalog and independent Storefront theme, including
  bounded product/category collections, exact integer-money and inventory
  contracts, public routes, skins, blocks, Admin metrics, scaffold defaults, and
  generated migrations. Text fields marked `unique` now receive a site-scoped
  database unique index, making product SKU uniqueness race-safe.
- 089f584: Add revision-safe PII-free fulfillment parcel snapshots with exact order-line allocations, audited Admin/Doctor diagnostics, commercial cleanup, and an additive parcel-aware carrier booking capability, and update generated project guidance.
- e2b1197: Add owner-scoped item-level Shop returns with audited staff decisions, receipt-time all-or-none inventory restoration, Admin/Doctor diagnostics, storefront intake, and scaffold guidance.
- 7088ce6: Add exact owner-scoped 24-hour Shop order drafts with revision-safe bounded
  customer and shipping details, private no-store APIs, complete skin and
  Storefront hooks, masked Admin/Doctor health, immediate cancellation deletion,
  and bounded expiry cleanup. Finalized orders, payment, inventory reservation,
  tax, and shipping calculation remain explicitly outside the contract.
- 4943aa2: Add exact owner-scoped Shop checkout intents with a fixed 15-minute lifetime,
  idempotent and capacity-bounded creation, live cart revalidation, cancellation,
  Admin health and cleanup, complete skin fallbacks, independent Storefront
  styling hooks, integration coverage, and scaffold guidance. Payment, orders,
  customer PII, and inventory reservation remain explicitly outside the contract.
- c7fbd4c: Add a provider-neutral, parcel-aware Shop carrier pickup scheduling and cancellation contract with durable reconciliation, Admin and Doctor diagnostics, scaffold guidance, and integration coverage.
- 8250b4b: Add an optional provider-neutral payment adapter with exact raw webhook verification, replay-bounded idempotent receipts, terminal paid or failed order transitions, atomic inventory consumption or release, PII-free Admin diagnostics, and updated Shop/scaffold guidance.
- 9414257: Add durable provider-neutral full refunds with audited Admin actions, resumable provider confirmation, safe inventory compensation, owner and Doctor projections, and exact Toss payment cancellation.
- f40a639: Add an optional provider-neutral Shop shipping quote adapter, revision-safe
  delivery method selection, PII-free commercial delivery snapshots, exact
  subtotal/shipping/total order money, payment and full-refund total matching,
  Storefront selection UI, PII-free Admin provider health, and a
  Doctor-verifiable diagnostic action. Refresh generated-project guidance for
  configuring the server-only adapter.
- a1a57a0: Add owner-scoped provider return logistics for approved Shop returns with paired create/cancel idempotency, drop-off or bounded pickup mode, maximum-24-hour private origin storage deleted after confirmation, transient return-label downloads, Admin/Doctor diagnostics, storefront UI, scaffold guidance, and PostgreSQL integration coverage.
- 909c42f: Add independent provider-neutral reverse-shipment webhook and polling contracts over active Shop return logistics, with owner status, Admin and Doctor diagnostics, scaffold guidance, and no automatic warehouse receipt, inventory restoration, or refund.
- 2a700c3: Add an optional provider-neutral carrier shipment adapter with durable idempotent booking, resumable confirmation, atomic fulfillment/private-data completion, Admin and Doctor diagnostics, and generated-project guidance.
- 190bd9c: Add independent member-owned one-shot Shop restock alerts with bounded reconciliation, preference-aware inbox delivery, Admin and Doctor diagnostics, complete skin/theme hooks, and scaffold guidance.
- d39f368: Add bounded binary plugin API responses and authenticated declarative Admin
  downloads, then let Shop carrier adapters retrieve already-booked PDF, PNG, or
  ZPL shipping labels through a PII-free, staff-audited, transient byte contract.
- cc2bc2c: Add one exact verified-purchase product-review contract. Shipped member order
  lines receive short-lived signed eligibility, persist only one-way purchase
  keys, and support bounded ratings, text, photos, member edits/deletes, exact
  public aggregates, safe author projections, audited Admin hide/restore,
  runtime health, both Shop skins, and independent Storefront theme hooks. Fresh
  project guidance now includes the shipped-purchase review flow.
- 9e23204: Add an optional provider-neutral Shop additional-tax quote adapter, exact
  revision-safe and expiry-bounded requests, PII-free component snapshots,
  subtotal/shipping/tax/total invariants across orders, payment, and full
  refunds, owner-facing breakdowns, closed Admin health diagnostics, and
  generated-project configuration guidance.
- Updated dependencies [5560f00]
- Updated dependencies [1b34745]
- Updated dependencies [33d4c85]
- Updated dependencies [6b8cd26]
- Updated dependencies [bd52dc5]
- Updated dependencies [d39f368]
- Updated dependencies [cc2bc2c]
  - @nexpress/core@0.4.3
  - @nexpress/plugin-sdk@0.4.3
  - @nexpress/editor@0.4.3
  - @nexpress/next@0.4.3
