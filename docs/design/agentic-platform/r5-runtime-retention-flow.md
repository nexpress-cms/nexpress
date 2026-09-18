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
retain a source. Structured manual input now lives on its owning Run: execution-integrity checks
verify the stored payload against its admission-bound digest before source release.
The payload expires only with eligible Run deletion; it is absent from release
receipts, audit and Activity. Generic literal-reference scanning and ingress
fences include the new JSON column, so embedded IDs cannot evade existing
conservative dependency retention. Studio Run staff-audit targets and Admin invocation results now have explicit
release owners. After both Run policy retention and the invocation replay
deadline, an exact linked admission proof permits source Run/input deletion.
Audit and invocation bytes remain retained, including the consumed request key
and original result; a replay still returns that result without new execution. Structured
Admin request journals retain a digest rather than duplicating the input JSON.
Provider/Action-derived text follows its existing evidence owner. This does not
claim full R5 retention or full R5 acceptance.
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

## Studio admission reference matrix

| Reference                                                                                 | Release condition                                                                                                                                                                           | Retained evidence                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Studio staff audit target                                                                 | Same site and exact linked completed `agents.configurations.run` invocation, canonical request/auth/output/operation fingerprints, exact audit payload and Run admission key/config/trigger | Original audit row plus `studio-audit` / `audit-target` receipt                          |
| Admin invocation result ID and output `id`/`runId`                                        | Same verified triple; invocation deadline and Run policy retention elapsed                                                                                                                  | Full request/result and scoped key plus `admin-invocation` / `invocation-result` receipt |
| Other literals in either owner, unknown/global audit, mutation/approval/rollback evidence | No release owner                                                                                                                                                                            | Source remains pinned                                                                    |
| Staff identity FK metadata                                                                | Existing user deletion may null the staff FK and set its deletion timestamp; immutable canonical identity remains                                                                           | All other invocation bytes stay frozen                                                   |

The migration appends the Studio owner guard upgrade; it never rewrites the
shipped reference guard migration. Coverage checks require the upgraded function
bodies before cleanup can release any source. Late references and changes or
deletion of retained owners remain blocked by the global reference fence.

Activity detail links resolve an expired Run through its verified receipt and
current staff/retained Action ACL checks. They expose only historical identity,
terminal state and completion/release timestamps. They do not fabricate usage,
limits, source input or a live Run, and stop polling. Existing Run lists continue
to list live source rows; this bundle does not add archive pagination. Request
replay uses retained invocation evidence and does not re-admit a deleted Run.

## Studio source-expiration verification (2026-09-18)

The bundle merged in PR #1452 passed final `verify` (113 tasks),
including Core 2,015, Admin 151, App 557 and Web 174 unit tests, and workspace
lint (40 package tasks plus Web lint/scripts, using an 8 GiB Web heap).
Focused new/history units passed 63 cases; migration generation tests passed 5.
Final Web typecheck and the four-case history mock rerun also passed. Web test
files are excluded from the configured typed-lint project; a separate ad hoc
`--no-ignore` attempt could not load them. Their changed behavior was verified
through the PostgreSQL and browser reruns, with formatting checked separately.

PostgreSQL exercised Core 64 and Web 1,427 ordinary cases across the full run
and a corrected 42-case rerun of source-release, reference-fence and approval
resumption. Theme suites were included. The optional native preview case skipped
in the ordinary run was explicitly enabled and passed. Live Redis passed all 16.
Production browser coverage passed 73 cases across the full run and an 11-case
login/Activity rerun, including the expired detail and no-polling behavior.
Fresh packed scaffold passed 40 packages / 60 stages: installation, typecheck,
generated migrations, Agent foundation/Doctor, production build, seven extension
packages, five runtime script module-resolution probes and first-run journeys.
Runtime probes intentionally used an unreachable DB; expected DB failures were
accepted only after ruling out missing modules. Versions and lockfile stayed unchanged.

Self-review fixed the expired union's literal type inference and preserved the
shipped V1 migration bytes while appending V2. An initial fresh-worktree verify
ran a self-importing package test before its own build; building all 41 packages
first resolved it. Targeted DB testing found an existing Activity fixture updated
unrelated invocation deadlines; it now targets its own invocation.

The full PostgreSQL run had eight failed cases and one teardown failure: an
old deleted-Run 404 expectation, a maintenance statement timeout on the retained
33 MiB fixture, approval-resumption test timeouts followed by cleanup deadlocks,
and a reference-fence teardown timeout. The response expectation was updated
with an additional retained Action ACL-denial assertion. Running those three
files sequentially passed all 42 cases without changing time limits, production
budgets or the large fixture cardinalities. Full browser testing found an invalid
password test sharing the request quota with other specs; its test address is now
isolated and it asserts HTTP 401 before the error UI. Product rate limits remain
unchanged. All 11 login/Activity rerun cases passed.

PR CI `35293022348` passed all four checks on exact head
`8b11e8f6a412f6a27df571fbc5e0de6ef776e529`: typecheck/build/test, PostgreSQL,
Playwright and fresh scaffold. PR #1452 squash-merged as
`3132673bc0288fcbc6e06c535b3494cd3fe9ef33` on 2026-09-18.

These results cover this Studio source-expiration bundle. They do not establish
full R5 acceptance, universal source release or deletion of derived evidence.
