# Test cleanup evidence — September 2026

Baseline: `043286439412e40d725a53f6b4fca11b8252152e` (PR #1449).
Uncommitted implementation: `/Users/baesw/.codex/worktrees/3245/nexpress`.
This bundle changes test ownership, assertions and fixture work; it does not
change product behavior, versions, changesets, lockfiles or migrations.

## What remains protected

| Cleanup                                    | Remaining regression defense                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime route implementation-string checks | Invoke every actual exported handler and check operation, request, resolved ID and response forwarding; retain reference/scaffold wrapper parity.                                                                                                |
| Repeated absent Runtime cases              | Representative read, mutation and simulation paths still fail closed; operation-specific admission and dispatch checks remain.                                                                                                                   |
| Setup wizard repeated subprocesses         | Real CLI/HTTP modes, missing database error, default/non-default port behavior, existing environment defaults, realtime capacity, exact backup and supplied test database all remain. Successful script execution also covers module resolution. |
| Template regeneration per assertion        | Share immutable generated file maps per configuration; preserve configuration variants, dependency versions, script/export wiring and consumer checks.                                                                                           |
| Wrapper line counts and README length      | Remove arbitrary formatting limits; keep structural ownership and executable onboarding contracts.                                                                                                                                               |
| Packed plugin output/import spelling       | All generated extension builds and real add/doctor/remove lifecycle checks remain; doctor must observe correct registered/removed IDs.                                                                                                           |
| Repeated shared mobile drawers             | Keep every route × viewport overflow check and distinct page interactions; exercise the common drawer per shell/theme and viewport.                                                                                                              |
| Pure render tests in PostgreSQL runner     | Run color scheme, language picker and search highlighting under the DB-free unit configuration; test emitted color script behavior rather than counting `try` tokens.                                                                            |
| Theme example repeating merge cases        | Focused merge tests retain missing fields, metadata, immutability and multiple synthesized collections.                                                                                                                                          |
| Rejected Runtime SQL projections           | All 11 malformed version and 15 malformed admission inputs still hit real constraints; after each failure the valid version row is unchanged and no Run is retained.                                                                             |
| Gateway environment versus approved plan   | Tests that create their own plan no longer create an unused approved plan first. Heavy fixture callers retain original actors, clocks, service options and draft-input callback context.                                                         |
| Activity tamper fixtures                   | All four tamper kinds still deny Action/Run/list visibility and keep diagnostics aggregate-only; restore the exact original row and prove it is readable between probes.                                                                         |
| Core plugin storage lifecycle              | Persisted create/upsert/delete, plugin/prefix isolation, fractional TTL persistence and expired get/has/list/listValues predicates remain; age fixture rows instead of sleeping.                                                                 |
| Reference scanner offsets                  | Audit retains the complete 240-offset multibyte sweep. Job keeps its own mapping, INSERT/UPDATE/key rejection and chunk-boundary probes through the same SQL scanner.                                                                            |
| Health repeated request                    | Assert no-store on the already-tested successful real probe response.                                                                                                                                                                            |
| Feedback form editorial wording            | Preserve required fields, privacy destination, identity and allowlist contracts without pinning prose.                                                                                                                                           |

Registered test cases are reported separately from exercised inputs. Consolidating
several rejected SQL inputs into one fixture does not remove those inputs.

## Measurement method

Targeted before/after runs use the same checkout dependencies and commands.
Runner time includes collection/setup where available; assertion-only duration
is not presented as total runtime. The local machine also ran independent lanes,
so small timing differences are not reliable speedup estimates. Initial build
used existing Turbo cache entries and is not a cold-build benchmark.

The supplied baseline CI run `35071134170` reported unit/build 8m20s, browser
9m49s, scaffold 10m26s and PostgreSQL 23m3s (build 4m4s, integration 18m10s).
Those hosted-job times are context, not a directly comparable local baseline.
No cache/sharding or timeout changes are used to claim a cleanup improvement.

## Targeted measurements

Single local before/after samples; runner totals include setup and collection.
These are observed times, not projected hosted CI savings.

| Target                              | Registered cases before → after | Runner seconds before → after | Work removed or improved                                                                  |
| ----------------------------------- | ------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| Setup wizard subprocesses           | 12 → 7                          | 11.26 → 7.94                  | Five repeated child processes; all startup branches retained.                             |
| Runtime handler and route inventory | 89 → 69                         | 4.96 → 5.51                   | Twenty shared guard cases removed; actual route dispatch is stronger and slightly slower. |
| Core theme requirements             | 23 → 22                         | 1.61 → 0.897                  | One repeated large example; warm-cache influence is material.                             |
| Render tests moved to unit          | 27 → 28                         | 4.81 → 4.07                   | Both samples used unit configuration; this does not measure PostgreSQL startup savings.   |
| Feedback static checks              | 6 → 5                           | 0.566 → 0.688                 | Editorial wording removed; no speedup observed.                                           |
| CLI templates                       | 43 → 41                         | 2.365 → 1.070                 | Complete file-map generation calls 44 → 3, including setup time.                          |
| Mobile production browser           | 19 → 19                         | 111.456 → 56.766              | Route/viewport checks unchanged; drawer lifecycles 108 → 16.                              |
| Plugin generator unit matrix        | 30 → 20                         | 1.085 → 1.318                 | Five plugin kinds retain all assertions with ten fewer generations; no speedup observed.  |

Both mobile measurements used the same production build and a freshly migrated
dedicated database. An intervening run on data left by the first run failed an
existing navigation-empty assumption and is excluded from the timing comparison.
The deep-settings test now requires a successful navigation GET and rendered
empty or populated content, then verifies its add/tap behavior. A separate
populated-navigation rerun checks that observed failure mode.

## PostgreSQL targeted comparisons

Same file groups and `--maxWorkers=1` before/after. File intervals include their
fixture hooks; full runner totals are reported separately when available.

| File                 | Cases before → after | File seconds before → after | Preserved work                                                                   |
| -------------------- | -------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| Gateway execution    | 13 → 13              | 180.362 → 150.220           | Approval, exposure, transport audience, execution and rollback checks unchanged. |
| Gateway durable task | 2 → 2                | 79.078 → 70.150             | Both transports retain durable execution/replay behavior.                        |
| Core plugin storage  | 8 → 4                | 4.184 → 1.343               | All storage behaviors, fractional TTL and isolation preserved without sleeps.    |
| Execution Activity   | 6 → 3                | 114.417 → 48.853            | Four tamper probes plus independent visibility/isolation scenarios.              |
| Runtime persistence  | 43 → 19              | 22.999 → 10.686             | All 26 malformed SQL inputs, with post-failure state checks.                     |
| Reference fence      | 20 → 20              | 9.974 → 8.105               | Full scanner offset sweep once, distinct owner probes and original scale cases.  |
| Health               | 6 → 5                | 0.054 → 0.053               | Header checked on existing successful live response.                             |

All targeted PostgreSQL comparisons passed: **98 → 66 registered cases**.

The Gateway call graph previously created 32 approved plans across the targeted
Gateway/activity/task tests; it now creates 16. Thirteen unused preliminary plans
are removed and three further ready plans disappear when tamper fixtures are
shared. These counts describe fixture construction, not lost approval checks.

## Final verification

The first repository check identified the unindexed top-level evidence document;
it was moved into this existing history directory and linked from `docs/testing.md`.
The subsequent default-concurrency verify stopped with exit 137 in wp-import
typecheck after 118.66 seconds, without an assertion failure. All other benchmark/browser processes
were stopped. The same gate is rerun with CLI `--concurrency=2`; repository scripts,
CI settings and test timeouts are unchanged. This resource adjustment is not a
cleanup performance improvement.

- `pnpm verify --concurrency=2`: 113/113 tasks successful, 6 cache hits,
  276.47 seconds wall time. Repository checks: 55 passed. Unit suites:
  4,212 passed, 3 Redis-gated cases skipped pending the explicit Redis gate.
- Baseline CI inventory: 4,222 unit passes + 3 Redis-gated cases, 56 repository
  checks, 68 Core PostgreSQL cases, 1,478 Web PostgreSQL cases (including the
  separately gated native preview), 71 production browser cases.

- Core PostgreSQL: 64/64 passed, 32.49 seconds wall, two workers.
- Redis live integration: 3/3 passed, 3.40 seconds wall. The 13 unit cases
  had already passed in verify, so only the three gated live cases were rerun.
  The test-started Redis container was stopped afterward.

- Packed scaffold: 40 public tarballs, 60 stages, all required checks passed,
  no skipped stages. Sum of recorded stage times: 488.42 seconds. Includes
  isolated install/typecheck, schema generation/migration, Agent foundation,
  production build, all seven extension kinds, runtime loading and deploy
  readiness. Monorepo lockfile and versions unchanged. Packed `dist` bytes
  matched the completed workspace builds. Expected closed-port runtime failures
  are checked for successful module loading; they are not application successes.

- Native preview browser security: explicitly enabled with
  `NP_TEST_PREVIEW_BROWSER=1` against a separate test database; 1/1 passed,
  53.05 seconds wall (18.91 seconds reported runner duration plus teardown).

- Full production E2E: 71/71 passed with no retries or skips, 121.46 seconds
  wall. Fresh dedicated database; existing completed production build.
- After verify, the setup backup fixture was strengthened with an unknown
  environment key and comment to preserve the original arbitrary-content
  dimension. Only that changed file was rerun: 7/7 passed, 11.50 seconds wall.
  No product code changed and the already-green whole verify was not repeated.

- Web PostgreSQL: 1,422 passed + the one opt-in native browser case skipped;
  that case passed separately above. 1,015.48 seconds wall, two workers.
  Theme rendering's five cases were included and passed (file execution
  2.480 seconds in the runner cache). The Core and Web packages ran sequentially,
  directly against the completed dependency builds; no build ran while packing.
