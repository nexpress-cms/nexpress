# @nexpress/app

## 0.3.8

### Patch Changes

- b4089ee: Add a scaffolded `pnpm run deploy:plan` command that prints target-specific deployment steps, environment variables, storage guidance, worker notes, and the final `doctor:prod` readiness gate.
- 7d5a684: Let `pnpm run doctor:prod` accept `--target vercel|railway|render|fly|docker` so production readiness checks can enforce host-specific storage and worker requirements.
- Updated dependencies [b331118]
- Updated dependencies [28a2dec]
  - @nexpress/plugin-sdk@0.3.8
  - @nexpress/core@0.3.8
  - @nexpress/theme-docs@0.3.8
  - @nexpress/theme-portfolio@0.3.8
  - @nexpress/plugin-block-callout@0.3.8
  - @nexpress/plugin-block-embed@0.3.8
  - @nexpress/plugin-block-latest-posts@0.3.8
  - @nexpress/plugin-block-newsletter@0.3.8
  - @nexpress/plugin-block-pricing@0.3.8
  - @nexpress/plugin-block-stats@0.3.8
  - @nexpress/plugin-forum@0.3.8
  - @nexpress/plugin-oauth-github@0.3.8
  - @nexpress/plugin-oauth-google@0.3.8
  - @nexpress/plugin-reading-time@0.3.8
  - @nexpress/plugin-seo-audit@0.3.8
  - @nexpress/admin@0.3.8
  - @nexpress/auth-pages@0.3.8
  - @nexpress/blocks@0.3.8
  - @nexpress/next@0.3.8
  - @nexpress/theme@0.3.8
  - @nexpress/theme-default@0.3.8
  - @nexpress/theme-magazine@0.3.8
  - @nexpress/editor@0.3.8

## 0.3.7

### Patch Changes

- Updated dependencies [13442d2]
- Updated dependencies [a04759b]
- Updated dependencies [cfb1e92]
  - @nexpress/theme-portfolio@0.3.7
  - @nexpress/theme-docs@0.3.7
  - @nexpress/admin@0.3.7
  - @nexpress/auth-pages@0.3.7
  - @nexpress/blocks@0.3.7
  - @nexpress/core@0.3.7
  - @nexpress/editor@0.3.7
  - @nexpress/next@0.3.7
  - @nexpress/plugin-block-callout@0.3.7
  - @nexpress/plugin-block-embed@0.3.7
  - @nexpress/plugin-block-latest-posts@0.3.7
  - @nexpress/plugin-block-newsletter@0.3.7
  - @nexpress/plugin-block-pricing@0.3.7
  - @nexpress/plugin-block-stats@0.3.7
  - @nexpress/plugin-forum@0.3.7
  - @nexpress/plugin-oauth-github@0.3.7
  - @nexpress/plugin-oauth-google@0.3.7
  - @nexpress/plugin-reading-time@0.3.7
  - @nexpress/plugin-sdk@0.3.7
  - @nexpress/plugin-seo-audit@0.3.7
  - @nexpress/theme@0.3.7
  - @nexpress/theme-default@0.3.7
  - @nexpress/theme-magazine@0.3.7

## 0.3.6

### Patch Changes

- 8d5d1db: `pnpm doctor` now uses the same friendly error decoder as the setup wizard's "Test connection" when the Postgres reachability check fails. Previously the doctor printed the raw `pg` driver message (e.g. `password authentication failed for user "nexpress"`) with a fixed canned hint (`Confirm \`docker compose up -d db\` is running…`). Now it surfaces the wizard-grade guidance:
  - sqlstate `3D000` — the exact `psql -c 'CREATE DATABASE "<name>"'` recipe.
  - sqlstate `28P01` / `28000` — the "different Postgres on this port" diagnosis PLUS a free-port scan that appends `Detected free port: <N>. Set NEXPRESS_DB_PORT=<N>...` (added in #841 / `findFreePort`).
  - `ECONNREFUSED` — the exact `docker compose -f docker/docker-compose.yml up -d db` command.
  - Anything else falls through to the raw driver string.

  Concretely, `messageForConnectionError` + `findFreePort` from the wizard now drive the doctor's `checkDatabase` error path, so operators running `pnpm doctor` after a failed first-boot get the same rich, actionable output the wizard already shows on its Test connection button.

  No API surface change. Pure error-formatting reuse.

- cc665a8: Setup wizard's "Test connection" now scans for a free TCP port near the failing one when it hits a port-collision auth error (sqlstate `28P01` / `28000`), and appends a concrete recommendation to the error message:

  ```
  Detected free port: 5601. If you want to pick that, set:

    NEXPRESS_DB_PORT=5601
    DATABASE_URL=postgres://nexpress:<password>@localhost:5601/mysite

  in .env …
  ```

  Previously the operator only got the generic "pick a free port via `NEXPRESS_DB_PORT`" advice and had to find a free slot themselves. The scan starts one above the failing port and is bounded (100 ports max) so the wizard stays responsive; when every port in the range is taken the wizard falls back to the base message with no suggestion.

  Internal split: the helpers live in a new `scripts/setup-server-ports.ts` sibling alongside the existing `setup-server-errors.ts` / `setup-server-validate.ts` modules. `messageForConnectionError` gained an optional `{ suggestedPort }` parameter (defaults to absent — the unit tests confirm pure behavior is unchanged).

- 2e9ba3d: Setup wizard's "Test connection" now auto-fills the dbPort field (or splices `DATABASE_URL`'s port in URL mode) when the test fails on a port-collision auth error (sqlstate `28P01` / `28000`) and the server's free-port scan returned a usable alternative.

  Operator flow before:

  ```
  1. Hit "Test connection" → fails with 28P01
  2. Read message: "Detected free port: 5601. Set NEXPRESS_DB_PORT=5601..."
  3. Copy 5601, paste into the dbPort field
  4. Hit "Test connection" again
  ```

  After:

  ```
  1. Hit "Test connection" → fails with 28P01
  2. Form auto-fills 5601 in dbPort (or splices the URL string)
  3. Hit "Test connection" again — no retyping
  ```

  The auto-fill is a UI-side enhancement on top of the suggestion exposed by `testDbConnection`. The server-side endpoint (`POST /test-db`) now includes `suggestedPort: <number>` in the JSON response alongside `ok` + `message` when the scan found a free port; the form's JS reads it and applies it to whichever input mode is active (fields vs. raw URL). When no suggestion came back (any non-collision failure, or every port in the scan range was taken), the form keeps the existing message-only behavior.
  - @nexpress/admin@0.3.6
  - @nexpress/auth-pages@0.3.6
  - @nexpress/blocks@0.3.6
  - @nexpress/core@0.3.6
  - @nexpress/editor@0.3.6
  - @nexpress/next@0.3.6
  - @nexpress/plugin-block-callout@0.3.6
  - @nexpress/plugin-block-embed@0.3.6
  - @nexpress/plugin-block-latest-posts@0.3.6
  - @nexpress/plugin-block-newsletter@0.3.6
  - @nexpress/plugin-block-pricing@0.3.6
  - @nexpress/plugin-block-stats@0.3.6
  - @nexpress/plugin-forum@0.3.6
  - @nexpress/plugin-oauth-github@0.3.6
  - @nexpress/plugin-oauth-google@0.3.6
  - @nexpress/plugin-reading-time@0.3.6
  - @nexpress/plugin-sdk@0.3.6
  - @nexpress/plugin-seo-audit@0.3.6
  - @nexpress/theme@0.3.6
  - @nexpress/theme-default@0.3.6
  - @nexpress/theme-docs@0.3.6
  - @nexpress/theme-magazine@0.3.6
  - @nexpress/theme-portfolio@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/admin@0.3.5
