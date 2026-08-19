# @nexpress/theme-storefront

## 0.4.6

### Patch Changes

- Updated dependencies [b0ee8a7]
  - @nexpress/core@0.4.6
  - @nexpress/blocks@0.4.6
  - @nexpress/editor@0.4.6
  - @nexpress/next@0.4.6
  - @nexpress/theme@0.4.6

## 0.4.5

### Patch Changes

- Updated dependencies [307c4c1]
  - @nexpress/core@0.4.5
  - @nexpress/blocks@0.4.5
  - @nexpress/editor@0.4.5
  - @nexpress/next@0.4.5
  - @nexpress/theme@0.4.5

## 0.4.4

### Patch Changes

- @nexpress/blocks@0.4.4
- @nexpress/core@0.4.4
- @nexpress/editor@0.4.4
- @nexpress/next@0.4.4
- @nexpress/theme@0.4.4

## 0.4.3

### Patch Changes

- ae21784: Require owners to submit a new short-lived replacement delivery address for same-item exchanges under a revision-bound authority, audit direct-staff access before processing, delete private data at every lifecycle boundary, and expose the PII-free state across Admin, Doctor, skins, Storefront hooks, scaffolds, and documentation.
- b867ddc: Reuse one ordinary Forum board for optional Shop product inquiries. The
  independent packages now share a structural build-time bridge with signed live
  product context, existing Forum audience/moderation/attachment policy,
  staff-owned rich-text answers, author notifications, bounded Admin health,
  complete skin fallbacks, Storefront hooks, generated schema, and scaffold
  guidance without adding a parallel inquiry collection.
- 5197814: Reuse the exact carrier callback and bounded polling contracts for provider-booked same-item replacement tracking, with separate owner-visible state, Admin and Doctor diagnostics, cancellation safety, Storefront hooks, and updated scaffold guidance.
- 1b34745: Add bounded site-owned Shop carts for guests and members, including signed
  guest identity, revision-safe mutations, live product/variant quotes, cart
  skins, Admin health and cleanup, an hourly expiry task, and member identity on
  plugin API route requests. Checkout, payment, orders, and inventory reservation
  remain explicitly outside the contract.
- 9cb5a22: Add a paired provider-neutral same-item exchange carrier booking and
  cancellation contract with durable idempotency and reconciliation, exact
  private-destination deletion, Admin and Doctor diagnostics, owner/theme hooks,
  PostgreSQL coverage, and generated-project guidance while retaining the manual
  exchange flow.
- 493ae13: Add optional provider-neutral return-postage quoting and revision-safe selection for approved returns, including short-lived private origins, immutable logistics snapshots, Shop UI and diagnostics, Storefront styling hooks, and scaffold guidance.
- 33d4c85: Add member Shop wishlists over the shared site-scoped follow graph, including bounded batch state reads, complete Shop skin routes and actions, PII-free Admin diagnostics, independent Storefront styling, and scaffold guidance.
- 6857add: Add staff-designated quote-backed return-postage responsibility settlement with exact merchant absorption or customer refund deduction, durable reconciliation, Toss support, Admin/Doctor visibility, owner UI, Storefront hooks, and scaffold guidance.
- ebd0422: Atomically consume a checkout's exact source cart and let owners explicitly re-add current catalog items from resolved orders.
- 44cb5e7: Add exact owner-scoped durable pending Shop orders with atomic draft
  conversion, immutable commercial snapshots, separate short-lived private
  sidecars, bounded history and PII-free Admin diagnostics, revision-safe
  cancellation, 24-hour private-data deletion, and 365-day commercial cleanup.
  Payment success, inventory reservation, tax, shipping, fulfillment, and
  refunds remain explicitly outside the contract.
- ef03370: Add independent one-shot member alerts when an exact Shop product or enabled
  variant catalog price falls below its captured same-currency baseline. Product
  hooks and bounded reconciliation share stable inbox dedupe, Admin and Doctor
  diagnostics, both Shop skins, Storefront hooks, and generated-project guidance.
- 6b8cd26: Add the first-party Shop catalog and independent Storefront theme, including
  bounded product/category collections, exact integer-money and inventory
  contracts, public routes, skins, blocks, Admin metrics, scaffold defaults, and
  generated migrations. Text fields marked `unique` now receive a site-scoped
  database unique index, making product SKU uniqueness race-safe.
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
- d38d7d0: Add one received-return same-item replacement exchange contract with
  reservation-aware inventory, Admin operations and diagnostics, owner status and
  notifications, independent Storefront styling, and scaffold guidance.
- 190bd9c: Add independent member-owned one-shot Shop restock alerts with bounded reconciliation, preference-aware inbox delivery, Admin and Doctor diagnostics, complete skin/theme hooks, and scaffold guidance.
- cc2bc2c: Add one exact verified-purchase product-review contract. Shipped member order
  lines receive short-lived signed eligibility, persist only one-way purchase
  keys, and support bounded ratings, text, photos, member edits/deletes, exact
  public aggregates, safe author projections, audited Admin hide/restore,
  runtime health, both Shop skins, and independent Storefront theme hooks. Fresh
  project guidance now includes the shipped-purchase review flow.
- Updated dependencies [5560f00]
- Updated dependencies [1b34745]
- Updated dependencies [33d4c85]
- Updated dependencies [772f58b]
- Updated dependencies [6b8cd26]
- Updated dependencies [bd52dc5]
- Updated dependencies [d39f368]
- Updated dependencies [cc2bc2c]
  - @nexpress/core@0.4.3
  - @nexpress/blocks@0.4.3
  - @nexpress/editor@0.4.3
  - @nexpress/next@0.4.3
  - @nexpress/theme@0.4.3