- `pnpm lint`: 41/41 tasks successful, 37 cache hits, 391.09 seconds wall.
- A single focused fence performance case was rerun with console interception
  disabled because the full reporter omitted the timing log. It passed; the
  other 19 cases were intentionally filtered, having already passed in the full
  suite. Observed preparation: 50,000 retained rows in 1,261 ms; measured
  1,000-row batch plus count in 126 ms; 10,000-UUID dense write plus count in
  346 ms. All cardinalities and statement budgets remain unchanged.
- The one PNG left by the full browser run was removed only after verifying its
  creation time and exact equality with the uploaded 1×1 test fixture. Earlier
  comparison-run PNGs were checked and removed the same way.

## Final inventory

Runner registrations, not independent guarantee counts; redis/native opt-in
cases are included once in their owning runner inventory.

| Runner                                            | Before | After |
| ------------------------------------------------- | -----: | ----: |
| Unit runner (including 3 gated Redis cases)       |  4,225 | 4,215 |
| Repository checks                                 |     56 |    55 |
| PostgreSQL (Core + Web, including native preview) |  1,546 | 1,487 |
| Production browser                                |     71 |    71 |
| Total registrations                               |  5,898 | 5,828 |

The targeted DB file intervals sum to **411.068 → 289.411 seconds**. This is
an arithmetic sum of seven file measurements, not the wall time of the complete
PostgreSQL suite. Mobile and template samples are reported separately above.
The full final gates overlapped some independent local work and do not form a
controlled before/after CI comparison.

