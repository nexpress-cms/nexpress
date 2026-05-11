# @nexpress/theme-portfolio

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

- 33b31f9: **Portfolio + docs reference themes adopt the M.\* member-surface
  contract.**

  Both themes now declare `impl.members.{shell, notFound}` plus a
  `./components/members-error` client subpath. Without this, the
  F-track fallback chain in `<ShellWrap surface="member">` would
  walk back to `impl.shell` + chrome slots, leaving auth forms
  stretched across the public site's wide layouts (portfolio is
  image-led, docs has a hierarchical sidebar that's useless on
  auth surfaces).

  **Portfolio** ships:
  - `PortfolioMembersShell` — `np-portfolio` root + accent-color +
    card-aspect CSS vars, header + footer chrome, narrow 420-wide
    content column.
  - `PortfolioMembersNotFound` — minimal serif heading, stale-auth-
    link copy, `/members/login` CTA.
  - `./components/members-error` (client subpath) — same minimal
    voice as the rest of the theme, "Try again" + "Back to sign in"
    CTAs.
  - `--np-member-form-*` overrides — transparent input bg,
    hairline borders, theme primary on focus, 0.25rem corners.

  **Docs** ships:
  - `DocsMembersShell` — drops the sidebar (hierarchical doc nav
    has no place on auth forms), header + 440-wide content column.
  - `DocsMembersNotFound` — monospace eyebrow ("404 · account"),
    technical voice.
  - `./components/members-error` (client subpath) — monospace
    ("500 · account") eyebrow + same dual-CTA pattern.
  - `--np-member-form-*` overrides — 0.375rem corners, monospace
    label accent.

  The host's `(member)/error.tsx` registers both new theme entries
  in `THEME_MEMBER_ERRORS` alongside magazine's existing entry, so
  the active-theme `<style data-np-theme="…">` tag lazy-imports
  the correct client chunk when the boundary fires.

  Reference impl pattern stays unchanged from magazine (M.ref):
  - Member shell wrap component is a Server Component that
    duplicates `<Header />` (and `<Footer />` where applicable)
    inline because `<ShellWrap surface="member">` opts OUT of
    the layout's chrome-slot injection when `impl.members.shell`
    is truthy.
  - `notFound.tsx` renders a `<div>`, not `<main>` — the framework
    `<ShellWrap>` already emits the page's `<main>` landmark.
  - `error.tsx` uses the F.7.1 client-subpath delegation pattern
    (Next.js requires error.tsx be `"use client"`, so theme error
    UI lives in a separate chunk the host lazy-imports).

  Closes the trigger-driven follow-up from
  `v0.3-theme-deferred-queue.md`: "portfolio / docs reference
  theme adoption of M.\*".

