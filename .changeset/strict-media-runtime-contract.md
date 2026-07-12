---
"@nexpress/core": minor
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/plugin-sdk": minor
---

Add one exact media record and image-variant contract across processing,
persisted reads, URL resolution, plugin reads, Admin APIs, OpenAPI, cleanup,
and storage diagnostics. Media URLs now use actual stored variant keys rather
than guessed WebP paths, the built-in worker processes image jobs by default,
and non-image uploads no longer enqueue Sharp work. Legacy `sizes.*.url`
members are no longer canonical; remove the cached URL member before optional
variant reprocessing so each entry contains storage metadata only.
Plugin `ctx.media.getUrl` now accepts `{ variant, fallbackToOriginal }` and
returns `null` when the media or required variant is absent; the previously
declared on-demand transform argument was never implemented.
