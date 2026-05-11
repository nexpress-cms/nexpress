# @nexpress/web

## 0.1.0

### Minor Changes

- ae0c053: The page-edit "In navigation" panel now works for any
  page-shaped collection, not just the reference `pages`
  collection. Adding a doc from a `landing-pages` or
  `static-pages` collection produces a nav item that resolves to
  the doc's correct public URL — previously, the URL resolver
  was hardcoded to look up doc ids in the `pages` collection,
  silently returning `#` when the panel was opted into elsewhere.

  How it works:
  - `NpNavItem` gains an optional `collectionSlug` field. When
    set on a `type: "page"` item, the URL resolver looks the doc
    up in that collection instead of `pages`.
  - The resolver now drives URLs through each collection's
    `seo.urlPath` (the same contract the sitemap and RSS feed
    use), so the per-collection URL convention is honored
    automatically. The reference `pages` collection's existing
    `seo.urlPath` produces the same URLs it always did — fully
    back-compat.
  - The `NavMembershipPanel` accepts a `collectionSlug` prop
    (defaults to `"pages"`), passes it through to the membership
    endpoint as `?collection=<slug>`, and stamps it on new nav
    items only when it differs from `"pages"` so the wire format
    for the common case stays minimal.
  - The `create-nexpress` page template gains an explicit
    `seo.urlPath` definition. This was previously implicit — the
    resolver hard-coded the same logic as a fallback — but with
    the resolver now generic, the template needs to declare its
    own URL contract. Sitemap support comes along for free.

- 2f36e2e: Settings → Navigation gains a "Manage locations…" surface so
  operators can rename or delete custom slots without dropping into
  SQL. The dropdown picks up a new sentinel item that opens a dialog
  listing every non-default location with inline rename and a delete
  button.

  Backed by two new endpoints on `/api/navigation`:
  - `PATCH ?location=<old>` body `{ newLocation }` — renames the row.
    Validates the slug shape, blocks renames into or against the
    built-in `header` / `footer` / `main`, and 409s instead of
    surfacing the unique-key violation when the target already
    exists. Busts the nav cache for both old and new slugs so theme
    reads land on the current name.
  - `DELETE ?location=<slug>` — removes the row. Same protection
    against deleting the three theme-baked defaults; 404s when the
    slug doesn't exist. Defaults reappear in the locations list on
    the next read because the locations endpoint always re-injects
    them — that's intentional, "deleting" a default would be a
    no-op.

  The dialog mirrors the rename / delete result client-side: if you
  renamed the location you're currently editing, the editor follows
  the new slug; if you deleted it, the editor falls back to the
  first remaining option.

- 53db1b8: `PUT /api/navigation` honors an optional `expectedUpdatedAt`
  token. The settings editor and the page-edit "In navigation"
  panel both stash the `updatedAt` they got from the GET and echo
  it back on the next PUT. If the row's `updatedAt` doesn't match
  what the client expected, the route returns a 409 instead of
  silently overwriting another writer's save.

  The token is opt-in: requests that don't include
  `expectedUpdatedAt` keep the previous last-write-wins semantics
  for back-compat (server-side scripts, older admin builds, the
  "first save of a fresh location" path where there's no row to
  compare against yet).

  When a 409 lands, both UIs surface a clear "someone else
  changed this" message instead of a generic save error.

