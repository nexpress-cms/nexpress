---
"@nexpress/core": patch
"@nexpress/app": patch
---

Bound the community realtime outbox cleanup, schedule an hourly retention job,
and expose expired-row and oldest-row diagnostics through Doctor, Admin Health,
and ops status.
