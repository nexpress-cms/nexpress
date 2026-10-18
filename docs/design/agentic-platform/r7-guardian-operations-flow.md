# Guardian operations and retained evidence

This describes the explicitly installed R7 operations owners. Implementation and
the outstanding acceptance ledger are tracked in the
[completion plan](r7-completion-plan.md). It does not establish production shadow
evidence or authorize unattended responses.

## Status, disable and recovery

`guardian.signals` in Doctor and system health reports a bounded sample of
registered detectors, current control state, recent Signals, critical Incidents,
notification failures and historical proof coverage. Missing verifier/key
registration means unavailable proof, including when no retained rows exist.
It is not a verified healthy zero. Unconfigured controls preserve capture only
for explicitly installed sources; an absent source stays disabled. A present
null or malformed control is unavailable, never equivalent to an absent row.
The CMS and Runtime outbox delivery counts separately distinguish pending,
blocked, held and capped source receipts, with truncation flags.

The local deployment CLI uses the existing application bootstrap and explicitly
installed control owner:

```sh
nexpress agent guardian status --site site-example --json
nexpress agent guardian disable --site site-example --reason "operator recovery" --execute --json
nexpress agent guardian enable-plan --site site-example --out ./guardian-plan.json --json
nexpress agent guardian enable --site site-example --plan ./guardian-plan.json --execute --approve PLAN_ID --json
```

The enable plan expires after five minutes. `PLAN_ID` is the exact ID returned
by the persisted plan, not a new token or model output. Execution rechecks the
site, control generation, deployment actor, installed source fingerprint and
current capture-key readiness. A stale or changed plan must be rebuilt. The
private plan file is written atomically with mode `0600`; no key material is in
the artifact. Local fallback can inspect or disable; it cannot infer a source
registration or enable a missing host owner.

Disable stops new capture/collection and new restriction/session response
admission. It preserves Incident history, safe exports, approval rejection or
revocation, effect verification, early removal and TTL recovery. The actor-limit
dispatcher probes adapter readiness first, then serializes fresh admission
against disable and the current policy/approval generation. Already-admitted
external I/O may finish after disable; its existing durable Action/Restriction
staging records a possible effect. An ambiguous outcome requires verification
and adapter idempotency, never an assertion that only one network attempt
occurred. Re-enable does not revive an old response approval. Exact session
revocation always retains separate human approval.

Guardian capture disable is distinct from Runtime pause. Neither activates a
worker, model provider, credential, capability, automatic response or transport.
Retained-history advisory analysis remains subject to its explicit Runtime
admission and usage/lease/policy controls.

Automatic temporary limits have a separate deployment-authorized admission
owner. It requires the actual authenticated request-source factory, an exact
five-event rule and separate verified staff escalation; it does not turn a
medium source Signal into high severity. Only the selected staff/member auth
scope, exact source rule, current evidence-age window and currently permitted
policy may qualify. Current trusted deployment qualification
must verify review, shadow, NAT-impact, compensation and approval artifacts.
Missing evidence keeps admission disabled. Limits bind one auth scope, the exact
source/Incident generation, current policy and adapter fingerprint, with a fixed
60–900 second TTL. Replay and maintenance cannot renew it or dispatch a fresh
effect. Existing durable verification and expiry cleanup remain available after
qualification/source-key loss or capture disable, using the retained effect proof.
The 21-case local PostgreSQL suite uses synthetic qualification and does not
supply actual production review, shadow, NAT-impact or operator approval.
Without that current qualification the installed path remains disabled.

## Bounded source and automatic work

Requests and HTTP use a 750 ms work deadline, Runtime collection uses 5 seconds,
and automatic authority work uses 1000 ms. The actual owning transaction callback
rejects on expiry and closes its DB scope. Saved builders, prepared queries and
nested savepoints cannot issue late writes after that scope closes, including
when the same PostgreSQL connection has been borrowed again. The automatic
admission budget also covers its post-mutation exposure recheck; stored transport
lookups have bounded prework. Ordinary manual admission retains its existing
behavior unless the trusted server caller opts into a transaction budget.

The deadline bounds application work; existing active SQL may still drain up to
its 500 ms statement timeout plus rollback/driver time. Runtime collection leaves
an honest partial/unknown backlog near its deadline and never presents partial
source proof as a successful detector. Source caps and disabled/unavailable
states do not become recorded coverage.

## Reference and retention matrix