- @nexpress/auth-pages@0.3.5
- @nexpress/blocks@0.3.5
- @nexpress/core@0.3.5
- @nexpress/editor@0.3.5
- @nexpress/next@0.3.5
- @nexpress/plugin-block-callout@0.3.5
- @nexpress/plugin-block-embed@0.3.5
- @nexpress/plugin-block-latest-posts@0.3.5
- @nexpress/plugin-block-newsletter@0.3.5
- @nexpress/plugin-block-pricing@0.3.5
- @nexpress/plugin-block-stats@0.3.5
- @nexpress/plugin-forum@0.3.5
- @nexpress/plugin-oauth-github@0.3.5
- @nexpress/plugin-oauth-google@0.3.5
- @nexpress/plugin-reading-time@0.3.5
- @nexpress/plugin-sdk@0.3.5
- @nexpress/plugin-seo-audit@0.3.5
- @nexpress/theme@0.3.5
- @nexpress/theme-default@0.3.5
- @nexpress/theme-docs@0.3.5
- @nexpress/theme-magazine@0.3.5
- @nexpress/theme-portfolio@0.3.5

## 0.3.4

### Patch Changes

- 197e1c5: `pnpm run setup --cli` (and the auto-CLI mode that kicks in on SSH / headless Linux) now reads the existing `.env` for its prompt defaults instead of hardcoding `localhost:5433`. Without this, a scaffold whose `.env` declares `NEXPRESS_DB_PORT=<unique>` (the per-project port `create-nexpress` writes since 0.1.x) would still see the CLI suggest `:5433` — operator hits Enter to accept, the saved `.env` overwrites the unique port with the hardcoded default, then `docker compose up -d db` (reading the freshly-overwritten file) binds the wrong port and `pnpm db:migrate` fails to connect.

  HTTP mode has always read `.env` through `getFormDefaults()` at form-render time; CLI mode now uses the same call so both prompts default to whatever the operator's `.env` currently says. `process.env.DATABASE_URL` / `process.env.TEST_DATABASE_URL` still win when a shell env override is set, matching the pre-existing precedence.

  Side effect: `TEST_DATABASE_URL` is now preserved across CLI-mode reruns. Previously the line was silently dropped on rewrite because CLI mode never collected it.

- 0f32a57: Setup wizard's "Test connection" surfaces friendlier guidance for two more pg connection failure modes that previously fell through to the raw driver string:
  - sqlstate `28P01` / `28000` (auth rejected) — almost always means a different Postgres instance is bound to the host port, so the scaffold's `docker compose up -d db` would have silently no-op'd against the existing container. The message now names this as the likely cause and offers two remediations: stop the conflicting service, or pick a free port via `NEXPRESS_DB_PORT` in `.env`.
  - `ECONNREFUSED` — the message now points at the exact `docker compose ... up -d db` command instead of leaving the raw "connect ECONNREFUSED" string.

  `3D000` (database does not exist) handling is unchanged. Internal split: `messageForConnectionError` moved into a new `scripts/setup-server-errors.ts` sibling so it's importable from unit tests without booting the wizard's HTTP server (mirroring `setup-server-validate.ts`).

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/admin@0.3.4
  - @nexpress/auth-pages@0.3.4
  - @nexpress/blocks@0.3.4
  - @nexpress/next@0.3.4
  - @nexpress/plugin-sdk@0.3.4
  - @nexpress/plugin-forum@0.3.4
  - @nexpress/plugin-oauth-github@0.3.4
  - @nexpress/plugin-oauth-google@0.3.4
  - @nexpress/theme@0.3.4
  - @nexpress/theme-default@0.3.4
  - @nexpress/theme-docs@0.3.4
  - @nexpress/theme-magazine@0.3.4
  - @nexpress/theme-portfolio@0.3.4
  - @nexpress/plugin-block-callout@0.3.4
  - @nexpress/plugin-block-embed@0.3.4
  - @nexpress/plugin-block-latest-posts@0.3.4
  - @nexpress/plugin-block-newsletter@0.3.4
  - @nexpress/plugin-block-pricing@0.3.4
  - @nexpress/plugin-block-stats@0.3.4
  - @nexpress/plugin-reading-time@0.3.4
  - @nexpress/plugin-seo-audit@0.3.4
  - @nexpress/editor@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [f2622ca]
- Updated dependencies [3072b40]
  - @nexpress/theme-docs@0.3.3
  - @nexpress/core@0.3.3
  - @nexpress/admin@0.3.3
  - @nexpress/auth-pages@0.3.3
  - @nexpress/blocks@0.3.3
  - @nexpress/next@0.3.3
  - @nexpress/plugin-sdk@0.3.3
  - @nexpress/plugin-forum@0.3.3
  - @nexpress/plugin-oauth-github@0.3.3
  - @nexpress/plugin-oauth-google@0.3.3
  - @nexpress/theme@0.3.3
  - @nexpress/theme-default@0.3.3
  - @nexpress/theme-magazine@0.3.3
  - @nexpress/theme-portfolio@0.3.3
  - @nexpress/plugin-block-callout@0.3.3
  - @nexpress/plugin-block-embed@0.3.3
  - @nexpress/plugin-block-latest-posts@0.3.3
  - @nexpress/plugin-block-newsletter@0.3.3
  - @nexpress/plugin-block-pricing@0.3.3
  - @nexpress/plugin-block-stats@0.3.3
  - @nexpress/plugin-reading-time@0.3.3
  - @nexpress/plugin-seo-audit@0.3.3
  - @nexpress/editor@0.3.3

## 0.3.2

### Patch Changes

- 131d969: Closes the last divergence path PR #808's transactional reseed left open: per-row `content:afterDelete` / `content:afterSave` post-commit hooks now defer execution until the caller's outer transaction actually commits. On rollback the deferred queue is discarded — no more ghost pg-boss `afterDelete` jobs or audit-log entries for rows that ended up restored.

  Mechanism: new `withDeferredPostCommit(callback)` from `@nexpress/core` sets up an AsyncLocalStorage-backed queue around `callback`. `runPostCommit` checks the store on every call and pushes onto the queue if a scope is active; outside the scope, behavior is unchanged (fire immediately, swallow errors). After the callback resolves, the queue drains in FIFO order, each hook independently isolated (one failure logs and moves on). If the callback throws, the queue vanishes with it.

  `api/admin/themes/reseed/route.ts` POST wraps its outer `db.transaction` in `withDeferredPostCommit`. The pattern composes — anyone bundling multiple `saveDocument({ tx })` / `deleteDocument({ tx })` calls under one tx can wrap with the same helper and get the same drain-on-commit / discard-on-rollback semantics for free.

