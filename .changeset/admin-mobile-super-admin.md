---
"@nexpress/app": patch
"@nexpress/admin": patch
---

Treat the first-boot admin and E2E admin fixture as super-admins, and hide the Sites
admin entry for non-super admins so the multi-site screen matches the API gate.
