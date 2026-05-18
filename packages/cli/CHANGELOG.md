# create-nexpress

## 0.1.19

### Patch Changes

- 8b4d245: Allow `pnpm run setup` to optionally create the first admin, activate a starter theme, and seed sample content, while preserving the `/admin/setup` continuation path when those fields are skipped.
- 823ad8a: Add an interactive starter prompt to `create-nexpress` and a friendlier `--starter=<id>` flag (alias for `--theme`). Picks one of `blog`, `magazine`, `portfolio`, or `docs` at scaffold time and writes `NP_ADMIN_THEME` to `.env`, which the first-boot admin setup wizard reads as the picker's initial selection. The existing `--theme` flag still works.

## 0.1.18

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

## 0.1.17

### Patch Changes

- bb1bd30: Theme-aware first-boot seed + setup-wizard theme picker.

  **Why** — the framework's `seedAll` shipped one set of "Welcome to NexPress" pages + framework-themed posts. For a magazine site that's the wrong visual; for a portfolio site that's the wrong visual; for docs that's very wrong. With the bundled-themes prebake landed, the missing piece is letting each theme ship its own demo content so the first-boot view actually matches what the operator picked.

  **`@nexpress/theme`** — new `NpThemeImpl.seedContent?` slot on the theme contract. Shape: `{ tags?, categories?, pages?, posts?, navigation? }` (see `NpThemeSeedContent`). Each slot is independent — a theme that overrides only `posts` keeps the framework's generic pages and seeds the posts on top. Static data only; themes declare WHAT to seed, not HOW (the framework's seeder owns the `saveDocument` call so access control / hooks / validation always run). Asset URLs in block props bake into the seeded pages exactly as authored.

  **`@nexpress/app`** — `seedAll(actor, theme?)` accepts an optional theme. When `theme.impl.seedContent` is set, each per-slot seeder takes the theme's samples; unset slots fall through to today's hardcoded framework content (same content as v0.1 today). The single-arg form `seedAll(actor)` still works for the existing `seed:content` script. Internal sample types switched to the public `NpThemeSeedPage` / `NpThemeSeedPost` / `NpThemeSeedTerm`.

  **Setup wizard** — `/api/admin/setup` accepts an optional `themeId` in the body. When provided, the handler calls `setActiveThemeId(themeId, …)` inside the same `withCurrentSite` block as `seedAll` so the activation lands atomically with the seed. Unknown ids fail with a `NpValidationError` before the user write, so a stale tab can't silently fall back to the default. The wizard UI renders a text-only picker (name + one-line description) in step 2; the bundled-themes prebake makes the pick non-binding so the description ends with "you can change this from Appearance."

  **`create-nexpress`** — new `--theme <id>` (and `--theme=<id>`) flag plus an interactive picker that runs when neither `--theme` nor `--yes` is set. The chosen id is written to the scaffold's `.env` as `NP_ADMIN_THEME=<id>`; the setup wizard reads that env var and forwards it as the picker's initial selection. The CLI's static option list is hardcoded (mirrors `defaultThemes`) so it doesn't depend on workspace packages that aren't installed yet at scaffold time.

  What this does NOT do — the four built-in themes don't ship `seedContent` data yet. Each theme drops in its own demo content with its respective design refactor; today the operator picks a theme and gets the framework default seed. The plumbing exists end-to-end so theme refactor PRs only have to author the static data.

## 0.1.16

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

## 0.1.15

### Patch Changes

- 0419f73: Bump `SCAFFOLDED_NEXPRESS_RANGE` from `^0.1.0` to `^0.2.0`. The `@nexpress/*` family crossed into 0.2.x with the single-source refactor (0.2.0 published, then 0.2.1 after the tsup build fix). The scaffold's pinned range never followed, so `npx create-nexpress` projects installed `@nexpress/admin@0.1.6` / `@nexpress/core@0.1.6` etc. — the previous minor's last patch, missing every refactor that went into 0.2.x. Operators saw scripts/lib/proxy/i18n/globals.css all silently regressed even though the npm `latest` tag was 0.2.1.

  Pinning to `^0.2.0` lines the scaffold back up with the family's actual current minor. Note for future minor crossings: this constant has to be bumped manually in the same release that ships the minor; without it, scaffolded installs silently lag by exactly one minor.

