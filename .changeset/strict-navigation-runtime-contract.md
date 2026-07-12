---
"@nexpress/core": minor
"@nexpress/admin": patch
"@nexpress/app": patch
"@nexpress/next": patch
"@nexpress/theme": minor
"@nexpress/theme-default": patch
"@nexpress/theme-magazine": patch
"@nexpress/theme-portfolio": patch
---

Add one exact navigation tree contract across theme seeds, Admin and API
writes, backup import/export, OpenAPI, persisted reads, caches, and public
rendering. Stored and resolved navigation types are now distinct, malformed
rows fail closed, and the client-safe navigation validators are public.
