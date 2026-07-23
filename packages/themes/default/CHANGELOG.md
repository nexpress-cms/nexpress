# @nexpress/theme-default

## 0.5.0

### Patch Changes

- Updated dependencies [cace33b]
- Updated dependencies [3969569]
- Updated dependencies [3d6d276]
- Updated dependencies [df355e8]
- Updated dependencies [258a9b7]
- Updated dependencies [1dadf0c]
- Updated dependencies [1909079]
- Updated dependencies [d4e109e]
- Updated dependencies [a5898f2]
- Updated dependencies [1d9ef80]
- Updated dependencies [839f2f9]
- Updated dependencies [7d0f4fb]
- Updated dependencies [66c7f66]
- Updated dependencies [305ba8a]
- Updated dependencies [c6d72b8]
- Updated dependencies [7ec1b9c]
- Updated dependencies [b9d699d]
  - @nexpress/core@0.5.0
  - @nexpress/blocks@0.5.0
  - @nexpress/next@0.5.0
  - @nexpress/theme@0.5.0
  - @nexpress/editor@0.5.0

## 0.4.1

### Patch Changes

- @nexpress/blocks@0.4.1
- @nexpress/core@0.4.1
- @nexpress/editor@0.4.1
- @nexpress/next@0.4.1
- @nexpress/theme@0.4.1

## 0.4.0

### Patch Changes

- 3adebdb: Unify staff and member authentication around exact identity, JWT, API wire, credential, runtime configuration, and one-row browser-session contracts. Runtime authentication now recognizes `NP_SECRET` as its only signing-key environment variable and fails closed for malformed JWT, lockout, invitation, reset, verification, or OAuth-state settings. Refresh compare-and-swap rotates access and refresh hashes, logout revokes the pair through either live token's shared session id, password replacement and whole-identity revocation commit atomically, single-use credentials reject concurrent replay, OAuth state cookies share the signed token lifetime, and doctor validates runtime configuration plus persisted auth/session rows.
- fdcbfd3: Unify process bootstrap behind the exact `read`, `plugins`, `worker`, and
  `write` intents. Startup is race-safe, retryable, and fail-closed; terminal
  shutdown drains every owned resource in dependency order. Framework-only raw
  singleton wiring moves from the core root to `@nexpress/core/bootstrap`, while
  apps, workers, standalone scripts, generated code, and scaffolds use the same
  `createBootstrap()` contract.
- 773bd1a: Unify locale config, resolution input, app/theme/plugin ICU catalogs, runtime
  parameters, Admin request/response wires, persisted overrides, bounded caches,
  translation-progress counts, doctor, and live health behind one exact
  fail-closed i18n contract. Add the
  client-safe `@nexpress/core/i18n-contract` entry for proxy and Admin consumers.
- a678bb5: Unify search requests, adapter candidates, public results, current-site and
  visibility scope, cache keys, reindex responses, OpenAPI, themes, bootstrap
  lifecycle, and live health behind one exact bounded Core contract. Malformed
  external results and dispatch failures are contained, diagnosed, and fall back
  to the built-in Postgres path before they can reach caches or callers.
- 105beb7: Add default-theme member notification entry points in the desktop header and mobile drawer, with refreshed route metadata for the member notifications page.
- bedb705: Add one exact navigation tree contract across theme seeds, Admin and API
  writes, backup import/export, OpenAPI, persisted reads, caches, and public
  rendering. Stored and resolved navigation types are now distinct, malformed
  rows fail closed, and the client-safe navigation validators are public.
- 763ce4a: Promote rich-text content to a stable NexPress-owned v1 envelope. Validate the
  wire format before collection writes; share the type guard, validator, version,
  and empty-document factory through the client-safe fields subpath; and align
  editor state, generated types, SSR, search, media and mention extraction,
  translation interchange, WordPress import, Admin, themes, and example plugins.
