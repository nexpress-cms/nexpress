# @nexpress/core

## 0.3.24

## 0.3.23

## 0.3.22

### Patch Changes

- 7a28472: Harden Document view quick insert and preview cleanup while extending persistence coverage.
  Emit typed generated-schema foreign-key callbacks so self-referential collections typecheck under
  project-service lint.
- 31f1868: Keep schema-backed plugin config forms consistent between the plugin list Configure dialog and the plugin detail page. Also harden theme/plugin settings schema introspection for wrapped array elements and add tested helpers for one-item-per-line string-array inputs.

## 0.3.21

### Patch Changes

- edfc9ae: Raise the optional Nodemailer peer range for v9 compatibility and move the
  WordPress importer to the Undici 8.5.0 security release.
- b5b9074: Restore legacy plugin settings saves through the dedicated plugin config route while keeping schema-backed plugin config validation intact.

## 0.3.20

## 0.3.19

## 0.3.18

## 0.3.17

## 0.3.16

## 0.3.15

## 0.3.14

### Patch Changes

- bf8ca4d: Require Nodemailer 8.0.5 or newer for the optional email peer dependency so projects do not satisfy @nexpress/core with vulnerable Nodemailer 7.x releases.

## 0.3.13

## 0.3.12

## 0.3.11

## 0.3.10

### Patch Changes

- 45bca0d: Fix bundled-theme archive and project-link regressions: theme seeds can now attach posts to categories, `findPosts` resolves hasMany relationship filters through registered join tables, magazine section/category archives render seeded category posts, and portfolio project cards link to `/work/:slug`.

## 0.3.9

## 0.3.8

### Patch Changes

- b331118: Add bundled analytics-lite and webhook-relay plugin examples, and derive admin,
  page-route, and scheduled-task capabilities from `definePlugin()` declarations.
  Also derive page-route and scheduled-task catalog metadata and add typed admin
  action result helpers. Add plugin storage append/listValues helpers for
  event-log style plugin data. Add typed admin action registration helpers and
  pass the runtime context into action handlers. Update plugin scaffolds/tests
  around the newer authoring surface and document the `allowedHosts: ["*"]`
  escape hatch for operator-configured integration endpoints.

## 0.3.7

## 0.3.6

## 0.3.5

## 0.3.4

### Patch Changes

