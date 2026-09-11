# R5 runtime admission and operations foundation

AP-500, AP-502 and the foundation of AP-504 add persisted Agent definitions,
policy resolution, queued runtime admission, usage accounting and emergency
controls. They reuse the existing canonical contracts, staff admission,
connection snapshots, site quota lock and generalized run table. This slice
does not complete the R5 provider-backed workflow gate.

## Explicitly installed services

The host constructs `createAgentRuntimeServiceV1`,
`createAgentRuntimeAdmissionV1`, `createAgentRuntimeUsageV1` and
`createAgentRuntimeControlsV1`. Construction installs no provider adapter,
listener, worker, job, trigger dispatcher or default Agent. An absent
`agents.runtime` setting resolves to the exported disabled setting. Reference
and generated projects add only the shared local CLI wrapper.

Definition and policy mutations use the fixed Admin operation registry and
existing staff session, current capability, reauthentication, idempotency, CAS
and audit transaction. Draft definitions freeze the existing canonical Agent
configuration and recipe definitions; activation verifies them and synchronizes
the same-site runtime principal. A runtime principal has deployment authority,
no user impersonation and no inbound Gateway credential. Per-Agent pause/resume/archive
invalidate its token version; archive is terminal. These server methods do not
add Agents/Policies/Budgets HTTP routes or complete their Studio views.
Activation and per-Agent resume require the same current dependency readiness
as runtime admission. The shared dependency-only check permits preparation
under a disabled or emergency-paused site; actual run/provider admission still
requires enabled, unpaused runtime settings. Repair cannot silently clear
containment.

Runtime admission currently admits an explicitly selected configured
`interactive-capability` recipe to a real `queued` runtime run. Other task
targets, manual input, event/scheduled fan-out, provider inference and the
planner remain their later slices. A queued row is not a claim that a worker,
model or capability ran. The existing Gateway paths and their evidence remain
independent of this explicit runtime installation.

The current Activity wire remains the existing Gateway capability projection.
A recipe-backed runtime run, including its valid zero-call/zero-token usage,
is not coerced into that projection. Runtime run detail and safe usage display
remain AP-507; this foundation preserves the existing unavailable/redacted
boundary instead of inventing a Gateway invocation or model activity.

## Frozen and current authority

Activation and every subsequent run/usage admission verify current Agent and
principal state, deployment identity, scopes, active version and canonical
hashes. One private `runtimeAdmissionSources` bundle retains the framework hard
policy/version, feature-setting hard policy, concrete deployment budget and
site budget. It contains no soft instructions. Existing canonical policy refs,
budget source refs, run limits, budget snapshot and admission fingerprints bind
that bundle to the immutable run. The shared source verifier checks those bytes
and links; it does not trust an unattached hash.

Current restrictions compose with frozen restrictions. Removing a permission
or lowering a ceiling affects the next admission, while later expansion cannot
widen an admitted run. Policy instructions remain distinct from deterministic
rules. Capability modes use the existing permission-set meet. Saved policy
layers permit at most eight quiet-hour windows each; their effective deny union
preserves all intervals and may contain more than eight windows.

Budgets reuse `NpAgentBudgetV1` and durable counters. Ordinary maximums and
warning basis points compose by minimum. Incident-analysis cooldown is a
minimum delay, so it composes by maximum; zero cooldown means no added delay.
Null inherits the outer concrete bound. Run and usage admission take the same
site advisory lock as settings and site deletion. Missing readiness or an
unmeasurable configured hard limit blocks new work.

## Usage without inference

The explicit usage service reserves integer token/call/USD-micros maxima,
records a pre-dispatch ledger fence and reconciles validated outcomes. It never
opens a secret lease or invokes a provider. A host-supplied source and
classification verifier is required before reserving a canonical provider
request; absence cannot be replaced with a permissive verifier.

`pricingEffectiveAt` is the immutable pricing evaluation instant of run
admission. Every provider-call and reservation copies that exact run pricing
tuple. `reservedAt` is the actual time of each reservation and is at or after
`pricingEffectiveAt`. A new reservation also checks that the frozen rule is
still eligible at its current time. Later catalog changes cannot reprice
already-admitted usage. Reconciliation verifies the retained immutable config
and pricing evidence, uses integer rounding and updates the daily ledger
atomically. Ambiguous dispatch keeps the maximum reservation charged; unknown
usage is never represented as zero. Bounded expiry is host-invoked and installs
no sweeper or automatic retry.

## Local emergency controls

The local process uses explicit environment/direct-database deployment
authority. `NP_AGENT_DEPLOYMENT_ACTOR_FINGERPRINT` is a configured non-PII
`cj1:sha256:…` fingerprint, not a credential or staff session. The CLI can
construct only the controls facade when it is explicitly invoked. It cannot
enable the runtime or install a readiness callback.

