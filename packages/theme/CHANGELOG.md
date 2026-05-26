# @nexpress/theme

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/blocks@0.3.14

## 0.3.13

### Patch Changes

- @nexpress/blocks@0.3.13
- @nexpress/core@0.3.13

## 0.3.12

### Patch Changes

- @nexpress/blocks@0.3.12
- @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/blocks@0.3.11
- @nexpress/core@0.3.11

## 0.3.10

### Patch Changes

- 45bca0d: Fix bundled-theme archive and project-link regressions: theme seeds can now attach posts to categories, `findPosts` resolves hasMany relationship filters through registered join tables, magazine section/category archives render seeded category posts, and portfolio project cards link to `/work/:slug`.
- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/blocks@0.3.10

## 0.3.9

### Patch Changes

- @nexpress/blocks@0.3.9
- @nexpress/core@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/blocks@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/blocks@0.3.7
- @nexpress/core@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/blocks@0.3.6
- @nexpress/core@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/blocks@0.3.5
- @nexpress/core@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/blocks@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/blocks@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/blocks@0.3.2

## 0.3.1

### Patch Changes

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

- Updated dependencies [07c763b]
- Updated dependencies [4067401]
- Updated dependencies [3de8716]
- Updated dependencies [1eb6255]
- Updated dependencies [712c11c]
- Updated dependencies [d76a0c9]
- Updated dependencies [d76a0c9]
- Updated dependencies [4d38283]
- Updated dependencies [88bd29b]
- Updated dependencies [48ce0d1]
- Updated dependencies [6f46b5a]
- Updated dependencies [17c90d6]
  - @nexpress/core@0.3.1
  - @nexpress/blocks@0.3.1

## 0.3.0

### Patch Changes

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
  - @nexpress/core@0.3.0
  - @nexpress/blocks@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/blocks@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/core@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/core@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/core@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/blocks@0.1.3

## 0.1.2

### Patch Changes

- @nexpress/core@0.1.2
- @nexpress/blocks@0.1.2

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

- Updated dependencies [e062ed7]
  - @nexpress/core@0.1.1
  - @nexpress/blocks@0.1.1

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

### Patch Changes

- Updated dependencies [952483c]
- Updated dependencies [4c01668]
- Updated dependencies [75f65a2]
- Updated dependencies [de22826]
  - @nexpress/core@0.1.0
