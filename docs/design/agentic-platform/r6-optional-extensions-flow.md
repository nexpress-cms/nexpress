# R6 explicit review and operations extensions

This follow-up connects four separately installed extensions to the existing
R6 owners. They preserve the [acceptance boundary](r6-acceptance.md): local
fixtures, authenticated review and installed transports do not establish actual
model/Runtime quality or qualify production automatic quarantine. No provider,
credential, worker, trigger or external message is installed or invoked by default.

## Notification outcomes and reference transports

Delivery projection, terminal history retention and site deletion use the same
canonical completed-attempt validator. Every completed attempt must have exact
same-site/Incident/notification identity, contiguous attempt numbers, immutable
result digest, timeline fingerprint and consistent retry clock. Missing or corrupt
history cannot establish a known effect. An earlier ambiguous attempt stays
unknown after a later not-sent failure or pre-dispatch suppression. A confirmed
result for the same downstream-idempotent operation can resolve it. A sending
attempt remains unknown. Site deletion preserves unresolved or unverifiable
external delivery evidence.

The explicit Slack and Resend factories use fixed HTTPS API origins and existing
Connection/vault API-key leases. Configuration fixes one destination. Slack
credential probing binds the provider's actual team/user identity; it does not
prove channel membership or future write permission. Resend binds an actual
verified sending domain and matching sender; this requires a key permitted to
read that domain. A sending-only key cannot establish that identity proof.

Both transports declare `idempotency: none`: a finite provider idempotency window
is not an indefinite retry guarantee. There are no internal retries. Only a
validated provider acceptance is confirmed; documented rejections can be known
not-sent. Unknown, malformed, interrupted and unrecognized post-dispatch responses
stay ambiguous. Acceptance does not prove inbox delivery or human receipt.
Responses and rendered payloads are bounded. Email is plain text; Slack disables
markup, mentions and unfurls. Raw provider errors, credentials and destination
descriptors are not projected into Incident delivery status.

## Authenticated evaluation history

The existing offline Workbench import/review/export remains usable independently.
An explicitly installed history owner adds immutable selected-case decisions and
clear revisions. The server binds source, case/version and prediction hashes,
checks the original recipe's outcome/edit rules, and derives the admitting actor
fingerprint and timestamp from current authentication. Imported reviewer labels
do not authenticate their original author. Saving one explicitly chosen decision
records the current staff user's action; it does not adopt every imported label.

Current same-site `admin.manage` protects reads, writes and replay. Source-wide
CAS and stable idempotency keys prevent competing saves or unknown-outcome retries
from silently replacing a newer decision. Earlier revisions remain available.
Account deletion can clear the user foreign key while retaining the immutable
actor fingerprint. Separate server provenance says
`authenticated-staff-review-no-approval`; ordinary exported review artifacts keep
their existing offline authority. Neither grants capability approval or changes
`fullR6`/`modelUsefulness`.

Persistence uses additive evaluation source/review tables, existing admission,
audit and reference-fence owners. History is retained by default; Incident
retention is not an evaluation-history policy. Site deletion removes review rows
before their sources. Historical reference migration bytes remain frozen and a
new reference extension owns the additional tables. Source/history pagination,
source count, revision count and artifact size are bounded. An artifact too large
for authenticated storage can still use the existing offline Workbench.

## Operator audit coverage

The existing nine-family audit contract now accepts explicitly installed owners
for content, SEO, links, accessibility and security as well as contracts, Jobs,
storage and plugins. Older custom observation callbacks remain compatible.
Unknown or failed source reads consume the attempted shared target budget rather
than allowing a later family to reuse it.

Concrete content/SEO/link observations use existing requester/site/item ACL
readers and schema/Publisher analysis. Coverage is selected public published
content, not a complete private inventory. Partial routing cannot prove a broken
link. Accessibility uses actual authorized rendered HTML and the same bounded
static checker as ChangeSet preview; no fake preview identity is created. Its
fixed language/alt/name/ID checks are not WCAG, browser or assistive-technology
acceptance. Security covers only the installed fixed deterministic check IDs and
exact same-site source digest/freshness; it is not a general security scan or an
R7 Guardian collector. Missing, malformed or partial evidence stays unknown.

## Member account response boundary

Member reports remain unverified claims. A separate explicitly installed
staff-only owner supports a current-site temporary restriction and exact
revocation of an unchanged restriction created by this workflow. It reuses actual
Community ban enforcement and the existing Action/signed human Approval owners,
not a fabricated content containment or R7 actor/session restriction.