```text
nexpress agent runtime status --site <siteId> --json
nexpress agent runtime pause --site <siteId> --reason <text> --execute --json
nexpress agent runtime resume --site <siteId> --out <artifact> --json
nexpress agent runtime resume --site <siteId> --plan <artifact> --execute --approve <planId> --json
```

Every command requires one exact canonical site and emits one bounded
`np.agent-runtime-ops.v1` object in JSON mode. Status exposes enabled/paused,
the logical revision and six readiness states. It omits setting bodies, row
identities, private control evidence, raw reasons, provider output and errors.
Local pause is available without provider/MCP/worker/browser readiness; it
audits the deployment actor and a reason fingerprint, never the raw reason.
Repeating containment is idempotent. A new pause after a resume plan exists
invalidates that plan and advances the revision.

The private `agents.runtime.control` setting is exactly
`{revision,currentResumePlan,lastResumeReceipt}`. Absent authority starts at
logical revision 1. The same transaction updates it and `agents.runtime`;
configuration or containment changes invalidate any pending plan and receipt.
Both settings are excluded from content import/export.

Resume preparation persists one current plan and writes an atomic mode-0600
artifact, under `.nexpress/agent-runtime/` by default. It binds site, deployment
actor, settings revision/hash, live readiness fingerprint, issue/expiry times
and plan hash. Its lifetime is five minutes. The artifact alone is not
authority: execution requires the current matching persisted plan and exact
`--approve` id. It rechecks Doctor, policy, budget, Vault, integrity-key and
worker readiness plus the evidence fingerprint. Only Vault may be
`not-required`; missing/throwing/malformed or timed-out readiness is unavailable.
The explicit readiness callback receives an abort signal and must honor it;
the facade bounds each readiness wait to five seconds.

Successful resume clears pause, advances the revision and retains one consumed
receipt. Only the same actor and exact plan may replay that unchanged receipt,
including after the original plan expires. A newer settings change or pause
closes that replay. Staff resume retains the existing Admin
`{reason,expectedVersion,idempotencyKey}` envelope and uses a transaction seam
after staff admission/reauthentication; it performs the same live readiness
check and invalidates local plans without inventing a local artifact.

## Persistence, diagnostics and deletion

Generated migration 0046 adds nine tables: Agents, versions, policies,
triggers, provider calls, usage reservations, daily usage, circuit breakers and
events. It extends the existing runtime branch of `np_agent_runs`. The shared
migration generator adds reviewed lifecycle migration 0047 for the two Agent
version pointers and the run's causal event/action pointers. There are 40 Agent
tables, 265 critical constraints and 15 deferred lifecycle foreign keys.
Fresh scaffolds generate and verify the same empty foundation; no setting,
Agent, credential, provider or activation is seeded.

Doctor extends its existing aggregate projection with those nine entities,
state/age counts, runtime/source/control divergence, usage linkage and stale
reservation issues. Private settings and run-source checks use bounded cursor
pages and the same exact parsers/verifiers as admission. No row id, private
plan, settings body, instruction, raw provider error, credential or locator is
returned. This foundation does not claim the later runtime worker/readiness
dashboard or retention jobs of AP-508.

Ordinary site deletion inventories 39 tables; the saga marker remains excluded.
It deletes dependent calls/reservations/events before runs and definition rows,
preserves the existing deferred lifecycle rules and serializes on the shared
site lock. Nonterminal runtime work, reserved calls and unresolved
reservations fence deletion. Historical ambiguous calls become deletable only
when their reservation is reconciled/released with exactly one matching
`late-reconciled` audit receipt; removing or duplicating that receipt restores
the fence without rewriting the original call. Existing preview/execution/task/vault fences stay
authoritative.

## Self-review and repaired boundaries

- Staff admission now refreshes its clock and authorization after
  reauthentication/lock waits and before ordinary or raced replay. Expired
  sessions cannot extend their authority through a slow mutation.
- Activation and per-Agent resume share the admission dependency checks. Frozen
  policy and budget source bytes are verified, current reductions affect both
  root admission and reserved dispatch, and later expansion cannot widen a run.
  Existing multibyte definition and canonical run-idempotency bounds are retained.
- Provider request verification receives an independent frozen copy without the
  database handle. Retained config/pricing hashes, cached-token worst-case
  rounding and exact cost-source reconciliation protect the charged evidence.
  The pricing and credential clock is refreshed after connection lock waits.
