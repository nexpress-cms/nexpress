# Roadmap

**Last updated:** 2026-05-02

This is the working roadmap from 0.1 toward 1.0. It is not a contract — it is
the running shortlist that captures *what's done*, *what's next*, and *what's
deferred*. Update it as work lands or priorities shift.

For the v0.1 stability commitments themselves, see the **STABILITY (v0.1)**
section in [`AGENTS.md`](../AGENTS.md) at the repo root. This file is the
roadmap; that section is the contract.

## Where we are (0.1 in flight)

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

The blocker on the actual `npm publish` is the GitHub Actions billing lock
(`workflow_dispatch`-only on `ci.yml` and `release.yml`); see the **NOTES**
section in `AGENTS.md`. When billing clears, the changeset queue ships and
the first 0.1 release is published with provenance.

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

Things a real production deploy hits inside the first week. Most are known
limitations called out in `AGENTS.md`.

- **Multi-node rate limiting** — replace the in-process per-IP buckets in
  `apps/web/src/proxy.ts` with an upstream-rate-limiter contract or
  pluggable adapter (issue #269).
- **Multi-node session / token revocation** — `tokenVersion` lives on the
  user row already; document and verify the bump path under
  multi-instance load.
- **Storage** — `LocalStorageAdapter` is documented as not multi-node safe;
  surface a clearer "use S3 in production" failure mode at boot when
  `NP_STORAGE_ADAPTER=local` and `NP_REPLICAS>1`-style hint is set.
- **Job queue at scale** — heartbeat exists; add a "stuck job" detector and
  a worker-pause UX for incident response.
- **Backup / restore docs** — pg_dump recipe, media bucket sync, settings
  export. Operations runbook covers incidents; the inverse (planned
  maintenance) is thin.

### 3. Plugin v2 (deferred — likely 1.x)

Current v1 is npm-package + rebuild, full Node access, no runtime collection
definition. These are the obvious next steps but each is a research project,
not a sprint.

- Hot-reload plugins (no rebuild loop).
- Runtime collection definition (today: codegen + migrate is mandatory).
- Sandbox / capability model for untrusted plugins.

Probably 1.x, not 1.0. Calling it out so it doesn't accidentally creep into
0.x.

### 4. Developer experience & ecosystem

What a new developer sees in their first hour with NexPress.

- Plugin author quickstart (single page: scaffold, hook, ship).
- Theme author quickstart (we have `theme-authoring.md`; needs an
  end-to-end example PR walkthrough).
- E2E test coverage on the reference app — Playwright covering the golden
  paths (sign in, publish a post, install a plugin, switch theme).
- A demo deploy of `apps/web` we can link from the README.
- Migration UI for the WordPress importer — CLI exists; admins want a
  drag-and-drop WXR uploader with progress.

### 5. API completeness

Surface gaps where v0.1 ships scaffolding but not the production-grade
implementation.

- **OAuth** — `@nexpress/plugin-oauth-github` and `-google` are wired but
  the boot warns "not configured"; a real-provider end-to-end test + clearer
  setup docs.
- **Email** — adapter interface is stable; the default is a stub. SES /
  Postmark / Resend reference implementations belong in the registry.
- **Search UX** — Postgres tsvector pipeline is in place; the `/search`
  page is functional but minimal. Faceted filters, relevance tuning,
  per-collection scopes.
- **Notifications** — digest job exists; per-member preferences UI is
  partial.

### 6. Stability promotion (Experimental → Stable)

Items currently listed as Experimental in `AGENTS.md` that we'd like to
promote before 1.0. Each promotion is a contract decision.

- `NpRichTextContent` — can we hide the Lexical JSON shape behind a
  versioned wrapper so a Lexical major bump isn't a breaking change for
  consumers?
- `NpBlockDefinition` props schema — current shape is the v1, but block
  types added since launch have stretched it. Reconcile or version.
- Theme token names — pick a token system (Style Dictionary? open-ui?) and
  commit to its key shapes.
- Bootstrap singletons (`setDb`, `getDb`, …) — move to
  `@nexpress/core/bootstrap` subpath or mark `@internal`. They're public
  today only because `@nexpress/next` needs them.

### 7. Multi-tenant features (deferred — partial 1.0)

Multi-site scoping is in. The product features that ride on top of it are
not.

- Per-site theme override (today: theme is global by `np_settings.activeTheme`).
- Per-site plugin enable/disable.
- Per-site quotas (storage, post count, job throughput).
- Billing hooks (out of scope for the open-source core; document the
  extension point).

### 8. Plugin marketplace (deferred — 1.x)

A first-party way to discover, vet, and install plugins. The v1 plugin
model is npm-package + rebuild, so a marketplace today is a curated
list, not an installer. Building this properly depends on category 3
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

The MVP could ship on top of v1 as a *curated index page* that just deep-
links to `npm install` instructions — that's a reasonable 1.0 step, with
the install-flow work waiting for Plugin v2.

### 9. First vertical: e-commerce / shop plugin (deferred — 1.x)

A reference vertical plugin that proves the plugin model can carry a
real product domain, not just blog/community. Ship as a plugin package
(`@nexpress/plugin-shop`) so the core stays a CMS.

- **Product catalog** — collections for products, variants, categories.
  Built on top of the existing `defineCollection()` so admins get the
  full editing surface for free.
- **Cart & checkout** — member-scoped cart (reuses the member model),
  pluggable payment adapter (Stripe / Toss / KG Inicis as reference
  implementations).
- **Order admin** — orders collection with status workflow, refunds,
  fulfillment notes. Slots into the existing admin shell.
- **Inventory** — stock tracking, low-stock alerts via the jobs queue.
- **Public surfaces** — product detail, listing, cart, checkout pages
  shipped as theme partials so any active theme can adopt them.
- **Tax & shipping** — extension points; plugin ships sane defaults but
  not a full ruleset (region-specific).

Open questions before committing:
- Does this stay a plugin, or does the product catalog *collection
  pattern* prove general enough to belong in core (and the rest of
  e-commerce stays a plugin)?
- Payment adapter contract — single shared interface, or per-plugin
  implementation? The latter is simpler; the former lets users swap
  providers without changing other plugins.

This is the strongest signal that the v1 plugin model "works for real
verticals." If shop hits a wall the v1 plugin couldn't get over, that
becomes a Plugin v2 design input.

### 10. Docs & marketing

What a non-developer evaluator sees before they install.

- A docs site (separate Next.js app or Docusaurus) consuming the
  `docs/*.md` files.
- A "Why NexPress" landing page contrasting with WordPress / Payload /
  Strapi on the dimensions where v0.1 is differentiated.
- The WP migration guide (`wordpress-import-guide.md`) needs a screenshot
  walkthrough.

## Recommended next phase

Of the ten categories, **1 + 2 + 4** is the natural Phase 23 cluster:

1. Publish 0.1 and watch what breaks for real users.
2. Fix the production-hardening items those users hit first.
4. Tighten DX so a curious evaluator becomes a contributor.

3, 6, 7, 8, 9 are 1.x candidates. 5 and 10 are continuous — they advance
one issue at a time as 1, 2, 4 surface gaps. Category 8 (marketplace)
has an MVP path that *can* land in 1.0 as a curated index; the install-
flow piece waits on category 3.

## Open questions

These are the load-bearing decisions that should be made before Phase 23
formally opens, because they shape the work inside it.

- **CI billing** — is there an estimated unlock date, or should we plan
  Phase 23 work assuming `workflow_dispatch`-only?
- **First-publish scope** — do we publish all `@nexpress/*` at once, or
  start with `@nexpress/core` + `@nexpress/next` and add the rest in 0.2?
- **Demo deploy** — Vercel? Self-hosted? Where does the URL go?
- **Plugin v2 timing** — confirm 1.x, not 1.0. Locking that in now lets
  Phase 23 ignore plugin internals.
- **Stability promotion** — pick *one* item from category 6 to land in
  Phase 23 so we keep momentum on the contract surface; defer the rest.
- **Marketplace MVP timing** — does the curated-index version of
  category 8 land in 1.0 (alongside 1, 2, 4), or stay parked until
  Plugin v2? Trade-off: shipping a curated index early gives the
  ecosystem a focal point; shipping after Plugin v2 means one
  install-UX, not two.
- **Shop plugin status** — confirm category 9 is a *plugin*, not a core
  module. Locking that now keeps the e-commerce work from leaking
  into core APIs.

Once these are answered the corresponding category bullets become
sub-phases (23.1, 23.2, …) in a fresh design doc under `docs/design/`.
