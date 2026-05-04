---
"@nexpress/core": minor
"@nexpress/admin": minor
---

Page (and any other slug-having collection) creation now works
with non-Latin titles, and the slug becomes an editable input in
the admin sidebar.

Two bugs fixed together:

- **`slugify` dropped non-Latin characters.** The old regex
  `[^a-z0-9]+` stripped Korean / Japanese / Chinese / Cyrillic /
  Greek / etc. titles down to an empty string, then the
  pipeline threw `NxValidationError("Slug generation failed")`.
  The regex now uses `[^\p{L}\p{N}]+/u` to keep any Unicode
  letter or number. Latin diacritic-stripping (Crème → creme)
  still works via an `NFKD → strip combining marks → NFC`
  dance — the recompose step puts Hangul jamo back into
  syllables since NFKD alone decomposes them.
- **The admin had no slug input.** Most page-shaped collections
  configure `slugField: { useField: "title", unique: true }` and
  rely on auto-derive; they don't list `slug` in `fields` so
  the form had no way to override it. The edit view now
  injects an implicit `slug` text input in the sidebar
  whenever `slugField` is configured (and a `slug` field
  isn't already declared explicitly). Leave the input blank
  to keep the auto-derive behavior; type a custom value to
  override.

Both changes are wire-compatible. Existing slugs (all ASCII
today) continue to round-trip identically. Collections that
already declare a `slug` field explicitly get their existing
shape unchanged.
