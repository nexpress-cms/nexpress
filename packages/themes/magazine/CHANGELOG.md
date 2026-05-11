# @nexpress/theme-magazine

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

- 291c2f0: **F.9.2 — magazine `heroStyle` setting now renders three layout
  variants.**

  Closes the v0.2 deferred-no-op note on `magazineSettings.heroStyle`.
  The setting was carrying the operator's choice (featured / carousel /
  grid) but the magazine.hero-feature block ignored it. F.9.2 wires
  the choice into actual rendering.

  ### What changed

  The `magazine.hero-feature` block now resolves a layout from two
  sources in priority order:
  1. The block's own `styleOverride` prop (per-instance pin)
  2. The theme-level `heroStyle` setting (site-wide default)

  When `styleOverride === "auto"` (default), the setting wins.

  | Layout     | Renders                                                                    | Reads                                                |
  | ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
  | `featured` | Single lead story with full-bleed background image, headline, subdeck, CTA | `title`, `subtitle`, `ctaText`, `ctaUrl`, `imageUrl` |
  | `carousel` | Headline row + horizontally scrollable card track (CSS scroll-snap)        | `title`, `subtitle`, `ctaText`, `ctaUrl`, `items[]`  |
  | `grid`     | Headline row + 3-column responsive tile grid                               | `title`, `subtitle`, `ctaText`, `ctaUrl`, `items[]`  |

  `items` is a new prop carrying `{ title, url?, imageUrl?, category? }[]`.
  Featured layout ignores it; carousel/grid use it. Empty `items`
  shows a "Add items in the block's props" placeholder so operators
  know what's missing.

  ### Block prop schema additions

  | Prop            | Type              | Notes                                                      |
  | --------------- | ----------------- | ---------------------------------------------------------- |
  | `styleOverride` | `select`          | `auto` / `featured` / `carousel` / `grid`. Default `auto`. |
  | `items`         | `textarea` (JSON) | Same UX as section-strip's items array.                    |

  The setting's description was updated — no longer claims to be
  deferred.

  ### CSS (in styles.ts)

  New rules under data attribute `[data-hero-style="carousel"]` and
  `[data-hero-style="grid"]`:
  - Shared `.np-magazine-hero-header` for the heading row
  - Carousel: `flex` track with `scroll-snap-type: x mandatory`,
    280px-wide cards, 4:3 image aspect
  - Grid: `grid-template-columns: repeat(3, 1fr)` ≥768px viewport,
    16:10 image aspect; `auto-fit` minmax(220px) below the breakpoint

  ### Migration notes

  Existing pages with a `magazine.hero-feature` block keep working —
  they get `styleOverride: "auto"` implicitly (no prop = default), so
  they follow whatever the operator's `heroStyle` setting is. If
  the setting is `featured` (the default), behavior is identical to
  before this PR.

  Operators who set `heroStyle: "carousel"` or `"grid"` BEFORE F.9.2
  finally see the layout change — previously the setting was
  silently ignored.

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

