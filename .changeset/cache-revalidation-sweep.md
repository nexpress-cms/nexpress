---
"@nexpress/app": patch
"@nexpress/next": patch
---

Tighten public cache revalidation: scheduled-publish triggers now invalidate
collection caches immediately, collection writes emit `nx:collection:<slug>` for
cached theme/plugin routes, and the remote admin ops action allowlist includes a
dry-run/approval-gated `cache.revalidate` action.
