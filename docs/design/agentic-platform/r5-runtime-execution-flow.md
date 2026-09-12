# R5 explicit provider, read execution and recovery slice

This slice implements provider inference from AP-501, bounded context and
explicit read execution from AP-505, and outcome-bound recovery from AP-506.
Its base is the runtime foundation at `1dad00f0` (PR #1439). An explicitly
invoked Run can complete, request authorized evidence, execute an installed
read capability, or retain a safe terminal/retry outcome within its policy,
lease and budget. Full AP-505 mutation/approval integration and the full R5
release gate remain separate follow-up work.

There is no automatic worker, scheduler, provider installation, credential
fallback, new HTTP route, seed or default activation. Provider/model choice
remains explicit; recovery does not switch credentials or providers.

## Implemented boundaries

- Optional inference is a facet of the existing connection adapter registry.
  The explicitly constructed inference host validates the existing canonical
  provider request/output, releases credential leases and contains timeout,
  cancellation and malformed results as unknown outcomes.
- The reference OpenAI Responses adapter uses explicit model/pricing intent,
  injected fetch, bounded JSON output and local exact schema validation. It
  executes no model-selected native tools. Tests use local fake responses.
- The explicit processor uses the existing run, invocation/action, provider
  call and usage reservation records. Current admission checks the exact
  attempt and lease before effects. Successful retained decisions must reproduce
  their canonical response digest before they can drive another step.
- An unknown dispatch is never retried or treated as free. A known unsent
  reservation can be cancelled without recreating the lost prompt. Retry time
  is stored in `runtimeRetryAt`, not the client-safe run result.
- The context builder derives instructions, policy, descriptor schemas and
  evidence from their framework owners. Document evidence reuses transaction-
  aware current item reads. Unclassified operator text and document content
  require the conservative `sensitive-approved` ceiling; redaction does not
  lower the source classification.
- Breakers observe stored call/run outcomes. Half-open probes have one exact
  claim; authentication and policy failures do not automatically close.

Generated migration 0048 adds one nullable run retry timestamp and one check.
Doctor inventory is 40 Agent tables and 266 critical constraints; deletion
order and deferred lifecycle references are unchanged.

## Next work: explicit staff delegation and approval integration

All currently created Runtime principals use deployment authority. Existing
ChangeSet resource access requires a genuine live staff user and that user's
current item ACL. A deployment scope list cannot substitute for that identity.
The same limitation applies to the current schema owner behind `site.inspect`
and `schema.get`; public/published `content.query` has an existing deployment
read path. Runtime discovery must reflect these actual installed boundaries.

The recommended next task is an explicit staff-delegation decision followed
by the remaining AP-505 ChangeSet and approval execution path. The two
authority models have materially different scope:

1. **Explicit staff delegation (recommended):** bind a specifically selected
   real staff user through the existing principal authority relationship.
   Recheck live user/site membership, capabilities and item ACL, intersected
   with deployment and frozen/current Agent policy, at every effect. Never
   infer delegation from `createdBy`, mint a session or synthesize an admin
   user. Existing deployment principals receive no implicit delegation.
2. **Direct deployment item authority:** extend the existing content and
   ChangeSet resource owners to accept a separately specified non-human item
   policy. This is a broader authorization design affecting collection access
   hooks and downstream validation, preview, apply and rollback.

This merge scope preserves the existing deployment authority and does not
implement either new authority model. Selecting and implementing delegation
must be explicit before broadening item access. The recommended follow-up
should cover delegated principal lifecycle and revocation, current staff/site
and item authorization, descriptor admission, exact ChangeSet approval binding,
approved execution and recovery together. It must retain existing approval,
idempotency, CAS and audit contracts.

AP-505 is **not complete** until that follow-up is implemented and verified.
This slice does not claim a successful approval-resume path: entering waiting
approval requires an actual bound action, and resumption must verify the
distinct exact approved-execution receipt. AP-503 trigger/event jobs and
AP-507/AP-508 Studio, operations and retention remain later work.

## Verification checkpoint for this slice

Local `pnpm verify` passes all 113 build/typecheck/test tasks, including the
reference application. Core unit tests pass 1,833 cases in 191 files. Real PostgreSQL tests cover the context (11), Runtime capability
admission (6), existing Gateway regression (1), and explicit processor (6).
Execution/recovery (25) and the existing usage ledger (26) also pass together;
these focused PostgreSQL runs cover 75 distinct cases in total.
The processor checks actual Vault lease acquisition with injected fake inference,
single-spend concurrency, terminal replay, ambiguous cost retention, cancellation
and zero-cost release after a pre-dispatch Vault failure. No paid API is called.

Self-review fixes include exact admission-envelope projection, fresh lease
verification after awaited transaction work, fresh timeout/credential/pricing
checks before dispatch, atomic unsent-release preconditions, cancellation
containment, and canonical successful/failed response reconstruction before
trusting a retained decision or retry flag. The existing usage audit retains
the bounded failure safe code needed to reproduce its canonical receipt;
legacy failed receipts lacking that evidence cannot authorize a retry.

`git diff --check` passes. Package versions, changesets and prior migration SQL
are unchanged. The changed files contain no matching real environment secret
values in the local scan. Local workspace lint passes all 41 tasks and live
Redis passes all 16 cases. The merge gate also requires the four PR CI jobs:
workspace build/typecheck/tests, the full PostgreSQL suite including theme
rendering and Redis, production Playwright, and the packed fresh-scaffold
journey. The associated PR checks record results for the exact commit; prior
foundation acceptance does not substitute for those checks. The PostgreSQL job
has a bounded 30-minute deadline because the preceding foundation already used
19 minutes 38 seconds of its former 20-minute allowance.
The full R5 gate also remains open regardless of this slice's verification,
because mutation/approval, triggers and the later product surfaces are outside
its implemented scope.