- c1b2157: **Phase F.9-A — magazine theme rebuilt against v0.2 contract.**

  First of three reference-theme rebuilds (design doc §4.9). The
  magazine theme now exercises every v0.2 contract surface so we
  can validate the contract end-to-end before declaring v0.2
  done.

  ### Surface added (mapping to phases)
  - **F.1 `manifest.requires`** — declares `posts` field
    expectations (`featured`, `coverImage`, `categories` rel,
    optional `author` rel) plus `categories` + `authors`
    collections (with `createIfAbsent`). Operators run
    `pnpm nexpress theme:install @nexpress/theme-magazine` to
    satisfy the requirements via F.8's CLI.
  - **F.3 `manifest.settingsSchema`** — Zod schema with
    `heroStyle` (enum), `showAuthorByline` (boolean),
    `postsPerPage` (number), `accentColor` (hex regex),
    `newsletterEnabled` (boolean), `socialLinks` (array of
    objects). Each field carries `.describe()` so the admin
    auto-form renders helpful labels.
  - **F.4 `impl.blocks`** — two theme-shipped blocks:
    `magazine.hero-feature` (lead image + headline + CTA) and
    `magazine.section-strip` (3-column section breakdown).
    Bootstrap auto-stamps `source: "theme:magazine"`.
  - **F.5 `impl.patterns`** — two patterns:
    `magazine.homepage-feature-grid` (hero + section strip) and
    `magazine.editorial-cta` (related posts + CTA). Drop them
    via Cmd-K → "Pattern" group.
  - **F.6 `impl.navLocations`** — three locations: `primary`
    (masthead), `footerSections`, `footerColophon`. Each with
    description + maxItems hint surfaced in the admin nav editor
    dropdown.
  - **F.2 `impl.archives`** — `posts.byCategory` (`/category/:slug`)
    and `posts.byAuthor` (`/author/:id`). Each archive component
    fetches its own data via `findDocuments` (F.E hasMany filter
    makes `where: { categories: id }` work directly).
  - **F.7 `impl.notFound`** — editorial 404 page styled to match
    magazine chrome.
  - **F.7 `impl.seo.sitemapEntries`** — surfaces every category
    archive page in the sitemap (collection walk doesn't produce
    `/category/foo` URLs by itself).

  ### What's not in this PR — F.9.1 follow-up
  - **More blocks**: newsletter inline form, image-quote, audio
    embed. Two representative blocks suffice to prove the
    contract; more is operator polish.
  - **More archives**: `byTag`, `byDate`. Same shape as
    byCategory/byAuthor; one less for review focus.
  - **Theme settings consumption**: theme components don't yet
    read `getThemeSettings()` — they render with hardcoded
    defaults. Wiring `settings.heroStyle` / `socialLinks` etc.
    through to the components is operator-facing polish; the
    contract is shipped, the operator can edit settings and the
    schema validates.

  ### Validation status

  The first of three reference themes; F.9-B (docs) and F.9-C
  (portfolio) follow with different contract-axis stress tests.
  F.9-D retires `default` + `minimal` (absorbed as magazine
  settings variants).

  ### Dependency note

  `@nexpress/theme-magazine` gains `zod` (^4.3.6) for the
  settings schema. Theme components stay server-rendered;
  schema introspection happens server-side via core's
  `introspectThemeSettingsSchema`.

- c9670db: **Phase F.9.1-B — more theme settings consumption.**

  Continuation of F.9.1-A. Wires the next batch of settings
  through to components, leaving only the heaviest 3 (heroStyle
  component swap, aboutCopy surface, clientLogos strip) for
  F.9.1-C.

  ### Magazine wirings (2)
  - **`settings.postsPerPage`** — `CategoryArchive` and
    `AuthorArchive` use it for their `findDocuments` limit
    (was hardcoded 10). Operators who want a longer or shorter
    archive page set it from admin (range 1–50 from the
    schema).
  - **`settings.accentColor`** — `MagazineShell` injects an
    inline `<style>` scoping `.np-magazine` to override
    `--np-color-primary` with the operator's hex. Per-request
    application means changes show on next reload — no full
    build / token-save round-trip needed.

  ### Portfolio wirings (5)
  - **`settings.cardAspect`** — `PortfolioShell` sets
    `--np-portfolio-card-aspect` (1/1 / 3/4 / 4/3 / 1/1.618)
    on the root; `styles.ts` reads it via `aspect-ratio:
var(--np-portfolio-card-aspect, 4/3)` on
    `.np-portfolio-project-cover`.
  - **`settings.hoverStyle`** — `PortfolioShell` sets a
    `data-hover-style="<x>"` attribute on the root;
    `styles.ts` provides 4 variant rules:
    - `fade` (default): caption fades + image scales
    - `scale`: only image zooms
    - `slide`: image static, caption slides up further
    - `lift`: card lifts with shadow
  - **`settings.showProjectMeta`** — `ProjectDetailTemplate`
    hides the `<dl>` meta strip (Client / Role / Year) when off.
    Studios with anonymous client work flip it off.
  - **`settings.showProjectTags`** — `PortfolioProjectCard`
    hides the category chip on the index grid when off.
    Operators who want a cleaner unannotated grid flip it off.
  - **`settings.accentColor`** — `PortfolioShell` sets
    `--np-color-primary` inline (same pattern as magazine).

  ### Built-in CSS reads new variables

  `styles.ts` updated:
  - `.np-portfolio-project-cover` aspect now reads
    `var(--np-portfolio-card-aspect, 4 / 3)`.
  - 4 `[data-hover-style="<x>"]` blocks (fade/scale/slide/lift).

  ### What's still hardcoded (deferred to F.9.1-C)

  The heaviest 3 settings — each needs a new component or
  surface, not just a wiring change:
  - **magazine `heroStyle` (featured / carousel / grid)** — the
    homepage hero is a single block today. Adding "carousel" +
    "grid" variants means three new block types and a hero-
    switching component.
  - **portfolio `aboutCopy`** — needs an about-page surface
    (template + slot wiring) to render the copy. Today there's
    nowhere to display it.
  - **portfolio `clientLogos`** — needs a homepage strip
    component reading the array; not currently part of any
    template.

  These are real polish items but each is its own component
  piece. They land as F.9.1-C.

  ### Validation

  Operators can now toggle 8 settings (3 from F.9.1-A + 5 from
  F.9.1-B) and see immediate visible site changes. Combined
  with magazine's `postsPerPage` and both themes'
  `accentColor`, that's **10 of the 18 v0.2 settings live**.
  The remaining 8 are either CSS-only (3 already covered here),
  component-swap (heroStyle), or new-surface (aboutCopy,
  clientLogos).