- Updated dependencies [bae7088]
- Updated dependencies [257e70f]
- Updated dependencies [3deb01e]
- Updated dependencies [7d31c88]
- Updated dependencies [8693411]
- Updated dependencies [3adebdb]
- Updated dependencies [fdcbfd3]
- Updated dependencies [1ff06a7]
- Updated dependencies [922c708]
- Updated dependencies [ab83768]
- Updated dependencies [080fcbf]
- Updated dependencies [257b120]
- Updated dependencies [773bd1a]
- Updated dependencies [21d4748]
- Updated dependencies [c10eb69]
- Updated dependencies [4cef9c8]
- Updated dependencies [a678bb5]
- Updated dependencies [b44257f]
- Updated dependencies [3eb1af7]
- Updated dependencies [27a4f0e]
- Updated dependencies [9eea115]
- Updated dependencies [2e35374]
- Updated dependencies [f3dee13]
- Updated dependencies [ba9f730]
- Updated dependencies [e58c4c8]
- Updated dependencies [f7ee76e]
- Updated dependencies [23c1f69]
- Updated dependencies [fdd684d]
- Updated dependencies [f8ef45e]
- Updated dependencies [cef1583]
- Updated dependencies [3396b1c]
- Updated dependencies [c0a7da6]
- Updated dependencies [bedb705]
- Updated dependencies [91867cc]
- Updated dependencies [3d45e43]
- Updated dependencies [2dce282]
- Updated dependencies [75e6c34]
- Updated dependencies [e0a2092]
- Updated dependencies [8cb026a]
- Updated dependencies [81b3fb5]
- Updated dependencies [f6fa9d1]
- Updated dependencies [5522c32]
- Updated dependencies [0944d13]
- Updated dependencies [ccad4ed]
- Updated dependencies [763ce4a]
  - @nexpress/blocks@0.4.0
  - @nexpress/core@0.4.0
  - @nexpress/editor@0.4.0
  - @nexpress/theme@0.4.0
  - @nexpress/next@0.4.0

## 0.3.26

### Patch Changes

- Updated dependencies [64c6c7e]
- Updated dependencies [11e3007]
- Updated dependencies [61d3c2e]
- Updated dependencies [1b3fa11]
- Updated dependencies [e81ebaa]
- Updated dependencies [192270e]
  - @nexpress/core@0.3.26
  - @nexpress/editor@0.3.26
  - @nexpress/blocks@0.3.26
  - @nexpress/next@0.3.26
  - @nexpress/theme@0.3.26

## 0.3.25

### Patch Changes

- 2c95312: Improve public search UX with stable result metadata, page-based API pagination,
  public-collection filters on `/search`, mobile-safe result cards, locale-aware
  site search, and built-in theme search entry points.
- Updated dependencies [a9b2a81]
- Updated dependencies [d48a1c8]
- Updated dependencies [2b72360]
- Updated dependencies [a96907c]
- Updated dependencies [2c95312]
  - @nexpress/next@0.3.25
  - @nexpress/core@0.3.25
  - @nexpress/blocks@0.3.25
  - @nexpress/theme@0.3.25
  - @nexpress/editor@0.3.25

## 0.3.24

### Patch Changes

- Updated dependencies [b8cce91]
  - @nexpress/next@0.3.24
  - @nexpress/blocks@0.3.24
  - @nexpress/core@0.3.24
  - @nexpress/editor@0.3.24
  - @nexpress/theme@0.3.24

## 0.3.23

### Patch Changes

- @nexpress/blocks@0.3.23
- @nexpress/core@0.3.23
- @nexpress/editor@0.3.23
- @nexpress/next@0.3.23
- @nexpress/theme@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies [7a28472]
- Updated dependencies [31f1868]
  - @nexpress/core@0.3.22
  - @nexpress/blocks@0.3.22
  - @nexpress/next@0.3.22
  - @nexpress/theme@0.3.22
  - @nexpress/editor@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies [edfc9ae]
- Updated dependencies [b5b9074]
  - @nexpress/core@0.3.21
  - @nexpress/blocks@0.3.21
  - @nexpress/next@0.3.21
  - @nexpress/theme@0.3.21
  - @nexpress/editor@0.3.21

## 0.3.20

### Patch Changes

- @nexpress/blocks@0.3.20
- @nexpress/core@0.3.20
- @nexpress/editor@0.3.20
- @nexpress/next@0.3.20
- @nexpress/theme@0.3.20

