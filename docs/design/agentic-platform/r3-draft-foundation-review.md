# R3 draft foundation implementation review

Date: 2026-09-08. Scope: AP-301/AP-302, after merged AP-209/AP-210.

## Implemented scope

Exact ChangeSet, operation and approval wires reuse the existing discriminated
resource inputs, canonical proposal/plan and approval contracts. The explicit
server draft factory provides create, staff update, get, bounded list and
host-invoked editable-draft expiry reconciliation. Creation reserves document
UUIDs in operation resource keys without inserting documents. Replacing an
existing operation preserves its reserved id. Durable source idempotency
survives staff-session changes; draftVersion provides the single edit CAS.

Staff mutations reuse Admin admission. Principal creation rechecks the same
Gateway authority, exposure and scopes before and after its transaction. The
persisted definition uses the canonical descriptor contract but is not added
to the advertised read inventory. Resource preparation shares existing
collection ACL/schema/reference checks and navigation, theme, SEO and media
contracts. Every projection rechecks current resource access. Cursors reuse
the internal authenticated encryption codec with separate domain and current
authority binding.

Migration 0038 adds three tables: ChangeSets, operations and approvals. Doctor
uses 22 tables and 92 critical constraints; site deletion and staff containment
cover the added dependencies. Sealed-plan, rollback-duration and exact
snapshot-hash storage are present for their later producers. Drafts leave
validation, approval and execution evidence absent.

## Self-review corrections

- Recheck expiry after lock waits and resource preparation, with an actual
  PostgreSQL blocking-lock regression.
- Return authorized creation facts without requiring a separate read grant
  after the transaction has already committed.
- Exclude hidden/read-only schema defaults from editable output while keeping
  the existing document write defaults and full candidate ACL checks.
- Reject newly protected fields on later reads and media-reference operations.
- Validate capability definition construction at runtime, including Gateway
  effect compatibility and bounded JSON Schema output.
- Preserve deep valid draft JSON in bounded pages; include envelope overhead
  and stop at the byte ceiling without retrying the same candidate.
- Deduplicate repeated relationship checks within an operation and preserve
  opaque, tamper-resistant cursor isolation between inventories.

## Verification

- Final workspace build/typecheck/unit verification: 113 tasks passed.
- Workspace lint: 41 tasks passed.
- Core unit tests: 164 files / 1,548 tests passed.
- Core PostgreSQL integration: 10 files / 67 tests passed.
- Full Web PostgreSQL integration: 110 files / 965 tests passed on the first run.
- Focused ChangeSet PostgreSQL service tests: 7 passed; resource tests: 6 passed.
- Reference script runtime smoke: 25 wrappers loaded. The three write-producing
  generation/setup scripts are covered by scaffold/build and setup spawn tests.
- Environment-secret scan: no matching values in changed/new files or logs.
- No package manifest, lockfile or changeset modifications.

Playwright: all 47 existing Chromium/Admin flows passed against an isolated
PostgreSQL database (2.5 minutes). The exact generated upload fixture was
identified and removed after completion.

Packed fresh scaffold: 40 published tarballs and all 53 stages passed,
including installation, typecheck, migration generation/application, the
22-table/92-constraint/9-deferred-constraint disabled foundation, production
build, extension matrix, first-run journey and lockfile invariance. Its
isolated PostgreSQL database was removed. Final `git diff --check` and changed
file formatting checks passed. No unresolved blocking issue remained after
self-review. Implementation and verification preceded the separately authorized
PR and merge.

Skipped: three live Redis tests because `TEST_REDIS_URL` is absent, and five
existing synchronous theme-render integration tests disabled after the async
server-component transition. No Redis or theme-render changes are included
in this slice.

## Deliberate boundaries and remaining risks

AP-303/AP-304 own transaction-aware content services, base/conflict validation
and sealed-plan production. AP-305 onward own preview, checks, approval UI and
transport exposure; no draft route or UI is installed here. The existing Admin
E2E suite remains a regression gate, while new draft UI/transport flows are
not applicable yet. No provider effect, automatic runtime/worker, seed, port,
package version or changeset is added.

The expiry method owns only editable draft/invalid rows without approval
records. Later approval-bearing states require their actual lifecycle owner;
Doctor still reports their backlog. Rollback approval targets remain rejected
by persistence until a real target table/FK is installed. Draft read services
fail closed for later validation/execution states whose evidence producer is
not present. V1 continues to treat custom block props according to the existing
opaque Core block contract. Future validation/apply must recheck references,
base versions and authority; a draft does not reserve content or grant apply
permission.
