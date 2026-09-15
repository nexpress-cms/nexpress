# R5 Runtime Studio management and operations

This AP-507 management slice and related AP-508 visibility connect the existing
Runtime services to staff-only Agent Studio. Hosts explicitly install
`runtimeStudio` into the existing Studio runtime; absence stays unavailable.
Nothing creates a provider, worker, deployment authority, seed or enabled setting.

## Shared boundary

The pure Runtime Studio contract fixes the read route inventory, exact editable
configuration/policy projections, bounded pages, opaque cursors, catalog,
effective review, budget, operational overview and mutation acknowledgement.
Lists use creation time descending plus id descending, with 25 default and 100
maximum entries. Cursors bind current site, staff session and authority, the
inventory and complete filters, with a fifteen-minute expiry. Unknown and
repeated HTTP query keys fail closed. Responses are validated at the service
and HTTP boundary; malformed host responses never become browser data.

The existing configuration, policy, budget and emergency-control commands own
all fifteen installed Admin operations. Ordinary mutations return only the
resource id and replay flag; simulation returns its exact non-authorizing report.
The UI refreshes the authorized read after ordinary mutations.
Current staff capability, primary reauthentication, CSRF, CAS, idempotency and
audited transactions remain authoritative. No parallel mutation registry or
new auth fallback is introduced.

## Activation and manual admission

Agent create/edit uses typed forms and the installed recipe/capability/model
inventory. Explicit self-delegation reuses the existing create authority field;
it is never inferred from creator identity. Provider model choices reproduce
retained configuration and pricing evidence through the existing adapter parser.
Catalog metadata is discovery, never authority or proof of provider readiness.

Effective review invokes the owning service's existing activation validation.
The default selects the draft when present; resume review explicitly selects
the active version. Compare-only policy references and an optional exact
trigger plan extend the existing activation command (contract version 2).
Activation and immutable same-version trigger registration commit together.
The invocation request digest binds the reviewed plan. Replacing trigger
behavior requires a replacement version and fresh trigger identities; historical
trigger rows are not silently rewritten. Saving an ordinary draft does not
persist an unactivated trigger plan.

Run now uses an enabled registered manual trigger for the active version and a
compatible installed interactive recipe. Its existing `inputJson` field accepts
only the exact recipe id and bounded goal. The shared Admin transaction calls
Runtime admission with the same database transaction; the admitted Run is the
durable outbox. Goal and idempotency are frozen in canonical admission. Prompt,
scope, model, target and unsupported structured-input extensions are rejected.
Recipes needing a non-null manual input schema are not offered by Run now until
their existing executor has an owned storage/consumption contract.

## Operational truth and redaction

Budgets distinguish deployment, saved site and effective ceilings. A site limit
may increase within the deployment ceiling. Agent settings may only narrow the
effective site ceiling. Unresolved provider outcomes make measurement unavailable;
unknown spend is not zero or spare capacity. Existing reservation/daily buckets
remain the accounting source.

The operational overview reuses the existing safe Runtime status and maintenance
aggregates for queued runs, pending/expired events and due triggers. Unavailable
aggregates stay null. Staff reads use the shared transaction seam without
borrowing local CLI deployment authority. Emergency site pause is separate from
pausing one Agent; resume still performs current readiness validation.

Activity reuses the existing current-item authorization and redaction. The exact
empty Runtime usage marker projects as `usage: null`, displayed as Unknown,
instead of hiding the whole Run. Gateway usage retains its exact numeric
contract. Malformed nonempty usage remains unavailable. Canonical goals,
execution input, raw provider bodies, locators, credentials, policy source
bodies, internal errors and chain-of-thought remain outside activity projection.

## Bounded policy simulation

`agents.policies.simulate` now owns a fixed canonical v1 synthetic fixture.
The existing Admin operation's v2 output is an exact bounded report; this
contract version does not change package versions. The fixture contains only
the version and suite identifier. Arbitrary facts, duplicate JSON keys,
noncanonical JSON and mismatched fixture hashes are rejected.

