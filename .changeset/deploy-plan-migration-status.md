---
"@nexpress/app": patch
---

Include `db:migrate -- --status` in deploy plans before applying migrations so operators can inspect pending work first.
