---
"@nexpress/app": patch
"@nexpress/core": patch
"@nexpress/next": patch
"create-nexpress": patch
---

Unify logger and error-reporter adapters under one exact runtime contract.
Validate environment intent, adapter kinds, event/context shapes, async void
results, child loggers, and shutdown hooks; contain adapter failures and expose
them through Admin Health, doctor, and production readiness. Custom adapters
now declare `kind`, scaffolds share one `src/lib/observability.ts` definition
across web/worker/scripts, and worker shutdown flushes both adapters.