The host must provide its current policy and maximum duration; no production
policy or default grant is invented. The technical ceiling is thirty days.
Planning requires current Incident and Member-source authority and creates a
reviewable approval request. Execution additionally requires the exact fresh
signed distinct-human approval, current primary reauthentication, current policy,
source/version facts and CAS. Ban changes, Action verification and mandatory
Agent audit are atomic. Independent/manual restrictions are not revoked, and
ordinary human ban management remains compatible. Permanent/global bans,
automatic report/model actions and session revocation are outside this extension.
The V1 model evaluation action vocabulary remains frozen to its original
capabilities. Staff-only Member responses cannot enter those predictions or
evaluation suites; existing Publisher/Operator policy hashes remain unchanged.

## Verification

The final local producer and fresh external consumer use the same frozen code.
Verification used isolated PostgreSQL/Redis instances, synthetic staff and Member
fixtures, and fake notification/provider transports:

- `pnpm verify --concurrency=1`: all 113 tasks passed. Core ran 2,451 unit
  cases, Admin 195, App 766, CLI 165, create-nexpress 71 and Web 164.
- `pnpm lint`: all 41 tasks passed, with zero errors and one configured
  `react-hooks/set-state-in-effect` advisory for clearing stale case history.
- Core PostgreSQL: 10 files / 63 cases passed without skips. Full Web
  PostgreSQL: 210 files / 1,811 ordinary cases passed without skips or failures.
  The ordinary run separately skipped only the explicitly enabled native-preview
  browser case. All twelve theme-named files passed 79 cases, including the
  five-case theme-render gate and five built-in public-route smoke cases. Both
  PostgreSQL processes exited successfully after normal teardown; Web teardown
  spent about 259 additional seconds removing relation files left by the full
  integration run. No durability or test timeout was weakened.
- Redis: two files / sixteen cases passed without skips. The explicitly enabled
  isolated native-preview real-browser gate passed its one case without skips;
  it exercised the cross-site POST and separate Strict-cookie navigation without
  leaking the staff session. Both processes completed normal teardown and exited
  successfully.
- Default production browser: 129 distinct cases completed, with 128 direct
  passes and one pass on the configured retry; no terminal failures or skips.
  The Member refresh regression passed on its first attempt: changing current
  host policy during an Incident poll updated the bound while preserving the
  staff user's entered duration. The unrelated retry timed out creating a draft
  page before its mobile layout assertions; its saved diagnostic and retry trace
  were retained. No assertion or timeout was weakened.
- Fresh packed scaffold: 40 package archives, 652 producer JS/DTS archive files
  and all nineteen declared installed public packages matched the final producer
  bytes. The default 54-stage consumer gate passed, including schema/Doctor,
  extension install/build/register/remove and production build. With a separate
  explicit minimal test host, collection, enabled-host checks and three actual
  database proofs brought the outer receipt to 61 passing stages.

The enabled consumer used actual password sessions for two distinct synthetic
staff accounts. Three actual Member reports and the existing closed-window
collector produced an Incident. The browser then planned, signed a separate
account's approval and executed the temporary restriction, followed by exact
owned revocation through a second signed approval. Database and Community checks
confirmed two succeeded verified Actions, two consumed distinct-actor approvals,
two mandatory effect audits, an enforced write block followed by its removal,
zero remaining bans and an unchanged active global Member account.

Authenticated history was saved, reloaded and browsed in the actual Workbench.
Save, clear and a different staff account's replacement produced exactly three
immutable authenticated revisions. A stale request returned HTTP 409 without
appending a fourth row; further saves required explicitly loading current
history. Removing authentication produced HTTP 401 and cleared stored facts from
the UI. Ordinary exported evidence retained its offline authority and unreviewed
status. The Member approval and history screens fit 320/390 px viewports; dialog
wrapping and keyboard focus were inspected. This is bounded browser evidence,
not spoken assistive-technology or real-operator acceptance.

No Runtime runs, provider calls or actual external messages occurred. Synthetic
fixtures do not establish model usefulness, production automatic-action precision
or full R6 acceptance. Versions, changesets and the lockfile remain unchanged;
the additive history migrations were generated and exercised by the fresh
consumer. Self-review, changed-file credential-pattern checks, documentation
links, the 62-case repository check and `git diff --check` passed. Existing
handoff changes were preserved. Temporary consumer servers, browser sessions,
PostgreSQL and Redis were shut down after verification; the user's existing
PostgreSQL service was preserved.
