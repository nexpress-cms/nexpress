---
"@nexpress/core": minor
"@nexpress/next": patch
"@nexpress/app": patch
"@nexpress/theme-default": patch
"@nexpress/theme-docs": patch
---

Unify search requests, adapter candidates, public results, current-site and
visibility scope, cache keys, reindex responses, OpenAPI, themes, bootstrap
lifecycle, and live health behind one exact bounded Core contract. Malformed
external results and dispatch failures are contained, diagnosed, and fall back
to the built-in Postgres path before they can reach caches or callers.
