# R7 Guardian request observations

This first R7 slice connects actual password-login rejections and existing proxy
rate-limit decisions to deterministic Signals, Incidents and the existing staff
Incident workspace. It performs observation only. Guardian complements the
application's lockout/rate limiter and upstream WAF/IDS/SIEM; a threshold is not
proof of an attack or an authorization to respond.

## Ownership and installation

- Auth factories in `@nexpress/auth-pages/server` accept optional
  `onLoginFailure`. Only validated credential attempts rejected by the existing
  credential/status/lockout branches call it. Missing accounts and wrong
  passwords use the same evidence reason. Bootstrap, database, password-verifier,
  session and plugin failures do not become credential-failure observations.
  Cookie, error, status and lockout behavior retain their original owners.
- Shared App auth wiring observes an explicitly installed Studio `guardian`
  service. It resolves the public request hostname through the existing site
  registry, independently of the staff site picker and `x-np-admin-site`.
  No installed service means no additional site lookup or observation.
- `npCreateProxy` accepts optional `onRateLimited`. The existing 19 rules, first
  match, limits, windows, counter keys, CSRF and 429 response remain unchanged.
  Only an actual `limited: true` decision calls the observer, with a closed route
  family instead of the raw path/query. In particular, this bundle does not add
  a new limiter for Member login or routes without an existing rule.
- `@nexpress/app/lib/agents/guardian-request-observer` exports
  `npCreateAgentGuardianRequestObserverV1`. A proxy host supplies its own
  `guardian`, `ensureReady` and trusted `resolveRequest` returning the site and
  network address. The proxy cannot assume the application bootstrap singleton
  exists in its execution context. The default proxy installs no observer.
- `createAgentGuardianObservationServiceV1` requires an explicit installation
  allowlist, current deployment/site authorization callback, an existing Runtime
  Event **record** owner, and an injected actor HMAC key/id. The host may derive
  the key for this purpose from its existing secret. The factory creates or
  loads no credentials, schedules, workers, providers, triggers or Agents.
  Observation works while Runtime remains disabled and never calls dispatch or
  admission. Installing the source does not activate a Guardian recipe.

The host composes this service into its existing Studio runtime as `guardian`
and reuses its current Incident read/Studio services. Its staff item-visibility
owner must verify Guardian sources with
`npReadAgentGuardianIncidentEvidenceV1({ db, siteId, incident })`, returning false
on failure; other incident families retain their existing domain ACLs. The
normal Incident reader still checks the current session, membership and
`admin.manage`. This helper grants no capability or action authority.

Forwarded address headers remain a deployment trust boundary. The shared auth
observer uses the first valid `x-forwarded-for` address, as its existing session
metadata does; a host must control its ingress proxy/header policy. An absent or
invalid address produces no observation. These observations cannot establish
that two addresses represent different people or that a particular actor is
malicious. The explicit proxy resolver can enforce stricter ingress policy.

## Privacy and immutable evidence

Raw address/login facts stay within the auth/request hook and the Core source
projection. Core normalizes equivalent IPv6 spellings and trims/lowercases the validated
login identifier, then computes HMAC-SHA-256 with separate site, purpose,
projection-version/fingerprint and key-id domains. The key is copied at
installation. Network and login-identifier buckets are not interchangeable.
No password, username/email, raw address, token, query, raw route or user-agent
string enters Events, Signals, Incident summaries, notifications or the new UI.

The existing actor-bucket contract stores the projection version/fingerprint,
key id and opaque HMAC result. A key/id rotation starts a new bucket and
correlation identity; old evidence remains readable and is not rewritten or
silently merged across key versions. There is no restriction/proxy enforcement
adapter in this slice, so an observed bucket is never an executable target.