The server verifies the selected policy row version/content hash and loads the
real framework and site-setting policy layers. A site-policy candidate replaces
the selected site-policy layer; an Agent override also intersects the current
active site policy. Four synthetic configurations use the existing
`npResolveAgentPolicyV1`, autonomy permission checks and UTC quiet-time evaluator.
The report contains effective enforced rules and five fixed UTC probes, never
guidance, raw historical facts, credentials, execution input or provider output.
It is explicitly a policy-only snapshot: principal authority, capability
descriptor floors, budget and provider readiness still belong to real admission.

Simulation uses the same current staff admission, CSRF, CAS, idempotency and
audit transaction as the existing policy operation. It cannot activate a policy,
create a Run/action/reservation, invoke a capability or call a provider. Replays
return the original snapshot after current access checks. Unknown-outcome UI
retries preserve the key; refresh/edit/version changes discard the report and
access loss removes the resource. Reference and scaffold routes remain wrappers.

## Remaining boundary

[Dependency-safe Runtime retention](r5-runtime-retention-flow.md) extends the
existing explicitly registered maintenance sweep. Audit-referenced Run/call
history and action source references remain protected until their owning
verified-reference lifecycle can release them. No migration or unverified
reference detachment is introduced to claim full R5 completion.

Structured manual-input recipes remain unavailable until an executor owns their
canonical storage and consumption. R5 bounded manual admission supports the
installed schema-null interactive recipe and bounded goal. Template-specific
Publisher/Moderator/Operator execution belongs to R6; the fixture metadata alone
does not fabricate that support. Historical-fact simulation remains unavailable.

## Self-review corrections

- Archived Agents that never activated retain their real immutable version for
  detail/list reads and connection filtering, without recreating a draft pointer.
- Errored Agents expose the existing reviewed resume command for their active
  version, with the same current readiness checks as paused Agents.
- Runtime unknown usage is consistent across Activity and OpenAPI; the Gateway
  schema still requires exact numeric counters.
- Browser assertions target the actual form error instead of the Next route
  announcer. Management tests reuse the existing API login fixture, preserving
  login form coverage without exhausting an unrelated shared IP quota. The
  existing in-page editor fixture also isolates its preview request bucket using
  the established preview-test header pattern; production limits are unchanged.

## Verification

Previous management-slice verification completed on 2026-09-14 (not evidence for
the subsequent simulation/retention changes):

| Gate                                          | Result                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace `pnpm verify`                       | 113 successful tasks, including typecheck and production builds                                                                      |
| Workspace lint                                | 41 successful tasks                                                                                                                  |
| Core unit                                     | 1,911 passed                                                                                                                         |
| Admin unit / App unit / reference web unit    | 149 / 571 / 151 passed                                                                                                               |
| Core PostgreSQL                               | 68 passed                                                                                                                            |
| Web PostgreSQL                                | 1,418 ordinary cases across the full and corrected runs, including theme-render 5                                                    |
| Runtime Studio PostgreSQL                     | 17 passed, included in the ordinary inventory                                                                                        |
| Native preview                                | 1 passed with `NP_TEST_PREVIEW_BROWSER=1`                                                                                            |
| Live Redis                                    | 16 passed against an ephemeral Redis container                                                                                       |
| Production Playwright                         | 67 passed in the final complete run                                                                                                  |
| Packed fresh scaffold                         | 40 packages / 56 stages passed, including generated migrations, foundation/Doctor, production build and extension/first-run journeys |
| Formatting / diff / secret and version checks | Passed                                                                                                                               |

The full Web PostgreSQL run passed 1,417 cases and exposed one prior expectation
that unknown usage hid an entire Run. Its updated null-usage/redaction assertion
and all 26 provider-usage tests passed in a fresh isolated database. The native
browser test is deliberately gated out of the ordinary run and passed separately;
Redis was also run explicitly instead of relying on the unit suite's optional
integration skip. An initial quiet Web database run was interrupted and replaced
by the complete post-build run above. Browser fixture corrections were verified
by a fresh complete 67-test run. No required local test remains unexecuted.

