# @nexpress/theme-storefront

## 0.4.3

### Patch Changes

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
- 33d4c85: Add member Shop wishlists over the shared site-scoped follow graph, including bounded batch state reads, complete Shop skin routes and actions, PII-free Admin diagnostics, independent Storefront styling, and scaffold guidance.
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
- Updated dependencies [6b8cd26]
- Updated dependencies [bd52dc5]
- Updated dependencies [d39f368]
- Updated dependencies [cc2bc2c]
  - @nexpress/core@0.4.3
  - @nexpress/blocks@0.4.3
  - @nexpress/editor@0.4.3
  - @nexpress/next@0.4.3
  - @nexpress/theme@0.4.3
