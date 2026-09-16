# R5 Runtime retention

This extends AP-508's explicitly host-registered `agent:retentionTick` and
site-stamped `agent:retentionPrune` jobs. It creates no worker, credential,
provider call, retention setting or automatic activation. The subsequent
source-release lifecycle adds the schema and generated migrations described
below.

## Retention and reference matrix

The matrix was defined before implementation against [data-model retention](data-model.md#9-retention).
Nominal age is necessary, never sufficient. The sweep holds the existing site
Runtime control/quota lock and fences site deletion. It does not authorize any
capability or infer an external outcome.

In this matrix, a retained reference keeps its source unless its exact owning
audit/read contract has handed it off to a verified source-release receipt.
Only the allowlisted historical paths below receive that exception; other
literal occurrences continue to pin the source.

| Owned data                                                                                                       | Eligibility                                                                                  | Evidence and dependency fences                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Normalized events                                                                                                | Dispatched and past persisted expiry                                                         | Any retained Agent row or audit reference, including nested private evidence, keeps the event. Pending events remain.                                                                                                                      |
| Optional provider diagnostic bodies                                                                              | Past the earlier of persisted diagnostic expiry and creation + 30 days                       | Only `request_redacted` and `response_redacted` clear. Digests, exact decision, classification, pricing, usage and all recovery facts remain, even for active/ambiguous calls. These optional projections are not canonical digest bodies. |
| Provider calls                                                                                                   | Known terminal outcome, finished at least 90 days ago, terminal parent Run                   | Unknown/ambiguous dispatch or usage, unfinished/unpriced reservation, retained retry descendants and every Agent/audit reference keep the row.                                                                                             |
| Usage reservations                                                                                               | Released or reconciled with known usage, finalized at least 90 days ago, terminal parent Run | A retained call or any Agent/audit reference keeps the reservation. Reserved/expired unknown rows remain.                                                                                                                                  |
| Runtime Runs                                                                                                     | Terminal for the verified effective run-detail lifetime (1–90 days), no lease or retry       | All retained Agent/audit references, descendants, actions, approvals, ChangeSets, previews, calls, reservations and causal events keep the Run. Gateway Runs are outside this owner.                                                       |
| Closed circuit breakers                                                                                          | Zero failures, no probe lease, unchanged for at least 90 days                                | Open, half-open, nonzero-failure and referenced evidence remain.                                                                                                                                                                           |
| Daily usage aggregates                                                                                           | Entire UTC usage day ended at least 400 days ago                                             | Unknown calls and any matching reservation keep the aggregate, so retained source details remain rebuildable.                                                                                                                              |
| Actions, approvals, ChangeSets, rollback/preview evidence, invocation/idempotency, auth/vault metadata and audit | Not deleted here                                                                             | Their existing owners and longer evidence lifetimes remain authoritative.                                                                                                                                                                  |

Run cleanup verifies the existing canonical execution/admission evidence and
resolves frozen policy sources together with current feature-setting and
active site/Agent policies through the existing policy resolver. It uses the
resulting `retentionDays.runDetails` (1–90 days). The Runtime host's framework
rules are retained in admission evidence; this maintenance entry does not
invent a new live framework source. Malformed evidence is retained while the
cursor advances. Provider calls/reservations retain their separate published
90-day-after-finalization minimum. Optional provider diagnostic expiry has its
own persisted deadline, and events carry their admitted expiry.

Shorter policy retention never overrides an evidence dependency. There is no
new retention setting, policy parser or authorization path.

## Bounded traversal and transaction behavior

The existing private UUID cursor now traverses the union of eligible identities
across the seven owned categories. Each call selects at most its requested
limit (default 50, maximum 100) of distinct UUIDs in ascending order. An identity
collision across tables is processed together before the cursor advances, so
no category can be skipped. A protected candidate still advances the cursor;
newly eligible lower identities are revisited when the existing job resets
its cursor at the end of a pass. Dependency children can therefore be removed
before their parent on a later pass without erasing references in place.

The existing `pruneAgentRuntimeEventsV1` internal name and exact
`{ examined, pruned, nextCursor }` result remain compatible with the job owner.
`examined` counts selected distinct identities. `pruned` counts deleted rows
and provider rows whose optional diagnostics were erased; it can exceed
`examined` when an identity occurs in multiple categories. No identifiers or
payloads are emitted in maintenance summaries.

Each source query applies its own cursor/order/limit before the final union.
Literal reference predicates still scan retained rows; output batching alone
is not an execution-cost bound. A maintenance-only transaction sets local
statement timeouts from a five-second deadline before taking the site lock,
respects an already stricter timeout, and refreshes the remaining budget
between query/policy phases. Success restores the caller's exact setting;
timeout or an elapsed deadline rolls back all pruning. Existing shared policy
helpers contain several bounded reads that share their phase's timeout, so
this is not a strict five-second maximum transaction duration. The deadline
is rechecked before another phase and before commit. No pool/global timeout
or ordinary request behavior changes. A timed-out batch reports failure and
keeps its old job cursor for retry; protected successful candidates advance.

Live `created|retry|active` pg-boss journal entries also fence their referenced
sources when the canonical journal exists; maintenance does not initialize it.

Every retained Agent table in the canonical site-owned inventory participates
in conservative same-site literal reference checks, as does normal audit.
False positives retain evidence. There is no generic nullable-reference
rewrite: clearing a reference without verifying its owning digest would
silently change historical attribution or invalidate canonical evidence.

## Remaining R5 acceptance boundary

The [evidence and source-reference lifecycle](r5-evidence-source-lifecycle-design.md)
implements typed source/edge receipts for verified terminal Runs, calls,
reservations and closed breakers. Exact recognized Runtime audit references
retain their original rows and evidence, while allowing the source detail to
expire. Verified terminal read Actions retain their fingerprint and canonical
input, with a receipt pointer replacing the live Run locator. Consumed Run
admission keys remain unavailable after deletion. A persisted global epoch and
reference-ingress guards prevent late writers from resurrecting references.

Unknown/global audit, malformed evidence, active work, mutation Actions,
approvals and rollback owners still pin their sources. There is no normal audit
pruning service. More than 100 matching owners in a single table conservatively
retain a source. Structured manual-input recipes remain outside this bundle;
this implementation does not claim full R5 retention or full R5 acceptance.
Guardian signals/incidents/containments/notifications are not fabricated.

## Verification

Focused source PostgreSQL verification exercises expiry boundaries, exact-site
isolation, pending/active/unknown preservation, nested audit references, bounded
cursor progress, duplicate identities, verified shorter policy retention,
malformed evidence, live job journals, optional diagnostic expiry with intact
provider response verification, call-before-reservation ordering and delayed
aggregate cleanup, plus real advisory-lock contention that cancels a query
and rolls back prior deletion.

The 2026-09-15 KST baseline passed all 9 Runtime maintenance and 4
provider/aggregate retention cases, plus the 3 maintenance and 2
statement-budget Core unit tests. Its broader results remain in
[the Runtime Studio gate](r5-runtime-studio-flow.md#r5-completion-audit-and-current-verification).
The source-release implementation extends this coverage with real canonical
read Action attribution, immutable receipts and audit edges, consumed-key
denial, malformed and oversized evidence, concurrent writers and live pg-boss
partition guards. The current full verification results and remaining product
boundaries are recorded in
[the source lifecycle evidence](r5-evidence-source-lifecycle-design.md#verification-evidence).
