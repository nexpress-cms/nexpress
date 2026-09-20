# Admin successful lifecycle verification

Follow-up to the [AT acceptance reconciliation](admin-assistive-technology-acceptance.md),
based on PR #1461 squash `4db66906`. This bundle fills three specific browser
success-path gaps. It reuses the actual Admin components, pure response contracts,
authentication/rate-limit fixtures and existing API shapes. Domain authorization,
provider/worker activation and database behavior are unchanged.

## Owned scenarios

- **Activation:** exact reviewed version, configuration hash, policy references
  and enabled manual trigger are submitted once. A held POST keeps draft state
  and disables duplicate submission. A valid acknowledgement alone does not show
  active controls: the held detail read must return a validated active projection.
  The returned trigger and Pause/Run/Archive controls are then checked.
- **Connection revocation:** cancel the native confirmation without a write, then
  confirm once. The held response keeps the prior state and disables repeated
  submission. The returned revoked connection has absent credentials; a fresh read
  preserves terminal state and disabled Revoke. Existing failure/retry cases stay.
- **Rollback:** one stateful fixture prepares a compensation plan, requests its
  approval, opens the actual approval UI, submits the typed challenge and human
  reason, then executes the approved plan. Exact plan/version/hash/approval and
  statement bindings are asserted. Held writes cannot display success early.
  Returned verification/execution evidence replaces prior authorizing actions.

These are synthetic server projections validated by the existing contracts. The
browser verifies UI behavior across real route navigation, not actual database
compensation or cryptographic approval creation. Existing integration suites own
those claims. Unexpected Agent API paths are aborted by each new fixture and
checked at completion, preventing an accidental new endpoint from reaching a host.

## Reproducible observation checkpoints

The same success fixtures have optional local checkpoints; no duplicate mock app
or production-only test mode is introduced. Ordinary runs never pause. The helper
rejects interactive mode in CI. Use an isolated test database and the existing
[testing setup](../../testing.md#e2e-tests-pnpm---filter-nexpressweb-teste2e), including
built dependencies/reference output when using `PLAYWRIGHT_USE_BUILD=1`.

After setting the normal local test environment, select only these three cases:

```sh
NP_E2E_LIFECYCLE_INTERACTIVE=1 PLAYWRIGHT_USE_BUILD=1 \
  pnpm --filter @nexpress/web test:e2e \
  agent-runtime.spec.ts agent-connections.spec.ts agent-changesets.spec.ts \
  --grep 'Runtime activation waits|connection successful revocation|rollback succeeds' \
  --headed --workers=1 --retries=0 --timeout=0
```

Unset `CI` for this local command. Use a dedicated local test database; fixture
login/global setup still writes that test user's authentication data. No operator
credentials or production database are needed. A headed browser and Playwright
Inspector must be available. Checkpoint labels are printed and recorded as test
annotations; choose Resume after observing the displayed state.

At checkpoints, inspect the state using keyboard/AT without changing the fixture's
form data or navigating away. Resume advances the existing scripted keyboard or
UI actions and releases the corresponding synthetic response. This is a
reproducible observation aid, not a free-form replacement for the six-workflow
manual checklist. The connection case deliberately leaves its native dialogs to
the operator: cancel the first dialog and accept the second, as checkpoint labels
state. Ordinary automated runs explicitly dismiss/accept those dialogs. The
interactive listener prevents Playwright's default auto-dismiss.

Record actual announcements, focus and timing with the AT acceptance template.
No checkpoint, screenshot or automated assertion is itself a screen-reader pass.
The previously unavailable speech/caption observation remains an open gate; this
bundle does not repeatedly launch VoiceOver or change OS permissions.

## Verification

- Complete production browser suite: **86/86 passed without retries** (2.3 min),
  including the three additions and existing conflict/access-loss/recovery cases.
  Log: `/tmp/np-admin-success-browser-final.log`; screenshots/results:
  `/tmp/np-admin-success-browser-final-artifacts`. Activation and rollback returned
  screenshots were inspected at desktop size; this is not a new full visual gate.
- Changed-file formatting, documentation relative paths and whitespace checks
  passed. Browser-generated media was preserved outside the checkout at
  `/tmp/np-admin-success-generated-public`.

- The three new cases passed together without retries (25.3 s), using production
  reference output and an isolated local authentication database.
- `pnpm verify`: 113/113 tasks passed (110 cached), including reference build;
  `pnpm lint`: 41/41 passed (41 cached). Because the app tsconfig and lint exclude
  E2E files, the four changed/new test files also passed an explicit strict
  NodeNext TypeScript check against built dependencies.
- Initial fixture failures exposed sorted-action validation, canonical challenge
  encoding, the generated trigger ID binding and a credential text selector.
  These were corrected without weakening the returned-state assertions. The first
  repository gate omitted local database/secret environment and stopped at build
  preflight; the corrected environment passed. No product defect was reproduced.
- Self-review added proof of the connection's fresh GET and the rollback's
  `rolled_back` state. Optional headed checkpoints are prepared but were not
  exercised as a human/AT session; no actual announcements are claimed.
- No core, server, schema, package output source or product UI changed. PostgreSQL,
  Redis, theme and native-preview evidence remains the existing evidence linked
  from [Admin state acceptance](admin-state-accessibility.md); those separate
  integration gates were not rerun. The preceding seven-stage packed-consumer
  result is reused, not a new full packed-scaffold or R5 acceptance claim.

Local logs: `/tmp/np-admin-success-three.log`,
`/tmp/np-admin-success-verify-final.log`, `/tmp/np-admin-success-lint.log`, and
`/tmp/np-admin-success-e2e-typecheck-final.log`.

No versions, changesets, lockfile, migration or operational credential changes.
