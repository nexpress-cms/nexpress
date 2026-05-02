---
"@nexpress/core": patch
"@nexpress/admin": patch
---

Adds a stuck-job detector to the `/admin/jobs` admin surface
(Phase 23.5). The worker-health card above the state tabs now
shows a warning pill when the count of `failed` or `expired` jobs
crosses a configurable threshold (defaults: `failed: 10`,
`expired: 50`).

New public API on `@nexpress/core`:

- `NxJobQueue.countByState(options?)` — optional method returning
  `{ created, active, completed, failed, retry, cancelled, expired }`
  counts across the union of `pgboss.job` (live) and
  `pgboss.archive` (rolled). Implemented by `PgBossAdapter`; absent
  on test stubs that don't model state, in which case the admin
  endpoint omits the stuck block.
- `NxJobCountOptions` — accepts `since: Date` for time-bounded
  queries ("failures in the last 24 h").
- `NxJobStateCounts` — the result record. Every key is always
  present so callers can index without optional chaining.
- `NxConfig.jobs.stuckThreshold` — `{ failed?: number;
  expired?: number }` config slot. Unset values fall back to the
  admin widget's defaults.

Plugin authors building their own monitoring can call
`countByState({ since })` directly. The existing
`@nexpress/core/jobs` subpath re-exports the new types
automatically.
