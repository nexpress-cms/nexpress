---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/next": patch
"@nexpress/plugin-forum": patch
"@nexpress/theme": patch
"@nexpress/theme-community": patch
"create-nexpress": patch
---

Add explicit collection-owned public member activity with PII-free profile and
exact document/comment page contracts, validated API and OpenAPI surfaces,
prepared theme renderer props, forum opt-in, a complete community-theme view,
comment anchors, and scaffolded route coverage.

`GET /api/members/{handle}` now returns the exact profile fields directly;
clients using the previous `{ member: ... }` wrapper should read those fields
from the response root.
