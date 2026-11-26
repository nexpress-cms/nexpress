# R7 approved temporary request limits and recovery

This slice adds explicitly installed, human-approved request containment to the
[Guardian observations](r7-guardian-observation-flow.md). It complements existing
application authentication, rate limits and upstream WAF/IDS/SIEM. A threshold,
Incident, report, model output or imported label grants no response authority.
It does not complete AP-701/AP-704 or the full R7 gate.

## Ownership and installation

- `createAgentGuardianResponseServiceV1` owns staff planning, signed Approval
  targets, execution staging, verification and expiry reconciliation. The host
  installs it as optional Studio `guardianResponses` and routes its two
  `approvalTargets` capabilities through the existing Approval action router.
- The host supplies the current policy digest, permitted closed scopes, maximum
  duration, current per-user Incident ACL, current request-enforcement coverage
  check, existing Approval service and exact installed adapter. Null policy or
  absent service grants no new authority. There is no default production grant.
- `createAgentPostgresRestrictionAdapterV1` reuses the initialized host DB handle.
  Its durable enforcement rows are shared across replicas. It opens no pool and
  changes neither the process-local rate limiter nor its adapter contract.
- `npCreateAgentGuardianRequestEnforcerV1` is installed explicitly as the proxy's
  optional `onGuardianRequest`. It checks the existing shared adapter before the
  ordinary rate counter. The host independently initializes this entrypoint and
  resolves public hostname/site and trusted network address. Admin site-picker
  headers/cookies and request prose cannot choose the enforcement tenant.
- The same host owns projection/key retention and verifies that the selected
  subject/scopes are actually enforceable by its installed proxy. Installing
  only the Studio owner is not proof of a deployed enforcement entrypoint.
- An already explicitly registered Runtime jobs host can inject
  `guardianRestrictions: service`. Its existing site-scoped reconciliation job
  then invokes bounded cleanup. `service.reconcile({siteId, limit})` is also an
  explicit maintenance seam. Nothing registers or starts a worker by default.

The generated additive `0072` migration creates workflow and enforcement tables;
`0073` adds their statement/row reference fences. The shared migration generator
appends the same V11 extension without changing historical V1/V10 SQL bytes.
The existing content-only containment table and Member Community-ban workflow
retain their own contracts. Actor restriction rows own this slice's independent
containment lifecycle; no content snapshot or content rollback handle is invented.

## Exact target, approval and execution

Only verified Guardian Incidents with the server-resolved `network-address`
subject are eligible. Login-identifier buckets and client/model supplied subjects
are not executable targets. The server intersects observed source scope with the
host's sorted allowlist. Login observations select their staff/member audience;
supported traffic families select only the implemented request scope. Duration
is 60–3,600 seconds and cannot exceed current host policy.

Planning creates an immutable Action and pending signed Approval, without
installing a restriction. The existing Admin admission binds stable idempotency,
current staff/session/site authority and a mandatory audit. The exact Incident
version, target-version digest, operation, scopes, duration, policy and frozen
adapter identity bind the proposal. A different current staff user must approve
it with recent primary reauthentication. Execution rechecks requester, approver,
item visibility, Incident version, policy, scope coverage and the exact Approval;
it consumes that Approval once. Public Gateway/model registrations are unchanged.

The workflow commits a pending restriction and executing Action before calling
its independently durable adapter. The execution invocation's hashed result
binds the exact restriction id/hash and adapter triple. Descriptor start/duration,
consumed Approval and actual execution invocation are verified again before
reconciliation. Current authority/coverage is rechecked before first dispatch.
A result-persistence failure cannot roll back the record of an authorized effect.
Only exact install plus read-side verification establishes an active restriction.
The installation receipt, effect audit and Incident timeline retain their bindings.

Unknown effects stay pending/executing with a safe error. **Check result** verifies
the same retained effect; it does not silently execute another install. If a
first dispatch never installed anything, a read-side absence is not reported as
successful containment. It remains unresolved until approved removal or expiry
cleanup. No new invocation authority, provider call or automatic retry is inferred.

ChangeSet preview blocks planning/execution, maintenance and direct adapter
install/remove before mutations or adapter database access.

## Request enforcement and rotation