- 85c2af3: Reseed safety/perf nits:
  - GET `/api/admin/themes/reseed` (preview) now answers from two SQL `FILTER (...)` count aggregates instead of loading up to 500 rows per collection and filtering in JS. Counts are accurate regardless of total row volume.
  - `wipeSeededContent`'s per-row delete loop re-throws with the deleted-so-far count when a row fails (`Wipe of pages (seedSource="theme:default") failed after deleting 12 rows: …`). The wipe is still non-transactional (hook callbacks use the singleton DB handle), but the operator now sees the resume point in the error.
- 8b4d245: Allow `pnpm run setup` to optionally create the first admin, activate a starter theme, and seed sample content, while preserving the `/admin/setup` continuation path when those fields are skipped.
- 4e75c7a: Reseed is now fully atomic — the wipe + active-theme flip + seed all run inside one `db.transaction`. Any failure (most often the slug-collision case the 409 handler catches) rolls back every SQL write the call made; the operator never sees a half-state where the wipe committed but the seed didn't write.

  `saveDocument` joins `deleteDocument` in accepting an `NpTransaction` handle via its existing `NpSaveOptions` bag (`{ status, tx }`). The pipeline threads the handle through every read (`getDocumentByIdInternal`), every write (`createMainDocument` / `updateMainDocument` / `syncChildTables` / `syncJoinTables` / `syncMediaRefsForDocument` / `npSlugHistory` insert / `insertRevision`), and skips opening its own private tx when the caller provided one. Existing call sites that don't pass `tx` are unaffected — `saveDocument(coll, id, data, user)` still opens a private cascade tx like before.

  `setActiveThemeId` learns the same `{ tx }` option so the `np_settings.activeTheme` write joins the same scope. `wipeSeededContent` / `seedTerms` / `seedPages` / `seedPosts` / `seedNavigation` / `seedAll` all gain the option and forward it through.

  Post-commit hooks (`content:afterSave` / `content:afterDelete` jobs + plugin equivalents) still fire per-row inside the tx; their side-effects (cache busts, audit log writes on separate connections) can diverge from final DB state on rollback. Same trade-off as `#807`'s wipe-only transaction.