| Evidence                                                    | Permitted lifecycle                                                                                                            | Holds                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Live Incident and Signals                                   | Current Incident owner                                                                                                         | Active/unresolved Incident, unknown rule, unavailable historical proof                                                        |
| Closed observational Incident cohort                        | Exact source rule reconstruction, canonical Signal/Event binding, registered historical source proof, age and delivery closure | Any Action/advisory/approval/audit/notification/opaque reference outside the verified cohort; cross-site references also hold |
| Guardian Event                                              | Explicit Guardian retention owner after exact source proof and delivery closure                                                | Active evidence, future/unknown source, unverified MAC/key, job/checkpoint/setting/audit/owned-row references                 |
| Emitted CMS/Runtime receipt                                 | Verified receipt MAC and Event binding, deleted before its eligible Event                                                      | Pending, blocked or held state; external logical references                                                                   |
| Capped CMS/Runtime receipt                                  | Age, actual receipt MAC and closed delivery window                                                                             | Unverified source, external references; capping never proves complete coverage                                                |
| Source/closure audit                                        | Retained original audit and immutable release edge                                                                             | Required permanently by its compact source release; current profile soft deletion preserves actor IDs                         |
| Request-source Event lacking an actual historical MAC owner | Conservative hold in the new Guardian owner                                                                                    | Canonical hashes or actor-bucket key IDs alone do not manufacture MAC verification                                            |
| Terminal response/advisory graph                            | Currently retained until its exact lifecycle owner can prove safe release                                                      | Unknown usage/outcome, rollback/approval/audit/retry evidence; nominal age alone grants no deletion                           |

Runtime receipts retain real restrictive Agent/version/Run/principal references
and bounded references to the actual Action/provider/accounting proof. Even
unreferenced emitted or capped receipts stay held while the Run or an Action
is active, provider dispatch is unresolved, or cost/usage is unknown. An aged
terminal Run and settled/released accounting are necessary conditions, not
sufficient deletion authority. Generic Runtime pruning skips exact Guardian
source pairs; it cannot bypass the Guardian owner.

HTTP Events use short-lived private network buckets. Their durable source
audit retains only site, receipt/Event identifiers, key id, hashes, recorded
time and MAC; it does not copy the activity or bucket. Source audit preservation
after deletion establishes compact attribution, not recovery of deleted facts.
Current member deletion soft-deletes/anonymizes the profile while preserving
its ID and audit attribution. No hard-delete or erased-audit-actor compatibility
is inferred from that path.

Signed request observation uses an explicit integrity key independent of its
actor projection key and a mandatory same-transaction source audit. Verification
requires the original Event hash, persisted recording time, independent receipt
UUID and retained key. Exactly one valid source audit must exist. A configured
signed source rejects missing, duplicate or altered receipts, including an
unsigned historical retry; it never signs that history after the fact. The
no-key manual source keeps legacy replay without claiming authentication.
Safe release retains the original source audit and immutable audit edge, which
Doctor requires for requests as well as the other source families. A missing
required edge is an orphaned relation, even when a compact release hash is valid.

The retention policy bounds Event detail at 1–14 days, receipt detail and Signals
at 1–90 days, and closed history at 1–365 days. These ages are eligibility
conditions, not unconditional deletion deadlines. Existing host-registered
`agent:retentionPrune` jobs can invoke the explicitly injected Guardian owner;
its bounded durable cursor advances without holding a Runtime lock across the
owner call. Concurrent job cursor updates use generation comparison so a stale
completion cannot rewind newer progress. Missing installation does no Guardian
scan, closure or pruning.

Each source family has a stable namespace independent of rotating key IDs and
a monotonic UTC ten-minute delivery boundary. The boundary denies historical
delivery; it neither claims ingestion completeness nor authorizes deletion.
An old closed request or external signal is ignored. A CMS write may have been
captured in a transaction before closure and commit afterwards: the collector
verifies its receipt and preserves it as `held/DELIVERY_CLOSED`, without emitting
an Event or reopening an Incident. An operator must investigate held/blocked
counts; automatic age pruning never discards them.

After safe Event release, a compact digest of its exact source delivery key
remains consumed. Reusing that key with a fresh timestamp is denied. A compact
record proves retained attribution and prevents reuse; it cannot reverify a
deleted Event MAC or grant a successful replay. Doctor validates the exact
original closure audit even after the current boundary advances. Keep historical
keys registered while live protected evidence still requires their verifier;
retiring a key produces unavailable proof and a retention hold.

## Explicit source installation and coverage

All source services require explicit host installation with existing host-owned
keys and service dependencies. Constructing a source does not start workers,
register a route, load a secret, enable an Agent or call a provider. Bootstrap
setters for collection, authority, sensitive-change and Runtime observers are
host-only seams; they are not capabilities or Admin mutation inputs.

