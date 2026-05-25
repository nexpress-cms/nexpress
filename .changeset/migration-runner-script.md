---
"create-nexpress": patch
---

Run scaffolded `pnpm db:migrate` through the shared migration runner so manual migrations surface the same database error detail as the setup wizard.