At that checkpoint no live provider inference or policy simulation was run. The full R5 acceptance gate remains open for the
remaining product/retention scope above. No package versions, changesets,
lockfile, schema or migrations were changed. These results describe the local
acceptance checkpoint; current integration status is tracked in the
[current handoff](../../agent-guidance/current-handoff.md).

## R5 completion audit and current verification

The five roadmap safety gates map to the existing Runtime admission/context/
usage, installed-capability, event/job replay and circuit-breaker suites.
`agent-runtime-isolation.integration.test.ts` adds the missing direct regression
that an injected provider failure still permits normal collection pipeline
create/read/update and an unrelated built-in maintenance handler. It uses the
real Run/usage journals; it does not claim a live external provider call or
fresh-process bootstrap proof.

Current simulation/retention verification on 2026-09-15 KST:

| Gate                                         | Result                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Production workspace build                   | 41 successful tasks                                                                                     |
| Workspace `pnpm verify --concurrency=1`      | 113 successful tasks                                                                                    |
| Workspace `pnpm lint`                        | 41 successful tasks                                                                                     |
| Core / Admin / App / Web unit                | 1,920 / 149 / 572 / 151 passed                                                                          |
| Core PostgreSQL                              | 68 passed in 10 files                                                                                   |
| Web PostgreSQL                               | 1,433 passed in 158 files, including theme-render 5                                                     |
| New simulation / outage isolation PostgreSQL | 4 / 1 passed, included above                                                                            |
| Runtime maintenance / retention PostgreSQL   | 9 / 4 passed, included above                                                                            |
| Native preview                               | 1 passed separately with `NP_TEST_PREVIEW_BROWSER=1`                                                    |
| Live Redis                                   | 16 passed against an ephemeral Redis container                                                          |
| Production Playwright                        | 69 passed in one complete run against an isolated migrated database                                     |
| Packed fresh scaffold                        | 40 packages / 56 stages passed, including migration, production build, extensions and first-run journey |

The ordinary PostgreSQL run deliberately skips the one native browser case;
its explicit run passed. Redis was also enabled and run explicitly. The new
browser cases cover report binding, unknown-outcome retry identity, stale
policy evidence and access loss. The retention suites include real advisory
lock contention and rollback, not only mocked timeout checks.

On the 16 GiB local host, interrupted high-concurrency checks were replaced
by complete serial runs. Web ESLint needed an 8 GiB heap for its existing
type-aware inventory; that was a command-local Node wrapper, with no package,
script or global configuration change. An initial browser attempt used a
stale local database and was stopped after missing-table failures. The final
69-case run used a fresh disposable database initialized by the existing
`db:migrate` command, then removed it. Neither that recovery nor the packed
scaffold modifies repository migrations. The scaffold gate's previous
simulation-route exclusion was updated to the shipped 24-route inventory,
with a packed pure simulation smoke check. Host absence, disabled defaults,
empty Agent authority/settings and healthy disabled diagnostics remain required.

Full R5 remains open where required retention evidence has no release owner;
a passing software gate does not remove that product boundary. No external
provider inference, Runtime activation or new credentials are part of this
verification. Package versions, changesets, lockfile, schema and migrations
remain unchanged. These are local pre-merge results; current integration status
is recorded in the [current handoff](../../agent-guidance/current-handoff.md).

[PR #1445](https://github.com/nexpress-cms/nexpress/pull/1445) was squash-merged
as `9a87712f618e74742558ceae788d030dcf503e9c` on 2026-09-14 UTC.
[CI run 34874219970](https://github.com/nexpress-cms/nexpress/actions/runs/34874219970)
passed all four checks on exact PR head `9899d673e625fb27475f573e5f31dd4d71551563`:
typecheck/build/test, PostgreSQL integration, production Playwright and packed
fresh scaffold. This is PR acceptance evidence, not a full R5 product completion
claim or evidence of a later main-branch CI/Release run.
