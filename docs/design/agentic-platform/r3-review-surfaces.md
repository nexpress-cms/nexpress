# R3 review surfaces — AP-307/AP-308/AP-309

## Scope

The existing ChangeSet service owns draft, validation, preview and review.
The five newly projected capabilities use one installed descriptor source for
admission, persisted invocation fingerprints, MCP tools and Agent HTTP/OpenAPI.
Host installation uses `createAgentChangeSetCapabilityFacadeV1(service)` and
`resolveChangeSetCapabilities` on the existing admission factory. Nothing is
registered, enabled or granted implicitly. Existing read-only hosts continue to
advertise their three read capabilities. A service without preview configuration
does not advertise or admit `changeset.preview`.

`changeset.create` requires `changeset:write`; the other four require
`changeset:read`. Resource scopes, item ACLs, current principal/token version,
site/audience/exposure and backing staff authority continue to narrow every
request. Get/list use read exposure; create/validate/preview require propose.
Draft create remains idempotent; validate binds version and draft hash; preview
binds the sealed plan hash. Completed transport responses describe the durable
admission and embed actual validation/preview state. They do not assert the
background operation finished. MCP task augmentation remains unavailable for
these operations; no run/action/task is fabricated.

## Preview checks

Hosts may explicitly provide `preview.checks` on the existing ChangeSet
service. Its renderer identity must match the frozen preview contract; rendering
and complete public route-manifest resolution run inside the existing sealed,
read-only overlay. The checker consumes one bounded HTML document at a time.
It uses parse5, shared SEO bounds and the existing exact report contract.
Static accessibility checks cover document language, names/labels, image alt
text and duplicate ids; these results do not certify WCAG compliance or replace
browser-assisted human review. JSON-LD checks validate bounded structure and
required schema metadata, without resolving remote contexts.

Local links use the host's public route/locale inventory with no HTTP. External
links stay unverified unless the frozen deployment allowlist permits their exact
queryless HTTPS origin. The private checker sends at most 100 unique, bodyless,
credentialless HEAD requests in four lanes, with five-second deadlines including
DNS. It never redirects or sends caller headers. All DNS answers must be public;
one verified address is pinned while TLS verifies the original hostname.
Neither the checker nor its network helper is a public package export.

Results and issues have fixed framework messages and bounded safe targets;
HTML, fetched bodies, DOM text, queries, fragments, credentials and raw selectors
never enter reports. Report parts are canonical JSON and join the existing
atomic whole-set reservation, one-PUT journal, digest checks and private deletion
lifecycle. Current requester authority is checked around rendering, network
requests and artifact persistence. Missing screenshots or unrun checks retain
explicit warnings.

## Admin review

The Activity subsection links to ChangeSet list/detail views. Current site and
staff session admission protect every request. Lists use opaque authorization-
and filter-bound cursors. Detail wraps the existing ChangeSet wire with a
bounded review projection; it never sends raw sealed plans or before snapshots.
Changed fields derive from verified snapshots and current editable-field rules,
including nested hidden/read-only filtering. Required human capabilities come
from the sealed server plan. Proposed text is escaped and presented separately
from server identity/state/hash/risk facts.

Draft create/update reuse the existing canonical proposal JSON/hash, idempotency
and CAS contracts. Validation, private report/screenshot reads and preview launch
reuse their existing services. Launch also accepts a narrowly scoped native form
transport containing the same canonical command and staff CSRF proof. The
central proxy checks same-origin form metadata and the staff CSRF cookie;
the response retains the server's real CSP/referrer headers. There is no CSRF
exemption or new launch authority. Lost authority clears retained UI evidence.

## Boundaries and verification

Approval decisions, apply, rollback and provider/runtime execution remain later
work. Hosts must inject effect-free renderers, private storage and explicit
processors. Trusted JavaScript using raw network/database clients is outside the
framework's async-local effect fence. No migration is required; Doctor remains
at 28 tables/133 critical constraints and site deletion at 27 ordered tables.
Service list pages retain their existing 8 MiB upper bound. Agent HTTP and MCP
retain their stricter frozen frame limits; an oversized response fails safely
rather than returning truncated evidence. Callers should request smaller pages
for large proposals, and use Admin review when an individual proposal exceeds
a transport frame.

