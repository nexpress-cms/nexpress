---
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/app": patch
"@nexpress/admin": patch
"@nexpress/plugin-forum": patch
"create-nexpress": patch
---

Add a site-scoped, PII-free community realtime invalidation contract for
comments, document engagement, and member notifications. Events use a
short-lived database outbox with monotonic resume ordering, exact SSE wires,
bounded polling fallback, Doctor/OpenAPI/site-deletion coverage, and scaffolded
route wrappers.
