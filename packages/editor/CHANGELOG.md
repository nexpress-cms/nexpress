# @nexpress/editor

## 0.4.1

### Patch Changes

- @nexpress/core@0.4.1

## 0.4.0

### Patch Changes

- 3deb01e: Synchronize externally replaced rich-text values after form resets, autosave recovery, and revision restore without remounting the editor during normal typing.
- 763ce4a: Promote rich-text content to a stable NexPress-owned v1 envelope. Validate the
  wire format before collection writes; share the type guard, validator, version,
  and empty-document factory through the client-safe fields subpath; and align
  editor state, generated types, SSR, search, media and mention extraction,
  translation interchange, WordPress import, Admin, themes, and example plugins.
- Updated dependencies [257e70f]
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
- Updated dependencies [f6fa9d1]
- Updated dependencies [0944d13]
- Updated dependencies [ccad4ed]
- Updated dependencies [763ce4a]
  - @nexpress/core@0.4.0

## 0.3.26

### Patch Changes

- 11e3007: Refresh the Sharp and Lexical runtime dependencies and keep their TypeScript build output compatible with the updated package types.

## 0.3.25

## 0.3.24

## 0.3.23

## 0.3.22

## 0.3.21

## 0.3.20

## 0.3.19

## 0.3.18

## 0.3.17

## 0.3.16

## 0.3.15

## 0.3.14

## 0.3.13

## 0.3.12

### Patch Changes

- f4c483c: Improve mobile ergonomics across admin edit screens, block-editor controls, and rich-text image insertion dialogs.
- fb4ba86: Clamp collection editor columns and rich-text surfaces to the mobile viewport so toolbar content wraps instead of being clipped.

## 0.3.11

## 0.3.10

## 0.3.9

## 0.3.8

## 0.3.7

## 0.3.6

## 0.3.5

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

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