Login failures use existing `auth.login.failed` Events with generic reason
`INVALID_CREDENTIALS`, null session/user-agent, a network actor bucket and a
separate login-target bucket. Actual rejected requests use new
`api.rate-limited` Events with a closed route-family value and network bucket.
Both have fixed source components and `sensitive` privacy. The source creates
the UUID/time; a stable source retry reuses both. Existing Event canonical
digests and same-site idempotency detect conflicting reuse. Client headers,
body, prose and model output do not supply evidence identity or authority.

The generated migration widens only the existing Event/trigger kind CHECK
constraints to include `api.rate-limited`. It preserves every old kind and adds
no table, actor restriction, session mutation or credential storage. Generated
collection schemas are unchanged after formatting.

## Bounded rules and correlation

| Boundary           | V1 behavior                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| Window             | Fixed ten-minute UTC half-open bucket                                                 |
| Login grouping     | Site + frozen network projection + staff/member audience                              |
| Traffic grouping   | Site + frozen network projection + closed route family                                |
| Exact rule         | Five distinct retained source observations in that group/window                       |
| Severity           | Medium; no model score or claim of attack accuracy                                    |
| Per-group sampling | Stops at five observations in the window                                              |
| Site sampling      | At most 100 Guardian observations in a window, shared across source families/nodes    |
| Local work         | At most four in-flight observations per installed service; excess work is unavailable |
| DB waits           | Transaction-local 100 ms lock timeout and 500 ms statement timeout                    |

The existing site control transaction serializes capture, cap checks, Event
recording, reference creation and Incident observation. Candidate evidence is
rebuilt from exactly five immutable same-site rows. Failed source recording or
rule persistence rolls back the transaction. The source verifies the recorder's
actual stored time against the bounded capture interval and requires the exact
one-day expiry; a mismatched recorder clock/expiry rolls back instead of escaping
the sampling cap. Host callbacks and DB-pool waits
retain host lifecycle/time budgets; the statement timeout is not advertised as
an end-to-end HTTP deadline.

An Incident fingerprint includes the site, rule/version, frozen network bucket
and audience/family. Later matching windows attach Signals to the same active
Incident. Replaying the same window does not add another Signal or timeline
entry. A closed Incident is not reopened by replaying its old evidence. The
common 100-attached-Signal limit retains additional Signals as suppressed;
unattached suppression rows cannot invalidate the original attached evidence.

Counts mean **at least five observed**, never a traffic total. Caps, invalid
addresses, source absence, timeouts and host unavailability can omit evidence.
Missing evidence cannot imply zero failures, safety, recovery or complete
monitoring. Unavailability is contained at both source hooks so it cannot alter
the authentication or 429 outcome. Existing controls enforce independently.

## Staff Incident workspace

The existing list filters support `authentication`/`traffic` categories and
exact detector ids `guardian.login-failures`/`guardian.rate-limits` as source
filters. Existing list/detail routes and current staff item ACLs are reused.

The optional closed `guardianEvidence` detail projection contains only verified
rule id, Signal id, audience/family, observed window, threshold and lower-bound
count. It is bound to the displayed Incident category, event count and observed
times. An unknown/corrupt/missing source yields unavailable evidence rather than
an invented aggregate. The new read-only panel replaces content-specific
Moderator evidence/quarantine/restore surfaces for this branch. Common Incident
workflow, severity, assignment and notification interfaces retain their current
server permissions. No request automatically changes Incident state or responds
to a subject.

## Retention and reference matrix

| Artifact                    | Expiry/retention owner                                              | Protected dependencies                                                                            |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Unattached request sample   | One-day source expiry, existing host-registered Runtime maintenance | Any existing retained source/audit/job reference prevents deletion                                |
| Attached Event              | Same source expiry; dependency-safe retention owns actual deletion  | Signal/Incident evidence survives expiry while referenced                                         |
| Signal and Incident         | Existing explicitly configured Incident retention policy            | Active Incident, unresolved outcome and required audit/approval/rollback history remain protected |
| Local notification/timeline | Existing Incident notification and retention owners                 | Existing authenticated transitions and delivery evidence remain intact                            |
| HMAC projection metadata    | Frozen in retained canonical references                             | Key/id changes never rewrite retained subjects                                                    |