- 0c5b8d9: `deleteDocument` now accepts an optional `{ tx }` option that threads an outer Drizzle transaction handle through the read + cascade phases. When provided, the existence check and the per-row cascade (child tables, media refs, comments, reactions, reports, the main row itself) run against the caller's transaction — so a wrapping `db.transaction(async (tx) => { … })` covering many `deleteDocument` calls rolls back as a unit on any failure.

  `wipeSeededContent` (`@nexpress/app`'s reseed flow) uses this to make the WHOLE wipe atomic: phase 1 reads all (collection, id) targets matching the seed-source set; phase 2 opens one transaction and threads it into every per-row `deleteDocument({ tx })`. Mid-wipe failure rolls back every previously-completed delete in the same call — the operator re-runs from clean state instead of trying to reason about half-deleted seed content.

  New `NpTransaction` type alias exported from `@nexpress/core` for callers that want to type the `tx` parameter without depending on Drizzle internals. Existing `deleteDocument(collection, id, user)` call sites are unaffected (the new option is optional).

  The seed phase that follows wipe is NOT yet in the same transaction — `saveDocument` doesn't accept the option today, and pulling it into one would force a wider pipeline refactor. Mid-seed failures (most commonly the slug-collision case the 409 handler catches) still leave the wipe committed and the seed half-written; the seeder's per-theme idempotency check makes the re-run safe. The reseed route docstring spells this out.

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [f74b413]
- Updated dependencies [ad4fcba]
- Updated dependencies [4d6ebeb]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/theme-default@0.3.2
  - @nexpress/theme-portfolio@0.3.2
  - @nexpress/theme-docs@0.3.2
  - @nexpress/next@0.3.2
  - @nexpress/theme-magazine@0.3.2
  - @nexpress/admin@0.3.2
  - @nexpress/auth-pages@0.3.2
  - @nexpress/blocks@0.3.2
  - @nexpress/plugin-sdk@0.3.2
  - @nexpress/plugin-forum@0.3.2
  - @nexpress/plugin-oauth-github@0.3.2
  - @nexpress/plugin-oauth-google@0.3.2
  - @nexpress/theme@0.3.2
  - @nexpress/plugin-block-callout@0.3.2
  - @nexpress/plugin-block-embed@0.3.2
  - @nexpress/plugin-block-latest-posts@0.3.2
  - @nexpress/plugin-block-newsletter@0.3.2
  - @nexpress/plugin-block-pricing@0.3.2
  - @nexpress/plugin-block-stats@0.3.2
  - @nexpress/plugin-reading-time@0.3.2
  - @nexpress/plugin-seo-audit@0.3.2
  - @nexpress/editor@0.3.2

## 0.3.1

### Patch Changes

- fbb9efc: chore: theme picker moves to the browser wizard; CLI keeps a flag for headless

  The scaffold CLI used to **always** ask "Theme?" up front and then
  the browser wizard at `/admin/setup` re-asked the same question.
  Two pickers for one decision — and the CLI's interactive prompt
  was the wrong place since the operator hasn't seen any of the
  themes yet at scaffold time.

  The interactive prompt is gone. `/admin/setup` (browser) is now
  the sole place an operator picks a theme. The four built-in
  themes are bundled into every scaffold regardless.

  `--theme <id>` survives as a flag-only escape hatch for headless /
  CI installs that can't open the wizard:

  ```sh
  pnpm create nexpress my-site --theme magazine --yes
  ```

  The flag writes `NP_ADMIN_THEME=<id>` into the scaffold's `.env`;
  `/admin/setup` reads that env var as the picker's initial
  selection (operators with a browser can still arrow-key to swap).
  Without the flag, `NP_ADMIN_THEME` is left commented in `.env`
  and the wizard's first registered theme is selected by default.

  Removed:
  - `create-nexpress`: the interactive theme select prompt (the
    flag stays). `BUILTIN_THEMES` simplified to a `BUILTIN_THEME_IDS`
    string list used only for flag validation.
  - `@nexpress/app`: no public-surface change. `prefill.themeId`
    stays on `<SetupWizard>`; only its source changed (from
    "CLI prompt → env" to "CLI flag → env" — same env var).

  Migration: nothing required. Operators with a browser stop seeing
  the CLI prompt; operators using `--theme <id>` see no change.

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

- 1c07056: feat(admin, app): editor a11y + motion polish (5/7)

  PR 5 of the editor progressive-disclosure sequence. Cleans up
  the smaller a11y / interaction loose ends queued from PRs 1-4.

  ## Sidebar group collapse animation

  PR 2 wired the collapse interaction but Radix Collapsible
  needs CSS keyframes to animate; without them the content
  snaps open / closed. Added `np-collapsible-slide-down` /
  `np-collapsible-slide-up` keyframes in
  `@nexpress/app/styles/globals.css` interpolating
  `--radix-collapsible-content-height` over 180ms. Targeted via
  the `np-sidebar-group-content` marker class so other Radix
  Collapsibles in the admin aren't accidentally restyled.

  ## Focus ring on the group header

  The header was clickable (`role="button"`, `tabIndex=0`) but
  had no `:focus-visible` style — keyboard users couldn't see
  which group was about to toggle. Added
  `focus-visible:ring-2 focus-visible:ring-[var(--np-color-brand)]`
  matching the rest of the admin's focus treatment.

  ## `aria-controls` id sanitization

  The id contained dots from `storageKey`. HTML allows dots in
  ids but CSS attribute / id selectors break, and dev-tools
  navigation is friendlier with hyphens. Replaced with
  `.replace(/\./g, "-")` so the id is `np-sidebar-group-posts-Publish`
  rather than `np-sidebar-group-np-admin.sidebar-group.posts.Publish`.

  ## Show-all toggle label association

  The toggle's text was a `<span>` with no `<label htmlFor>`
  wiring to the Switch — screen readers had to rely on the
  Switch's `aria-label` alone. Added an explicit `<label>`
  pointing at the Switch's id; the existing `aria-label` stays
  for SRs that prefer it.

  ## What does NOT change
  - Default open/closed state — same as PR 2.
  - Toggle visibility logic — same as PR 1.
  - localStorage key shape — same.

  ## Test plan
  - [x] `@nexpress/admin` build + typecheck clean
  - [ ] Browser: click sidebar group header → smooth 180ms slide
        animation.
  - [ ] Keyboard: tab to group header → visible focus ring;
        Enter / Space toggles.
  - [ ] Screen reader: clicking the toggle's text label moves
        focus to the Switch.

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

- 5165249: feat(app): per-doc SEO meta fields on built-in posts (3/7)

  PR 3 of the editor progressive-disclosure sequence. Adds the
  standard SEO meta fields every post editor expects, grouped in
  a dedicated "SEO" sidebar Card.

  ## Fields
  - `seoMetaTitle` (text) — overrides `<title>`; falls back to
    the post title.
  - `seoMetaDescription` (textarea) — meta description / social
    card description; falls back to the post excerpt.
  - `seoOgImage` (upload → media) — Open Graph / Twitter Card
    image; falls back to the cover image.

  All three live in `admin.group: "SEO"` so they render together
  in their own collapsible (per PR 2) Card.

  ## Why flat fields and not a `group` field type

  `NpGroupField` has a known generator-vs-runtime inconsistency:
  the type-generator emits nested `{ seo: { metaTitle } }` while
  the drizzle column generator produces flat `seo_meta_title`
  columns and the pipeline doesn't rehydrate the nesting on read.
  Operators using a group field would see `post.seo.metaTitle` in
  TypeScript but `undefined` at runtime.

  Flat fields with `seo` prefix keep the contract honest: type
  and runtime both produce `post.seoMetaTitle`. The framework gap
  in `NpGroupField` is a separate concern (file as follow-up).

  ## Route update

  `/blog/[slug]/page.tsx`'s `generateMetadata` previously cast
  `post.seo` as a Record and reached for `.metaTitle` etc. — but
  the SEO field never existed on the document, so the defensive
  optional chain always returned undefined and every render
  fell through to `post.title` / `post.excerpt`. Updated to read
  the flat fields directly with explicit string-length guards.

  ## Migration

  `apps/web/drizzle/0005_fat_fantastic_four.sql` adds three
  nullable columns + the FK on `seo_og_image → np_media.id`. No
  existing rows affected (all NULL by default).

  ## Test plan
  - [x] `@nexpress/core` 442/442
  - [x] `apps/web` 85/85
  - [x] `@nexpress/app` build + typecheck clean
  - [ ] Browser: edit a post → "SEO" group Card appears in sidebar
  - [ ] Fill `seoMetaTitle` → view-source on public page shows it in `<title>`
  - [ ] Leave fields blank → falls back to post title / excerpt / coverImage

- 3baac0d: feat(app): SEO field maxLength hints + descriptions (12/14)

  PR 12 of the editor progressive-disclosure sequence. PR 3
  (#758) introduced the SEO meta fields without length limits;
  operators authoring blind risked getting truncated previews in
  search results.
  - `seoMetaTitle`: `maxLength: 64` (~60-char Google snippet
    truncation, 4-char buffer). Description points operators at
    the soft limit.
  - `seoMetaDescription`: `maxLength: 160` (~155-char
    description truncation). Description points at the same.

  The hard `maxLength` is a tactile signal — the input rejects
  further keystrokes before the operator hits the truncation
  threshold. Soft / suggestion-only would be friendlier in
  principle but harder limits prevent the mistake.

  ## Test plan
  - [x] `@nexpress/app` build + typecheck clean
  - [ ] Browser: SEO fields show the new descriptions; typing
        past the limit is blocked

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

- 4cae8cf: fix(admin, app): editor track audit follow-ups — reduced-motion, container-nested hidden detection, main-column empty state

  Three small follow-ups from a post-track audit of the editor
  progressive-disclosure work (#756–#773):
  - **`prefers-reduced-motion: reduce`** on the sidebar group
    collapse animation. PR #760 added the 180ms slide on
    `.np-sidebar-group-content` but didn't include the
    reduced-motion override — vestibular-sensitive users with
    the OS preference set still saw the animation. Adds an
    `@media` block that disables the keyframes when the
    preference is set.
  - **`hasHiddenFields` recurses into containers**. The check
    that decides whether the "Show all fields" toggle is even
    rendered skipped `row` / `collapsible` containers, so a
    conditional field nested inside one wouldn't trip the
    toggle even though PR #772 (container-nested condition)
    would gate it out of the form. Replaced with a call to
    `collectHiddenFieldNames` (single source of truth — same
    helper the server pipeline + zod resolver use).
  - **Main-column empty state**. PR #765 added the "every
    sidebar field hidden" Card; PR #766 added main-column
    group symmetry. The pair left a hole: if every main field
    gets hidden by the active kind, the left column went
    blank with no reason or escape hatch. Mirrors the sidebar's
    empty-state Card with a "Show all fields" link.

- 2a83f97: fix(setup): align `pnpm run setup` default DB name with docker-compose in the monorepo

  The shared `setup-server` wizard derives the default Postgres
  database name from the current directory name. Running it from
  the monorepo's `apps/web` gave `web`, which mismatched the
  repo's checked-in `docker/docker-compose.yml`
  (POSTGRES_DB=nexpress) and `.env.example`
  (DATABASE_URL=…/nexpress) — operators following the README
  landed on a "database does not exist" error after running
  `docker compose up -d db`.

  Fix: `setup-server` now honors a `NP_SETUP_DB_NAME` env-var
  override before falling through to the directory-name
  derivation. The monorepo's `apps/web/scripts/setup-server.ts`
  wrapper sets it to `nexpress` so the wizard default matches
  the rest of the dev stack.

  Scaffolded projects are unaffected: their CLI-emitted setup
  wrapper doesn't set `NP_SETUP_DB_NAME`, so the derivation
  still produces `<project_name>` — matching the CLI-templated
  `docker/docker-compose.yml` (both derive from the same
  `config.projectName`).

- b5f5bb3: fix(app): invalidate site cache when the site name changes

  The setup wizard's `siteName` field and the admin Settings rename
  endpoint both call `updateSite()` and then return, leaving the
  `getCachedSite()` entry (used by every theme's masthead + footer)
  stale for up to `REVALIDATE_SECONDS` (600s). Operators renaming
  their site in the wizard would see the public header keep saying
  the old name for ten minutes — the most visible first-boot moment.

  `siteCacheTag(siteId)` is now busted after a successful
  `updateSite` in both endpoints, alongside a `revalidatePath("/",
"layout")` for the same layout the masthead lives in. Mirrors the
  theme-switch invalidation pattern already in
  `api/admin/themes/active/route.ts`.
  - `packages/app/src/api/admin/setup/route.ts`
  - `packages/app/src/api/admin/sites/[id]/route.ts`

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

- 73c919b: feat(admin, app): universal-content-model follow-ups — create-form kind pre-fill, generic URL resolver, kind-aware template lookup

  Three trivial follow-ups carved out during the U track
  self-reviews. None are blocking; each removes a small wart
  exposed when the framework grew per-kind awareness.

  ## 1. Create-form `?kind=` pre-fill

  `CollectionListView` now threads `?kind=<value>` onto the
  Create CTA when the list view is kind-scoped. The matching
  create page reads `?kind=` from `searchParams` and passes
  `{ kind }` as the initial doc, so the new-doc form opens with
  the kind field already set to what the operator was filtering.
  Empty / absent kind → bare `/create` URL (field's
  `defaultValue` applies, same as before).

  ## 2. Generic kind URL resolver in built-in posts

  `seo.urlPath` previously hardcoded `kind === "doc"` →
  `/docs/<slug>`. Replaced with a registry read:
  `getCollectionConfig("posts").admin.kinds.<kind>.urlPattern`
  substitutes `:slug` and returns the result. Unknown kinds (or
  kinds without a `urlPattern` declared) fall back to the
  framework default `/blog/<slug>`.

  This means a theme that contributes a third kind (e.g.
  portfolio's hypothetical `kind: "project"` with `urlPattern:
"/work/:slug"`) gets correct sitemap / canonical / slug-history
  URLs without needing to override the built-in collection.

  `try / catch` around the registry read covers the
  not-yet-loaded boot path (seed scripts that run urlPath
  resolution before `loadCollections` completes).

  ## 3. Kind-aware template lookup in `/blog/<slug>`

  `resolvePostDetailTemplate` previously walked
  `explicitTemplateId / "detail" / "default" / "feature"`. The
  new walk prepends `post.kind` between the explicit id and the
  legacy triple — so a theme that registers
  `templates.posts.<kind>` gets picked up automatically by the
  framework's blog route.

  Today the `/blog/<slug>` guard 404s any `post.kind !==
"article"` (the doc-kind canonical URL is `/docs/<slug>` via
  the theme route), so the new candidate is only exercised when
  a theme registers `templates.posts.article` for non-default
  article rendering. A future theme that contributes a kind AND
  wants to ride `/blog/<slug>` (e.g. seasonal post types) can
  register `templates.posts.<kind>` without needing its own
  theme route.

  ## Tests
  - `@nexpress/core` 441/441, `apps/web` 85/85 (no test additions
    — these are wire-up changes that flow through existing test
    coverage)
  - All themes + admin + app typecheck clean

- Updated dependencies [07c763b]
- Updated dependencies [1c07056]
- Updated dependencies [95cbc46]
- Updated dependencies [218906d]
- Updated dependencies [a8b732f]
- Updated dependencies [ee20a2d]
- Updated dependencies [4067401]
- Updated dependencies [3de8716]
- Updated dependencies [6d5deef]
- Updated dependencies [63c4997]
- Updated dependencies [1eb6255]
- Updated dependencies [712c11c]
- Updated dependencies [b3f70ff]
- Updated dependencies [d76a0c9]
- Updated dependencies [d76a0c9]
- Updated dependencies [4d38283]
- Updated dependencies [88bd29b]
- Updated dependencies [48ce0d1]
- Updated dependencies [4cae8cf]
- Updated dependencies [6f46b5a]
- Updated dependencies [17c90d6]
- Updated dependencies [73c919b]
  - @nexpress/core@0.3.1
  - @nexpress/admin@0.3.1
  - @nexpress/theme-docs@0.3.1
  - @nexpress/theme-magazine@0.3.1
  - @nexpress/theme-portfolio@0.3.1
  - @nexpress/next@0.3.1
  - @nexpress/theme@0.3.1
  - @nexpress/auth-pages@0.3.1
  - @nexpress/blocks@0.3.1
  - @nexpress/plugin-sdk@0.3.1
  - @nexpress/plugin-forum@0.3.1
  - @nexpress/plugin-oauth-github@0.3.1
  - @nexpress/plugin-oauth-google@0.3.1
  - @nexpress/theme-default@0.3.1
  - @nexpress/plugin-block-callout@0.3.1
  - @nexpress/plugin-block-embed@0.3.1
  - @nexpress/plugin-block-latest-posts@0.3.1
  - @nexpress/plugin-block-newsletter@0.3.1
  - @nexpress/plugin-block-pricing@0.3.1
  - @nexpress/plugin-block-stats@0.3.1
  - @nexpress/plugin-reading-time@0.3.1
  - @nexpress/plugin-seo-audit@0.3.1
  - @nexpress/editor@0.3.1

## 0.3.0

### Patch Changes

- 36187da: Add `/api/newsletter` framework stub.

  Themes ship a footer subscribe form that POSTs `{ email }` to
  `/api/newsletter`. Before this change the route existed in no
  package, so the form's success path always hit a 404 and rendered
  "Newsletter endpoint not configured." — operator UX was "open
  the file and write something" before the form's golden path
  worked at all.

  The new stub:
  - Lives at `@nexpress/app/api/newsletter/route` and is wired into
    `apps/web/src/app/api/newsletter/route.ts` like the other app
    routes.
  - Accepts `POST { email: string }`, validates RFC 5321-ish shape
    - 254-char ceiling, and returns `{ subscribed: true }` on
      success. Bad input surfaces a `VALIDATION_ERROR` 400 with the
      per-field message the form already knows how to render.
  - Does NOT deliver mail or persist anywhere — it only logs the
    address in dev so an operator notices the stub is wired and
    needs to be replaced with a real provider call (Buttondown,
    ConvertKit, Resend, Mailchimp, …). The route's JSDoc carries
    the replacement recipe.

  Production deployments should overwrite the app's route file
  with the operator's actual provider integration; the stub stays
  shipped from `@nexpress/app` for fresh installs and dev.

  Proxy wiring:
  - `/api/newsletter` is added to `CSRF_EXEMPT_PATTERNS` in
    `packages/app/src/proxy/index.ts`. Anonymous visitors have no
    `np-csrf` cookie, so gating the submit on CSRF would 403 every
    fresh visitor — same reason `/api/admin/setup` is exempt.
  - A dedicated rate-limit rule (5 req/min/IP) is the floor against
    subscribe-spam in lieu of the CSRF gate. Operators with their
    own provider may want to tighten or loosen this in their app
    copy of the proxy.

- ab3afa7: Bundled-themes prebake: built-in theme swaps no longer need a migration.

  **Background** — scaffolded sites already ship `themes: [...defaultThemes]`, and `defineConfig` already runs `mergeThemeRequirements` over every entry. The union of every built-in's `requires.collections` therefore lands in the merged schema at boot, and the first `pnpm db:generate && pnpm db:migrate` materialises every column any built-in needs. What was missing was (a) a CI gate that asserts the union is conflict-free, and (b) an admin UI that hides theme-synthesised collections whose owning theme isn't active. Without (b), the docs-only operator sees Magazine's `authors` slug in the sidebar despite never picking Magazine.

  **`@nexpress/core`** — `mergeThemeRequirements` now stamps `admin._themeOrigin: <themeId>` on collections it synthesises via a theme's `requires.collections.<slug>.createIfAbsent: true`. Collections the operator declared (or that two themes both declare via `createIfAbsent`) carry no origin tag — they're owned by the operator. `NpCollectionConfig.admin._themeOrigin` is a new optional string field; never set it by hand from operator config.

  **`@nexpress/app`** — the protected admin layout reads `_themeOrigin` and filters out collections whose origin theme is not the active one. Operator-declared collections always pass; theme-synthesised collections appear in the sidebar only while their owning theme is active. The collection's database table remains in place across swaps, so re-activating the theme re-surfaces any previously captured rows.

  A CI gate (`apps/web/tests/builtin-themes-union.unit.test.ts`) asserts that the union of every built-in's `requires` produces zero theme-vs-theme field conflicts against the default collections array. Future built-ins that collide with an existing one fail this test before reaching `main`.

  Field-level visibility (e.g. hiding Magazine's `posts.featured` while running Docs) is intentionally NOT filtered today — the column stays on the edit view so any data captured under another theme remains addressable. Promote this to a separate follow-up once the data-preservation UX is settled.

- bb1bd30: Theme-aware first-boot seed + setup-wizard theme picker.

  **Why** — the framework's `seedAll` shipped one set of "Welcome to NexPress" pages + framework-themed posts. For a magazine site that's the wrong visual; for a portfolio site that's the wrong visual; for docs that's very wrong. With the bundled-themes prebake landed, the missing piece is letting each theme ship its own demo content so the first-boot view actually matches what the operator picked.

  **`@nexpress/theme`** — new `NpThemeImpl.seedContent?` slot on the theme contract. Shape: `{ tags?, categories?, pages?, posts?, navigation? }` (see `NpThemeSeedContent`). Each slot is independent — a theme that overrides only `posts` keeps the framework's generic pages and seeds the posts on top. Static data only; themes declare WHAT to seed, not HOW (the framework's seeder owns the `saveDocument` call so access control / hooks / validation always run). Asset URLs in block props bake into the seeded pages exactly as authored.

  **`@nexpress/app`** — `seedAll(actor, theme?)` accepts an optional theme. When `theme.impl.seedContent` is set, each per-slot seeder takes the theme's samples; unset slots fall through to today's hardcoded framework content (same content as v0.1 today). The single-arg form `seedAll(actor)` still works for the existing `seed:content` script. Internal sample types switched to the public `NpThemeSeedPage` / `NpThemeSeedPost` / `NpThemeSeedTerm`.

  **Setup wizard** — `/api/admin/setup` accepts an optional `themeId` in the body. When provided, the handler calls `setActiveThemeId(themeId, …)` inside the same `withCurrentSite` block as `seedAll` so the activation lands atomically with the seed. Unknown ids fail with a `NpValidationError` before the user write, so a stale tab can't silently fall back to the default. The wizard UI renders a text-only picker (name + one-line description) in step 2; the bundled-themes prebake makes the pick non-binding so the description ends with "you can change this from Appearance."

  **`create-nexpress`** — new `--theme <id>` (and `--theme=<id>`) flag plus an interactive picker that runs when neither `--theme` nor `--yes` is set. The chosen id is written to the scaffold's `.env` as `NP_ADMIN_THEME=<id>`; the setup wizard reads that env var and forwards it as the picker's initial selection. The CLI's static option list is hardcoded (mirrors `defaultThemes`) so it doesn't depend on workspace packages that aren't installed yet at scaffold time.

  What this does NOT do — the four built-in themes don't ship `seedContent` data yet. Each theme drops in its own demo content with its respective design refactor; today the operator picks a theme and gets the framework default seed. The plumbing exists end-to-end so theme refactor PRs only have to author the static data.

- f10d5b7: Add `NpThemeSeedContent.documents` — seed arbitrary collections
  beyond pages/posts.

  Themes that bundle their own collections (a magazine theme's
  `authors`, a docs theme's `glossary`, a portfolio's `clients`)
  previously had no way to ship matching demo data. The two
  first-class slots (`pages`, `posts`) covered the common case but
  left every other collection blank after first-boot — operators
  had to hand-author the first row themselves.

  The new slot is keyed by collection slug:

  ```ts
  seedContent: {
    documents: {
      authors: [
        { slug: "ada", title: "Ada Lovelace", data: { bio: "…" } },
      ],
      glossary: [
        { slug: "lexical", title: "Lexical", data: { definition: "…" } },
      ],
    },
  }
  ```

  Each `NpThemeSeedDocument` is `{ slug, title, status?,
publishedAt?, data? }`. The `data` payload is merged onto the
  document; the pipeline's Zod validation strips fields the
  collection doesn't declare, so themes don't have to gate on each
  operator's exact field list.

  Seeder behavior matches the existing pages/posts slots:
  - Idempotent per collection — skipped when the collection has
    any row.
  - Unknown collection slugs (theme references a collection the
    operator hasn't activated) are logged at warn level and
    reported as `unknown: true` in `SeedAllResult.documents[slug]`,
    rather than aborting the wizard.
  - `author: actor.id` is auto-injected for collections that
    declare an `author` field, so themes don't have to know the
    operator's user id.

  The setup wizard's response gains a `seeded.documents` map
  keyed by collection slug. `NpThemeSeedDocument` joins the v0.1
  stable seed-content surface (adding optional fields is
  non-breaking).

  Closes follow-up HIGH #2 from the theme redesign track.

- Updated dependencies [ab3afa7]
- Updated dependencies [9ae3da3]
- Updated dependencies [5449b6b]
- Updated dependencies [23a77a3]
- Updated dependencies [f36c0f2]
- Updated dependencies [bb1bd30]
- Updated dependencies [0c096f1]
- Updated dependencies [5faaede]
- Updated dependencies [44010a8]
- Updated dependencies [68c42cf]
- Updated dependencies [41df9e4]
- Updated dependencies [83d140f]
- Updated dependencies [f10d5b7]
  - @nexpress/core@0.3.0
  - @nexpress/theme-docs@0.3.0
  - @nexpress/theme-magazine@0.3.0
  - @nexpress/editor@0.3.0
  - @nexpress/theme@0.3.0
  - @nexpress/theme-default@0.3.0
  - @nexpress/theme-portfolio@0.3.0
  - @nexpress/next@0.3.0
  - @nexpress/admin@0.3.0
  - @nexpress/auth-pages@0.3.0
  - @nexpress/blocks@0.3.0
  - @nexpress/plugin-sdk@0.3.0
  - @nexpress/plugin-forum@0.3.0
  - @nexpress/plugin-oauth-github@0.3.0
  - @nexpress/plugin-oauth-google@0.3.0
  - @nexpress/plugin-block-callout@0.3.0
  - @nexpress/plugin-block-embed@0.3.0
  - @nexpress/plugin-block-latest-posts@0.3.0
  - @nexpress/plugin-block-newsletter@0.3.0
  - @nexpress/plugin-block-pricing@0.3.0
  - @nexpress/plugin-block-stats@0.3.0
  - @nexpress/plugin-reading-time@0.3.0
  - @nexpress/plugin-seo-audit@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e733d47]
- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/admin@0.2.2
  - @nexpress/theme-magazine@0.2.2
  - @nexpress/theme-portfolio@0.2.2
  - @nexpress/theme-default@0.2.2
  - @nexpress/auth-pages@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/next@0.2.2
  - @nexpress/plugin-sdk@0.2.2
  - @nexpress/plugin-forum@0.2.2
  - @nexpress/plugin-oauth-github@0.2.2
  - @nexpress/plugin-oauth-google@0.2.2
  - @nexpress/theme@0.2.2
  - @nexpress/theme-docs@0.2.2
  - @nexpress/plugin-block-callout@0.2.2
  - @nexpress/plugin-block-embed@0.2.2
  - @nexpress/plugin-block-latest-posts@0.2.2
  - @nexpress/plugin-block-newsletter@0.2.2
  - @nexpress/plugin-block-pricing@0.2.2
  - @nexpress/plugin-block-stats@0.2.2
  - @nexpress/plugin-reading-time@0.2.2
  - @nexpress/plugin-seo-audit@0.2.2
  - @nexpress/editor@0.2.2

## 0.2.1

### Patch Changes

- 3e6505d: Build `scripts/*` and `lib/*` as ESM `.js` artifacts under `dist/` instead of publishing them as raw `.ts` source. `0.2.0` shipped these subpaths as raw `.ts` and the `exports` map pointed at `*.ts` targets behind wildcard patterns — `tsx`'s ESM hook (which scaffolded sites use to run `pnpm setup` / `pnpm dev`) doesn't apply Node export pattern wildcards over `.ts` targets, so every scaffolded site died on `pnpm install` with:

  ```
  ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './scripts/postinstall-notice' is not defined by "exports" in node_modules/@nexpress/app/package.json
  ```

  (0.2.0 was broken-for-everyone — scaffolds couldn't reach `pnpm install` postinstall, never mind `pnpm dev`.)

  Root fix is to stop relying on `tsx`'s loader to transpile our published source. `tsup` now builds every subpath we want consumers to import — `scripts/_load-env`, `scripts/setup-server`, `scripts/doctor`, every `lib/*` — into `dist/scripts/*.js` and `dist/lib/*.js`. The `exports` map points at `dist/...` so Node's native ESM resolver handles the path; tsx, Next.js's bundler, and any other consumer get a plain `.js` file with sibling `.d.ts`. The whole class of "wildcard + .ts target" fragility disappears.

  What stays raw (`./src/*.tsx` via `exports`):
  - `admin/*`, `site/*`, `member/*`, `root/*`, `api/*` — consumed exclusively by Next.js through `transpilePackages`. Next's bundler handles `.tsx` natively, so a second `tsup` build would only duplicate work and risk diverging from Next's expected shape.

  The CI gap that allowed 0.2.0 to ship: `scaffold-smoke` only ran `tsc --noEmit` against a fresh scaffold. `tsc` resolves export wildcards over `.ts` targets fine — the runtime regression was invisible at typecheck time. Tracked separately as a CI follow-up; for now this fix has been verified by packing tarballs and running `pnpm install` + `tsx ./scripts/postinstall-notice.ts` in a scaffolded project, both of which were the explicit failures in 0.2.0.
  - @nexpress/admin@0.2.1
  - @nexpress/auth-pages@0.2.1
  - @nexpress/blocks@0.2.1
  - @nexpress/core@0.2.1
  - @nexpress/editor@0.2.1
  - @nexpress/next@0.2.1
  - @nexpress/plugin-sdk@0.2.1
  - @nexpress/theme@0.2.1
  - @nexpress/theme-default@0.2.1
  - @nexpress/theme-docs@0.2.1
  - @nexpress/theme-magazine@0.2.1
  - @nexpress/theme-portfolio@0.2.1

## 0.2.0

### Minor Changes

- d536c4c: Single source of truth between `apps/web` and the `create-nexpress` scaffold. Every runtime file the two used to ship in parallel — scripts, collections, configs, lib, proxy middleware, framework CSS, i18n config — now lives once in `@nexpress/app`, and both sides import thin wrappers. Editing the framework no longer requires touching the scaffold; drift becomes structurally impossible.

  **Files now centralised in `@nexpress/app`**:
  - `@nexpress/app/scripts/*` — 9 setup/dev/seed/migrate/worker/doctor entries (site-dep variants take their site config as args via wrapper).
  - `@nexpress/app/collections/*` — built-in posts/pages/categories/tags definitions.
  - `@nexpress/app/config/*` — `createNextConfig`, `createDrizzleConfig`, `createPostcssConfig` helpers + `tsconfig.base.json`.
  - `@nexpress/app/config-defaults` — `defaultCollections`, `defaultThemes`, `defaultI18n`, `storageFromEnv()`.
  - `@nexpress/app/lib/*` — 19 framework lib modules (init-core, system-health, seed-content, dashboard-stats, manifest, custom-routes, auth-routes, token-ttl, site-authz, etc.). Only `bootstrap.ts` stays site-bound (5-line `createBootstrap(config)` shim) since it has to wire the consumer's `nexpress.config` and generated schema.
  - `@nexpress/app/proxy` — Next 16 middleware (CSRF, rate-limit, security headers, i18n routing). 308-line body; sites re-export `proxy` + literal `config`.
  - `@nexpress/app/i18n-config` — locale list + `isLocale` guard.
  - `@nexpress/app/styles/globals.css` — Tailwind `@layer` bodies, framework tokens, `@source inline()` rules for AuthCard. Sites `@import` this and only add their own `@source` paths.

  **Scaffold output is now scaffolding-only.** Audited a fresh `node packages/cli/dist/index.js np-x` — every file >15 lines is either a codegen stub (`documents.ts`), the site-bound bootstrap shim, or genuinely site-specific (README/package.json/nexpress.config.ts/docker-compose.yml). Scripts/configs/collections/lib/proxy/i18n.config are all ≤ 11 line wrappers; the substantive `globals.css` is now 9 lines (1 `@import "tailwindcss"` + 1 `@import "@nexpress/app/styles/globals.css"` + 4 site `@source` lines + comments).

  **Deleted from the scaffold template directory** (no longer needed):
  - `packages/cli/templates/scripts/` (9 files)
  - `packages/cli/templates/collections/` (4 files)
  - `packages/cli/templates/config/{drizzle,next,next-env,postcss,tsconfig}.{ts,mjs,json,d.ts}` (5 files; kept `gitignore` + `vercel.json`)
  - `packages/cli/templates/snapshot/src/lib/*` substance — now wrapper mirror via sync-snapshot

  **Net diff**: 271 files changed, +833 / −12,456. Lib + proxy + globals.css alone account for ~3700 lines of duplication eliminated.

  Operators who want to customise a built-in (collection, script, config helper, lib module) unwrap the wrapper in their scaffolded site — the framework keeps shipping the canonical version; the site diverges from that point on.

### Patch Changes

- @nexpress/admin@0.2.0
- @nexpress/auth-pages@0.2.0
- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/editor@0.2.0
- @nexpress/next@0.2.0
- @nexpress/plugin-sdk@0.2.0
- @nexpress/theme@0.2.0
- @nexpress/theme-default@0.2.0
- @nexpress/theme-docs@0.2.0
- @nexpress/theme-magazine@0.2.0
- @nexpress/theme-portfolio@0.2.0

## 0.1.6

### Patch Changes

- 6fae726: Fix the "Setup already completed" 409 loop on the first-boot Admin Setup wizard. The route's chain — admin `INSERT` → `updateSite` → `seedAll` → token sign — was not wrapped in a transaction. If `updateSite` or `seedAll` threw (e.g. validation or seed-time error), the admin row was already committed and every retry hit `adminCount > 0` and returned 409 with the umbrella "Setup already completed" message. Server log showed the diagnostic shape: `POST /api/admin/setup 400 (309ms)` → `POST /api/admin/setup 409 (11ms)` — the 400 came from a post-INSERT throw, the 409s from the partial commit.

  Two changes:
  - **Best-effort `updateSite` + `seedAll`** in `route.ts`. Both are now individually try/caught; the admin row stays committed (so the wizard finishes) and the failures surface as `warnings[]` on the success response. Operator can fix data afterwards from Admin → Settings / Collections.
  - **`NpValidationError.fields[]` surfaced in `setup-client.tsx`**. The client previously showed only the umbrella `error.message` ("Invalid input") even though the response carries the actual offending fields. Reads like `Invalid input (password: Password must be at least 12 characters)` now instead of a screen that says nothing.

- 6fae726: Three more first-boot regressions surfaced during PR #717 verification:
  1. **`/admin` → 500 with `JWSSignatureVerificationFailed`** when a stale `np-session` cookie (signed by a previous project's `NP_SECRET`) is still in the browser. The protected admin layout called `verifyTokenFull(...)` without a try/catch, so the JWS error bubbled all the way to the page response. Operators trying to recover from a re-scaffold against the same `localhost:3000` had no path back to `/admin/setup`. Wrap the verify in try/catch and treat any throw as "no valid session" — the existing branch then routes the visitor to `/admin/setup` (no admin yet) or `/admin/login`.
  2. **Built-in themes not surfacing in admin → Appearance.** PR #717 added `@nexpress/theme-default / -docs / -magazine / -portfolio` as scaffold deps but `nexpress.config.ts` had no `themes:` array, so the registry stayed empty even though the packs were installed. Mirrors `apps/web/src/nexpress.config.ts` — emit the four imports + `themes: [...]` from `nexpressConfigTemplate`.
  3. **Silent seed failures.** `seedAll` was best-effort wrapped in PR #717, but the warning only landed in the HTTP response — the operator typically never sees it (the wizard's success path immediately routes to `/admin`). Log the full thrown stack on the server console as well so a missing FK / failed collection-hook validation is visible in the dev terminal where the operator is already looking. Same for `updateSite`.

- 6fae726: Two more first-boot regressions surfaced when verifying the admin setup wizard end-to-end on a fresh scaffold:
  1. **`Site "default" not found` 400 on admin setup.** `np_sites` is created by migrations but the default row isn't seeded — `ensureDefaultSite()` exists in `@nexpress/core` but nothing in bootstrap actually calls it. The wizard's `updateSite(NP_DEFAULT_SITE_ID, …)` therefore threw on first call. Added an explicit `await ensureDefaultSite()` inside the setup route before the admin INSERT. (Wiring it into `ensureFor` more broadly is the cleaner long-term fix and stays in the queue.)
  2. **Built-in theme packs missing from scaffolds.** Scaffold `package.json` only carried `@nexpress/theme` (the engine), not `@nexpress/theme-default / -docs / -magazine / -portfolio`. Result: admin's Appearance → Themes was empty, and there were no theme assets to register at boot. Added all four as direct deps in `getProjectFiles`. They join the fixed-versioning group automatically (since they're `@nexpress/*` and on npm at 0.1.5).
  - @nexpress/admin@0.1.6
  - @nexpress/auth-pages@0.1.6
  - @nexpress/blocks@0.1.6
  - @nexpress/core@0.1.6
  - @nexpress/editor@0.1.6
  - @nexpress/next@0.1.6
  - @nexpress/plugin-sdk@0.1.6
  - @nexpress/theme@0.1.6
  - @nexpress/theme-default@0.1.6
  - @nexpress/theme-docs@0.1.6
  - @nexpress/theme-magazine@0.1.6
  - @nexpress/theme-portfolio@0.1.6

## 0.1.5

### Patch Changes

- fa0b461: Extend the `fixed` versioning group in `.changeset/config.json` to cover every publishable `@nexpress/*` package (29 packages: core, admin, app, auth-pages, blocks, cli, editor, next, oauth-providers, rate-limiter-redis, theme, theme-default/docs/magazine/portfolio, plugin-sdk, all `plugin-*` and `plugin-block-*`, wp-import, xliff). Previously only seven were grouped, which meant new packages joining the family (`@nexpress/app@0.1.1` was the first to surface this) could land on npm at a version that didn't match the scaffold's pinned range (`^0.1.3` against an app at `0.1.1`).

  With fixed-versioning across the full set, every member of the family bumps in lockstep on every release — the SCAFFOLDED_NEXPRESS_RANGE assumption ("everything on the same `0.1.x`") becomes self-enforcing, and new packages joining the group automatically start at the family's current version instead of falling behind.

  Adds a release-wide noise floor (variant-less packages produce empty CHANGELOG entries on bump). The tradeoff is intentional: alignment > minimal version churn at 0.x.
  - @nexpress/admin@0.1.5
  - @nexpress/auth-pages@0.1.5
  - @nexpress/blocks@0.1.5
  - @nexpress/core@0.1.5
  - @nexpress/editor@0.1.5
  - @nexpress/next@0.1.5
  - @nexpress/plugin-sdk@0.1.5
  - @nexpress/theme@0.1.5
  - @nexpress/theme-default@0.1.5
  - @nexpress/theme-docs@0.1.5
  - @nexpress/theme-magazine@0.1.5
  - @nexpress/theme-portfolio@0.1.5

## 0.1.1

### Patch Changes

- f82c8fa: Move 125 API route implementations from `apps/web/src/app/api/**/route.ts` into `@nexpress/app/src/api/**/route.ts`. The apps/web side becomes thin re-export wrappers that preserve Next.js's route-segment-config constraint (`dynamic` / `runtime` / etc. consts stay local; HTTP method handlers re-export). Scaffolded sites that consume `@nexpress/app` inherit the real implementations directly — no duplication.

  Adds `@types/react-dom` to `@nexpress/app` so consumers can typecheck the streaming preview-blocks route through `transpilePackages`. Expands `_consumer-stubs/lib/init-core.ts` to mirror the production `nexpressConfig` shape (`site` is non-optional, `jobs.stuckThreshold` is the per-state object).

- 4cc7f81: Move the root layout (`<html lang>` + RTL handling) and the three special routes (`/feed.xml`, `/sitemap.xml`, `/robots.txt`) from `apps/web/src/app` into `@nexpress/app/src/root/`. apps/web keeps thin re-export wrappers. The layout no longer imports a relative `./globals.css` — consumers own their stylesheet at the wrapper layer, which keeps the framework layout free of consumer-bound paths.

  Adds `./root/layout` and `./root/*` subpath exports to `@nexpress/app`.
