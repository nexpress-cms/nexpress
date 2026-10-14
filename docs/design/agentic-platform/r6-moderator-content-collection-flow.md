# R6 Moderator combined content collection

The explicitly invoked content collector joins actual observed comments, filed
comment reports and filed document/community-thread reports in one bounded
window. A campaign with three reported documents and two observed comments can
reach the existing five-target/three-author threshold even when the separate
collectors cannot create a Signal. It reuses the
[comment collection owners](r6-moderator-report-recipe-flow.md),
[document report owner](r6-incident-document-report-flow.md) and
[document-capable recipe](r6-moderator-document-recipe-flow.md).

## One scan, existing source owners

`createAgentModeratorCombinedContentCollectorV1` uses the existing closed
ten-minute window and one ordered SQL scan. The scan matches only exact source
component/Event-kind pairs: `community.comments` created/moderated,
`community.comment-reports` reported and `community.document-reports` reported.
All matching raw Events share the existing 100-Event allowance. The 101st rejects
before fact inspection or Incident writes; each source does not receive its own
allowance. Site and window filtering occur in SQL; selected collections and
current source eligibility remain with their existing readers.

The shared internal content reader dispatches document report Events to the
existing document reader and keeps both existing comment readers. Immutable
Event/report/document relationships, canonical hashes, current ACLs, audience,
status, versions and report resolution retain their existing owners. Resolved,
edited, hidden, missing or inaccessible sources cannot become new facts;
invalid historical evidence fails closed rather than being repaired.

The existing detector receives the complete current facts. Target kind,
collection and ID identify a target; repeated filings or observations count it
once. Actual authors establish independence across document and comment targets;
reporters and null authors cannot invent independent accounts. Report verdicts
remain unknown, rule scores remain advisory, and contradictory same-time
snapshots retain the existing refusal. Settings, thresholds, fingerprints,
canonical Signal contracts and Incident idempotency are unchanged.

The existing `createAgentModeratorCombinedCommentCollectorV1` and its evidence
resolver preserve their comment-only source boundary. Original observation,
comment-report and document-report collectors remain available. The new server
APIs add an explicit host choice rather than changing their behavior.

## Whole candidate resolution and transaction

`npResolveAgentModeratorCombinedContentEvidenceV1` verifies every retained
candidate fact against its exact current source. It compares complete fact bytes
and never partitions a mixed candidate into smaller independently accepted
subsets. Staff identity and current authorization are checked before and after
source inspection. The Incident writer retains canonical evidence/hash checks,
same-site references, CAS and idempotency.

Source reads, every candidate write and the final staff recheck share the existing
Runtime site-control transaction. Failure rolls back the entire invocation. The
collector does not change content, resolve reports, dispatch a Run, activate a
worker or invoke a provider. Construction performs no reads, installation or
work. Hosts own initialization, observers, the current staff identity and the
matching collector/resolver installation:

```ts
const incidents = createAgentIncidentWriteServiceV1({
  resolveEvidence: ({ db, candidate }) =>
    npResolveAgentModeratorCombinedContentEvidenceV1({ db, candidate, staffUserId }),
});
const collector = createAgentModeratorCombinedContentCollectorV1({ staffUserId, incidents });
await collector.collect({ siteId, windowStartedAt, settings });
```

Collector, interface and resolver are server `@nexpress/core/agents` exports;
source inspection remains internal. No new route or pure browser wire is added.

## Existing recipe and human approval

One Signal can now retain both target kinds and all three source owners. The
existing recipe source uses the same content reader to recheck every original
Event, Signal and exact detector result before offering a target. Its report
claim count describes retained reported targets only. Raw content, report
reasons/IDs, author/reporter identities, domains and restoration state remain
outside provider metadata. Candidate bounds, stable target ordering, exact
proposal bytes and `sensitive-approved` attestation remain unchanged.

Context attestation, post-inference proposal, fresh human approval inspection and
approved execution all reread the same complete evidence. A changed supporting
source invalidates the entire campaign even when the selected target is
unchanged. Signed approval, current requester/approver authority, policy, target
version, budgets, collection hooks/revisions and atomic containment/receipt owners
remain mandatory. Exact replay and verified completed receipt projection retain
their existing behavior after quarantine makes a source ineligible. Restoration
remains a separate existing approved operation; one Run still proposes at most
one quarantine.

## Remaining boundaries

