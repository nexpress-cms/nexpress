# R2 readiness review — before AP-209/AP-210

Review date: 2026-09-05. Baseline: `70298d2042d7cb95f5a3e662eb3ecb9ca694c838`
on clean `main`, matching the local `origin/main`. PR #1418 is merged and its
four CI checks succeeded. Root and all three nested `AGENTS.md` files were read.

## Implemented boundary

- The closed canonical, Admin-operation, wire, descriptor, and bounded-page
  contracts are already shared under Core's client-safe `agent-contract`.
- Gateway Admin admission, principal/service-token lifecycle, vault/provider
  connection services, diagnostics, and the minimum Agent Studio are present.
- The three read capabilities share the existing collection pipeline and
  capability admission. They persist invocation/action evidence, run inline,
  and do not create a Gateway run or pretend a Runtime Agent exists.
- Local stdio and optional same-origin MCP HTTP/OAuth share that read kernel.
  The durable MCP task service is host-injected; future task execution is not
  supplied by enabling its storage alone.
- Connection planning, one-time environment credentials, the shared skill,
  and closed plugin-capability rejection are implemented through AP-208.
- Reference app and generated project wrappers remain thin, disabled by
  default, and without an automatically constructed Agent runtime.

## Confirmed defects repaired

| Defect                                                                                                            | Existing owner repaired              | Regression evidence                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication/rotation locked token then principal while admission/revocation locked principal then token        | `agent/gateway-service.ts`           | Both paths reproduced PostgreSQL `40P01`; deterministic lock-wait tests now complete, and revocation during the wait still rejects authentication          |
| Token/overlap expiry used the time before lock waits and asynchronous authority checks                            | Same Gateway service                 | Controlled clock advances reproduce all three stale-time admissions; authentication rechecks time after locks and before its final conditional update      |
| Group/array values included hidden descendants and undeclared fields                                              | `agent/read-capability-executors.ts` | Recursive schema-owned projection, including layout wrappers and nested arrays; hidden getters are never evaluated                                         |
| Date filters passed strings to Drizzle timestamp encoders                                                         | Same executor                        | Real PostgreSQL dialect tests for all comparisons and `in`; integration excludes other sites, private documents, and drafts                                |
| Missing/invalid update timestamps became epoch evidence                                                           | Same executor                        | Malformed rows fail before projection rather than inventing a timestamp                                                                                    |
| Nullable schema types bypassed string/array limits and object closure                                             | `agent-contract/contract.ts`         | Invalid nullable bounds fail and bounded closed nullable shapes pass; fixed inventories/fingerprints are unchanged                                         |
| Block union root rejected every property; JSON fields exceeded schema limits; optional choice enums rejected null | Existing schema builders             | Installed MCP SDK validator accepts known blocks and rejects unknown fields/types; JSON and nullable-choice regressions                                    |
| Package-manager lifecycle output polluted MCP stdout                                                              | `mcp/client-connect.ts`              | Actual npm/pnpm/Yarn Classic subprocess checks; actual modern Yarn check and deterministic major-version/exit tests                                        |
| Existing quoted/spaced/dotted/inline TOML entries could be duplicated by apply                                    | `cli-nexpress/agent-connect.ts`      | Existing config and skill remain untouched on collisions; comments, multiline strings, and managed block context are covered                               |
| Plugin Doctor forced process exit before large piped JSON finished writing                                        | `app/scripts/ops-plugins.ts`         | Packed project reproduced exactly 65,536-byte truncation with exit 0; real subprocess regressions cover complete large success/failure JSON and exit codes |
| Mobile browser tests selected media or added navigation before asynchronous data loaded                           | Existing Playwright flows            | Explicit response/empty-state waits; both cases pass three consecutive runs without retries                                                                |

The changes reuse the existing services and serializers. They add no package
dependency, parallel authority contract, route, schema migration, version bump,
changeset, automatic enablement, or provider call.

## AP-209/AP-210 handoff

The next slice still needs the principal/run/action Activity facades and UI,
bounded item-authorized run lookup, the four Agent HTTP route wrappers,
`agent-http` credential admission, descriptor-derived exact OpenAPI branches,
and an optional shared artifact facade. Their absence is planned work, not a
claim that every R2 surface is complete. Keep the fixed wire inventories and
the existing Gateway/Admin admission as the shared sources; do not add a
second principal authority or execution pipeline.

