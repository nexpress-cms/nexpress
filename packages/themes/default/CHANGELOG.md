# @nexpress/theme-default

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

- 0dc95b9: Nav editor + themes now support a single level of sub-menu nesting.

  **Editor**: each row gets a `Parent` select alongside `Type`. Picking a
  parent nests the item under another top-level item; on save the
  flat list with `parentId` collapses into the canonical
  `children: NpNavItem[]` shape. The select is disabled on items that
  themselves have children (1-level limit). Promoting a parent to be
  someone else's child orphans its existing children back to top-level
  so the saved tree never grows deeper.

  **Themes**: `default`, `magazine`, `portfolio` now render
  `item.children` as a nested `<ul>` in their header. Default's
  mobile drawer + footer-columns and magazine's mobile drawer + footer
  expand children inline. Desktop sub-menus get a hover/focus
  dropdown via per-theme CSS (`.np-site-subnav`,
  `.np-magazine-subnav`, `.np-portfolio-subnav`).

  Server-side resolution (`getNavigation` in `@nexpress/core`) already
  walks `children` recursively — added in #429 / #430 and unchanged
  here.

### Patch Changes

- 4dae122: **Phase F.9-D — v0.2 theme contract phase closure.**

  Closes the v0.2 theme contract extension phase. Documentation
  update + `theme-default` / `theme-minimal` deprecation
  annotations. No code surface changes.

  ### What this PR ships
  - **`docs/design/theme-v0.2-extension.md` marked Frozen
    (shipped)** — the design doc moves from "design phase" to
    "shipped" status snapshot. Implementation diverged where
    noted (F.7 error.tsx Next constraint, F.9.1 polish items);
    the `docs/theme-authoring.md` cookbook is the live API
    reference.
  - **`docs/theme-authoring.md` updated**:
    - Reference theme table reorganized — magazine / docs /
      portfolio listed first as v0.2 references with their
      surface coverage; default / minimal annotated as v0.1-era
      back-compat.
    - New "v0.2 surfaces cheat-sheet" table mapping each new
      field to the cookbook section explaining it.
  - **`theme-default` + `theme-minimal` JSDoc deprecation
    annotations** — both themes still ship and work, but the
    doc comment now points new sites at the v0.2 references.
    No runtime change.
  - **AGENTS.md "Last refreshed" updated** — front-line
    pointers from the agent context now mention v0.2 contract,
    the three reference themes, and `pnpm nexpress
theme:install`.

  ### What's NOT in this PR (intentional)

  The original design doc §1 decision C said:

  > Reference theme count after rebuild: 3 (`magazine`, `docs`,
  > `portfolio`). `default` + `minimal` collapse into
  > `magazine` settings variants.

  We **explicitly defer the absorption** — collapsing 1200+
  lines of distinct `theme-default` shell/template/CSS code
  into magazine as a `layout: "default"` settings variant
  amounts to a magazine rewrite. The validation gate (3 themes
  exercising every contract surface) is met without the
  absorption; doing the rewrite for a one-time cleanup is poor
  return on time.

  `theme-default` / `theme-minimal` stay registered + functional;
  they just don't participate in v0.2's operator-no-code workflow.
  Recorded as a v0.3 candidate when there's more demand for the
  specific layout variants they offer.

  ### F.9.x deferred follow-ups (recorded across the phase)

  For posterity — every "deferred" item from F.1 through F.9-C
  in one place:
  - **F.5.1**: pattern picker UI redesign (categories +
    thumbnails); image-grid item editor; section-strip item
    editor
  - **F.6.1**: nav editor "Location assignments" panel
  - **F.7.1**: theme `error` component delegation (blocked by
    Next's error.tsx-must-be-client-component constraint)
  - **F.9.1**: theme components reading `getThemeSettings` (all
    three v0.2 themes have schema validation but render with
    hardcoded defaults today)
  - **F.3 follow-up**: textarea support for `z.string()` in the
    auto-form generator
  - **F.8 follow-up**: `theme:uninstall` CLI; cross-theme
    migration cleanup
  - **default/minimal absorption** (this PR's intentional
    defer)

  ### v0.2 contract status — shipped

  All eight phases (F.1–F.8) merged + three reference themes
  (F.9-A/B/C) merged. Operators can now run:

  ```
  pnpm create nexpress my-site
  cd my-site
  pnpm install
  pnpm nexpress theme:install @nexpress/theme-magazine
  pnpm db:migrate
  pnpm dev
  # → admin → activate magazine → tune via theme settings panel
  # → drop blocks/patterns in page builder → live, no code
  ```

  The "operator no coding" promise (with the explicit
  two-CLI-command boundary) holds end-to-end.

- 45020fd: Thread the block render ctx from the site renderer into theme templates (#476).

  PR #469 added server-rendered / data-bound blocks (`latest-posts`,
  `stats.counter`, plugin-contributed dynamic blocks) that need an
  `NpBlockRenderContext` to query content. Shipped theme templates
  called `renderBlocks(blocks)` without passing the ctx, so those
  blocks rendered the "ctx unavailable" placeholder instead of the
  real query result.

  `NpTemplateRenderProps` now carries an optional
  `blockCtx?: NpBlockRenderContext`. The reference site renderer
  builds one per page render via `createDefaultBlockRenderContext()`
  and passes it into both the active theme template and the
  historical fallback `renderBlocks` call. Each shipped template
  forwards it as `renderBlocks(blocks, { ctx: blockCtx })`.

  Theme packages no longer have to import `@nexpress/next` directly
  to opt into the ctx — the type is exposed via `@nexpress/theme`'s
  new `@nexpress/blocks` dependency. Templates that don't use
  data-bound blocks can ignore the prop entirely; static themes
  keep their pre-#476 call shape unchanged because `blockCtx` is
  optional and `renderBlocks(blocks)` with `undefined` ctx still
  works.

- Updated dependencies [5103c65]
- Updated dependencies [c40cded]
- Updated dependencies [c40cded]
- Updated dependencies [ab9c759]
- Updated dependencies [2eb505d]
- Updated dependencies [b9a4e08]
- Updated dependencies [8bed938]
- Updated dependencies [131be43]
- Updated dependencies [4ebf2b4]
- Updated dependencies [5203fd7]
- Updated dependencies [9f3a81b]
- Updated dependencies [65da716]
- Updated dependencies [0c59b98]
- Updated dependencies [f778e80]
- Updated dependencies [6672371]
- Updated dependencies [89c32db]
- Updated dependencies [53627e1]
- Updated dependencies [98d3a4e]
- Updated dependencies [6657059]
- Updated dependencies [ae0c053]
- Updated dependencies [a107c8a]
- Updated dependencies [f98fe9c]
- Updated dependencies [9f3a81b]
- Updated dependencies [d3ea817]
- Updated dependencies [cf5db32]
- Updated dependencies [580f0f2]
- Updated dependencies [225d6a1]
- Updated dependencies [f239ce0]
- Updated dependencies [bb55974]
- Updated dependencies [758092a]
- Updated dependencies [ad7ea4e]
- Updated dependencies [ca1722e]
- Updated dependencies [4d5aeba]
- Updated dependencies [006be38]
- Updated dependencies [b78dbbc]
- Updated dependencies [7357e44]
- Updated dependencies [9c3cd89]
- Updated dependencies [930d0d4]
- Updated dependencies [9942779]
- Updated dependencies [2c31d26]
- Updated dependencies [1f8fbdf]
- Updated dependencies [7b61ba8]
- Updated dependencies [463fe5f]
- Updated dependencies [09a7b75]
- Updated dependencies [ea608af]
- Updated dependencies [5efa580]
- Updated dependencies [8790088]
- Updated dependencies [fe45743]
- Updated dependencies [ddbb536]
- Updated dependencies [ab55980]
- Updated dependencies [41ac5d2]
- Updated dependencies [6772bf2]
- Updated dependencies [f5df65e]
- Updated dependencies [b42d8ff]
- Updated dependencies [e66e922]
- Updated dependencies [3eeac73]
- Updated dependencies [45020fd]
- Updated dependencies [6fd0332]
- Updated dependencies [7c0eb2e]
- Updated dependencies [f590247]
- Updated dependencies [15aa1d4]
- Updated dependencies [89c7180]
- Updated dependencies [6483de7]
  - @nexpress/blocks@1.0.0
  - @nexpress/core@1.0.0
  - @nexpress/editor@1.0.0
  - @nexpress/next@1.0.0
  - @nexpress/theme@1.0.0

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
  - @nexpress/next@0.1.0
  - @nexpress/blocks@0.1.0
  - @nexpress/theme@0.1.0
