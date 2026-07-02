# Roadmap Historical Snapshot

**Last reviewed:** 2026-06-17.

This file is preserved as the pre-publish roadmap snapshot from 2026-05-02.
It is no longer the current work queue: the npm publish path, CI triggers,
hosted demo work, mobile hardening, and agent-operated ops track have all moved
past the assumptions below.

Use this document for historical context and category vocabulary only. Current
implementation contracts live in the focused guides linked from
[`docs/README.md`](README.md), especially [`agent-operated-ops.md`](agent-operated-ops.md),
[`releasing.md`](releasing.md), [`deployment.md`](deployment.md), and
[`testing.md`](testing.md).

For the v0.1 stability commitments themselves, see the **STABILITY (v0.1)**
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
  their own field-type vocabulary (`text` / `select` / `array` / `media` /
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
  preview/apply. Remaining polish is background progress for very large
  imports; the CLI still owns resume markers, custom mappings, and HTML diff
  reports.

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
- **Notifications** — digest job exists; per-member preferences UI is
  partial.

### 7. Stability promotion (Experimental → Stable)

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

### 8. Multi-tenant features (deferred — partial 1.0)

Multi-site scoping is in. The product features that ride on top of it are
not.

- Per-site theme override (today: theme is global by `np_settings.activeTheme`).
- Per-site plugin enable/disable.
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

### 10. First vertical: e-commerce / shop plugin (deferred — 1.x)

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

- Does this stay a plugin, or does the product catalog _collection
  pattern_ prove general enough to belong in core (and the rest of
  e-commerce stays a plugin)?
- Payment adapter contract — single shared interface, or per-plugin
  implementation? The latter is simpler; the former lets users swap
  providers without changing other plugins.

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