## 0.1.14

### Patch Changes

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

## 0.1.13

### Patch Changes

- 6fae726: Three more first-boot regressions surfaced during PR #717 verification:
  1. **`/admin` → 500 with `JWSSignatureVerificationFailed`** when a stale `np-session` cookie (signed by a previous project's `NP_SECRET`) is still in the browser. The protected admin layout called `verifyTokenFull(...)` without a try/catch, so the JWS error bubbled all the way to the page response. Operators trying to recover from a re-scaffold against the same `localhost:3000` had no path back to `/admin/setup`. Wrap the verify in try/catch and treat any throw as "no valid session" — the existing branch then routes the visitor to `/admin/setup` (no admin yet) or `/admin/login`.
  2. **Built-in themes not surfacing in admin → Appearance.** PR #717 added `@nexpress/theme-default / -docs / -magazine / -portfolio` as scaffold deps but `nexpress.config.ts` had no `themes:` array, so the registry stayed empty even though the packs were installed. Mirrors `apps/web/src/nexpress.config.ts` — emit the four imports + `themes: [...]` from `nexpressConfigTemplate`.
  3. **Silent seed failures.** `seedAll` was best-effort wrapped in PR #717, but the warning only landed in the HTTP response — the operator typically never sees it (the wizard's success path immediately routes to `/admin`). Log the full thrown stack on the server console as well so a missing FK / failed collection-hook validation is visible in the dev terminal where the operator is already looking. Same for `updateSite`.

- 6fae726: Two more first-boot regressions surfaced when verifying the admin setup wizard end-to-end on a fresh scaffold:
  1. **`Site "default" not found` 400 on admin setup.** `np_sites` is created by migrations but the default row isn't seeded — `ensureDefaultSite()` exists in `@nexpress/core` but nothing in bootstrap actually calls it. The wizard's `updateSite(NP_DEFAULT_SITE_ID, …)` therefore threw on first call. Added an explicit `await ensureDefaultSite()` inside the setup route before the admin INSERT. (Wiring it into `ensureFor` more broadly is the cleaner long-term fix and stays in the queue.)
  2. **Built-in theme packs missing from scaffolds.** Scaffold `package.json` only carried `@nexpress/theme` (the engine), not `@nexpress/theme-default / -docs / -magazine / -portfolio`. Result: admin's Appearance → Themes was empty, and there were no theme assets to register at boot. Added all four as direct deps in `getProjectFiles`. They join the fixed-versioning group automatically (since they're `@nexpress/*` and on npm at 0.1.5).

- 6fae726: Scaffold's `nexpress.config.ts` only registered `posts` and `pages` even with `--example` mode. `apps/web` carries four collections (categories, pages, posts, tags) and the `seedAll` helper assumes all four exist — so `pnpm setup` with "Include sample content" checked threw

  ```
  Sample content seeding failed: Document not found: collection/tags
  ```

  and bailed out before any sample posts/pages/categories/tags landed. Emit all four collection files from `getProjectFiles` and register them in `defineConfig({ collections })`.

  `tags.ts` and `categories.ts` mirror the apps/web sources byte-for-byte; PR #704's thin-wrapper migration cleared these two off the scaffold side without noticing.

- 143ef33: Fix the missing `max-w-[420px]` / `max-w-[380px]` wrap on `/admin/setup` (and every other AuthCard page) by closing two gaps in the Tailwind v4 source pipeline:
  1. **Add `packages/app/src` to `@source`** so the scanner sees `setup-client.tsx` and the other admin/site pages that moved into `@nexpress/app` after PR #704. Scaffolds get the equivalent `node_modules/@nexpress/app/src/**/*.{ts,tsx}` (via `snapshot-rewrites.ts`'s new `app` branch — admin/blocks/editor stay on `dist/**/*.js` because they ship bundled, `@nexpress/app` ships its raw `.tsx` source per its `./admin/*` export map).
  2. **`@source inline()` for AuthCard's bracketed utilities.** Verified that Tailwind v4's scanner drops arbitrary-value classes (`max-w-[380px]`, `shadow-[…]`, `bg-[radial-gradient(…)]`) when they live inside a long multi-utility string — same source file's standard `min-h-screen` is picked up fine. Force the AuthLayout/AuthCard utilities into the stylesheet with explicit `@source inline()` lines so the layout doesn't depend on scanner heuristics.

  Verified with a clean `pnpm --filter @nexpress/web build`: `380px` and `420px` now appear in the generated CSS (previously 0).