- 6241386: **Phase F.9.1-A — theme components read `getThemeSettings`.**

  Closes the most operator-visible v0.2 follow-up: the
  `settingsSchema` field validates and persists, but until now
  the rendered themes still used hardcoded defaults — operator
  toggles in admin → no site change. This PR wires the visible
  settings through to the components.

  ### Magazine theme — 3 wirings
  - `resolveMagazineSettings()` typed helper (mirrors docs theme).
  - **`settings.newsletterEnabled`** — toggles the entire
    Subscribe column in the footer. Operators with private/
    paywalled sites flip it off and the column disappears.
  - **`settings.socialLinks`** — renders a list of social links
    in the footer's Colophon column when populated. Empty array
    (default) hides the list entirely.
  - **`settings.showAuthorByline`** — toggles the byline rule on
    the long-form post template (`PostFeatureTemplate`).
    Editorial preference; defaults to true to match prior
    behavior.

  ### Portfolio theme — 3 wirings
  - `resolvePortfolioSettings()` typed helper.
  - **`settings.studioName`** — replaces the hardcoded "NexPress
    Studio" brand label in the masthead and is reused in the
    footer's colophon. Default: "Studio".
  - **`settings.gridColumns` + `settings.galleryGutter`** — drive
    the project-index template's grid layout via inline
    `gridTemplateColumns: repeat(N, 1fr)` + `gap`. Operators
    pick 1–6 columns + 0–64px gutter from admin without editing
    CSS.
  - **`settings.showFooterCredit` + `settings.copyrightYear`** —
    toggle the "Built with NexPress" credit and override the
    auto-detected year. Studios pin the year to "established"
    date or strip the framework credit per their preference.

  ### What's still hardcoded (deferred to F.9.1-B)

  Magazine settings:
  - `heroStyle` (enum: featured / carousel / grid) — would
    require swapping the homepage hero component; current
    template stays single-style.
  - `accentColor` — would need to override the `--np-color-primary`
    CSS variable; touches the CSS layer rather than the
    component layer.
  - `postsPerPage` — apply in `CategoryArchive` / `AuthorArchive`
    (currently hardcoded at 10).

  Portfolio settings:
  - `cardAspect` (square / portrait / landscape / golden) — needs
    CSS variable + card component change.
  - `hoverStyle` (fade / scale / slide / lift) — same, CSS
    variants.
  - `showProjectMeta` / `showProjectTags` — apply in project-detail
    - project-card.
  - `accentColor` — same as magazine.
  - `aboutCopy` — needs an about-page surface (template + slot).
  - `clientLogos` — needs a homepage strip component.

  These are tracked as F.9.1-B; the contract surface is shipped,
  the rendering wiring continues.

  ### Validation

  Operators can now run, in order:

  ```
  pnpm nexpress theme:install @nexpress/theme-magazine
  pnpm db:migrate
  # admin → activate magazine → Theme settings tab
  # Toggle "newsletterEnabled" off → save → reload public site
  # Footer's Subscribe column disappears
  # Toggle back on → reappears
  ```

  Same loop works for portfolio's 3 wirings. The "operator
  no-code" promise now has visible site changes from settings
  toggles.