- Budget measurement uses indexed time/state prefilters, preserves the rolling
  hour across a UTC month boundary and carries pending reservations forward.
  Unknown usage stays charged and is unavailable to the current numeric Activity
  projection. Late reconciliation preserves the original ambiguous call and
  requires its exact audit receipt before deletion can proceed.
- PostgreSQL verification corrected a Doctor query that referenced a nonexistent
  provider-call Agent column and fixed new-migration constraint ordering. The
  existing same-site call/reservation/run tuple remains authoritative; applied
  migration SQL is unchanged. Focused fixture type checking also exposed and
  resolved the existing request/body type mismatches without suppressions.
- CI also caught dotenv startup banners in the reference CLI JSON output. The
  reference environment loader now uses the same `quiet: true` options as the
  shared scaffold loader; the existing strict script smoke covers the boundary.
- Packed verification now distinguishes a migration-only scaffold with no site
  from a temporary ordinary site with disabled runtime settings. The existing CI
  foundation check exercises absent actor/site and safe default CLI results,
  removes its site fixture, then proves zero Agent rows/settings and healthy
  diagnostics. The CLI never creates the site or runtime authority.

## Deferred validation and remaining limits

No provider inference, credential lease or paid network call is exercised by
this foundation. AP-501 owns inference and a reference provider; AP-505 owns the
real context/classification producer and planner. Usage tests inject explicit
classified fixtures and validate the durable accounting boundary. The required
host verifier cannot be omitted or silently replaced with permissive fallback.

Event/trigger fan-out and jobs (AP-503), the run execution state machine and
planner (AP-505), automatic recovery/breaker policy (AP-506), runtime Studio
views/manual admission/reviewed policy-hash linkage (AP-507), and retention and
readiness producers (AP-508) remain unimplemented. Their new behavior is not
claimed as tested. Existing production browser flows are still revalidated.
Runtime usage requires its later client-safe unknown-usage projection; this
slice returns unavailable instead of supplying false zero totals.

The expanded Core declaration build needs a 6 GiB Node old-space ceiling; the
previous 5 GiB ceiling exhausted memory. The default build was raised and
revalidated. This affects build memory, not application runtime allocation,
package versions or published dependencies.

## Verification results

The final shared-source run passed on Node.js 22.23.2:

| Check                                                    | Result                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace `pnpm verify --concurrency=2`                  | 113/113 tasks; typecheck, unit tests and build, including the reference app                                                                                                               |
| Workspace lint                                           | 41/41 tasks                                                                                                                                                                               |
| Core unit tests                                          | 186 files, 1,772 tests                                                                                                                                                                    |
| Core PostgreSQL                                          | 10 files, 67 tests                                                                                                                                                                        |
| Full web PostgreSQL with native preview enabled          | 137 files, 1,290 tests; no failures or skips                                                                                                                                              |
| Runtime cases within that full web run                   | 108 tests: persistence 43, service 9, boundaries 19, usage 26, controls 8, operations/Doctor 3                                                                                            |
| Theme rendering within that full web run                 | 5 tests                                                                                                                                                                                   |
| Native preview browser security within that full web run | 1 test                                                                                                                                                                                    |
| Live Redis                                               | 2 files, 16 tests against an isolated Redis 7 container                                                                                                                                   |
| Production Playwright                                    | 62 tests, including Activity and theme switching                                                                                                                                          |
| Packed fresh scaffold                                    | 40 packages, 56 stages; external install, typecheck, generated/applied migrations, empty foundation and runtime CLI boundaries, build, extension matrix, script module probes and journey |
| Focused integration/fixture typecheck                    | All new runtime integration files and their imported fixtures; zero errors                                                                                                                |
| Final source checks                                      | Formatting, `git diff --check`, environment-secret scan of changed files/diff/logs, unchanged versions/changesets and unchanged root lockfile                                             |

The default workspace test pass skipped the three environment-gated Redis
cases; the separate live run executed all 16 Redis cases successfully. The
full web run enabled `NP_TEST_PREVIEW_BROWSER=1`, so native preview and all five
theme-render tests were executed. No implementation-scope test remains skipped.
The packed script probes intentionally use unavailable dependencies to check
module resolution; they do not claim a running worker or provider.

The final full web run supersedes the earlier focused run that exposed the
Doctor query issue. Packed verification was rerun in full after correcting its
initial assumption that a migration-only scaffold already contained a site.
The corrected CI check now proves both the absent-site failure and the disabled
existing-site result, without seeding Agent authority.

All 46 previously tracked migration SQL files are byte-for-byte unchanged.
Only the new generated 0046/0047 chain and snapshots extend the schema. The final
review found no remaining implementation-scope issue. No package version or changeset is included; the remaining R5 boundary is
listed above.