| Source family        | Committed or authenticated owner                                                                                                                                  | Limits and interpretation                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests             | Actual failed login/rejected rate-limit owners with optional independent per-Event receipt MAC; exact successful browser-family evidence remains separately owned | Fixed bounded buckets; existing first-line lockout/rate limits remain independent                                                                          |
| Security transitions | Authority/policy, password/reset, Gateway token/principal, Connection final credential CAS, plugin persistence/config and shared local CLI facade                 | Actual same-transaction facts; full locked catalog for deployment impact; keyed state commitments exclude secrets/config bodies                            |
| Content              | Actual document save and newly inserted autosave revision                                                                                                         | Source-only capture; repeated autosave reuse emits no new fact; scheduled publication/deletion are separate owners                                         |
| Runtime              | Actual Action INSERT, terminal repeated proposal/scope denial and call-linked accounting transition                                                               | Source-only capture; proposal pair, five scope denials or admitted Actions, or USD 0.10 of known cohort cost; unknown actual cost never becomes zero/spend |
| HTTP                 | Actual final 401/403/404 response at explicit App/auth/proxy/Agent owners                                                                                         | Five distinct responses per exact status/family/network bucket in a UTC ten-minute window; no raw URL, body, address or attack verdict                     |
| Sentry               | Fixed installed site/project signed `issue-created` ingress                                                                                                       | Authenticated external fact only; no outbound request or invented source severity                                                                          |

Inject Runtime collection through the existing `guardianRuntime.collect`
maintenance option, and content through `guardianContent.collect`. Register
source proof owners separately for Operations, health and retention; missing
historical key/implementation remains unavailable even when capture is disabled.
The Runtime advisory source uses its private proof facet only after the actual
Runtime Incident ACL, and rechecks current access/generation after composition.
Its facts keep provider reported, adapter estimated, unknown and released
accounting distinct. No advisory grants response authority.

Credential-stuffing advisory eligibility requires the explicitly injected actual
authenticated request source, exact verified login-failure rules and the currently
selected recipe's audience, failure count, account-bucket diversity and actual
observation span within its configured window. Each source cohort must
qualify on its own; unrelated cohorts cannot be summed. Opaque account commitments
are used privately for counting and never enter model evidence. Rate-only facts
do not establish credential failures or account diversity. Login-after-failures
remains manual evidence because its success source lacks an authenticated receipt;
neither rate-only nor login-after-failures evidence can qualify a new credential
advisory. Old unsigned records are not backfilled or relabeled as authenticated.
Runtime advisory rules separately apply the current configured observation window
and thresholds; the default repeated-proposal threshold is the actual signed
first pair. Higher configured thresholds abstain when the immutable source proof
cannot establish them. These eligibility checks grant no response authority.

To compose jobs and health, pass the same explicitly installed Operator source
to Runtime jobs' `operator` and Guardian Operations' `operator` options. Guardian
diagnostics read its persisted source checkpoint and at most 100 existing
canonical Operator Events from the last 24 hours. They do not poll adapters,
start workers, duplicate Signals or convert Operator facts into authenticated
Guardian response proof. The safe `operatorCoverage` field distinguishes no
installation (`null`), disabled, not observed, unavailable, observed and stale
(older than five minutes). Incomplete or intentionally paused jobs and missing
health observations remain separately visible; no missing worker becomes a
failure. Identifiers, check bodies, queue names and backup locators are omitted.

HTTP host wiring supplies `guardianHttp.observe` on the explicitly installed
Studio server runtime. Shared final-response wrappers preserve the original
Response, including cookies/headers/stream, and skip unknown site/network
metadata. Proxy `next()` is never treated as a downstream response observation.
A dedicated preview origin with no trusted site mapping remains outside this
collector; its fail-closed response is preserved. Uninstrumented custom host
finalizers and direct content mutation owners remain explicit coverage gaps, not
verified healthy zeros. A 404 is a review observation, not an authorization
failure or verified attack.

## Safe evidence export and source failures

The Incident detail export is read-only and uses the displayed current version.
It calls the existing authenticated Studio facade before and after projection,
rechecking staff, site, item access, Incident generation and identical safe
content. All Signals and the complete bounded timeline must be present.
`timelinePageComplete` must be true and there must be no next page; a hidden
corrupt advisory or unavailable required projection rejects a complete export.
It includes only whitelisted safe source summaries, exact rule identities,
digests and labelled advisory outcomes. Raw model summaries, private execution
targets, opaque actor buckets, request addresses, login identifiers, session
families, source MACs, keys, approval tokens and upstream error prose are excluded.
A checksum detects accidental alteration; it is not a signature or execution
authority. Exact successful-session evidence can be exported through its current
manual owner; that does not upgrade it to an authenticated request-source MAC.

The Sentry reference ingress accepts only its fixed installed site/project and
the bounded authenticated `issue-created` protocol. Raw body HMAC verification
precedes trust; unsigned request headers cannot supply source identity, severity
or authority. Its endpoint acknowledges receipt without returning Incident/Event
identities. No outbound Sentry or model call occurs. Upstream source absence,
delivery capping and local receipt-key unavailability remain visible coverage
limitations; Guardian complements application authentication, rate limiting and
WAF/IDS/SIEM controls.

The [final local gate ledger](r7-completion-plan.md#final-local-gate-ledger) records
remaining repository, database, Redis, theme, native preview, production browser
and packed-scaffold checks. Focused source/control and automatic-response tests
do not substitute for those gates. The fixed request-performance gate remains
open until all six isolated reports pass; no production shadow or independent
production security approval is claimed.