The deterministic source marks its Event consumed without creating a Run or
dispatching a trigger. Expiry only makes an unreferenced row eligible; it is not
a promise of deletion at exactly one day. This feature adds no cleanup loop,
cron or worker registration. The existing host maintenance job remains explicit.

## Verification and remaining R7

The focused gate covers actual Event/Signal/Incident persistence, lower-bound
projection, concurrency/idempotency, per-site caps, source tampering, source
failure rollback, short lock waits, source expiry/reference protection and
disabled Runtime. Auth/proxy units verify unchanged outcomes and trusted source
resolution. Admin rendering and one production-browser journey verify the
Guardian branch without content-response controls.

Final local gates passed on 2026-10-18 KST with Node 24.11.1 and pnpm 10.33.0.
These are local macOS results, not an exact-head hosted Ubuntu/Node 22 CI run.

| Gate                       | Result                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Workspace `pnpm verify`    | 113 tasks; Core 2,462, Admin 199, App 773 and Auth Pages 23 unit cases passed                             |
| `pnpm lint`                | 41 tasks passed; one existing Admin evaluation-history effect warning remains                             |
| Integration test typecheck | New Guardian DB test explicitly included under the Node/ES2022 target; passed                             |
| Core PostgreSQL            | 71 passed, no skips                                                                                       |
| Web PostgreSQL             | 1,819 passed, including Guardian 7 and `theme-render` 5; only the opt-in native preview case skipped here |
| Native preview             | Opt-in enabled separately; 1 real-browser case passed, no skips                                           |
| Redis                      | 16 package cases passed, including 3 cases against a real isolated Redis 7.2.7 server                     |
| Production browser         | 130 passed with one worker and zero retries; Guardian's 390 px screenshot inspected                       |
| Fresh packed scaffold      | 40 archives, 68 command/assertion stages plus 1 supplemental installed-copy byte proof passed             |

The packed gate compared all 655 producer/archive JS and declaration files and
605 raw App source files. The default consumer installed 34 public packages;
their 34 physical copies matched across 640 JS/declaration and 605 raw App files.
The other six archives have producer/archive proof; they are not all dependencies
of the default scaffold. Fresh migration, production build, seven generated
extension packages, evaluation fixtures and the operational journey passed.
The extra Guardian smoke checked actual fresh catalog CHECK definitions and
executable copies. It does not prove a complete `api.rate-limited` trigger
execution lifecycle. Five closed-port script probes prove module loading only;
the Doctor probe retained its existing 20-second bound.

The Admin registry golden changed only because configuration activation's trigger
Event-kind enum now includes `api.rate-limited`; operation ids, permissions and
effect declarations are unchanged. The final green runs follow corrections to
test timestamp/type fixtures and the installed type-probe location. Earlier
failed or interrupted checks remain diagnostic receipts, not passing gates.
The browser gate used a freshly created, explicitly migrated dedicated DB.

Versions, changesets, the workspace lockfile and generated collection sources
are unchanged. The existing handoff edit was preserved. Owned test DB/Redis
services were shut down after verification. No paid provider call, external
delivery or production Runtime/worker activation was used.

This is a partial AP-701/702/703/706/707/708 observation boundary, not R7
completion. Durable actor restrictions and exact session revocation, broader
authz/audit/integrity/jobs/health collectors, external security adapters,
model-assisted summaries, security export/Doctor/recovery and the complete
adversarial/threat-review gate remain open. Automatic responses and actual
production attack-detection usefulness have not been established.

The later [approved temporary request-limit slice](r7-guardian-request-limits-flow.md)
adds a separate explicitly installed durable request-restriction owner and proxy
enforcement. Its approval, expiry and recovery evidence belongs to that flow;
the observation-only verification above does not establish those effects.
