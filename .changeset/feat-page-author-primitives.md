---
"@nexpress/core": minor
---

**Page author primitives — fill in the four gaps theme / custom-page developers were hitting.**

`@nexpress/core` already covers most of what someone writing a hand-coded
Next.js route under `app/(site)/*` (or shipping a theme package) needs:
`findDocuments`, `getPageBySlug`, `searchCollections`, `getNavigation`,
`getSetting`, `getMediaById`, `t`, `tSync`, `requireAuth`, `getTheme`,
`renderBlocks`, `renderRichText`, `buildPageMetadata`, `buildSitemap`,
JSON-LD builders, and so on. Four primitives were missing and forced
either internal-API spelunking or hardcoded paths — this changeset
adds them with v0.1 stability commitment.

- **`getMediaUrl(id, { variant?, fallbackToOriginal? })`** in
  `@nexpress/core/media`. Resolves a media record's public URL through
  the active storage adapter (handles local-vs-S3 transparently) and
  picks the right sized variant from the row. Falls back to the
  original by default; pass `fallbackToOriginal: false` to get `null`
  when the variant is missing instead. Built-in variant names mirror
  `DEFAULT_IMAGE_SIZES` (`thumbnail`, `small`, `medium`, `large`,
  `xlarge`, `og`); plugin-defined variants are accepted as plain
  strings. Returns `null` for unknown / soft-deleted ids.

- **`getPluginConfig<T>(pluginId)`** in `@nexpress/core` (root and
  `@nexpress/core/plugins` via `./plugins/index.js`). Reads the
  persisted config from `np_plugins.config`. Returns `null` when the
  plugin isn't installed (so themes can detect "feature not available"
  without a separate `isPluginEnabled` round-trip), `{}` when
  installed with no config saved, and the typed object otherwise. The
  generic parameter is unchecked at runtime — callers should
  Zod-validate before trusting the shape since the framework can't
  see the plugin's schema. Internal `loadPluginConfig` now delegates
  to the public function so there's a single source of truth.

- **`resolveLocale(input)` + `getCurrentLocale(input)`** in
  `@nexpress/core/i18n`. Same conventions the reference app's
  `[[...slug]]` route uses, so theme / page authors don't reimplement
  them: pathname prefix beats `Accept-Language`, which beats the
  default locale. `resolveLocale` returns `{ locale, source,
  pathnameWithoutLocale }` (so callers building hreflang / canonical
  URLs know whether to issue a 301), `getCurrentLocale` is the thin
  wrapper that returns just the locale string with an `"en"` hard
  fallback when i18n isn't configured. Returns `null` from
  `resolveLocale` for monolingual sites. 12 unit tests cover quality
  factors, primary-subtag matching, wildcard rejection, and the
  path-beats-header precedence.

- **`getMemberProfile(idOrHandle, { avatarVariant? })`** in
  `@nexpress/core/community`. Public-facing member fetcher that hand-
  picks safe-to-render columns from `np_members` (id, handle,
  displayName, avatarUrl, bio, reputation, joinedAt) and excludes
  PII (email, password hash, login attempts, reset tokens,
  notification prefs, plugin meta bag). Resolves the avatar through
  `getMediaUrl` so the caller doesn't see storage-adapter details.
  Filters out `suspended` / `deleted` members. Accepts either id or
  handle in a single argument because callers don't always know
  which form they have (UUID-shape checks fail for synthetic /
  imported ids).

All four are stable in v0.1 — adding optional fields to the option
objects is non-breaking; renaming or removing one rides a minor with
a migration note.
