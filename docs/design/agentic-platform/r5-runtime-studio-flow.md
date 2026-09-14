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
all fourteen installed mutations. HTTP returns only the existing execution
result's resource id and replay flag, and the UI refreshes the authorized read.
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

## Remaining boundary

This slice does not claim the full R5 gate. Advanced policy simulation remains
unavailable until a bounded owned simulation fixture/engine contract exists;
no successful simulation is fabricated. Broader dependency-safe retention and
future recipe execution surfaces remain separate work. Existing host-only
Runtime controls, event jobs and retention behavior remain intact.

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

Local verification completed on 2026-09-14:

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

No live provider inference or unowned policy simulation was run; neither is part
of this installed surface. The full R5 acceptance gate remains open for the
remaining product/retention scope above. No package versions, changesets,
lockfile, schema or migrations were changed. These results describe the local
acceptance checkpoint; current integration status is tracked in the
[current handoff](../../agent-guidance/current-handoff.md).
