---
"@nexpress/core": patch
"@nexpress/app": patch
---

Closes the last divergence path PR #808's transactional reseed left open: per-row `content:afterDelete` / `content:afterSave` post-commit hooks now defer execution until the caller's outer transaction actually commits. On rollback the deferred queue is discarded — no more ghost pg-boss `afterDelete` jobs or audit-log entries for rows that ended up restored.

Mechanism: new `withDeferredPostCommit(callback)` from `@nexpress/core` sets up an AsyncLocalStorage-backed queue around `callback`. `runPostCommit` checks the store on every call and pushes onto the queue if a scope is active; outside the scope, behavior is unchanged (fire immediately, swallow errors). After the callback resolves, the queue drains in FIFO order, each hook independently isolated (one failure logs and moves on). If the callback throws, the queue vanishes with it.

`api/admin/themes/reseed/route.ts` POST wraps its outer `db.transaction` in `withDeferredPostCommit`. The pattern composes — anyone bundling multiple `saveDocument({ tx })` / `deleteDocument({ tx })` calls under one tx can wrap with the same helper and get the same drain-on-commit / discard-on-rollback semantics for free.