- 0a7f284: **Phase F.9-C — portfolio theme rebuilt against v0.2 contract.**

  Third of three reference-theme rebuilds (design doc §4.9).
  Stresses **F.3 deep settings** as the primary axis — the 10-
  field settingsSchema exercises every auto-form widget the
  generator supports (number range, enum, boolean, color regex,
  URL, text, textarea, array of objects with required sub-fields).

  Combined with magazine (F.9-A) and docs (F.9-B), v0.2's
  contract surfaces are exercised end-to-end by 3 themes that
  look and behave very differently — a real test of "any
  content-centric site shape" claim.

  ### v0.2 surfaces (per phase)

  | Phase | Surface                                                                                                                                                                                                                                                                                                                                                                                 |
  | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | F.1   | \`requires\`: posts collection with \`heroImage\` (upload), optional \`client\`/\`year\`/\`role\` (text/number, hard:false)                                                                                                                                                                                                                                                             |
  | F.3   | **12-field settingsSchema** — gridColumns + galleryGutter + copyrightYear (number, range-constrained), cardAspect + hoverStyle (enum), showProjectMeta + showProjectTags + showFooterCredit (boolean), accentColor (color regex), studioName + aboutCopy (text — textarea support for `z.string()` is F.5.1/F.3 follow-up), clientLogos (array of objects with required URL sub-fields) |
  | F.4   | 2 blocks: \`portfolio.case-study-hero\` + \`portfolio.image-grid\`                                                                                                                                                                                                                                                                                                                      |
  | F.6   | 2 navLocations: \`primary\` + \`footerSocial\`                                                                                                                                                                                                                                                                                                                                          |
  | F.7   | \`notFound\`: dark/sparse 404 styled to surface palette                                                                                                                                                                                                                                                                                                                                 |

  ### Cross-axis check vs F.9-A / F.9-B

  | Axis           | magazine                    | docs                  | portfolio                                                 |
  | -------------- | --------------------------- | --------------------- | --------------------------------------------------------- |
  | Settings shape | enum/array-heavy            | text-heavy (5 fields) | broad (12 fields, every supported widget except textarea) |
  | Patterns       | yes (2)                     | no                    | no                                                        |
  | Archives       | yes (byCategory + byAuthor) | no (uses routes)      | no                                                        |
  | Routes         | no                          | yes (/search)         | no                                                        |
  | navLocations   | 3                           | 1                     | 2                                                         |
  | Blocks         | 2                           | 0                     | 2                                                         |

  Combined coverage: every contract surface exercised by at least
  one theme; auto-form generator validated against every supported
  widget type (text, url, color, number with range, boolean,
  enum, object, array of objects). Multi-line textarea support
  for `z.string()` is the only widget gap, recorded as F.5.1
  follow-up. Both archives + routes paths through F.2 covered;
  F.4 + F.5 patterns covered.

  ### What's not in this PR (F.9.1 follow-up)
  - **Theme components reading getThemeSettings**: the 12-field
    schema exists and validates, but the existing portfolio
    components still render with hardcoded defaults. Wiring
    `settings.gridColumns` / `settings.hoverStyle` etc. through
    to the actual rendering is operator-facing polish; the
    contract is shipped.
  - **Image-grid array editor**: \`items\` field uses textarea/JSON
    in v0.2 (same as magazine.section-strip). F.5.1 adds a richer
    per-item editor.

  ### Validation status

  Third and final reference-theme rebuild. F.9-D will retire
  \`default\` + \`minimal\` (absorbed as magazine settings
  variants per design doc §1 decision C).

  The portfolio theme stays registered in apps/web's
  nexpressConfig.themes alongside magazine, docs, default,
  minimal — operators can compare side-by-side via admin's
  theme switcher.

  ### Dependency note

  \`@nexpress/theme-portfolio\` gains \`zod\` (^4.3.6) for the
  settings schema.

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

- 10d3d1d: **Docs `/docs/:slug` + portfolio `/work/:slug` theme routes
  land — closes #609, #613, #614.**

  Three related route-mismatch issues from the 2026-05-10 sweep,
  all about theme components emitting URLs the framework had no
  way to resolve.

  **#609 — Docs theme `/search` shadowed by host file route.**
  Per the locked dispatch order (app file > page > theme >
  plugin), the reference app's `apps/web/src/app/(site)/search/page.tsx`
  takes `/search` before the catch-all can route it. Docs theme's
  own search component (`DocsSearch`) was unreachable. The theme
  can't override the universal search page, so it scopes its own
  search to `/docs/search` — the operator gets both routes
  (framework `/search` + docs `/docs/search`). `DocsHeader`'s
  form action updates accordingly.

  **#614 — Docs `/docs/:slug` links unresolved.** The sidebar
  (`packages/themes/docs/src/sidebar.tsx`) and `DocPageTemplate`'s
  prev/next bar both emit `/docs/<slug>` links, but the reference
  app has no `/docs/[slug]` file route and the framework catch-all
  only resolves `pages` rows + theme archive routes. Arbitrary
  `docs` collection rows weren't reachable by URL.

  Fix: docs theme declares an explicit `/docs/:slug` route
  (`routes/doc-detail.tsx`) that looks up the docs row and
  renders it through `templates.docs.default` (DocPageTemplate).
  Status filter `"published"` matches the catch-all's `pages`
  visibility pattern.

  Route registration order matters — `/docs/search` precedes
  `/docs/:slug` so the literal beats the parametric route
  (dispatcher is first-match-wins).

  **#613 — Portfolio `/work/:slug` links unresolved.** Same
  shape: `PortfolioProjectCard` emits `/work/<slug>` URLs, but
  portfolio declared `templates.posts.detail`
  (ProjectDetailTemplate) without a route to reach it. The
  framework catch-all only resolves `pages` — `posts` rows
  addressed as `/work/<slug>` 404'd.

  Fix: portfolio gains a `routes` array with
  `{ pattern: "/work/:slug", component: PortfolioProjectDetailRoute }`.
  The component looks up the posts row by slug + status
  `"published"` and renders through
  `templates.posts.detail`.

  Both new route components live in a `routes/` subdirectory
  (matches the forum plugin's layout from PRT.3) and use
  `findDocuments<RowShape>` with locally-declared row interfaces
  — the schema lives in the operator's project, not the theme,
  so `theme:install @nexpress/theme-docs`/
  `@nexpress/theme-portfolio` is what reconciles the field set.

  ## What this DOESN'T solve

  `#612` — Reference blog routes (`apps/web/src/app/(site)/blog/`)
  still bypass `resolveTemplateComponent("posts", ...)`.
  `magazine`'s and `portfolio`'s `templates.posts.{list,detail}`
  remain unreachable via the canonical `/blog/*` URLs. Closing
  that is an apps/web edit (route delegation through theme
  templates) — separate PR with a user decision (which template
  wins on collision?), tracked.

  `#608` — Theme requirements can't express collection-level
  settings (`slugField`, `seo.urlPath`, etc.). Independent of
  the route work above; tracked for a follow-up that designs the
  contract extension or generates safe defaults in the install
  template.