## 0.3.19

### Patch Changes

- @nexpress/blocks@0.3.19
- @nexpress/core@0.3.19
- @nexpress/editor@0.3.19
- @nexpress/next@0.3.19
- @nexpress/theme@0.3.19

## 0.3.18

### Patch Changes

- @nexpress/blocks@0.3.18
- @nexpress/core@0.3.18
- @nexpress/editor@0.3.18
- @nexpress/next@0.3.18
- @nexpress/theme@0.3.18

## 0.3.17

### Patch Changes

- Updated dependencies [6d55e54]
  - @nexpress/blocks@0.3.17
  - @nexpress/next@0.3.17
  - @nexpress/theme@0.3.17
  - @nexpress/core@0.3.17
  - @nexpress/editor@0.3.17

## 0.3.16

### Patch Changes

- 401d23d: Render the settings locales progress table as mobile-friendly collection cards on narrow screens.
  Keep the default theme mobile drawer from widening long article pages while open.
- b1c8643: Improve admin mobile ergonomics by tightening narrow-screen shell spacing, simplifying topbar breadcrumbs on phones, and stacking editor actions on very small viewports. Also remove the default theme's member-status loading chrome so auth links do not flash on first render.
- 7b29c8a: Improve 320px mobile overflow resilience for the default empty-state landing page, default post cover fallback, magazine footer links, and portfolio masthead.
  - @nexpress/blocks@0.3.16
  - @nexpress/core@0.3.16
  - @nexpress/editor@0.3.16
  - @nexpress/next@0.3.16
  - @nexpress/theme@0.3.16

## 0.3.15

### Patch Changes

- 225cf33: Fix mobile horizontal overflow from the default theme header, feature card, and closed drawer.
- da32271: Fix bundled theme mobile overflow regressions, including the default header's auth-driven
  tablet overflow, and allow seeded posts to declare clean URL slugs.
- Updated dependencies [da32271]
  - @nexpress/theme@0.3.15
  - @nexpress/next@0.3.15
  - @nexpress/blocks@0.3.15
  - @nexpress/core@0.3.15
  - @nexpress/editor@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies [bf8ca4d]
  - @nexpress/core@0.3.14
  - @nexpress/blocks@0.3.14
  - @nexpress/next@0.3.14
  - @nexpress/theme@0.3.14
  - @nexpress/editor@0.3.14

## 0.3.13

### Patch Changes

- a65979d: Keep built-in theme mobile drawer breakpoints aligned with their desktop navigation collapse points and close drawers when resizing back to desktop so slide-out GNB state cannot keep stale positioning.
  - @nexpress/blocks@0.3.13
  - @nexpress/core@0.3.13
  - @nexpress/editor@0.3.13
  - @nexpress/next@0.3.13
  - @nexpress/theme@0.3.13

## 0.3.12

### Patch Changes

- Updated dependencies [f4c483c]
- Updated dependencies [fb4ba86]
  - @nexpress/editor@0.3.12
  - @nexpress/blocks@0.3.12
  - @nexpress/next@0.3.12
  - @nexpress/theme@0.3.12
  - @nexpress/core@0.3.12

## 0.3.11

### Patch Changes

- @nexpress/blocks@0.3.11
- @nexpress/core@0.3.11
- @nexpress/editor@0.3.11
- @nexpress/next@0.3.11
- @nexpress/theme@0.3.11

## 0.3.10

### Patch Changes

- 6d0b818: Complete the default theme's single-post and tag archive surfaces with resolved tag links, related posts, archive metadata, and relationship-backed tag browsing.
- Updated dependencies [45bca0d]
  - @nexpress/core@0.3.10
  - @nexpress/theme@0.3.10
  - @nexpress/blocks@0.3.10
  - @nexpress/next@0.3.10
  - @nexpress/editor@0.3.10

## 0.3.9

### Patch Changes

