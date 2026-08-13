# Roadmap Historical Snapshot

**Last reviewed:** 2026-07-18.

This file is preserved as the pre-publish roadmap snapshot from 2026-05-02.
It is no longer the current work queue: the npm publish path, CI triggers,
hosted demo work, mobile hardening, and agent-operated ops track have all moved
past the assumptions below.

Use this document for historical context and category vocabulary only. Current
implementation contracts live in the focused guides linked from
[`docs/README.md`](README.md), especially [`agent-operated-ops.md`](agent-operated-ops.md),
[`releasing.md`](releasing.md), [`deployment.md`](deployment.md), and
[`testing.md`](testing.md).

For the current pre-1.0 stability commitments, see the **STABILITY (pre-1.0)**
section in [`AGENTS.md`](../AGENTS.md) at the repo root. This file is the
historical roadmap; that section is the contract.

## Archived context — 0.1 in flight

The 0.1 surface is feature-frozen on the published `@nexpress/*` packages.
Everything below is shipped and merged on `main`:

- **Phase 1–17** — collections, blocks, editor, admin, themes, auth, jobs,
  plugins, i18n, search, SEO. The core CMS surface.
- **Phase 18** — multi-site scoping for the data pipeline and admin.
- **Phase 19** — worker heartbeat + job log surface.
- **Phase 20** — admin Jobs UI (manual enqueue, pause/resume, archive).
- **Phase 21** — WordPress import end-to-end (21.1–21.17, all follow-ups
  closed).
- **Phase 22** — publish-readiness sweep:
  - 22.1 changesets adopted
  - 22.2 unsafe-config warnings at boot
  - 22.3 ops runbook
  - 22.4 readiness probe round-trip for the job queue
  - 22.5 structured logging install guide
  - 22.6 domain-bounded subpath exports (`@nexpress/core/auth`, `/community`,
    `/db`, `/i18n`, `/jobs`, `/media`, `/observability`, `/seo`)
