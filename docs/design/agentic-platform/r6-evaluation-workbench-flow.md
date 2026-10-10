# R6 Admin evaluation review workspace

This AP-606 slice connects the existing offline evaluation and review owners to
`/admin/agents/evaluations`, linked from Agent Studio Overview. It adds no new
top-level Studio tab and remains available independently of Runtime/provider
installation. Both the server page and processing endpoint require current
`admin.manage` staff access.

## Import, review and export

Choose Moderator detector, Moderator proposal, Operator plan or Publisher. Import
an evaluation artifact and optionally its current review, a baseline evaluation
and the baseline's review. The supported datasets are `moderator.v1`,
`moderator-proposal.v1`, `operator-plan.v1` and `publisher.v1`. The older
`operator.v1` diagnosis artifact is outside the existing recipe report/review
contract and is rejected; it remains usable through its existing CLI.

Validation independently recomputes each artifact using its current owner. It
checks imported reviews against their exact source before applying any replacement
labels, so a new label cannot hide an invalid imported review or baseline. The
screen shows evidence, predictions, deterministic scores, review eligibility and
the existing report's comparison and coverage explanations. Other recipe report
rows remain explicitly missing when this workspace processes one recipe.

Moderator detector cases use confirmed-spam/false-positive labels. The other
three owners use accept/edit/reject, including parsed Moderator abstentions.
Failed predictions are read only; a reviewable prediction whose fixture checks
fail cannot be accepted. Edits must satisfy the original owner's grounding and
meaningful-change rules. They never alter the source fixture gate.

Applying a label retains every other exact case binding, including another
version of the same case identifier. Baseline changes retain locally applied
labels for the same current source; source/current-review/recipe changes clear
previous review state. File imports and processing requests have independent
generation checks; stale responses cannot replace current evidence. Invalid
optional files must be replaced or explicitly cleared, rather than silently
being treated as absent.

Unapplied edits, invalid input and pending work block exports. Rejected edits
retain previously validated labels for correction or explicit draft discard.
Access loss clears imported files, results and review drafts. The page has no
polling, persisted browser storage or server-side review history. Download URLs
are revoked after use and at unmount.

Downloads are the existing owner's labels array, review artifact and unified
report artifact. They remain compatible with the existing CLI, for example:

```bash
nexpress agent evaluate --review evaluation.json --reviews moderator-proposal-labels.json --out checked-review.json --json
```

The exported report embeds its independently validated source/review/baseline
input and is verified with `npRequireAgentEvaluationReportV1`; it is not an input
evaluation file for this workspace.

## Ownership and processing limits

The pure `evaluation-workbench-contract.ts` owns the exact browser-safe request
and display envelope. Server `evaluation-workbench.ts` calls the existing
evaluation/review/report builders and validators; it performs no filesystem,
database, provider or capability operations. Serialized exports retain their
existing schema versions, authority and exact hashes. Case labels and export
labels must agree with their source/case/prediction bindings in the display
envelope; exports cannot claim live approval or full R6 acceptance.

Shared HTTP admission uses `ensureFor("read")`, current-site staff admission,
the existing bounded UTF-8 JSON reader and safe Studio error response. The POST
is stateless evidence processing, with no-store/no-referrer/nosniff responses.
The existing Admin proxy still enforces CSRF and rate limits. Artifact failures
produce a safe validation error without echoing uploaded evidence or labels.

Each selected file and the combined serialized request must fit within 4 MiB,
with at most 100 cases and the existing owners' smaller fact limits. The display
response is bounded to 16 MiB because it includes source-derived case views and
serialized exports. This Admin import boundary is deliberately narrower than
the generic CLI's 8,000,000-byte evaluation artifact boundary. Inputs beyond it
remain available through the CLI; they are never silently truncated.

The Admin UI uses `npFetch` and pure display-contract validation. Shared App
pages/API own framework wiring; reference and packed scaffold routes remain
thin matching wrappers. No versions, changesets, lockfile or migrations change.

## Acceptance boundary

All review attribution is self-reported offline data. Fixture checks, human
labels, model usefulness and production moderation precision remain separate.
This screen grants no approval, activation or automatic action authority and
does not close AP-606 or full R6 acceptance. Provider calls, new credentials,
workers and durable storage are outside this slice.

## Verification

The local gate passed `pnpm verify --concurrency=2` (113 tasks) and `pnpm lint`
(41 tasks). Core ran 2,290 unit tests, Admin 191, App 686 and CLI 153. Focused
workbench checks covered five server-owner cases, eight Admin transport/state
cases and four HTTP admission/error cases. The App checks and typecheck also
passed after the final test-only import annotation correction.

The initial PR CI run reached the default five-second limit in a composition
test that replayed complete recipe datasets repeatedly. Workbench unit fixtures
now select three existing representative cases per provider-style recipe,
retaining proposals, abstentions, edits and exact baseline comparisons. The
recipe owners still test their full datasets; no timeout or product limit was
increased. Focused tests, the full Core unit suite, typecheck and affected lint
were rerun for this test-only correction.

PR #1523 subsequently passed all four checks on its exact head, including a
single 118-journey Chromium run and the isolated native preview check. Later
main and separate Version-PR CI runs again exceeded workbench test deadlines.
The Release workflow failed its Version-PR CI bridge; it did not establish a
publishing failure or authorize merging the Version PR.

The companion [notification recording recovery bundle](r6-incident-notification-recovery-flow.md)
removes seven more redundant workbench builds, shares immutable owner artifacts,
checks replacement-label behavior once at the shared request seam and registers
the four recipe round trips independently. An unsupported diagnosis binding uses
one existing case; supported recipe round trips retain their representative cases
and the full deterministic Moderator dataset. The test file has eight cases
instead of five because the four existing recipe iterations now report separately.
Timeouts and production behavior are unchanged. Focused checks, the full Core
suite and the complete local workspace gate passed. Hosted CI for this companion
bundle remains unestablished until it is pushed and checked.

The production Chromium suite passed 117 existing journeys. Its new workspace
journey initially failed an exact cache-header assertion because the proxy adds
`must-revalidate`; after checking the required `private` and `no-store` directives,
the new journey passed separately with no retries. This is 117 full-suite passes
plus one corrected targeted pass, not a clean single-run 118-test result.
The journey used the real endpoint and owner artifacts to verify staff/CSRF
admission, imports, proposal and abstention reviews, retained labels, rejected
edits, grounded edits, baseline coverage and independently validated downloads.
It also checked native-file clear/reselection, source-change invalidation and
the 320-pixel layout. The isolated database used PostgreSQL 18.3 with existing
migrations; CI uses PostgreSQL 16.

A fresh packed consumer installed 40 public packages and passed all 47 stages,
including generated-app typecheck/production build and installed Core/CLI
review/report round trips. Nine selected shipped workbench files matched the
producer bytes, and reference/scaffold wrappers passed the snapshot check.
Formatting, relative document links and `git diff --check` passed.

Three opt-in Redis checks remained skipped because no live Redis fixture was
available. Standalone PostgreSQL integration, theme integration and native
preview gates were not rerun for this stateless UI slice. These results do not
close the broader R6 gate. An initial production build stopped on disk exhaustion;
after removing old build-cache archives and incomplete build output, the final
local gate completed successfully.