The subsequent [content proposal benchmark](r6-moderator-content-proposal-evaluation-flow.md)
adds versioned synthetic document/comment response evaluation. Member
report/restriction sources, document-specific detector benchmarks,
production/model quality, automatic moderation and full R6 acceptance
remain open. Real local source and fake-provider journeys establish orchestration
and refusal behavior, not model usefulness or false-positive thresholds. No
schema, migration, version, changeset, lockfile, credential, provider call,
automatic activation or handoff change is introduced.

## Verification

Local acceptance on 2026-10-14 KST, based on `a82f7287` (PR #1532). Its exact-head
PR CI, subsequent main CI `38503628242` and Release `38503628246` passed before
this bundle.

- `pnpm verify --concurrency=1`: all 113 workspace tasks passed, including Core
  2,312, shared App 690, CLI 155, Admin 191 and Web 164 unit cases. `pnpm lint`:
  all 41 tasks passed. Focused Core recipe/report/detector checks passed twelve
  cases. A separate temporary configuration including both modified test files
  passed TypeScript checking after complete dependency builds.
- Actual PostgreSQL 18: all 125 cases across fourteen affected suites passed
  without skips. The twelve new content cases and existing combined-comment,
  document report/recipe, moderation, Runtime context/executor, five theme cases
  and explicitly enabled native preview all passed against finished output.
  Actual three-document/two-comment activity produced no Signal from the old
  collectors and one replayable mixed Signal from the new collector. All three
  source owners, real author independence and duplicate filings were verified.
- The global capacity case padded the actual raw batch to 101 using clearly
  labeled canonical persistence fixtures, which do not represent actual filings
  or additional eligible facts. Refusal occurred before ACL/fact inspection or
  writes. Removing one padded row permitted exactly 100 raw Events and five real
  facts; unrelated component rows did not consume the bound. Integrity/site/ACL
  probes restored their fixture and verified replay. Edited, hidden and resolved
  sources each used an independent fixture, refused the complete retained
  candidate and left only four fresh facts/no new Signal.
- Final staff admission failure rolled back an already-written mixed Signal,
  Incident, timeline and deliberate in-transaction role change while preserving
  original Events. One mixed Signal supplied both document and comment exact
  proposals through distinct signed human approval, one quarantine across
  continuation replay and a verified redacted completion. Resolving a supporting
  document report refused the approved comment action without consuming approval
  or changing content. Local inference was explicitly fake; no provider call
  occurred.
- Redis 7.4.7: all sixteen existing unit/live cases passed against a task-owned
  disposable loopback server. The ordinary Turbo unit run retained its three
  environment-gated skips; the separate explicit live run passed all three.
  No repository dependency or environment configuration changed.
- Fresh external scaffold: all forty public packages packed and installed
  through 46 successful stages. Installed combined collector/resolver/interface
  and existing recipe APIs, construction without reads/effects, offline v2
  evaluation, configuration-inclusive typecheck and production build passed.
  Eight installed Core/Admin runtime/declaration entry files matched producer
  bytes.
- Production Chromium: the existing Moderator human-approval setup and document
  report evidence review journeys both passed without retries against a separate
  task-owned PostgreSQL database. All four 390/1280-pixel screenshots were
  visually inspected for responsive layout, exact-target selection and current
  published/public versus pending/hidden or draft/private evidence. Explicit
  bounded draft setup and human approval scopes remained intact.

The initial new PostgreSQL run passed five cases before four fixture errors were
corrected: unknown verdict assertions now apply only to report facts, preserving
actual observed verdicts, and Runtime calls use the existing Runtime fixture's
actual site. Test-inclusive typing corrected the dummy admission facet, subject
kind narrowing and transaction adapter bridge. An unsupported Vitest worker flag
was rejected before execution and removed.

Independent review also corrected two test-evidence gaps: permanent source-state
probes now use separate fixtures, and raw Event/capacity counts account for
retained discarded Events from real bucket retries. Actual sources are deleted
through their domain owners during retries; historical Events and timestamps are
not rewritten. The final twelve-case suite, complete regression and test-inclusive
typecheck passed after those corrections. Implementation files remained unchanged.

Self-review and independent read-only production/QA/corrective reviews found no
remaining material regression; all delegated results were collected. Final source
hashes, formatting, relative links, protected-file scope and `git diff --check`
were checked, preserving the pre-existing handoff edit. These checks do not close
model quality or full R6 acceptance. Local evidence does not replace exact-head
PR checks.

Logs: `/tmp/np-content-combined-{core-build,core-unit,verify,lint,owned-types,pg-regression,redis,browser,consumer}.log`.
