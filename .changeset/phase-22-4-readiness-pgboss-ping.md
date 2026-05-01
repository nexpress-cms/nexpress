---
"@nexpress/core": minor
---

Phase 22.4 — readiness probe round-trip for the job queue.

Adds an optional `isHealthy?(): Promise<boolean>` method to the
`NxJobQueue` interface and implements it on `PgBossAdapter` via
`PgBoss.isInstalled()` (a single SELECT against `pgboss.version`).
Adapters that don't implement it are assumed healthy — the readiness
probe never fails on a missing answer.

Before: `/api/health/ready` only checked whether the queue object had
been set on the singleton. A dead pool, a half-applied schema, or a
silently-rejected `startProducer()` left readiness reporting `ok` while
the queue was unusable.

After: when the wired adapter exposes `isHealthy()`, the probe round-
trips it and reports `ok: false` + `detail` on failure (and the
endpoint returns 503, matching the existing degraded-mode contract).
The pg-boss adapter swallows exceptions internally and returns
`false`, so callers never see a thrown error.