- 1f4c718: Page-builder patterns — server-side storage (#467 follow-up).

  Patterns now persist in `np_settings` per site, shared across
  operator accounts and devices, instead of being trapped in one
  browser's `localStorage`. localStorage stays as a fallback for
  offline use, lower-role accounts, and unreachable APIs.

  `@nexpress/web`:
  - New `GET /api/admin/patterns` — returns site-shared patterns.
  - New `POST /api/admin/patterns` — upsert a pattern by id;
    generates an id when the body omits one; preserves
    `createdAt` on overwrite.
  - New `DELETE /api/admin/patterns/:id` — removes a pattern;
    treats missing-id as a no-op success so optimistic UI
    doesn't have to special-case races.

  All three are `admin.manage`-gated. CSRF auto-applied via the
  existing `apps/web/src/proxy.ts` pipeline. Storage shape: a
  single JSON-array value under `np_settings.key =
"page-builder.patterns"`, scoped by `siteId` so multi-tenant
  deployments don't leak compositions across tenants.

  `@nexpress/admin`:
  - New `fetchServerPatterns()`, `saveServerPattern()`,
    `deleteServerPattern()` helpers in
    `packages/admin/src/blocks/patterns.ts`. Each falls back to
    `null` / `false` on network or auth failure so callers can
    drop into local-only mode without crashing.
  - Block page editor merges server + local patterns when the
    command menu opens. Server patterns take precedence on id
    collision; local-only patterns surface alongside them so a
    pattern saved while offline is still reachable.
  - "Save as pattern" tries the server first; on failure it falls
    back to localStorage so the operator's intent isn't lost.

  Backward compatible. Existing localStorage patterns keep working
  unchanged — nothing migrates them to the server automatically
  (operators can re-save locally-stored patterns to push them up).

- bded1f7: PR C of 3 in the "make defaults look properly designed" cluster.
  The fresh-install seed now showcases the framework instead of
  narrating itself.

  **Pages**

  Four pages, each composed of multiple block types instead of one
  rich-text dump:
  - **Home** (`/`) — hero → logos-cloud → section-header +
    feature-grid → stats-grid → testimonials → tabs → pricing →
    faq → cta. Thirteen blocks total. Exercises every PR-A primitive
    plus the existing hero / feature-grid / pricing / faq / cta
    built-ins. An operator landing on a fresh install sees what the
    page builder actually does.
  - **About** — section-header + rich-text + feature-grid (three
    values cards).
  - **Pricing** — section-header + pricing tiers + faq.
  - **Contact** — section-header + contact-form + supplemental
    rich-text.

  **Posts**

  Five posts with real prose (3–4 paragraphs each), tagged with
  seeded taxonomy terms:
  1. _Building Your First NexPress Plugin_ — published 14d ago,
     tagged `Plugins`, `Tutorials`.
  2. _How the Page Builder's Container Contracts Keep Pages Valid_
     — published 7d ago, tagged `Framework`.
  3. _Themes Without Forks: Tokens, Overlays, and the Layered Merge_
     — published 3d ago, tagged `Themes`, `Framework`.
  4. _Reading Time and Reactions in Thirty Lines Each_ — published
     yesterday, tagged `Plugins`, `Tutorials`.
  5. _Coming Soon: What's Next on the Roadmap_ — `publishedAt` 7d
     in the future, status `draft`. Demonstrates the
     scheduled-publish job promoting drafts when their timestamp
     passes.

  **Taxonomies**

  Four seed tags (`Framework`, `Plugins`, `Themes`, `Tutorials`)
  seeded via the existing `taxonomies` collection. Posts reference
  them through the relationship field, so the blog template's
  tag filters and category sidebars have something to render.

  **Navigation**

  Updated header (Blog / About / Pricing / Contact / Discussions)
  and footer (About / Pricing / Contact / GitHub) to match the new
  page set.

  **API surface**

  `SeedAllResult` gains a `taxonomies: SeedTaxonomiesResult` field,
  and `seedAll` now seeds taxonomies first (posts reference tag
  ids). The `/api/admin/setup` endpoint's `seeded` summary gains a
  `tags: number` field.

  **Idempotency**

  Each seeder still skips when its target collection already has
  rows. Re-running `pnpm seed:content` on a populated install is
  a no-op as before.

  **What's not in this PR (intentional)**
  - No media uploads — would need real binary assets and an
    S3-backed seeder. The hero block uses the existing default
    Unsplash URL; logo placeholders use placehold.co.
  - No demo comments / reactions — community feature seeding has
    its own complexity and would expand scope.
  - No multi-language translations — single-language only.

- 9c3cd89: Slug renames now permanently redirect (HTTP 308) instead of 404. When an operator renames a page (e.g. `/old-page` →
  `/new-page`), search-engine indices, external links, and
  bookmarks for the old URL stay working — the public-site
  catch-all looks up the rename history and issues a permanent
  redirect to the current path. (Next's `permanentRedirect` emits
  308; semantically equivalent to the classic 301 for SEO and
  preserves the request method.)

  Implementation:
  - New table `np_slug_history` records every slug change for
    collections that declare `slugField`. Indexed on
    `(siteId, collection, oldSlug)` for the read path.
  - The content pipeline writes a history row inside the same
    transaction as the doc UPDATE — half-applied state isn't
    possible. Skipped on creates and on updates that don't
    change `slug`.
  - New helper `findSlugRedirect(collection, oldSlug)` walks the
    history chain (capped at 5 hops) and returns the most recent
    target. Cycle-safe.
  - The `(site)/[[...slug]]` catch-all calls the helper before
    emitting `notFound()`. Locale prefixes survive the redirect.

  Wire-compat: existing slugs unchanged. Empty history table on
  upgrade — sites get redirects only for renames that happen
  after the migration runs.

### Patch Changes

- 6bcef89: **Enable npm publish via Trusted Publishing (OIDC) + restore
  push-time CI triggers.**

  Activates the dormant publish pipeline in
  `.github/workflows/release.yml` (deferred since #393). Uses
  npm's **Trusted Publishing** model — no `NPM_TOKEN` secret;
  auth flows through GitHub's OIDC.

  Three workflow changes:
  1. **`release.yml`** — `push: main` trigger uncommented;
     `publish: pnpm release` re-added to the changesets/action
     step; `NPM_CONFIG_PROVENANCE: "true"` env passed; the
     workflow's existing `id-token: write` permission powers
     both provenance signing and TP auth.
  2. **`ci.yml`** — `push: main` + `pull_request` triggers
     uncommented. Without push-time CI, a broken `main` could
     propagate to npm before anyone caught it.
  3. **`docs/releasing.md`** — rewritten:
     - "Required secrets" → "Auth: Trusted Publishing (OIDC)"
     - Step-by-step TP setup per package on npmjs.com
     - Two paths for first publish (manual local with 2FA,
       OR one-shot classic token then revoke)
     - Post-publish verification (npm view, scaffold smoke,
       attestation check)

  ### Why TP, not NPM_TOKEN

  npm's 2024 UX explicitly steers automation away from classic
  Automation tokens: creating one shows "There are security
  risks with this option. For automation or CI/CD uses, please
  use Trusted Publishing instead." TP avoids:
  - a long-lived secret in repo settings (leak / rotation risk)
  - the 2FA-bypass checkbox warning
  - per-token scope ambiguity

  The trade-off: TP requires the package to exist on npm before
  TP can be configured. For first-time publishes, operator
  either publishes once locally with 2FA OR uses a one-shot
  classic token that gets revoked right after.

  ### Safe-by-default flow

  Changesets/action only publishes when no changesets remain
  queued:
  1. **Merge this PR** → next push to main has 138 queued
     changesets → workflow opens "Version Packages" PR.
     **No publish attempt.**
  2. **Operator configures Trusted Publishers** on npmjs.com
     for each package (or completes first publish via either
     path above).
  3. **Operator reviews + merges Version Packages PR** → next
     push has zero queued changesets → workflow runs `pnpm
release` → tarballs published with Sigstore provenance via
     OIDC auth.

  Operator can skip steps 2 between merging this PR and the
  Version PR — the first publish run from CI will fail with an
  auth error pointing at missing TP config. Easy to recover:
  add TP configs, push an empty commit (or re-run the workflow),
  publish completes.

- 71045bd: Three small nav follow-ups grouped into one cleanup:
  - **Lock down `/api/navigation/locations`.** The endpoint now
    requires staff auth + the `admin.manage` capability instead of
    allowing anonymous reads. The data is technically inferable
    from rendered nav menus, but enumerating every custom slot
    via one HTTP call shouldn't be free.
  - **CLI page template opts into `navMembership`.** Sites
    scaffolded with `create-nexpress` get the "In navigation"
    side-panel on the page edit view out of the box, matching the
    reference app's behavior. Comment explains the flag for
    operators who add a `landing-pages` or `static-pages`
    collection later.
  - **Arrow-key navigation in the page picker.** ArrowDown / ArrowUp
    move the highlighted row; Enter commits. Radix Popover already
    handles Esc → close. The previously-selected page is shown
    with a subtle ring when it isn't the active row, so the
    operator can see both "where I am" and "what I had".

- d5f13cb: chore(themes): retire `@nexpress/theme-minimal`

  The 99-LOC v0.1-era demo theme (single file, centered logo + dotted border + serif body) is removed. Its self-described purpose ("Demo theme that proves the 11.x slot system swaps the rendered shell") is satisfied by the F-track + M-track adoption story across `theme-magazine` / `theme-docs` / `theme-portfolio`. The slot-system swap behavior is proven everywhere now — keeping a separate demo package is dead weight on the workspace.

  Aligns with the original retirement plan in `docs/design/theme-v0.2-extension.md` § 1 / § 5 ("`default` and `minimal` retire — absorbed as `theme-magazine` settings variants"). Implementation simplified the plan to a clean delete; `theme-default` stays as the v0.1 fallback (it's the framework's "production-grade baseline" per its own JSDoc, not just a demo).

  Files touched:
  - `packages/themes/minimal/` — directory deleted
  - `apps/web/src/nexpress.config.ts` — drop `minimalTheme` import + entry from `themes` array (now `[defaultTheme, magazineTheme, portfolioTheme, docsTheme]`)
  - `apps/web/package.json` — drop `@nexpress/theme-minimal` workspace dep
  - `apps/web/next.config.ts` — drop from `transpilePackages`
  - `docs/theme-authoring.md` — update §11 reference table (drop minimal row, expand `theme-default` description), update `defineConfig` example to use `magazineTheme` instead of `minimalTheme`
  - `CLAUDE.md` — refresh "Last refreshed" header note

  Operators on the `minimal` theme have two upgrade paths:
  1. **`theme-default`** — same v0.1 contract baseline, more feature-complete (header / footer / templates).
  2. **`theme-magazine`** — full v0.2 + M-track adoption with the operator-no-code surfaces (settingsSchema, archives, patterns, member-shell, etc.).

  `theme-minimal` was not a published v0.1 contract surface (per `AGENTS.md` STABILITY section); deletion is not a STABILITY-promised break.

  Verified
  - `pnpm typecheck` — 56/56 ✓ (was 58, -2 from minimal package's typecheck + build tasks)
  - `pnpm build` — 30/30 ✓ (was 31)
  - `pnpm install` clean

  Closes "theme-simple consolidation" deferred entry in memory.

- 92baa44: **v0.3 (C + E) — bulk "cleanup unknown blocks" admin action +
  cross-theme migration hint.**

  Closes two v0.3-deferred items from
  `docs/design/theme-v0.2-extension.md` §10 in one bundled PR
  since both deal with cleanup workflows after theme/plugin
  changes:

  > Bulk "cleanup unknown blocks" admin action — placeholder
  > rendering covers correctness; bulk action is convenience.

  > Cross-theme migration — switching themes A → B is idempotent
  > at install time but doesn't remove A's leftover fields.
  > Cleanup workflow tracked here.

  ### What changed

  **New admin route**: `/admin/themes/cleanup` — scans every
  collection's `type: "blocks"` field for instances whose `type`
  string isn't in the active block registry (typical after
  `theme:uninstall`, theme switch, or plugin removal). Lists
  unknown types with instance + doc counts; operator can:
  - "Remove all" — strip every unknown instance across the site
  - Per-row "Remove" — strip just one type at a time

  Each cleanup run goes through `saveDocument` so revisions
  track the change and media-ref / search-vector hooks fire
  correctly. Operators can revert via the per-doc revision
  history if a removal was a mistake.

  **New API endpoints** under `/api/admin/blocks/unknown`:
  - `GET` — scan-only, returns `{ unknownTypes, affected,
totalInstances, totalDocs }`
  - `POST` — apply cleanup, optional `{ types: string[] }` body
    filters which types to strip (default: all). Returns
    `{ removedInstances, updatedDocs }`

  Both are gated by `admin.manage` capability and CSRF-protected
  by the standard proxy.

  **Cross-theme migration hint** (E): the existing theme switcher
  (`/admin/settings/theme`) now shows a yellow callout after a
  successful theme switch (skipped on first-boot when there was
  no previous active theme), pointing operators at the cleanup
  tool. The hint surfaces specifically because the operator just
  took an action (switching themes) that commonly produces stale
  references — discoverability without permanent visual noise.

  ### Why bundled

  Both items address the same workflow: "I changed something
  about my site's theme/plugins; now my pages have orphan
  references to blocks that no longer render." C is the tool;
  E is the discovery surface that points operators at the tool
  right when they're most likely to need it.

  ### Scan scope (today)
  - Walks every registered collection
  - Inspects `type: "blocks"` fields (incl. those nested inside
    `row` / `collapsible` containers)
  - Recurses into block `children` arrays — even known parent
    blocks can hold unknown descendants
  - Caps at 1000 docs per collection (a future iteration paginates
    when sites cross the threshold; today's reference sites are
    far below)

- 6dcb8ee: **Phase 24 — `@nexpress/auth-pages` package: framework-owned member auth.**

  Until now, every nexpress site copied the full `/members/*` auth
  flow (10 API routes + 6 page forms, ~700 lines of boilerplate)
  out of the reference app and maintained it forever. Security
  patches landing in core required sweeping every site's
  `app/api/members/*` and `app/(site)/members/*`. New OAuth
  provider, tightened rate limit, CSRF refinement — every change
  rippled across N codebases.

  The new `@nexpress/auth-pages` package owns layers 2 (HTTP) and
  3 (form lifecycle) of the auth stack. Sites still own layer 4
  (JSX, copy, brand) and layer 1 stays in `@nexpress/core/auth`
  (crypto primitives, JWT, OAuth state). Result: routes shrink to
  two lines, page forms become hooks + your own JSX, and security
  patches flow through one package version bump.

  ### `@nexpress/auth-pages/server` — route factories

  Bootstrap once per app:

  ```ts
  // apps/<app>/src/lib/auth-routes.ts
  export const memberAuthRoutes = createMemberAuthRoutes({
    getDb,
    ensureFor,
    authHelpers: {
      setMemberAuthCookies,
      clearMemberAuthCookies,
      getMemberAuthRuntimeConfig,
      requireMember,
    },
    site: { name, url },
    options: {
      /* per-flow knobs — all optional */
    },
  });
  ```

  The factory returns one handler per flow:
  `login`, `register`, `logout`, `refresh`, `verifyEmail`,
  `forgotPassword`, `resetPassword`, `oauthStart`, `oauthCallback`,
  `meGet`, `mePatch`, `meDelete`. Each route file becomes:

  ```ts
  // app/api/members/login/route.ts
  import { memberAuthRoutes } from "@/lib/auth-routes";
  export const POST = memberAuthRoutes.login;
  ```

  Behavior is **byte-for-byte identical** to the existing reference
  app: same anti-enumeration responses, same 5-attempt / 15-min
  lockout, same 24h email-verify TTL, same OAuth state-cookie
  flow, same JWT mint + session-row persistence, same logout
  revocation, same `?oauth_error=<code>` failure redirects. All
  configurable knobs (max attempts, password min length, token
  TTLs, OAuth redirects) have defaults that match what the
  reference app already shipped.

  ### `@nexpress/auth-pages/client` — headless hooks

  Six React hooks, one per form page:
  - `useMemberLogin` — email/password sign-in
  - `useMemberRegister` — handle/email/password/displayName signup
  - `useMemberLogout` — POST /logout, clear cookies
  - `useMemberVerifyEmail({ token, autoVerify? })` — consumes verify token on mount
  - `useMemberForgotPassword` — request reset email
  - `useMemberResetPassword({ token })` — set new password from email link

  Each returns `{ fields, errors, isSubmitting, isSuccess, submit }`
  (or the relevant subset). `fields.email` is `{ value, onChange }`
  spread directly onto an `<input>`. `errors._form` carries the
  top-level error string; `errors.email` / `errors.password` etc.
  carry per-field validation messages from the server's
  `error.details` array.

  Customizable per call:
  - `endpoint?: string` — default `/api/members/<flow>`, override
    for sites that mount differently
  - `messages?: Partial<Record<NpAuthErrorCode, string>>` — i18n
    override for any of the 10 stable error codes
  - `onSuccess?`, `onError?` — analytics / redirect callbacks

  ### Reference app migration

  All 10 routes + all 5 form components migrated to the new
  package. Each route file went from ~50-150 lines to 2 lines;
  each form component dropped its inline `fetch` + error-mapping
  boilerplate (~30-50 lines each) for one hook call.

  Net diff: ~700 lines removed from `apps/web`, ~1500 lines added
  to `@nexpress/auth-pages` (most of which is the factory
  implementation that used to live in apps).

  ### Stability

  `@nexpress/auth-pages` is published at `0.1.0` and joins v0.1's
  stable surface:
  - The 12 route handlers and their config option shapes
  - The 6 hooks and their `Use*Options` / `Use*Result` types
  - `NpAuthErrorCode` union (10 codes — adding a new code is a
    non-breaking minor; renaming or removing one rides a minor
    with a migration note)
  - `DEFAULT_AUTH_MESSAGES` shape

  The `MemberAuthHelpersForRoutes` interface (the subset of
  `@nexpress/next.MemberAuthHelpers` the factory consumes) is
  also stable — sites that don't use `createMemberAuthHelpers`
  verbatim can still wire the factory by supplying matching
  methods.

  ### What's NOT in this PR
  - Default OAuth providers (Google/GitHub/etc.) — `getOAuthProvider`
    registry stays as-is; framework-shipped providers are a
    separate decision (which providers, what config defaults, who
    pays the dependency cost) for a follow-up PR.
  - Staff auth (`/api/auth/*`) migration — same pattern, separate
    scope. Member auth is the higher-traffic surface; staff auth
    follows after this validates.
  - CLI scaffold update — `create-nexpress` templates still ship
    the full hand-coded flow; once `@nexpress/auth-pages` is
    stable across one minor cycle, the scaffold flips to the new
    pattern (separate PR).
  - Notification preferences (`/api/members/me/notification-prefs`)
    — domain-specific (sites add custom kinds), stays app-side.

- 3de99bc: **Phase 25.4 — `/blog/category/[slug]` dogfood + cookbook §2.1 hasMany friction note.**

  Built `apps/web/src/app/(site)/blog/category/[slug]/page.tsx`
  to exercise category-filtered post listings with the Phase D
  typed wrappers. The first instinct doesn't work:

  ```ts
  const result = await findPosts({
    where: { categories: [category.id], status: "published" },
    // ...
  });
  ```

  `findDocuments`'s where clause iterates `Object.entries` and
  calls `eq(column, value)` per field. There's no `categories`
  column on `np_c_posts` — the relationship lives in
  `np_c_posts__categories`, a join table. The typed wrapper lets
  you SPELL `categories: [id]` (it's on `PostsDocument`) but the
  runtime ignores it and the query throws "column 'categories'
  doesn't exist."

  The page works around this with a raw-Drizzle subquery against
  the join table. Cookbook §2.1 ("Filtering by `hasMany`
  relationships — raw Drizzle") documents the pattern with a
  copyable code snippet pointing at this page as the reference.

  **Phase E candidate.** A typed `findPostsByCategories(id)`
  emitted alongside the existing `find${Pascal}` wrappers would
  hide this boilerplate. Two pieces would need to land together:
  1. `findDocuments`'s where clause auto-detects array values
     and uses `inArray` instead of `eq`.
  2. Codegen's `generateDocumentsModule` emits per-hasMany-
     relationship helpers that pre-resolve the join table to an
     id list, then delegate to `findDocuments({ id: idList })`.

  Implementation is moderate but not in this PR. Filed as a
  follow-up issue; the raw-Drizzle pattern works and ships.

  No framework code changes in this PR — pure dogfood + docs.

- 65da716: feat(core, admin, next, plugin-sdk): G.1 — plugin config auto-form + storage migration to np_settings

  Plugin authors can now declare a Zod `configSchema` on their definition; the framework introspects it (mirroring the F.3 theme settings path) and renders an admin auto-form on `/admin/plugins/[pluginId]` with no per-plugin form code.

  **Plugin SDK** (`@nexpress/plugin-sdk`):
  - `NpPluginDefinition.configSchema` (already existed — wired up in G.1) now drives the admin auto-form.
  - New `configVersion` and `configMigrate` fields mirror theme `settingsVersion` / `settingsMigrate` for lazy schema migrations.

  **Core** (`@nexpress/core`):
  - New `getPluginConfig` / `getPluginConfigWithStatus` / `setPluginConfig` / `pluginConfigCacheTag` exports (in `packages/core/src/plugins/config.ts`). Match `getThemeSettings` semantics including the defensive try/catch on the migrator and `safeParse` fallback to schema defaults.
  - Auto-form introspector gained a `password` widget, opted into via `.meta({ sensitive: true })` on a Zod string. Both theme and plugin schemas can use it.
  - `np_plugins.config` jsonb column dropped (Drizzle migration 0034). Existing rows are copied to `np_settings (siteId, "plugin.config:<id>")` wrapped in the v1 versioned envelope. `np_plugins` is now a lean `(id, enabled, installed_at, updated_at)` meta row.
  - `getPluginState` / `updatePluginState` no longer return / accept a `config` field. Callers use `getPluginConfig` / `setPluginConfig` instead.
  - `ctx.settings.getPlugin` / `ctx.settings.setPlugin` (plugin runtime context) now read/write through the new path. Plugins with `configSchema` get validation; legacy plugins still work without it.
  - Plugins that declare BOTH `configSchema` and `admin.settings.fields` log a console warning at registration; the auto-form wins (per the locked precedence in `docs/design/plugin-config-auto-form.md` § 5.1.1).

  **Admin** (`@nexpress/admin`):
  - `<PluginAdminPage>` accepts new optional `configFields` and `initialAutoConfig` props. When `configFields` is non-empty, the auto-form `<Card>` replaces the legacy `admin.settings.fields` form.
  - `ZodForm` form-renderer dispatches `password` widget to `<Input type="password" autoComplete="new-password">`.

  **Next.js helpers** (`@nexpress/next`):
  - New `getCachedPluginConfig` wrapper (parallel to `getCachedThemeSettings`) tagged with `np:plugin:<id>`. Per-plugin tag scheme uses the `np` prefix (CLAUDE.md "Naming convention").

  **Reference app** (`@nexpress/web`):
  - `/admin/plugins/[pluginId]` page introspects `configSchema` server-side and passes the metadata to the client.
  - `PUT /api/plugins/[pluginId]` no longer accepts the `config` field — config writes moved to `PUT /api/admin/plugins/[pluginId]/config` (validates via schema, busts `np:plugin:<id>` cache tag).

  Migration recipe for existing plugins (each will land as its own G.2 PR):
  1. Add `configSchema: z.object({…})` to the plugin definition.
  2. Remove `admin.settings.fields` (or set to `[]`).
  3. Replace any `getPluginConfig` typed read with the `z.infer<typeof schema>` cast.

- 0c59b98: **Phase E — `hasMany` relationship filtering on `findDocuments` + typed wrappers.**

  Closes the friction surfaced in #540's `/blog/category/[slug]`
  dogfood. Sites can now write the natural query directly:

  ```ts
  const result = await findPosts({
    where: { status: "published", categories: category.id },
    sort: "-publishedAt",
    page: pageNum,
    limit: 20,
  });
  ```

  …instead of dropping into raw Drizzle to subquery the join
  table by hand (and remembering to re-apply the `siteId` /
  `visibility` / `access.read` gates that `findDocuments` would
  have applied for free).

  ### Three pieces
  1. **`NpFindWhere<T>` accepts arrays per field** — the type
     `Partial<T>` is now `{ [K]?: Unwrap<T[K]> | Unwrap<T[K]>[] }`.
     Hand-typed scalars stay scalar; hasMany arrays unwrap so
     `categories: string[] | null` reads as `string | string[]`
     in where clauses (single target or OR-list of targets).
  2. **`findDocuments` runtime auto-detects array values** — when
     `where[field]` is an array, the pipeline emits `inArray(col,
value)` instead of `eq(col, value)`. Empty arrays
     short-circuit to a `false` SQL clause (Postgres rejects
     `IN ()` with a syntax error otherwise).
  3. **Codegen typed wrappers pre-resolve hasMany fields** —
     `generateDocumentsModule` now detects top-level relationship
     fields with `hasMany: true` on each collection. Their
     `find${Pascal}` wrapper queries the join table for matching
     parent ids, intersects across multiple hasMany filters
     (`categories: x AND tags: y` matches rows that have BOTH),
     strips the hasMany keys from the where clause, adds
     `id: idList`, and delegates to `findDocuments`.

  ### Critically: gates preserved

  Because the wrapper goes through `findDocuments`, all the
  hardening that `findDocuments` already applied keeps applying:
  - `siteId` scoping (multi-site)
  - `visibility = "public"` for anonymous viewers
  - `access.read({ user, doc })` callback per row

  The cookbook §2.1 (raw Drizzle escape hatch) is rewritten —
  the natural typed-wrapper path is now the recommended one,
  with a much smaller "when you still need raw Drizzle" callout
  for exotic shapes (full-text ranking, JSON-column queries).

  ### Reference app migration

  `apps/web/src/app/(site)/blog/category/[slug]/page.tsx` is
  refactored from ~70 lines of raw Drizzle (with the security-
  critical gate-restoration code) to a single 8-line `findPosts`
  call. Same behavior, much smaller surface to reason about.

  ### Tests

  5 new unit tests in `type-generator.test.ts` assert:
  - Simple wrapper for hasMany-free collections (no async, no
    drizzle imports)
  - Hasn't-aware async wrapper for collections with hasMany
  - Multiple hasMany fields produce multiple descriptors
  - Intersect short-circuit behavior is documented in the output
  - `getDb` import only appears when at least one collection
    needs it

  Total core tests: 280 (5 new).

  ### Stability

  `NpFindWhere<T>` shape change is backwards-compatible: with
  the default `T = Record<string, unknown>` the per-field type
  is `unknown | unknown[]` which subsumes the previous
  `Record<string, unknown>` (no caller could pass an array
  before; now they can). Joins v0.1's stable surface as the
  recommended hasMany-filter path.

- 82c24ed: feat(theme-magazine, web): M.ref — magazine reference impl for the M.\* member surface

  Magazine adopts every M.1-M.3 surface end-to-end. The reference implementation proves the F-track infrastructure works without touching the theme contract.

  **`impl.members.shell` — `MagazineMembersShell`**

  New server component (`src/members-shell.tsx`) that wraps `(member)/members/*` in the magazine masthead + footer (reuses `MagazineHeader` / `MagazineFooter` so chrome bumps apply to both surfaces) plus a narrow `np-magazine-members-column` (max-width 420px) so auth forms don't stretch to the full editorial column width. Owns the `np-magazine` root wrapper + accent-color inline style — it replaces `impl.shell` for member routes via M.1's fallback chain, so no parent shell is in play.

  **`impl.members.notFound` — `MagazineMembersNotFound`**

  Tuned voice ("Subscriber desk" / "That link has gone to print" / "Verification and password-reset links expire after a single use…") and a `/members/login` CTA. Replaces the public-site `MagazineNotFound`'s "story isn't in the archive" framing for member routes. Most 404s inside `/members/*` are stale auth links; the new copy speaks to that case.

  **`./components/members-error` subpath — `MagazineMembersError`**

  `"use client"` component (F.7.1 delegation pattern) that ships at `@nexpress/theme-magazine/components/members-error`. Tone matches the public `./components/error` ("Stop the press" → "Subscriber desk", "Something tore in the layout" → "We lost the thread of your session") and adds a "Back to sign in" button alongside "Try again" — fresh sign-in usually clears the kind of stale-session error this boundary catches.

  `apps/web/src/app/(member)/error.tsx`'s `THEME_MEMBER_ERRORS` registry adds the magazine entry: `magazine: lazy(() => import("@nexpress/theme-magazine/components/members-error"))`. The lazy import keeps the magazine error chunk out of the bundle until the boundary fires.

  **Token overrides for `--np-member-form-*`**

  Magazine's `magazineCss` adds a `.np-magazine .np-members-form { … }` block overriding `--np-member-form-input-bg / -border / -border-focus / -radius` and `--np-member-form-button-radius` to match the editorial squareness (radius 0.25rem, hairline borders, terracotta focus). `.np-form-label` styled with uppercase tracking + serif body font for the magazine voice. Other themes' member forms unchanged — overrides are scoped under `.np-magazine`.

  **Package surface changes**
  - `package.json` adds the `./components/members-error` exports entry
  - `tsup.config.ts` adds `components/members-error` to the client-banner build

  **Verified**
  - `pnpm --filter @nexpress/theme-magazine build` ✓
  - `pnpm typecheck` (58/58) ✓
  - Magazine reference implementation now exercises every M.\* surface; the M.docs cookbook entry can cite this PR's diff as the canonical migration recipe.

  Existing themes (`portfolio`, `docs`) untouched — `impl.members` is optional and they fall back to `impl.shell` / `impl.notFound` per the M.1 / M.3 fallback chains.

- 6672371: feat(theme, web): M.1 — `impl.members.shell` slot + `(member)` route group restructure

  First phase of the F-track member-surface skinning (`docs/design/member-surface-skinning.md`). Themes can now wrap the framework-owned `(member)/members/*` routes (login / register / forgot-password / reset-password / verify / me/notifications) in their own chrome — same masthead + footer the theme uses for the public site — without rewriting the form-submit / email-verification / OAuth flows.

  **Theme contract addition** (`@nexpress/theme`, `NpThemeImpl`):

  ```ts
  members?: {
    shell?: ComponentType<{ children: ReactNode }> | null;
    pageTitle?: {
      login?: string;
      register?: string;
      forgotPassword?: string;
      resetPassword?: string;
      verify?: string;
      notifications?: string;
    };
  };
  ```

  Fallback chain at the `(member)/layout.tsx` level:
  1. `impl.members.shell` truthy → use it
  2. `impl.members.shell === null` → opt out explicitly (member pages render bare, useful when the public-site shell would clash with narrow auth forms)
  3. `impl.members.shell === undefined` → fall back to `impl.shell` (the public-site shell)
  4. `impl.shell === undefined` → transparent fragment

  **Route restructure** (locked decision E in the design doc § 2): six page files moved out of `(site)/members/*` into a new sibling `(member)/members/*` route group. URL surface unchanged (Next.js route groups don't add path segments — `/members/login` resolves to `(member)/members/login/page.tsx` post-restructure, same as `(site)/members/login/page.tsx` did pre-restructure). Header-based i18n (proxy sets `x-np-locale` without rewriting URL) is unaffected — static `/members/*` URLs are locale-agnostic in URL form.

  The new `(member)/layout.tsx` duplicates the infrastructure pieces of `(site)/layout.tsx` — `ensureFor("read")`, `<NpThemeStyle theme={tokens}>`, the theme-owned CSS `<style>` tag, the `data-np-theme` attribute — because route groups are siblings (Next.js runs ONE root layout per request based on which group matches). Differences: wraps content in the member shell (or fallback chain) instead of `impl.shell`; skips the feed-discovery `<link rel="alternate" type="application/atom+xml">` line — member pages don't carry feed metadata.

  Reference theme migration (magazine + portfolio + docs) lands in M.ref; this PR ships only the framework wiring + the empty contract slot. Existing themes with no `impl.members` declared inherit the public-site `impl.shell`, so behavior is unchanged for sites that haven't migrated.

  Manifest changes: `NpThemeImpl` gains optional `members` field (additive — all existing themes continue to compile against the new type without changes).

- 4e87b8f: feat(web): M.2 — `--np-member-form-*` tokens + framework default CSS

  Second phase of the F-track member-surface skinning. Themes can now restyle the framework-shipped member auth forms (`/members/login` / `/register` / `/forgot-password` / `/reset-password` / `/verify`) by overriding CSS custom properties — no need to replace the form components.

  **Token surface**

  Form input styling, scoped to `.np-members-form`:

  ```
  --np-member-form-input-bg
  --np-member-form-input-border
  --np-member-form-input-border-focus
  --np-member-form-input-radius
  --np-member-form-input-padding
  --np-member-form-input-disabled-bg
  --np-member-form-button-bg
  --np-member-form-button-fg
  --np-member-form-button-radius
  --np-member-form-error-color
  ```

  OAuth button styling (forward-compat — no OAuth button component renders today; OAuth flow goes through `/api/members/oauth/{provider}/start` directly. Tokens are declared so themes can pre-style for when buttons land):

  ```
  --np-member-oauth-google-bg / -fg / -border / -radius
  --np-member-oauth-github-bg / -fg / -border / -radius
  ```

  **Selector scoping**

  All tokens declared at `.np-members-form` (existing plural class name applied to every member auth `<form>`). Member-specific input rules (`.np-members-form .np-form-input`) read from the new tokens; the global `.np-form-input` selector (shared with `.np-discussion-form` and other `.np-form-input` consumers) keeps its existing `--np-color-*` reads. This means M.2 changes the look of member forms only — discussion forms, comment forms, and any other form using `.np-form-input` are untouched.

  **Default values**

  Every token falls back to an existing `--np-color-*` / `--np-radius-*` global so themes that don't override get the same look as today. Themes restyle by overriding tokens in their `impl.css` (e.g., `.np-magazine .np-members-form { --np-member-form-input-bg: var(--np-color-paper); }`).

  **Design-doc selector correction**

  § 5.2 of the design doc earlier showed `.np-member-form` (singular) as the selector. The existing class is `.np-members-form` (plural — applied by member auth forms today). This PR reuses the existing class name to avoid churning the hand-coded forms, and the design doc § 5.2 is updated to match.

  LOC: ~80 lines of CSS in `apps/web/src/app/globals.css` + design doc § 5.2 sync.

  No code-component changes. No theme-side changes (themes opt in by overriding tokens, not by adopting new APIs). Reference theme migration (magazine adopting custom token values) lands in M.ref.

- 89c32db: feat(theme, core, web): M.3 — `impl.members.notFound` / `impl.members.error` slots

  Third phase of the F-track member-surface skinning. Themes can now ship a member-tree-specific 404 page and error boundary, mirroring the v0.2 `impl.notFound` / `impl.error` slots (F.7 / F.7.1) for the `(member)/members/*` subtree.

  **Theme contract additions** (`@nexpress/theme` `NpThemeImpl.members`):

  ```ts
  members?: {
    shell?: ComponentType<NpThemeShellProps> | null;
    pageTitle?: { ... };
    notFound?: ComponentType;                      // NEW (M.3)
    error?: ComponentType<NpThemeErrorProps>;      // NEW (M.3) — forward-compat marker
  };
  ```

  **Fallback chain** for `members.notFound`:
  1. `impl.members.notFound` declared → use it
  2. `impl.members.notFound === undefined` → fall back to `impl.notFound`
  3. `impl.notFound === undefined` → framework default (the JSX in `(member)/not-found.tsx`)

  The framework default is tuned for the member surface — the CTA points to `/members/login` rather than the public site's "go home" default. Most "page not found" hits inside `/members/*` are stale auth links (expired verify tokens, old reset-password emails opened twice); a "go home" CTA misroutes those.

  **Core API surface** (`@nexpress/core`):
  - `extractMembersNotFoundComponent(impl)` — pure structural narrower with the fallback chain (member-level → top-level → null). Mirrors `extractNotFoundComponent` shape, treats `impl` as opaque (`unknown`); the consumer in `apps/web` casts to `ComponentType` at the JSX site.
  - `getActiveThemeMembersNotFound()` — async sugar over the active theme. Returns the resolved component reference (or `null` when neither slot is declared).

  **Files**:
  - `apps/web/src/app/(member)/not-found.tsx` (NEW) — server component, delegates to `getActiveThemeMembersNotFound()`, falls through to the framework default
  - `apps/web/src/app/(member)/error.tsx` (NEW) — `"use client"` + lazy `THEME_MEMBER_ERRORS` registry shape (parallel to `(site)/error.tsx`'s F.7.1 pattern). Registry starts empty — reference theme adoption (`./components/members-error` subpath in magazine) lands in M.ref.
  - `(member)/error.tsx` keeps its OWN registry rather than inheriting `(site)/error.tsx`'s `THEME_ERRORS` map. Coupling the two would force every theme that ships a public-site error subpath to also ship a members-error subpath even when the public default is fine for both.

  **5 unit tests** added covering the fallback chain (no impl / no slots / member-level wins / top-level fallback / non-function rejection). 361 tests pass total (was 356).

  **Reference theme adoption** (magazine shipping `./components/members-error` + a custom `members.notFound`) lands in M.ref. Existing themes with no `impl.members.notFound` declared continue to work — the fallback chain hits step 2 or 3.

- 53627e1: Page builder — server-side media search + hierarchy moves in row header (#467 follow-ups).

  Two improvements flagged in the post-merge audit of the #467
  work.
  - **Server-side media search.** `listMedia()` (and the
    `/api/media` route via a new `q` query param) now runs an
    `ILIKE` over `filename` + `alt`, OR-joined, with `%` / `_`
    escaped so filenames containing them aren't misread as
    wildcards. The page-builder block-image picker drops its
    client-side filter and passes `q` to the API instead, so
    search hits the whole library instead of only the loaded
    pages.
  - **Hierarchy moves in the row header.** Each
    `SortableBlockItem` header gets a new "More actions"
    dropdown (lucide `MoreHorizontal`) with three sections:
    - "Move out of <parent>" when the row has a parent.
    - "Move into <container>" — one entry per valid target
      (resolved lazily on dropdown open via
      `getMoveIntoCandidates(id)`).
    - "Wrap in <container>" — one entry per available container
      type that isn't the row's own type.
      Mirrors the Cmd-K commands so mouse operators discover the
      same set of cross-hierarchy moves.

  Backward compatible. `listMedia()`'s new `q` field is
  optional; admin / web clients that don't pass it see the
  existing list-everything behavior. The dropdown is purely
  additive — same row layout, same actions reachable from
  Cmd-K stay where they were.

- 98d3a4e: **Phase C dogfood pass — fixes found while migrating real pages onto the new primitives.**

  Wrote `/u/[handle]`, `/u/[handle]/discussions`, and `/discussions`
  against the primitives shipped in #531; the migration surfaced
  three friction points worth fixing in the primitive surface
  (rather than working around them in every caller) and one
  cookbook gap.
  - **`getMemberProfile(idOrHandle)` now lowercases the input.**
    Member handles are stored lowercase by the registration path
    (`api/members/register/route.ts:49`), so visiting
    `/u/HANDLE` returned `null` even though `/u/handle` worked.
    The lookup now mirrors what every existing read site already
    does explicitly. UUID ids are unaffected (lowercase hex is
    idempotent).
  - **New `getMemberProfiles(ids[], opts?)` batch helper** in
    `@nexpress/core/community`. Looping `getMemberProfile` over a
    list-page's authors would issue N queries plus N avatar
    resolutions. The batch fetches the rows in a single SELECT
    and resolves avatars in parallel, returning
    `Map<id, NpMemberProfile>`. Callers like the discussions
    index can drop their ad-hoc Drizzle author-lookup boilerplate
    (`apps/web/src/app/(site)/discussions/page.tsx` now uses the
    batch and is shorter + correct on the avatar field that was
    previously dropped).
  - **Cookbook: documented the listing pattern + the
    `joinedAt: Date` serialization caveat.** RSC code that passes
    a profile to a client component crosses the JSON boundary —
    call `.toISOString()` first, or accept `string` on the client
    and parse there.
  - **`@nexpress/next` re-exports `buildPageMetadata`** as a
    thin Next-typed wrapper so `generateMetadata` accepts the
    result without an `as Metadata` cast. The core function still
    exists (framework-agnostic, returns `NpPageMetadata`) for
    static-site exporters and other non-Next consumers.
    Reference-app pages migrated. Cookbook updated to recommend
    the wrapper for page authors.

  The dogfood pass also fixed a pre-existing bug in
  `/u/[handle]/page.tsx`: the old code passed `member.avatar` (a
  UUID FK to `np_media`) directly to `buildPersonJsonLd`'s
  `image` field, which expects a URL. The migration to
  `getMemberProfile` (which returns `avatarUrl` already resolved)
  silently fixes the JSON-LD output. Profile pages now also
  actually render the avatar image — the old code only showed
  the initial-letter fallback because no URL was available.

  Stable in v0.1 — adding optional fields to the option object
  is non-breaking; removing or renaming the function rides a
  minor with a migration note. `getMemberProfiles` joins
  `getMemberProfile` on the v0.1 stability list.

- ac3f8bc: **F.6.1 follow-up — nav editor "Location assignments" panel.**

  The v0.2 theme contract lets themes declare nav slots with
  `navLocations: { primary: { label, description, maxItems } }`,
  and `getActiveThemeNavLocations()` already exposed those to the
  admin. The locations endpoint returned label + description +
  maxItems + source (default / theme / custom), but the editor
  silently dropped everything except value/label and rendered
  locations as a flat select.

  Operators couldn't tell:
  - Which slots their theme actually consumes (vs the framework
    defaults `header` / `footer` / `main`)
  - What each slot is for (the description never surfaced)
  - Whether a slot is empty before publish (theme expects 6
    footer-social links; you have 0)
  - Whether they've gone past the slot's `maxItems` (theme says
    max 6, operator added 8 — items 7-8 will silently render
    past the layout and look broken)

  This PR adds a "Location assignments" panel above the items
  list. It renders only when ≥1 theme-declared location exists,
  showing each as a clickable card with:
  - Label + slug
  - Description (italic, small)
  - Live item count (current location pulls from the in-editor
    state for unsaved-edit awareness; other cards show the
    last-saved count returned by the API)
  - Status badge: `Empty` (amber) / `N / max` (green) /
    `N / max over` (red, when over-limit)
  - "Editing" indicator on the active card

  Click → switches to that location (with the existing dirty-edit
  guard).

  The classic `<Select>` switcher in the header still works for
  keyboard-driven full-list switching incl. defaults + custom
  locations.

  ### API change (back-compat)

  `/api/navigation/locations` now returns `itemCount: number` on
  each entry. The editor's parser narrows defensively, so older
  deploys where the field is absent still render correctly (count
  treated as 0 → "Empty" badge).

- 92cfc11: **Plugin route `surface: "member"` shell wrap (v0.2 follow-up to #623).**

  Plugin routes that declare `surface: "member"` (forum's
  `/discussions/new`, `/discussions/:slug/edit`) now render with
  member chrome — `impl.members.shell` + chrome fallback chain —
  instead of the site shell. Previously the field was accepted at
  the SDK boundary but had no visual effect, documented as
  "experimental until PRT.4".

  **Architectural change.** Layout-bound shell wrap doesn't work
  for surface dispatch — Next.js can't pick a layout based on
  runtime data. Shell wrap moves OUT of the layout files and INTO
  each page via a new `<ShellWrap surface="site" | "member">`
  Server Component. The catch-all picks the surface based on
  which plugin route matched.

  ```
  (site)/layout.tsx                   ← only NpThemeStyle + theme CSS + feed link
  (site)/[[...slug]]/page.tsx         ← <ShellWrap surface={pluginMatch.route.surface}>
  (site)/blog/page.tsx                ← <ShellWrap surface="site">
  (member)/layout.tsx                 ← only NpThemeStyle + theme CSS
  (member)/members/login/page.tsx     ← <ShellWrap surface="member">
  components/shell-wrap.tsx           ← (new) F-track fallback chain inside
  ```

  **Trade-off.** Every page in `(site)` and `(member)` MUST wrap
  itself. A page that forgets renders bare body without chrome
  (visible regression). Mitigated by:
  - Greppable invariant — every `page.tsx` and `not-found.tsx`
    in those trees imports `ShellWrap`. Verified pre-merge.
  - Reviewer eye — adding a new page is a deliberate act; the
    pattern is consistent across 16 existing files.
  - `pnpm build` still produces all routes; chrome regression is
    visual, not structural.

  **`error.tsx` special case.** Next.js mandates `error.tsx` is
  `"use client"`. Client components can't import Server Component
  `ShellWrap`. Site/member error pages now render their own
  `<main>` for semantic correctness and accept the lack of theme
  chrome (a stripped error page is a reasonable fallback when the
  rendering pipeline broke). Theme-overridden error subpaths
  (F.7.1 delegation pattern) keep working the same way.

  **F-track contract preserved.** `impl.members.shell`'s null
  opt-out, undefined fallback, and chrome-slot inclusion rules
  move from `(member)/layout.tsx` into `<ShellWrap surface="member">`
  unchanged. Magazine reference theme works end-to-end without
  modification.

  **Updates v0.1 stability promise** in AGENTS.md (separate
  follow-up commit) — `surface: "member"` shell wrap moves from
  **experimental** to **stable**. Plugin authors can now rely on
  member-surface routes rendering with member chrome.

  Files touched: 18 modified + 1 new (`shell-wrap.tsx`), ~668 LOC
  of net-positive ~34 LOC (most diff is JSX indentation).

- d84468a: Page builder live preview — streaming render + theme CSS shell (#467 follow-ups).

  Two upgrades to `/api/admin/preview-blocks` flagged in the
  self-review of #485.
  - **Streaming render via `renderToReadableStream`** — replaces
    `renderToStaticMarkup` (sync). The route now `await`s
    `stream.allReady` so async data-bound blocks (`latest-posts`,
    `stats.counter`, plugin async server components) actually
    resolve in preview instead of falling back to whatever sync
    placeholder they have. Render errors flow through the existing
    error-document path.
  - **Active theme CSS in the preview shell** — the route resolves
    the active theme via `getCachedActiveTheme()` (same path the
    public renderer uses), generates token CSS via
    `generateThemeCss(DEFAULT_THEME ⨯ theme.impl.tokens)`, and
    inlines that plus the theme's `impl.css` into the preview
    document head. Theme-styled blocks (typography, theme tokens
    used as CSS variables, etc.) now look right in the iframe
    instead of falling back to system fonts only.

  Backward compatible. The preview route's wire shape is unchanged
  (POST blocks payload → HTML response). Themes that ship neither
  `tokens` nor `css` see no difference.

  Imports `react-dom/server.edge` (Web Streams, runs in Node 18+
  because Web Streams are part of the Node global) instead of
  `react-dom/server` because Next bundles only the legacy sync
  exports from the Node entry. The route still runs in the Node
  runtime — this is purely an import-path detail.

- aa7796d: **Phase 25.2 — staff auth route factory.**

  Same factory model as #535's member-auth, applied to the staff
  (admin) user pool. Each `apps/<app>/src/app/api/auth/<flow>/
route.ts` becomes 2 lines.

  `@nexpress/auth-pages/server` now also exports
  `createStaffAuthRoutes(config)` — parallel to
  `createMemberAuthRoutes(config)`. The factory returns nine
  handlers: `login`, `logout`, `refresh`, `forgotPassword`,
  `resetPassword`, `changePassword`, `oauthStart`,
  `oauthCallback`, `meGet`.

  ### Differences from member auth

  The staff factory honors the existing reference-app behavior:
  - **Different DB** — `np_users` (raw SQL via `db.$client.query`,
    matching the existing legacy code path).
  - **Different fields** — `name` (vs `displayName`), `role` (vs
    `status`), no `handle`.
  - **Different cookies** — `np-session`, `np-refresh`,
    `np-csrf`, `np-oauth-state` (vs the `np-mb-*` cookies).
  - **No registration / verify** — staff are admin-provisioned, no
    pending state. The factory has no `register` or `verifyEmail`
    handler.
  - **`changePassword` endpoint** — authenticated-user password
    change (member side handles this via `/me` PATCH instead).
  - **Plugin hooks fire** — `auth:afterLogin` and
    `auth:beforeLogout` run as before; member auth has no
    equivalent.
  - **Lockout config from env** — `getAuthRuntimeConfig()` reads
    `NP_MAX_LOGIN_ATTEMPTS` / `NP_LOCKOUT_DURATION`. Member uses
    hardcoded defaults (configurable via factory options).
  - **`np-admin-site` cookie cleared on logout** — preserves the
    multi-site picker reset behavior (#15.7).
  - **OAuth callback uses `resolveOAuthLogin`** — not
    `resolveMemberOAuthLogin`. Different identity-resolution
    policy (no email-match for staff, since staff accounts are
    pre-provisioned by admins).

  ### Reference app — fully migrated

  All 9 staff routes shrunk from ~30-150 lines each to **2 lines**.
  The `apps/web/src/lib/auth-routes.ts` bootstrap file now hosts
  both `memberAuthRoutes` and `staffAuthRoutes` side-by-side; one
  security patch landing in `@nexpress/auth-pages` fixes both pools
  in every site at once.

  ### What's NOT in this PR (explicit defer to #3b)
  - **Staff client form hooks** — `useStaffLogin`,
    `useStaffForgotPassword`, etc. The admin client forms
    (`apps/web/src/app/(admin)/admin/login/login-client.tsx` and
    friends) still ship hand-coded fetch logic. The route factory
    is the higher-impact security-patch surface; hooks follow in a
    separate PR once the routes prove stable.
  - **Staff-specific scaffold updates** — `create-nexpress`
    templates still ship hand-coded staff routes. Updates to use
    the new factory follow once `@nexpress/auth-pages` clears one
    minor-version cycle (same pattern as the member-auth
    migration).

  ### Stability

  `createStaffAuthRoutes`, `StaffAuthRoutes`,
  `StaffAuthRoutesConfig`, `StaffAuthRoutesOptions`, and
  `StaffAuthHelpersForRoutes` join v0.1's stable surface. Adding
  optional fields to the config / options objects is non-breaking;
  renaming or removing one rides a minor with a migration note.

- 930d0d4: **Phase F.4 — `impl.blocks`: theme-shipped block types + source identity contract.**

  Fourth implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.4). Themes can ship
  their own block types (`magazine.hero-feature`,
  `magazine.three-col-grid`, etc.) that participate in the
  page-builder and resolve during server render exactly like
  plugin blocks. Every contributor's blocks now carry a concrete
  source identity so the admin / renderer can correctly attribute
  them in a multi-site, multi-theme process.

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.blocks?: NpBlockDefinition[]` — theme-shipped
    block definitions. The bootstrap auto-stamps each block's
    `source` with `theme:<manifest.id>` so the activation filter
    can distinguish (e.g.) magazine's blocks from portfolio's.

  #### `@nexpress/blocks`
  - `parseBlockSource(source)` — parses the source string into
    `{ kind, id? }`.
  - `isBlockSourceActive(source, ctx)` — filter predicate.
  - `getRegisteredBlocksForActiveSources(ctx)` — full definitions.
  - `getRegisteredBlockMetadataForActiveSources(ctx)` —
    serializable metadata for the admin.
  - `NpBlockRenderContext.activeSources?: { themeId }` — when
    set, `renderBlocks` filters block instances whose source
    doesn't match and renders a "from inactive theme" placeholder.

  #### `@nexpress/next`
  - `createSiteScopedBlockRenderContext()` — async variant that
    resolves the active theme id and embeds it in
    `activeSources`. The catch-all `[[...slug]]` and theme route
    components now use this so multi-site processes get per-site
    filtering.

  ### Source identity contract

  Per design doc §4.4, every block contribution carries a
  concrete source:

  | Contributor              | Auto-stamped `source`        |
  | ------------------------ | ---------------------------- |
  | Built-in (registry seed) | undefined → parsed as `core` |
  | Plugin (via bootstrap)   | `plugin:<plugin.id>`         |
  | Theme (via bootstrap)    | `theme:<theme.manifest.id>`  |

  Bootstrap **overwrites** any author-supplied `source` field —
  authors don't pass it manually. The activation filter uses
  concrete identity to distinguish contributors; broad legacy
  labels (`"plugin"` / `"theme"`) parse as kind-only and the
  filter treats them as always-active for back-compat.

  ### Asymmetry: plugins vs themes

  Plugin blocks already get pruned at registry-write time (the
  `resetSharedBlockRegistry` flow on plugin reload re-registers
  only enabled plugins). Theme blocks stay **append-only** because
  themes have per-site activation — site A active=magazine and
  site B active=portfolio must coexist in the same process.

  So the active-source filter only checks theme sources at read
  time; plugin / core sources always pass. This keeps the filter
  cost minimal (one string parse + one theme-id comparison per
  block).

  ### Activation filter integration
  - **Admin Add-block popover**: layout fetches active theme id,
    passes filtered metadata through `BlocksRegistryProvider`. A
    multi-tenant admin only shows blocks for the current site's
    theme.
  - **Renderer**: `renderBlocks` consults `ctx.activeSources` —
    when present and the block source is filtered out, a
    placeholder div renders with `<strong>{type}</strong> is from
a theme or plugin that isn't active for this site`. Catch-all
    - theme routes both use the site-scoped ctx variant so this
      fires automatically.

  ### Tests

  11 unit tests in `packages/blocks/src/source.test.ts` covering:
  - `parseBlockSource`: undefined, broad labels, concrete ids,
    empty-id-after-colon, unrecognized schemes.
  - `isBlockSourceActive`: core / built-in always active, plugin
    always active, concrete theme matches themeId, no-active-theme
    filters all theme blocks, broad theme label passes,
    unrecognized passes conservatively.

  Total `@nexpress/blocks` tests: 11 (new package test surface).

  ### What's not in this phase
  - **Page builder red error card UI for stale instances** — the
    page builder's existing "unknown block" rendering covers the
    basic case; a richer error card (last-known props JSON,
    "remove" / "reactivate theme" actions) is a polish pass for
    a follow-up. Server-side render correctly emits the
    placeholder today.
  - **Bulk "cleanup unknown blocks" admin action** — already
    recorded in design doc §10 as a v0.3 candidate.
  - **Plugin source filter at read time** — plugins are
    process-global and pruned at write time, so a runtime filter
    would be redundant. If plugins gain per-site activation in a
    future phase, the filter extends to check pluginIds.

  ### Dependency note

  No new external dependencies. `@nexpress/blocks` gains a
  `vitest` test script (was build-only). `@nexpress/theme` already
  imports `NpBlockDefinition` from `@nexpress/blocks` for the new
  field type.

- 94be860: **Phase F.9-B — `@nexpress/theme-docs` documentation theme.**

  Second of three reference-theme rebuilds (design doc §4.9).
  This is a **net-new theme** (not a rebuild like F.9-A's
  magazine) — `theme-docs` didn't exist before. Stresses
  different v0.2 contract axes than magazine: hierarchical
  content navigation (F.2 sidebar slot), explicit `routes`
  declaration for `/search` (F.2 — search isn't a collection
  archive), and a different settings shape (version + repo URL
  - TOC toggle) for F.3.

  ### What ships

  #### Package surface
  - `packages/themes/docs/` — new package `@nexpress/theme-docs`
  - Exports `docsTheme`, `DocsHeader`, `DocsShell`, `DocsSidebar`,
    `DocsNotFound`, `DocsSearch`, `DocPageTemplate`, `docsCss`,
    `docsSettingsSchema`, type `DocsSettings`

  #### v0.2 contract surfaces
  - **F.1** `manifest.requires`: `docs` collection with
    `title` (text), `body` (richText), optional `parent` rel for
    hierarchy, `order` (number). `createIfAbsent: true` so F.8's
    CLI scaffolds it from scratch.
  - **F.3** `settingsSchema`: 5 fields — `version` (text),
    `githubRepo` (URL), `sidebarHeading` (text),
    `showTableOfContents` (boolean), `searchPlaceholder` (text).
    Pure-text + URL field set; different shape from magazine's
    enum/array-heavy schema for cross-axis validation.
  - **F.2** `impl.routes`: explicit `/search` route. Search is
    NOT an archive (it's cross-collection), so it lands in the
    routes array directly rather than archives sugar.
  - **F.6** `impl.navLocations`: `primary` location in the
    masthead (with maxItems hint).
  - **F.7** `impl.notFound`: docs-flavored 404 (different visual
    language from magazine).

  #### Components
  - `DocsShell` — header + sidebar + main grid layout
  - `DocsHeader` — masthead with brand + version chip + search
    form + GitHub link (when settings.githubRepo set)
  - `DocsSidebar` — walks `docs` collection, builds parent/order
    tree, renders nested `<nav>` (recursive `NavTree`)
  - `DocPageTemplate` — title + body + prev/next bar + optional
    "Edit on GitHub" link. Prev/next walks the same flat ordered
    list the sidebar uses.
  - `DocsSearch` — reads `?q=`, runs `searchCollections`, lists
    cross-collection hits with collection label + title +
    excerpt
  - `DocsNotFound` — concise 404 pointing at search + homepage

  #### Settings consumption
  - `resolveDocsSettings()` — typed wrapper over
    `getThemeSettings("docs")`. Parses through Zod, falls back
    to schema defaults on parse failure (admin shows banner via
    `getThemeSettingsWithStatus`).
  - Header reads version + searchPlaceholder; templates read
    githubRepo for the edit link.

  ### Validation status

  Second of 3 reference themes. F.9-C (portfolio) follows.
  F.9-D retires `default` + `minimal`.

  The docs theme registered in `apps/web`'s nexpress.config.ts
  alongside the existing four themes. Operators can switch via
  admin → Settings → Theme.

  ### What's not in this PR (F.9.1 follow-up)
  - **In-page TOC rendering**: settings expose
    `showTableOfContents`, but the actual TOC component (heading
    scanner + sticky right rail) isn't shipped yet. The flag
    flips on/off without effect — wired contract, missing
    implementation.
  - **Sidebar active-link highlight**: tree renders correctly
    but doesn't `data-current` the active page. Needs request
    URL access; deferred polish.
  - **Body rendering**: template displays a placeholder for
    `doc.body` rather than calling `renderBlocks(...)`. Sites
    that customize body rendering swap it; the contract shape is
    intact.

  ### Dependency note

  `@nexpress/theme-docs` depends on `@nexpress/blocks`,
  `@nexpress/core`, `@nexpress/editor`, `@nexpress/next`,
  `@nexpress/theme`, `zod`. `apps/web` adds the new theme as a
  workspace dep + registers it in `nexpressConfig.themes`.

- 9942779: **F.7.1 — theme error delegation pattern (working through the
  Next.js client-only constraint).**

  The v0.2 contract reserved `NpThemeImpl.error` for theme-shipped
  error UI, but Next requires `error.tsx` to be a client component
  — and a server-side reference declared on a theme's `impl`
  can't cross the React server→client boundary. F.7 kept the slot
  as a forward-compat type marker and shipped a framework default;
  F.7.1 closes the loop with a working pattern.

  ### How it works

  | Layer            | Responsibility                                                                                                                                                                                                                                          |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Theme package    | Ships a CLIENT error component at `./components/error` subpath (`"use client"` banner, separate tsup entry, exports map declares the path)                                                                                                              |
  | Site layout      | Already emits `<style data-np-theme="<id>">` for the theme's CSS — the id is in the DOM by the time error.tsx mounts                                                                                                                                    |
  | Site `error.tsx` | Maintains a `THEME_ERRORS` registry of theme-id → `lazy(() => import("@nexpress/theme-X/components/error"))`. Reads active theme via `useActiveThemeId` (queries the style tag), lazy-loads the matching theme's chunk, falls back to framework default |

  ### Bundle impact

  Only the active theme's error chunk downloads — `lazy()` defers
  the import until `<ThemeError>` renders, which only happens after
  the boundary fires + the active theme matches the registry.
  Themes not in the active theme don't reach the client bundle.

  ### Reference implementation
  - `packages/themes/magazine/src/components/error.tsx` — pilot
    theme error: editorial "Stop the press" treatment with the
    magazine's serif heading + CTA button. Uses theme CSS
    custom properties (`--np-color-foreground`, `--np-font-heading`)
    so it matches the masthead even before the rest of the page
    rehydrates.
  - `apps/web/src/app/(site)/error.tsx` — site-level delegator
    with the registry + lazy imports + framework default.

  ### Adding a new theme to the pattern
  1. Add `src/components/error.tsx` with `"use client"` at the top.
  2. Register the entry in `tsup.config.ts` under the second build
     (the one with `banner: { js: '"use client";' }`).
  3. Add the path to `package.json`'s `exports`:
     ```json
     "./components/error": {
       "types": "./dist/components/error.d.ts",
       "import": "./dist/components/error.js"
     }
     ```
  4. In the site's `error.tsx`, add a row to `THEME_ERRORS`:
     ```ts
     yourTheme: lazy(() => import("@nexpress/theme-yours/components/error")),
     ```

  Themes that don't opt in keep falling through to the framework
  default — no breaking change for portfolio / docs / minimal /
  default.

  ### Why the slot stays on `NpThemeImpl`

  `impl.error?: ComponentType` remains as a forward-compat type
  marker. If Next eventually adds a server-rendered error
  fallback API, the framework can wire it transparently from the
  server-side reference and remove the operator-maintained
  registry. The JSDoc points operators at the F.7.1 pattern in
  the meantime.

- 2c31d26: **Phase F.7 — error / 404 / SEO surface contributions.**

  Seventh implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.7). Themes can now
  contribute the public-site 404 page, plus extra sitemap / feed
  entries and a custom `robots.txt` body.

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.notFound?: ComponentType` — public-site 404
    component. Used by `(site)/not-found.tsx`.
  - `NpThemeImpl.error?: ComponentType<NpThemeErrorProps>` —
    public-site error boundary fallback. Currently typed for
    forward-compatibility; the framework's `error.tsx` ships a
    client default because Next requires error.tsx to be a
    client component (see deferred section).
  - `NpThemeImpl.seo?: NpThemeSeoHooks` — sitemap / feed / robots
    contributions.

  #### `@nexpress/core`
  - `extractNotFoundComponent` / `extractErrorComponent` /
    `extractSeoHooks` — pure structural narrowers (testable
    without DB).
  - `getActiveThemeNotFound` / `getActiveThemeError` /
    `getActiveThemeSeoHooks` — async wrappers.
  - `BuildAtomFeedOptions.extraEntries?: NpFeedEntry[]` — feed
    builder accepts theme-supplied entries; merged with the
    collection walk, deduped by id (framework wins), re-sorted
    newest-first, capped by limit.

  #### `apps/web`
  - `(site)/not-found.tsx` — delegates to active theme's
    `impl.notFound` when defined; framework default otherwise.
  - `(site)/error.tsx` — framework default (client component;
    see deferred section).
  - `sitemap.xml` route merges theme entries from
    `seo.sitemapEntries`; deduped by `loc` (framework wins).
  - `feed.xml` route passes theme entries to
    `renderAtomFeed({ extraEntries })`.
  - `robots.txt` route uses theme's `seo.robotsTxt` when defined
    (whole-body replacement); framework default otherwise.
  - `PUT /api/admin/themes/active` busts `nx:sitemap:<siteId>` +
    `nx:feed:<siteId>` when the new active theme contributes
    SEO hooks (parallel to F.3 settings save invalidation).

  ### Caching contract

  Per design doc §4.7:
  - Theme switch (`activeTheme` row write) → busts theme cache
    always; busts SEO tags when new active theme has
    `impl.seo.*`. Implemented in this phase.
  - Theme settings save (`theme.settings:<themeId>` row write)
    → already wired in F.3 via `activeThemeContributesSeo`.
  - Theme tokens save (`theme` row write) → no SEO bust. Tokens
    don't affect sitemap/feed content.

  ### What's not in this phase (deferred)
  - **Generic delegation from `(site)/error.tsx` to theme's
    `impl.error`** — Next requires `error.tsx` to be a client
    component, but theme components are server-defined. React's
    server→client boundary blocks the generic wiring. The type
    exists for forward-compat (a future Next API for
    server-rendered error fallbacks would let the framework
    delegate transparently) and themes that want a fully custom
    error surface can ship their own `(site)/error.tsx`
    override. Recorded as **F.7.1 follow-up** when the Next API
    shape settles.

  ### Tests

  7 new unit tests in `packages/core/src/themes/error-seo.test.ts`:
  - `extractNotFoundComponent` / `extractErrorComponent` —
    null on undefined / non-function, returns ref when present
  - `extractSeoHooks` — empty on missing seo, picks up
    individual hooks, ignores non-function members, partial
    declaration only fills present fields

  Total core tests: 321 (was 314).

  ### Dependency note

  `@nexpress/theme` declares `NpSitemapEntry` / `NpFeedEntry`
  local-mirror types instead of importing from `@nexpress/core` —
  same tsup DTS bundler workaround already used for
  `NpThemeTokensOverlay` (the bundler intermittently fails to
  resolve named cross-package types even when present in the
  consumed dist). Structural identity is enough; theme authors
  get the right shape and runtime values pass through unchanged.

- 1f8fbdf: **Phase F.6 — `impl.navLocations` + `<NavMenu>`: theme-declared nav mount points.**

  Sixth implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.6). Themes declare
  the semantic nav locations they consume in their shells / slots
  (`primary`, `footerLinks`, `mobileDrawer`, etc.); the admin nav
  editor populates its location dropdown from this declaration so
  operators see friendly labels instead of having to type a
  location string from memory.

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.navLocations?: Record<string, NpThemeNavLocation>`
  - `NpThemeNavLocation` — `{ label, description?, maxItems? }`

  #### `@nexpress/core`
  - `extractNavLocationsFromImpl(impl)` — pure extractor for unit
    testability (no DB roundtrip).
  - `getActiveThemeNavLocations()` — async wrapper that resolves
    the active theme then extracts.
  - `NpThemeNavLocationDescriptor` — flat output shape with
    `{ key, label, description?, maxItems? }`.

  #### `@nexpress/next`
  - `<NavMenu location="..." />` server component. Reads
    `getNavigation(location)` for the current site and renders an
    `<ul>` of items. Themes that need richer markup (mega-menus,
    mobile drawer) call `getNavigation` themselves.

  #### `apps/web`
  - `/api/navigation/locations` now merges theme-declared
    locations alongside framework defaults and operator-authored
    customs. Each entry carries `source: "default" | "theme" |
"custom"` so the editor can distinguish them; theme-declared
    keys win on collision (e.g. magazine relabeling `header` →
    "Site Header").

  ### Operator-no-code flow

  Today the operator types location strings (`header`, `footer`,
  `main`, plus whatever they remember). With F.6, themes that
  declare `navLocations` push their slot names into the dropdown
  with descriptive labels — no string memorization required.

  ### Theme component usage

  ```tsx
  import { NavMenu } from "@nexpress/next";

  export function MagazineHeader() {
    return (
      <header>
        <h1>Magazine</h1>
        <NavMenu location="primary" />
      </header>
    );
  }
  ```

  Themes can also pass `renderItem` for custom item rendering or
  omit `<NavMenu>` entirely and call `getNavigation` directly when
  the markup gets richer.

  ### What's not in this phase (deferred)
  - **Nav editor "Location assignments" panel** — design doc §4.6
    envisions a dedicated panel listing each theme location with
    a menu-id dropdown (`navAssignments[themeId][locationKey] =
menuId`). Today's editor surfaces the locations through the
    existing dropdown; a redesign with descriptions, maxItems
    hints, and a "filled vs empty" indicator is **F.6.1
    follow-up**. Operators can already author all locations
    through the existing editor — this is UX polish.

  ### Tests

  6 new unit tests in `packages/core/src/themes/nav-locations.test.ts`:
  - Empty when impl undefined / no navLocations / wrong type
  - Extracts declared locations with all fields
  - Skips entries missing a label (duck-type guard)
  - Ignores non-string description / non-number maxItems

  Total core tests: 314 (was 308).

  ### Dependency note

  `@nexpress/next` gains a `react` peer dep (`^19.0.0`) and JSX
  configured in tsconfig — required for `<NavMenu>`. Existing
  non-component exports unchanged. `@nexpress/next` was already
  in the host app's `serverExternalPackages` list, so adding
  React doesn't risk dragging server-only modules into the
  client bundle.

- 7b61ba8: **Phase F.5 — `impl.patterns`: theme-shipped block patterns + active-source filter.**

  Fifth implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.5). Themes can ship
  pre-shaped block subtrees that operators drop into pages in one
  click. Patterns participate in the same `theme:<id>` source
  identity model as F.4 blocks, so multi-site processes filter
  patterns per active site exactly like blocks.

  ### Surface added

  #### `@nexpress/blocks`
  - `NpPattern.preview?: string` — optional preview image path
    (typically served from the theme's `public/`). Picker UI
    thumbnail rendering is tracked as a follow-up; the field
    persists today regardless.
  - `NpPattern.category?: "homepage" | "page" | "section" | string`
    — optional grouping label.
  - `getRegisteredPatternsForActiveSources(ctx)` — sister of the
    F.4 block filter. Theme patterns are scoped by `themeId`;
    plugin / built-in / custom patterns always pass.

  #### `@nexpress/theme`
  - `NpThemeImpl.patterns?: NpPattern[]` — theme-shipped patterns.

  #### `@nexpress/next`
  - Bootstrap auto-stamps `source: "theme:<theme.manifest.id>"` on
    each pattern at registration. Theme patterns survive plugin
    reload (re-registered after `resetSharedPatternRegistry`)
    exactly like F.4 theme blocks.

  #### `apps/web`
  - Admin layout now filters patterns through
    `getRegisteredPatternsForActiveSources` so the page-builder's
    pattern picker only shows the current site's patterns. Same
    `getCachedActiveTheme()` resolution as F.4 — admin and
    renderer agree on the active theme.

  ### Plugin/theme parity

  Plugin patterns already get `source: "plugin:<plugin.id>"`
  (stamped in F.4). Theme patterns now get `source: "theme:<id>"`.
  The activation filter follows the same rule as for blocks —
  plugin / core / custom patterns always pass; only theme
  patterns are gated by the active theme id.

  ### Tests

  3 new unit tests in `packages/blocks/src/source.test.ts`:
  - Filters theme patterns by active theme id
  - Filters out all theme patterns when no theme active
  - Preserves `preview` + `category` fields through the filter

  Total `@nexpress/blocks` tests: 17 (was 14).

  ### What's not in this phase (deferred — explicit follow-up)

  The design doc §4.5 promises a redesigned **picker UI** with
  category grouping + preview thumbnails. Today's Cmd-K command
  menu lists patterns under a flat "Pattern" group label —
  operators CAN insert theme patterns through it, but the
  visual experience is plain.

  The picker UI redesign is **F.5.1**, a follow-up PR within
  the F.5 phase. Splitting it off keeps this PR focused on the
  contract surface (which downstream phases F.6+ depend on)
  without ballooning into a UI redesign. The deferred work:
  - Replace flat list with category-grouped sections
  - Render `preview` image thumbnails next to pattern entries
  - Filter / search by category in the picker

  Recorded here because the user-visible operator experience
  isn't fully shipped until F.5.1 lands.

- 463fe5f: **Phase F.1 — `manifest.requires`: theme data-shape declaration + admin warning surface.**

  First implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md`). Themes whose
  components assume specific collection fields can now declare
  those expectations in their manifest, and the admin theme
  switcher reads the declarations to surface mismatches before the
  operator clicks "activate".

  ### Surface added
  - `NpThemeManifest.requires` — optional declaration of expected
    collections + fields per collection.
  - `NpThemeCollectionRequirement` / `NpThemeFieldRequirement` —
    the type building blocks. Field `type` strings match
    `NpFieldConfig` variants exactly (`"checkbox"`, `"upload"`,
    `"richText"`, etc.) so the runtime check can compare without
    translation.
  - `checkThemeRequirements(manifest, collections)` — pure function
    that compares a theme's declared requirements against the
    site's registered collections. Returns structured
    `missingCollections` / `missingFields` / `typeConflicts` /
    `relationConflicts` plus `hasMismatches` and
    `hasHardMismatches` summaries.
  - `NpThemeRequirementResult` and friends — the result types,
    exported.

  ### Admin integration
  - `GET /api/admin/themes` now includes a `requirements` field per
    theme entry summarizing the check result. The check runs
    in-memory only (no DB), so listing cost is unchanged.
  - The theme switcher (`packages/admin/src/settings/theme-switcher.tsx`)
    surfaces a warning chip + summary line on each theme card
    with mismatches, including a copy of the
    `pnpm nexpress theme:install <id>` command operators will run
    in Phase F.8 to resolve. Hard requirements show as destructive
    (red); soft (`hard: false`) as amber.

  ### Soft vs hard

  Field requirements default to `hard: true`. Set `hard: false`
  when the theme degrades gracefully without the field — admin
  shows a softer warning, and the future Phase F.8 CLI may treat
  soft fields as opt-in patches.

  ### What's not in this phase

  Per the design doc:
  - The `pnpm nexpress theme:install` CLI that AST-patches
    collections to satisfy these requirements is **Phase F.8**.
    F.1 only ships the contract type + admin warning surface.
  - Activation is not blocked by mismatches — the operator can
    still activate a theme with warnings (and might choose to do
    so during dev). The warning is informational.

  ### Tests

  9 unit tests covering: no-requires no-op, missing collection,
  missing field, soft-vs-hard severity routing, type conflict on
  existing field, relationship target mismatch, relationship
  target subset acceptance, row+collapsible field walker, and
  array/group sub-record non-descent.

  Total core tests: 291 (was 282).

- 09a7b75: **Phase F.2 — `impl.routes` + `archives` sugar: theme-declared dynamic routes.**

  Second implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.2). Themes can now
  register URL patterns the framework's catch-all dispatches to,
  closing the dynamic-archive gap (`/category/[slug]`,
  `/tag/[slug]`, `/author/[id]`, `/:year/:month`, `/search`) and
  unlocking theme-only routes (`/lookbook`).

  ### Surface added

  #### `@nexpress/theme`
  - `NpThemeImpl.routes?: NpThemeRoute[]` — declared dynamic routes
    with `pattern`, `component`, optional `metadata` and `revalidate`.
  - `NpThemeImpl.archives?: NpThemeArchives` — sugar over routes
    for the common archive shapes (`byCategory`, `byTag`,
    `byAuthor`, `byDate`, `search`). Default patterns expand at
    boot; per-entry `pattern` override possible.
  - `NpRouteRenderProps` — props passed to a route component
    (`{ params, searchParams, blockCtx }`).

  Pattern syntax is a small path-to-regexp subset (no new
  dependency): literal segments match exactly, `:name` captures any
  segment, `:name(regex)` constrains the captured segment.

  #### `@nexpress/next`
  - `dispatchThemeRoute(theme, path)` — pure linear-scan matcher.
    Returns `{ route, params }` on first hit, null otherwise.
  - `collectThemeRoutes(theme)` — concatenates explicit routes
    with expanded archives. Explicit routes come first so a theme
    can override an archive pattern by declaring an explicit route
    earlier.
  - `buildRouteRenderProps(...)` — small helper that constructs
    `NpRouteRenderProps` from a match + searchParams + blockCtx.

  #### `apps/web/(site)/[[...slug]]/page.tsx`

  Catch-all integrates the dispatcher into both the page render
  path and `generateMetadata`, with the precedence locked in the
  design doc:
  1. App-explicit Next.js routes (always win — Next handles them
     before the catch-all sees the request).
  2. Page document slug lookup.
  3. Slug redirect history (operator's renamed pages).
  4. Theme route dispatcher.
  5. `/` empty-state (DefaultHomePage).
  6. 404.

  Operator-authored content always wins over theme contributions:
  a theme route can never silently shadow a CMS page or its
  rename history. Both `Page` and `generateMetadata` share the
  dispatcher — theme-rendered URLs get the route's `metadata`
  builder, not page-fallback SEO (which would be a real bug per
  design doc §4.2).

  ### Open question resolved

  Design doc §11.1 left "where does `getArchiveQuery` helper
  live?" open. Resolution: **skip for v0.2 F.2.** Theme route
  components can call `findPosts({ where: { categories: id } })`
  directly — F.E (#542) already made `hasMany` filtering work
  natively, so the boilerplate is minimal. If multiple themes end
  up sharing identical query construction, we add the helper as a
  follow-up.

  ### Tests

  14 unit tests in `route-dispatcher.test.ts` cover: null theme,
  no match, literal route, single param, multiple params, regex
  constraint enforcement, declaration-order first-match-wins,
  segment-count mismatch, leading-slash normalization, and 6
  archive expansion cases (byCategory default pattern, byDate
  year/month/day granularities, per-entry pattern override,
  explicit-routes-first ordering, empty-archives no-op).

  Total `@nexpress/next` tests: 62.

  ### What's not in this phase
  - Search-results UI is a route the theme can declare; the
    framework doesn't pre-resolve search hits for it (theme
    component calls `searchCollections` directly).
  - `getArchiveQuery` helper — see open-question resolution above.
  - **Per-route `revalidate` cache hint** — considered, dropped.
    Next's route-segment `revalidate` is a static export; we
    can't vary it per URL pattern from a single catch-all. Theme
    routes that want caching wrap their data fetches in
    `unstable_cache(...)` themselves. Tracked as a v0.3 candidate
    if a future SSG pass needs it.

  ### Multi-collection archive collision

  `archives.posts.byCategory` and `archives.products.byCategory`
  both default to `/category/:slug`, so without a per-entry
  `pattern` override only the first declaration matches. The
  framework now logs a one-time dev warning when
  `collectThemeRoutes` detects two routes sharing the same
  pattern. Themes with multi-collection archive sugar must
  override the pattern for at least N-1 of the collisions
  (documented in the `NpThemeArchives` JSDoc).

  ### Dependency note

  `@nexpress/theme` gained an optional `next` peer dependency
  (themes inherently target Next routes; the typed `metadata`
  builder uses `next.Metadata`). Existing themes are unaffected
  unless they declare `routes`/`archives`.

  `@nexpress/next` now depends on `@nexpress/theme` (was: only
  core + blocks). No cycle: theme → core, next → theme + core.

- 5efa580: **Phase F.3 — `manifest.settingsSchema` + admin auto-form: operator-tunable theme options.**

  Third implementation phase of the v0.2 theme contract extension
  (see `docs/design/theme-v0.2-extension.md` §4.3). Themes can now
  expose Zod-described operator settings; the admin renders the
  form fields automatically. Closes the no-code-customization
  loop for theme-shipped variants like "hero style", "show
  byline", or "newsletter signup URL".

  ### Surface added

  #### `@nexpress/core`
  - `NpThemeManifest.settingsSchema?: unknown` — typed loose
    (theme authors construct via `z.object({...})` and get full
    Zod inference at the call site; framework narrows back to
    `ZodTypeAny` at introspection / validation).
  - `getThemeSettings(themeId?)` — read parsed settings; defaults
    to active theme.
  - `getThemeSettingsWithStatus(themeId?)` — same plus `hasPersisted`
    - `parseError` so admin can show "settings reset" banners
      when the persisted value fails the current schema.
  - `setThemeSettings(themeId, value, updatedBy?)` — validates
    via the schema, writes the row, returns the parsed value.
    Throws `NpValidationError` on failure with field-level issues.
  - `introspectThemeSettingsSchema(schema)` — server-side walker
    that emits JSON form metadata.
  - `NpThemeSettingsField` (and per-type variants) — the metadata
    shape the admin consumes. Browser doesn't need zod at runtime.
  - `activeThemeContributesSeo()` — structural check on
    `impl.seo`. The settings save path uses this to decide
    whether to additionally bust `nx:sitemap:*` / `nx:feed:*` tags.

  #### `@nexpress/next`
  - `getCachedThemeSettings(themeId?)` — `unstable_cache` wrapper
    that reuses the existing `nx:theme:<siteId>` tag (shared with
    tokens + active theme id). Per design doc §5.3 — settings
    read on the same paths as tokens, so a shared bust avoids
    fragmenting the tag namespace.

  #### `apps/web`
  - `GET/PUT /api/admin/themes/[id]/settings` — list returns
    `{ fields, value, hasPersisted, parseError }`; PUT validates
    - persists + invalidates `nx:theme:<siteId>` (and SEO tags
      when the active theme declares `impl.seo`).
  - Theme settings page now renders the new `ThemeSettingsPanel`
    below the existing `ThemeEditor` (token editor).

  #### `@nexpress/admin`
  - `packages/admin/src/zod-form/` — generic auto-form generator
    consumed by the theme settings panel. Same primitive will
    serve plugin config UIs in a follow-up.
  - `ThemeSettingsPanel` — fetches schema + value, renders
    `ZodForm`, PUTs on save. Shows the "schema mismatch reset"
    banner when `parseError` is set.

  ### Field type coverage (v0.2 initial)

  | Zod type                              | Auto-form widget         |
  | ------------------------------------- | ------------------------ |
  | `z.string()`                          | text input               |
  | `z.string().url()`                    | URL input                |
  | `z.string().regex(/^#[0-9a-f]{6}$/i)` | color picker (heuristic) |
  | `z.number().int().min().max()`        | number input with range  |
  | `z.boolean()`                         | toggle                   |
  | `z.enum([...])`                       | select                   |
  | `z.object({...})`                     | nested fieldset          |
  | `z.array(z.object({...}))`            | repeating subform        |

  `.default(value)` and `.describe("...")` are honored. Anything
  else introspects as `unsupported` and falls back to a JSON
  textarea (operator can still edit; coverage widens in a
  follow-up).

  ### Storage

  `np_settings` row at `(siteId, "theme.settings:<themeId>")`,
  value JSONB. Coexists with the v0.1 `theme` (tokens) and
  `activeTheme` rows; per design doc §4.3 coexistence table.

  ### Cache invalidation
  - Reuses existing `nx:theme:<siteId>` tag on every save
    (settings live on the same read paths as tokens — splitting
    the tag would force two evictions on every change).
  - Additionally busts `nx:sitemap:<siteId>` + `nx:feed:<siteId>`
    when `activeThemeContributesSeo()` returns true.

  ### Schema evolution

  v0.2 ships strict `parse()`. Mismatch → returns schema defaults
  - surfaces `parseError` so admin shows a "settings reset"
    banner. Migration helpers (`migrate(old, fromVersion)`)
    deferred to v0.3 unless F.9 reference rebuild surfaces real
    demand.

  ### Tests

  15 unit tests covering: empty / non-object schema, text, url,
  color (regex heuristic), number constraints, boolean, enum
  options, default value capture, optional → required:false,
  description capture, nested object, array of objects, plus
  two unsupported-type fallbacks (string-array, date).

  Total core tests: 306 (was 291).

  ### What's not in this phase
  - Plugin config auto-form migration — F.3 builds the
    zod-to-form primitive in `@nexpress/admin/zod-form`; plugins
    keep their hand-coded config UIs until a follow-up migrates
    them. (Already recorded in design doc §10.)
  - `migrate(old, fromVersion)` schema-evolution helpers — v0.3
    candidate.
  - Type-narrowing the form value at submit — v0.2 PUTs the raw
    draft and lets the server re-validate. Client-side validation
    before submit is a polish pass.

- fe45743: **Phase D — typed collection reads + small DX wins from Phase C dogfooding.**

  Phase C surfaced four friction points; the big one (#7+#8) gets a
  proper codegen-typed surface, and the smaller two (#9, #11) get
  reference patterns documented + demonstrated.

  ### #7 + #8 — typed collection reads

  `pnpm db:generate` now also emits
  `apps/<app>/src/db/generated/documents.ts` alongside the existing
  `collections.ts` (Drizzle schema). The new file declares one
  `${Pascal}Document` interface per collection plus
  `find${Pascal}` / `get${Pascal}Document` wrappers that bind the
  type generic. Result: read-site casts disappear.

  ```ts
  // before
  const result = await findDocuments("discussions", { ... });
  const slug = doc.slug as string;
  const title = doc.title as string;
  const createdAt = doc.createdAt as Date;

  // after
  import { findDiscussions } from "@/db/generated/documents";
  const result = await findDiscussions({ ... });
  // doc.slug, doc.title, doc.createdAt — typed, no casts
  ```

  The framework surface that supports this:
  - **`NpFindOptions<T>`** is now generic. With the default
    `T = Record<string, unknown>` it behaves exactly as before
    (back-compat). With a typed `T`, `where: Partial<T>` rejects
    field-name typos at compile time.
  - **`NpFindWhere<T>` + `NpFindWhereSystemTokens`** — the where
    clause merges the document fields with system-level escape
    hatches (`siteId`, `visibility`, `locale`) so advanced callers
    don't lose access to those.
  - **`findDocuments<T>(collection, options, user?)`** propagates
    the generic through to `Promise<NpFindResult<T>>`. Uses
    `NoInfer<T>` on the options parameter to prevent TS from
    inferring T from a partial where clause — callers either pass
    the generic explicitly (typed) or accept the
    `Record<string, unknown>` default.
  - **`getDocumentById<T>(collection, id, user?)`** same generic
    propagation.
  - **`generateDocumentsModule(collections)`** — new exported
    generator that produces the full `documents.ts` content
    (imports + interfaces + read-helper wrappers).

  The untyped `findDocuments(slug, options)` from `@nexpress/core`
  still works for back-compat and stays the right call when you
  genuinely need an untyped escape hatch.

  ### #11 — dedupe expensive primitive calls across `generateMetadata` + page

  `apps/web/src/lib/cached-content.ts` wraps `getMemberProfile`
  with React's `cache()`. Pages that call the same primitive in
  both `generateMetadata` and the page body get a single fetch for
  free. `/u/[handle]/discussions/page.tsx` migrated to demonstrate.

  Cookbook documents the pattern; covers the argument-tuple
  caveat (different `avatarVariant` → different fetches → same
  behavior as before).

  ### #9 — pagination reference component

  `apps/web/src/components/pagination-nav.tsx` — small reference
  component. The framework intentionally doesn't ship a
  `<Pagination />` because visual treatment is theme territory;
  the data shape is already on `NpFindResult`
  (`hasPrevPage` / `hasNextPage` / `page` / `totalPages`). The
  component takes a `hrefForPage(p)` callback so the caller owns
  URL composition (preserving `?author=me` etc.). Migrated
  `/discussions/page.tsx` and `/u/[handle]/discussions/page.tsx`.

  ### Stability

  `NpFindOptions<T>` and `NpFindWhere<T>` join v0.1's stable
  surface. `findDocuments<T>` / `getDocumentById<T>` stable. The
  generated `documents.ts` is app-owned codegen output (not part
  of the framework's public surface), but the
  `generateDocumentsModule` function and the per-collection
  naming convention (`${Pascal}Document`, `find${Pascal}`,
  `get${Pascal}Document`) are stable — apps that vendored the
  generator will see the same shape as the official one.

- 46872bc: **First-run console banner + automated UX audit script.**

  Two related changes for the new-operator onboarding experience.

  **1) First-run nudge in `apps/web/src/lib/init-core.ts`.** On the
  first `ensureFor("read")` of each process, we count admin users
  in `np_users`. If there are zero we print a friendly console
  banner pointing at `http://localhost:<port>/admin` (the in-app
  wizard) plus the headless `pnpm seed:admin` alternative.

  Closes a discoverability gap: previously `pnpm dev` finished
  booting with Next's generic "Ready in 4s" line and an operator
  who didn't know to visit `/admin` could think the setup was
  incomplete. The new banner makes the next step obvious.

  Fire-and-forget — the DB query runs `void`-ed so request
  latency isn't affected. Latches once per process; if the DB
  query fails (table missing, migrations pending) we roll back
  the latch so the next request retries. Opt out via
  `NP_FIRST_RUN_NUDGE=off`.

  **2) `scripts/ux-audit.mts` + `pnpm ux-audit` script.** A
  non-interactive walk through the new-operator journey:

  ```bash
  pnpm ux-audit               # full audit (scaffold → build → boot → probe → clean)
  pnpm ux-audit --keep        # leave the scaffold behind for inspection
  pnpm ux-audit --quick       # skip the prod-mode probe
  pnpm ux-audit --name foo    # custom scaffold name
  ```

  Steps (each timed, each report includes an actionable hint on
  failure):
  1. `create-nexpress --local --yes --example --no-docker
<name>` scaffolds under `packages/cli/<name>` so the
     workspace picks the `workspace:*` deps up.
  2. `pnpm install` at the workspace root.
  3. `pnpm --filter <name> doctor` — env diagnosis runs without
     crashing (exit 1 is expected on a `.env`-less scaffold).
  4. `pnpm --filter <name> build` succeeds with minimal env
     (DATABASE_URL / NP_SECRET / SITE_URL stub).
  5. `pnpm --filter <name> start` boots a production server on
     port 3099. HTTP-probe / and /admin; expect /admin to 30x
     redirect.

  Output is a structured report — pass/fail per step + total
  timing + first-failure hint. Exit code 0 / 1.

  This is intentionally NOT:
  - a browser-side admin wizard test (Playwright/e2e owns that),
  - a real deployment test (platform-specific, deployment.md
    walks operators through that),
  - a plugin install / theme switch flow (integration tests
    already cover those).

  The script is for catching regressions in the **first 5
  minutes** of a new install — the surface most likely to
  silently degrade as the framework evolves.

  Scaffold scratch dirs (`packages/cli/ux-audit-*` and
  `packages/cli/my-nexpress-site`) added to `.gitignore` so the
  audit can leave artifacts behind with `--keep` without
  polluting the working tree.

- ad38623: **Blog routes dispatch through active theme posts templates —
  closes #612.**

  The reference app's `/blog` and `/blog/:slug` routes previously
  rendered hard-coded inline markup, ignoring the active theme's
  `templates.posts.{list,index,feature,detail}` entries. Theme
  authors declared list/detail templates for `posts` that were
  silently unreachable through the canonical blog URLs.

  Fix: walk the conventional template IDs in priority order;
  render through the first match. Falls back to the inline
  framework rendering when the active theme doesn't declare any.

  **Blog index (`/blog`)** — priority: `list` → `index` →
  `feature`. Magazine ships `list`, portfolio ships `index`; the
  third (`feature`) is a reserved slot for themes that want a
  magazine-style hero + grid combination.

  The list payload is packed into a synthetic `doc` matching the
  convention `PostListTemplate` and `ProjectIndexTemplate`
  already use: `{ heading, intro, docs, totalDocs, pageNum,
totalPages, hasPrevPage, hasNextPage }`. Templates that read
  additional keys see `undefined` and fall back to their internal
  defaults.

  **Blog detail (`/blog/:slug`)** — priority: doc's own
  `template` field (if set) → `detail` → `default` → `feature`.
  Mirrors the catch-all's `pages` lookup behavior so a per-doc
  template override wins regardless of theme.

  Behavior when no theme template matches is unchanged — the
  inline rendering preserves the existing `np-blog` / `np-post`
  markup the integration tests assert against. Themes don't have
  to opt in; opting in is purely additive.

  What this leaves untouched:
  - `/blog/category/:slug` — already template-aware via
    `findPosts` + `PaginationNav`; the active theme's
    `templates.posts.category` entry would extend it the same
    way (no theme ships one yet, so no change needed today).
  - The `pages` catch-all — separate dispatch surface, already
    resolves theme templates.

- 41ac5d2: fix(core, web): drop `.js` extension from generated `documents.ts` import — unbreaks Next 16 Turbopack build

  `packages/core/src/db/type-generator.ts` emitted `import { … } from "./collections.js"` into the generated `documents.ts`. That works under NodeNext module resolution (which `tsc --noEmit` uses) but breaks Next 16's Turbopack build, which respects `apps/web/tsconfig.json`'s `moduleResolution: "Bundler"` — Bundler resolution doesn't rewrite `.js` → `.ts` for relative imports the way NodeNext does.

  The two layers diverged silently: `pnpm typecheck` (58/58) kept passing because tsc handled the rewrite; `pnpm build` failed at `next build` with `Module not found: Can't resolve './collections.js'`.

  Fix: drop the `.js` extension in the generator's emit. Extension-less imports work under both resolution strategies — Bundler resolves directly to the `.ts` file, NodeNext does the same when the extension is omitted in TS source.

  Also updated the existing `apps/web/src/db/generated/documents.ts` to match (don't wait for the next `pnpm db:generate` to land it).

  361 core unit tests pass. `pnpm build` now succeeds (31/31 tasks). Plugged a real-world testing gap — typecheck and build had silently diverged on this rule for some time. Adding `pnpm build` to the per-track verification routine going forward.

- 5bea9b1: **Fix release workflow — stale `@nexpress/theme-minimal` refs +
  `@nexpress/web` ignore-list conflict.**

  After #642 unblocked the `pnpm run version` invocation, the
  Release workflow surfaced two latent issues in pending
  changesets:
  1. **`theme-minimal` retired but still referenced.** `theme-minimal`
     was removed from the workspace in #590, but two pending
     changesets still listed it in their frontmatter
     (`breaking-np-prefix-rename`, `feat-v0.2-phase-closure`).
     `changeset version` errors hard on "package not in workspace"
     instead of silently dropping the line.
  2. **`@nexpress/web` ignore-list mixed-changeset error.** With
     `apps/web` in `.changeset/config.json` `ignore`, any changeset
     that bumped `@nexpress/web` alongside library packages tripped
     "Mixed changesets that contain both ignored and not ignored
     packages are not allowed". Many existing changesets bundle the
     reference app with the libraries they exercise — the ignore was
     the friction, not the changesets.

  Fix:
  - Strip `theme-minimal` lines from the two affected changesets'
    frontmatter.
  - Drop `@nexpress/web` from `ignore`. The package is `private:
true` so changesets still won't publish it; only its version
    number gets bumped, which is harmless (the reference app is
    never installed from npm).

  Verified: `pnpm run version` runs cleanly end-to-end locally.

- b8c3b8d: fix(themes, web): strip `<main>` from `(site)`-tree components — eliminate nested landmarks

  `(site)/layout.tsx` already emits `<main className="np-site-main">` as the page's single landmark. Eight components inside the layout's children also emitted their own `<main>`, producing nested mains:
  - `apps/web/src/app/(site)/not-found.tsx` (default JSX)
  - `apps/web/src/app/(site)/error.tsx` (DefaultError JSX)
  - `packages/themes/magazine/src/not-found.tsx` (`MagazineNotFound`)
  - `packages/themes/magazine/src/components/error.tsx` (`MagazineError`)
  - `packages/themes/magazine/src/archives.tsx` (`ArchiveLayout`)
  - `packages/themes/docs/src/not-found.tsx` (`DocsNotFound`)
  - `packages/themes/docs/src/search.tsx` (`DocsSearch`, two branches)
  - `packages/themes/portfolio/src/not-found.tsx` (`PortfolioNotFound`)

  HTML spec allows one `<main>` per page; nesting breaks landmark navigation in screen readers and confuses ATs. Cleanup mirrors the same fix M.ref applied to the `(member)` tree (per the M.ref self-review). Each component now uses `<div>` with a class name unchanged, with an inline comment pointing to the layout's outer `<main>` as the single landmark.

  No visual change — `<main>` and `<div>` render identically without browser default styling. No CSS selectors changed (all selectors target the class names).

  Verified with `pnpm typecheck` (58/58) and `pnpm build` (31/31).

  Memory note `(site) tree nested-main cleanup` (recorded as a deferred follow-up after M.ref) is now closed.

- 6fd0332: **Theme-system cleanup cluster — closes #600, #601, #602, #607, #610.**

  Five small fixes against the theme system, batched. None of
  them are user-facing breakage; they're correctness regressions
  that piled up across the v0.2 / theme-system work and would
  have surfaced as confusing behavior over time.

  **#610 — theme-minimal stale references.** The `theme-minimal`
  package was retired in #590 but three integration tests still
  imported it (`theme-switcher`, `theme-render`,
  `theme-layout-swap`) and `packages/theme/README.md` still
  listed it. Tests migrated to `theme-magazine` (matching the
  "magazine modifier" / `np-magazine-header` assertions);
  README's "Reference themes" list now reflects the actual four
  shipped themes.

  **#601 — theme error delegation depended on `impl.css`.** The
  (site) / (member) layouts only emitted `<style
data-np-theme="...">` when `impl.css` was truthy. A theme that
  shipped a client error subpath but no theme-owned CSS would
  silently fall back to the framework default error page because
  the boundary's `useActiveThemeId()` reads that data attribute.
  Now both layouts emit an empty `<style data-np-theme="...">`
  marker when a theme is active even if its CSS string is empty.

  **#600 — block cleanup tool treated inactive-theme blocks as
  known.** `/api/admin/blocks/unknown` built its known-types set
  with the unfiltered `getRegisteredBlocks()`, which includes
  every installed theme's blocks regardless of active state.
  After switching themes, `magazine.*` blocks remained "known"
  on a `portfolio`-active site, so the cleanup tool reported
  nothing for the exact theme-switch flow it advertises. Now
  the scan uses `getRegisteredBlocksForActiveSources({ themeId
})`, aligning with how the public renderer treats those
  instances (placeholder rendering).

  **#607 — page-builder preview used wrong render context.** The
  preview API (`/api/admin/preview-blocks`) called
  `createDefaultBlockRenderContext()` — no active-source filter —
  so the iframe rendered inactive-theme blocks normally while
  the public site showed placeholders. Preview disagreed with
  production output. Now uses
  `createSiteScopedBlockRenderContext()`, matching the catch-all.

  **#602 — scaffold admin layout skipped active-theme filter.**
  The reference `apps/web` admin layout filters block metadata
  - patterns through the active-source context (#590, F.5), but
    the `create-nexpress` template still emitted unfiltered
    `getRegisteredBlockMetadata()` / `getRegisteredPatterns()`.
    Freshly scaffolded apps would surface every installed theme's
    blocks in the editor regardless of which was active. Template
    now mirrors the reference app's filter.

  No new tests — each fix is verified by the existing integration
  suites (which were broken by #610's stale refs anyway, now
  restored). Repo typecheck + lint + unit tests all green.

- Updated dependencies [5103c65]
- Updated dependencies [71045bd]
- Updated dependencies [53416e9]
- Updated dependencies [03bc2b7]
- Updated dependencies [92baa44]
- Updated dependencies [b66581e]
- Updated dependencies [6dcb8ee]
- Updated dependencies [c40cded]
- Updated dependencies [c40cded]
- Updated dependencies [ab9c759]
- Updated dependencies [2eb505d]
- Updated dependencies [e93a46d]
- Updated dependencies [b9a4e08]
- Updated dependencies [0e54051]
- Updated dependencies [8bed938]
- Updated dependencies [131be43]
- Updated dependencies [4ebf2b4]
- Updated dependencies [5203fd7]
- Updated dependencies [7632009]
- Updated dependencies [afefb19]
- Updated dependencies [9f3a81b]
- Updated dependencies [65da716]
- Updated dependencies [596cdfa]
- Updated dependencies [86de2e4]
- Updated dependencies [f0687ac]
- Updated dependencies [0c59b98]
- Updated dependencies [f778e80]
- Updated dependencies [3bf7539]
- Updated dependencies [82c24ed]
- Updated dependencies [6672371]
- Updated dependencies [89c32db]
- Updated dependencies [291c2f0]
- Updated dependencies [53627e1]
- Updated dependencies [98d3a4e]
- Updated dependencies [6da32de]
- Updated dependencies [6657059]
- Updated dependencies [ae0c053]
- Updated dependencies [dccf7d0]
- Updated dependencies [d8f8496]
- Updated dependencies [532aefe]
- Updated dependencies [ac3f8bc]
- Updated dependencies [2f36e2e]
- Updated dependencies [a107c8a]
- Updated dependencies [0dc95b9]
- Updated dependencies [53db1b8]
- Updated dependencies [c829160]
- Updated dependencies [f98fe9c]
- Updated dependencies [77495e7]
- Updated dependencies [9f3a81b]
- Updated dependencies [f82ed03]
- Updated dependencies [d3ea817]
- Updated dependencies [60e5dc6]
- Updated dependencies [cf5db32]
- Updated dependencies [8894f34]
- Updated dependencies [684530d]
- Updated dependencies [7399d8c]
- Updated dependencies [580f0f2]
- Updated dependencies [4edfa42]
- Updated dependencies [225d6a1]
- Updated dependencies [a74a776]
- Updated dependencies [2084b7c]
- Updated dependencies [1f4c718]
- Updated dependencies [f239ce0]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [ad7ea4e]
- Updated dependencies [33b31f9]
- Updated dependencies [4af9d6a]
- Updated dependencies [ca1722e]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [b78dbbc]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [aa7796d]
- Updated dependencies [930d0d4]
- Updated dependencies [94be860]
- Updated dependencies [9942779]
- Updated dependencies [2c31d26]
- Updated dependencies [c1b2157]
- Updated dependencies [1f8fbdf]
- Updated dependencies [7b61ba8]
- Updated dependencies [0a7f284]
- Updated dependencies [463fe5f]
- Updated dependencies [09a7b75]
- Updated dependencies [c9670db]
- Updated dependencies [54d300a]
- Updated dependencies [6241386]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [4dae122]
- Updated dependencies [ddbb536]
- Updated dependencies [e8cc136]
- Updated dependencies [51a7c75]
- Updated dependencies [ab55980]
- Updated dependencies [41ac5d2]
- Updated dependencies [10d3d1d]
- Updated dependencies [6772bf2]
- Updated dependencies [f5df65e]
- Updated dependencies [b42d8ff]
- Updated dependencies [961f456]
- Updated dependencies [2c05fab]
- Updated dependencies [e66e922]
- Updated dependencies [6c9c480]
- Updated dependencies [886ea26]
- Updated dependencies [7bd7732]
- Updated dependencies [b8c3b8d]
- Updated dependencies [3eeac73]
- Updated dependencies [45020fd]
- Updated dependencies [6fd0332]
- Updated dependencies [4fa8e89]
- Updated dependencies [2c05fab]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [fcbb9f3]
- Updated dependencies [15aa1d4]
- Updated dependencies [71427c8]
- Updated dependencies [89c7180]
- Updated dependencies [03db59e]
- Updated dependencies [e460cc3]
- Updated dependencies [1a60fdc]
- Updated dependencies [6483de7]
  - @nexpress/admin@1.0.0
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0
  - @nexpress/editor@1.0.0
  - @nexpress/next@1.0.0
  - @nexpress/plugin-forum@1.0.0
  - @nexpress/plugin-oauth-github@1.0.0
  - @nexpress/plugin-oauth-google@1.0.0
  - @nexpress/plugin-reading-time@1.0.0
  - @nexpress/plugin-sdk@1.0.0
  - @nexpress/plugin-seo-audit@1.0.0
  - @nexpress/theme@1.0.0
  - @nexpress/theme-default@1.0.0
  - @nexpress/theme-magazine@1.0.0
  - @nexpress/theme-portfolio@1.0.0
  - @nexpress/wp-import@1.0.0
  - @nexpress/xliff@1.0.0
  - @nexpress/auth-pages@0.2.0
  - @nexpress/theme-docs@0.2.0
  - @nexpress/plugin-block-newsletter@0.1.1
  - @nexpress/plugin-block-callout@0.1.1
  - @nexpress/plugin-block-embed@0.1.1
  - @nexpress/plugin-block-latest-posts@0.1.1
  - @nexpress/plugin-block-pricing@0.1.1
  - @nexpress/plugin-block-stats@0.1.1