No preview store or artifact content is implemented by this review. No Admin
Activity browser flow or Agent HTTP/OpenAPI golden exists yet to validate.
Those remain acceptance requirements for AP-209/AP-210.

The pinned MCP SDK rejects unadvertised task augmentation before projection
dispatch. The intended ignore-augmentation behavior in the proposed protocol
design remains a documented compatibility gap; normal inline calls work and
no task or run is fabricated. Windows execution of the generated Yarn launcher
has not been exercised in this macOS review.

## Verification

| Check                                                                              | Result                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify --concurrency=2`                                                      | 113 tasks passed: build, typecheck, unit suites                                                                                                                                                                                                           |
| Final Core rebuild/typecheck/unit/lint after the optional-choice schema correction | Passed; 155 unit files, 1,485 tests                                                                                                                                                                                                                       |
| `pnpm test:repo`                                                                   | 55 tests passed, including the installed SDK schema validator regression                                                                                                                                                                                  |
| `pnpm lint`                                                                        | All 41 tasks passed; final Core delta lint also passed                                                                                                                                                                                                    |
| CLI unit suite with final MCP artifacts                                            | 17 files, 161 tests passed                                                                                                                                                                                                                                |
| Core PostgreSQL suite                                                              | 10 files, 67 tests passed                                                                                                                                                                                                                                 |
| Reference-app PostgreSQL suite                                                     | 104 files, 922 tests passed; 5 pre-existing skipped tests                                                                                                                                                                                                 |
| Playwright against the built reference app and a fresh isolated database           | All 43 ultimately passed: 41 first-pass successes, 2 existing mobile Admin tests passed on retry; both new Agent Studio regressions passed first try; after repairing the two test races, both mobile cases passed three consecutive runs without retries |
| Final lock/expiry PostgreSQL regressions plus capability admission                 | 8 tests passed; includes three expiry cases rejected without recording token use                                                                                                                                                                          |
| Final Gateway expiry and Plugin Doctor build/typecheck/lint deltas                 | Core and app passed, including DTS builds                                                                                                                                                                                                                 |
| Plugin Doctor CLI regression plus existing ops core tests                          | 44 tests passed                                                                                                                                                                                                                                           |
| Packed fresh scaffold                                                              | 40 packages packed outside the workspace; install, typecheck, generated migration, production build and runtime entry smoke passed; empty Agent foundation has 19 tables, 71 critical constraints and 9 deferred lifecycle constraints                    |
| Packed extension matrix after the Doctor repair                                    | All 7 extensions generated/typechecked/built; plugin registration, removal, Doctor JSON, interactive client boundary and theme registration passed in a second clean project                                                                              |
| Packed CLI journey                                                                 | Deploy/Doctor help and failure modes, migrations, ops contracts/status/preflight, release check/plan and runbook artifact passed                                                                                                                          |
| Code formatting and `git diff --check`                                             | Passed                                                                                                                                                                                                                                                    |
| Version/changeset/lockfile and sensitive-value review                              | No changes to version/dependency files; no current secret environment values found in diff or review logs, including 66 packed-scaffold logs                                                                                                              |

The five skipped PostgreSQL tests are the existing synchronous React theme
render harness, which cannot render the current async server components;
the browser suite exercises the built Next application. Activity/run/artifact
authorization and Agent HTTP/OpenAPI acceptance remain deferred with
AP-209/AP-210. They were not represented as passing tests for nonexistent
surfaces. Live provider calls and actual client trust/consent were not needed
for this review and were not performed.

The initial clean baseline passed `pnpm verify` (113 tasks) and `pnpm lint`
(41 tasks). The initial full PostgreSQL run had one 30-second Shop timeout;
its isolated rerun passed all 40 tests and the final whole suite passed with
bounded worker concurrency. A full rebuild at default concurrency was
terminated with exit 137; the successful run used concurrency 2 without
changing repository build settings or increasing test timeouts. The initial
packed extension matrix reproduced the Doctor pipe truncation three times;
after the repair, a second clean scaffold reused the unchanged 39 tarballs
and the rebuilt App tarball and passed the full matrix.

Self-review checked the final authority re-read after lock acquisition,
expiry across lock/async waits, recursive projection/getter behavior, schema
branch closure, TOML managed and unmanaged contexts, package-manager
compatibility, and CLI output lifecycle. All reproduced defects were repaired
and their regressions rechecked. The SDK task-negotiation exception
and untested Windows launcher are the remaining compatibility limitations noted above.
