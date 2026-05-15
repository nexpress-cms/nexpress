# @nexpress/editor

## 0.3.0

### Patch Changes

- f36c0f2: `renderRichText` now auto-emits `id` attributes on h2/h3 headings,
  and ships a matching `extractHeadingToc` helper.

  Before this change the docs theme had its own ad-hoc slugify + walk
  that produced a TOC list whose `#anchor` links never resolved —
  the renderer didn't write any `id` onto the heading elements they
  were supposed to land on. The fix is symmetric:
  - **`@nexpress/editor`**: the rendered DOM now includes an
    auto-derived id on each h2 / h3. Slugs use a Unicode-aware
    walker (NFKD + `\p{M}` strip for diacritics, `\p{L}`/`\p{N}` for
    letters/digits so CJK headings survive) and dedupe collisions
    inside a single document — `Notes` / `Notes` / `Notes` becomes
    `notes`, `notes-2`, `notes-3`. Empty results (punctuation- or
    emoji-only headings) fall back to `section`. Numbering is per-
    call: two `renderRichText` calls on the same page don't share
    state. h1 / h4–h6 are intentionally left alone (h1 is the page
    title; h4+ is below typical TOC scope).
  - **`@nexpress/editor/server`** also exports `extractHeadingToc`
    - `slugifyHeading` + the `NpHeadingTocEntry` type. The
      extractor returns one entry per h2 / h3 with the same id the
      renderer would emit, so deep-linking themes don't have to
      reimplement the slug logic and risk drift.
  - **`@nexpress/theme-docs`**: the doc-page template's local
    `extractToc` + `slugify` are deleted; the template now calls
    the shared `extractHeadingToc`. The "On this page" rail now
    produces working anchor links out of the box.

  Closes follow-up HIGH #1 from the theme redesign track.

  Both new exports are part of the editor's experimental surface
  (parented to `NpRichTextContent` which is already documented as
  not-stable-pre-1.0). The slug shape will be honored as a patch-
  level commitment going forward but may evolve before 1.0 if a
  broader Lexical contract change forces it.

## 0.2.2

## 0.2.1

## 0.2.0

## 0.1.6

## 0.1.5

## 0.1.3

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