- 8790088: PR B of 3 in the "make defaults look properly designed" cluster.
  Themes now ship distinct palettes that actually reach the rendered
  page, and the built-in section blocks pick those palettes up via
  CSS variables.

  **Token wiring**

  `getTheme()` in `@nexpress/core` now layers three sources before
  serving tokens, last-writer-wins:
  1. `DEFAULT_THEME` — framework baseline.
  2. The active theme's `impl.tokens` — author-shipped overrides
     (e.g. magazine's warm cream palette, portfolio's dark surface).
  3. The DB row in `np_settings.theme` — admin overrides via the
     theme settings tab.

  Each layer is a `NpThemeTokensOverlay` (sub-tree-Partial), so a
  theme that sets only `colors.primary` doesn't blow away the rest
  of `colors`. Previously the active theme's tokens were ignored at
  runtime — `getTheme()` only read the DB row, so swapping themes
  changed the layout but every theme rendered with the framework
  default's indigo+gray palette.

  The page-builder preview API (`apps/web/src/app/api/admin/preview-blocks`)
  already merged tokens, but did so with a shallow spread that lost
  sub-objects whenever a theme overrode only a handful of fields.
  Now it calls `getTheme()` so preview and public render resolve to
  identical tokens for the same active theme.

  **New type**

  `NpThemeTokensOverlay` (`@nexpress/core/theme`) — `{ colors?:
Partial<NpThemeColors>; typography?: Partial<NpThemeTypography>;
shape?: Partial<NpThemeShape> }`. Replaces the `Partial<NpThemeTokens>`
  shape on `NpThemeImpl.tokens` so authors don't have to copy
  unset sub-trees.

  **Theme palettes**
  - `@nexpress/theme-magazine` ships a warm cream + serif palette
    (terracotta primary, deep brown text on cream background, Source
    Serif Pro fonts). Editorial sites read more comfortably on the
    warm off-white than on pure white.
  - `@nexpress/theme-portfolio` moves its dark surface from
    hardcoded `#0b0b0c` CSS into `impl.tokens` (`oklch(0.16 0.005
285)` background, light foreground). The theme's own CSS now
    reads `var(--np-color-*)` and `color-mix(in oklab, ...)` for
    semi-transparent dividers, so admin token overrides reflow the
    whole shell — flipping to a light variant is a token edit, no
    longer a theme fork.

  **Block tokenization**

  The five PR-A built-ins (`section-header`, `testimonials`,
  `stats-grid`, `logos-cloud`, `tabs`) plus `feature-grid`, `cta`,
  `faq` now read brand colors via `var(--np-color-*)` with the
  previous hex as the fallback. Drop a `cta` into a portfolio-themed
  page: it uses portfolio's primary, not the framework default.

  `hero` keeps its hardcoded dark gradient (the gradient is a
  readability overlay over a background image, not a brand surface).
  `pricing`, `image-gallery`, `contact-form`, `rich-text`,
  `grid` weren't visually brand-driven; they're untouched in this
  pass.

  Existing pages render identically when the active theme doesn't
  override tokens — the merge falls through to `DEFAULT_THEME`.

### Patch Changes

