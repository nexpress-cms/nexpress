# R6 shared Incident foundation

AP-600 provides durable shared records and bounded read capabilities. It does not
close R5's actual assistive-technology acceptance, complete R6, or install a
collector, model, worker, delivery adapter, or response action.

## Ownership and installation

`packages/core/src/db/schema/agent.ts` owns six additive tables: signals,
incidents, their join, incident timeline, notifications, and human feedback.
Generated migrations preserve the existing schema and historical SQL. The
site-deletion inventory and reference fence include the new records.

`agent-contract/incident-contract.ts` owns exact client-safe get/list inputs,
Incident projections and discovery schemas. `agent/incident-service.ts` reads
through the existing DB handle, with an optional admission transaction.
`createAgentCoreReadCapabilityExecutorsV1({ incidentService, ... })` explicitly
adds the two read executors; absent installation keeps the original three-read
registry. Gateway admission, audit and Runtime authorization retain their
existing owners. MCP exposes the exact get/list `query_incidents` selector only
when the corresponding capabilities are installed and visible.

The service requires a host `canReadIncident` domain-visibility owner. That owner
must check every retained subject and evidence target, including historical
attribution after detail expiry; returning true for an empty signal list is not
a general ACL implementation. Unknown owners must deny. Installation alone does
not supply collection, job, connection or security-domain visibility. The
callback receives safe retained facts, not credentials or raw event bodies.

## Read behavior

- All SQL is site-scoped. Current staff membership is checked before and after
  projection; category access uses existing moderation or administration
  permissions in addition to capability admission. Runtime reads require the
  admission-supplied effective resource ceiling, including Incident categories
  and referenced document collections.
- Signal evidence uses the existing `np.agent-signal-evidence.v1` canonical
  digest, recomputed from retained facts on reads. This exact domain does not
  include mutable severity, fingerprint or confidence fields. No second hash
  definition is invented. Malformed or mismatched evidence fails closed.
- Get returns the same unavailable result for missing, foreign, corrupt or
  hidden records. Output excludes signal bodies, timeline details, delivery
  destinations and feedback notes. Host visibility must return exactly true.
- List accepts exact status/category/severity filters, an optional updated-after
  instant, and a limit of 1–100. It scans one bounded page ordered by update time
  and UUID, filters before projection, and exposes no total count. A page can be
  empty with a continuation when scanned records are hidden.
- Opaque authenticated cursors expire after 15 minutes and bind the site,
  principal, live staff authority and complete query. Updating an Incident during
  pagination can move it to a later page; this is an incremental inventory, not
  a historical snapshot. A single Incident contains at most 100 retained signal
  IDs; larger records are unavailable rather than silently truncated.

## Persistence and lifecycle

The schema enforces same-site references, bounded enums/counts/times and one
active Incident per site/category/fingerprint. Terminal recurrence can create a
new record. Timeline sequence is unique per Incident and assessments require
provenance. Notifications retain the frozen external adapter/destination tuple;
Admin records cannot carry an external destination. Feedback corrections append
an attributed successor instead of changing policy or granting authority.

No public mutation service is added in this bundle. Future source owners must
validate exact timeline details, polymorphic logical references, source evidence
and state transitions when writing, and append feedback/timeline history rather
than updating prior evidence. Database shape checks do not prove detector
correctness, delivery, or model provenance by themselves.

Nullable shorter-lived references use RESTRICT to pin required evidence. This
bundle does not automatically prune these records or detach evidence. Future
retention owners must establish dependency-safe release before clearing those
references. Site deletion includes all six tables in dependency order; the join
retains its composite primary key and adds a unique UUID for the existing
bounded deletion inventory.

## Verification

Local acceptance completed on 2026-09-27 KST:

- `pnpm verify --concurrency=2`: 113 successful tasks, including 62 repository
  checks and 2,136 Core unit cases. The final run reused 107 successful tasks.
- `pnpm lint`: 41 successful tasks. A cache produced during an earlier partial
  dependency build was discarded; the final run used complete build output.
- PostgreSQL: 78 cases across the three new Incident suites and seven existing
  reference-fence, diagnostics, Runtime/ChangeSet retention and source-release
  suites, with no skipped cases. Gateway coverage includes absent installation,
  missing scope, successful persisted read evidence and revoked credentials.
- Migration chain: five checks passed after generating both new migrations.
  Snapshot comparison found exactly six added tables and zero modified existing
  tables; the historical V1 SQL byte check passed.
- Forty packed workspace packages were installed into a fresh project outside
  the monorepo. Its typecheck, generated migrations, actual migration application,
  production build and operational journey passed. The installed Core Agent entry
  and App migration entry matched the tested build bytes. Fresh Doctor checks
  found 49 Agent tables, 330 critical constraints and 15 deferred constraints,
  with default Runtime still disabled.
- Independent contract/service/capability review and final formatting/diff checks
  completed. Versions, changesets, lockfile and the pre-existing handoff change
  were preserved.

Logs: `/tmp/np-incident-verify-final.log`, `/tmp/np-incident-lint-confirm.log`,
`/tmp/np-incident-pg-confirm.log`, `/tmp/np-incident-migration-chain.log`, and
`/tmp/np-incident-scaffold.log`. These are local synthetic acceptance results,
not provider/delivery evidence or the full R5/R6 gate. No new Admin UI ships in
AP-600; actual screen-reader acceptance remains open.
