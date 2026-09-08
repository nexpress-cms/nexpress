# R3 transaction and validation implementation review

Date: 2026-09-08. Scope: AP-303/AP-304, after PR #1429 (AP-301/AP-302).

## Implemented scope

Existing document, navigation, SEO, theme and media-reference services accept
an explicit caller transaction. Content writes continue through `saveDocument`;
navigation/theme Admin routes delegate to the same extracted domain services.
Nested post-commit callbacks join the parent queue and are discarded on rollback.
Navigation version CAS is enforced by the atomic upsert, including missing-row
races and PostgreSQL timestamp precision.

The existing ChangeSet service adds `validate`, `processValidation` and bounded
`reconcileValidations`. Validation admission reuses the existing exact Admin
idempotency/expectedVersion envelope or current Gateway admission, captures the
locked draft hash and increments one validation generation. Migration 0039 adds
one durable attempt table. Doctor and deletion share 23 tables and 101 critical
constraints. No package version, changeset or dependency change is included.

Each attempt retains the admitting invocation and its requester's immutable
authority context. Processing rechecks that session or service-family/OAuth-grant
with current site authority before and after protected reads. Credential family
rotation can preserve valid authority; revocation, version, audience, scope and
visibility loss fail closed. A stale generation cannot replace current results.
Small plans validate inline; larger plans remain queued for an explicitly
injected host notification and bounded recovery. No scheduler is installed.

Validation uses the same resource schemas, ACLs, settings/theme/navigation/media
contracts and a transaction snapshot. It detects stale bases, slug and reference
conflicts and aggregate create quota violations, then records bounded full before
snapshots, snapshot hashes, deterministic risk and an immutable canonical plan.
Rollback duration is frozen at successful sealing. Read projections verify the
stored plan/snapshot chain and return only the existing client-safe wire.

## Self-review corrections

- Reproduced two simultaneous navigation CAS writers both succeeding, then
  moved the precondition into the upsert. Exact millisecond tokens now advance
  even when an existing database timestamp has microseconds or is in the future.
- Rechecked current item visibility before resource validation so authority loss
  produces a failed attempt rather than publishing validation evidence.
- Retained transient transaction-conflict retry and durable queue recovery after
  enqueue failure. Rechecked expiry before both valid and invalid completion.
- Bound the principal invocation request schema to the server-side ChangeSet
  target while preserving the existing Admin input and create descriptor.
- Verified sealed parent, generation, draft, resource bases, operation ordering,
  snapshots, aggregate bounds and validation result digests on reads.
- Included ready plans in pre-execution expiry reconciliation while preserving
  their sealed evidence, and froze the complete apply scope floor including
  `changeset:apply` and document `content:publish`.
- Reproduced current-schema rejection for status-only document operations and
  confirmed the existing read conversion already fails closed. Removed a proposed
  duplicate parser and retained the PostgreSQL regression.
- Reused the document base strategy for media references on `timestamps:false`
  collections; owner-content changes still alter both semantic and snapshot hashes.
- Moved aggregate quota checks after all resource access checks to avoid exposing
  quota facts before target authorization.

## Verification

- `pnpm verify --concurrency=1`: all 113 build/typecheck/test tasks passed.
  Core unit tests: 165 files / 1,559 passed.
- Core PostgreSQL integration: 10 files / 67 passed.
- Full Web PostgreSQL integration: 114 files / 1,000 passed; five existing
  synchronous theme-render tests remain skipped.
- Focused validation lifecycle: 19 passed, including real OAuth grant
  issuance/revocation, ready expiry and sealed projection tampering.
- Latest focused resource PostgreSQL regression: 13 passed, including the
  existing current-schema rejection path; resource unit tests: 37 passed.
- Existing navigation/theme route regression: 24 passed.
- Runtime smoke: 25 script wrappers loaded; the three write-producing
  generation/setup wrappers are covered by their dedicated scaffold/setup tests.
- `pnpm lint`: all 41 tasks passed after refreshing the stale route lint cache.
- Changed-file formatting and `git diff --check` passed; package versions,
  dependency lockfile and changesets are unchanged.
- Playwright: all 47 Chromium/Admin flows passed against an isolated database
  (2.3 minutes). The generated upload was removed only after exact fixture-byte
  comparison; the isolated database was torn down.
- Packed fresh scaffold: 40 tarballs and all 53 stages passed, covering
  installation, typecheck, fresh migration generation/application, the
  23-table/101-critical-constraint/9-deferred-constraint disabled foundation,
  production build, extension matrix, first-run journey and lockfile invariance.
  Its isolated PostgreSQL database was removed.
- Secret scan: no environment-sensitive values in the diff/new files or logs;
  no packaged real `.env` or credential files. Six tarball string matches were
  existing test fixtures, byte-identical to both HEAD and the previous AP-301
  package. No new sensitive material was introduced.

The first whole-workspace run used concurrency 2 alongside PostgreSQL suites;
one typecheck process exited 137 after 95 successful tasks. The complete final
run was serialized and passed. A new test-only union narrowing error found by
typecheck was fixed before that final run. Build output regeneration also
invalidated cached typed lint results; the route lint cache is refreshed after
the stable build.

PR CI exposed a separate Core declaration-worker heap limit in all four jobs.
The deletion inventory now derives its name union from the existing order tuple
and types descriptor values using the existing common contract, avoiding repeated
full Drizzle declarations. Total declaration output fell from 2,070,970 to
1,583,104 bytes (23.6%). The existing eight-method ChangeSet service contract is
also explicit, with unchanged inputs, outputs and runtime behavior.

Local Node 24 completed at 4 GiB, but the second CI run still failed. Matching
CI's exact Node 22.23.2 reproduced the 4 GiB failure locally; the complete
ESM/declaration build passed at 5 GiB. The Core build script therefore defaults
to a bounded 5 GiB heap while preserving explicit `NODE_OPTIONS`. These are
build-script and type-only changes; versions and dependencies are unchanged.
The focused inventory/canonical unit suite (12), PostgreSQL persistence
regression (19), service factory suite (3), Core typecheck and ESLint passed.

Skipped: three live Redis tests because `TEST_REDIS_URL` is absent, and five
existing synchronous theme-render tests disabled after the async server-component
transition. Redis is unchanged; theme behavior is covered by the active route,
resource, transaction and browser regressions. No new validation test was skipped.

## Deliberate boundaries and remaining work

AP-305/AP-306 own the preview overlay and dedicated preview origin/artifact
lifecycle. AP-307 onward own preview checks, Admin views and MCP/API exposure.
Approval decisions and apply/verification/rollback remain R4 work. There are no
new transport routes, advertised tools, provider calls, automatic runtime or
worker, seeds, listener ports or default enablement in this slice.

`proposedAfterHash` commits normalized proposal intent; it does not fabricate
future database defaults or hook output. AP-402/AP-404 must compute and verify
actual persisted after-state. A document operation and a media-reference
operation can share an owner row; their later atomic executor must preserve
both operations' semantics. Validation never applies them.

Ready plans do not reserve resources or grant apply authority. Apply must
recheck current bases and authorization. The explicit validation processor
holds one bounded read transaction and its authority locks while sealing;
production hosts should choose their inline threshold and queue scheduling
according to workload. A failed notification remains recoverable through the
bounded queued-attempt processor. Future approval-bearing expiry continues to
belong to its lifecycle owner; pre-execution expiry remains explicit.

Implementation, self-review and verification were completed before the
separately authorized PR and squash-merge workflow.