## 0.1.12

### Patch Changes

- 41f59a3: When the migration runner hits sqlstate `42710` (duplicate type) or `42P07` (duplicate table) — the "another NexPress install owns this DB" case the pre-flight can't detect when `drizzle.__drizzle_migrations` already exists — surface the recovery options inline instead of leaving the operator on the raw pg error message:

  ```
  ✗ migration failed:
    …
    sqlstate: 42710

    This database already contains tables/types from another NexPress
    install. Pick one:
      1. Point DATABASE_URL at a fresh database (recommended for multi-project hosts)
      2. Drop and recreate this one:
         docker compose -f docker/docker-compose.yml exec db psql -U nexpress \
           -c 'DROP DATABASE "<name>"; CREATE DATABASE "<name>";'
         (this DESTROYS all data in '<name>')
  ```

  Pure additive — non-collision failures still print the same Error + sqlstate they always did.

- 41f59a3: Drop the `webpack` callback from the scaffold's `next.config.ts`. Next 16 made Turbopack the default bundler; mixing a `webpack` callback with no Turbopack config trips

  ```
  Error: this build is using turbopack, with a webpack config and no turbopack config
  ```

  and stops `pnpm dev` immediately after `pnpm setup`. apps/web had already been migrated (the inline comment there explains the same), but the scaffold template lagged behind and re-emitted the old callback into every newly scaffolded project.

  The callback only pushed `@node-rs/argon2`, `pg-native`, and `sharp` into `externals`. `serverExternalPackages` covers the same surface for both bundlers, so the fix is to delete the callback and add `pg-native` to `serverExternalPackages`.

## 0.1.11

### Patch Changes

- f32cc2c: Two fixes that unblock the README quickstart against the previous publish (0.1.10):
  1. **`pg` as a direct dependency.** PR #709's migration runner does `import pg from "pg"`. Under pnpm 10's strict hoisting the nested copy from `@nexpress/core` isn't visible at the scaffold's top level, so a clean `npx create-nexpress my-site && pnpm install && pnpm setup` died with `ERR_MODULE_NOT_FOUND: Cannot find package 'pg'`. Pinned to a top-level dep (apps/web mirrored for dogfooding).
  2. **`docker-compose.yml`'s `POSTGRES_DB` now matches the scaffold's `DATABASE_URL`.** Previously the compose db service initialized `nexpress` while the generated `.env` pointed at `<project_name>` — README's quickstart (`docker compose up -d db && pnpm setup`) dies on the first migration with `database "<project_name>" does not exist`. `dockerComposeTemplate` now receives the project config and substitutes `POSTGRES_DB: <derived_db_name>` so `docker compose up` creates the right DB on first boot.

  Verified locally end-to-end: fresh scaffold, `pnpm install`, `docker compose up -d db`, `pnpm setup` reaches the migration step with the right DB present.

## 0.1.10

### Patch Changes