- f239ce0: **v0.3 (H) — `cachedThemeFetch` helper for per-route theme
  cache.**

  Closes the last v0.3-deferred item from
  `docs/design/theme-v0.2-extension.md`'s
  `feat-theme-routes.md` changeset:

  > Per-route `revalidate` cache hint — considered, dropped.
  > Next's route-segment `revalidate` is a static export; we
  > can't vary it per URL pattern from a single catch-all. Theme
  > routes that want caching wrap their data fetches in
  > `unstable_cache(...)` themselves. **Tracked as a v0.3
  > candidate** if a future SSG pass needs it.

  ### Problem

  Theme routes (archives like `/category/:slug`, custom URL
  patterns) render through the framework's catch-all dispatcher.
  Next's route-segment `revalidate` operates at the segment
  level — `/category/:slug` and `/author/:slug` share one
  segment, so per-pattern caching can't be expressed.

  Magazine theme's `CategoryArchive` did `findDocuments` on
  every request — every visit to `/category/tech` was a fresh
  DB query.

  ### API

  `@nexpress/next` ships `cachedThemeFetch<T>(keyParts, fetcher,
options?)`. The wrapper:
  - Auto-tags with `nx:theme:<siteId>` so theme switch /
    settings save / theme uninstall bust the cache (same tag
    the existing `getCachedTheme` / `getCachedThemeSettings`
    share).
  - Keys by site + caller-supplied parts so `/category/tech`
    and `/category/design` cache independently.
  - Defaults `revalidate: 60` — theme route data is more dynamic
    than tokens / active id, so a tight default keeps freshness
    reasonable while cutting the per-request DB hit on hot URLs.
  - Falls back to the uncached fetcher when Next's incremental
    cache isn't reachable (integration tests, scripts).

  ### Options

  | Option       | Default | Purpose                                                                                                                                                                                                                     |
  | ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `revalidate` | `60`    | Cache TTL in seconds.                                                                                                                                                                                                       |
  | `extraTags`  | `[]`    | Tags appended after `nx:theme:<siteId>`. Pass `["nx:collection:posts"]` so a posts edit busts the matching cached archive too — `revalidateCollection` already calls `revalidateTag("nx:collection:<slug>")` on every save. |

  ### Reference implementation

  `packages/themes/magazine/src/archives.tsx` — `CategoryArchive`
  and `AuthorArchive` migrated:

  ```ts
  const data = await cachedThemeFetch(
    ["magazine.category-archive", slug, String(settings.postsPerPage)],
    async () => {
      const cats = await findDocuments("categories", {...});
      const posts = await findDocuments("posts", {...});
      return { category: cats.docs[0] ?? null, posts };
    },
    { revalidate: 60, extraTags: ["nx:collection:posts"] },
  );
  ```

  The key parts include `postsPerPage` so when the operator
  changes the setting, the archive rebuilds at the new page
  size on next read (settings save busts `nx:theme:<siteId>`
  which is one of the cache's tags).

  ### Tests

  6 new unit tests in `cache.test.ts` (71 total in
  `@nexpress/next`):
  - per-site key composition with caller parts
  - default `revalidate: 60`
  - caller-overridden revalidate
  - `extraTags` appended after the auto-applied theme tag
  - incremental-cache-unavailable fallback to uncached fetcher
  - non-cache-related errors propagate (don't silently swallow)

  ### v0.3 queue closed

  This is the last v0.3-deferred item from the theme-system
  extension cluster. Remaining bigger-scope items (F = member
  surface skinning, G = plugin auto-form) deferred to the
  post-v0.3 phase.

- 54d300a: **Phase F.9.1-C — last batch of settings consumption.**

  Continuation of F.9.1-A/B. Wires the remaining 2 portfolio
  settings and explicitly defers magazine's `heroStyle` (which
  needs new hero render variants — out of scope for a wiring
  PR).

  ### Portfolio wirings (2)
  - **`settings.aboutCopy`** — `PortfolioFooter` renders the bio
    as a small paragraph above the contact line when present.
    Operators who want a fuller about page do that through the
    page builder; this is the ambient bio that appears on every
    page. Empty default (`""`) hides the line entirely.
  - **`settings.clientLogos`** — new theme-shipped block
    `portfolio.client-logos`. Reads from `settings.clientLogos`
    (single source of truth for logos — operators manage them
    in admin's Theme settings panel rather than per-block-
    instance). Block props only carry the section heading.
    Empty list shows a "configure logos in admin" placeholder
    so operators see the wiring is live; populated list renders
    as a responsive grid of greyscale logos with optional links.

  ### Magazine — explicit deferral (F.9.2)

  `settings.heroStyle` (`featured | carousel | grid`) stays a
  no-op. The setting persists and validates, but the magazine
  theme renders one hero style regardless because:
  - The `magazine.hero-feature` block carries a single
    `imageUrl` + `title` + `subtitle` — by design, ONE story.
  - "carousel" and "grid" variants need MULTIPLE stories'
    worth of data, which means new hero blocks
    (`magazine.hero-carousel`, `magazine.hero-grid`) and a
    homepage template that picks among them based on the
    setting.

  Building those blocks + template is a meaningful piece of
  work — not a one-line wiring like the other 13. The schema
  description now spells out the no-op state; the F.9.2
  follow-up handles the variants.

  ### Status across F.9.1 phase

  | Wave           | Settings live                                                                              |
  | -------------- | ------------------------------------------------------------------------------------------ |
  | F.9.1-A        | 6 (newsletter, social, byline, studioName, gridColumns/gutter, footer credit/year)         |
  | F.9.1-B        | 7 (postsPerPage, accentColor x2, cardAspect, hoverStyle, showProjectMeta, showProjectTags) |
  | F.9.1-C (this) | 2 (aboutCopy, clientLogos) + 1 explicit no-op (heroStyle)                                  |

  **15 of 18 v0.2 settings produce visible site changes from
  admin toggles.** The remaining 3 (magazine heroStyle, plus
  docs `showTableOfContents` which awaits TOC component, and
  docs `version` which is partially wired through the header
  already) need new components rather than wiring — F.9.2
  territory.

  ### Validation

  End-to-end loop holds: operator installs theme, activates,
  opens Theme settings panel, toggles a value → save → reload
  public site → visible change. The "operator no-code" promise
  shipped + delivers immediate feedback for almost every
  declared setting.

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
  - @nexpress/editor@0.1.0
  - @nexpress/theme@0.1.0
