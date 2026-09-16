# R5 evidence and source-reference lifecycle

Status: implemented in the working tree; verification results are recorded below.
Baseline inspected: `71a0f5effd4f6ea2726fd5f438c4424621557890`, 2026-09-16 KST;
clean detached worktree at startup. Dependency PR #1448's merge matches local
HEAD. Its CI/Release results, nine superseded PR closures and zero open security
alerts are user-supplied handoff evidence, not rechecked by this document.
Version PR #1366 remains outside this work; its draft status is user-supplied.

The user subsequently authorized this coherent implementation, including schema
and generated migrations. Commits, PR creation and merge remain outside this
authorization. Own package versions and changesets remain deferred. No
Runtime/provider/worker activation, credentials, external provider calls or
publication are part of this bundle.

## 1. Decision and product boundary

Preserve normal audit records and canonical evidence unchanged,
while adding verified, typed **source-release receipts** for specific historical
references. A source can disappear only after its own retention deadline and
all remaining owners either release their exact reference or keep it pinned.
A receipt means “these facts were verified before detail removal”; it cannot
reconstruct a Run, authorize execution or prove an external outcome.

Reuse the [existing retention sweep](r5-runtime-retention-flow.md), its site
control transaction, cursor and timeout budget. Extend the owning admission,
usage, execution, breaker, capability and Activity services. Do not introduce a
parallel scheduler, generic audit pruning service or a second policy resolver.
The [Studio boundary](r5-runtime-studio-flow.md#remaining-boundary) and
[roadmap R5 gate](implementation-roadmap.md#r5--durable-provider-backed-agent-runtime)
remain open until the implementation and acceptance evidence below exist.

| Alternative                                                        | Benefit                                                        | Limitation / decision                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep every reference forever                                       | Current conservative behavior; no migration                    | Routine terminal detail never converges. Keep as fallback for unrecognized or invalid evidence.                                                                                       |
| Delete audit after a new TTL                                       | Eventually removes many dependencies                           | No current audit pruning owner or approved audit TTL; could remove mutation and replay evidence. Reject for this bundle.                                                              |
| Rewrite audit JSON / clear all nullable ids                        | Small apparent storage cost                                    | Can invalidate digests and attribution, erase unrecognized nested references and break replay. Reject.                                                                                |
| Retain miniature Run rows                                          | Leaves existing FKs and principal lookups intact               | Existing Run checks require execution/admission detail; another Run representation and widespread reader changes would be needed. Does not satisfy physical source release by itself. |
| Immutable audit plus typed receipts and narrowly detached locators | Retains material evidence and permits shorter detail lifetimes | New contracts, persistence, reference-ingress concurrency protection and read handling are necessary. Recommended, with fail-closed rollout.                                          |

The implementation unit is one coherent lifecycle bundle. The stages below are
internal ordering, not a request for small independent PRs. If the concurrency
or evidence proofs fail, retain sources and report the blocker; do not reduce
the acceptance boundary to the convenient subset.

## 2. Findings from the baseline implementation

Paths below are relative links to the actual inspected sources.

- [runtime-retention.ts](../../../packages/core/src/agent/runtime-retention.ts)
  scans every table in the canonical site-owned inventory, normal audit
  (same-site **or null-site**) and live `created|retry|active` pg-boss payloads
  using literal UUID occurrence. Even an unknown nested occurrence pins a row.
  Age filtering is not evidence validation. Run deletion additionally verifies
  canonical execution/admission and frozen/current effective retention policy.
- [runtime-admission.ts](../../../packages/core/src/agent/runtime-admission.ts)
  writes `agent.runtime.admitted`, with Run id in both target and payload.
  Its duplicate lookup uses live Runs keyed by site, runtime origin, principal
  and idempotency key. Removing a Run alone would allow a later request to
  create another Run for that key; a durable consumed-key record is required.
- [runtime-usage.ts](../../../packages/core/src/agent/runtime-usage.ts) writes
  `agent.runtime.usage`, targeting a call and carrying reservation id,
  response digest and transition. Reconciliation uses these records for replay.
  [runtime-execution-store.ts](../../../packages/core/src/agent/runtime-execution-store.ts)
  also writes `agent.runtime.execution` for Run transitions.
  [runtime-breakers.ts](../../../packages/core/src/agent/runtime-breakers.ts)
  writes `agent.runtime.breaker.observe-run`, `.observe` and `.probe`, targeting
  Runs, calls and breakers respectively. Admission/usage alone is not a complete
  allowlist. Breaker observations also use audit for replay.
- [audit schema](../../../packages/core/src/db/schema/community.ts) has a text
  target, arbitrary JSON payload and nullable site; it has no canonical digest
  or source FK. [recordAuditEvent](../../../packages/core/src/community/audit.ts)
  does not take the Runtime site lock. [site deletion](../../../packages/core/src/sites/registry.ts)
  deletes audit; no routine generic audit pruning service was found.
- [Action schema](../../../packages/core/src/db/schema/agent.ts),
  `np_agent_actions_attribution_check`, currently requires `run_id` and
  `run_fingerprint` to be null together. Its separate execution-invocation pair
  has the same equality rule and must remain unchanged in this proposal.
  [canonical-action.ts](../../../packages/core/src/agent-contract/canonical-action.ts)
  hashes `runFingerprint`, **not `runId`**. Preserving that fingerprint preserves
  the existing action canonical bytes; no action canonical v2 is necessary.
- [activity-service.ts](../../../packages/core/src/agent/activity-service.ts)
  falls back to invocation ownership when `runId` is absent. ChangeSet action
  visibility and [contract diagnostics](../../../packages/core/src/agent/contract-diagnostics.ts)
  require live Run/invocation bindings. Simply relaxing the SQL check is unsafe.
- Invocation authorization bodies and `authority_ref` retain Run ids even where
  the invocation's `run_id` is null (the Runtime read-capability path). Detaching
  only Action.run_id therefore does not release a normal read Run. The immutable
  authorization reference needs an explicitly verified historical-edge receipt.
- Events have composite causal FKs, including an Action's `(site_id, run_id, id)`.
  A retained causal event can prevent even an Action locator update. These FKs,
  descendant Runs, ChangeSets, approvals, previews and connection operations are
  independent fences; a receipt does not bypass them.

The [data-model retention section](data-model.md#9-retention) states intended
longer evidence lifetimes; it is not proof that all those pruning owners exist.
In particular, invocation `expires_at` can be the short request replay deadline.
Do not mistake it for the documented 90/365-day evidence deletion horizon.

## 3. Retention / reference matrix and ownership

All thresholds are necessary, not sufficient. “Release” below applies to a
specific edge; “delete” applies to a source after the entire closure is safe.
The release owner is part of the existing service, not a new authority.

| Data / reference                                                      | Minimum eligibility                                                                                                | Owner and retained facts                                                                                                                    | Blocking conditions / release rule                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime Run detail                                                    | Verified effective `runDetails` 1–90 days after terminal finish                                                    | Runtime admission/execution and maintenance; admission fingerprint, principal attribution and consumed idempotency scope survive in receipt | No lease/retry, active job, descendant or unfinalized usage. Every known edge verifies; every unknown edge pins. Gateway Runs excluded.                                                                                                          |
| Provider call                                                         | 90 days after finish; current code also requires parent terminal for 90 days and finalized reservation for 90 days | Usage/provider evidence owner; request/response digests, exact terminal classification, usage/cost sources and integer accounting facts     | Dispatch/usage/cost unknown, unpriced reservation, recovery need or retry descendants pin. Never convert unknown to zero.                                                                                                                        |
| Usage reservation                                                     | 90 days after released/reconciled finalization; same terminal-parent rule                                          | Usage owner; finalized amounts, pricing identity and UTC aggregate attribution                                                              | Retained call, audit edge without receipt, unknown/unpriced accounting or active reconciliation pins. Call goes first.                                                                                                                           |
| Optional provider diagnostic bodies                                   | Earlier persisted diagnostic expiry or creation + 30 days, when expiry exists                                      | Existing retention owner clears only `request_redacted` / `response_redacted`                                                               | Canonical request/response proof, exact decisions and recovery fields stay; independent of source release, including active calls.                                                                                                               |
| Normalized event                                                      | Dispatched and persisted expiry reached (current admission caps at 14 days)                                        | Event owner; canonical envelope and causation remain immutable while needed                                                                 | Pending dispatch, Run admission/causal closure, live job or unknown audit reference pins. Delete after dependent rows, never null causal FK fields ad hoc.                                                                                       |
| Closed breaker                                                        | Unchanged 90 days; zero failures and no probe lease                                                                | Breaker owner; verified `.probe` audit edge can become historical                                                                           | Open/half-open/nonzero-failure state pins. Historical observation audit remains for replay.                                                                                                                                                      |
| Daily usage aggregate                                                 | Entire UTC day ended at least 400 days ago                                                                         | Usage owner; accounting source, not evidence inferred from text                                                                             | Unknown calls or any matching retained reservation pins. Receipts must not be reapplied as accounting deltas.                                                                                                                                    |
| Normal audit                                                          | No new TTL or deletion policy                                                                                      | Existing normal audit owner plus per-producer verifier                                                                                      | Original row preserved. Only exact allowlisted source occurrences cease to pin. Other fields and occurrences still pin; null-site audit never gets an inferred site/release.                                                                     |
| Runtime read Action and invocation historical Run edge                | Parent Run eligible; Action terminal; invocation completed/failed; no replay/execution need                        | Capability owner verifies Action input hash, invocation request/auth digests, principal and Run binding                                     | Only proven `domain.read` path initially. Preserve Action and invocation evidence; detach Action locator, retain fingerprint; attest exact immutable authorization paths. Short invocation expiry alone is insufficient.                         |
| Mutation Action, ChangeSet, approval, execution and rollback evidence | Documented evidence horizon 365 days; dependency closure may be longer                                             | Existing ChangeSet/approval/capability owners                                                                                               | Unconsumed approval, scheduled/applying/verifying/rolling-back work, unresolved outcome or active containment pins. Initial bundle does not detach these Run edges. New owner-specific release requires its own complete proof, not elapsed age. |
| Preview objects / evidence                                            | Objects at most 7 days; metadata/upload evidence normally 365 days                                                 | Existing preview/artifact owner                                                                                                             | Object deletion and authoritative absence precede metadata cleanup. Unknown uploads, tokens + skew, live render/capture, last required snapshots pin. Runtime sweep does not perform storage I/O.                                                |
| MCP tasks / mutation idempotency / auth-vault / connection operations | Respective existing owner horizon; task actual TTL; mutation evidence normally 365 days                            | Existing task, admission, vault and connection owners                                                                                       | Do not borrow Runtime TTL. Working tasks, refresh operations, credentials or replay obligations remain protected. No generic locator rewrite.                                                                                                    |
| Proposed source/edge receipts                                         | As long as retained referring evidence; consumed Runtime keys until site deletion in v1                            | Runtime evidence owner, with audit/Action/usage verifiers                                                                                   | No routine receipt pruning in v1. Keep minimal records, never raw prompts/provider bodies. This explicit storage tradeoff prevents key reuse and late reference resurrection.                                                                    |
| Guardian records                                                      | No fabricated implementation                                                                                       | Future R7 owners                                                                                                                            | Any actual retained literal reference pins; no invented signals/incidents/containments/notifications to satisfy R5.                                                                                                                              |

Retaining a source because a still-needed mutation/approval/rollback owner names
it is correct behavior, not failed cleanup. Conversely, a routine terminal
provider-only Run and a completed read-action Run must eventually converge
without deleting audit. Both are mandatory acceptance journeys. Retained mutation
source release beyond this allowlist stays an explicit follow-up boundary; do
not claim universal evidence compaction or all-platform retention completion.

## 4. Exact receipt and attribution contracts

### 4.1 New private persistence, with pure validators

The authoritative schema adds three tables, all named with `np_`:

1. `np_agent_source_releases`: UUID `id`; non-null `site_id`; exact `source_kind`
   (`runtime-run`, `provider-call`, `usage-reservation`, `circuit-breaker`);
   UUID `source_id`; canonical v1 `evidence_body`; canonical `evidence_digest`;
   `released_at`. Unique `(site_id, source_kind, source_id)` and
   `(site_id, id)`. Same-site/site-delete protection is required, but **no FK to
   the deleted source**. Run records additionally have typed `principal_id` and
   `admission_key_digest` columns, populated only for Runs, and a partial unique
   `(site_id, principal_id, admission_key_digest)` index. The key digest uses a
   new domain-separated canonical tuple of the current admission key scope;
   do not retain the raw key or use ambiguous concatenation. A digest collision
   must deny reuse, never admit.
2. `np_agent_source_release_edges`: UUID `id`; `site_id`; `source_release_id`;
   exact `owner_kind` (`runtime-audit`, `read-action`, `read-invocation`);
   `owner_id`; fixed `edge_code`; canonical `owner_evidence_digest`;
   `verifier_version` fixed to 1; `released_at`. Unique
   `(site_id, source_release_id, owner_kind, owner_id, edge_code)`. Same-site FK
   to release, restrict deletion. Fixed edge codes map to reviewed paths; no
   user-supplied JSONPath, wildcard, SQL or arbitrary verifier names. Audit has
   no same-site composite key today: the writer must lock/check its exact site;
   null-site owners are ineligible. Owner ids are logical retained identities,
   not polymorphic unchecked deletion authority.
3. `np_agent_reference_fence`: one framework-global singleton row with fixed
   id and monotonically increasing epoch. This is coordination, not site data;
   exclude it from site transfer/deletion inventories. It must not authorize
   Runtime or initialize pg-boss. Its locking protocol is specified below.

Use a new purpose such as `np.agent-source-release.v1`, registered with the
existing canonical purpose/size infrastructure. The body is a bounded exact
union (ceiling 16 KiB, reject overflow, never truncate). Each variant
contains site/source identity, terminal timestamps, the verifier version and
only the relevant facts:

- Run: principal/Agent/version identities, admission, limits and budget digests, verified execution-state facts,
  terminal state, consumed-key digest and the retention deadline computed from
  the verified effective policy. No goal, context, prompt, authorization
  credential or claim.
- Call: request/response digests, Run admission fingerprint, reservation
  identity, exact outcome/dispatch classification and usage/cost provenance.
- Reservation: final state/time, source pricing fingerprint, exact integer
  amounts and aggregate key/day; not a mutable replacement accounting ledger.
- Breaker: scope identity, version, closed state and zero-failure/probe facts.

No existing source digest is relabeled as the new receipt digest. Verify the
original owning canonical body while it exists, then hash the explicit receipt
facts. After removal the receipt verifies its own integrity and attribution;
it does **not** enable independent re-verification of deleted canonical input.
Audit evidence that needs that original body continues to pin it.

For audit, define a new digest of the exact stable source-evidence projection
`id, siteId, actorKind, action, targetType, targetId, payload, createdAt`.
Do not claim audit had this digest before migration or that observing and
hashing a legacy row retrospectively authenticates its history. Actor user/member columns
stay untouched and never become receipt authority. Changes to any included
field invalidate a receipt; receipt-bound source-evidence fields become
immutable through the write guard. Unknown versions/extra keys pin the source.

### 4.2 Action and invocation handling

Replace only the Run part of `np_agent_actions_attribution_check` with
`run_id IS NULL OR run_fingerprint IS NOT NULL`; retain the existing
execution-invocation equality. Add nullable `run_source_release_id` to Actions
with a same-site composite FK to `np_agent_source_releases` and checks for:

- live: Run id + fingerprint present, release id absent;
- never Run-attributed: all three absent;
- released: Run id absent, fingerprint + release id present.

The owner additionally verifies receipt kind, original Run, principal, exact
fingerprint and Action input hash. SQL cannot replace these cross-row proofs.
For the Action edge, `owner_evidence_digest` binds its existing canonical input
hash plus immutable identity/invocation attribution, not a pre-update whole-row
hash. The receipt records the original Run identity; the verifier checks the
live-to-released transition and the post-update null locator + receipt pointer.
Thus detachment does not invalidate its own proof. Invocation edge digests bind
the immutable request/auth bodies and stable identity, not mutable result fields.
Do not clear `run_fingerprint`, recompute Action hashes, or change canonical
`np.agent-action.v1`. The receipt pointer is persistence metadata, not part of
that canonical body. Keep the Run FK `RESTRICT` for live references.

Runtime read invocations keep canonical authorization/request bodies unchanged.
Verify the request digest, authorization-context digest, principal, runtime
transport and exact Run authority reference. An edge receipt covers only
`authority_ref.runId` and the corresponding canonical authorization body path
when proven equal. Both the Action and Invocation also retain the owning
capability service's exact `runtime:<Run UUID>:<Action sequence>` idempotency
key. Verify both keys against the original Run and canonical Action sequence,
bind them into their edge evidence digests, and exempt only those two stored
key paths. Mismatched Run, sequence, suffix or additional literal occurrences
still pin the source. The keys are never rewritten. If a `run_id`
or other execution result pointer also exists, require a separately enumerated
owner proof or retain the Run; do not silently clear it.

Activity must distinguish released Run attribution from a never-attributed
Action. Resolve principal from the verified release + retained invocation,
then apply the same current staff/principal/item ACLs and redaction. Never use
`runId === null` alone as permission for the existing fallback. If the minimal
receipt and retained invocation cannot establish visibility, return unavailable.
Expose only the existing safe nullable Run projection/expired evidence state;
no private receipt bodies in Admin, HTTP, CLI, MCP or OpenAPI. If a new public
release marker is later needed, version that wire contract explicitly rather
than adding an unvalidated optional field. Execution paths continue to require
a live verified Run and claim; released history is never executable.

### 4.3 Exact initial audit edges and idempotency

| Producer action                     | Releaseable occurrences                                                  | Mandatory verifier facts                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent.runtime.admitted`            | `target_id`, `payload.runId`                                             | Exact action/target/schema shape; same Run and admission fingerprint; actor fingerprint matches verified admission authority                     |
| `agent.runtime.job_admitted`        | `target_id`                                                              | Exact empty quota-admission payload, same verified Runtime Run, created no earlier than the Run; preserve the once-per-Run enqueue quota receipt |
| `agent.runtime.execution`           | `target_id`                                                              | Valid from/to state and attempt envelope; same Run; historical transition audit is retained, not claimed to be a replayable full execution proof |
| `agent.runtime.usage`               | `target_id` for call; `payload.reservationId` separately for reservation | Exact known transition, response digest and safe outcome; source call/reservation integrity and finalized accounting                             |
| `agent.runtime.breaker.observe-run` | `target_id`                                                              | Admission fingerprint and valid observation state; retain original replay evidence                                                               |
| `agent.runtime.breaker.observe`     | `target_id`                                                              | Call response digest and valid observation state                                                                                                 |
| `agent.runtime.breaker.probe`       | `target_id`                                                              | Valid version/state transition and final closed breaker evidence                                                                                 |

Use exact persisted producer shapes, including optional fields where the
writer actually emits them. Do not infer a missing schemaVersion for older
unversioned audit. An envelope verifier can validate those known shapes under
its own v1 rule. Every other audit action, global audit or extra literal
occurrence remains a hard fence. Receipt exemption is per occurrence, not
“ignore this row” or “ignore all Runtime audit”.

Admission must check both live Runs and consumed-key releases under the same
site lock and current authority checks. A consumed key returns a safe existing
conflict/unavailable envelope without creating a Run, enqueuing work or returning
a false live replay. Preserve the current `{runId, replayed}` success shape;
no tombstone masquerading as success. Studio retry handling must retain that
safe distinction. Usage settlement and breaker replay keep their existing
live-source requirements: after deletion they fail unavailable, never recreate
sources, repeat accounting deltas or update breaker counters from a receipt.

## 5. Deletion transaction and concurrency proof

A site quota lock alone does not fence arbitrary audit insertion. Recommend a
DB-enforced shared reference barrier using the singleton fence row, rather than
relying on every caller remembering an advisory lock.

1. Reference-ingress writes acquire `SELECT ... FOR SHARE` on the singleton
   before changing reference-bearing data. Acquire the barrier in a
   `BEFORE STATEMENT` guard and validate individual changes in row guards, not
   only after an UPDATE has locked its rows. A missing, duplicate or malformed
   singleton is an error, never evidence that the lock was acquired. DB guards
   cover normal audit and
   every ordinary Agent table in the canonical inventory, including direct SQL.
   Reuse owner transaction seams to take this early where practical. Guards
   validate incoming UUID references against release records: new references
   to already removed sources are rejected; existing unchanged historical
   occurrences are permitted only with their exact matching edge receipts.
   New rows may not reuse a released source identity. This is not a capability
   grant and must not inspect or log raw payloads in errors.
2. Maintenance takes the existing site control lock and deletion fence, then
   tries `FOR UPDATE NOWAIT` on the singleton. If another writer holds it,
   rollback/defer with unchanged cursor; do not wait holding the site lock.
   Once acquired, increment the epoch in the same transaction. This prevents
   a waiting writer on an older repeatable-read/serializable snapshot from
   proceeding with a stale “no receipt” result: the changed locked row must
   force a serialization retry. For READ COMMITTED, the guard's receipt query
   must use a fresh snapshot after the barrier acquisition (including a
   VOLATILE trigger function and a separate post-lock query).
3. Under that fence, select bounded candidates; lock sources and known owners
   in deterministic table/id order with `NOWAIT`; defer on contention. This also
   handles a caller that took row locks before entering a reference-write
   statement: maintenance must not hold the exclusive fence while waiting for
   that caller. Verify canonical evidence, deadlines,
   activity, current policy and reference closure. Recheck immutable digests
   and expected state/version in mutation predicates. Missing/changed/unknown
   evidence retains the source, with safe diagnostic reason counts.
4. Create the source record and exact edge receipts; detach only approved
   Action locators with CAS; apply the literal reference predicate again with
   only verified historical occurrences excluded; delete eligible sources.
   Insert receipts only for sources actually deleted in that transaction. If
   any dependency remains, retain both the source and its live locator state.
   Savepoints may isolate one candidate; timeout/deadlock aborts the batch.
5. Commit all receipts, detachments, deletes and epoch together. A crash before
   commit leaves the prior state; a crash afterward finds the unique receipt
   and cannot repeat deletion/accounting. The job cursor commits only after
   the service succeeds. Site deletion removes site receipts in dependency
   order, with an explicitly verified deletion context; guards must not turn
   ordinary retention into a bypass for site deletion.

The pg-boss journal also needs this guarantee: install the same reference-ingress
barrier on `pgboss.job` only when that journal exists, through the existing job
adapter lifecycle, including first later creation/upgrade. Do not create a
journal from maintenance. If a present journal lacks the verified guard, source
release fails closed (ordinary diagnostic expiry can remain independent).
Live job payload references always pin; completed historical jobs do not gain
permission to enqueue or resurrect released sources. Test the real adapter,
not just an application enqueue mock.

The shared-row protocol is implemented by generated PostgreSQL functions and
triggers. Its real-database acceptance tests must demonstrate
fresh visibility in trigger functions, RR/serializable retry behavior, and no
site-lock inversion before any deletion is enabled. Merely putting a blocking
advisory lock in an INSERT trigger is insufficient. Include same-site, other-site
and null-site writers, multi-row statements, and transactions that already hold
Runtime locks. Preserve existing stronger isolation requirements in capability
admission; do not downgrade them to make the proof easier.

This global barrier is intentionally conservative and has a material cost:
new reference writes can wait during a successful cleanup transaction, and busy
sites may defer cleanup. Keep the existing five-second maintenance statement
budget, stricter caller timeout preservation and bounded candidates (default 50,
max 100). This budget is not a strict five-second transaction-duration promise.
Measure contention before rollout; if it violates ordinary CMS availability,
keep release disabled and redesign the fence. Site-partitioned optimization
requires a separate proof for null-site/global references. No unbounded
transitive traversal, all-row backfill transaction or provider/storage I/O while
holding these locks.

The reference scanner must still scan unknown retained data conservatively.
For a known owner, mask only its verified edge-code paths in a temporary
inspection projection, never in persisted JSON; scan the remaining projection
for the source UUID. Receipt tables' own historical identities need fixed validator-backed
classification: source identity, original Run identity and a Call receipt's
reservation identity are historical digest-bound facts, not live source edges.
The registry recognizes only these exact per-variant fields after validating the
receipt body/columns/digest; all extra occurrences still pin. This avoids both
self-pinning and a Call receipt pinning its reservation forever. Arbitrary added
fields, wrong site/digest, duplicate paths and substring occurrences outside the
allowlist all pin. A changed owner cannot silently retain an old exemption.

Call/reservation cleanup must also work across passes. Before deleting a Call,
its verifier attests the exact reservation identity, finalization facts and
response digest in the Call release body. A later reservation verifier combines
that immutable validated Call receipt with the still-retained usage audit and
live reservation to check identity, digest, transition and accounting equality.
It does not attempt to reconstruct the deleted Call or infer a new provider
outcome. If those bounded facts cannot prove the required equality, retain the
Call in the earlier pass instead. Test a crash/restart between these two passes;
no plan may require a source body after deliberately deleting it.
Current ordinary Runs do not persist provider-call identities in `result` or
`usage`; no new Run-JSON exemption is needed. A legacy/future literal call id in
those fields remains a blocker, including cycles. Add a deliberate cyclic
fixture to prove cleanup does not broadly suppress Run-to-Call references.

## 6. Exact implementation and migration surface

One coordinator owns shared contracts/schema and generated migration artifacts.
Domain owners supply verifier requirements before downstream code changes.

| Owner / surface                | Required implementation scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core pure contracts            | Add exact source/edge receipt union, edge-code registry, digest purpose/size rules and negative tests under `agent-contract/`; extend purpose registry/types, keep browser-safe exports. Existing Action canonical bytes stay v1.                                                                                                                                                                                                                                                                                                                    |
| Core schema                    | `db/schema/agent.ts`: two site-owned release tables, Action pointer/check/FK and global fence table. Keep live source FKs and all execution-invocation constraints. No source table renames or blanket `SET NULL` migration.                                                                                                                                                                                                                                                                                                                         |
| Reference-ingress DB ownership | Reviewed guard function/triggers for audit, canonical ordinary Agent inventory and existing/future pg-boss journal; fence row seeding. Audit column layout and payloads unchanged. Trigger installation/version is part of Doctor, not best effort.                                                                                                                                                                                                                                                                                                  |
| Runtime lifecycle              | `runtime-retention.ts`, `runtime-maintenance.ts`, `runtime-retention-budget.ts`, `runtime-jobs.ts`: verified edge resolution, all-or-nothing source release, bounded traversal, safe defer/error behavior. Preserve exact public maintenance `{examined, pruned, nextCursor}` meaning; receipt inserts do not inflate `pruned`.                                                                                                                                                                                                                      |
| Source verifiers / replay      | `runtime-admission.ts`, `runtime-execution-store.ts`, `runtime-provider-evidence.ts`, `runtime-usage.ts`, `runtime-breakers.ts`, `capability-admission.ts`: reuse existing digest/state/authority verifiers, consumed-key guard, no execution from receipts.                                                                                                                                                                                                                                                                                         |
| History and diagnostics        | `activity-service.ts`, `contract-diagnostics.ts` and associated tests: released vs live attribution, same current ACL/redaction, receipt corruption and missing guard diagnostics. No new Activity mutation endpoint.                                                                                                                                                                                                                                                                                                                                |
| Deletion / transfer / jobs     | `site-deletion.ts`, `sites/registry.ts`, existing transfer exclusions and job adapter lifecycle: add two site tables to inventory; delete edge receipts before Actions, then Actions before source-release rows because Actions reference them; source releases precede principal/site removal. Preserve the rest of the existing dependency order and exclude the global fence from site ownership. Update frozen inventory contracts/fixtures deliberately; in-flight deletion plans must conflict/replan safely, never reinterpret an old digest. |
| Reference/scaffold propagation | Generate reference schema/migrations through existing commands; propagate scaffold through the existing synchronization pipeline; update schema readiness/Doctor and packed foundation assertions, migration snapshots/journal and inventory counts from actual generated output.                                                                                                                                                                                                                                                                    |

Generate additive schema changes from source (`pnpm db:generate` / existing
package generation flow), inspect SQL and add custom lifecycle SQL through the
repository's reviewed migration path as needed for triggers/guards. Do not
hand-edit generated collection schema, `next-env.d.ts`, historical migrations
or guess the next migration number. No destructive backfill, no audit rewrite,
no Action hash rewrite, no provider body copy, no changeset/version edits.

Required migration checks include exact constraints and indexes above,
canonical body/column agreement, source-kind/key-column nullability, same-site
receipt FK, singleton cardinality, trigger coverage/version, safe sequence of
Action-check replacement and validation, and fresh install vs upgrade parity.
There is no generic audit TTL setting, new principal authority, provider adapter
or automatic worker registration in this scope.

## 7. Existing data, rollout and recovery

1. **Inventory without release.** Count by source kind, age, blocking owner and
   malformed evidence; output counts/reason codes only. Record estimated receipt
   size and global-fence contention. Compare the baseline audit count/digests and
   action hashes without exporting payloads. No externally supplied identities
   or audit prose become source facts.
2. **Expand/read compatibility first.** Deploy readers that understand receipts
   and live rows; apply reviewed additive schema and guard migration with source
   release still unavailable. Verify backup/restore, migration status, Doctor,
   disabled Runtime defaults and unchanged existing canonical hashes. Mixed
   binaries must be drained before release: an old admission writer must not
   bypass consumed-key checks or encounter a detached Action it cannot read.
3. **Lazy verification of legacy rows.** No eager “expired therefore released”
   backfill. A batch verifies source and all eligible owner rows still present,
   including old known unversioned audit envelopes. Missing source proof,
   unsupported shapes, inconsistent fingerprints or policy resolution failures
   remain live and produce a safe diagnostic. Never fabricate missing receipts
   for already absent sources from an audit summary alone.
4. **Explicit maintenance rollout.** Run the acceptance journeys in disposable
   databases, then require separately authorized host rollout of the existing
   maintenance owner. No new on-by-default setting or worker. Start with bounded
   batches, observe contention and retained-reason counts, and verify ordinary
   CMS availability. Run claims/provider calls remain disabled unless separately
   configured by the host.
5. **Recovery before commit.** Timeout, lost lock, digest mismatch, FK conflict,
   deletion-saga activity or ambiguous outcome rolls back the affected release;
   batch failure preserves its cursor. Retrying cannot mint multiple receipts.
6. **Recovery after commit.** Stop source release if corruption is found; keep
   ordinary reads fail-closed for affected history and diagnose safe counts.
   Prefer a forward fix. Deleted canonical detail cannot be rebuilt from a
   digest; restore it only from a verified backup under an independently
   approved restore plan. Do not reset receipt keys to run the work again.
   Application downgrade is allowed only to a reader compatible with detached
   records; otherwise retain the schema and forward-fix. Never down-migrate by
   dropping receipts, refilling guessed ids, clearing fingerprints or deleting
   audit to satisfy an old constraint.

Receipt cardinality is intentionally not TTL-bounded in v1, just as normal
audit currently has no pruning owner. This exchanges large raw detail for
small durable attribution/idempotency facts. Monitor that growth; a later
receipt/audit pruning policy needs explicit ownership and its own evidence and
replay horizon, not a hidden TTL in this implementation.

## 8. Implementation sequence and acceptance plan

All results in this section are **future required evidence**, not tests run for
this documentation bundle. Historical counts in the Studio flow are checkpoints,
not acceptance for a new schema or lifecycle implementation.

1. Freeze receipt, attribution, consumed-key and edge-code contracts and exact
   DB scope. Review the shared ownership boundary, retention matrix and safe
   error behavior together. Prove the reference barrier with real concurrent
   PostgreSQL sessions before implementing destructive behavior.
2. Add compatible readers, pure verifiers, additive persistence and reviewed
   guard migrations; extend Doctor, deletion inventory and scaffold parity.
   Check migration from populated pre-change data as well as fresh databases.
3. Implement source release in the existing maintenance transaction and exact
   read-action detachment with receipts; add admission consumed-key rejection
   and preserve usage/breaker replay semantics. Initial unsupported owner edges
   remain visible blockers, not silent success.
4. Exercise one complete provider-only and one complete read-action lifecycle
   using real admission/execution/settlement services with deterministic injected
   adapters. Assert actual emitted audit rows, terminal sources, expiry, receipts,
   physical detail deletion, retained audit/hash equality, Activity visibility
   and rejection of late key/job/settlement replay. Fixtures that omit ordinary
   audit are insufficient acceptance.
5. Complete the full gates below, self-review, inspect generated SQL and record
   unresolved blockers. Only then propose the one coherent implementation bundle
   for the user's separately authorized commit/PR/merge workflow.

### Focused acceptance assertions

- Boundary times immediately before/at/after every expiry, 1/90-day policies,
  finalization-based 90-day floors, UTC-day 400-day edge, parent-terminal floor,
  optional diagnostic expiry and pending-event preservation.
- Active/queued/waiting-approval/retry Runs; leases/probes; unfinished/unpriced
  reservations; unknown dispatch/usage/cost; active rollback and last snapshot;
  all remain protected. Required approval/audit facts are never substituted by
  a receipt. Existing snapshots remain canonical even after rollback permission
  expires; do not offer rollback merely because a body remains stored.
- Three Action attribution states; malformed/null-pair/receipt mismatch and
  cross-site links fail. Input hash is byte-for-byte unchanged after detachment.
  Runtime read invocation authorization bytes remain unchanged. Mutation and
  causal-FK paths remain pinned; Activity never falls back to a different owner.
- Extra nested audit UUIDs, null-site audit, future audit kinds, wrong hashes,
  malformed versions, same UUID in multiple tables and unexpected receipt fields
  all preserve evidence. Verify masking is occurrence-specific and receipts
  cannot themselves create an exemption for another owner.
- Real writer-before-cleaner and cleaner-before-writer races for audit, Actions,
  invocations, events and pg-boss. Include null-site inserts, site deletion,
  RR/serializable snapshots, multi-row writes, direct SQL and late blocked
  insertion. No dangling new reference after commit. Force NOWAIT contention,
  statement timeout, deadlock and crash/retry; verify rollback, unchanged cursor
  on failure and advancement past protected candidates on successful batches.
- Admission key reuse after source deletion never creates a new Run or job.
  Same key with changed input/authority never obtains history without current
  authorization. Late usage/breaker calls cannot recount costs or observations.
- Caller timeout restoration, maximum batch size, full-cursor wrap, per-category
  progress, receipt uniqueness, missing guard/journal fail-closed behavior and
  aggregate rebuild from retained source rows. No payload/credential leakage in
  errors, counters, diagnostics or Activity.
- Upgrade/fresh migration parity; constraint/trigger tamper Doctor findings;
  populated legacy rows remain readable; verified backup restore retains receipt
  and consumed-key state; site A deletion and transfer do not affect B/global
  fence, and in-flight deletion plans cannot silently omit the new tables.

### Required software and full R5 gates

Follow [testing guidance](../../testing.md); build changed dependencies before
consumer tests because libraries load `dist/`. Use Node >=20.19 and pnpm 10.33.
Never test against partially written builds or count skipped suites as passed.

| Gate                                 | Required execution / evidence                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure contracts and repository checks | Exact/negative digest, Action attribution, edge parser and consumed-key cases; canonical-purpose inventory and browser-safe exports; `pnpm test:repo`.                                                                                                                                                                              |
| Focused PostgreSQL                   | Extend `agent-runtime-retention`, `agent-runtime-maintenance`, `agent-runtime-persistence`, `agent-contract-diagnostics`, capability/Activity and replay suites under `apps/web/tests/`; add real source-release and concurrency cases above. Set `TEST_DATABASE_URL` to an isolated migrated DB.                                   |
| Full PostgreSQL + theme              | `pnpm test:integration` with explicit DB configuration; include core/web suites and all theme shell/header/footer cases (`theme-render`), verify executed inventory. Missing environment or skipped cases are unresolved gates.                                                                                                     |
| Live Redis                           | Explicit ephemeral Redis and `TEST_REDIS_URL`; `pnpm --filter @nexpress/rate-limiter-redis test`; record actual live cases, not a skipped run.                                                                                                                                                                                      |
| Native preview                       | Explicit `NP_TEST_PREVIEW_BROWSER=1` plus DB; `pnpm --filter @nexpress/web exec vitest run tests/agent-preview-browser.integration.test.ts`; preserve object/renderer ownership and real browser security assertions.                                                                                                               |
| Production browser                   | Build first, isolated migrated/seeded E2E DB, `PLAYWRIGHT_USE_BUILD=1 pnpm --filter @nexpress/web test:e2e`; verify Activity after release, safe missing history, current access loss and normal CMS flows. No live external provider.                                                                                              |
| Packed fresh scaffold                | Run the full existing `.github/workflows/ci.yml` scaffold journey with real packed packages outside the workspace: sync, fresh generate/migrate, Doctor/Agent foundation, production build, extension lifecycle and first-run checks. Update exact schema/guard assertions; no borrowed workspace dependencies or changed lockfile. |
| Workspace final gate                 | `pnpm verify` and `pnpm lint` after affected dependency builds; use bounded concurrency when needed. Self-review and `git diff --check`; inspect secrets and unintended generated files.                                                                                                                                            |
| R5 gate 1: pre-provider checks       | Admission, context, policy, budget and usage tests prove no provider dispatch before deterministic admission/redaction/policy/budget checks, including receipt/key replay attempts.                                                                                                                                                 |
| R5 gate 2: output validation         | Executor/capability tests reject provider output that is not an installed validated capability/action; no receipt grants authority.                                                                                                                                                                                                 |
| R5 gate 3: duplicates                | Event coalescing and job/idempotency suites cover before/after retention, restarted batches, consumed keys and late jobs.                                                                                                                                                                                                           |
| R5 gate 4: availability              | `agent-runtime-isolation.integration.test.ts` plus reference-fence load/contention tests prove injected provider failure and retention contention leave ordinary collection writes and unrelated maintenance usable. Existing isolation case alone does not prove new global-fence performance.                                     |
| R5 gate 5: denial of wallet          | Budget/quota, usage and circuit-breaker suites prove bounded admission, unknown-spend handling and no post-release recount/re-execution.                                                                                                                                                                                            |

PR and post-merge CI/Release verification belong to a later authorized workflow.
No passing software run alone establishes full R5 product completion. The full
R5 decision must name the supported receipt allowlist, unresolved owner-blocked
history, remaining lifecycle work and manual-input boundary explicitly.

## 9. Structured manual input and R5 completion

The current Run-now contract accepts only the installed schema-null interactive
recipe id plus bounded goal. `runtime-studio-service.ts` filters out recipes
with non-null `manualInputSchema`; admission carries a schema digest but that
is not executor-owned storage or consumption of structured input.

This lifecycle bundle does not add fields, UI discovery, persistence or fake
executor support for structured manual-input recipes. Supporting them requires
an executor-owned exact canonical input contract, durable storage, size/redaction
limits, request/idempotency binding, resume/retry consumption and retention tests
before Studio may advertise them. No silent acceptance/drop of extra keys.

R5 bounded manual admission can be assessed using its existing supported
schema-null recipe/goal path. Publisher/Moderator/Operator template execution
is R6; catalog fixtures do not prove support. If a later R5 acceptance decision
requires a structured-input recipe, that decision leaves R5 open until the
executor work passes its own gates. This design and the current tests neither
close that requirement nor claim full R5 completion.

## 10. Self-review and documentation verification

Self-review corrected the initial narrow scope in five places: execution and
breaker audit also pin sources; immutable invocation authority can retain Run
ids after Action detachment; event composite FKs can block that detachment;
Run-only idempotency lookup permits reuse after deletion; and normal/global
audit insertion is not protected by the existing site quota lock. A second
read-only review also corrected cross-pass Call/reservation proof ordering,
cross-receipt historical references, post-detachment Action digest stability,
source-release FK deletion order and reference-fence row-lock inversion. The proposed
contracts and acceptance cases address each without weakening unknown-reference,
mutation, approval or rollback preservation.

The reference-fence trigger/snapshot and contention proofs remain required
acceptance evidence before rollout. Receipt digests are not
claimed to reconstitute deleted source proofs. Long-lived receipts are an
intentional, documented cost. The initial release allowlist does not pretend
to cover every Agent owner or create a general audit cleanup policy.

### Implementation details and bounded limitations

`source-release-contract.ts` owns the exact pure receipt union. The owning
retained-call verifier is shared by usage settlement and cleanup;
`source-release.ts` verifies all references before inserting receipts and
detaching a read Action. `source-release-read.ts` verifies retained attribution
and denies consumed admission keys. The existing Activity service, Doctor and
site-deletion inventory consume those contracts.

Cleanup locks sources and owners with `NOWAIT`. For each source/table it reads
at most 101 matching references and retains the source if more than 100 exist;
this conservative limit can leave highly referenced history pending. Unknown,
global and malformed references remain protected. Reservations require exactly
one verified Call release even when no audit reference remains. Original audit,
Action canonical input and invocation canonical bodies are preserved.
Before returning JSON to JavaScript, SQL also checks a 32 MiB owner-row ceiling
and 64 MiB total for that source/table reference batch. The allowance includes
the existing 16 MiB capability registry and 4 MiB Action/request contracts.
Larger evidence is not truncated or loaded into the cleanup process: a sentinel
keeps the source and advances the normal cursor. These are cleanup limits, not
new write limits on normal audit or canonical evidence.

`reference-fence-sql.ts` supplies the generated migration, Doctor's exact function
and trigger verification, and the real pg-boss adapter's partition guards.
Receipt deletion is deferred until commit and requires its site to be absent.
The singleton is global coordination state and is excluded from site deletion.
The guard checks every literal UUID occurrence, including overlapping UUIDs
inside keys or strings, using forward `regexp_instr` searches and indexed
source-id lookups. Searches operate on 240-character chunks with a 35-character
carry, so dense UUID input does not repeatedly scan the whole payload.
PostgreSQL 16 is the repository's tested database target.

Generated migration `0049_workable_clint_barton.sql` creates the three tables
and replaces only the Action attribution constraint while adding its nullable
receipt pointer. `0050_agent-source-reference-lifecycle.sql` installs the
singleton, exact guard functions and canonical table/pg-boss trigger inventory.
The source generator is idempotent and rejects altered custom migration SQL.
No existing canonical body, raw audit row or source column is rewritten.

### Verification evidence

Local verification uses Node 24.11.1, pnpm 10.33.0 and PostgreSQL 16 on
2026-09-16 KST. No skipped suite is evidence of completion, and this
implementation does not establish full R5 product completion.

- `pnpm verify --concurrency=2`: 113/113 tasks passed, including dependency
  builds, repository checks, typechecks and 1,962 Core unit tests in 203 files.
- `pnpm lint`: 41/41 tasks passed for the final product source. Later changes
  only corrected four integration-test inventory assertions. App typecheck and
  all changed-file formatting checks passed afterward. Integration tests are
  explicitly excluded by the repository's ESLint and app TypeScript configs;
  their actual PostgreSQL reruns provide execution coverage. An extra full-web
  ESLint retry hit its configured 6 GiB heap limit; the focused attempt reported
  those four files as ignored and is not counted as lint coverage.
- Explicit live Redis: 16/16 tests passed, including all three live cases.
- Production Chromium: 71/71 tests passed against the built reference app.
  The two new Activity browser cases use mocked transport for expired history,
  current access loss and rejection of unexpected private receipt fields;
  actual receipt resolution and access enforcement are PostgreSQL assertions.
- Upgrade/rollback smoke: migrated a disposable database through 0048 with
  legacy audit evidence, injected failure after 0050, verified atomic rollback
  of both migrations, then retried successfully with original audit bytes intact.
- Packed fresh scaffold: 40 public tarballs and all 60 steps passed with zero
  skips. All 1,200 packed `dist` files, including 242 declarations, matched
  workspace hashes. Fresh generate/migrate produced identical reference guard
  SQL; foundation verified 43 tables, 284 critical constraints, 15 deferred
  constraints and 24 Studio projections. Production build, seven extension
  package lifecycles, five runtime script loading checks and first-run readiness
  passed. The worker check exercised its disabled-start guard, not a live worker.
- Full PostgreSQL: Core passed 68/68 tests in 10 files. The Web run executed
  162 files and reported 1,476 passing tests, one stale inventory-count failure
  and one opt-in native-preview skip (1,478 total). The failure expected 39
  site-owned tables instead of 41; four related test files now use the canonical
  inventory and explicitly exclude the global fence. All other Web suites,
  including the five theme-render cases and 20 reference-fence cases, passed.
  The corrected four-suite rerun passed all 29 tests with zero skips. These
  results provide passing coverage of all 1,477 non-opt-in Web tests; they are
  the full run plus the focused correction, not a second full Web run.
- Explicit `NP_TEST_PREVIEW_BROWSER=1` native preview: 1/1 passed with zero
  skips, including cross-site POST, independent Strict-cookie navigation and
  staff-cookie isolation. Combined with the focused correction, all 1,478 Web
  tests and all 68 Core PostgreSQL tests have passing execution evidence.

Final integration runs use direct package scripts against complete dependency
builds. The packed scaffold uses isolated dependencies outside the workspace.

PR CI initially exceeded the default 30-second test wall time in the two large
audit-fixture cases (33 MiB and 3 × 23 MiB). Those cases now allow 120 seconds
for server-side fixture construction, ingress guards, cleanup and fingerprint
comparison. The production maintenance statement budget and every preservation
and cursor assertion are unchanged; no suite is skipped.

A subsequent CI run passed both oversized audit cases but exceeded five seconds
while seeding 50,000 receipt fixtures for the indexed-lookup test. Fixture seeding
and ANALYZE now use a transaction-local 60-second allowance. The test explicitly
checks that both connections retain the original five-second statement budget
before the measured 1,000 writes and dense 10,000-UUID payload.
