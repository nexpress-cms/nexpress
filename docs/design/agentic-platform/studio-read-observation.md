# Studio read observation and refresh presentation

This bundle follows PR #1467. It distinguishes when validated data reached the
browser from when the server generated an existing projection. Neither timestamp
proves the underlying facts are current, authorizes an action, or measures cache
age. No API, persistence, provider or worker contract changes are needed.

## Ownership and evidence

Admin's `AgentReadObservation` is shared by `AgentStudioFrame`, `AgentReadState`
and the independently loaded budget/Runtime sections. Existing hooks own receipt
state, cancellation, access-loss clearing and review invalidation. The shared
presentation has no timer, fetch, mutation or new polling behavior.

- Browser receipt time is the existing hook's post-validation `Date.now()` value.
  A retained value keeps its original receipt while refresh is in progress.
- Runtime status uses its existing validated `status.generatedAt` for **server
  projection generation**, produced by Core's Runtime controls after its readiness
  read. It is not a worker heartbeat or an underlying source observation time.
- Budget has no projection generation timestamp. Its own receipt is displayed,
  and the server projection time is explicitly unavailable. The Runtime receipt
  no longer stands in for both resources. Other shared reads without an existing
  generation contract use the same unavailable presentation.
- Invalid optional display timestamps are omitted; no local time is substituted.
  Invalid required Runtime timestamps remain contract errors and clear that
  resource's evidence. Independent successful resources retain their own evidence.
- Local/server clock skew does not cause a synthetic stale or healthy verdict.
  No freshness threshold or cache-age claim is introduced.

Existing refresh live announcements remain their single owning status region;
static timestamp sections are named for their resource and wrap at narrow widths.
Review refresh still invalidates authorizing facts; retained background review
reads and unchanged-request retries retain their existing behavior.

## Verification

- Final production build: 41/41 tasks. Final `pnpm verify`: 113/113 tasks,
  109 cached; Core units 2,122, Admin 168 and App 585. Final lint: 41/41,
  40 cached. Logs: `/tmp/np-read-observation-build.log`,
  `/tmp/np-read-observation-verify-reviewed.log`,
  `/tmp/np-read-observation-lint-reviewed.log`.
- Production browser: 85/87 passed on the full run, with retries disabled.
  The two failures expected the old receipt sentence's semicolon. After updating
  those assertions, both affected journeys plus the extended Budget journey
  passed (3/3), covering all 87 journeys across the full/corrected runs. Bundled
  themes are included. Logs: `/tmp/np-read-observation-browser.log` and
  `/tmp/np-read-observation-browser-reviewed.log`.
- The Budget journey checks independently changing receipts, unavailable
  projection time, independent failure/recovery and malformed Runtime timestamps,
  preserving its original editing, rate-limit, authentication-loss and request
  identity assertions. The final 320px capture was visually inspected and has no
  horizontal overflow. The first capture caught a transition paused by the test
  clock; the final capture advances that clock and finishes animations.
- Fresh packed consumer: Admin's 10 dist files exactly match the tarball and
  installed package. Seven stages passed: pack, create, link, install, typecheck,
  production build and operational journey. 39 unchanged artifacts were reused;
  this is not a new full 40-package gate. Evidence:
  `/tmp/np-read-observation-scaffold/summary.json`.
- Initial local attempts exposed stale Core dist, lint results cached while type
  declarations were being rebuilt, a Forum self-import/mock race during concurrent
  build/test, and two setup child-process timeouts while a consumer build competed
  for resources. Completed builds, invalidating only the affected lint cache and
  rerunning the final gate without competing builds resolved these; no production
  code or unrelated test thresholds were changed to hide failures.
- PostgreSQL, Redis and native-preview integration were not rerun: their services,
  schemas and contracts are unchanged. The unit gate skips three opt-in Redis
  cases. This does not establish full R5 or spoken assistive-technology acceptance.
- React/component review and final diff checks found no authorization, polling,
  idempotency, API, version, changeset, lockfile or migration changes.