- 35b8e5d: Replace `drizzle-kit migrate` with a direct `drizzle-orm` migrate runner in scaffolded projects (`scripts/run-migrations.ts`). The drizzle-kit CLI swallows SQL errors as a silent `exit 1` under non-TTY (which is exactly what `pnpm setup`'s spawn produces) — burning first-time operators with "migration failed" and no actionable message. The library function (`migrate()` from `drizzle-orm/node-postgres/migrator`) throws a real `Error` whose `cause` carries the underlying pg error plus its sqlstate code (e.g. `42P07` for duplicate-table), which the new runner prints to stderr.

  Schema state is unchanged: same `./drizzle/` folder, same `drizzle.__drizzle_migrations` tracking. Only error fidelity changes. `setup-server.ts` now spawns `pnpm exec tsx ./scripts/run-migrations.ts` instead of `pnpm exec drizzle-kit migrate`; operators running migrations directly (`pnpm db:migrate`) still hit the CLI, which is fine when they have a real terminal.

  Adds `@types/pg` as a devDependency so the new runner typechecks. The runtime `pg` dependency is already in the install graph via `@nexpress/core`.

## 0.1.9

### Patch Changes

- fa0b461: Relax the scaffold's `@nexpress/*` dependency pin from `^0.1.3` to `^0.1.0`. Same semantic effective range (`>= 0.1.0 < 0.2.0` covers the entire 0.1 minor family), but it no longer assumes a specific patch as the floor.

  The previous `^0.1.3` pin broke `pnpm install` in any scaffolded project after `@nexpress/app@0.1.1` shipped: the new package was below the floor even though it's in the same family. With the fixed-versioning group in `.changeset/config.json` now covering every `@nexpress/*` (separate changeset on this same release), the family stays on a single `0.1.x` going forward — `^0.1.0` is the right floor for that policy.

  Bump the pin again only when the family crosses a minor boundary (0.2.0, 1.0.0, …).

## 0.1.8

### Patch Changes

- 0a9ab9d: Bundle of four scaffold polish fixes uncovered while auditing the first-time UX path:
  1. **Pre-flight no longer false-positives on re-run.** `runMigrations` now checks `drizzle.__drizzle_migrations` first — if drizzle has already migrated this DB, skip the "another project owns this DB" collision flag and let `drizzle-kit migrate` handle idempotency. Previously operators running `pnpm setup` a second time hit "DB already populated" with a "DROP DATABASE" recommendation that would have nuked their own data.
  2. **`typecheck` script added** to scaffolded `package.json` — `pnpm run typecheck` now works without falling through to pnpm's built-in shadow.
  3. **`@nexpress/*` deps pinned to `^0.1.3`** instead of `latest`. Explicit pin = the scaffold and its runtime always speak the same `@nexpress/*` major.minor family. A stale `create-nexpress` will no longer scaffold a project against a future breaking `@nexpress/core` whose API the scaffold templates haven't kept up with. Bumped manually when the family hits a new minor; operators can still `pnpm update --latest @nexpress/*` locally.
  4. **`pnpm.onlyBuiltDependencies: ["sharp", "@node-rs/argon2"]`** added to scaffolded `package.json`. pnpm 10+ defaults to skipping native-build postinstalls — without explicit approval, media uploads (sharp) and password hashing (argon2) crash at runtime with opaque "module not found" errors. Allowlisting these two specifically (and only these two) gets them built on first install without operator intervention.

- 89228b7: CI now runs an end-to-end scaffold smoke job: it builds the CLI, packs every `@nexpress/*` package as a `.tgz`, scaffolds a fresh project under `$RUNNER_TEMP` with deps rewritten to `file:` tarball paths (via `.github/scripts/link-scaffold-tarballs.mjs`), then runs `pnpm install --ignore-workspace` + `tsc --noEmit` in isolation from the monorepo workspace. The job also verifies `pnpm-lock.yaml` is untouched at the end so an accidental coupling regression fails CI loudly.

  Catches regressions the unit tests on `getProjectFiles` can't reach — missing deps in the emitted `package.json`, broken stubs, snapshot drift, transitive resolution failures that only surface at install time.

- 89228b7: Scaffolded projects now produce byte-identical code to `apps/web` by mirroring `apps/web/src/{app,lib,i18n.config.ts,proxy.ts}` into the new project as a snapshot. The old string-template admin/site/api/lib files in `templates/{admin,site,api,lib}/` (which had drifted from the reference app) are gone. `npx create-nexpress` and `apps/web` now both resolve to the same handlers via `@nexpress/app`'s subpath exports — adding `@nexpress/app` as a scaffold dependency is the operative change.

  `getProjectFiles` now returns `Record<string, TemplateFile>` instead of `Record<string, string>` to carry an encoding flag — required for the (single) binary file in the snapshot (`icon.svg`). Existing consumers that iterate the map need to read `.content` per entry.

  New `pnpm sync-snapshot` script in `create-nexpress` resyncs `templates/snapshot/` from `apps/web/src` whenever the reference app's wrappers change. Run it from the monorepo root after editing apps/web's wrappers and commit the diff alongside.

## 0.1.7

### Patch Changes

- 0114041: Two scaffold fixes addressing the "fresh project's `pnpm setup` silently fails on migrate" report:

  **1. Per-project default DB name.** The previously-hardcoded `DATABASE_URL=postgres://nexpress:nexpress@localhost:5433/nexpress` collided with every other NexPress project on the same machine — including the NexPress monorepo's own dev DB (which uses the same URL via `docker/docker-compose.yml`). Operators scaffolding their first project saw migration "succeed" against a DB that already had a different project's 31 tables, producing a silent drizzle-kit exit-1 on `CREATE TABLE` conflict.

  Now `.env`, the setup wizard's CLI prompt default, and the HTML form's prefilled value all derive the DB name from the project directory's basename (sanitized to lowercase + underscores). A project called `my-site` gets `localhost:5433/my_site`. Operators still need to `CREATE DATABASE <name>` on their Postgres, but the resulting error ("database does not exist") is explicit instead of silent.

  Also unified the previously-inconsistent port default (CLI mode said 5432; HTML / `.env` said 5433) on 5433, matching the docker-compose preset the README references.

  **2. Pre-flight check before applying migrations.** `runMigrations` now connects to the target DB and counts existing `np_*` tables before invoking `drizzle-kit migrate`. If any are found, it short-circuits with a clear actionable message:

  ```
  Database 'foo' already contains 31 NexPress tables (np_*).
  Another project is using this DB. Pick a different DB name in DATABASE_URL,
  or drop + recreate the DB:
    psql -c "DROP DATABASE foo; CREATE DATABASE foo;"
  Then re-run setup.
  ```

  The wizard's browser UI renders this message in a `<pre>` block (instead of the generic "see your terminal" pointer). Connection failures still fall through to drizzle-kit's own error path so legit DB-not-found / wrong-credentials cases aren't misdiagnosed as collisions.

## 0.1.6

### Patch Changes

- d6d45c7: Migration child processes (`db:generate`, `pnpm exec drizzle-kit migrate`) now always use `stdio: "inherit"` — including in HTTP wizard mode. drizzle-kit only emits its real progress / error output when it has a real TTY; piped stdio left the captured buffer with just two spinner frames and silently dropped the actual error.

  Inheriting hands the child whatever stdio the wizard parent has, which is the operator's actual terminal. The browser UI loses captured output but the terminal now shows exactly what running `pnpm exec drizzle-kit migrate` directly would show — same source, same formatting, same error fidelity.

  The wizard UI's "migrations FAILED" state was updated to match: instead of an empty `<details>` toggle, it points the operator at their terminal and shows the exact re-run command (`cd <project> && pnpm exec drizzle-kit migrate`).

## 0.1.5

### Patch Changes

- 2e5a876: Make migration failures visible in `pnpm setup`, both in the browser UI and direct CLI runs.

  The previous "silent-fail guard" only fired when the child's captured buffer was completely empty — drizzle-kit shipping a single ANSI escape sequence or newline left the buffer non-empty but visibly blank, so the empty `<details>` toggle stayed empty. Direct `pnpm db:migrate` was even worse: it goes through `pnpm run` → script → drizzle-kit, and somewhere in that chain drizzle-kit's silent exit on non-TTY became `ELIFECYCLE exit 1` with nothing else.

  Three changes:
  1. **Always append an exit-code footer** to every `runChild` call, regardless of buffer content. Footer shows `'cmd' exited with code N` and (on non-zero) the exact command line to re-run directly. Footer goes to terminal stderr AND into the captured output the browser UI shows.
  2. **CLI / non-interactive modes use `stdio: "inherit"`** so the child writes straight to the operator's terminal — no pipe buffering, no TTY-detection quirks, no chance of an interactive prompt failing to render.
  3. **Drop `strict: true` from the scaffolded `drizzle.config.ts`.** With strict on, drizzle-kit prompts the operator to confirm potentially-destructive diffs. When run as a child with piped stdio (which the wizard does in HTTP mode), the prompt can't render — drizzle-kit detects the non-TTY, exits silently with code 1. Operators who want strict diff prompts run `pnpm exec drizzle-kit migrate --strict` directly.

  Also switched the wizard's `pnpm run db:migrate` invocation to `pnpm exec drizzle-kit migrate` — bypasses one pnpm script wrapper layer that has historically swallowed drizzle-kit stderr.

## 0.1.4

### Patch Changes

- 7d5cf08: **Setup wizard polish + headless modes.**

  The scaffolded `pnpm run setup` wizard now supports two new modes for environments where opening a browser tab isn't practical:

  ```bash
  pnpm run setup -- --cli              # terminal prompts via readline
  pnpm run setup -- --non-interactive  # read everything from env vars
  ```

  Auto-detects SSH (`SSH_TTY` / `SSH_CONNECTION`) and headless Linux (no `DISPLAY` / `WAYLAND_DISPLAY`) and falls back to `--cli` automatically. The default browser wizard still opens on desktop terminals.

  Non-interactive mode reads:

  | Env var                                            | Required?                    | Default                                      |
  | -------------------------------------------------- | ---------------------------- | -------------------------------------------- |
  | `DATABASE_URL`                                     | yes                          | —                                            |
  | `NP_SECRET`                                        | no                           | auto-generated 64-char hex                   |
  | `SITE_URL`                                         | no                           | `http://localhost:3000`                      |
  | `NP_STORAGE_ADAPTER`                               | no                           | `local` (set to `s3` for S3)                 |
  | `NP_S3_BUCKET` / `NP_S3_REGION` / `NP_S3_ENDPOINT` | when `NP_STORAGE_ADAPTER=s3` | —                                            |
  | `TEST_DATABASE_URL`                                | no                           | —                                            |
  | `NP_SETUP_RUN_MIGRATIONS`                          | no                           | `true` (set to `false` to skip auto-migrate) |

  Additional fixes bundled in:
  - **Setup wizard output visibility.** `runChild` now spawns with `shell: true` so the chained `pnpm schema:gen && drizzle-kit generate` script's stderr flows through the wizard's tee. Some operators previously saw an empty `<details>` toggle in the UI even though direct terminal runs printed a full stack trace.
  - **Silent-fail guard.** If the spawned child exits non-zero but produces nothing on stdout/stderr, the captured output is replaced with a one-line placeholder pointing the operator at the direct-terminal-run workaround. Better than an empty toggle.
  - **NP_SECRET encoding unified to hex.** Wizard auto-generated secret now uses `randomBytes(32).toString("hex")` (64 chars) instead of `base64url` (~43 chars), matching what `create-nexpress --yes` writes. Same 32-byte entropy; unified encoding so the secret looks the same regardless of which path created the `.env`.

## 0.1.3

### Patch Changes

- eb1b3d5: Scaffolded `pnpm db:generate` failed on first run with "Invalid NexPress config — boot aborted before any service starts" even though `.env` had the values it asked for. Root cause: `scripts/generate-schema.ts` imported `@/nexpress.config` (which zod-validates `NP_SECRET` / `DATABASE_URL` at module-load time) without first loading `.env`. The `_load-env.ts` helper that `doctor.ts` already uses was just missing here. Adds the `import "./_load-env.js"` as the first import, matching the doctor / setup-wizard pattern.

## 0.1.2

### Patch Changes

- 7b31d50: Fix `npx create-nexpress` failing with "template not found: config/.gitignore". npm publish strips dot-prefixed files from the tarball as a default safety measure (so a published package can't ship a `.gitignore` or `.npmrc`), and the on-disk template was named `.gitignore` — so it disappeared from `create-nexpress@0.1.1` even though it existed in `dist/` locally. Renamed the template to `gitignore` (no dot) and updated the loader; the scaffolded project still receives `.gitignore` as the output filename.

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