`pnpm format:check` passed for the full repository, and final repository/link
checks passed 55/55. `git diff --check` passed. Package manifests, versions,
lockfile, SQL migrations and changesets have no changes. Only the listed test
and documentation files remain uncommitted; no generated media remains in the
workspace.

## Changed files

24 logical files, counting the three integration-to-unit renames once:

- `packages/app/src/lib/agents/runtime-admin.test.ts`
- `packages/app/src/lib/agents/runtime-routes.test.ts` (new)
- `packages/core/src/themes/merge-requirements.test.ts`
- `packages/core/src/integration/plugin-storage.integration.test.ts`
- `packages/cli/src/templates.test.ts`
- `packages/cli-nexpress/src/scaffold-plugin-types.test.ts`
- `scripts/feedback-intake-contract.test.mts`
- `.github/scripts/check-extension-scaffold-matrix.mjs`
- `apps/web/tests/setup-server-spawn.unit.test.ts`
- `apps/web/tests/color-scheme.integration.test.tsx` → `color-scheme.unit.test.tsx`
- `apps/web/tests/language-picker.integration.test.tsx` → `language-picker.unit.test.tsx`
- `apps/web/tests/search-highlight.integration.test.tsx` → `search-highlight.unit.test.tsx`
- `apps/web/tests/agent-changeset-execution-fixture.ts`
- `apps/web/tests/agent-changeset-gateway-execution-fixture.ts`
- `apps/web/tests/agent-changeset-gateway-execution.integration.test.ts`
- `apps/web/tests/agent-changeset-gateway-task.integration.test.ts`
- `apps/web/tests/agent-execution-activity.integration.test.ts`
- `apps/web/tests/agent-reference-fence.integration.test.ts`
- `apps/web/tests/agent-runtime-persistence.integration.test.ts`
- `apps/web/tests/health.integration.test.ts`
- `apps/web/tests/e2e/admin-mobile-layout.spec.ts`
- `apps/web/tests/e2e/mobile-layout.spec.ts`
- `docs/testing.md`
- `docs/agent-guidance/history/test-cleanup-2026-09.md`

## Limits

- No whole hosted CI after-run exists for this uncommitted bundle. Local samples
  cannot establish a CI-wide speedup. Expensive but meaningful execution,
  migration, packed install and browser boundaries remain.
- Admin's access-loss, safe error output, retry and editor validation tests were
  reviewed and retained because they protect distinct behavior.
- Repository ESLint configuration excludes Web tests. They are executed by
  Vitest/Playwright; the normal lint gate must not be described as checking those
  ignored test files.
- The default-concurrency local verify process termination was handled with a
  command-line concurrency limit; no persistent configuration tuning is included.
- Implementation was verified before commit/PR authorization. The user subsequently
  authorized merging this test cleanup bundle; publication remains excluded.
