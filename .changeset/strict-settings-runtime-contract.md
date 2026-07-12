---
"@nexpress/core": minor
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/plugin-sdk": minor
---

Make `np_sites` the single owner of site identity and add a closed,
fail-closed framework settings registry across core services, Admin, plugin
context, backup import/export, OpenAPI, and doctor. The new
`@nexpress/core/settings` subpath exposes the exact site, SEO, registry, and
validation contracts. General settings now accept only `site` and `seo`,
plugin writes require the calling plugin to be loaded, and malformed persisted
theme/plugin settings or migrator failures no longer reset silently. Full
site-config imports and exports use format version 2 with top-level canonical
site identity. Plugin ids now use one 128-character npm-shaped contract across
the SDK, core host, scoped config keys, cache invalidation, and encoded
Admin/API paths.
