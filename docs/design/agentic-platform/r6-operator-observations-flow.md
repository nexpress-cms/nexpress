# R6 Operator operational observations

An explicitly installed Operator can inspect bounded Jobs and media-storage
observations and audit the running plugin registry through their actual owners.
This extends the [diagnostics flow](r6-operator-diagnostics-flow.md); approved
maintenance stays with the [execution owner](r6-operator-execution-flow.md).
No collector grants authority, repairs data or starts a provider or worker.

## Installation and authority

`npCreateAgentOperatorAppHostV1`, published at
`@nexpress/app/lib/agents/operator-host`, accepts optional `observationOwners`:

- `jobs: "pg-boss"` explicitly identifies the host's canonical queue source.
  Finding a table does not select a queue adapter automatically.
- `storage` supplies the installed adapter, a bounded `selectMedia(context,
maxTargets, collections)` callback and current `authorizeMedia` callback.
  The selector must honor the requested collection restriction and current
  media/referenced-item ACLs. An empty collection list permits the authorized
  site sample. Item IDs alone do not grant access.
- `plugins: true` enables registry audits. Current deployment permission is
  required before and after collection, at final return and on retained audit
  access. Existing deployment status also uses this bounded registry owner.

The host's existing `authorize` callback must grant current access to site
aggregate operational evidence, including retained results; media callbacks
add record and referenced-item checks during collection. Explicit custom
`scopedReaders`/`auditReaders` retain precedence and their existing ACL/evidence
responsibilities. New custom readers can report `targetCount` independently
of their number of evidence references; legacy readers retain that default.
Absent sources stay unavailable. Initialization remains the host's existing
`ensureFor` responsibility.

## Meaning and limits

| Family    | Actual source                                                | Bound and interpretation                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs      | Read-only canonical pg-boss rows                             | Newest retained 24-hour cohort, ten fixed framework queues, explicit matching `payload.siteId`, at most 1,000 rows and a 500 ms statement timeout. State counts and oldest due age describe that cohort, not throughput, all-time backlog or worker health. Global/custom/unattributed jobs are excluded.                       |
| Storage   | Existing media rows and `npStorageObjectExists`              | At most 100 selected records and 100 original/variant probes. Same-site ready rows and canonical record-owned keys only. Current authority and row versions are checked around probes and before release; changed observations are discarded. Completeness covers only the selected sample, not inventory or content integrity. |
| Plugins   | Existing in-process registry diagnostics                     | At most the remaining audit plugin budget, or 100 plugins for status. Oversized registries report unavailable coverage without running diagnostics. Results concern registration contracts, not plugin code security or external connectivity.                                                                                  |
| Backup    | Host-configured manifest directory                           | Status inspects at most 1,000 directory entries, 100 manifests and 64 KiB per manifest. Sequential capped reads reject oversized, malformed, symlink or special-file manifests. Recorded verification remains a manifest claim; status does not verify current artifacts or restore success.                                    |
| Readiness | Existing configuration and in-process collection diagnostics | Fixed configuration checks; no database, queue, network or external-service health claim.                                                                                                                                                                                                                                       |

Audit budgets count inspected Jobs rows, attempted storage probes (including
failed/discarded attempts), plugins and contract collections. Evidence strings
are not charged as targets. Partial observations never pass as complete.
Unsupported or failed Jobs observations retain unknown counts rather than
zero. Adapter errors and paths are not projected. In-flight storage requests
remain governed by the installed adapter's timeout; the existing Operator
execution timeout and abort checks cannot forcibly cancel arbitrary adapters.

## Retained evidence

The existing exact audit wire is unchanged. Concrete collectors write bounded,
fixed-format `observation:`, `basis:`, `coverage:`, `state:`, `complete:`,
`observed:`, `window-start:`, `queue:` and `fact:` tokens as applicable into
`checks[].evidenceRefs`. These are inline safe aggregate facts, retained in the
existing invocation output. The existing digest binds them to the site,
audit ID and exact request. Replay verifies that output and current authority.
They are not links to nonexistent snapshots; raw queue payloads, object keys,
plugin metadata and selected record versions are not persisted in this wire.
The private media result digest is not advertised as a retrievable artifact.
Existing invocation/audit references and retention remain responsible for the
receipt; no independent store, migration or purge job is introduced.

## Acceptance boundary

This supplies the bounded operational-source slice of AP-602. It does not
complete whole-site inventory, backup restore drills, custom queue support,
recipe setup or versioned usefulness evaluations. AP-602 and R6 remain open.
The existing browser/API output shapes and execution behavior are unchanged.

## Local verification (2026-09-30)

- `pnpm verify --concurrency=1`: all 113 tasks passed, including Core 2,194,
  App 660, Admin 174 and Web 174 unit tests and the reference production build.
- `pnpm lint`: all 41 tasks passed. Final repository checks passed 62 tests;
  modified-document links, formatting and `git diff --check` passed.
- PostgreSQL: all 13 cases in the new Jobs/media observation suites and existing
  Operator suite passed with an explicit isolated database. These cover actual
  pg-boss rows, canonical site attribution, bounds, timeout recovery, real media
  rows and variants, access revocation, concurrent row changes and retained
  Operator behavior. No PostgreSQL cases were skipped in this run.
- App tests use the actual plugin registry and diagnostic owner for registration
  failures, budget overflow and authority loss; real bounded manifest files
  demonstrate that recorded verification does not prove artifact existence.
- A fresh project outside the workspace installed all 40 packed public packages,
  imported the new Core functions and published App host, passed configuration-
  inclusive typechecking, generated/applied migrations to a fresh database,
  verified the Agent foundation (52 tables, 365 critical and 17 deferred
  constraints), and passed production build and the scaffold command journey.
  Installed Core Jobs/media and App host JavaScript/declaration bytes matched
  the verified producer files.

Redis integration (including three optional cases skipped by the ordinary unit
run), theme PostgreSQL, native preview and production browser suites were not
rerun for this server observation slice. The ordinary theme checks and packed
build do not substitute for those full acceptance gates. Versions, changesets,
lockfile, repository migrations and the pre-existing handoff edit were preserved.