- **Post-22 hardening** — site-scope security fixes (#362–367),
  publish dry-run validation, package metadata + LICENSE sweep, per-package
  README stubs, README v1 surface refresh, author attribution rename,
  build/dev split (`NP_DEV_FAST`).

Historical note: this snapshot predated the active Release workflow with npm
Trusted Publishing and the restored PR/push CI triggers. For the current
publish flow, read [`releasing.md`](releasing.md) and `AGENTS.md` "NOTES".

## Categories of work between 0.1 and 1.0

These are the buckets we'll draw the next phase plans from. Each entry
includes the rough motivation so we can argue priority instead of just
ordering bullet points.

### 1. Publish & feedback loop

Ship 0.1 to npm, collect first external usage, and use that to validate the
v0.1 stability decisions before they harden into 1.0.

- Restore CI `push` / `pull_request` triggers once billing is unlocked.
- First `pnpm release` run; confirm provenance attestation lands.
- Set up an external-issue intake path (`good-first-issue`, `bug`,
  `feedback`) and a triage cadence.
- Capture install-time friction (`create-nexpress` first-run report, common
  error messages people Google for).

### 2. Production hardening

The first-week production hardening list has moved from "known limitation"
to shipped ops surface:

- **Multi-node rate limiting** — `@nexpress/core/rate-limit` defines the
  adapter contract, and `@nexpress/rate-limiter-redis` is the reference
  shared-store implementation.
- **Multi-node session / token revocation** — token-version invalidation is
  covered by the multi-instance verification path.
- **Job queue at scale** — worker heartbeat, pause/resume, stuck-job
  thresholds, retry/drain mutations, and recent-failure diagnostics are
  visible through admin and `nexpress ops jobs`.
- **Backup / restore** — backup manifests, verification, restore plans, and
  isolated restore apply are covered by `nexpress ops backup`.

Keep extending this section from real deploy friction rather than old
placeholder bullets. Current candidates belong under agent-operated ops,
plugin v2, or public issue intake depending on the failure mode.

### 3. Agent-operated operations CLI

The current agent surface is strong for content APIs, but deployment and
post-deploy operations are still split across docs, template scripts, and
admin screens. To support the positioning that an AI agent can develop,
deploy, and manage a NexPress site with low token usage, add deterministic
CLI contracts for the operational lifecycle. See
[`agent-operated-ops.md`](agent-operated-ops.md) for the detailed plan and
copy-pasteable issue backlog.

- **`nexpress ops status` / `doctor`** — one compact health contract with
  `--json`, `--brief`, `--prod`, `--fix-plan`, stable check IDs, and clear
  exit codes.
- **`nexpress deploy plan`** — machine-readable recipes for Docker, Vercel,
  and Fly.io, including required env vars, target-specific blockers, storage
  compatibility checks, and ordered commands.
- **Safe migrations** — `migrate status`, `plan`, `apply --safe`, and
  `rollback-plan`, with destructive SQL detection, advisory locking, backup
  gating, and readiness verification.
- **Backup / restore** — executable DB + media backup manifests, verification,
  restore plans, and production confirmation gates.
- **Jobs / storage / plugins** — operational subcommands for stale workers,
  queue backlog, media drift, S3 migration, plugin route conflicts, and v1
  rebuild / restart requirements.
- **Release and runbooks** — `release check/plan/apply/verify` plus
  `nexpress runbook <incident>` commands that return diagnosis, evidence,
  next commands, and rollback notes.

### 4. Plugin v2 (deferred — likely 1.x)

Current v1 is npm-package + rebuild, full Node access, no runtime collection
definition. The 0.1 cycle hardened the v1 surface (host hardening, schedule
reconcile, block SDK, scaffold + docs — see PRs #459 / #468 / #469 / #470 /
#471). What's left for v2 is the structural changes the v1 model can't
absorb without a redesign.

**Originally listed:**

- Hot-reload plugins (no rebuild loop).
- Runtime collection definition (today: codegen + migrate is mandatory).
- Sandbox / capability model for untrusted plugins.

**Surfaced during 0.1 review / dogfood (added 2026-05-05):**

- **Hot module reload for plugin handler code.** `/admin/plugins` "Reload all"
  rebuilds the in-memory registry and reconciles `pgboss.schedule`, but it
  doesn't bust the Node module cache. Editing
  `packages/plugins/<name>/src/index.ts` and clicking reload reuses the same
  handler closures captured at server boot. v2 wants a real dev-mode HMR
  signal (or a scoped `import.meta.hot` integration with the framework's
  bundler) so authoring iterates without restarting.

- **Cross-process worker reconcile.** Plugin schedule `boss.work()`
  registrations live in the worker process, separate from the admin web
  process. Today's reconcile updates `pgboss.schedule` rows but can't install
  new work loops in the worker — the admin toast warns "restart your worker
  process to pick up newly-added schedules." A real fix needs an
  out-of-band signal between processes (LISTEN/NOTIFY on a control channel,
  a "schedule version" row, or a sidecar reload trigger). See #461 and
  `docs/plugin-reload.md` for the limit; lifting it is a v2 task.

- **First-class anonymous principal in core auth.** `findDocuments` and
  `getDocumentById` accept `user?: NpAuthUser`, and the pipeline already
  treats `null` as "anonymous reader" for visibility filtering. But callers
  (the block render ctx, public-page renderers) still juggle synthesised
  principals or omit `user` and hope. v2 should give the auth model a real
  `null`-principal story — `NpAuthUser | { kind: "anonymous" }` or a
  `NpReader` interface — so consumers stop pretending and the access fns
  get a clearer contract. The synth-principal hack from PR #469 was
  removed in PR #469's last commit; the lack of a typed alternative
  remains.

- **Capability-aware `ctx` typing.** `manifest.capabilities` is enforced at
  runtime with `NpForbiddenError` but doesn't change the type of `ctx.*` —
  the SDK exports the same surface regardless of what the plugin declared.
  v2 should narrow `ctx` based on `capabilities` so missing-capability bugs
  surface at compile time, not the first request that hits a gated method.
  Requires `definePlugin<TConfig, TCaps>` plumbing + conditional types on
  every namespace; non-trivial but high authoring-quality payoff.

- **Block `propsSchema` ↔ `NpFieldConfig` unification.** Today blocks have
  their own field-type vocabulary (`text` / `select` / `array` / `image` /
  ...) that mirrors `NpFieldConfig` but is structurally separate. Plugin
  authors who already know the collection field system have to learn a
  second one. v2 should let `propsSchema` accept either shape and have the
  admin form-renderer dispatch — same form code, fewer concepts.

- **Plugin marketplace install + update flow.** PR #468 wired npm-registry
  search so the Discover panel shows installable plugins; the actual install
  still goes through the operator's terminal. v2 wants a "click to install"
  flow tied into the install-without-rebuild story below — neither piece
  ships independently of the other.

- **Sandbox / capability scoping at runtime.** v1 capabilities are an
  honor system: declaring `storage:kv` lets the plugin call `ctx.storage.*`,
  but nothing prevents a plugin from `import("pg")` directly and writing
  whatever it wants. v2 wants a real isolation story — VM context,
  worker_threads, or compile-time blocking of forbidden imports — so
  third-party plugins can be treated as untrusted code. This is the
  hardest item on the list and the most likely to slip past 1.x.

Probably 1.x, not 1.0. Calling it out so it doesn't accidentally creep into
0.x. The hot-reload / cross-process / anonymous-principal / typing items are
quality-of-life work that 1.x can absorb in stages; runtime sandboxing is
the structural change that defines a v2.

### 5. Developer experience & ecosystem

What a new developer sees in their first hour with NexPress.

- ~~Plugin author quickstart (single page: scaffold, hook, ship).~~
  Done in #471 — see `docs/plugin-quickstart.md` plus the dedicated
  `plugin-manifest.md` / `plugin-capabilities.md` / `plugin-reload.md`
  pages it links to. Five `nexpress create *-plugin` generators
  (block / hook / route / admin / scheduled) cover the scaffold step.
- Theme author quickstart (we have `theme-authoring.md`; needs an
  end-to-end example PR walkthrough).
- E2E test coverage on the reference app — Playwright covering the golden
  paths (sign in, publish a post, install a plugin, switch theme).
- Hosted demo deploy we can link from the README. Keep the public surface to
  the live demo link; operational details can stay out of the docs until they
  become reusable product behavior.
- WordPress importer admin UI — `/admin/import/wordpress` now covers WXR
  preview plus background apply with run history/progress, custom mappings,
  DB-backed resume markers, and bounded HTML/Lexical conversion samples. The
  CLI still owns exports beyond the admin upload cap and full filesystem
  artifacts such as complete HTML diff files or custom resume-marker paths.

### 6. API completeness

Surface gaps where v0.1 ships scaffolding but not the production-grade
implementation.

- **OAuth** — `@nexpress/plugin-oauth-github` and `-google` are wired but
  the boot warns "not configured"; a real-provider end-to-end test + clearer
  setup docs.
- **Email** — adapter interface is stable; the default is a stub. SES /
  Postmark / Resend reference implementations belong in the registry.
- **Search UX** — Postgres tsvector pipeline is in place and `/search`
  now has query retention, public-collection filters, pagination state,
  mobile-safe result cards, globally ranked built-in relevance, and
  built-in theme entry points. External-engine ranking adapters and
  per-site relevance knobs remain future quality work.
- **Notifications** — the member page now includes the in-app inbox,
  mark-read controls, per-kind toggles, and digest cadence. External
  realtime delivery and provider-specific email polish remain future
  quality work.

### 7. Stability promotion (Experimental → Stable)

Items originally tracked as Experimental in `AGENTS.md` for promotion before
1.0. Completed promotions stay listed here as historical decisions; the live
stable/experimental inventory remains in `AGENTS.md`.

- `NpRichTextContent` — promoted to the stable versioned NexPress envelope on
  2026-07-11; see [`rich-text.md`](rich-text.md).
- `NpBlockDefinition` props schema — promoted to the exact v1 discriminated
  union on 2026-07-18; author, runtime, Admin, discovery, OpenAPI, scaffold,
  and doctor surfaces now share the same 11 field types and semantics. See
  [`plugin-blocks.md`](plugin-blocks.md).
- Theme token names — promoted to the stable closed group/key inventory on
  2026-07-12. Persisted overrides, Admin/import APIs, plugin reads/writes,
  OpenAPI, and CSS generation now share the same fail-closed contract; see
  [`theme-authoring.md`](theme-authoring.md).
- Bootstrap singleton mutation (`setDb`, `setStorageAdapter`, `setJobQueue`, …)
  — moved to the experimental `@nexpress/core/bootstrap` host boundary on
  2026-07-14. Normal domain subpaths retain reads and operations only.

### 8. Multi-tenant features (deferred — partial 1.0)

Multi-site scoping is in. Theme selection now rides on top of it; the remaining
product features below are still deferred.

- Per-site theme selection — shipped. `np_settings.activeTheme` is keyed by
  `site_id`, and request execution resolves the active theme inside the
  canonical site scope.
- Per-site plugin enable/disable — shipped. `np_plugins` is the global code
  inventory and sparse `np_site_plugins` rows override activation per site;
  missing overrides are active by default.
- Per-site quotas (storage, post count, job throughput).
- Billing hooks (out of scope for the open-source core; document the
  extension point).

### 9. Plugin marketplace (deferred — 1.x)

A first-party way to discover, vet, and install plugins. The v1 plugin
model is npm-package + rebuild, so a marketplace today is a curated
list, not an installer. Building this properly depends on category 4
(Plugin v2) for the install-without-rebuild and trust pieces.

- **Discovery** — a `plugins.nexpress.dev`-style index pulling from a
  manifest registry (or scoped `@nexpress/*` npm scope), with categories,
  search, and screenshots.
- **Manifest schema** — extend `definePlugin()`'s manifest to carry the
  marketplace metadata (icon, screenshots, pricing tier, supported
  NexPress version range, capability requests).
- **Trust model** — package signing + checksum, optional curator review
  flag, capability disclosure shown at install time. Hard requirement
  before any "one-click install" flow.
- **Install UX** — `/admin/plugins` shows installed + available; install
  flow updates `nexpress.config.ts` (or a runtime registry once Plugin v2
  lands), runs migrations if any, surfaces errors.
- **Monetization hooks** — license key validation, checkout handoff to
  an external billing provider. Out of scope for the open-source core;
  document the extension point.

The MVP could ship on top of v1 as a _curated index page_ that just deep-
links to `npm install` instructions — that's a reasonable 1.0 step, with
the install-flow work waiting for Plugin v2.

### 10. First vertical: e-commerce / shop plugin (in progress — v0.x)

A reference vertical plugin that proves the plugin model can carry a
real product domain, not just blog/community. Ship as a plugin package
(`@nexpress/plugin-shop`) so the core stays a CMS.

- **Product catalog (shipped)** — collections for products, variants, categories.
  Built on top of the existing `defineCollection()` so admins get the
  full editing surface for free.
- **Member wishlists and one-shot alerts (shipped)** — saved products reuse the
  site-scoped follow graph. Independent 180-day restock and same-currency
  catalog-price alert contracts deliver preference-aware member-inbox events,
  retain 30-day dedupe receipts, expose PII-free Admin/Doctor health, and never
  imply cart, reservation, availability, promotion, or price guarantees.
- **Cart and checkout intent (shipped)** — bounded guest/member carts plus
  owner-scoped, idempotent 15-minute quote snapshots. Intents and private drafts
  retain their source cart; these stages do not collect PII in the cart, reserve
  stock, create orders, or take payment.
- **Private order draft (shipped)** — an open checkout intent can create one
  owner-scoped, revision-safe 24-hour draft with a minimal all-or-nothing
  customer/shipping contract. Cancellation physically deletes it; read-time
  and bounded hourly cleanup enforce expiry. Search, revisions, transfer,
  logs, public discovery, and Admin values exclude its PII.
- **Durable pending order (shipped)** — a reviewable draft atomically becomes
  one idempotent `pending-payment` commercial snapshot plus a separate private
  sidecar while deleting only its exact source cart in the same transaction.
  Idempotent replay never touches a newer cart. Cancellation, payment failure,
  or the 24-hour pending deadline deletes PII without automatically restoring
  cart state; successful payment promotes the sidecar to a fulfillment-only
  30-day maximum and the commercial record is normally purged after 365 days.
  Relationship-nonterminal Shop packing work may retain only its exact
  commercial source for fail-closed reconciliation; it never extends
  private-sidecar retention. Once the
  order leaves `pending-payment`, its owner can explicitly re-add current public
  product/variant lines under cart revision and 50-line/99-unit bounds, with
  per-line added/skipped outcomes and no old commercial values, reservations,
  or PII.
- **Inventory reservation (shipped)** — pending-order creation locks product
  ids canonically, subtracts active holds from current tracked product/variant
  stock, and atomically writes one exact PII-free reservation per tracked
  line. Cancellation and timeout release the hold; Admin exposes bounded
  aggregate, orphan, malformed, expiry, and recent-row diagnostics.
- **Signed callback transport (shipped)** — mutating plugin API routes may opt
  into one exact 1 MiB raw-body projection. The dispatcher validates declared
  length, bounds streamed bytes, skips JSON normalization, and advertises the
  mode through discovery and OpenAPI without choosing provider/payment policy.
- **Provider-neutral payment events (shipped)** — an optional build-time
  adapter authenticates exact callback bytes and projects one canonical event.
  Shop enforces a five-minute replay bound, site/order lookup, exact
  amount/currency matching, idempotent PII-free receipts, and terminal
  `paid` / `payment-failed` transitions.
- **Provider-neutral payment initiation (shipped)** — the same adapter may
  implement one all-or-none prepare/confirm/launcher contract. Shop owns
  15-minute owner-scoped idempotent attempts, exact order snapshot matching,
  bounded public handoffs, server confirmation, retry-safe ambiguous failure,
  PII-free Admin/Doctor inventory, and the existing atomic payment-event
  transition.
- **Toss Payments v2 adapter (shipped)** —
  `@nexpress/shop-payment-toss` owns the KRW browser SDK handoff, secret-key
  confirmation with attempt UUID idempotency, and query-verified terminal
  general-payment webhooks, including cumulative `CANCELED` and
  `PARTIAL_CANCELED` adjustment snapshots. It also owns exact full cancellation
  with the durable refund UUID as idempotency key. Stripe and KG Inicis
  packages remain future work.
- **Order fulfillment Admin (shipped)** — paid orders atomically create an
  independent awaiting/processing/shipped record. Revision-safe row actions,
  bounded PII-free notes and tracking, audited direct-staff private reads,
  shipment/30-day deletion, owner status, and bounded Doctor/Admin diagnostics
  share one contract. Provider-neutral carrier booking is an independent
  optional capability.
- **Fulfillment parcel snapshots (shipped)** — processing fulfillments may
  store one revision-safe PII-free snapshot of 1–20 prepared parcels with
  bounded integer millimetre dimensions, gram weights, and exact immutable
  order-line allocations. Concurrent edits, unknown or mismatched quantities,
  and post-booking changes fail closed. An additive carrier v2 capability
  atomically locks the snapshot to the durable shipment UUID before provider
  I/O, while existing v1 adapters and manual shipping stay independent. Audit,
  Admin/Doctor diagnostics, commercial cleanup, scaffold guidance, and
  PostgreSQL coverage share the contract. Labels, packaging proposals, and
  provider protocols remain separate.
- **Provider-neutral packaging proposals (shipped)** — one independent
  server-only `createShop({ packaging: { adapter } })` capability performs a
  read-only, side-effect-free calculation for exact processing-outbound or
  awaiting-replacement lines. PII-free product/SKU/quantity requests and exact
  parcel results expire after 60 seconds; provider I/O runs outside database
  transactions, then source and parcel revisions, allocation, booking absence,
  and shipment locks are rechecked before compare-and-swap storage. Existing
  manual parcel editing remains authoritative, while target-specific
  Admin/Doctor health records no provider payload. Providers map identifiers to
  their own measurements; WMS mutation, carrier booking/rates, addresses,
  labels, physical packing, and packaging-material inventory remain separate.
- **Provider-neutral packing-work intents (shipped)** — one independent
  server-only `createShop({ packing: { adapter } })` capability pairs exact
  create/cancel methods for processing outbound and awaiting same-item
  replacement targets. Shop freezes PII-free immutable lines and parcels,
  source/parcel revisions, and a parcel fingerprint behind stable operation
  UUIDs; provider I/O stays outside transactions and confirmation is durable
  before local active/cancelled state, with cancellation-dominant provider
  tombstones preventing late create resurrection. Active work blocks parcel
  edits; an exact parcel-aware booking attaches the same revision/fingerprint
  and local shipment completion consumes it. Only a cancelled, unattached
  tombstone reopens manual fallback. Before verified tracking, an attached
  cancellation may unwind only through cancellation of its exact shipment.
  After tracking, carrier cancellation and automatic restock fail closed while
  exact booked shipment completion remains possible and leaves any packing
  conflict diagnosed and retained. A WMS cancellation started before tracking
  may still reconcile or finalize under its same UUID. Stored
  `provider-confirmed` and `cancel-confirmed` transitions finish locally even
  after adapter removal; provider I/O still requires the original adapter.
  Direct full refund or replacement cancellation resolves packing and carrier
  effects before downstream compensation. Always-declared Admin/Doctor
  diagnostics, relationship-aware commercial cleanup, and bounded unresolved
  source retention—including cancelled shipment attachments until exact
  carrier compensation or tracking-won completion—share the contract without
  extending private customer/shipping retention.
  An optional exact raw callback on the same provider authenticates bounded
  PII-free `accepted | picking | failed | packed` evidence into conflict-safe
  receipts and monotonic status state. Packed evidence never completes a
  shipment or consumes work. Authoritative physical completion policy,
  picking/bin/worker coordination, addresses/rates/labels, material
  inventory/reservation/purchase, and provider-specific WMS polling remain
  separate.
- **Provider-neutral carrier shipment booking (shipped)** — one optional
  server-only adapter receives an exact fulfillment revision, immutable order
  lines, selected delivery snapshot, and private destination outside database
  transactions. A durable shipment UUID is the provider idempotency key;
  provider confirmation is persisted before one atomic shipped/tracking and
  private-data-deletion transition. Closed PII-free retry/manual-review state,
  direct-staff audit, Admin, Doctor, scaffold guidance, and integration tests
  share the contract. Labels, provider-specific tracking protocols,
  WMS mutation, customs, and jurisdiction policy remain separate.
- **Provider-neutral carrier pickup scheduling (shipped)** — parcel-aware
  outbound and same-item replacement carrier bookings may share paired
  schedule/cancel methods plus one server-only
  provider-owned opaque origin reference. Exact PII-free package summaries,
  live bounded UTC windows, stable pickup and cancellation idempotency,
  shipment-keyed independent state, provider confirmation before local
  completion, revision-safe resume, tracking-start closure, replacement
  cancellation-before-restock, direct-staff audit, commercial cleanup,
  Admin/Doctor, scaffold guidance, and PostgreSQL coverage share one durable
  contract.
  Label purchase, recurring pickup, general provider calendars, addresses,
  and provider-specific protocols remain separate.
- **Provider-neutral carrier pickup availability (shipped)** — pickup-capable
  adapters may add one exact `listPickupWindows` read over a completed outbound
  or replacement booking, opaque origin, and locked parcel snapshot. At most 20
  ordered UTC windows, a one-hour PII-free snapshot, revision-safe direct-staff
  selection, unchanged pickup v1 scheduling, single-use consumption, bounded
  cleanup, Admin/Doctor health, scaffold guidance, audit, and PostgreSQL
  coverage share the contract. General calendars, recurring pickup, charges,
  addresses, automatic scheduling, and provider protocols remain separate.
- **Provider-neutral carrier tracking events (shipped)** — carrier adapters may
  add one exact raw-body callback verifier that projects bounded PII-free
  `in-transit`, `out-for-delivery`, `delivered`, or `exception` events. Exact
  site/shipment/booking/tracking matching, five-minute callback replay, bounded
  provider delay, conflict-safe event ids, idempotent receipts, monotonic state,
  terminal delivery, owner projection, both skins, Admin, Doctor, scaffold,
  cleanup, and PostgreSQL integration coverage share the contract. Fulfillment
  remains `shipped`; labels, provider protocols, and service policy
  remain separate. Polling is the independent capability below.
- **Provider-neutral carrier tracking polling (shipped)** — carrier adapters may
  independently add one exact PII-free tracking read. A persisted five-minute
  lease precedes provider I/O outside database transactions; ten-minute due
  intervals, exponential five-minute-to-six-hour failure backoff, 25-item
  batches, and a site/provider cursor scanning at most 500 bookings keep work
  bounded and fair. Poll results reuse the webhook event digest, idempotency,
  monotonic state, and owner projection contracts. Direct-staff reconciliation,
  audit, Admin/Doctor diagnostics, scaffold guidance, cleanup, and PostgreSQL
  integration coverage share the contract. Labels and provider APIs
  remain separate.
- **Full refunds and inventory compensation (shipped)** — a refund-capable
  adapter receives one stable PII-free full-refund intent. Direct staff action,
  provider idempotency, exact result matching, `refunded` orders,
  refund-cancelled unshipped fulfillment, retained shipped fulfillment,
  all-or-none exact restock, manual-compensation state, audit, owner projection,
  Admin, and Doctor share the same contract.
- **Physical returns and receipt inventory (shipped)** — one shipped order may
  own one exact item-level return with owner request/cancellation, audited
  revision-safe staff approval/rejection/receipt, closed PII-free reasons,
  owner-safe projection, and all-or-none tracked inventory restoration.
  Exchanges, jurisdiction policy, and automatic payment refunds remain separate.
- **Received-return partial refunds (shipped)** — a payment adapter may add one
  exact partial refund for a received physical return. Immutable original item
  prices, explicit bounded shipping/tax allocation, a stable provider
  idempotency key, durable provider confirmation, full-refund exclusion,
  direct-staff audit, owner-safe projection, Admin/Doctor diagnostics, Toss,
  scaffold guidance, and PostgreSQL coverage share the contract. Receipt has
  already restored inventory, so partial-refund completion never repeats that
  transition or changes shipped fulfillment. Repeated or non-return partial
  refunds remain separate.
- **Provider-initiated payment adjustment convergence (shipped)** — payment
  adapters may project one exact cumulative cancellation snapshot after
  authenticating or authoritatively querying the provider. Shop serializes
  provider/event ids, requires monotonic unique cancellation entries and exact
  original/reversed/remaining totals, and stores PII-free receipts plus one
  order state. Exact existing full or return-linked refunds are matched without
  repeating inventory or fulfillment work. One previously unknown single full
  reversal atomically creates the durable full-refund projection, cancels an
  unshipped fulfillment, deletes private data, and attempts all-or-none tracked
  inventory restoration; unknown partial or multi-cancellation histories enter
  manual review and block fulfillment and further refunds. Admin/Doctor,
  scaffold guidance, Toss, cleanup, and PostgreSQL coverage share the contract.
  Disputes, chargebacks, settlement corrections, and automatic allocation of
  arbitrary partial reversals remain separate.
- **Provider-neutral approved-return logistics (shipped)** — carrier adapters
  may add one paired return-shipment create/cancel capability over an approved
  owner-scoped item return and completed outbound booking. Drop-off or bounded
  pickup mode, one stable provider idempotency tuple, a server-only opaque
  return destination, a maximum-24-hour private origin deleted after
  confirmation, durable two-stage reconciliation, transient owner label bytes,
  PII-free Admin/Doctor diagnostics, scaffold guidance, cleanup, both skins,
  and PostgreSQL coverage share the contract. Return postage charging,
  recurring pickup, automatic exchange/refund transitions, eligibility/payer policy, and
  provider protocols remain separate.
- **Provider-neutral outbound and replacement label acquisition (shipped)** —
  carrier adapters may add one `acquireShippingLabel` method alongside the
  existing transient `readShippingLabel`. Shop owns shipment-keyed purchase and
  regeneration generations, stable provider idempotency, calls outside database
  transactions, durable two-stage confirmation, atomic opaque-reference
  replacement, verified-tracking closure, Admin/Doctor, cleanup, scaffolds, and
  PostgreSQL coverage for both outbound and provider-booked same-item replacement
  shipments. Label bytes and URLs remain transient. Provider billing, paper
  layout, void/refund policy, and provider protocols remain separate.
- **Provider-neutral return-postage quote and selection (shipped)** — carrier
  adapters may add paired quote/create-v2 methods over approved-return
  logistics. One exact bounded same-currency method list, revision-safe owner
  selection, a maximum-one-hour private origin sidecar, provider I/O outside
  transactions, and an immutable PII-free method snapshot reach both skins,
  Storefront hooks, Admin/Doctor, cleanup, scaffolds, and PostgreSQL coverage.
  Existing v1 return creation stays valid. Charging, refund settlement,
  responsibility/jurisdiction policy, recurrence, and provider protocols remain
  separate additive contracts.
- **Quote-backed return-postage responsibility settlement (shipped)** — payment
  adapters may add one independent received-return settlement refund over the
  immutable active logistics quote. Direct staff designate merchant or customer
  responsibility; merchant responsibility absorbs the quote while customer
  responsibility deducts exactly that same-currency amount from one positive
  net refund. The existing one-refund storage, provider-confirmed recovery,
  cancellation reconciliation, Admin/Doctor, owner projection, both skins,
  Storefront hook, Toss, scaffolds, and PostgreSQL coverage share the PII-free
  contract. Separate charges, automatic/jurisdictional payer policy, different-item exchanges,
  arbitrary refunds, and provider protocols remain external.
- **Same-item replacement exchanges (shipped)** — one received physical return
  may create one exact replacement over its immutable product/SKU/quantity
  snapshot. Reservation-aware all-or-none inventory consumption, revision-safe
  awaiting/processing/shipped/cancelled state, cancellation restock, manual
  carrier/tracking or paired provider-neutral booking/cancellation with durable
  idempotency and reconciliation, plus an additive parcel-aware v2 that locks
  one exact mm/gram allocation over every immutable replacement line before
  provider I/O, owner notifications, both skins, Storefront hooks,
  Admin/Doctor, audit, cleanup, scaffolds, and PostgreSQL coverage share the
  PII-free contract. Owners submit one new address under a 15-minute
  revision-bound authority into a maximum-24-hour private sidecar; audited staff
  access is required before processing and processing/cancellation/expiry delete
  it. The existing label-read capability also serves completed provider-backed
  replacement bookings through one transient staff-only download with exact
  pre/post relationship validation and no byte persistence. The additive shared
  acquisition method also serves this exact replacement booking before verified
  tracking. Substitutions, payment
  differences, store credit, eligibility policy, automatic address correction,
  and automatic approval remain separate additive contracts.
- **Provider-neutral return tracking (shipped)** — optional exact raw-body
  callback and bounded polling capabilities advance one independent PII-free
  reverse-shipment state with stable receipts, leases/backoff, owner-visible
  projection, Admin/Doctor diagnostics, and PostgreSQL coverage. Delivery does
  not receive the physical return, restore inventory, or issue a refund.
- **Provider-neutral shipping quote and selection (shipped)** — one optional
  build-time server adapter receives the exact private draft destination and
  bounded cart snapshot outside database transactions. Exact short-lived
  methods become a revision-safe owner selection and one PII-free durable
  delivery snapshot; orders, payment attempts/events, and full refunds share
  `subtotalMinor + shippingMinor + taxMinor = totalMinor`. Closed PII-free provider health
  reaches Admin while Doctor verifies its declarative diagnostic contract.
  Return postage and provider-specific tracking, customs, and jurisdiction policy
  remain separate.
- **Provider-neutral additional-tax quote (shipped)** — one optional
  server-only adapter receives exact item/shipping totals, immutable lines,
  the private destination, and any selected delivery snapshot outside database
  transactions. Revision and expiry rechecks freeze one bounded PII-free
  component snapshot; orders, payment events, and full refunds share
  `subtotalMinor + shippingMinor + taxMinor = totalMinor`. Closed provider
  health reaches Admin and Doctor. The adapter reports only tax added on top of
  displayed prices; remittance/filing, invoices, exemptions/nexus,
  customs/duties, and jurisdiction compliance remain separate.
- **Inventory (shipped foundation)** — catalog stock/low-stock projection,
  transaction-safe pending holds, and atomic paid-order on-hand decrement
  plus exact unshipped full-refund restoration exist. Received-return partial
  refunds deliberately do not compensate inventory a second time. A verified
  single full provider reversal reuses the exact unshipped compensation rule;
  partial or cumulative ambiguity remains blocked manual review.
- **Order transition notifications (shipped)** — order, payment, fulfillment,
  delivery, return, and refund transitions atomically stage one PII-free owner
  timeline plus member-inbox/direct-email outbox. Raw recipient email stays in
  the bounded private sidecar, retries are leased and capped, stable event ids
  reconcile crashes, and Admin/Doctor expose delivery health.
- **Public surfaces (shipped)** — product detail, listing, wishlist, cart,
  checkout-intent, private order-draft, order-history, order-detail, and return
  intake pages use independent plugin skins and stable theme hooks. Order detail
  exposes the explicit current-catalog re-add action after `pending-payment`.
- **Tax compliance, carrier logistics, and shipping policy (future)** — shipping,
  additional-tax quote, carrier-booking, and packing-work intent boundaries are
  shipped; tax remittance/filing, invoices, exemptions/nexus, customs/duties,
  label billing/void policy, recurring pickup and general carrier calendars,
  provider APIs, physical packing completion evidence, picking/bin/worker
  coordination, packaging-material inventory, and regional policy require
  separate contracts.

Resolved foundation decision:

- Order drafts use bounded, site-owned plugin storage rather than content
  collections or a Shop-specific Core table. That keeps PII outside the
  collection search/revision/transfer graph while generic site deletion still
  owns the final tenant boundary.
- Durable orders use the same site owner but split the PII-free commercial
  snapshot, short-lived private sidecar, and maintenance marker into separate
  exact rows. This avoids generic collection search/revision/transfer leakage
  and does not add a Shop table to Core.

Resolved transaction decision:

- Shop owns one provider-neutral adapter and attempt lifecycle. Provider
  packages implement that contract without becoming standalone NexPress
  plugins or owning order/inventory persistence, so a project swaps providers
  in one build-time `createShop()` configuration.

This is the strongest signal that the v1 plugin model "works for real
verticals." If shop hits a wall the v1 plugin couldn't get over, that
becomes a Plugin v2 design input.

### 11. Docs & marketing

What a non-developer evaluator sees before they install.

- A docs site (separate Next.js app or Docusaurus) consuming the
  `docs/*.md` files.
- A "Why NexPress" landing page contrasting with WordPress / Payload /
  Strapi on the dimensions where v0.1 is differentiated.
- The WP migration guide (`wordpress-import-guide.md`) needs a screenshot
  walkthrough.

### 12. Multi-axis permission model (deferred — 1.x)

Today's `can(user, capability)` is single-axis: four capability strings
(`content.publish`, `content.author`, `community.moderate`,
`admin.manage`), no context argument, role → capability mapped through
a fixed switch. That works for single-board single-site installs.
Multi-board / multi-site operators need scoped grants.

NexPress already partitions data along several axes; permissions need
to follow:

1. **Site** (`site_id`) — data partitioned already; perms aren't. A
   site-admin on `acme.com` should not touch `other.com`.
2. **Collection** — staff member who edits posts shouldn't necessarily
   edit pages.
3. **Kind** (`posts.kind = article | doc | project`) — surfaced by the
   U-track collapse. Doc-writer vs blog-editor in the same `posts`
   collection.
4. **Category** — taxonomy under posts; possibly hierarchical
   (tech / tech.frontend / tech.backend grant tree).
5. **Forum / discussion** — `packages/plugins/forum` and any other
   plugin-contributed board surface.
6. **Member portal** — `/u/<handle>` surfaces, depending on what they
   eventually expose.

The U-track design sketched `can(user, cap, { collection, kind })`,
which covers only axes 2-3. The realistic shape is
`can(user, capability, { siteId?, collection?, kind?, category?, boardId? })`.

What this pulls in:

- **Data model** — `np_user_permissions(user_id, site_id?, collection?,
kind?, board_id?, capability, granted)` (or similar). Wildcards + deny
  rules. Inheritance: does a site admin auto-cover every collection on
  that site? Tree vs flat.
- **Performance** — `can()` is on every authz check, must not DB-hit.
  Needs in-memory cache with bust-on-permission-write.
- **Admin UX** — granting perms across N axes is an N-dimensional
  matrix. Not trivial.
- **Migration** — existing 5 roles (admin / editor / author / moderator
  / viewer) need a deterministic mapping into the new shape so existing
  installs stay functional through the cutover.
- **Paradigm choice** — RBAC vs ACL vs capability-graph. Different
  ergonomics for different operator shapes.

**Action when this opens**: write `docs/design/multi-axis-permissions.md`
FIRST, listing axes, 5-10 operator personas, API candidates, and
trade-offs. Don't go straight to code; the design space is wide enough
that getting the API shape wrong costs more than the speculative wait.
Wait for at least one concrete operator with this need to validate the
personas before locking the design.

## Recommended next phase

Of the twelve categories, **1 + 2 + 3 + 5** is the natural Phase 23 cluster:

1. Publish 0.1 and watch what breaks for real users.
2. Fix the production-hardening items those users hit first.
3. Add the first agent-operated ops contracts (`ops status`, `doctor`, and
   `deploy plan`) so the AI-operated positioning is demonstrable.
4. Tighten DX so a curious evaluator becomes a contributor.

4, 7, 8, 9, 10, 12 are 1.x candidates. 6 and 11 are continuous — they
advance one issue at a time as 1, 2, 3, and 5 surface gaps. Category 9
(marketplace) has an MVP path that _can_ land in 1.0 as a curated index;
the install-flow piece waits on category 4. Category 12 (multi-axis
perms) waits for a real operator with that shape — premature design
risks locking in the wrong API.

## Open questions

These were the load-bearing decisions that shaped the Phase 23 planning window.
Several are now resolved; keep this list as context, not as an active blocker
list.

- **CI billing** — is there an estimated unlock date, or should we plan
  Phase 23 work assuming `workflow_dispatch`-only?
- **First-publish scope** — do we publish all `@nexpress/*` at once, or
  start with `@nexpress/core` + `@nexpress/next` and add the rest in 0.2?
- **Demo deploy** — Vercel? Self-hosted? Where does the URL go?
- **Plugin v2 timing** — confirm 1.x, not 1.0. Locking that in now lets
  Phase 23 ignore plugin internals.
- **Stability promotion** — pick _one_ item from category 7 to land in
  Phase 23 so we keep momentum on the contract surface; defer the rest.
- **Marketplace MVP timing** — does the curated-index version of
  category 9 land in 1.0 (alongside 1, 2, 3, 5), or stay parked until
  Plugin v2? Trade-off: shipping a curated index early gives the
  ecosystem a focal point; shipping after Plugin v2 means one
  install-UX, not two.
- **Shop plugin status** — confirm category 10 is a _plugin_, not a core
  module. Locking that now keeps the e-commerce work from leaking
  into core APIs.

Once these are answered the corresponding category bullets become
sub-phases (23.1, 23.2, …) in a fresh design doc under `docs/design/`.
