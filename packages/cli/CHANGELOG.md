# create-nexpress

## 1.0.0

### Major Changes

- 5103c65: **BREAKING — `nx` prefix migrated to `np` everywhere.**

  The `nx`/`Nx`/`NX_`/`nx_`/`nx-`/`--nx-` prefix that NexPress used in
  TypeScript identifiers, CSS tokens, environment variables, database
  tables, cookies, HTTP headers, localStorage keys, and HTML data
  attributes is now `np`/`Np`/`NP_`/`np_`/`np-`/`--np-`. The `@nexpress/*`
  package namespace is unchanged — the brand "NexPress" is independent of
  the `nx` abbreviation. There is no compat shim.

  Shipped in five sequential PRs to keep each layer independently
  revertable; this changeset is the rollup migration guide.

  | Phase    | What renamed                                                                                                                                                                               |
  | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | 1 (#454) | TypeScript symbols (`Nx*` types/classes/interfaces, `nx*` Drizzle vars + helper functions)                                                                                                 |
  | 2 (#455) | CSS layer (`--nx-*` custom properties, `.nx-*` classes, `@layer nx-*`)                                                                                                                     |
  | 3 (#456) | ENV vars (`NX_*`) + DB tables (`nx_*` framework + collection tables)                                                                                                                       |
  | 4 (#457) | Cookies (`nx-session`/`-refresh`/`-csrf`/`-admin-site`/`-mb-*`/`-oauth-state`) + HTTP headers (`x-nx-*`) + localStorage (`nx-theme`/`nx-color-scheme`) + HTML attributes (`data-nx-theme`) |
  | 5 (this) | Documentation + this rollup                                                                                                                                                                |

  ## Migration steps for plugin / theme / site authors

  ```diff
  # 1. TypeScript imports
  -import type { NxAuthUser, NxCollectionConfig, NxBlockDefinition } from "@nexpress/core";
  +import type { NpAuthUser, NpCollectionConfig, NpBlockDefinition } from "@nexpress/core";

  -import { nxUsers, nxMedia, NxForbiddenError } from "@nexpress/core";
  +import { npUsers, npMedia, NpForbiddenError } from "@nexpress/core";

  -import { nxFetch } from "@nexpress/admin/client";
  +import { npFetch } from "@nexpress/admin/client";

  # 2. CSS overrides
  :root {
  -  --nx-color-primary: oklch(0.4 0.15 250);
  +  --np-color-primary: oklch(0.4 0.15 250);
  }
  -.nx-form-input { … }
  +.np-form-input { … }
  -@layer nx-theme { … }
  +@layer np-theme { … }

  # 3. data attribute selectors
  -:root[data-nx-theme="default"] { … }
  +:root[data-np-theme="default"] { … }
  ```

  A find/replace across the consumer's repo with these patterns covers
  the bulk:

  ```sh
  # TS symbols (compile-time only)
  perl -pi -e 's/\bNx([A-Z])/Np$1/g; s/\bnx([A-Z])/np$1/g;' \
    $(rg -l '\bNx[A-Z]|\bnx[A-Z]' --type ts --type tsx)

  # CSS tokens + classes
  perl -pi -e 's/--nx-/--np-/g; s/\bnx-/np-/g;' \
    $(rg -l -- '--nx-|\bnx-' --type css --type ts --type tsx)

  # ENV vars + DB tables
  perl -pi -e 's/\bNX_([A-Z])/NP_$1/g; s/\bnx_([a-z])/np_$1/g;' \
    $(rg -l '\bNX_|\bnx_')
  ```

  ## Migration steps for operators
  1. **Pull main + rebuild.** Every package's `dist/` regenerates with the
     new symbol names.
  2. **Update `.env`.** Rename every `NX_*` to `NP_*` in every environment
     (.env / .env.local / secrets manager / k8s / fly / etc.). The shipped
     `.env.example` lists every name; the boot zod error now points at
     `NP_*`.
  3. **Generate + apply the table-rename migration.**
     ```sh
     pnpm db:generate     # produces apps/web/drizzle/0031_*.sql
     # Review the SQL — every line should be ALTER TABLE nx_X RENAME TO np_X.
     pnpm db:migrate      # runs the rename in a transaction
     ```
     Indexes and FK constraints stay functional after the rename
     (Postgres tracks them by oid). Their NAMES still contain `nx_` until
     a subsequent `db:generate` cleans them up — purely cosmetic.
  4. **Restart the process.** `defineConfig` reads env vars at boot.
  5. **Active sessions invalidate once.** Every staff + member user with
     a browser holding `nx-session`/`nx-mb-session` reauths on next
     request — the new code reads `np-session`/`np-mb-session` only. No
     compat shim. Plan a maintenance window if logged-out alerts to every
     operator on deploy is unwelcome.
  6. **External tooling** that set or read `nx-*` cookies, the
     `x-nx-admin-site` header, or `data-nx-theme` attribute must update.

  For multi-node operators: stage the migration. Old-code nodes will 500
  on every query against the renamed tables; reading the new cookies
  fails on old binaries.

  ## What is NOT renamed
  - **Package names.** `@nexpress/*` stays — the brand "NexPress" is the
    product identity, not the `nx` abbreviation.
  - **Display strings.** "NexPress" in UI copy / documentation prose is
    unchanged.
  - **Existing migration SQL.** The `0000–0030_*.sql` history files in
    `apps/web/drizzle/` are frozen — they record what the old schema
    looked like. The new rename migration sits on top.

### Minor Changes

- adc53cc: Sites scaffolded by `create-nexpress` get the same plugin-block
  wiring the reference app (`apps/web`) ships with — without it,
  plugin blocks would render correctly on the public site but
  silently disappear from the admin's Add-block popover.

  Two changes in the scaffold's protected admin layout:
  - `ensureFor("read")` → `ensureFor("plugins")` so plugins (and
    their blocks) load before the metadata snapshot.
  - `<BlocksRegistryProvider metadata={...}>` mounted around the
    admin children, fed by `getRegisteredBlockMetadata()` called
    server-side. The provider hands the block list down to the
    client-side editor through React context — necessary because
    the shared block registry is module-scoped and the browser
    module-instance only ever has the built-in defaults.

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

- c7bc6a4: **Phase 25.3 — `create-nexpress` scaffold uses `@nexpress/auth-pages` + Mailpit out of the box.**

  New scaffolds (`pnpm create nexpress my-site`) ship with the
  factory-based auth pattern from #535/#538 instead of hand-coded
  route bodies, and the docker-compose template includes Mailpit
  so register / forgot-password emails capture at
  http://localhost:8025 immediately on `pnpm dev`.

  ### Templates
  - **New `src/lib/auth-routes.ts`** — bootstraps
    `createStaffAuthRoutes()` once. Each `app/api/auth/<flow>/
route.ts` re-exports the matching member as a 2-line file.
    Comment in the template walks operators through adding
    member auth (`createMemberAuthRoutes`) when they need it.
  - **`api/auth/{login,logout,me}/route.ts`** — replaced with
    factory re-exports (was 30–130 lines of hand-coded SQL +
    cookie wiring; now 2 lines each).
  - **`docker/docker-compose.yml`** — adds the Mailpit service
    alongside Postgres. SMTP `:1025` + browser inbox
    `http://localhost:8025`. Auto-accepts any auth credentials
    in dev mode.
  - **`.env.example`** — `NP_EMAIL_ADAPTER=smtp` + Mailpit
    defaults are now active (instead of the earlier
    Resend-as-commented placeholder). Comment block explains the
    swap-to-real-provider path.
  - **`scripts/setup-server.ts`** (the `pnpm run setup` wizard
    writer) — appends the same SMTP block to the generated
    `.env`. New scaffolds get working email out of the box; no
    silent NoopEmailAdapter fallback.

  ### Stability

  `@nexpress/auth-pages` is added as a top-level scaffold
  dependency (`workspace:*` in local mode, `nexpressVersion`
  otherwise). The CLI itself bumps to `minor` to flag the new
  file in scaffolded projects.

  ### Test plan
  - 4 new tests in `templates.test.ts`:
    - `lib/auth-routes.ts` exists and references
      `createStaffAuthRoutes`
    - All 3 staff route files are 2-line factory re-exports (assert
      legacy bodies are gone)
    - docker-compose ships Mailpit on the right ports
    - `.env.example` points SMTP at Mailpit

  ### What's NOT in this PR (defer)
  - **Member auth route templates** — scaffold has never shipped
    member auth (it was apps/web-only). Adding member templates
    is a feature expansion, not a migration. Sites that want
    member auth follow the cookbook recipe.
  - **Staff client form hook migration** — admin login client
    still hand-codes fetch logic in the scaffold. Same shape as
    the apps/web migration (#3b follow-up).
  - **OAuth provider templates** — `@nexpress/oauth-providers`
    (#537 / unmerged at PR-open time) will get scaffold integration
    once it lands on main; hand-rolled `setup()` calls in the
    scaffold's `nexpress.config.ts` keep working in the meantime.

### Patch Changes

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

- 4d5aeba: Production-grade polish for scaffolded deploys.

  **Dockerfile** — multi-stage build with non-root `nexpress` user,
  sharp / vips runtime deps, build-time placeholder env vars so
  `nexpress.config.ts`'s zod validation passes during `next build`,
  and a `HEALTHCHECK` against `/api/health`. The previous 22-line
  template was a hello-world skeleton; this matches the upstream
  NexPress monorepo image, adapted for the single-package scaffold
  layout.

  **`.dockerignore`** — emitted at the project root (build context
  root) when Docker setup is opted into. Without it the build
  context pulls in `node_modules`, `.next`, and `.git`.

  **`vercel.json`** — always emitted with a cron entry for
  `/api/internal/publish-scheduled` per `docs/deployment.md` Path 2.
  Harmless on non-Vercel hosts; the route short-circuits when
  `NP_SCHEDULER_TOKEN` is unset.

  **`pnpm doctor:prod`** — new `--prod` mode on the existing doctor
  script. Tightens the dev defaults: `NP_SECRET < 32 chars` becomes
  an error, missing `NP_ENABLE_JOBS` warns (jobs would silently
  drop), `NP_STORAGE_ADAPTER=local` on a multi-node platform
  errors (mirrors `verifyStartupSafety`'s heuristic), `http://`
  SITE_URL warns. Wire into release CI to fail before bad config
  ships.

  **`scripts/_load-env.ts`** — fix: doctor.ts has been importing
  `./_load-env.js` since #404 but the template was never added to
  the cli scaffold. Without it `pnpm doctor` crashed at module
  load with `ERR_MODULE_NOT_FOUND`.

- fd5b0f3: **Setup wizard: stricter input validation (#618).**

  `pnpm run setup` now catches malformed inputs before writing
  `.env`, instead of letting the operator's first `pnpm db:migrate`
  or `pnpm dev` discover them at runtime.

  New checks in `validateBody`:
  - **DATABASE_URL** — beyond the `postgres://` prefix regex,
    `new URL()` parsing now confirms the host portion is present.
    Catches shapes like `postgres://` (no host) or
    `postgres://[malformed` that the regex previously accepted.
  - **NP_SECRET** — adds a low-entropy floor (≥8 distinct
    characters). The form's `generate` button produces a real
    64-char random hex; this catches an operator who overwrites
    it with `"a".repeat(32)` or similar.
  - **SITE_URL** — same URL-parser hardening as DATABASE_URL.
    Catches `https://` (no host) and malformed shapes the regex
    passed through. Affects #597 (boot-time SITE_URL warning)
    and #598 (host-injection guard) — both rely on a parseable
    base URL.
  - **S3 endpoint (when supplied)** — must parse as a URL with
    a host portion. Catches typos before AWS / MinIO calls fail
    with cryptic SDK errors.

  Both copies of `setup-server.ts` (the reference app's
  `apps/web/scripts/` and `create-nexpress`'s
  `packages/cli/templates/scripts/`) are updated together.

  `validateBody` is now exported so the unit suite can pin the
  contract — 20 new tests in
  `apps/web/tests/setup-validate.unit.test.ts` cover the happy
  path, every reject branch, and the runMigrate default.

- 4845186: **Fix `pnpm test` failure caused by `main()` running at import time.**

  `packages/cli/src/index.ts` invoked `main()` as a top-level
  expression. Importing the module from a test (e.g. `cli-args.test.ts`
  imports `parseCliArgs` from `./index.js`) triggered `main()`,
  which called `promptForProjectConfig` in a non-TTY env, threw,
  and hit the catch's `process.exit(1)` — vitest surfaced that as
  an unhandled rejection that failed the entire test suite. The
  failure had been present on `main` long enough that `pnpm test`
  hadn't been green at the repo level for a while.

  Fix: gate the `main()` call on an `isCliEntryPoint()` check
  (`import.meta.url` realpath-matched to `process.argv[1]`).
  Behaves like `require.main === module` for ESM. The CLI still
  runs `main()` when invoked directly (`pnpm create nexpress …`);
  test imports of `parseCliArgs` no longer kick off the prompt
  flow.

  After this, `pnpm test` is green across all 43 workspace test
  tasks for the first time since the regression landed.

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

## 0.1.0

### Minor Changes

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
