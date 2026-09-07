# R2 operations and Agent HTTP implementation review

Date: 2026-09-07. Scope: AP-209/AP-210, following the
[preflight review](r2-readiness-review.md).

## Implemented scope

Admin Activity owns bounded principal, run and action lists and details. It
reuses the existing wire projections, current staff session and site
authority, collection/document visibility, and Gateway mutation admission.
Inline actions remain visible without inventing runs. Stored run origin and
Agent references distinguish Gateway and future runtime evidence. Payloads,
goals and internal errors are redacted; expired evidence remains explicit.

Agent HTTP owns exactly the four routes in the closed shared inventory. A
dedicated service credential selects the site and binds the complete canonical
HTTPS `/api/agent/v1` audience. Authentication and invocation reuse Gateway
and capability admission, including current exposure, scopes, live authority,
principal state, revocation and token version checks. MCP OAuth and service
credentials cannot cross this transport boundary.

OpenAPI derives the exact invocation request/output branches from the three
shipped framework read descriptors. It exposes their metadata for discovery;
runtime admission still decides authority. Reference and generated routes are
thin wrappers. Doctor describes persistence readiness separately from host
service availability.

## Self-review corrections

- Refresh expiry checks after principal/token and live authority lock waits.
- Keep hidden candidate identifiers confidential inside authenticated,
  encrypted Activity cursors, with session/site/filter/authority binding.
- Recheck the complete staff authority snapshot before returning Activity.
- Traverse run actions in bounded batches under the stored run limit, without
  dropping valid runs merely because they contain more than 100 actions.
- Hide previous UI records immediately when the request path changes, and
  discard data on authorization failures.
- Validate client-safe results at both the shared facade and HTTP boundary;
  snapshot and verify artifact bytes before the final authority recheck.
- Exercise CSRF through the real proxy; direct handler integration tests
  exercise the existing reauthentication, idempotency and CAS services.

## Deliberate boundaries

No R3 preview store or runtime execution is implemented. An absent shared
artifact facade or disabled surface returns the same safe 404. A future
artifact facade must enforce object visibility and integrity itself; the HTTP
boundary also bounds and verifies its returned bytes. Runtime principals
without the required persisted autonomy facts remain unavailable rather than
receiving invented values. Unknown future action target families fail closed
until their domain visibility facade exists.

Every runtime service requires explicit host injection. Reference and fresh
scaffold transports remain disabled. There is no new listener, provider call,
worker, automatic factory, seed, migration, package version or changeset.

## Verification

- `pnpm verify --concurrency=2`: 113 build/typecheck/test tasks passed, including
  descriptor/OpenAPI golden tests, closed route inventories and repository
  wrapper checks. After the final UI error-message correction, Admin/App/Web
  were rebuilt and typechecked, and all 143 Admin unit tests passed again.
  Final unit coverage totals 3,599 Vitest tests plus 56 repository tests.
- `pnpm lint`: all 41 tasks passed after the final source edits.
- `pnpm format:check` and `git diff --check`: passed.
- Isolated PostgreSQL: Core 67 tests passed. Web has 946 passing tests and five
  existing skipped SSR tests after the failed-file rerun. Those five tests in
  `theme-render.integration.test.ts` use synchronous rendering for components
  that are now async server components; their existing Next.js E2E coverage
  remains the appropriate render harness. The initial new
  Admin fixture incorrectly omitted foreign-site membership/live credentials
  and assigned a reauthentication floor to suspend; these fixtures now match
  the existing services. One existing Shop test hit its 30-second timeout
  during concurrent builds; both affected files then passed all 44 tests
  with one worker. No authorization or timeout limit was weakened.
- Reference script module-load smoke passed, including honest unavailable
  runtime/seed exits. This smoke does not execute provider or seed operations.
- Full Playwright suite: 47 passed against the final reference build with an
  isolated migrated database. The six Agent Studio/Activity flows cover
  unavailable state, inline action paging/filtering, evidence expiry,
  access-loss data removal, principal controls, proxy CSRF rejection, and
  recorded Gateway/Runtime metadata. Browser payload fixtures exercise UI;
  real service admission is covered separately by PostgreSQL tests.
- Diff and untracked source inspection found no actual environment secret
  values. Package manifests, lockfile, changesets and migrations are unchanged.
- Packed fresh scaffold: all 53 stages passed using 40 freshly packed public
  packages outside the workspace. Verification covered installation,
  typechecking and config inclusion, isolated PostgreSQL migration generation
  and application, the exact empty Agent foundation and disabled authority,
  Next.js build, the extension scaffold matrix, CLI journey and unchanged
  repository lockfile. The temporary database was dropped after completion.

No requested test category remains unexecuted. No commit, PR or merge is part
of this implementation review.
