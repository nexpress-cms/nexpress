# Phase 23 plan — publish, harden, polish

Historical summary of the plan opened on 2026-05-02. The original sequence,
implementation notes and abandoned diagnostics remain in Git history. The
old CI-billing blocker and first-publish instructions are obsolete; this is
not the current work queue or release authorization.

Current owners: [operations](../operations.md), [testing](../testing.md),
[releasing](../releasing.md) and the [historical roadmap](../roadmap.md).

## Goal

Validate the initial CMS through real installation, publication and production
operations. Prioritize concrete deployment gaps and contributor setup friction.

## Sub-phase sequence

The original order is retained for references; the linked guides own current
behavior and verification requirements.

| Phase       | Retained outcome or purpose                             | Current guide                                |
| ----------- | ------------------------------------------------------- | -------------------------------------------- |
| 23.1        | Backup, restore order and recovery checks               | [Backup and restore](../backup-restore.md)   |
| 23.2        | Warn about local media on multiple production replicas  | [Storage](../storage.md)                     |
| 23.3        | A working first-plugin authoring path                   | [Plugin quickstart](../plugin-quickstart.md) |
| 23.4        | Verify revocation across application instances          | [Authentication](../authentication.md)       |
| 23.5        | Expose retained job failures and worker health          | [Jobs](../jobs.md)                           |
| 23.6–23.6.2 | Production browser coverage and the bugs it revealed    | [Testing](../testing.md)                     |
| 23.7–23.7.1 | Shared rate-limit contract and a separate Redis adapter | [Rate limiting](../rate-limiting.md)         |
| 23.8        | Exercise the package release and installation loop      | [Releasing](../releasing.md)                 |

## Dependencies

The plan used small sequential changes so operational feedback could inform
later work. First publication was separately gated by CI availability. Those
historical dependencies do not determine today's implementation or merge order.

## What's deliberately _not_ in Phase 23

Plugin isolation, stability promotion, a marketplace, shop and multi-site work
were outside this phase. That statement describes the original scope, not the
current availability of those features or a promised target version.

## Per-sub-phase notes

### 23.1 — Backup & restore docs

Recovery must account for both database and media, restore their dependencies
in order, and verify the restored site. Use the live backup procedure.

### 23.2 — LocalStorage production boot warning

Local filesystem media is not shared across replicas. Startup diagnostics
should make a deployment mismatch visible; a warning does not repair it.

### 23.3 — Plugin author quickstart

The authoring guide should take a real plugin through definition, registration
and execution. Hypothetical scaffold commands were removed in favor of the
supported quickstart.

### 23.4 — Multi-instance token revocation verify

The checkpoint verified database-backed invalidation rather than relying on
process-local token state. Current staff/member session and revocation
contracts are in the authentication guide.

### 23.5 — Stuck-job detector + admin surface

The original job counts and worker-health work was followed by a curated
recent-failures surface for Jobs, ops and Admin. Retained failures, heartbeat
age and queue observations have different meanings; use the Jobs and
operations contracts rather than treating any one signal as proof of a dead
worker or complete history.

### 23.6 — E2E coverage on golden paths

This phase introduced production-shaped Playwright coverage against PostgreSQL.
Authentication, publication and theme selection became the initial journeys.
The current testing guide owns fixtures, startup and required coverage.

### 23.6.1 — Bugs surfaced by attempting E2E (done)

The checks exposed block-editor reset loops from unstable input references and
server functions leaking into client collection configuration. Both reinforce
the same design rule: stable serialized editor state and explicit server/client
contracts are required independently of browser-test timing.

### 23.6.2 — E2E publish flow + theme switch (done)

The phase separated UI login checks from API sign-in used by unrelated tests.
Its hydration diagnosis, retry settings and temporary coverage deferrals were
checkpoint details, not enduring requirements or today's coverage limits.

### 23.7 — Multi-node rate-limit adapter (done)

The shared contract kept proxy callers independent of storage. A separate
Redis adapter package kept Core free of a mandatory Redis dependency.

### 23.7.1 — `@nexpress/rate-limiter-redis` reference adapter (done)

Atomic counter/expiry updates avoid a split increment-and-TTL race. A
caller-supplied client retains caller ownership, and namespaced keys allow
separate deployments to share Redis. The live rate-limit guide owns exact
constructor, window, key and shutdown semantics.

### 23.8 — First publish run

The first-publish checkpoint is historical. Follow the current release guide
and explicit authorization for the intended versions; this old plan grants
no permission to merge a Version PR or publish packages.