The proxy returns the existing generic 429 envelope and bounded `Retry-After`
only for an exact, verified same-site subject/scope match. Raw address, account,
opaque bucket and restriction identity are absent from this response.

The closed route inventory covers staff/member login and refresh, Agent Gateway
POST endpoints, and selected collection content/community mutations. Read,
logout, account recovery, custom plugin and other undeclared mutation paths are
outside that inventory. `content.write` and `community.write` therefore describe
supported request routes, not every possible application write. Broader coverage
requires an explicit later adapter/integration change and its tests.

The shared V1 projector preserves the observation slice's existing canonical-JSON
HMAC bytes and network normalization. It does not silently migrate existing
subjects to the design document's separately described length-framed projection.
Its fingerprint and key id remain frozen. A key id identifies immutable key
material; rotating material requires a new id and retention of referenced old keys. A future projection must be explicitly
versioned and retain required old implementations.

Checks derive the current candidate plus every distinct still-active frozen
projection/key candidate from the same trusted request address, maximum eight.
No raw address is stored or recoverable from this metadata. Unknown keys,
projection versions or excess candidate pressure degrade to ordinary controls;
new verified limiting must remain unavailable under that deployment condition.
The PostgreSQL owner rejects a ninth active frozen candidate atomically.
Metadata enumeration is by distinct projection, not an arbitrary actor-count cap.

Proxy work has a bounded host timeout and four outstanding calls per installed
helper. SQL uses local lock/statement bounds. Adapter timeout, malformed output,
unknown subject or unavailable health never fabricates a denial or successful
containment; the contained host degraded callback can report the condition.
Existing authentication, CSRF, rate-limit rules and fallback outcomes retain
their owners. SQL/pool/host lifecycle budgets remain separate boundaries.

## Removal, expiry and durable recovery

An early removal is a new exact plan and separately signed human Approval. It
can remove only this workflow's restriction id/source Action, including an
uncertain installation. Independent restrictions remain effective. The removal
Action's own consumed Approval and execution invocation must match before an
adapter call; an unexecuted removal plan cannot become cleanup authority.

The adapter records a permanent exact-descriptor tombstone even when removal
finds no installed row. A delayed install cannot resurrect access restrictions
after early removal or expiry. Mutation keys remain stable per descriptor
operation/generation; mutable workflow CAS versions do not change those keys.

Access is restored at the exact TTL by request checking even if maintenance is
absent. Expiry reconciliation removes using the frozen adapter and stable
`expire:<id>:1:<expiresAt>` key. It requires confirmed `removed|already_absent`
and a matching absent verification before marking the workflow expired and
releasing its active uniqueness guard. Unknown cleanup stays visible/retryable.
A previously verified successful source Action converges to compensated. If
activation was never established, cleanup preserves that distinction instead of
inventing successful prior containment.

Stable unexpired active rows are not rewritten or re-audited on each maintenance
run. Bounded attempts rotate by CAS generation and timestamp so an old unavailable
row cannot indefinitely occupy the first batch. Changing current installation
semantics does not authorize a newer adapter to clean up an older descriptor;
the exact retained implementation must remain available. Incident resolution does
not itself remove a request limit.

## Retention, deletion and privacy

| Record                              | Protection in this slice                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Active/pending/removing restriction | Preserve descriptor, frozen projection/adapter, Action, Approval and audit; unknown outcome is unresolved work                    |
| Terminal workflow                   | Retained by default; no new automatic history-pruning policy                                                                      |
| Enforcement/tombstone               | Retain exact descriptor/idempotency evidence against delayed installation; expiry changes access immediately                      |
| Incident and source history         | Guardian workflow references block ordinary Incident-history pruning                                                              |
| Site deletion                       | Block active/unknown/nonconfirmed effects; require exact confirmed terminal cleanup evidence before the existing ordered deletion |

The browser receives target-version digests, permitted scopes, duration, safe
states, Action/Approval/restriction ids and expiry. No raw network/login facts,
HMAC key, opaque executable bucket, descriptor or execution evidence is projected.
Versions, changesets, workspace lockfile and default service activation are unchanged.

## Verification and remaining boundary

