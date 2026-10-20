# R7 Guardian completion plan

Baseline: `575098f2` (approved exact-session response, PR #1548). This is an
implementation and acceptance plan, not a session handoff. The existing
[roadmap](implementation-roadmap.md#r7--guardian-and-application-security-orchestration),
[Runtime/Guardian design](agent-runtime-and-guardian.md),
[security invariants](security-and-credentials.md) and
[testing requirements](testing-and-evaluation.md) remain authoritative.

## Outcome and constraints

An explicitly installed Guardian correlates trusted application and external
security facts into understandable, evidence-bound Incidents. Human-approved
responses retain their exact authority and recovery contracts. A model can
summarize evidence but cannot authorize execution, change severity or close an
Incident. Guardian complements application authentication, rate limiting and
WAF/IDS/SIEM controls.

The user authorized planning and sequential implementation through R7 completion.
New commits, PRs, merges and publishing await separate authorization. Package
versions, changesets and lockfile stay unchanged. Necessary schema changes must
be generated from source and reviewed; there is no blanket migration ban.
Use synthetic local identities and no-network providers for tests. Do not load
production secrets, call paid providers or activate production Runtime/workers.
Keep the pre-existing handoff edit byte-for-byte.

Implementation, executable synthetic acceptance, independent security review and
production enablement are separate evidence states. A synthetic pass never
establishes real attack-detection accuracy or a production shadow period. An
unattended response must remain unavailable until its required deterministic
policy, TTL/compensation and enablement evidence are actually verified. Do not
silently replace an outstanding requirement with an explanation that it is out
of scope.

Implementation and all authorized no-cost local acceptance gates are complete.
Production security qualification and enablement remain pending the actual
external evidence described below; this does not mark the full R7 release gate
complete.

## Current requirement matrix

| Requirement                                     | Implemented scope                                                                                                                                                   | Local acceptance and remaining qualification                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AP-701 security subjects and exact restrictions | Pure security subjects, exact restriction persistence, retained encoding and golden vectors                                                                         | Local cross-source compatibility and complete repository gates pass                                                               |
| AP-702 collectors                               | Six source families: requests, security transitions, content, Runtime, HTTP and Sentry; explicit existing Operator jobs/health composition                          | Integrated local collector gates pass; custom HTTP origins and unregistered content mutation owners retain explicit coverage gaps |
| AP-703 detection and advisory summary           | Fifteen bounded detectors, immutable source/Signal proof, coalescing, monotonic escalation, two manual advisory recipes and offline evaluation                      | Adverse-evidence and browser gates pass; production usefulness and false-positive rates remain unestablished                      |
| AP-704 narrow responses                         | Human-approved temporary restrictions and exact browser-family revocation; separately deployment-authorized narrow automatic limits; early removal and TTL recovery | Integrated recovery gates pass; actual production qualification is absent and unattended admission stays disabled                 |
| AP-705 external signals                         | Fixed host adapter and authenticated Sentry issue-created reference protocol, exercised without outbound calls                                                      | Integrated recovery and packed-host gates pass                                                                                    |
| AP-706 Admin workspace                          | Current safe evidence, advisory history, read-only complete export, action/approval/notification and unavailable states                                             | Production browser, access-loss and download gates pass                                                                           |
| AP-707 operations                               | Exact-source retention and reference checks, held/unknown states, export, Doctor/health, capture controls and local CLI recovery                                    | Complete local repository/database/browser/scaffold gates pass; terminal response/advisory graphs remain conservatively pinned    |
| AP-708 acceptance                               | Versioned threat/control matrix, 64-case hostile/control corpus, actual authority/concurrency/recovery tests, 10,000-input capacity and real-maintenance fairness   | All required local gates below pass; independent production security approval and real shadow evidence remain absent              |

The existing slices retain their own evidence:
[observations](r7-guardian-observation-flow.md),
[temporary request limits](r7-guardian-request-limits-flow.md) and
[exact session revocation](r7-guardian-session-revocation-flow.md).
The [operations flow](r7-guardian-operations-flow.md) records current installation,
coverage and retained-evidence boundaries.

## Implemented boundaries

### Committed source facts and current authority

Authority, active-policy, credential and plugin observations use their actual
mutation owners and mandatory same-transaction signed source receipts. No-op,
failed CAS, failed activation and rollback do not become successful transitions.
Deployment impact covers the complete fenced site catalog. Keyed state
commitments and site-local subjects exclude credentials, configuration bodies,
policy text and raw principal identities from safe evidence. A role increase or
configuration change is a review observation, not an attack verdict.

Authenticated request capture requires an explicitly installed source factory
and an independent copied receipt key. The actual Event hash, persisted recording
time and independent receipt UUID are MAC-bound in the same transaction. Current
site/control/source authority, first-five sampling, the 100-Event site/window cap
and four-observation in-flight bound remain in force. Exact replay checks the
retained Event and receipt; key loss, tampering or a duplicate receipt fails
closed. A configured signed source cannot replay unsigned history or backfill a
missing receipt. A no-key source preserves its manual, unauthenticated behavior.

The Event write optimization retains actual live transaction provenance,
canonical bytes, expiry, lineage and database uniqueness. Prepared bodies are
detached and deeply immutable; copied bodies, expired contexts and wrapped or
replaced recorders cannot acquire their provenance. Only the actual owner's new
insertion can return a consumed row. Public recording stays undispatched, and a
fresh-source identity conflict rolls back rather than becoming a successful
replay or a new source MAC. Prior/window reads share one bounded SQL snapshot;
current controls and closure rows come from the held site admission transaction,
not a process authority cache.

Content saves and newly inserted autosave revisions write an atomic signed
source-only receipt without Runtime/quota/Event/Incident locks. Explicit
maintenance verifies receipts and emits Events. Indexed pending selection includes
late commits without a timestamp/UUID high-water cursor. Reused autosaves emit
no revision fact, and revisions-off collections retain a committed-save basis.
Scheduler publication, staff promotion of pending member documents and pipeline
deletion now record separate same-transaction lifecycle facts. They create no
revision and do not count toward the save/revision detectors. Deletion records
the status returned by the actual DELETE without retaining document content.
Failed receipts roll back their mutations; failed promotion CAS and losing
concurrent deletion emit no successful fact. Direct SQL and custom mutation
owners remain outside this installation; universal CMS coverage is not claimed.
The [content lifecycle follow-up receipt](r7-guardian-operations-flow.md#content-lifecycle-follow-up-2026-10-20)
records the later regression gate and its corrected test fixture.

Runtime capture likewise uses a signed source-only outbox. Facts retain actual
Run/Agent/version/principal and Action/provider-accounting relationships. Existing
Runtime loop and budget breakers remain independent. Unknown, released, adapter
estimated and provider reported accounting are not interchangeable. HTTP capture
observes actual final 401/403/404 responses only at explicitly integrated owners;
proxy continuation is not a downstream response. Custom host finalizers and
preview origins without trusted site/network mapping remain uncovered. A 404 is
not an authorization or attack verdict.

Sentry ingress accepts the fixed authenticated issue-created protocol for the
installed project/site, using raw bounded bytes and host mapping. It makes no
outbound request. Existing Operator jobs/health checkpoints and a bounded sample
of their canonical Events are composed read-only. Absent, stale, incomplete or
paused Operator coverage cannot become worker-failure evidence or authenticated
Guardian response proof.

### Advisory reasoning, offline evaluation and response qualification

The two Guardian recipes are manual advisory owners with strict admitted
source/output digests, current Incident/item ACLs, persisted usage/lease/budget
checks and no severity or execution authority. Credential-stuffing eligibility
requires the actual branded authenticated request source and only exact
login-failure cohorts. Each cohort independently meets the currently selected
recipe's audience, failure-count, distinct-account commitment and observation-span
window. Unrelated cohorts cannot be summed. Account commitments remain private.
Rate-only decisions and login-after-failures correlation remain manual evidence;
the latter lacks an authenticated success receipt and cannot qualify this
advisory. Legacy unsigned Events cannot qualify it either.

Runtime advisory eligibility reconstructs the actual source rule and applies the
current recipe window and thresholds. The default repeated-proposal threshold is
two, matching the signed first-pair blocker fact; explicitly higher thresholds
abstain. The other rules require five actual scope denials, five admitted Actions
or USD 0.10 in known cohort cost. Current source access and Incident generation are rechecked
when composing safe evidence.

The versioned `guardian.v1` evaluation includes 64 Korean/English synthetic
threat/control cases, review labels, comparison/report artifacts, Workbench and
installed CLI result verification. The CLI uses the actual App command and pure
Guardian contracts for evaluation, review and comparison; modified identities,
labels, comparisons and private fields are rejected. These artifacts establish
synthetic reference conformance, not production precision, model usefulness,
shadow evidence or approval.

Human-approved restrictions and exact session revocation retain their existing
approval, recent-auth, scope, idempotency and recovery owners. Automatic temporary
limits use a separate current deployment authority: the actual authenticated
five-Event request rule, independently verified staff escalation, current policy
and an exact qualified deployment are all required. A medium source Signal does
not become high severity by configuration. The 21-case automatic-response
PostgreSQL suite passes using explicitly synthetic qualification artifacts. No
actual production shadow, independent security review, NAT/legitimate-user impact,
compensation qualification or deployment approval is supplied by that fixture.
Missing actual qualification keeps automatic admission disabled.

### Operations, export and retained evidence

Guardian capture controls and the local status/disable/enable-plan/enable CLI are
independent of Runtime pause and provider/worker readiness. The persisted enable
ceremony expires after five minutes and binds the actual deployment actor,
control generation and installed-source fingerprint. Disable skips new capture
and blocks new response admission while retaining history, verification,
approval revocation, early removal, TTL recovery and unknown-outcome reconciliation.
A previously admitted external effect may finish after disable; durable staging
and adapter idempotency preserve that uncertainty.

The read-only Incident export is a whitelist of safe owner projections and
labelled outcomes. Both Studio reads must retain the requested current version,
viewer/item authority and identical projected content. All Signals and the full
bounded timeline must be present: pagination, hidden corrupt advisory rows or an
unavailable required source projection reject a complete export. Raw model
summaries, private targets/buckets, source MACs, secrets and approval tokens are
excluded. A checksum detects accidental change and grants no authority.

Exact-source retention reconstructs the detector and verifies historical source
proof before deleting a closed observational cohort. Active/unresolved,
unavailable-key, unknown-rule, opaque cross-site reference and Action/advisory
usage graphs remain pinned. Closure denies historical delivery without claiming
complete ingestion or granting deletion authority. Late CMS commits become held,
and compact consumed delivery keys prevent rebinding after detail deletion.
Original source and closure audits retain immutable release edges. Doctor checks
those required edges, source-specific actor attribution and compact closure proof;
it does not claim to reverify the MAC of a deleted Event. Legacy unsigned request
and success-session history remain conservatively held. Current profile soft
deletion preserves IDs; no hypothetical hard-delete compatibility is inferred.

`guardian.signals` and Operations distinguish installed, disabled, unconfigured,
partial and unavailable coverage. Missing live proof owners or keys never become
a verified healthy zero. Receipt backlog states and truncation are explicit.
The durable retention cursor uses generation comparison, preventing a stale job
completion from rewinding progress after wraparound. Generic Runtime/Incident
pruning cannot bypass Guardian proof or reference holds.

## Focused verification receipts

The current focused PostgreSQL receipts include 15 signed request-source cases,
14 private live-context/recording cases, 15 HTTP cases, seven existing observation
cases and 16 Runtime Event cases, without environment skips. These cover current
source authority, immutable preparation, copied/stale context rejection, delayed
callback lifetime, custom recorder fallback, actual uniqueness conflicts,
receipt rotation/tampering, rollback, release and Doctor required-edge corruption.
The signed request suite also preserves the database's immutable-release fence
and denies a separately inserted malformed matching release.
The internal request path combines only local timeout installation and quota
acquisition in one statement. Site/control/closure reads remain a separate,
fresh statement after the quota wait. Actual PostgreSQL cases verify lock-timeout
SQLSTATE 55P03, the next statement's 500 ms timeout, nondefault GUC restoration
through commit and rollback on the same client, and a newly committed disabled
control generation after contention. Ordinary quota admission remains unchanged.

The Runtime collector passes **15/15**, including its 5-second whole-collection
work budget, serial retained-key exhaustion and atomic timeout recovery. The
default collection page now reserves the largest completed receipt duration plus
500 ms before starting another receipt, so growing historical proof work can
commit smaller complete batches. This estimate is local to one collection call;
unexpected stalls still trigger the original absolute timeout and full rollback. The
automatic temporary-limit suite passes **21/21**, including independently isolated
site/hour caps and retention after compensation and actual Incident closure.
Requests/HTTP have 750 ms work budgets; automatic authority transactions have a
1000 ms budget. Their owning callbacks close saved query handles before rollback,
so a late host result cannot mutate a reused pooled connection. Existing active
SQL can still require up to its 500 ms statement bound plus rollback/driver drain;
these are not hard real-time network completion guarantees. Automatic stored
transport prework is bounded too, and opt-in admission bounds the final host
exposure recheck without changing ordinary manual admission.

Separate source/mutation suites exercise committed credentials/plugins, actual
profile soft deletion and retained source proof. Operator composition, actual
Runtime advisory persistence and durable cursor generation also have passing
focused PostgreSQL cases. Counts from separate and overlapping runs are not
summed into a final R7 receipt.

Capacity and fairness checks pass for the exact 10,000-input bound and real
10,000-receipt maintenance backlog. Actual content collection, expired-session
cleanup and deletion of an uploaded eligible media row/object complete while
Guardian work remains. Bounded lock timeout and in-flight rejection are separate
outcomes, not recorded coverage. No provider/worker activation is inferred.

Core declaration generation preserves the configured 6 GiB heap, all 35 public
entrypoints and their complete private declaration closure. Prior packed type
consumer/browser-safe checks pass; the final packed scaffold gate also passes, with all 40
packages and installed public/browser consumers. App lint uses bounded sequential batches with unchanged rules and
failure semantics. The successful whole-repository gates are recorded in the ledger below.

## Actor projection compatibility decision

R7 preserves the deployed observation-v1 canonical-JSON HMAC profile and its
fingerprint, site/purpose/key domains, normalization and historical restriction
matching. The architecture and testing specification now distinguish it from
the earlier proposed u32-framed profile. Canonical named JSON fields and
escaping provide unambiguous boundaries; independently computed fixed vectors
cover equivalent IPv6 forms and Unicode/delimiter/key-id inputs. No existing
bucket is silently reprojected. A future u32 profile requires a new registered
version/fingerprint and explicit historical key retention, not an in-place
change disguised as V1 compatibility.

## AP-708 matrix revision 1

This matrix binds the closed detector-v1 inventory to both positive observations
and legitimate controls. A review Signal is not an attack label. The separate
`guardian.v1` corpus contains 64 authored Korean/English threat/control cases for
synthetic reference conformance; its artifact keeps production replay, precision,
model usefulness and enablement explicitly unestablished. New Runtime, HTTP and
sensitive-transition coverage below comes from actual owning-service PostgreSQL
cases, not from relabeling the original synthetic baseline as a live detector.

| Source/rule                        | Positive fact and control                                                                                                                                                                                                                                  | Owning evidence                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Login failures / rate limits       | Five exact same-window/audience or family/bucket facts; four failures, different sites and legitimate shared NATs do not authorize a response                                                                                                              | Existing request observation and restriction suites; authenticated request-source suite               |
| Login after failures               | Five failures plus an actual successful login in the exact browser family; different owner/audience/family cannot become a revocation target                                                                                                               | `agent-guardian-session-observation`, `agent-guardian-session-auth`, `agent-guardian-session-service` |
| Authority / policy                 | Actual committed role increase or policy activation; no-op, stale CAS, demotion and planned changes retain their real meaning                                                                                                                              | `agent-guardian-security-observations`, `agent-guardian-policy-observation`                           |
| Credential / plugin                | Actual password/token/Connection/plugin commits; failed CAS, failed activation, no-op configuration and rollback create no successful source fact                                                                                                          | `agent-guardian-sensitive-observations`                                                               |
| Content churn / revision volume    | Five saves across three authenticated accounts or twenty distinct persisted revisions; ordinary collaboration is still only a review observation, reused autosaves create no new revision                                                                  | `guardian-content-mutation`, `agent-guardian-content-observations`                                    |
| Repeated proposals / denied scopes | The actual two-proposal blocker and five real missing-scope rejections; arbitrary 404s and successful distinct proposals are not scope proof                                                                                                               | `agent-guardian-runtime-observations`                                                                 |
| Runtime actions / cost             | Five actual admitted Actions or USD 0.10 in known actual accounting; unknown/released amounts do not become known spend and late settlement does not rewrite old facts                                                                                     | `agent-guardian-runtime-observations`, `agent-guardian-assessment`                                    |
| HTTP outcomes                      | Five actual 401/403/404 responses with exact status/family/network cohort; different statuses/sites/families stay separate and a 404 is not an authorization verdict                                                                                       | `agent-guardian-http-observations`, shared App/auth response tests                                    |
| External Sentry                    | Authenticated issue-created bytes for the fixed installed project/site; changed identity/body, wrong project, signature, key or stale delivery fails                                                                                                       | `agent-guardian-external-observations`                                                                |
| Operator composition               | Existing recorded jobs/health checkpoint and bounded canonical Event sample; absent, incomplete, paused and stale sources never imply worker failure or new Guardian proof                                                                                 | `agent-operator-source-monitor`                                                                       |
| Advisory / hostile evidence        | Model output can cite only admitted digests; forged evidence, changed visibility, exhausted fingerprint budget, retries and crash recovery never grant effects or severity authority                                                                       | `agent-guardian-assessment`, 64-case synthetic corpus and strict output/context units                 |
| Approval / automatic response      | Manual approval binds exact site/subject/scopes/hash/expiry; exact session revocation retains its distinct-human floor; automatic limits additionally require actual signed source, verified staff escalation and trusted current deployment qualification | Response/session/disable suites; automatic-response PostgreSQL suite passes 21/21                     |
| Retention / recovery               | Active or unknown graphs remain pinned; old keys, cross-site opaque references, late source commits and stale cursor completion cannot erase required proof                                                                                                | Guardian retention, Runtime/sensitive retention, cursor generation and disable-response suites        |
| Availability                       | Exact 10,000-input/source and real-CMS receipt accounting, 26-site durable fairness, actual content/media cleanup and isolated three-round ABBA request baseline                                                                                           | Capacity and real-maintenance fairness pass; the fixed six-report request-performance gate passes     |

Source MAC tampering, canonical rehashing, key rotation and current item access
loss are exercised at the real source boundary. HTTP deadline cases also prove
that saved queries and late callbacks cannot write after rollback while the same
PostgreSQL client is reused. UI/browser checks establish rendering, downloads,
access-loss redaction and human review behavior; they do not substitute for
actual database authorization or independent production security approval.

## Final local gate ledger

The coordinator owns this final ledger. A pending gate is not waived by focused
receipts; later source changes require the affected checks before a settled-source
claim. Ignored local receipts are under
`node_modules/.cache/np-r7-completion-validation/`.

| Gate                                     | Current status                                                                                                     | Final receipt to record                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository `pnpm verify`                 | **PASS**, 113/113 repository/build/type/unit tasks                                                                 | `full-verify-adaptive-final.log`; 110 fresh tasks, three cached; Core 2791, App 839 and Web 170 unit cases; optional Redis integration checked separately      |
| Repository `pnpm lint`                   | **PASS**, 41/41 tasks                                                                                              | `full-lint-adaptive-final.log`; unchanged rules, all batches; one pre-existing Evaluation history effect warning, zero errors                                  |
| Full R7 PostgreSQL                       | **PASS**, 242 files exactly once; 2087 ordinary Web cases and 71 Core DB cases; zero failures                      | `final2-integration-results/{1,2}.json`, `final2-integration-results-check.log`; three explicitly separate AP-708 cases passed in their dedicated receipts     |
| AP-708 capacity and maintenance fairness | **PASS**, 2/2, zero skips; exact 10,000 request attempts and 10,001 actual CMS saves                               | `guardian-capacity-fairness-final-pg.json`; all 27 catalog sites reached in two durable ticks; actual content/session/media cleanup progressed                 |
| AP-708 request performance               | **PASS**, uncapped deltas 4.467/4.056/4.119 ms; capped 2.369/2.246/2.412 ms                                        | `guardian-performance-prepared-row-pg.json`; all six fixed ABBA reports pass max(5 ms, 5% baseline); unchanged workload/budget and final critical-input review |
| Redis                                    | **PASS**, 16/16 cases in two files, zero skips                                                                     | Explicit task-owned Redis on localhost:56387, executed once by partition two; `final2-integration-part2.log`                                                   |
| Theme                                    | **PASS**, all 12 required theme integration files, with package build/type/unit checks                             | Included exactly once across the two successful final PostgreSQL partitions                                                                                    |
| Native Chromium preview                  | **PASS**, actual native Chromium preview case, no unavailable-environment skip                                     | `NP_TEST_PREVIEW_BROWSER=1` in the successful complete PostgreSQL inventory                                                                                    |
| Production browser                       | **PASS**, 132/132 full cases plus final-build Guardian case 1/1; zero skips, retries or flaky cases                | `browser-production-summary.json`, `browser-final2-guardian-summary.json`; actual download and visually inspected 390px evidence/access-loss screenshots       |
| Packed scaffold                          | **PASS**, 40 packages; 67 command stages, zero skips/timeouts; public 35-entry and browser 16-entry consumers pass | `packed-scaffold-final-receipt.json`; 63 exit-zero commands and four exact CI-required closed-port failures; installed trees and all archive hashes reverified |

The full repository gate is `pnpm verify --concurrency=2`; its final successful
run preserves all 113 configured tasks, including the Runtime scheduling fix.
The final non-Markdown source receipt is `settled-source-inputs.json`: 454 paths,
SHA-256 `de420a2ac2694d537094ec1846ef8bb1e49dcbad2975c300f4a476f2006cf954`.
The internal React callback annotation is type-only. The production browser
receipt retains its actual build ID and earlier source identity; a focused
Guardian evidence/export/access-loss rerun passes on the final physical build
`UjD-TyZuxTbQVFAoXzxf1`.
These are local uncommitted-source results, not GitHub CI on a new commit.

The first complete 242-file PostgreSQL run exposed the Runtime batch scheduling
problem and four fixture corrections. The severity fixture now uses a real
transaction and drains competing observations before propagating a failure;
the fence fixture installs the current V6 guard body, and diagnostics expect
the actual 15 detectors and Guardian health check. No CAS, rollback, tampering
or exact result assertion is removed. The fresh complete rerun passes both
unchanged partition runners and their result checker. The original red run and
its failed result check remain preserved. Separate typed lint and no-emit
checks include the affected integration files explicitly, after all dependency
builds have settled.

Fresh generation produces no migration changes. A separate empty, task-owned
PostgreSQL database applies all 80 migrations and reapplies them idempotently;
117 public tables and the column/function fingerprints remain unchanged on the
second application. These are local migration receipts, not a production apply.

The packed scaffold receipt preserves earlier test-harness failures: a macOS
archive path limit, an invalid assumption about repeated tarball serialization
and a missing required `baseline: null` in the new report fixture. The corrected
run copies exact final archives to a short task-owned path; its continuation
retains the 54 successful prefix stages and actually executes stages 55–67 on
the same immutable installed packages. No product parser or acceptance check is
weakened. Installed Guardian evaluation, review, comparison, report and Workbench
all pass for 64 cases; their production qualification remains unestablished.

The settled performance receipt is `guardian-performance-prepared-row-pg.log`.
All six unchanged three-round ABBA reports pass max(5 ms, 5% baseline) with
1000 requests/block and 25 sites/round. It records exactly 7600 source Events and
6000 capped observations including preparation, with zero rejected/replayed or
unexpected disabled/closed observations. The fresh-row assertion hashes every
actual returned body field through the unchanged canonical foundation/domain and
compares it with the private hash of a genuinely prepared, frozen, closed-valid
Event. General/history/replay parsing and metadata/Audit checks remain intact.
Fixture construction remains outside timing; external authority/network latency
is not measured. SQL/pool-wait instrumentation remains unknown, not zero. The final performance
reuse review confirms unchanged bytes for the ten critical request-path inputs;
the changed HTTP metadata branch does not execute for the measured 429 path.
Separate Runtime collector scheduling and fixture corrections do not require
repeating those settled timing reports.

Independent production security approval, a real shadow period, legitimate-user
and NAT-impact measurement, model usefulness/false-positive evidence and current
operator qualification remain external enablement requirements. Local synthetic
passes, internal correctness reviews and completed code do not manufacture them.
No production activation, release, commit, PR or publishing authority is granted
by this plan.
