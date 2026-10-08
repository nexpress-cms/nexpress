# Test cleanup evidence — September 2026

Historical cleanup against baseline `043286439412e40d725a53f6b4fca11b8252152e`
(PR #1449). The change reduced repeated fixture work and incidental assertions;
it did not change product behavior, versions, changesets, lockfiles or migrations.
Current test policy lives in [Testing](../../testing.md#keeping-tests-useful).

## What remains protected

| Decision                                                        | Retained regression defense                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace Runtime implementation-string checks with handler calls | Actual operation, request, ID and response forwarding; wrapper parity; representative unavailable read, mutation and simulation paths.              |
| Reuse generated templates and reduce setup subprocesses         | Configuration variants, runtime modes, ports, database errors, arbitrary environment backup, dependency/export wiring and real extension lifecycle. |
| Exercise common mobile drawers per shell and viewport           | Every route/viewport overflow check, page-specific interaction and populated-navigation behavior.                                                   |
| Move pure rendering to unit tests                               | Color script behavior, language picker and search highlighting without requiring PostgreSQL.                                                        |
| Share rejected Runtime SQL and Activity tamper fixtures         | All 26 malformed SQL inputs and four tamper kinds, with unchanged/fully restored valid state between probes.                                        |
| Remove unused Gateway approved plans                            | Actual approval, authority, exposure, transport, execution and replay behavior.                                                                     |
| Remove storage sleeps and repeated scanner sweeps               | Fractional TTL persistence, expiry and isolation; complete 240-offset multibyte scanner sweep plus owner-specific mapping/rejection/chunk probes.   |
| Remove line counts, prose pinning and duplicate health requests | Structural ownership, executable onboarding, privacy and allowlist contracts, and no-store on a real successful response.                           |

Registered test cases are not independent guarantees. Consolidating rejected
inputs into a shared fixture retained the inputs and post-failure state checks.
Admin access-loss, safe-error, retry and editor-validation tests were retained as
distinct behavior.

## Measurement method

Before/after samples used the same dependencies and targeted commands. Runner
totals include collection/setup where available; file intervals are not full-suite
wall time. Cache warmth, concurrent work and different CI hardware prevent a
controlled whole-CI speedup claim. No cache, sharding or timeout changes were used.

## Targeted measurements

Representative local samples retained because they explain the work removed:

| Target                    | Fixture work before → after                          | Runner seconds before → after |
| ------------------------- | ---------------------------------------------------- | ----------------------------- |
| Setup wizard              | 12 → 7 subprocess cases                              | 11.26 → 7.94                  |
| CLI templates             | 44 → 3 complete file-map generations                 | 2.365 → 1.070                 |
| Mobile production browser | 108 → 16 drawer lifecycles; 19 route cases unchanged | 111.456 → 56.766              |

Both mobile samples used the same production build and fresh databases. A run
against leftover data was excluded, and the exposed populated-navigation case
was fixed and rerun separately. Some other targets became slightly slower;
consolidation alone is not proof of a speedup.

## PostgreSQL targeted comparisons

Targeted runs kept the same file groups and `--maxWorkers=1`. Reusing tamper and
rejection fixtures, removing unused approved plans and replacing sleeps reduced
98 registered cases to 66 while retaining their inputs and guarantees. Gateway,
Activity and task fixtures constructed 16 approved plans instead of 32.

Seven targeted file intervals summed to 411.068 → 289.411 seconds. This is an
arithmetic sum of file measurements, not the complete PostgreSQL suite's wall time.

## Final verification

The historical bundle passed repository checks, workspace build/typecheck/unit
tests, lint, Core and Web PostgreSQL, explicit live Redis, theme rendering,
native preview security, production browser and the packed-scaffold journey.
The packed run covered 40 tarballs and 60 required stages without skips, including
fresh install, migration, all extension kinds and production build. Packed bytes
matched completed workspace builds.

The default-concurrency verify process exited 137 during typecheck without an
assertion failure. A command-line `--concurrency=2` rerun passed; repository/CI
concurrency was unchanged. Redis and native-preview opt-in cases skipped by their
default runners passed separately. Production browser passed without retries or
skips. A later setup-backup assertion change passed its focused rerun.

## Final inventory

The recorded inventory changed from 5,898 to 5,828 registrations. Production
browser coverage remained 71 cases; other reductions came from consolidation.
These are historical runner totals, not current acceptance or guarantee counts.
Formatting, local-link checks and `git diff --check` passed for that bundle.

## Changed files

Changes were confined to test/fixture ownership, the packed extension checker and
supporting documentation: Runtime handlers, CLI templates, setup, pure rendering,
Gateway execution, Activity, persistence, storage, scanner fences, health and
mobile browser tests. Git history owns the exact file list and renames.

## Limits

- The recorded evidence contains no controlled whole hosted-CI before/after run.
  Local samples cannot establish a CI-wide speedup.
- Expensive execution, migration, installation and browser boundaries remained.
- Web tests were excluded by the repository ESLint configuration; Vitest and
  Playwright executed them. A passing lint gate did not cover those files.
- Historical verification and later merge authorization did not authorize
  publication or package-version changes.