- 48ac6a4: Align the default theme's seeded content with the Equilibrium design handoff. The home page now seeds into the writing front template instead of marketing blocks, `/blog` uses the same publication copy and category strip, and the seeded posts/navigation/footer copy match the redesigned theme preview.

  Tighten the other built-in themes against the same design handoff: docs now seeds the visible "Plugin author quickstart" page copy, magazine fixes the cover-story title/deck/byline/issue chrome, and portfolio removes the extra Press seed surface so the seeded pages match the Work/Project/Studio/Journal design set.
  - @nexpress/blocks@0.3.9
  - @nexpress/core@0.3.9
  - @nexpress/editor@0.3.9
  - @nexpress/next@0.3.9
  - @nexpress/theme@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies [b331118]
  - @nexpress/core@0.3.8
  - @nexpress/blocks@0.3.8
  - @nexpress/next@0.3.8
  - @nexpress/theme@0.3.8
  - @nexpress/editor@0.3.8

## 0.3.7

### Patch Changes

- @nexpress/blocks@0.3.7
- @nexpress/core@0.3.7
- @nexpress/editor@0.3.7
- @nexpress/next@0.3.7
- @nexpress/theme@0.3.7

## 0.3.6

### Patch Changes

- @nexpress/blocks@0.3.6
- @nexpress/core@0.3.6
- @nexpress/editor@0.3.6
- @nexpress/next@0.3.6
- @nexpress/theme@0.3.6

## 0.3.5

### Patch Changes

- @nexpress/blocks@0.3.5
- @nexpress/core@0.3.5
- @nexpress/editor@0.3.5
- @nexpress/next@0.3.5
- @nexpress/theme@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies [4d997b8]
  - @nexpress/core@0.3.4
  - @nexpress/blocks@0.3.4
  - @nexpress/next@0.3.4
  - @nexpress/theme@0.3.4
  - @nexpress/editor@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [3072b40]
  - @nexpress/core@0.3.3
  - @nexpress/blocks@0.3.3
  - @nexpress/next@0.3.3
  - @nexpress/theme@0.3.3
  - @nexpress/editor@0.3.3

## 0.3.2

### Patch Changes

- f74b413: Member-surface CSS pass — second sweep through PR #801's lint baseline:
  - **Default theme** — adds CSS for the `MemberStatusWidget` (sign-in / sign-out chrome). 5 selectors: `.np-member-status` flex container, `.np-member-status-handle` link, `.np-member-status-loading` pulse skeleton, `.np-button-primary` filled CTA, `.np-text-button` minimal text button. The button classes are also reusable outside the widget.
  - **Portfolio + docs themes** — adds CSS for the members shell + column (`np-portfolio-members` / `np-docs-members` outer container with vertical breathing room, `np-{portfolio,docs}-members-column` narrow auth-form column, max-width 30–32rem).
  - **Lint baseline** — drops 8 fixed entries (5 default + 2 portfolio + 2 docs). Reclassifies 8 inline-styled landmarks (`np-{portfolio,docs}-{error,not-found,members-error,members-not-found}`) as VERIFIED_LANDMARK_INLINE — each renders its root with a full `style={{...}}` prop, so no CSS rule is needed. Strips JSDoc / line comments before token extraction so `<main className="np-member-main">` references in docstrings stop counting as JSX (drops `np-member-main` from both portfolio + docs baselines).

- Updated dependencies [131d969]
- Updated dependencies [1fe61de]
- Updated dependencies [ad4fcba]
- Updated dependencies [4e75c7a]
- Updated dependencies [0c5b8d9]
  - @nexpress/core@0.3.2
  - @nexpress/next@0.3.2
  - @nexpress/blocks@0.3.2
  - @nexpress/theme@0.3.2
  - @nexpress/editor@0.3.2

## 0.3.1

### Patch Changes

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
  - @nexpress/next@0.3.1
  - @nexpress/theme@0.3.1
  - @nexpress/blocks@0.3.1
  - @nexpress/editor@0.3.1

## 0.3.0

### Minor Changes