Package versions and changesets remain unchanged. Runtime parser dependencies
are pinned without changing NexPress package versions.

### Self-review fixes

- ChangeSet browser cases reuse the existing API login fixture and locate their
  own error message separately from Next.js's route announcer. The dedicated
  auth flow retains real form coverage without sharing its IP rate-limit bucket
  with the new review cases. Review and high-request theme cases reuse the
  existing per-context rate-limit bucket fixture. Production rate limits are
  unchanged.

- The final OpenAPI capabilities response uses all eight installed framework
  descriptors, matching its invocation branches and runtime discovery analyzer.
- The older draft integration suite now clears fixtures before each test. Its
  former after-only cleanup allowed another suite's final document to survive
  into the first case when Vitest reused a worker.

- MCP input envelopes retain descriptor-local `$ref` definitions at the actual
  tool root. Reference traversal tests and JSON Schema 2020-12 compilation cover
  every advertised input/output schema in addition to HTTP/OpenAPI schemas.

- Preview expiry remains anchored to atomic completion. Artifact reservation can
  precede completion, so its creation timestamp no longer incorrectly shortens
  the documented seven-day lifetime. Detail validation and a golden fingerprint
  lock the correct anchor.
- Review snapshot reads release their transaction before private artifact
  verification re-enters viewer admission. A PostgreSQL test exercises a ready
  report with a single-connection pool.
- Services without preview configuration exclude preview from discovery and
  direct invocation. Injected entries are compared with the complete fixed
  canonical descriptor and fingerprint before projection.
- Principal journals store the same structured capability input used for public
  admission, including the exact validation draft hash. They do not introduce a
  second Admin-shaped invocation identity.

### Verification

Verified with Node 22.23.2:

- `pnpm verify --concurrency=1`: all 113 workspace tasks passed, including 3,806
  unit tests and 56 repository checks, typechecking and production builds.
- PostgreSQL Core: 67 passed. Reference app: 1,049 passed. Tenant, site,
  audience, scope, revocation, token-version and resource-authority negatives
  run through the existing suites; no content is applied by these surfaces.
- Real isolated Chromium preview: 1 passed, including native launch form,
  centralized CSRF admission and server security headers.
- JSON Schema 2020-12: 30 descriptor, invocation and advertised MCP input/output
  schemas compiled; OpenAPI golden, complete eight-branch unions and references
  through the final document passed.
- `pnpm lint`: all 41 workspace tasks passed. The last E2E fixture changes also
  passed a fresh reference-app lint/typecheck check.
- Packed fresh scaffold: all 53 stages passed with 40 tarballs installed outside
  the workspace, fresh generated/applied migrations, exact empty Agent
  table/constraint inventory, production build, extension matrix and journey.
- Full Admin E2E: 50 passed with no retries or skipped cases. The reference app keeps its runtime
  absent by default; authorized review and access-loss UI cases use mocked wire
  responses, while PostgreSQL tests exercise the real services and the separate
  Chromium test exercises the explicitly injected preview host.

Three optional Redis tests remain skipped because no test Redis URL is configured.
Five pre-existing synchronous theme-render tests remain skipped because those
components are now asynchronous; the actual Next.js E2E suite covers rendering.
The preview-browser test is gated out of the general PostgreSQL command and was
run separately with `NP_TEST_PREVIEW_BROWSER=1`.

Diff and archive checks found no newly introduced environment secret values.
The packed App's two unchanged baseline test fixtures contain the existing local
DB example also used by the development environment; their bytes match HEAD.
`git diff --check` passed, and the final source/log scan found no
environment-secret matches. Package versions, changeset files and migration
files remain unchanged. Package release remains deferred; this implementation
is submitted as one reviewed PR after validation.