### Patch Changes

- 4af9d6a: **Portfolio + docs ship theme-flavored public-site error pages.**

  Both themes now provide `./components/error` (client subpath) —
  the same F.7.1 delegation pattern magazine has used since #466.
  The host's `(site)/error.tsx` registers them in `THEME_ERRORS`
  alongside magazine, so a 500 in the `(site)` tree renders with
  the active theme's chrome instead of the framework's stripped
  default.

  Closes the trigger-skipped item from the previous
  member-surface PR (#631): "portfolio/docs `impl.error` (public-
  site error subpath)".

  **Portfolio** ships `PortfolioError` — minimal serif heading
  ("Something didn't load."), uppercase eyebrow, dual CTA ("Try
  again" + "Back home"). Matches the rest of the portfolio
  member-surface aesthetic (sharp corners, hairline borders,
  muted-foreground accents).

  **Docs** ships `DocsError` — monospace eyebrow ("500 · docs"),
  technical voice ("The page failed to render."), same dual CTA
  shape with 0.375rem corners. Matches `DocsMembersError`
  visually so the two surfaces feel like one theme.

  No change to either theme's `impl.error` field — that's a
  forward-compat type marker per the F.7.1 contract; the actual
  render goes through the host's lazy-imported client subpath
  keyed by the active-theme `<style data-np-theme>` tag.

  `default` theme deliberately remains bare — sites running on
  `default` still see the framework `DefaultError` when a 500
  fires, demonstrating the framework fallback baseline.

- ddbb536: **F.3 follow-up — textarea support in the theme settings auto-form.**

  Closes the textarea gap recorded in F.9.1-A/portfolio:
  `z.string()` always rendered as a single-line `<input>`, even
  when the field semantically wanted multi-line input (operator
  bios, long descriptions, etc.).

  ### How theme authors opt in

  Use Zod v4's `.meta()` to tag the field:

  ```ts
  import { z } from "zod";

  export const myThemeSettingsSchema = z.object({
    bio: z
      .string()
      .meta({ widget: "textarea", rows: 6 })
      .describe("Studio bio (markdown not supported)."),
  });
  ```

  Required: `meta.widget === "textarea"`. Optional: `meta.rows`
  (positive integer; defaults to 4).

  ### What changed

  #### `@nexpress/core`
  - `NpThemeSettingsTextareaField` — new variant on the
    introspected metadata union with optional `rows` hint.
  - `introspectThemeSettingsSchema` reads `inner.meta()` on
    string nodes and emits `type: "textarea"` when the
    `widget` key matches. Falls back to existing
    text/url/color detection otherwise.
  - `readMeta(node)` helper — small structural narrower around
    Zod's instance method (the `.meta()` call returns the
    merged description + custom keys).

  #### `@nexpress/admin`
  - `ZodForm`'s field dispatcher routes `textarea` to a new
    `TextareaField` component using the existing
    `Textarea` UI primitive.
  - Honors the `rows` hint when present.

  #### `@nexpress/theme-portfolio`
  - `aboutCopy` setting now declares `meta({ widget:
"textarea", rows: 4 })` — operator gets a multi-line
    input in admin → footer bio renders correctly across
    paragraph breaks.

  ### Tests

  4 new unit tests in `settings-schema.test.ts`:
  - emits textarea field when `meta({ widget: "textarea" })`
    is set
  - carries optional `rows` hint
  - unwraps through `.default()` / `.optional()` (meta lives
    on the inner string, not the wrapper)
  - ignores `meta` when `widget` key isn't `textarea`

  Total core tests: 325 (was 321).

  ### Cross-axis coverage closure

  After F.9.1-C the v0.2 settings cheat-sheet had:

  > Magazine: enum/array-heavy
  > Docs: text-heavy (5 fields)
  > Portfolio: every supported widget except textarea (12 fields)

  This PR closes the "except textarea" gap. **Auto-form now
  covers every widget shape Zod can declare** through the
  combination of native types + `.meta()` extension. Future
  custom widgets (color-with-palette, file-picker, slider, etc.)
  will follow the same `.meta()` pattern.

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