- 5faaede: Theme-default redesign — production blog baseline with seed content.

  The visual surface is overhauled to a low-key engineering-blog identity:
  hairline sticky header with a logo mark + centered nav + ⌘K search pill +
  Subscribe CTA; centered page header with a primary-tinted eyebrow pill +
  big headline + intro + category strip; two-column feature card with a
  gradient cover (figure + issue/read-time overlay) above a three-up post
  grid where each card cycles through six cover gradients and four avatar
  tones so the grid reads as a typographic mosaic; dark inline newsletter
  slab with a radial glow; four-column footer (brand / sitemap / resources
  / newsletter) with a bottom secondary-links row.

  `impl.tokens` overlay sets the new identity — indigo `#4f46e5` primary,
  Geist Sans + Geist Mono font stacks (system-font fallback chain so no
  webfont request at boot), refreshed radii (6 / 10 / 14 px).

  `impl.seedContent` ships out of the box:
  - **11 tags**: Engineering, Postgres, TypeScript, Distributed, Product,
    Notes, RFC, Caches, Indexes, Types, Queues.
  - **7 posts** (one feature + six grid): production-shaped pieces on
    read-replica routing, planner pathology, branded primitives, the
    transactional outbox, latency budgets, cache stampedes, and the
    RFC template.
  - **Navigation**: header (Writing / Notes / Talks / About) and footer
    (same + Archive).

  `PostCard` gains optional props (`coverGradient`, `coverFigure`,
  `coverOverlay`, `kicker`, `avatarTone`) that the post-list template
  supplies based on card index. `PostListDoc` (the doc shape the list
  template reads) gains `eyebrow`, `categories`, `sectionMeta`,
  `pagination`, `newsletter` — all optional, so existing sites that route
  plain `{ docs, heading, intro }` through the template keep working.

  Inline newsletter renders a plain `<form action="/api/subscribe">`
  (operators wire the endpoint) rather than pulling the
  `useState`-backed `NewsletterForm` into the server-template bundle.
  Footer continues to render the client `NewsletterForm` for inline
  success / error feedback.

### Patch Changes

- 0c096f1: Wires three small client-side affordances the themes already
  hinted at but didn't actually deliver:
  - **`@nexpress/theme-default`** + **`@nexpress/theme-docs`**:
    the masthead ⌘K affordance now works. A new
    `SearchKeyboardShortcut` client island listens for Cmd+K /
    Ctrl+K on `document` and focuses + selects the search input.
    Drops into both themes as a sibling of the search form;
    hidden in the DOM (renders `null`).
  - **`@nexpress/theme-docs`**: TOC scrollspy. A new
    `TocScrollspy` client island reads the heading ids the
    template already emits (h2/h3 from `renderRichText`) and
    stamps `aria-current="true"` on the matching TOC anchor as
    the user scrolls. CSS already targeted `aria-current`
    styling, but no walker was emitting the attribute — now there
    is. Uses `IntersectionObserver` with a top-biased margin so
    activation happens when a heading enters the top third of
    the viewport.
  - **`@nexpress/theme-portfolio`**: live-ticking local-time
    pill. The masthead's `City · HH:MM` label was SSR-only and
    drifted as the page sat idle. A new `LocalTimeTicker` client
    island re-derives the same `Intl.DateTimeFormat` output once
    a minute, aligned to the next minute boundary so all
    visitors see the rollover at the same wall-clock second.
    SSR initial label is reused as the first state — no
    hydration flicker.

  Each island is module-scoped, mount-only side effects, and
  disposes its listener/observer on unmount. None of them ship
  new operator-visible settings; they're polish on the chrome
  the themes already render.