Local verification on 2026-10-18 used synthetic accounts, isolated PostgreSQL/Redis,
fake model/transport fixtures and local production builds. No paid provider call,
external delivery or production worker/Runtime activation was performed.

| Check                | Accepted result                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace code gate  | `pnpm verify --concurrency=2`: 113 tasks passed, including Core 2,474, App 786, Admin 202 and Web 164 unit tests                                                                                   |
| Final lint and types | `pnpm lint`: 41 tasks passed; explicit App migration-script and integration-fixture typechecks passed                                                                                              |
| Core PostgreSQL      | 71 passed                                                                                                                                                                                          |
| Web PostgreSQL       | 1,833 passed; the one opt-in native preview was skipped here and run explicitly below; theme rendering's five cases included                                                                       |
| Native preview       | 1 passed with `NP_TEST_PREVIEW_BROWSER=1`                                                                                                                                                          |
| Redis                | 16 passed with an explicit isolated Redis URL                                                                                                                                                      |
| Production browser   | 130 distinct scenarios: initial full run 129 passed plus the Guardian scenario passed after a fixture timestamp correction; no retries, skips or flaky cases; 390px capture inspected              |
| Packed consumer      | 40 fresh archives; fresh CLI scaffold/install/typecheck/production build; all three Guardian routes present; seven generated extensions type-built and six plugin registration lifecycles verified |

The final DB gates used native PostgreSQL 18.3 with `fsync`, `full_page_writes`
and `synchronous_commit` all `on/default`. Earlier Docker-unavailable and
durability-disabled attempts are diagnostic only. The complete DB-dependent
gate was rerun after correcting that local configuration. Earlier focused
PostgreSQL 16 results are separate evidence, not the final full PostgreSQL run.
This local environment differs from hosted Ubuntu/Node 22/PostgreSQL 16 CI.
Native test services were stopped and test media moved into ignored evidence.
Cleanup of the original Docker container remains unverified while its engine
is unavailable; no global Docker restart was attempted.

The eight Guardian workflow and six shared-adapter SQL cases are included in the
Web gate. They cover distinct signed approval, current authority drift, exact
site/scope isolation, duplicate dispatch, lost receipts, descriptor tampering,
TTL access recovery, early-removal tombstones, unexecuted removal plans, CAS
rollback and confirmed site deletion. All four new reference-fence triggers were
also checked in the fresh installed consumer's real PostgreSQL catalog.

The Guardian browser scenario uses strict parsed HTTP fixtures. Its original
approval timestamp exceeded the existing seven-day bound; only that fixture
time was corrected before the focused rerun. The parser and product code were
unchanged. This is combined distinct coverage, not one green full browser run;
actual signed Approval and enforcement remain covered by the SQL gates.

The workspace code gate preceded a test-only bound-method lint correction;
the affected preview tests (5), Core typecheck and final workspace lint then
passed. Existing Admin evaluation-history code retains one unrelated lint warning.
Versions, lockfile, generated collections and the pre-existing handoff diff were
preserved; the feature documents passed link/format checks and `git diff --check`.

Consumer parity checked 658 producer JS/declaration files, 612 raw App files and
1,255 installed-file comparisons. The default app has 34 installed public
packages and 34 physical copies, with no duplicates. Six other archives are not
default app dependencies; their archive parity was checked, and the packed CLI
was executed. The extra installed SQL/enforcer smoke proves installed primitives;
the signed Approval/service paths remain covered by the separate Web SQL tests.
Closed-port script probes prove module loading only, not successful operations.
Raw consumer receipts include diagnostic/corrected attempts and must not be
reported as one aggregate count of successful acceptance stages.

Ignored receipts are retained under `node_modules/.cache/np-guardian-response-validation`,
`np-guardian-response-consumer` and `np-guardian-response-browser`. These local
results do not establish deployed enforcement, crash/failover tolerance, attack
detection accuracy or a hosted CI result for this bundle.

Exact session-family revocation, additional collectors, wider route coverage,
external security integrations, security export/Doctor recovery UX, model-assisted
summaries and the full adversarial/threat-review/production usefulness gate remain
separate R7 work. This approved request-limit slice does not authorize unattended
security responses or establish attack-detection accuracy.
