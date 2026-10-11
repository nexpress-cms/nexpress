# R6 Incident comment report evidence

Staff can review actual filed comment reports as Incident evidence, distinguish
their recorded target state from current comment and report state, and select an
eligible current target through the existing human-approved response flow.
Reports remain unverified claims; they do not supply classifier verdicts or
execution authority.

## Source ownership and installation

The existing `fileReport` owner optionally uses a bootstrap-installed
`setCommunityCommentReportObserverV1`. Without installation, its current behavior
is unchanged. Document and member reports do not enter this observer.

When installed, the owner rechecks the actual visible comment and readable parent
under the existing parent-before-comment locks. The new report and its canonical
`community.content.reported` Event commit in one transaction. Recording failure
rolls back both; the existing best-effort community audit follows a successful
commit. No worker, Runtime, provider, credential or external delivery starts.

The Event binds the real reporter, author, comment, parent, site and report filing
time. Its purpose-bound compact source key commits the immutable report base
facts and exact comment state with full SHA-256 digests within the existing
128-character key contract. Raw reason, comment body and HTML are not copied to
Agent storage. Current report resolution is deliberately outside the immutable
filing digest.

Unresolved duplicates are checked before parent locks and again before insertion.
Evidence inspection reads the report without an additional row lock, avoiding a
cycle with the existing report resolution owner. Domain target reads retain the
existing parent/comment locks, and current source facts are rechecked by their
consumer. Response planning retains its serializable transaction.

## Bounded advisory collection

`createAgentModeratorCommentReportCollectorV1` is a separate, explicitly invoked
host owner. It reads at most 100 Events in one closed ten-minute window, checks
current staff and target ACLs, and accepts only unresolved reports whose actual
comment still matches the observed state. Overflow fails rather than truncating.
Missing, edited, resolved, foreign or tampered sources do not become fresh facts.

Collection reuses the existing repeated-link detector, thresholds, fingerprint,
score and Incident writer. Distinct comment authors establish account
independence; multiple reporters and repeated claims on one comment do not add
independent authors or targets. Both adapter verdicts are `unknown`, accepted only
as a pair for reported-event facts. No pass/flag verdict is manufactured.
The resulting rule score stays advisory and is not a reviewed spam probability.
`npResolveAgentModeratorCommentReportEvidenceV1` re-resolves exact facts inside
the writer transaction. Replay preserves the existing Signal/Incident deduplication.

## Review and target selection

The existing optional Incident evidence owner recognizes both comment
observations and comment reports. Strict Incident visibility checks every source;
unknown or inaccessible references are never silently omitted.

The existing HTTP route and pure evidence contract preserve the original comment
wire shape. A report adds `reportFiled: true` and paired unknown verdicts to
recorded metadata. Current report status and resolution time are separate from
current comment state, edit time and target version. The wire contains no report
ID, reporter identity, report reason, content body or raw Event.

Admin labels the recorded filing as an unverified claim and shows current
resolution separately. A new response choice requires an unchanged comment,
unresolved report, active Incident, current ACL and matching server target digest.
Loading, refresh, pagination, source drift and access loss clear prior evidence
selection. Selection does not prepare, approve or execute automatically.
Previously issued approvals remain governed by the existing moderation owner.

Source/current facts bind the authenticated pagination cursor, including report
resolution and parent changes. Referenced Events can remain after their retention
eligibility date. The existing report owner has no age-based pruning; physical
source removal or integrity loss is unavailable, never inferred expiry or deletion.

## Remaining boundaries

Document/member report collectors, general document evidence, classifier/model
assessments, automatic moderation, external notification delivery and full R6
evaluation remain separate. Existing approval, capability, policy, retention and
execution semantics are preserved. Versions, changesets, lockfile and schema are
unchanged.

## Verification

Local acceptance on 2026-10-11 KST, based on `b8e1434a`:

- Final `pnpm verify`: 113 successful tasks, including 2,301 Core, 687 shared app
  and 164 reference app unit cases. Final `pnpm lint`: 41 successful tasks.
- Actual PostgreSQL 18: five new report scenarios and 82 affected regression
  cases across ten suites, with no skips. These include the existing observation
  collector, Incident evidence/writer/workflow, approved moderation execution,
  legacy reports, multi-site ACLs and deletion cascade. Theme rendering (five
  cases) and native preview (one case with `NP_TEST_PREVIEW_BROWSER=1`) ran.
- The new source cases verify uninstalled behavior, report/Event rollback,
  duplicate rejection while the report row is locked, author independence and
  replay, unknown-verdict projection, trusted response preparation, source
  changes/resolution, cursor invalidation, complete-reference ACL and tampering.
- Production Chromium: all 17 Incident journeys passed without retries. The
  report journey uses typed HTTP fixtures to cover unresolved/resolved and edited
  targets, exact selection, global/evidence refresh clearing and no automatic
  preparation. Evidence captures at 390 and 1280 pixels were visually reviewed.
  Real persistence and response authority are covered by PostgreSQL tests rather
  than these browser fixtures.
- Fresh packed scaffold: all 40 public packages, 46 stages; isolated install,
  explicit observer/collector construction without work, installed pure report
  projection, config-inclusive typecheck and production build passed. Installed
  Core contracts/agents/bootstrap and Admin client artifacts matched current
  workspace bytes.
- Self-review and independent review fixed the report/domain lock interaction
  and selection fallback after detail refresh. Formatting, relative links,
  `git diff --check` and generated-file/secret scope checks passed. The preexisting
  handoff edit was preserved; no new handoff was written.

The Redis adapter's 13 unit cases passed; its three live cases skipped because
no local Redis server was available and Docker did not respond. This is the
affected comment-report acceptance slice, not a rerun or completion claim for
the full PostgreSQL suite, all production browser journeys or full R6 evaluation.
Local results do not replace the exact-head PR checks.

Local logs: `/tmp/np-comment-report-verify-final.log`,
`/tmp/np-comment-report-lint.log`, `/tmp/np-comment-report-pg-new.log`,
`/tmp/np-comment-report-pg-regression.log`, `/tmp/np-comment-report-browser.log`
and `/tmp/np-comment-report-consumer.log`.
