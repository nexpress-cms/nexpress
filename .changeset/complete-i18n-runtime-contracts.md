---
"@nexpress/core": minor
"@nexpress/app": patch
"@nexpress/admin": patch
"@nexpress/theme-default": patch
---

Unify locale config, resolution input, app/theme/plugin ICU catalogs, runtime
parameters, Admin request/response wires, persisted overrides, bounded caches,
translation-progress counts, doctor, and live health behind one exact
fail-closed i18n contract. Add the
client-safe `@nexpress/core/i18n-contract` entry for proxy and Admin consumers.