- 4d997b8: Runtime + dev dependency bumps batched from Dependabot's open queue (PRs #818-#827 minus #826). All deps in published packages move under semver patch/minor; no public-API surface change.
  - `@nexpress/core`: `@aws-sdk/client-s3` 3.840.0 → 3.1049.0, `jose` 6.2.2 → 6.2.3, `pg` 8.20.0 → 8.21.0
  - `@nexpress/admin`: `react-hook-form` 7.72.1 → 7.76.0
  - `@nexpress/cli`: `ts-morph` 25.0.1 → 28.0.0 (major; the only direct API surface we use — `Project`, `SyntaxKind`, `SourceFile`, `CallExpression`, `ObjectLiteralExpression`, `ArrayLiteralExpression`, `Node` — is stable across 25 → 28 per the upstream changelog)
  - Dev-only (no consumer surface): root `typescript-eslint` 8.59.3 → 8.59.4; `apps/web` `@playwright/test` 1.59.1 → 1.60.0, `tailwindcss` + `@tailwindcss/postcss` 4.2.2 → 4.3.0; `pg` devDep alignment to 8.21.0 in `@nexpress/app` + `create-nexpress` (matches `@nexpress/core`'s runtime range).

  Held back from this batch: `undici` 6.25.0 → 8.3.0 (#826). The bump triggers a typecheck failure in `packages/wp-import/src/media/download.ts` because Node's bundled fetch types resolve `Dispatcher` against `undici-types@6.21.0` (Node 22's vendored undici), and an explicit `undici@8` dep introduces a cross-version `DispatchOptions` mismatch. Needs a small refactor in wp-import to be safe; deferred to a follow-up.

  `pnpm verify` (build + typecheck + test across all 79 turbo tasks) green locally with the 9 included bumps.

## 0.3.3

### Patch Changes

- 3072b40: `group` field's `defaultValue` is now honored at the validation layer. Previously a collection field of the shape

  ```ts
  {
    type: "group",
    name: "seo",
    required: true,
    defaultValue: { metaTitle: "Untitled", metaDescription: "" },
    fields: [
      { type: "text", name: "metaTitle", required: true },
      { type: "text", name: "metaDescription" },
    ],
  }
  ```

  silently dropped the default — the group branch in `buildZodSchema` early-returned before `applyFieldDefault` got a chance to wrap the assembled object schema, so API callers omitting `seo` hit a required error even though the framework had a sensible default ready. Scalar / array / select / single-leaf defaults were unaffected; this only bit when a top-level group declared its own object-shaped default.

  Wrapping the group branch's schema in `applyFieldDefault` (mirroring the leaf-field path) closes the gap. Test coverage in `collections/validation.test.ts` now spans scalar, group, array, and container-skip cases so the contract is documented by example and a future refactor can't regress this silently.

  `row` and `collapsible` containers continue to flatten — they carry no value of their own and their nested fields' defaults are what fire.

## 0.3.2

### Patch Changes

- 131d969: Closes the last divergence path PR #808's transactional reseed left open: per-row `content:afterDelete` / `content:afterSave` post-commit hooks now defer execution until the caller's outer transaction actually commits. On rollback the deferred queue is discarded — no more ghost pg-boss `afterDelete` jobs or audit-log entries for rows that ended up restored.

  Mechanism: new `withDeferredPostCommit(callback)` from `@nexpress/core` sets up an AsyncLocalStorage-backed queue around `callback`. `runPostCommit` checks the store on every call and pushes onto the queue if a scope is active; outside the scope, behavior is unchanged (fire immediately, swallow errors). After the callback resolves, the queue drains in FIFO order, each hook independently isolated (one failure logs and moves on). If the callback throws, the queue vanishes with it.

  `api/admin/themes/reseed/route.ts` POST wraps its outer `db.transaction` in `withDeferredPostCommit`. The pattern composes — anyone bundling multiple `saveDocument({ tx })` / `deleteDocument({ tx })` calls under one tx can wrap with the same helper and get the same drain-on-commit / discard-on-rollback semantics for free.

- 1fe61de: Drizzle schema generator now honors `field.defaultValue` on `date` fields (previously dropped silently — only scalar text / number / checkbox fields were respected). Accepted shapes:
  - `"now"` sentinel → emits `.defaultNow()` (compiles to `DEFAULT now()` at migration time).
  - `Date` instance → emits `.default(new Date("<iso>"))`.
  - ISO 8601 string → parsed and emitted the same as a Date.

  Anything else is dropped (same defensive shape as the existing scalar fallbacks). Lets a theme / operator add a NOT NULL date column to a populated table in a single ALTER without a manual backfill — `defaultValue: "now"` paired with `required: true` is the common case.

  No imports change in the generated schema file; `new Date(...)` is plain JS and Drizzle converts to SQL at query-build time.

- 4e75c7a: Reseed is now fully atomic — the wipe + active-theme flip + seed all run inside one `db.transaction`. Any failure (most often the slug-collision case the 409 handler catches) rolls back every SQL write the call made; the operator never sees a half-state where the wipe committed but the seed didn't write.

  `saveDocument` joins `deleteDocument` in accepting an `NpTransaction` handle via its existing `NpSaveOptions` bag (`{ status, tx }`). The pipeline threads the handle through every read (`getDocumentByIdInternal`), every write (`createMainDocument` / `updateMainDocument` / `syncChildTables` / `syncJoinTables` / `syncMediaRefsForDocument` / `npSlugHistory` insert / `insertRevision`), and skips opening its own private tx when the caller provided one. Existing call sites that don't pass `tx` are unaffected — `saveDocument(coll, id, data, user)` still opens a private cascade tx like before.

  `setActiveThemeId` learns the same `{ tx }` option so the `np_settings.activeTheme` write joins the same scope. `wipeSeededContent` / `seedTerms` / `seedPages` / `seedPosts` / `seedNavigation` / `seedAll` all gain the option and forward it through.

  Post-commit hooks (`content:afterSave` / `content:afterDelete` jobs + plugin equivalents) still fire per-row inside the tx; their side-effects (cache busts, audit log writes on separate connections) can diverge from final DB state on rollback. Same trade-off as `#807`'s wipe-only transaction.

- 0c5b8d9: `deleteDocument` now accepts an optional `{ tx }` option that threads an outer Drizzle transaction handle through the read + cascade phases. When provided, the existence check and the per-row cascade (child tables, media refs, comments, reactions, reports, the main row itself) run against the caller's transaction — so a wrapping `db.transaction(async (tx) => { … })` covering many `deleteDocument` calls rolls back as a unit on any failure.

  `wipeSeededContent` (`@nexpress/app`'s reseed flow) uses this to make the WHOLE wipe atomic: phase 1 reads all (collection, id) targets matching the seed-source set; phase 2 opens one transaction and threads it into every per-row `deleteDocument({ tx })`. Mid-wipe failure rolls back every previously-completed delete in the same call — the operator re-runs from clean state instead of trying to reason about half-deleted seed content.

  New `NpTransaction` type alias exported from `@nexpress/core` for callers that want to type the `tx` parameter without depending on Drizzle internals. Existing `deleteDocument(collection, id, user)` call sites are unaffected (the new option is optional).

  The seed phase that follows wipe is NOT yet in the same transaction — `saveDocument` doesn't accept the option today, and pulling it into one would force a wider pipeline refactor. Mid-seed failures (most commonly the slug-collision case the 409 handler catches) still leave the wipe committed and the seed half-written; the seeder's per-theme idempotency check makes the re-run safe. The reseed route docstring spells this out.

## 0.3.1

### Patch Changes

- 07c763b: feat(theme-docs, core, app, admin): universal-content-model Phase U.2+U.3+U.4 — docs collapse into posts.kind

  Docs are now posts with `kind: "doc"`. Bundles U.2 (theme query
  rewrite + admin sidebar per-kind), U.3 (drop docs table — no
  data to migrate since pre-1.0 has no users), and U.4 cleanup
  (remove docs slug from registry) into one PR. Pages stay
  separate (the page-builder body is a different writing
  experience from prose).

  ## Theme contract (@nexpress/core)
  - `NpThemeCollectionRequirement.kinds` — keyed by discriminator
    value, each entry carries `label`, `labelPlural`, `icon`
    (lucide), optional `urlPattern`, optional `hierarchical`. The
    merge-requirements step unions across registered themes and
    stamps the result onto `admin.kinds` on the collection.
  - `NpThemeCollectionKind` exported from both
    `@nexpress/core` root and via the requirement type.
  - Merge logic now handles the `kinds` block (last-write-wins on
    per-kind props), in addition to the field-options union from
    U.1.

  ## Docs theme (@nexpress/theme-docs)
  - `requires.collections.docs` removed. The collection is gone.
  - `requires.collections.posts` now contributes `kind: "doc"`
    options, `lede` + `stableSince` fields, and
    `kinds.doc: { label, labelPlural: "Documentation",
icon: "BookOpen", urlPattern: "/docs/:slug", hierarchical: true }`.
  - `templates.docs.default` moves to `templates.posts.doc` —
    template id matches the kind value.
  - Sidebar / doc-detail route / doc-page template queries all
    switch from `findDocuments("docs", ...)` →
    `findDocuments("posts", { where: { kind: "doc", ... } })`.

  ## Built-in posts (@nexpress/app)
  - `seo.urlPath` reads `doc.kind` and returns `/docs/<slug>`
    when kind=doc, `/blog/<slug>` otherwise. Operators with
    custom kinds register their own override.

  ## Admin (@nexpress/admin)
  - `AdminShellCollection.admin.kinds` — per-kind nav metadata.
    Sidebar walks the merged map and renders one entry per kind
    under the collection's group, linking to
    `/admin/collections/<slug>?kind=<value>`.
  - Reference app's protected layout projects `c.admin.kinds`
    into the shell props.
  - Collection list view (`/admin/collections/<slug>`) reads
    `?kind=` from searchParams and adds it to the `findDocuments`
    where clause. Unknown kinds yield empty results rather than
    errors.

  ## Schema
  - `apps/web/drizzle/0003_tiresome_harry_osborn.sql`:
    `DROP TABLE np_c_docs CASCADE` + ADD COLUMN lede + ADD COLUMN
    stable_since on np_c_posts.
  - Pre-1.0 + no users → destructive drop is OK. Operators with
    doc data run U.1 first to add `kind` to posts, then export
    np_c_docs rows to `kind="doc"` posts manually before
    upgrading to this release.

  ## Open follow-ups (deliberately deferred)
  - **Create-form kind pre-fill** — clicking "New doc" from
    `/admin/collections/posts?kind=doc` should pre-set the kind
    field to "doc". Today the operator picks it manually.
  - **Generic kind URL resolver** — `seo.urlPath` hardcodes the
    `doc` branch. A reads-from-`admin.kinds.<x>.urlPattern`
    helper would generalise; not needed until a third kind lands.
  - **Kind-aware capabilities** — `content.publish.<kind>`
    capability strings designed-in but not implemented. Add when
    an operator asks for the split.

- 4067401: feat(admin, core, themes): editor sidebar group icons + descriptions (8/14)

  Adds visual hierarchy to sidebar group cards introduced in
  #757. Operators currently see plain text titles ("Publish",
  "Author", "Taxonomy") — scanning ~6 groups visually is
  slower than necessary. Each group now renders with a Lucide
  icon next to the title and an optional one-line description
  beneath when open.

  ## Type contract
  - `NpAdminGroupMeta` — `{ icon?: string, description?: string }`.
  - `NpCollectionConfig.admin.groupMeta?: Record<string, NpAdminGroupMeta>`.
  - `NpThemeCollectionRequirement.groupMeta?: Record<string, NpAdminGroupMeta>`
    — themes contribute icons for their own groups; merge unions
    across themes (last-write-wins per key).

  ## Built-in posts groups
  - Publish → Calendar
  - Lead → Layout
  - Author → User
  - Taxonomy → Tag
  - SEO → Search
  - Hierarchy → FolderTree

  ## Theme contributions
  - **theme-magazine** Magazine → Newspaper
  - **theme-portfolio** Portfolio → Briefcase
  - **theme-docs** Docs → BookOpen

  ## Admin client

  `SidebarGroupCard` gains `icon` + `description` props. The
  header layout reflows: icon → title + description (truncated
  when long) → chevron. `GROUP_ICONS` registry mirrors the
  existing `COLLECTION_ICONS` pattern in `admin-shell`. Unknown
  names fall back to no icon (silent — no warning).

  ## What's queued for the next 6 PRs
  - **PR 9 (CRITICAL)**: `admin.condition` is currently stripped
    in `toClientCollectionConfig` so the editor never sees it
    on the client. Kind-based field hiding (the entire PR 1
    promise) doesn't work in the browser today — server-side
    validation works because the pipeline has the original
    config. Needs a serializable condition predicate language
    (e.g. `{ when: "kind", equals: "doc" }`) so both server +
    client can evaluate.
  - PR 10: Empty state when every sidebar group is hidden
  - PR 11: Main column field grouping (symmetry)
  - PR 12: SEO field `maxLength` hints
  - PR 13: Container-nested field condition evaluation
  - PR 14: Nested-group error aggregation in toast + auto-expand

  ## Test plan
  - [x] core 452/452
  - [x] All themes build + typecheck clean
  - [x] admin build + typecheck clean
  - [ ] Browser: sidebar groups render with icons + descriptions

- 3de8716: feat(core, admin): hidden field validation safety (4/7)

  PR 4 of the editor progressive-disclosure sequence. Closes the
  gap where a `required` field gated by `admin.condition` would
  block save with an invisible validation error: operator sees
  no failing input but the form refuses to submit.

  ## The gap

  PR 1 wired `admin.condition` to hide fields from the editor. A
  field marked `required: true` + `condition: (data) => data.kind
=== "doc"` would:
  - Hide for kind=article posts (correct)
  - Still fail Zod's `required` check on submit (wrong)

  Operator sees nothing to fix; the only signal is the form
  refusing to advance. Same gap on the server-side pipeline —
  even if the client let the submit through, `pipeline.ts` rebuilt
  the schema unconditionally and rejected too.

  ## Fix

  `@nexpress/core/collections/validation` gains a
  `hiddenByCondition: ReadonlySet<string>` parameter on
  `buildZodSchema` + `getCollectionZodSchema(config, forData?)`.
  When set, `required` is dropped for the named fields — they
  slip through as if `required: false`. `collectHiddenFieldNames`
  is the public helper that walks fields + evaluates conditions
  against current data.

  ### Admin client

  `useForm`'s `zodResolver` is replaced with a custom resolver
  that computes hidden names per submit, rebuilds a dynamic
  schema, then delegates to `zodResolver`. Resolver fires only
  on submit (`mode: "onSubmit"` default), so the rebuild cost is
  trivial.

  ### Server pipeline

  `saveDocument`'s validation call passes the incoming `data` to
  `getCollectionZodSchema(config, data)`. The schema mirrors the
  client's drop set — a hidden field can't sneak through the
  admin's required check and then trip a server-side one.

  ### Deduplication

  Both surfaces share `collectHiddenFieldNames` from
  `@nexpress/core/collections/validation`. The admin had a local
  copy from PR 1; that's gone now in favor of the core export.
  Single source of truth, single condition-evaluation behavior.

  ## Edge handling
  - **`row` / `collapsible` containers**: walked transparently
    (their nested fields are checked individually).
  - **`group` fields**: when the group itself has a condition
    that hides it, the group name + every nested name are all
    marked hidden. Required on a hidden group OR any nested
    required is dropped.
  - **Buggy conditions** (throws): treated as "not hidden" —
    surfacing a required error is more recoverable than silently
    dropping the check.

  ## What does NOT change
  - Public surface of `getCollectionZodSchema(config)` (no
    `forData`) — back-compat. Callers that don't have current
    data continue getting the unconditional schema (matches
    pre-#759 behavior).
  - Required-without-condition fields: unchanged.
  - Default Zod error messages on visible required fields:
    unchanged.

  ## Test plan
  - [x] `core` 442/442 (existing tests cover the unchanged
        unconditional path)
  - [x] `admin` build + typecheck clean
  - [ ] Browser: edit a doc-kind post → leave `parent` blank →
        save fails with visible error
  - [ ] Edit an article post → `parent` hidden → save succeeds
        (previously would have failed with no visible error)

- 1eb6255: feat(admin, core, themes): progressive disclosure in the document editor

  The bundled-themes prebake stacks every theme's contributed
  fields on `posts` — magazine, portfolio, docs all add columns
  the operator may never need on a given post. The previous edit
  view dumped them all into one "Publishing" sidebar Card,
  forcing the operator to scroll through ~20 controls per post.

  This redesign shapes the sidebar around what the operator is
  actually authoring:

  ## Field grouping
  - New `admin.group?: string` on `NpFieldBase` — sidebar fields
    with the same `group` label render together in their own
    collapsible-style Card. Default group = `"Publish"`.
  - Group order in the rendered sidebar follows the first-seen
    order of fields in the collection's `fields` array, so
    operators control layout by ordering.

  ## Kind-aware conditional visibility
  - `admin.condition` was already typed but unread; the edit view
    now honors it. The renderer subscribes to live form values
    via `form.watch()` and re-evaluates conditions on change.
  - Built-in `posts` fields tagged:
    - `parent` / `order`: only when `kind === "doc"` (hierarchy)
    - `wpOriginalAuthor`: only when populated (no value → hidden)
  - Theme-contributed fields tagged:
    - **theme-magazine** `featured`: hidden for `kind === "doc"`
    - **theme-portfolio** `heroImage`, `client`, `year`, `role`,
      `discipline`, `span`, `coverVariant`, `coverFigure`,
      `badge`: hidden for `kind === "doc"`, grouped under
      "Portfolio"
    - **theme-docs** `lede`, `stableSince`: only when
      `kind === "doc"`, grouped under "Docs"

  ## "Show all fields" escape hatch
  - Sidebar header shows a toggle when at least one field is
    hidden by an active condition. Flipping it reveals every
    field including ones the kind filter is suppressing.
  - Toggle state persists per-collection via `localStorage`.

  ## Theme requirement contract change

  `NpThemeFieldRequirement` gains an optional `admin` block
  forwarded onto the synthesised field's `admin` slot:

  ```ts
  admin?: {
    group?: string;
    condition?: (data, siblingData) => boolean;
    position?: "main" | "sidebar";
  }
  ```

  Themes use these to bucket their contributed fields into
  sidebar groups and gate visibility by kind.

  ## Schema drift cleanup

  `apps/web/drizzle/0004_smart_valkyrie.sql` drops the orphan
  `np_c_authors` table. The magazine theme stopped declaring
  `requires.collections.authors` in #747 but the migration to
  drop the leftover table was never generated. This PR's
  schema:gen pass surfaced the drift; the auto-generated
  migration cleans it up. No data loss (table never populated).

  ## What does NOT change
  - Main column rendering is unchanged — title + body flow as
    before.
  - 2-column layout preserved.
  - No field-level data loss: hidden fields keep their stored
    values; `condition` is view-only.
  - Theme swap behavior unchanged: switching themes doesn't
    remove fields from the schema, only hides irrelevant ones
    from the editor.

  ## Tests
  - `core` 442/442
  - `web` 85/85 (builtin-themes-union gate covers field-merge)
  - All themes + admin + app build + typecheck clean

- 712c11c: fix(core, admin, themes): serializable condition predicates — fixes broken client-side field hiding (9/14)

  ## The bug

  PR 1 (#756) wired `admin.condition` in the admin editor's
  `passesCondition` helper, but `packages/next/src/client-safe.ts`
  already stripped `admin.condition` from the collection config
  before it reached the client component (Next.js can't serialize
  functions across the RSC boundary). The browser never saw the
  condition function, so the kind-based field hiding **never
  worked client-side** — every operator editing any post saw
  every field regardless of kind.

  Server-side validation (PR 4 #759) was unaffected because the
  pipeline uses the original (un-stripped) config.

  ## Fix

  New `NpFieldConditionExpr` discriminated-union type — a
  serializable JSON predicate that survives RSC serialization:

  ```ts
  condition: { when: "kind", equals: "doc" }
  condition: { when: "kind", notEquals: "doc" }
  condition: { when: "kind", in: ["doc", "page"] }
  condition: { when: "kind", notIn: ["doc"] }
  condition: { when: "wpOriginalAuthor", exists: true }
  condition: { all: [...] }                              // AND
  condition: { any: [...] }                              // OR
  ```

  `evaluateFieldCondition(condition, data)` (exported from
  `@nexpress/core`) handles both the function form (server-only)
  and the expression form (works both env), so the admin client +
  server pipeline run the same evaluator against the same data.

  `admin.condition` type widens to
  `NpFieldCondition | NpFieldConditionExpr` — both accepted, but
  **the expression form is required for client-side hiding to
  work**. Function-form conditions still run server-side (pipeline
  validation drops `required` for hidden fields, sitemap walks
  honor them) but are silently stripped client-side.

  `toClientCollectionConfig` now strips only function-form
  conditions; expression-form passes through verbatim.

  ## Migration of in-tree conditions

  All built-in / theme conditions migrate from function form:
  - `posts.parent` / `posts.order`: `{ when: "kind", equals: "doc" }`
  - `posts.wpOriginalAuthor`: `{ when: "wpOriginalAuthor", exists: true }`
  - `theme-magazine.featured`: `{ when: "kind", notEquals: "doc" }`
  - `theme-portfolio.*` (9 fields): `{ when: "kind", notEquals: "doc" }`
  - `theme-docs.lede` / `stableSince`: `{ when: "kind", equals: "doc" }`

  ## Edge handling
  - **Function condition that throws** → fails open (field visible).
  - **Malformed expression** (unknown shape) → fails open.
  - **`exists: true`** → false for `undefined`, `null`, `""`, `[]`.
  - **`all` / `any`** compose nested expressions for AND / OR logic.

  ## Tests

  `validation.test.ts` adds 9 cases covering function form, every
  expression operator, malformed shape, and `collectHiddenFieldNames`
  recursing through expression conditions. Core 452 → 461.

  ## What this unlocks

  The kind-based hiding the entire editor sequence (#756-#762) was
  designed around now actually works in the browser. Operators
  editing `kind="article"` posts won't see docs / portfolio
  fields; operators editing `kind="doc"` won't see magazine /
  portfolio fields.

- d76a0c9: fix(core, next, app): active-theme gate for theme-contributed fields in the admin editor

  Magazine-active sites surfaced Portfolio's sidebar group cards on
  the post editor — the bundled-themes prebake merges every built-in
  theme's `requires.collections.<slug>.fields` into the resolved
  config, but only collections / kinds / blocks / patterns were
  gated by the active theme. Theme-contributed FIELDS slipped
  through, so an operator on Magazine saw "Portfolio" sidebar
  chrome anyway.
  - `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>`
    on every theme-contributed field (same convention as the
    collection-level and per-kind tags). Operator-declared fields
    carry no origin; they always pass the gate.
  - `toClientCollectionConfig(config, activeThemeId)` takes a new
    optional argument and filters out fields whose `_themeOrigin`
    doesn't match. Recurses into `row` / `collapsible` containers;
    drops empty containers after gating.
  - The admin's edit + create pages resolve the active theme via
    `getCachedActiveTheme()` and pass the id through.

  Bump kind: patch on all three. The `_themeOrigin` field on
  `NpFieldBase.admin` is internal-by-convention (never set from
  operator config); the optional arg on `toClientCollectionConfig`
  is additive.

  Tests:
  - `merge-requirements.test.ts` — new case asserts `_themeOrigin`
    lands on every theme-contributed field across two themes.
  - `client-safe.test.ts` — new suite covering the gate, container
    recursion, empty-container drop, and operator-field pass-through.

- d76a0c9: fix(core, admin): admin client bundle no longer drags argon2 / pg

  `@nexpress/admin`'s `collection-edit-view` (a `"use client"`
  component) imported `collectHiddenFieldNames` and
  `evaluateFieldCondition` from the `@nexpress/core` root. The
  root re-exports `@nexpress/core/auth`, which transitively pulls
  `@node-rs/argon2` and `pg` into the bundle — Next's client
  bundler tried to resolve `argon2/browser.js`'s `verify` export
  and failed, killing every CI build since #756 landed:

  ```
  The export verify was not found in module @node-rs/argon2/browser.js
  ```

  Adds a new client-safe subpath `@nexpress/core/fields` that
  re-exports only the pure helpers (`evaluateFieldCondition`,
  `collectHiddenFieldNames`, `buildZodSchema`,
  `getCollectionZodSchema`). No transitive auth / db / sharp /
  argon2 imports — verified by grepping the produced
  `dist/chunk-*.js` files that the new entry pulls in.

  The admin's runtime import switches to `@nexpress/core/fields`;
  the type-only `import type { NpCollectionConfig, NpFieldConfig }`
  stays on the root (type imports are erased and don't drag
  runtime code).

  Bump kind: patch. Adding a new export is arguably minor by
  strict semver, but pre-1.0 we default to patch unless the user
  explicitly approves otherwise.

- 4d38283: fix(admin): hide per-kind sidebar entries whose contributing theme isn't active

  The bundled-themes prebake unions every built-in theme's
  `requires.collections.<slug>.kinds` onto `admin.kinds`. Without
  a per-kind theme-origin gate, an operator running the `default`
  theme would still see a "Documentation" entry under Content
  because `theme-docs`'s `kinds.doc` landed on `posts.admin.kinds`
  during the merge.

  Fix mirrors the existing collection-level `_themeOrigin`
  pattern: `mergeThemeRequirements` now stamps `_themeOrigin` on
  each merged kind entry, and the admin layout's projection
  filters kinds whose origin doesn't match the active theme id.
  Operator-declared kinds (no origin tag) always show.

  Tests: `core` 442/442 (+1 covering the origin stamp), `web`
  85/85 (builtin-themes-union gate unchanged).

- 88bd29b: fix(core): pipeline applies `defaultValue` before Zod validation

  Integration tests started failing across every `saveDocument`
  call after universal-content-model #748 added a required
  `posts.kind` field with `defaultValue: "article"`. Callers that
  omit the field (the canonical "minimal create" path) hit:

  ```
  ZodError: { code: 'invalid_value', values: ['article'],
    path: ['kind'], message: 'Invalid input: expected "article"' }
  ```

  `buildZodSchema` was building the field schemas without chaining
  `.default(field.defaultValue)`. The Drizzle column default runs
  at INSERT time, but the pipeline parses with Zod first, so the
  "missing required field" hit before the DB could fill it.

  Fix: `applyFieldDefault` chains `.default(field.defaultValue)`
  onto the schema when the field declares one. Callers that DO
  provide a value get their input through unchanged; callers that
  omit get the default substituted before validation. Operator-
  authored configs with `defaultValue` now actually work for the
  zero-input case the docs imply they should.

  Local: core 462/462 unit + 46/46 integration pass against the
  test Postgres instance.

- 48ce0d1: fix(core): config Zod schema accepts the serializable `admin.condition` expression form

  #764 widened the TypeScript type of `admin.condition` to accept
  either a function or a serializable expression object, but
  `collectionConfigSchema`'s `fieldBaseSchema.admin.condition` was
  still constrained to `functionSchema`. Booting any site whose
  config had migrated to the expression form (built-in posts,
  theme-docs, theme-magazine, theme-portfolio) crashed at
  `defineConfig`'s validation step with "admin.condition: Invalid
  input".

  `apps/web/tests/system-health-checks.unit.test.ts` caught this
  after #764 merged. The fix is a union — the Zod schema now
  accepts either the function or the new `conditionExprSchema`
  (which mirrors the type's union: `equals` / `notEquals` /
  `in` / `notIn` / `exists` / `all` / `any` recursively). The
  runtime evaluator is the single source of truth for shape
  correctness; the schema is permissive (`z.unknown()` for
  operand values) so future operator additions don't force a
  schema bump.

- 6f46b5a: chore(theme-magazine): use np_users for bylines instead of a separate authors collection

  The magazine theme used to declare its own `authors` collection
  (`name` + `bio`, `createIfAbsent: true`) and point
  `posts.author` at it. That table mirrored what `np_users`
  already provides — every staff/editor user has `name`, and is
  referenceable by id — and ran on the bundled-themes prebake
  path, so every scaffolded site got an empty `np_c_authors`
  table whether magazine was active or not.

  Magazine now matches the built-in `posts` collection in
  `@nexpress/app`: `author` is `relationTo: "users"`. Bylines
  resolve through `np_users` directly. The byline render path
  in `archives.tsx` / `post-feature.tsx` / `post-card.tsx` was
  already shape-agnostic (`author.name` works on either row), so
  no template change is needed.

  **Author archive at `/author/:id`** — the route stays, but now
  queries `np_users` via the new `getUserById` helper exported
  from `@nexpress/core/auth` (mirrored at the package root). The
  "author bio" sub-line on the archive header is dropped — bio
  is not part of the `np_users` schema. Sites that want guest
  authors without admin accounts can re-add an authors collection
  on their own; the framework no longer ships one by default.

  New on `@nexpress/core`:
  - `getUserById(id): Promise<NpUserBasic | null>` — minimal
    `{ id, name, email }` projection. The supported entry point
    for theme code that needs to render a byline from
    `posts.author: relationTo("users")`. Available from both
    the package root and `@nexpress/core/auth`.

  Migration: sites that activated magazine before this release
  have an `np_c_authors` table in their database. Drizzle won't
  drop it (the framework only adds via `createIfAbsent`); operators
  can drop it manually if it's empty. Magazine no longer reads
  that table.

- 17c90d6: feat(core, app, theme): universal-content-model Phase U.1 — `posts.kind` field + select-options union

  First implementation phase of the universal-content-model track
  (design lock: PR #748, design doc: `docs/design/universal-content-model.md`).
  This phase introduces the data-model primitives. **Articles still
  work exactly as today** — nothing visible changes until Phase U.2
  when theme-docs declares `kind="doc"`.

  ## What lands

  ### Built-in `posts` collection (`@nexpress/app`)
  - New `kind` field: `select`, required, default `"article"`. One
    option shipped (`Article`); themes union additional kinds via
    `requires.collections.posts.fields.kind.options`.
  - New `parent` field: `relationship → posts` (nullable). Used by
    hierarchical kinds (docs, sections). Article-kind posts ignore it.
  - New `order` field: `number` (nullable). Sort order within a
    parent. Only meaningful for hierarchical kinds.

  ### Theme contract changes (`@nexpress/theme`)
  - `NpThemeSeedPost` gains optional `kind`, `parentSlug`, `order`,
    and `data` fields. `kind` defaults to `"article"`; theme seed
    data can declare `kind: "doc"` (etc.) once a theme registers
    that kind. `parentSlug` references a sibling seed row by slug
    — the seeder writes children in pass 1 and resolves parents
    in pass 2.
  - **`NpThemeSeedDocument` + `seedContent.documents` slot
    REMOVED.** Per design decision §10.5 (#748): zero theme
    consumers in-tree, no transition period. Themes that want to
    seed non-article kinds use `seedContent.posts` with `kind` set
    on each entry.

  ### Schema codegen + migration (`@nexpress/core`)
  - The generator now honors `field.defaultValue` for text /
    select / radio / textarea / email / number / checkbox columns
    — it previously dropped the value silently. Drizzle emits
    `DEFAULT '<value>'` in the migration, so adding a NOT NULL
    column to a table with existing rows succeeds without manual
    SQL fixups.
  - `apps/web/drizzle/0002_good_jack_murdock.sql` includes the
    Phase U.1 columns AND catches up accumulated post-#727 schema
    drift (portfolio's project fields, docs theme's lede /
    stable-since / badge). Run `pnpm db:generate && pnpm db:migrate`
    after pulling.

  ### Merge logic (`@nexpress/core`)
  - `merge-requirements.ts` gains select-options union semantics
    (design decision §10.3). When two themes contribute select
    options on the same field, options are deduped by `value` and
    last-wins on `label`. This is what lets theme-docs add
    `kind="doc"` to the shared `kind` select without colliding
    with the operator's `"article"` option.
  - `NpThemeFieldRequirement` gains an optional `options` field
    (select-only). Other field types ignore it; the same
    last-write-wins applies to non-select shapes via the existing
    name-collision path.

  ## What does NOT land in this phase
  - The kinds-metadata block (`requires.collections.<slug>.kinds`)
    that drives per-kind admin sidebar entries. Deferred to Phase
    U.2 where theme-docs declares `kind: "doc"` end-to-end so the
    sidebar logic ships alongside its first consumer.
  - `docs` collection migration. Still its own collection; Phase
    U.3 moves rows.

  ## Tests
  - `merge-requirements.test.ts` adds 3 unit tests covering the
    select-options union (additive, dedupe-by-value, refuse to
    union into a non-select field).
  - `@nexpress/core` 430 tests pass, `apps/web` 85, all themes
    build + typecheck clean.

## 0.3.0

### Patch Changes

- ab3afa7: Bundled-themes prebake: built-in theme swaps no longer need a migration.

  **Background** — scaffolded sites already ship `themes: [...defaultThemes]`, and `defineConfig` already runs `mergeThemeRequirements` over every entry. The union of every built-in's `requires.collections` therefore lands in the merged schema at boot, and the first `pnpm db:generate && pnpm db:migrate` materialises every column any built-in needs. What was missing was (a) a CI gate that asserts the union is conflict-free, and (b) an admin UI that hides theme-synthesised collections whose owning theme isn't active. Without (b), the docs-only operator sees Magazine's `authors` slug in the sidebar despite never picking Magazine.

  **`@nexpress/core`** — `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>` on collections it synthesises via a theme's `requires.collections.<slug>.createIfAbsent: true`. Collections the operator declared (or that two themes both declare via `createIfAbsent`) carry no origin tag — they're owned by the operator. `NpCollectionConfig.admin._themeOrigin` is a new optional string field; never set it by hand from operator config.

  **`@nexpress/app`** — the protected admin layout reads `_themeOrigin` and filters out collections whose origin theme is not the active one. Operator-declared collections always pass; theme-synthesised collections appear in the sidebar only while their owning theme is active. The collection's database table remains in place across swaps, so re-activating the theme re-surfaces any previously captured rows.

  A CI gate (`apps/web/tests/builtin-themes-union.unit.test.ts`) asserts that the union of every built-in's `requires` produces zero theme-vs-theme field conflicts against the default collections array. Future built-ins that collide with an existing one fail this test before reaching `main`.

  Field-level visibility (e.g. hiding Magazine's `posts.featured` while running Docs) is intentionally NOT filtered today — the column stays on the edit view so any data captured under another theme remains addressable. Promote this to a separate follow-up once the data-preservation UX is settled.

## 0.2.2

### Patch Changes

- e733d47: Replace `pnpm nexpress theme:install <pkg>` with a friendlier two-piece flow: framework-side auto-merge of theme requirements at config-resolution time, plus a single `pnpm nexpress theme add <pkg>` command for installation + registration.

  **`@nexpress/core`** — `defineConfig` now walks every theme on `config.themes` and unions each theme's `manifest.requires.collections` into the resolved `collections` array. For each existing collection slug, the theme's declared fields are appended to that collection's `fields` (operator-authored fields with the same name always win, so the merge is non-destructive). For slugs that don't yet exist AND the theme set `createIfAbsent: true`, a minimal collection is synthesised. The merge is exposed as `mergeThemeRequirements(collections, themes)` for tooling that wants to introspect the resolved shape without going through `defineConfig`.

  **`@nexpress/cli` (`@nexpress/cli-nexpress`)** — new `nexpress theme add <pkg>` command: runs `pnpm/yarn/npm add`, AST-patches `nexpress.config.ts` via two new marker pairs (`@nexpress:themes-imports-start/-end` + `@nexpress:themes-list-start/-end`), and probes the installed package's export shape to confirm it ships a `<name>Theme` named export. `--apply` chains `db:generate` + `db:migrate`; `--dry-run` prints the plan; `--yes` skips the prompt. The legacy `theme:install` command and its AST-patcher (`extract-collection`, `patch-collection`, `generate-collection`) are removed — the auto-merge replaces every reason to touch operator collection files. `theme:uninstall` keeps working unchanged.

  **`@nexpress/admin`** — Themes page guidance no longer suggests `theme:install`. When `checkThemeRequirements` still flags missing fields after the auto-merge (only possible when an operator-declared field has a conflicting TYPE), the hint surfaces the conflicting types and points at `src/collections/*.ts`. Otherwise the hint is the plain `pnpm db:generate && pnpm db:migrate` reminder.

  **`create-nexpress`** — scaffolded `nexpress.config.ts` ships with the new `@nexpress:themes-imports-*` and `@nexpress:themes-list-*` markers so future `theme add` invocations have anchors out of the box.

  **`@nexpress/theme-magazine` / `@nexpress/theme-portfolio`** — their `requires.collections.posts.*Image` upload fields now declare `relationTo: "media"` explicitly. Without it `mergeThemeRequirements` silently skipped the field (no scalar relation target), so the column never landed in the generated schema and the theme's hero/cover slot rendered against an empty value. The merge layer keeps the warning for any other upload requirement missing `relationTo` to surface the same gap in third-party themes.

  Operator-visible migration:

  ```bash
  # Before
  pnpm nexpress theme:install @nexpress/theme-magazine     # ran AST patches on src/collections/*.ts
  pnpm db:migrate

  # After
  pnpm nexpress theme add @nexpress/theme-magazine         # only edits nexpress.config.ts
  pnpm db:generate && pnpm db:migrate                       # (or `theme add --apply` to chain)
  ```

## 0.2.1

## 0.2.0

## 0.1.6

## 0.1.5

## 0.1.3

### Patch Changes

- bb6f71c: Remove `prepublishOnly: "pnpm build"` from every package. The script
  ran each package's tsup (with `--clean`) in parallel during
  `changeset publish`, so siblings' `dist/` got wiped mid-build and
  the DTS step couldn't find sibling type declarations. The root
  `pnpm release` already runs `pnpm build` upfront, so the
  per-package safety net was redundant AND racy.

## 0.1.2

## 0.1.1

### Patch Changes

- e062ed7: **0.1.1 — post-launch cleanup + first-time UX.**

  Bundles every change since the v0.1.0 first publish into one patch
  release. The npm registry stays on the 0.1.x track; 0.2.0 was
  attempted (and the version-PR landed locally) but the CI publish
  failed end-to-end due to npm 10 not supporting Trusted Publishing
  (npm 11.5.1+ required) — fixed in the release workflow, but the
  0.2.0 bump itself was premature for the size of changes shipped.

  ### `@nexpress/core`
  - `getPluginConfig` read/write asymmetry fixed (#664). `setPlugin`
    writes to `np_settings` for any pluginId; `getPluginConfig` now
    reads it back regardless of whether the plugin is registered.

  ### `@nexpress/admin`
  - Empty-state CTA on `/admin/collections/<slug>` (#666). Truly-empty
    collections render a "Create your first \<singular>" card instead
    of the generic "No documents found" line.
  - Dashboard welcome card → 5-step setup checklist (#666). Tracks
    site name set / first post published / theme chosen / production
    domain set.
  - Topbar user-menu trigger now has `aria-label="Open user menu"`
    (#664) so the e2e selector matches a stable accessible name.

  ### `@nexpress/theme-magazine`, `@nexpress/theme-portfolio`
  - `padding-inline-start` instead of `padding-left` on mobile sub-nav
    lists (#664). Makes RTL locales render with the correct leading
    edge.

  ### Internal (no operator-facing change)
  - Drizzle migration history squashed to a single `0000_init.sql`
    (#646). New installs run one migration to reach the v0.1 schema.
  - Repository transferred from `hahabsw/nexpress` to
    `nexpress-cms/nexpress` (#647). `repository.url` metadata updated
    across every published package.
  - Release workflow: `publish: pnpm run release` restored + npm 11+
    installed before publish so Trusted Publishing actually
    authenticates (#670). The v0.2.0 attempt's E404 was npm 10 not
    supporting the OIDC TP token, not a TP-config mistake.
  - CI noise reduction: docs / changesets / community-file paths
    no longer trigger main-push CI; E2E gated to PRs only.

## 0.1.0

### Minor Changes

- 952483c: Phase 22.2 — surface known-unsafe configurations at boot via the
  structured logger.

  `@nexpress/core` adds `verifyStartupSafety(input)` (re-exported from
  the package root) — a pure function that takes the resolved storage
  adapter id, the auth secret, `NODE_ENV`, and the `NP_MULTI_NODE` flag,
  and emits warnings through `getScopedLogger({ subsystem: "boot" })`
  for the two operationally-bitten cases:
  - `LocalStorageAdapter` running with `NP_MULTI_NODE=true` (or `=1`),
    which silently drops uploads as nodes diverge on the local
    `./uploads` dir.
  - `NODE_ENV=production` with `NP_SECRET` unset or shorter than 32
    characters, which lets sessions be forged with a weak key.

  `@nexpress/next` calls the helper once per process from
  `createBootstrap()`'s `ensureServices`, so any app using the standard
  bootstrap (apps/web, scaffolded sites) picks the warnings up
  automatically. Operators with `setLogger(...)` already in place get
  the warnings in their structured-log pipeline; others see them on
  stdout via the default `consoleLogger`.

  Returns the list of emitted warning ids so tests can assert on them;
  nothing in production reads the return value.

- 4c01668: Phase 22.4 — readiness probe round-trip for the job queue.

  Adds an optional `isHealthy?(): Promise<boolean>` method to the
  `NpJobQueue` interface and implements it on `PgBossAdapter` via
  `PgBoss.isInstalled()` (a single SELECT against `pgboss.version`).
  Adapters that don't implement it are assumed healthy — the readiness
  probe never fails on a missing answer.

  Before: `/api/health/ready` only checked whether the queue object had
  been set on the singleton. A dead pool, a half-applied schema, or a
  silently-rejected `startProducer()` left readiness reporting `ok` while
  the queue was unusable.

  After: when the wired adapter exposes `isHealthy()`, the probe round-
  trips it and reports `ok: false` + `detail` on failure (and the
  endpoint returns 503, matching the existing degraded-mode contract).
  The pg-boss adapter swallows exceptions internally and returns
  `false`, so callers never see a thrown error.

- 75f65a2: Phase 22.6 — domain-bounded subpath exports for `@nexpress/core`.

  The single root `index.ts` had grown to ~91 export blocks across DB,
  auth, community, jobs, i18n, media, observability, and SEO surfaces.
  For a published package, that's a v1 commitment to the entire mixture.
  This carves the surface into subpath entries so consumers can reach a
  single domain without pulling in the others' types and so future
  deprecations are scoped per domain:
  - `@nexpress/core/auth` — capabilities, JWT, OAuth, sessions
  - `@nexpress/core/community` — comments, reactions, reports, bans, …
  - `@nexpress/core/db` — connection, runtime, schema codegen
  - `@nexpress/core/i18n` — locales, translations, formatting
  - `@nexpress/core/jobs` — pg-boss, handlers, heartbeat, pause
  - `@nexpress/core/media` — service, processor, refs
  - `@nexpress/core/observability` — logger, error reporter, safety check
  - `@nexpress/core/seo` — sitemap, page metadata, JSON-LD

  Additive only — the root `@nexpress/core` continues to re-export
  everything in those domains, so existing call sites do not need to
  migrate. New code should prefer the subpath that fits its call site.

  Two existing aggregator files (`auth/index.ts`, `db/index.ts`) were
  incomplete; they now mirror the root re-exports for their domain.
  Two new aggregators (`i18n/index.ts`, `seo/index.ts`) were added.

- de22826: Publish-readiness sweep — package metadata, license, and publishability.

  Every `@nexpress/*` library and `create-nexpress` becomes publishable
  to npm: `"private": true` removed, full metadata added (description,
  license, repository with `directory`, author, bugs, homepage, keywords,
  engines.node), and a `prepublishOnly: "pnpm build"` safety net so a
  one-off `pnpm publish` from inside a package directory still rebuilds
  before tarball.

  A repo-root `LICENSE` (MIT) is added and copied into every published
  package's directory so each tarball ships its own license file (npm
  auto-includes LICENSE at the package root, but only if the file
  actually lives there — repo-root licenses don't propagate).

  `apps/web` (the reference app) stays `"private": true` — it's not a
  distributable package.

  No code change; this is publish-bookkeeping only. Versions move from
  `0.0.0` (or `0.1.0` for the existing plugin packages) to a coherent
  `0.1.0` floor when `pnpm changeset version` runs against all currently
  queued changesets.