- 41df9e4: Theme polish bundle:
  - **`@nexpress/next`** ships a new `getCachedSite()` (+
    `siteCacheTag`) so themes can read the operator's site name
    from the `np_sites` row without each one wiring its own DB
    query. Same `unstable_cache` pattern as the other cached
    helpers; tag is `np:site:<siteId>`.
  - **`@nexpress/theme-default`** and **`@nexpress/theme-docs`**
    now read the site name from `getCachedSite()` for the
    masthead logo, footer brand, and footer copyright. Operators
    who rename their site in the Setup wizard or in admin no
    longer see "NexPress" baked into the chrome. Empty / missing
    rows fall back to the literal `"NexPress"` so a degraded DB
    doesn't leave the header blank.
  - **`@nexpress/theme-magazine`** adds optional
    `leadIssueNumber` to its settings schema. When unset, the
    cover-story figure falls back to an ISO-style week-of-year so
    a fresh install ships with a sensibly rotating counter
    (previously hardcoded to `47`).
  - **`@nexpress/theme-portfolio`** restores typecheck on `main`:
    - `socialLinks` added to `portfolioSettingsSchema` (the
      template was rendering it but the schema didn't declare it
      — a regression from #736's self-review).
    - `publishedAt` added to `PortfolioProjectDoc` so the year
      fallback in the project-index template compiles.
    - Removes `gridColumns` / `cardAspect` / `galleryGutter` /
      `hoverStyle` from settings + shell (orphaned by the #736
      redesign — the redesigned card grid uses hardcoded
      per-span `aspect-ratio` and dropped the per-card hover-
      variant data attribute). The auto-form drops these
      sections automatically.

  The portfolio settings drop is the only intentionally-breaking
  piece here. Operators who had values saved against
  `gridColumns` / `cardAspect` / `galleryGutter` / `hoverStyle`
  will see them silently ignored on the next save; the strings
  weren't doing anything since #736 anyway.

- Updated dependencies [ab3afa7]
- Updated dependencies [f36c0f2]
- Updated dependencies [bb1bd30]
- Updated dependencies [41df9e4]
- Updated dependencies [f10d5b7]
  - @nexpress/core@0.3.0
  - @nexpress/editor@0.3.0
  - @nexpress/theme@0.3.0
  - @nexpress/next@0.3.0
  - @nexpress/blocks@0.3.0

## 0.2.2

### Patch Changes

- e733d47: Lazy-import `next/headers` inside the request-scoped function body of `DefaultHeader` and `MagazineHeader` instead of at module top level. Next's `package.json` exports map declares `./headers` as a Next-build-context-only specifier — outside a Next bundle (e.g. when `pnpm nexpress theme:install <pkg>` dynamically imports a theme to read its `requires` field) the resolution fails with `ERR_MODULE_NOT_FOUND` at module load and the CLI can't read anything from the theme.

  Moving the import into the function body keeps the theme module's top-level evaluation Next-free, so CLI tooling can introspect themes without booting a Next bundle. The request-scoped behavior is identical — `headers()` only executes inside a Next render anyway.

- Updated dependencies [e733d47]
  - @nexpress/core@0.2.2
  - @nexpress/blocks@0.2.2
  - @nexpress/next@0.2.2
  - @nexpress/theme@0.2.2
  - @nexpress/editor@0.2.2

## 0.2.1

### Patch Changes

- @nexpress/blocks@0.2.1
- @nexpress/core@0.2.1
- @nexpress/editor@0.2.1
- @nexpress/next@0.2.1
- @nexpress/theme@0.2.1

## 0.2.0

### Patch Changes

- @nexpress/blocks@0.2.0
- @nexpress/core@0.2.0
- @nexpress/editor@0.2.0
- @nexpress/next@0.2.0
- @nexpress/theme@0.2.0

## 0.1.6

### Patch Changes

- @nexpress/blocks@0.1.6
- @nexpress/core@0.1.6
- @nexpress/editor@0.1.6
- @nexpress/next@0.1.6
- @nexpress/theme@0.1.6

## 0.1.5

### Patch Changes

- @nexpress/blocks@0.1.5
- @nexpress/core@0.1.5
- @nexpress/editor@0.1.5
- @nexpress/next@0.1.5
- @nexpress/theme@0.1.5

## 0.1.3

### Patch Changes

- Updated dependencies [bb6f71c]
  - @nexpress/core@0.1.3
  - @nexpress/blocks@0.1.3
  - @nexpress/next@0.1.3
  - @nexpress/theme@0.1.3
  - @nexpress/editor@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [7d87406]
  - @nexpress/next@0.1.2
  - @nexpress/core@0.1.2
  - @nexpress/blocks@0.1.2
  - @nexpress/editor@0.1.2
  - @nexpress/theme@0.1.2

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
  - @nexpress/editor@0.1.1
  - @nexpress/next@0.1.1
  - @nexpress/theme@0.1.1

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
