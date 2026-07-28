---
"@nexpress/core": minor
"@nexpress/app": patch
---

Complete the external search adapter audience contract with one framework-derived `public | all` scope, exact audience-aware collection inventories, fail-closed result validation, cache separation, OpenAPI, health diagnostics, and Postgres fallback.

Migration: every `NpSearchAdapter` must declare `audience: "document-v1"`, filter hits and counts for the collections in `context.audience.collections`, and return each scoped document's canonical `audience` field. Framework/tests that manually constructed `NpSearchAdapterContext` should construct an `NpSearchResolvedRequest` and call `resolveSearchAdapterContext()` after collection registration.
