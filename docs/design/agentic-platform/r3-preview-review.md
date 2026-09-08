# R3 preview review — AP-305/AP-306

Date: 2026-09-08. Base: `c260295d` (AP-303/AP-304, PR #1430).

## Delivered scope

The existing ChangeSet service owns preview admission, queued generation,
current requester/viewer authority, sealed-plan overlay rendering and bounded
maintenance. It reuses canonical resource plans, snapshots, staff admission,
Gateway admission, route contracts and private artifact references. Five
preview tables and migration 0040 extend Doctor to 28 tables/133 critical
constraints and the ordinary site-deletion inventory to 27 tables.

The existing renderer's document, navigation, SEO, theme and media-reference
reads use a read-only transaction and async-local overlay. Framework writes,
effectful hooks, external search and cache/job/email/storage side effects are
fenced. A complete HTML response is bounded to 5 MiB and 120 seconds. No content,
revision or setting is applied by preview generation.

Explicit host services provide the isolated HTTPS viewer, one-time launch
exchange, per-preview Strict cookie, render bootstrap and ordinal capture
tickets. Claims, retained rows, canonical origin/routes/contract, current staff
session and per-item authority are rechecked. The production launch bridge
alone sends an origin-only referrer because `no-referrer` makes a real browser's
cross-site form Origin opaque; null Origin remains rejected. Preview and
artifact responses retain no-referrer and private response headers.

A bounded private local spool precedes complete atomic artifact reservation.
Exactly one dispatched PUT may occur; lost-ack recovery inspects its durable
identity. Read-back verification, full manifest checks and private deletion
receipts protect readiness and cleanup. Never-dispatched bytes become terminal
after the derived 5,850-second dispatch window; pending/unknown operations do
not become safe merely because time elapsed. Host maintenance must drain its
opaque cursor before starting a new pass.

Reference and fresh scaffold wrappers only delegate the three production
Admin preview routes. Hosts explicitly install
`handleAgentPreviewOriginRequest` and `handleAgentPreviewRenderRequest`; the
existing Agent HTTP gateway can receive
`createAgentChangeSetHttpArtifactFacadeV1(service)` as its optional artifact
facade. Screenshot and private storage adapters also require explicit installation. Without screenshots/check
execution, ready empty evidence declares `SCREENSHOTS_UNAVAILABLE` and
`CHECKS_NOT_RUN`.

## Self-review corrections

- Preserve null `beforeHash` for proposed document creates while checking the
  frozen absence snapshot and current resource base.
- Release authority row locks before acquiring the readonly render connection
  or performing storage I/O; repeat authorization before returning bytes.
  Single-connection pools and mid-render revocation have regression coverage.
- Bound service callbacks as well as streamed HTTP output; closed async-local
  contexts continue to fence escaped work.
- Classify changed contracts separately from revoked requesters, and use the
  admitting transaction for staff preview rechecks.
- Avoid repeated full-artifact reads inside each artifact authorization callback.
  Preview detail checks the full set; an artifact request checks its target and
  current authority/manifest without quadratic object reads.
- Traverse all maintenance states with a site-bound cursor, retry terminal
  cleanup and preserve the original completion time during expiry races.
- Close reserved-but-never-dispatched crash recovery without retrying PUT;
  validate stored receipts, stat preflight, deletion identity and expiry/skew.
- Use the private PSL when enforcing different registrable sites. The exact
  `tldts` dependency and lockfile change are intentional; package versions and
  changesets remain unchanged.

## Verification

- Latest-source `pnpm verify --concurrency=1` on Node 22.23.2: 113/113 tasks
  passed (110 executed, three cached), including repository checks (56), all
  package unit tests, typechecks and the reference production build. Core
  passed 1,604 unit tests; App passed 440. Core declarations built under the
  existing 5 GiB heap limit.
- Preview generation/admission/render regression: 13/13 PostgreSQL cases,
  including a single-connection pool from admission through rendering.
- Preview access: 10/10 PostgreSQL cases. Artifact lifecycle: 7/7.
- Overlay/resource transaction regression: 13/13 PostgreSQL cases.
- Actual isolated-origin Chromium flow: 1/1, including Strict-cookie activation
  and the explicit immutable CSS route.

- Full PostgreSQL: Core 67/67; Web 1,040 passed, with six explicit skips.
- `pnpm lint`: 41/41 tasks passed.

- Full Playwright E2E: 47/47 passed. The isolated preview Chromium case also
  passed again under Node 22 using the CI command.
- Packed fresh scaffold: 53/53 stages passed using 40 tarballs, including
  independent install/typecheck, generated migration application, the exact
  28-table/133-constraint disabled healthy foundation, production build,
  extension lifecycle matrix, deployment-readiness journey and unchanged
  workspace lockfile. The temporary database was removed.
- Changed-file formatting and `git diff --check` passed. Package versions and
  changesets are unchanged; the only new runtime dependency is exact `tldts`
  7.4.12 for private-PSL origin validation.
- Sensitive-value audit: changed files and 96 logs contain no configured
  sensitive environment values. The 40 tarballs contain no new matches; two
  unchanged source test fixtures match the local default test database URLs
  and were verified byte-for-byte against HEAD. No value is printed in the
  audit output. An earlier combined run hit
  host memory pressure (exit 137); that run is not counted as passing. A policy
  fingerprint golden changed only because the shared limits now include the
  explicit 5 MiB HTML bound, and its source-derived expectation was updated.

## Remaining boundaries

AP-307 actual link/SEO/accessibility check execution, AP-308 full ChangeSet
Admin views, AP-309 advertised MCP/API capabilities, and approval/apply remain
later work. No automatic runtime, listener, worker, browser process, provider
call, seed or default enablement is added.

ALS cannot sandbox arbitrary trusted host JavaScript that opens a separate
raw database/network client. Hosts must use the framework read facades and a
side-effect-free renderer. Render leases clear internal buffers and references,
but cannot erase immutable strings copied by trusted host code. Durable
storage inspection, adapter/key retention and cursor-driven maintenance remain
explicit host responsibilities. A host that enables capture must supply its
isolated renderer and private storage; the repository does not invent an
installed screenshot provider.

## Explicit skips

- Three live Redis tests require `TEST_REDIS_URL`, which is not configured.
- Five pre-existing magazine render snapshots use synchronous `renderToString`
  with asynchronous server components; the repository already disables that
  rig and uses the Next E2E flow instead.
- The ordinary PostgreSQL job skips the isolated-origin Chromium case unless
  `NP_TEST_PREVIEW_BROWSER=1`; that case is executed separately and is not
  omitted from this preview verification.
