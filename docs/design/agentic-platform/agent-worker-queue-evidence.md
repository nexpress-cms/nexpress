# Agent queue subscription observations

This extends [worker evidence](agent-worker-evidence.md) with per-queue visibility
in Health and Doctor. It does not establish required queue coverage, processing
progress, provider readiness, authority or complete R5 acceptance.

The follow-up [queue backlog observations](agent-queue-backlog-evidence.md) add
retained pg-boss counts and ages with independent availability and explicit limits.

## Contract and ownership

The existing exact `np.agent-worker-health.v1` aggregate and
`np.worker-subscription.v1` heartbeat metadata remain unchanged. The additive
`np.agent-worker-health.v2` read contract wraps that aggregate as `summary` and
contains one ordered row for each of the nine existing Agent queue names.
The compatibility v1 collector still returns only its original aggregate.

One bounded query supplies both views. It retains the most recent 100 heartbeats,
uses row 101 only to detect truncation, preserves the stale threshold and stable
ordering, and restores the original transaction-local statement timeout. Health
uses the initialized DB singleton; Doctor supplies its original connected Client.
No additional queue read, persisted write, worker startup or provider call occurs.

Each queue row contains observed worker counts:

| Count                 | Required evidence                                                                |
| --------------------- | -------------------------------------------------------------------------------- |
| Fresh subscriptions   | Fresh running heartbeat, active owner evidence, queue in confirmed subscriptions |
| Paused registrations  | Fresh paused owner evidence with the queue registered                            |
| Stale registrations   | Recognized stale heartbeat with the queue registered                             |
| Stopped registrations | Valid evidence and a heartbeat marked stopped, with the queue registered         |

A worker can contribute to more than one queue, so counts overlap across rows.
Every per-queue count is bounded by the corresponding aggregate category.
Subscribed and paused aggregate workers must contribute to at least one row;
stale/stopped workers can validly have no Agent queue registration.
Unknown, legacy, malformed, future-dated and incomplete lifecycle evidence is not
attributed to queues. Stale and stopped counts describe registrations, not current
subscriptions. A stop marker does not prove that in-flight work has drained.

Read failure returns unavailable aggregate evidence and null queue counts. A
successful empty sample returns observed zeros. Zero is only the absence of a
matching observation in that sample; unknown workers and workers outside the
sample may hold subscriptions. No required queue set is inferred from registrations.
The strict validator rejects extra/private fields, missing or reordered queue
rows, unsupported versions and contradictory counts.

## Shared presentation

Health and Doctor use the same validator, labels, formatter and limits. Health
uses named queue sections and responsive definition lists. Legacy v1 snapshots
still render the aggregate and explicitly say queue details are unavailable;
they do not manufacture queue zeros. Malformed evidence is contained without
rendering injected identities. Existing Doctor severity/check IDs remain unchanged.

## Verification

- Contract tests: 4 passed. Shared Health/Doctor/system-health focused tests:
  37 passed, including legacy v1 rendering and existing Doctor severity.
- PostgreSQL: 18 passed across worker-health, Runtime ops diagnostics and contract
  diagnostics. Existing fixtures cover distinct/overlapping queues, registered-only
  exclusion, unknown/future data, truncation, lock timeout and restoration, original
  Client ownership, privacy/no writes, and real heartbeat lifecycle/queue updates.
- Dependency-complete build: 41 tasks passed. Final `pnpm verify --concurrency=2`:
  113 tasks passed (62 cached), including Core 2,124 and App 586 unit tests. Redis
  opt-in units retain 13 passed / 3 skipped. The first default-concurrency attempt
  terminated with exit 137 in a typecheck; the bounded retry passed without test
  removal or timeout changes.
- Final lint: 41 tasks passed (39 cached). Production browser: 88/88 passed
  with no retries or skips.
- Six queue-region captures at 320/768/1280 in light/dark were visually inspected.
  They show the real observed empty sample, not synthetic live worker evidence.
  Mixed/unavailable/legacy rendering is covered by server-render tests and real
  PostgreSQL fixtures. No spoken assistive-technology result is claimed.
- Packed Core 438 and App 203 dist files, plus the four changed App runtime source
  files, match installed consumer bytes. Forty freshly packed packages supplied
  a new isolated scaffold: installation, typecheck, production build and the
  existing operational journey all passed. This does not repeat the complete
  extension/migration scaffold matrix.

Independent review confirmed v1 semantics and non-attribution of unknown evidence.
A presentation fixture initially contradicted the strengthened count contract;
its aggregate counts were corrected. Existing lifecycle, bounded-read and Health
browser fixtures were extended instead of adding a queue/state Cartesian matrix.
Logs and captures use `/tmp/np-queue-*`. Broader Redis, theme and native-preview
integration contracts are unchanged; this is not a fresh full R5 gate.
