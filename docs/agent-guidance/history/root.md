# Root agent history

Source: `AGENTS.md`, extracted 2026-09-14. Historical implementation checkpoints; consult only for the affected feature. Later checkpoints and current code may supersede earlier status statements.

# AGENTS.md

**Current Runtime Studio slice:** AP-507 management and related AP-508 visibility
reuse the existing Runtime services and fourteen Admin mutations through an
explicitly installed `runtimeStudio` facade. Closed staff-only read contracts,
authority-bound cursors, typed definition/policy/budget editors, current effective
review and optional atomic activation trigger plans preserve existing admission,
CSRF, reauthentication, idempotency and CAS. Manual admission accepts only the
owned recipe/goal contract and an enabled same-version trigger. Unknown Runtime
usage and unavailable operations remain explicitly unknown; Gateway counters
stay exact. Reference and scaffold routes/pages are thin shared wrappers.
Advanced policy simulation, broader retention and full R5 acceptance remain
open. No migration, provider call, automatic service/worker, seed, default
activation, package version or changeset is added. See the
[Runtime Studio flow](../../design/agentic-platform/r5-runtime-studio-flow.md) for scope and verification.

**Earlier events and operations slice:** AP-503 and related AP-508 reuse the
canonical event envelope, existing trigger/Run tables, Runtime admission,
executor and generic worker registry. Exact immutable triggers, bounded filters,
per-recipe durable event/schedule progress and current authority checks preserve
healthy admissions across sibling failures. Run rows are the schedule outbox;
no synthetic schedule event is introduced. Explicit host registration owns six
closed jobs and private fair cursors under `agents.runtime.jobs`; absent Runtime
stays disabled. Initial Run job quota reservations use existing audit receipts,
and recovery does not charge them again. Only expired, dispatched, unreferenced
events are pruned. Agent job errors and diagnostics remain safe aggregates.
Local verification passed workspace 113/lint 41, Core unit 1,894, Core
PostgreSQL 68, web PostgreSQL 1,401 ordinary cases across full/corrected runs
(including theme 5), native preview 1, Redis 16, production browser 62 and
packed 40-package/56-stage checks. Doctor remains 40 tables/266 critical
constraints. No migration, provider call,
automatic factory, seed, default activation, package version or changeset is
added. AP-507, remaining AP-508 and full R5 acceptance stay open. Current
verification is recorded in [the events and operations flow](../../design/agentic-platform/r5-runtime-events-operations-flow.md).

**Earlier delegated execution slice:** Explicit self-delegation on the existing
Agent create command binds a real staff user; omitted authority remains
deployment-only. Runtime admission freezes principal/staff/deployment authority
and rechecks live scope, membership and item access. Existing ChangeSet,
approval, invocation and execution services own Runtime mutations and explicit
approval resumption; the request action stays immutable and only its exact
approved-execution receipt fulfills it. Membership changes invalidate old
Run authority, including removal/regrant. No users, sessions or delegation are
synthesized from an Agent creator. Local acceptance passed verify 113/lint 41,
Core unit 1,854, Core PostgreSQL 67, web PostgreSQL 1,373 (theme 5), native
preview 1, Redis 16, production browser 62 and packed 40-package/56-stage
checks. The full R5 gate remains open for AP-503/AP-507/AP-508. Doctor remains
40 tables/266 critical constraints, with no migration, automatic worker, seed,
default activation,
package versions or changesets. See [the delegated execution flow](../../design/agentic-platform/r5-runtime-delegated-execution-flow.md).

This file provides guidance to Agents when working with code in this repository.

**Earlier runtime foundation:** AP-500/AP-502 and the foundation of AP-504
reuse existing canonical Agent/policy/budget contracts, shared Admin admission,
immutable connection evidence and the site quota advisory lock. Explicit host
services own definition/policy lifecycle, queued runtime admission, private
frozen/current policy and budget-source verification, usage reservations and
local emergency controls. `agents.runtime` remains disabled when absent;
`agents.runtime.control` is a private positive revision/current resume
plan/latest consumed receipt, excluded with runtime settings from content
transfer. Local status/pause require configured deployment authority and stay
available without readiness; resume requires live bounded readiness and the
reviewed five-minute plan. Staff resume retains existing Admin admission and
its fixed envelope. Budget cooldown composes by max, warning by min, and each
saved policy's quiet-hour bound does not truncate the effective deny union.
Generated migrations 0046/0047 bring Doctor to 40 Agent tables/265 critical
constraints/15 deferred lifecycle foreign keys; ordinary deletion inventories
39 tables and fences unresolved runtime usage. Reference/scaffold additions
are thin local CLI wrappers. Acceptance passed workspace verify 113/lint 41
tasks, Core unit 1,772, Core PostgreSQL 67, web PostgreSQL 1,290 (including
Runtime 108, theme-render 5 and native preview 1), live Redis 16, production
browser 62 and packed 40-package/56-stage checks. Packed CI also verifies the
CLI actor/site boundaries, disabled defaults and zero seeded Agent settings.
AP-501/AP-503/AP-505–AP-508 and full R5 acceptance
remain later work. No provider inference, automatic worker/factory/listener,
new runtime HTTP surface or completed configuration UI, seed, default
activation, package version or changeset is added. See
[the R5 runtime foundation flow](../../design/agentic-platform/r5-runtime-foundation-flow.md).

**Earlier Gateway execution slice:** AP-406 and remaining AP-407/AP-408 reuse
the existing ChangeSet/approval/execution services for three additional
capabilities, real Gateway runs/actions and bounded durable MCP tasks. Keep
descriptor-derived HTTP/MCP projection, exact approval binding and current
deployment/site/credential exposure and item authority together. Activity uses
the explicitly injected ChangeSet read facade; scope-only visibility is not
sufficient. Migration 0045 extends the existing stdio MCP-mode constraint;
Doctor remains 31 Agent tables/167 critical constraints/11 deferred lifecycle
foreign keys. Acceptance passed workspace verify 113/lint 41 tasks, Core PG 67,
web PG 1,181 ordinary cases across full/corrected runs, native preview, live
Redis 16, theme-render 5, production browser 62 and packed 40-package/56-stage
checks. Final revalidation passed Core unit 1,726, typecheck/build, reference build,
lint 41, execution PostgreSQL 66 and packed 40-package/56-stage checks. The
R4 section 18 acceptance gate passed; see the R4 Gateway execution flow.
No R5 runtime, provider, automatic worker/factory, seed, default activation,
package version or changeset is added.

**Earlier rollback slice:** AP-405 and rollback portions of AP-407/AP-408 reuse
the existing canonical rollback plan, approval lifecycle, execution journal,
transaction-aware domain writers and bounded verification/recovery. Explicit
host services prepare, request approval for and execute compensation; the
existing cancel route also accepts a closed rollback-plan target. Current Admin
review projects safe compensation diffs and server-derived actions. Initial
proposal operations cannot use the rollback-only snapshot restore variants.
Migrations 0043/0044 bring Doctor to 31 Agent tables/167 critical constraints
and 11 deferred lifecycle foreign keys. Rollback-slice validation is complete; see the R4 rollback flow results. No
AP-406 Gateway execution exposure, automatic worker/provider, seed, default
activation, package version or changeset is added. See the R4 rollback flow.

**Earlier execution slice:** AP-402/AP-403/AP-404 and execution portions of
AP-407/AP-408 extend the existing ChangeSet/approval facade with exact
apply/schedule/cancel, one durable execution journal, transaction-scoped
resource writes and approval consumption, deferred-effect evidence and bounded
host-invoked verification/reconciliation. Admin review owns safe execution
detail and server-derived controls; reference/scaffold routes remain thin.
Execution intent, approval keyrings/definitions and convergence verification
require explicit host injection. Migration 0042 adds the execution journal, bringing Doctor to 29 Agent tables
and 144 critical constraints; ordinary site deletion includes 28 tables.
No automatic worker, provider, AP-405 rollback, AP-406 Gateway execution
exposure, seed, default activation, package version or changeset is added.
Workspace, PostgreSQL, browser and packed-scaffold validation passed; see the
R4 execution flow document for results and the remaining R4 scope.

**Last refreshed:** 2026-09-09 (AP-307/AP-308/AP-309 connect the existing ChangeSet service to framework
preview checks, bounded Admin review and an explicitly installed Gateway facade.
Five descriptor-derived ChangeSet capabilities share the existing scopes,
exposure intersection and invocation journal; missing preview services remain
undiscoverable. Admin diffs use current editable-field visibility over verified
snapshots, and native launch forms reuse central staff CSRF plus the existing
one-time bridge. Static HTML/SEO/JSON-LD/accessibility and manifest link checks
write only safe private report artifacts; the reviewed external-link exception
uses pinned public DNS, credentialless HEAD and strict bounds. Preview artifact
expiry is anchored to atomic completion. Doctor remains at 28 tables and 133
critical constraints; no migration, approval/apply, provider, automatic worker,
listener, seed, default enablement, package version or changeset is added.)

**Earlier:** 2026-09-08 (AP-305/AP-306 add generation-bound preview
admission and an explicit host processor to the existing ChangeSet service.
A read-only overlay reuses document, navigation, theme, SEO and media-reference
contracts, while the preview context blocks framework effects. Current requester
and viewer authority remain separate. Five preview/storage/launch/render tables
in generated migration 0040 bring Doctor to 28 tables and 133 critical constraints,
and ordinary site deletion to 27 dependency-ordered tables. Private mode-0700
spools precede atomic whole-set artifact reservation; one PUT per upload, bounded
inspection, exact content/receipt digests and confirmed deletion prevent partial
readiness or blind replay. Never-dispatched source loss is cancelled only after
the derived 5,850-second dispatch window; pending/unknown effects stay fenced.
Viewer/render surfaces, safe report projection and all runtime/storage adapters
remain explicitly injected. No approval decision, apply, automatic worker,
provider call, seed, default enablement, package version or changeset is added.)

**Earlier:** 2026-09-08 (AP-303/AP-304 extend the existing transaction
seams through resource reads and navigation/theme writes, defer nested hooks
until the outer commit, and close navigation CAS races. ChangeSet validation
uses current requester authority and one durable generation-bound attempt;
small plans run inline and explicit host processors recover queued work.
Exact read-only validation freezes bounded before snapshots, deterministic
risk, base fingerprint, plan hash and rollback duration without applying content.
Migration 0039 brings Doctor to 23 tables and 101 critical constraints.
Preview, approval decisions, apply and transport/UI exposure remain later work.
No automatic worker, provider call, seed, package version or changeset is added.)

**Earlier:** 2026-09-08 (AP-301/AP-302 add exact ChangeSet,
operation and approval contracts, three persistence tables and an explicitly
constructed draft service. Existing staff admission, current Gateway authority,
resource schemas and item ACLs own create/update/read behavior. Drafts reserve
stable document ids without content writes; opaque bounded lists, source
idempotency, draftVersion CAS and host-invoked expiry maintenance fail closed.
Doctor covers 22 tables and 92 critical constraints. Validation, preview,
approval decisions, transport/UI exposure and execution remain later work.
No provider call, automatic runtime/worker, seed, package version or changeset
is added.)

**Earlier:** 2026-09-07 (AP-209/AP-210 add bounded Admin Activity
principal/run/action views and four same-origin Agent HTTP routes through
existing staff admission, Gateway service credentials, read descriptors and
invocation admission. Activity checks every current target and exposes only
client-safe metadata with explicit redacted/expired evidence; inline reads
still create actions without inventing runs. Agent HTTP selects the site from
its dedicated service credential, rechecks canonical audience and live
principal authority, and shares the Activity run facade. Preview artifacts
remain unavailable without an explicitly injected shared artifact facade.
OpenAPI projects the four HTTP routes with exact descriptor-derived invocation
branches; it does not project MCP JSON-RPC or grant authority. Reference and
scaffold wrappers share the implementation. This slice adds no migration,
provider call, scheduled worker, port, automatic runtime factory, default
enablement, package version, or changeset.)

**Earlier:** 2026-09-05 (The pre-AP-209/AP-210 review hardens the
existing R2 implementation: service-token authentication and rotation use the
same principal-before-token lock order as admission and refresh expiry checks
after waits; nested content fields
respect the schema's hidden-field boundary; date filters reach PostgreSQL as
validated timestamps; malformed update times fail closed; nullable schemas
retain the shared bounds; and block/JSON/optional-choice schemas remain usable.
MCP connection plans keep package-manager output out of stdout across npm,
pnpm, and Yarn Classic/modern, while reviewed Codex config apply detects TOML
key-path collisions without rewriting unrelated settings. Plugin Doctor lets
large piped JSON output drain before exit, and browser fixtures wait for data
loading before selection. This review adds no
AP-209/AP-210 route/UI, migration, runtime factory, default enablement, package
version, or changeset. See the pre-R2 operations review in the roadmap.)

**Earlier:** 2026-09-01 (The AP-207/AP-208 integration slice now adds
one secret-free project connection planner for Codex and Claude Code across
local stdio and same-origin HTTP. Reviewed apply writes only project-scoped
client config plus one shared Agent Skills-standard skill; stdio credentials
stay environment-only, and remote OAuth registration is an exact two-stage
redirect/client-id flow with issuer-bound callbacks. MCP initialize guidance
and the skill share the same untrusted-content and advertised-authority rules.
The MCP adapter validates every SDK list against the complete closed framework
v1 name/URI inventory, while Plugin SDK, runtime host, and capability-source
validation reject plugin-defined Agent Gateway ids with stable bounded
diagnostics. Fresh scaffolds document but do not pre-authorize either client.
AP-207/AP-208 add no client launch, automatic trust/consent, provider call,
route, dedicated port, migration, seed, runtime factory, default enablement, or
package-version change.)

**Earlier:** 2026-09-01 (The R2 protocol-projection slice now exposes
only the effective `site.inspect` and `content.query` tools plus bounded
site/capability/schema resources through the existing deployment, site,
credential, scope, exposure, live-authority, and admission intersection.
Schemas and annotations are descriptor-derived, cursors are authorization-bound
HMAC values, every SDK result is validated, and unknown failures collapse to
safe MCP errors. The present three read capabilities remain strictly inline,
so negotiated task augmentation is rejected and no run is invented. An optional
host-injected durable task service adds UUIDv7 task ids, exact TTL/poll/rate and
active caps, immutable canonical terminal results, authorization-bound
get/list/result/cancel, expiry reconciliation, diagnostics, and deletion
ordering. Migration 0037 adds the 19-column MCP task projection and its exact
same-site constraints. Empty prompts and disabled task negotiation remain
honest until their dependent future capabilities/runtime are installed.
Reference and generated wrappers reuse the shared projection while keeping it
absent and all transports disabled by default. AP-206 adds no provider call,
scheduled worker, dedicated port, relay, seed, automatic runtime factory, or
package-version change.)

**Earlier:** 2026-09-01 (The remote R2 transport slice now owns one
optional same-origin, stateless JSON-response Streamable HTTP endpoint at the
canonical `/api/mcp` resource without a dedicated port, listener, relay, or
cookie authority. Deployment, site, runtime, canonical HTTPS origin, and
dedicated key intent all fail closed to the same route/discovery `404`.
Registered public clients use exact redirect URIs, staff-session and CSRF-bound
one-time consent, PKCE S256 codes, exact audience/scopes/exposure, dedicated
ES256 access tokens and active/retiring JWKS, rotating hash-only refresh
families, and replay containment; no client secret or DCR is accepted.
Audience-bound `mcp-http` service credentials share the same protected
resource without token fallback. Complete frames are capped at 5 MiB; Origin,
Host, content negotiation, and frozen MCP revision fail before protocol
dispatch, and GET/DELETE remain disabled. Agent Studio owns client create and
CAS revoke, migration 0036 adds its positive row version, and reference and
generated wrappers reuse the shared routes while remaining disabled by
default. AP-205 advertises no tools, resources, prompts, or tasks until AP-206
and adds no provider call, worker, dedicated port, seed, automatic runtime
factory, or package-version change.)

**Earlier:** 2026-08-31 (The first R2 transport slice now owns one
dedicated `@nexpress/mcp` local stdio process on exact maintained official v1
SDK `1.30.0` and frozen MCP `2025-11-25` revision. An environment-only `npst1`
credential is authenticated before stdin is read; its globally unique persisted token id
selects the site before the existing authoritative Gateway admission rechecks
transport audience, effective exposure, principal, live staff authority,
scopes, and digest. Complete inbound and outbound frames are capped at 5 MiB,
stdout stays protocol-only, diagnostics expose stable codes only, and every
terminal path reuses explicit host bootstrap shutdown. Reference and generated
wrappers share the same app runner and keep the runtime absent and all
transports disabled by default. AP-204 advertises no tools, resources, prompts,
or tasks until AP-206 and adds no HTTP/OAuth route, remote relay, provider call,
worker, listener port, seed, automatic runtime factory, migration, or
package-version change.)

**Earlier:** 2026-08-30 (The first R2 read-capability kernel now owns
the locked `site.inspect`, `schema.get`, and `content.query` descriptors,
exact input/output analyzers and schemas, registry/definition fingerprints,
derived draft-read scope, and bounded cursor/result contracts. Existing site,
collection, block, plugin, i18n, access, hydration, relationship, and read-hook
paths remain authoritative; advanced selection is site/status/visibility
bounded before those existing reads hydrate only selected ids. One common
service-principal admission path rechecks the effective Gateway setting,
presented token family, principal, live staff membership/capabilities, static
and derived scopes, and immutable authorization digest before atomically
persisting audit, invocation, and inline read-action evidence. Success/failure
outputs and safe codes are correlated without credential or internal-error
leakage. Migration 0035 adds generalized run/action storage; the three current
reads are inline and create no run. Doctor, deletion, PostgreSQL fixtures, and
packed-scaffold validation now cover the 18-table inventory and critical
constraints. AP-201–203 add no MCP/HTTP transport, task dispatch, provider
call, worker, dedicated port, seed, automatic runtime factory, or
package-version change.)

**Earlier:** 2026-08-30 (The R1 disabled deployment/scaffold slice now
adds one exact non-secret `NpConfig.agents.gateway` ceiling whose absence and
exported reusable default both resolve to all transports disabled. Project
validation rejects port, host, relay, provider, Vault, token, and other unknown
fields; credentials and adapter selection remain server-only, and runtime
services still require explicit host injection. The reference app and fresh
scaffold reuse the same disabled constant. Their shared migration generator
delegates to Drizzle and adds one dedicated reviewed custom migration only when
all 16 Agent tables exist and all nine circular lifecycle foreign keys are
absent; partial chains fail closed, complete chains are idempotent, and applied
SQL hashes are never rewritten. The already-complete reference 0032–0034 chain
therefore gains no migration. Packed-scaffold CI applies the fresh chain to
PostgreSQL and proves the exact empty inventory, nine `NO ACTION DEFERRABLE
INITIALLY DEFERRED` constraints, absent Agent settings/authority, and healthy
not-required diagnostics. AP-109 adds no seed, provider call, worker, route,
dedicated MCP port, automatic runtime factory, or package-version change.)

**Earlier:** 2026-08-30 (The first R1 Agent Studio control-plane slice
now owns strict client-safe adapter/runtime/overview, canonical connection
definition, principal-detail, and one-time service-token projections. A
host-injected server runtime stays honestly unavailable until the existing
Connection and Gateway services are installed. Current-site Admin routes and
surfaces reuse shared staff-session, capability, reauthentication, audit, and
idempotency admission for Connection create/revoke and Gateway
principal/service-token lifecycle. Write-only API keys are HMAC-projected
before persistence and zeroized around Vault admission; token plaintext is
returned once with `no-store`. Outbound provider connections remain visually
and contractually separate from inbound Gateway authority, and no dedicated
MCP port is introduced. OAuth connections may remain pending for the existing
AP-106 lifecycle; this AP-108 minimum UI adds no alternate callback contract,
provider call, scheduled worker, runtime configuration/default propagation,
migration, or package-version change. The generated scaffold snapshot mirrors
only the new shared page and route wrappers.)

**Earlier:** 2026-08-30 (The R1 Agent diagnostics slice now owns one
strict client-safe `np.agent-health-summary.v1` projection and one server-only
aggregate collector shared by Doctor and read-only Admin Health. Exact R1
table/constraint inventory, state and age counts, same-site references,
connection/config/secret pointers, OAuth callback evidence, provider/Vault
journals, local-envelope bindings, expiry backlog, stranded work, and deletion
sagas fail closed under stable issue codes. Runtime adapter readiness remains
honest when no registry can be confirmed, the disabled empty state stays
healthy, and opaque schema/query failures never leak their input. Unit,
hostile-value, multi-site, redaction, and PostgreSQL fixtures prove that row
ids, sites, adapter identities/fingerprints, locators, keyed digests,
operation bodies/results, and credentials stay outside the projection. This
AP-107 slice adds no Agent Studio mutation UI, provider call, runtime worker,
scaffold/config propagation, migration, or package-version change.)

**Earlier:** 2026-08-30 (The R1 Agent provider-connection slice now
owns one hardened server-only adapter registry, deterministic config and
pricing snapshots, account-subject and destination HMAC projections, and a
bundled fake adapter. API-key activation/rotation, safe probes,
disable/enable/revoke, candidate config activation, and OAuth
authorize/callback/exchange/refresh share exact Admin inputs, immutable
adapter/config evidence, bounded provider calls, Vault-backed credentials,
and crash-safe operation journals. Write-only Admin credentials are replaced
by a separately keyed request HMAC before invocation/audit persistence, and
exchange/refresh/probe remain worker-only. OAuth state, PKCE, and code are
single-use/expiring; callback consumption, code-seal evidence, and queued
exchange admission are atomic, while ambiguous results never replay provider
input. PostgreSQL API-key and OAuth lifecycle fixtures fail closed and browser
projections exclude credentials, locators, raw subjects, and keyed digests.
This AP-106 slice adds no HTTP/Admin UI, scheduled runtime worker,
scaffold/config propagation, migration, or package-version change.)

**Earlier:** 2026-08-29 (The R1 Agent vault slice now owns one exact
server-only adapter contract, deterministic RFC 8949 CBOR credential envelope,
request-HMAC journal, inspection-before-retry recovery, expiring single-use
plaintext leases, and explicit development-only local AES-256-GCM envelope
adapter. Adapter identity/fingerprint and AAD remain frozen through
seal/open/rewrap/destroy; ambiguous results reconcile without inventing or
replaying plaintext, terminal input loss revokes or destroys the unsealed row,
and safe projections exclude locators, digests, and credentials. Migration
0034 aligns never-activated terminal credential constraints. PostgreSQL,
hostile-codec, golden-digest, tamper, tenant-isolation, and lifecycle fixtures
fail closed. This AP-105 slice adds no HTTP/Admin UI, provider integration,
runtime worker, scaffold/config propagation, or package-version change.)

**Earlier:** 2026-08-28 (The first R1 Agent service slice now owns one
shared staff-session/site-capability/reauthentication Admin admission path and
external principal plus opaque service-token lifecycle. Exact row-version CAS,
principal token-version invalidation snapshots, 256-bit `npst1` HMACs,
server-derived transport audiences, deployment/site exposure intersection,
bounded expiry/rotation overlap, one-time replay fencing, safe projections,
audited invocation transactions, and PostgreSQL lifecycle fixtures fail
closed. Migration 0033 backfills existing service-token authority snapshots.
This AP-104 slice adds no HTTP/Admin UI, MCP listener, OAuth/provider/vault
call, runtime worker, or package-version change.)

**Earlier:** 2026-08-28 (The first R1 Agent persistence foundation now
owns same-site principal, service-token, OAuth, connection/config, shared
invocation, provider-auth operation, secret-version, vault-operation/local
envelope, and site-deletion marker tables plus one reviewed migration. Closed
status/timestamp and credential/projection matrices, exposure-bound immutable
credentials, exact Gateway site settings with no port, deferred lifecycle
foreign keys, and hostile/multi-site PostgreSQL fixtures fail closed. AP-103
adds one exact sorted 15-table row inventory, streamed `sdri1` identity
digests, a dependency-safe deletion order, marker exclusion, and legacy
deletion fencing. Empty sites preserve existing behavior; this AP-102/AP-103
slice adds no routes, Admin UI, provider calls, runtime workers, or
package-version changes.)

**Earlier:** 2026-08-27 (The first R1 Agent wire foundation now exports
one closed client-safe registry for Gateway settings, principals, budgets,
connections, run limits, runs, and action activity projections. Exact
context-free analyzers reuse the existing Gateway and canonical run-limit
contracts, add sorted scope/state and bounded cursor-page helpers, enforce
principal/connection/run/action state matrices, and structurally exclude
credential, grant, vault, canonical input, and recovery evidence. Aggregate
and per-body fingerprints plus hostile-input/golden fixtures lock the surface.
This AP-101 slice adds no routes, tables, migrations, Admin UI, provider calls,
or package-version changes.)

**Earlier:** 2026-08-27 (The client-safe Agent Admin contract now owns
all 55 proposed mutation rows in one exhaustive operation registry. Stable
method/path/id/version, named exact schemas, existing staff capability,
body-idempotency and version/hash preconditions, shared effect profiles,
approval/reauthentication floors, one-time/secret handling, audit redaction,
OpenAPI metadata, canonical fingerprints, and closed Admin invocation ids are
validated together. This AP-001 slice adds no routes, tables, migrations,
Admin UI, provider calls, or package-version changes.)

**Earlier:** 2026-08-26 (The client-safe Agent canonical contract now
owns exact body types and context-free analyzers for all 32 v1 purposes. One
exhaustive purpose/body/analyzer/included/excluded/size registry dispatches
typed canonical bytes and SHA digests; the destination purpose remains on its
dedicated HMAC-only path. This contract-only gate adds no runtime tables,
migrations, or provider calls.)

**Earlier:** 2026-08-19 (The bundled GitHub, Google, and Discord OAuth
providers now own small provider-specific authorization-code implementations
with S256 PKCE, bounded token-response validation, and injected network seams.
The deprecated Arctic package is no longer a runtime dependency; the
structural `fromArctic` adapter remains deprecated-but-compatible for existing
custom integrations.)

**Earlier:** 2026-08-17 (NexPress now requires Node.js 20.19.0 or newer
across every published package, generated project and extension, setup and
diagnostic surface, and live installation guide. This deliberate floor keeps
the supported runtime contract aligned with current transitive dependencies;
CI and container examples continue to use Node 22.)

**Earlier:** 2026-08-16 (The project-side CLI now emits one local-only,
bounded `np.feedback-report.v1` support handoff with installed NexPress
package versions, coarse runtime identifiers, and Doctor check IDs/states.
Raw environment-variable values, filesystem paths, database URLs, Doctor prose,
logs, and personal data are structurally excluded; reports are never uploaded.
Fresh scaffolds, the public first-run issue form, docs, and tests share the
same review-before-sharing contract.)

**Earlier:** 2026-08-15 (Shop carrier adapters may now add one
provider-neutral shipping-label void method on top of the existing transient
read and durable acquisition pair. An exact current generation, stable void
UUID, provider I/O outside transactions, durable confirmation before local
completion, adapter-free confirmed recovery, tracking-start closure, transient
read invalidation, replacement-cancellation ordering, Admin/Doctor diagnostics,
commercial cleanup, scaffolds, and PostgreSQL coverage share the PII-free
contract. Voiding never cancels the shipment or pickup, refunds carrier fees,
or defines provider-specific label policy; a completed void only permits a new
atomic regeneration generation.)

**Earlier:** 2026-08-15 (Shop payment adapters may now return one
authenticated, provider-neutral, PII-free payment-dispute evidence event.
Stable provider event and dispute identities, exact captured-payment matching,
bounded monotonic status, durable receipts/state, order-lifetime cleanup,
Admin/Doctor diagnostics, and fail-closed fulfillment/refund/exchange provider
effects share the contract without changing order, payment, fulfillment, or
inventory state automatically. Won, warning-closed, or prevented evidence
reopens those actions; needs-response, under-review, their warning forms, and
lost evidence remain diagnostic and blocking. The bundled Stripe adapter normalizes signed
`charge.dispute.created`, `updated`, and `closed` events only after an
authoritative PaymentIntent read. Evidence submission, liability acceptance,
automatic refunds or compensation, and provider-specific dispute workflows
remain outside Shop.)

**Earlier:** 2026-08-14 (The bundled Stripe payment adapter now adds an
exact PaymentIntent and Payment Element flow, server-authenticated confirmation,
raw-body `Stripe-Signature` verification, stable full-refund idempotency, and
bounded cumulative successful-refund reconciliation over the existing
provider-neutral Shop payment contracts. It also implements the exact
received-return partial-refund and quote-backed merchant/customer
return-postage settlement capabilities, using the durable Shop refund UUID,
PII-free Stripe metadata, and a bounded refund-list preflight so reconciliation
does not depend on Stripe's finite idempotency-key lifetime. Publishable client
handoff data stays separate from the server secret and webhook endpoint secret;
arbitrary partial refunds, disputes, subscriptions, Connect, tax, shipping, and
carrier behavior remain outside this adapter.)

**Earlier:** 2026-08-13 (Shop may now register one independent paired
packing-work adapter for outbound processing fulfillments and awaiting
same-item replacements. Exact PII-free immutable lines and parcel snapshots,
exactly one durable work per target/order, stable create/cancel UUIDs, provider
I/O outside transactions, durable confirmation before local completion,
same-revision carrier attachment and shipment-time consumption,
cancellation-dominant provider and order-lifetime tombstones, and exact
shipment conflict handling share the contract. An optional authenticated raw
callback and an optional lease-safe, cursor-fair scheduled poll add
conflict-safe monotonic `accepted | picking | failed | packed` evidence without
automatically shipping or consuming work. Only an unattached cancelled
tombstone reopens manual fallback. Before tracking, an attached cancellation
may unwind only its exact shipment; after tracking, carrier cancellation and
automatic restock stay closed while exact booked completion and recovery of an
already-started stable WMS cancellation remain possible. Adapter-free local
finalization of stored create/cancel confirmations, always-declared
Admin/Doctor diagnostics, bounded health, and non-starving retention of the
member-linked commercial source cover unresolved effects, including a
`cancelled` shipment attachment until exact carrier compensation or
tracking-won completion proves its relationship terminal. Private retention is
unchanged; privacy-only redaction preserves commercial revisions while
removing the sidecar, and site deletion is final. Packing work or packed
evidence does not prove commercial shipment completion, assign pickers or
bins, handle addresses/rates/labels, manage packaging materials, or define
provider-specific WMS protocols.)

**Earlier:** 2026-08-11 (Shop now atomically consumes the exact source
cart only on the first durable pending-order commit. Existing cart/order locks,
revision and fingerprint checks, replay-safe idempotency, intent/draft stages
that leave the cart intact, and no automatic restoration protect concurrent
owners. After the order leaves `pending-payment`, an owner/CSRF/revision-bound explicit re-add
rebuilds available lines from the current public catalog, preserves current
cart coupons, and reports bounded per-line added/skipped outcomes without
copying old commercial values, reservations, or PII. Both skins, the independent
Storefront hook, scaffolds, docs, and PostgreSQL coverage share the contract;
Admin, Doctor, and scheduled jobs remain unchanged.)

**Earlier:** 2026-08-11 (Shop may now use one independent read-only
packaging proposal adapter for outbound processing fulfillments and awaiting
same-item replacements. Exact PII-free immutable lines, 60-second result
expiry, provider I/O outside transactions, revision-safe parcel CAS, unchanged
manual editing and carrier booking, target-specific Admin/Doctor health,
scaffolds, docs, and PostgreSQL coverage share the contract. Physical packing,
WMS mutations, addresses, rates, labels, packaging-material inventory, and
provider protocols remain separate.)

**Earlier:** 2026-08-11 (Shop pickup-capable carrier adapters may now add
one exact outbound and same-item replacement availability read over the locked
booking, opaque origin, and parcel snapshot. Bounded ordered UTC windows,
one-hour PII-free snapshots with one-way booking fingerprints, revision-safe staff selection, unchanged pickup v1
scheduling, single-use consumption, Admin/Doctor, cleanup, scaffolds, docs, and
PostgreSQL coverage share the contract. General calendars, recurrence, charges,
addresses, automatic scheduling, and provider protocols remain separate.)

**Earlier:** 2026-08-10 (Shop carrier adapters may now add one outbound
and same-item replacement label acquisition capability on top of the existing
transient label read. Shipment-keyed purchase/regeneration generations, stable
provider idempotency, atomic opaque-reference replacement, provider I/O outside
transactions, tracking-start closure, replacement-cancellation reconciliation,
Admin/Doctor, cleanup, scaffolds, docs, and PostgreSQL coverage share the
PII-free contract. Label bytes/URLs remain transient; billing, paper layout,
void/refund policy, provider protocols, and recurring pickup remain separate.)

**Earlier:** 2026-08-10 (Shop provider-booked same-item replacements now
reuse the existing paired pickup capability over their exact locked parcel
snapshot. Shipment-keyed outbound/replacement state, unchanged provider v1
requests, durable scheduling/cancellation, tracking-start closure, pickup
cancellation before provider cancellation or restock, Admin/Doctor, cleanup,
scaffolds, docs, and PostgreSQL coverage share the contract. Packaging
calculation, label purchase/regeneration, recurring pickup, availability
calendars, and provider protocols remain separate.)

**Earlier:** 2026-08-10 (Shop same-item replacement exchanges now add one
independent PII-free parcel snapshot over their exact immutable lines and an
additive carrier booking v2. Revision-safe Admin preparation, durable
shipment locking before provider I/O, unchanged retries, v1 fallback,
Doctor, cleanup, scaffolds, docs, and PostgreSQL coverage share the contract.
Packaging calculation, replacement pickup, label purchase/regeneration, and
provider protocols remain separate.)

**Earlier:** 2026-08-10 (Shop provider-booked same-item replacements now
reuse the existing exact tracking callback and bounded polling capabilities.
Outbound and replacement state remain separately persisted and owner-visible;
exact booking/exchange tuples, cursor-fair leases/backoff, PII-free receipts,
Admin/Doctor, both skins, the independent Storefront hook, scaffolds, cleanup,
owner delivery updates, and PostgreSQL coverage share the contract. Tracking
does not mutate exchange commercial state, and any verified tracking state blocks
provider cancellation and automatic inventory restock. Replacement label
purchase/regeneration, pickup, provider protocols, and customer-service
cancellation after movement remain separate.)

**Earlier:** 2026-08-10 (The existing Shop carrier label-read capability
now serves completed provider-booked same-item replacements through the same
staff-only binary route. Exact booking/exchange state and revisions are checked
before and after provider I/O, PII-free read/delivery audits distinguish the
replacement, Admin/Doctor, scaffolds, docs, and PostgreSQL coverage share the
contract, and bytes/URLs remain transient. Label purchase/regeneration, pickup,
tracking callbacks/polling, and provider protocols remain separate.)

**Earlier:** 2026-08-10 (Shop carrier adapters may now add one paired
same-item replacement booking/cancellation capability. Stable provider
idempotency, exact immutable lines, the current staff-accessed private
destination, calls outside transactions, durable confirmation before address
deletion, resumable ambiguity, exact cancellation-before-restock, Admin/Doctor,
both skins, the independent Storefront hook, scaffolds, and PostgreSQL coverage
share the contract. Manual exchange handling remains valid; replacement labels,
pickup, tracking callbacks/polling, automatic address correction, substitutions,
price differences, provider protocols, and automatic policy remain separate.)

**Earlier:** 2026-08-10 (Shop same-item exchanges now require the owner
to submit one new delivery destination under a 15-minute, revision-bound,
single-use authority. A separate maximum-24-hour private sidecar, audited
direct-staff read required before processing, processing/cancellation/expiry
deletion, PII-free Admin/Doctor state, both skins, independent Storefront hook,
scaffold guidance, cleanup, and PostgreSQL coverage share the contract. The
deleted original address is never reused. Carrier booking, automatic address
correction, substitutions, payment differences, store credit, eligibility
policy, and automatic approval remain separate.)

**Earlier:** 2026-08-10 (Shop now owns one direct-staff same-item
replacement exchange after a received physical return. Exact immutable lines,
reservation-aware all-or-none inventory, revision-safe
awaiting/processing/shipped/cancelled state, cancellation restock, manual
carrier/tracking, owner notifications, Admin/Doctor, PII-free audit, cleanup,
both skins, independent Storefront hooks, scaffolds, and PostgreSQL coverage
share the contract. New address intake, carrier booking, substitutions, payment
differences, store credit, eligibility policy, and automatic approval remain
separate.)

**Earlier:** 2026-08-09 (Shop payment adapters may now add one
quote-backed approved-return settlement capability after physical receipt.
Direct staff designate merchant or customer responsibility; merchant absorbs
the immutable same-currency quote while customer responsibility deducts it
exactly from one positive net refund. Existing one-refund storage,
provider-confirmed recovery and cancellation reconciliation, PII-free audit,
Admin/Doctor, owner UI, both skins, Storefront hooks, Toss, scaffolds, and
PostgreSQL coverage share the contract. Separate charges, automatic or
jurisdictional payer policy, exchanges, arbitrary refunds, and provider
protocols remain external.)

**Earlier:** 2026-08-08 (Shop carrier adapters may now add one paired
approved-return postage quote/create-v2 capability. Exact bounded
same-currency methods, revision-safe owner selection, a maximum-one-hour
private origin sidecar, provider I/O outside transactions, immutable PII-free
logistics snapshots, Admin/Doctor, both skins, Storefront hooks, scaffold
guidance, cleanup, and PostgreSQL coverage share the contract while v1 return
creation remains valid. Charging, refund settlement, responsibility and
jurisdiction policy, recurrence, and provider protocols remain separate
additive contracts.)

**Earlier:** 2026-08-08 (Shop now owns independent member catalog
price-drop alerts for the product price or one exact enabled variant. A
180-day request captures one same-currency baseline, triggers once only below
that baseline, uses a stable preference-aware member-inbox event, and retains
a 30-day receipt. Product hooks and five-minute bounded reconciliation share
the processor; Admin, Doctor, both skins, Storefront hooks, scaffold guidance,
and tests share the PII-free contract. Promotions, compare-at prices, carts,
inventory reservations, price guarantees, direct marketing channels, and
recurrence remain separate.)

**Earlier:** 2026-08-08 (Shop order/payment/fulfillment/delivery/return/refund
transitions now atomically stage one PII-free owner timeline and durable
member-inbox/direct-email outbox. Raw recipient email stays in a separate
maximum-24-hour sidecar deleted after delivery, member inbox preference remains
authoritative, guest delivery fails closed after PII expiry, bounded leases and
five-attempt retry state reach Admin/Doctor, and the stable event id makes
reconciliation explicit. Email remains at-least-once because the generic
adapter has no provider receipt; no SMS, push, or marketing automation is
implied.)

**Earlier:** 2026-08-08 (Shop now owns an independent member restock
alert contract for exact tracked product or enabled-variant targets: only
out-of-stock targets can be subscribed, active alerts expire after 180 days,
availability delivers one preference-aware in-app notification with a stable
event id, and 30-day completion receipts make crash recovery idempotent.
Product update hooks provide the fast path while a five-minute bounded
site-scoped reconciliation catches direct inventory writes; Admin, Doctor,
both skins, the independent Storefront theme, scaffold guidance, and tests
share the same PII-free contract. Wishlists never auto-enroll, and alerts do
not reserve inventory, add carts, track prices, or recur.)

**Earlier:** 2026-08-07 (Shop products now opt into the existing
site-scoped community follow graph for member wishlists; catalog cards use one
bounded batch state read, `/shop/wishlist` hydrates only current public
products in deterministic save order, shared member API/CSRF and deletion
cleanup remain authoritative, Admin exposes PII-free totals/health, Doctor
keeps generic orphan diagnostics, both skins and independent Storefront hooks
are complete, and saves do not imply inventory alerts, cart, or order state.)

**Earlier:** 2026-08-07 (Forum may now reuse one ordinary board as a
signed contextual Q&A surface; the default Shop integration contributes only
a batched published-product context source and consumes Forum's structural
renderer adapter. Site/board/product-bound proofs, immutable context, existing
audience/moderation/attachment policy, staff rich-text answers, member
notifications, Admin/Doctor health, both skin fallbacks, Storefront hooks,
scaffold guidance, and a generated migration share the contract while Forum,
Shop, and Storefront remain independently usable.)

**Earlier:** 2026-08-06 (Shop products now add one member-owned
verified-purchase review contract over shipped order lines, short-lived signed
eligibility, one-way purchase keys, bounded ratings/text/photos, exact
non-hidden public aggregates, safe author projections, audited Admin
hide/restore, Doctor/runtime diagnostics, independent Storefront hooks, and
scaffold guidance without extending order or PII retention. Its private source
collection uses the shared explicit search opt-out, which also excludes external
index writes and reindex inventories.)

**Earlier:** 2026-08-05 (Shop now owns one private Admin-managed local
shipping-policy contract with deterministic base selection, additive Korean
postal/administrative/cart surcharges, gross or discounted free thresholds,
bounded methods and time windows, external-adapter precedence, frozen delivery
snapshots and totals, Admin/Doctor diagnostics, generated migration, scaffold
guidance, and integration coverage. Carrier-owned dynamic rates, customs,
jurisdiction rules, booking, labels, pickup, and tracking remain separate.)

**Earlier:** 2026-08-05 (Shop now owns one independent automatic and
coupon promotion contract across a third Admin collection, deterministic
fixed/percentage targeting and stacking, cart revisions/fingerprints,
checkout/draft/order snapshots, discount-aware tax/payment/partial refunds,
atomic global and PII-free owner usage reservation/redemption/release,
Admin/Doctor health, skins, generated migrations, scaffolds, and integration
coverage. Tax policy, dynamic shipping rates, loyalty, gift cards, and provider-funded
settlement remain separate.)

**Earlier:** 2026-08-05 (Shop payment adapters may now project one
authenticated cumulative provider-cancellation snapshot. Exact existing
refunds converge without repeated compensation; a previously unknown single
full reversal safely closes order/fulfillment/private data and restores
unshipped tracked inventory, while ambiguous partial or cumulative adjustments
block fulfillment/refunds under PII-free Admin/Doctor diagnostics. Disputes,
chargebacks, settlement corrections, and automatic arbitrary-partial allocation
remain separate.)

**Earlier:** 2026-08-05 (Shop payment adapters may now add one
received-return partial-refund capability with immutable returned-item prices,
explicit bounded shipping/tax allocation, one provider idempotency key,
durable provider confirmation, full-refund exclusion, owner-safe projection,
Admin/Doctor/scaffold guidance, and PostgreSQL coverage. Receipt inventory and
shipped fulfillment never transition twice; repeated or non-return partial
refunds remain separate.)

**Earlier:** 2026-08-05 (Shop carrier adapters may now add independent
exact raw-callback and bounded polling reverse-tracking capabilities over
active approved-return logistics; idempotent receipts, cursor-fair leases and
backoff, owner-visible status, tracking-start cancellation closure,
Admin/Doctor/scaffold guidance, commercial cleanup, and PostgreSQL coverage
share the contract. Warehouse receipt, inventory restore, refunds, and
exchanges remain separate.)

**Earlier:** 2026-08-03 (Shop carrier adapters may now add one paired
approved-return shipment create/cancel capability with drop-off or bounded
pickup mode, a server-only opaque return destination, a maximum-24-hour
owner-scoped private origin deleted after provider confirmation, durable
idempotent reconciliation, transient owner labels, Admin/Doctor/scaffold
guidance, cleanup, skins, and PostgreSQL coverage. Refunds, exchanges, reverse
tracking, recurring pickup, eligibility policy, and provider protocols remain
separate.)

**Earlier:** 2026-08-03 (Shop parcel-aware carrier adapters may now add
one paired pickup schedule/cancel capability with a server-only provider-owned
opaque origin reference, exact PII-free package summaries, stable provider
idempotency, durable two-stage confirmations, revision-safe Admin operations,
tracking-start closure, Doctor/scaffold guidance, cleanup, and PostgreSQL
coverage. Label purchase, recurring/return pickup, provider calendars,
addresses, and provider-specific protocols remain separate.)

**Earlier:** 2026-08-03 (Plugin API routes may now opt into one exact
bounded binary response contract across SDK/core validation, dispatch,
discovery, OpenAPI, Admin downloads, Doctor-compatible scaffolds, tests, and
live guides. Shop carrier adapters may independently retrieve an already-booked
PDF/PNG/ZPL shipping label through one PII-free request, revision-safe staff
audit, transient bounded delivery, and Admin action without persisting bytes or URLs. Label
purchase/regeneration, pickup, return labels, and provider protocols remain
separate.)

**Earlier:** 2026-08-02 (Shop processing fulfillments may now store one
revision-safe PII-free parcel snapshot with bounded integer millimetre
dimensions, gram weights, and exact immutable order-line allocations; direct
staff audit, Admin/Doctor diagnostics, commercial cleanup, scaffold guidance,
and PostgreSQL coverage share the contract. An additive carrier v2 capability
atomically locks that snapshot to the durable shipment UUID before provider
I/O while v1 adapters remain unchanged. Labels, pickup, automatic packaging,
and provider protocols remain separate.)

**Earlier:** 2026-08-02 (Shop carrier adapters may now add one optional
provider-neutral PII-free tracking read independently of webhooks; persisted
five-minute leases precede provider calls outside DB transactions, ten-minute
intervals and bounded exponential backoff control retries, a site/provider
cursor prevents key-range starvation, canonical results reuse the tracking
event engine, and scheduled/manual reconciliation, audit, Admin, Doctor,
scaffolds, cleanup, and PostgreSQL coverage share the contract. Labels, pickup,
provider APIs, and service policy remain separate.)

**Earlier:** 2026-08-02 (Shop carrier adapters may now add one optional
exact raw-body tracking webhook capability; authenticated PII-free events
match the durable shipment/site/booking/tracking tuple, replay and event delay
are bounded, event ids are conflict-safe, monotonic tracking state stays
separate from shipped fulfillment, delivered is terminal, and owner skins,
Admin, Doctor, scaffolds, cleanup, and PostgreSQL integration tests share the
same contract. Provider-specific carrier protocols, labels, pickup, polling,
and customer-service policy remain separate.)

**Earlier:** 2026-08-02 (Shop processing fulfillments may now use one
optional server-only provider-neutral carrier booking adapter; durable shipment
UUID idempotency, calls outside DB transactions, separately persisted provider
confirmation, atomic shipped/tracking and private-data deletion, direct-staff
audit, closed PII-free Admin/Doctor diagnostics, scaffolds, and integration
coverage share the contract. Labels, pickup, tracking webhooks, packaging,
customs, and jurisdiction policy remain separate.)

**Earlier:** 2026-08-02 (Shop private order drafts may now use one
optional server-only provider-neutral additional-tax quote adapter after the
address or delivery selection; exact calls run outside DB transactions,
revision/expiry rechecks freeze one PII-free component snapshot, and
orders/payment/full refunds share item subtotal, shipping, tax, and total.
Closed provider health reaches Admin and Doctor while remittance/filing,
invoices, exemptions/nexus, customs/duties, and jurisdiction compliance remain
separate.)

**Earlier:** 2026-08-01 (Shop private order drafts may now use one
optional server-only provider-neutral shipping quote adapter; exact bounded
methods are requested outside DB transactions, revision-safe selection freezes
one PII-free delivery snapshot, orders/payment/full refunds share item subtotal,
shipping amount, and total, closed provider health reaches Admin, and Doctor
verifies the declarative diagnostic contract.
Tax/customs, free-shipping policy, carrier booking/labels/pickup/tracking, and
jurisdiction rules remain separate.)

**Earlier:** 2026-08-01 (Shop shipped orders now add one independent
owner-scoped item-return contract with closed PII-free reasons, revision-safe
request/cancel/approve/reject/receive transitions, direct-staff audit,
all-or-none receipt-time tracked inventory restoration, owner-safe projection,
Admin/Doctor diagnostics, skins, scaffold guidance, and integration coverage.
Exchanges, carrier pickup/labels, jurisdiction policy, and payment refunds
remain separate.)

**Earlier:** 2026-08-01 (Shop payment adapters may now add one exact
full-refund capability over durable provider idempotency, separately persisted
provider confirmation, direct-staff audit, refunded order and cancelled/shipped
fulfillment outcomes, all-or-none unshipped inventory restoration, explicit
manual compensation, owner-safe projections, Admin/Doctor diagnostics, and the
bundled Toss full-cancel API. Partial refunds, provider-initiated reversals,
returns, settlement, and carrier integrations remain external.)

**Earlier:** 2026-08-01 (Shop paid orders now atomically create an
independent revision-safe awaiting/processing/shipped fulfillment contract;
explicit staff-only audited PII reads, shipment/30-day deletion, owner-safe
status, generic Admin table row actions, Doctor diagnostics, and scaffolds
share the same bounded contract. Refunds, returns, carrier booking, tax, and
shipping rates remain external.)

**Earlier:** 2026-07-31 (Shop payment adapters may now add one all-or-none
prepare/confirm/launcher contract over 15-minute owner-scoped attempts, exact
stored-order matching, bounded public handoffs, server confirmation, existing
atomic receipts/inventory transitions, and PII-free Admin/Doctor diagnostics;
the bundled Toss Payments v2 package supplies a KRW browser handoff,
secret-key confirmation, and query-verified terminal webhooks. Settlement,
reversals, refunds, fulfillment, tax, and shipping remain external.)

**Earlier:** 2026-07-31 (Shop now accepts an optional build-time,
provider-neutral payment adapter over exact raw callbacks; verified events use
one replay-bounded, amount-matched, idempotent, PII-free receipt contract and
atomically resolve pending orders by consuming or releasing inventory. Provider
signatures/secrets, payment initiation, settlement, reversals, refunds,
fulfillment, tax, and shipping remain external.)

**Earlier:** 2026-07-31 (Mutating plugin API routes now opt into one
exact bounded raw-body contract across definition/host validation, dispatch,
public discovery, OpenAPI, Doctor-compatible scaffolds, tests, and live guides;
provider signatures, replay defense, idempotency, and payment transitions
remain plugin-owned.)

**Earlier:** 2026-07-30 (Shop pending orders now hold tracked
product/variant inventory through one PII-free, product-locked,
transaction-safe reservation contract with cart quote, cancellation/expiry,
Admin, Doctor, scaffold, and integration-test coverage; payment and on-hand
decrement remain separate.)

**Earlier:** 2026-07-30 (Shop durable pending orders now split exact
owner/site-scoped commercial, private-sidecar, and maintenance contracts across
idempotent draft conversion, API, history/detail skins, Storefront hooks,
PII-free Admin/Doctor diagnostics, revision-safe cancellation, 24-hour
private-data deletion, and 365-day commercial cleanup without implying payment
success, inventory reservation, tax, shipping, fulfillment, or refunds.)

**Earlier:** 2026-07-30 (Shop private order drafts now share one exact,
owner/site-scoped, revision-safe, 24-hour customer/shipping PII contract across
open-intent derivation, API, both skins, Storefront hooks, masked Admin/Doctor
health, immediate cancellation deletion, and bounded expiry cleanup without
implying finalized orders or payment.)

**Earlier:** 2026-07-30 (Shop checkout intents now share one exact,
owner-scoped, 15-minute, idempotent cart-snapshot contract across API, skins,
Admin, cleanup, Doctor, scaffold, Storefront hooks, and integration tests
without creating orders, taking payment, reserving stock, or collecting PII.)

**Earlier:** 2026-07-29 (Shop carts now share one exact site-owned
guest/member identity, TTL storage, revision, merge, live quote, CSRF, Admin,
scheduled cleanup, route, skin, and theme contract without implying checkout.)

**Earlier:** 2026-07-29 (the first-party Shop catalog and independent
Storefront theme now share bounded product/category, integer-money, SKU,
inventory, Admin, route, skin, block, SEO/search, scaffold, and migration
contracts without implying checkout or making either package depend on the
other.)

**Earlier:** 2026-07-28 (community realtime SSE now has exact
process/site admission limits, bounded output queues, cursor-safe backpressure
closure, and shared Doctor, Admin Health, ops, OpenAPI, scaffold, and polling
fallback guidance.)

**Earlier:** 2026-07-26 (community realtime retention now uses bounded
oldest-first batches, an hourly built-in cleanup job, write-time fallback,
and one expired/oldest-row diagnostic across Doctor, Admin Health, and ops.)

**Earlier:** 2026-07-23 (site storage, document, and rolling job quotas
now share one exact settings, atomic admission, Admin/OpenAPI, scaffold, and
doctor/ops contract with unlimited defaults and fail-closed measurement.)

**Earlier:** 2026-07-23 (community comments, document engagement, and member
notification inboxes now share one site-scoped PII-free SSE invalidation
contract with DB-sequence resume, bounded polling fallback, retention,
Doctor/OpenAPI, scaffold, and deletion coverage.)

**Earlier:** 2026-07-22 (media, folders, references, processing jobs,
Admin, transfer, quotas, site deletion, and doctor now share one exact
site-owned contract with fail-closed cross-tenant access.)

**Earlier:** 2026-07-22 (plugin installation stays process-global while
site activation now uses sparse fail-open overrides across dispatch, Admin,
blocks, patterns, templates, translations, OAuth, transfer, jobs, ops, and
doctor; scheduled cron ticks fan out durable site-stamped executions.)

**Earlier:** 2026-07-22 (search reindex now uses fixed cursor batches,
one exact collection job, cross-worker serialization, bounded progress logs,
Admin selection, and durable internal-trigger enqueue outcomes.)

**Earlier:** 2026-07-22 (external search adapters can opt into one exact
document-v1 indexing capability; durable content jobs converge entries from
latest persisted state while full reindex streams an atomic all-site snapshot.)

**Earlier:** 2026-07-21 (external search adapters now declare and consume one
exact document-audience v1 scope; audience-aware collections can stay on
external indexes while malformed or restricted hits fail closed.)

**Earlier:** 2026-07-21 (community document audiences now use one
fail-closed public/member/private contract across Forum boards and posts,
community actions, discovery, profiles, notifications, attachments, Admin,
Doctor, both skins, and generated migrations.)

**Earlier:** 2026-07-21 (declarative document moderation now projects
thread/category/collection scopes across member writes, comments, reports,
forum routes, Admin role choices, doctor diagnostics, and both bundled skins.)

**Earlier:** 2026-07-21 (public member profiles now share one explicit,
site-scoped collection activity projection, exact snapshot pagination,
PII-free API wires, prepared theme renderer props, community-theme UI,
scaffolds, OpenAPI, integration tests, and docs.)

**Earlier:** 2026-07-20 (public comment windows now include batched
author profiles, viewer reaction summaries, exact pagination, nested member
actions, localization, and independent forum/theme styling hooks.)

**Earlier:** 2026-07-20 (community follows now use member or opted-in
collection targets, bounded activity fan-out, actionable deduplicated
notifications, transactional cleanup, orphan diagnostics, and independent
forum board/post subscription UI across both skins.)

**Earlier:** 2026-07-20 (community reports now use reserved or
report-enabled collection targets, unresolved deduplication, contextual Admin
rows, target-serialized closed moderation actions, forum post reporting, and
orphan diagnostics.)

**Earlier:** 2026-07-20 (forum attachments now reuse media ownership,
signature validation, race-safe document refs/deletion, forced-download
visibility, board policy, both skins, exact OpenAPI, scaffolds, integration
tests, and docs.)

**Earlier:** 2026-07-20 (forum engagement now shares opt-in document
reactions, privacy-bounded daily views, batched counts, and bounded recent
popularity across Core, API, skins, home blocks, theme hooks, doctor, and docs.)

**Earlier:** 2026-07-19 (Version PR generation now synchronizes public
release-line and baseline docs from generated package versions, then rechecks
the repository contract before updating the draft release accumulator; the
pre-1.0 changeset guidance matches the stable-surface minor-bump policy.)

**Earlier:** 2026-07-19 (the bundled Korean community theme now works
without the forum over generic page/post/member contracts and enhances an
installed forum only through its public CSS variables, data hooks, and optional
home block slot.)

**Earlier:** 2026-07-19 (forum home integration now uses plugin-owned,
site-scoped board-directory and latest/notice feed blocks plus one validated
community-home pattern; configurable collection slugs stay inside the plugin
while themes consume only stable style hooks.)

**Earlier:** 2026-07-19 (the forum now ships independent classic and
community-full skins over one public np-blocks/token/style-slot contract;
themes can enhance every route surface without importing the plugin, while the
plugin retains complete fallbacks without an active integration.)

**Earlier:** 2026-07-19 (forum lists now share one bounded board-scoped
search/category/author/page query contract across routes and skins; malformed
filters fail closed, navigation preserves state, and notices stay out of
filtered results.)

**Earlier:** 2026-07-19 (the bundled forum now uses one complete
index/list/detail/composer skin contract with responsive classic markup and
framework-independent rich-text typography; routes retain authentication,
ownership, and write-policy control.)

**Earlier:** 2026-07-19 (the bundled forum now uses board rows, shared post
storage, build-time skins, ID routes, and exact row-aware member-write policy
while operator fields fail before moderation or persistence.)

**Earlier:** 2026-07-18 (block prop schemas now use one exact v1
discriminated union across author types, definition/content validation, Admin,
public discovery, OpenAPI, scaffolds, and plugin doctor.)

**Earlier:** 2026-07-18 (block placement now uses one exact top-level
layout contract across core, OpenAPI, rendering, Admin editing, and tree transforms.)

**Earlier:** 2026-07-18 (release acceptance now exercises the packed
scaffolder, keeps Version PRs as draft accumulators, gates on scaffold CI, and
verifies exact npm manifests plus provenance before tagging.)

**Earlier:** 2026-07-18 (public and package README coverage now matches
the 0.4 release line, current package exports, and the complete live-guide index.)

**Earlier:** 2026-07-18 (shared TypeScript config is consumer-safe;
generated scaffolds typecheck their own source graph and refresh ignored
collection code before typecheck/build.)

**Earlier:** 2026-07-17 (content transfer now shares one exact bounded
v3 full/partial envelope across core, export/import, active collection OpenAPI,
media projection, identity-preserving relationship preflight, and reports.)

**Earlier:** 2026-07-16 (public block, collection, and plugin discovery now
share exact bounded wire contracts; active ownership and runtime inventories
reach OpenAPI/Admin while malformed metadata fails closed and reaches doctor.)

**Earlier:** 2026-07-16 (REST errors now share one exact bounded
client-safe envelope, code/status mapping, validation-detail, Next/proxy/auth,
route, and OpenAPI contract; malformed errors fail closed and reach reporting.)

**Earlier:** 2026-07-16 (collection documents now share one exact
definition-derived storage/runtime/wire contract; related rows hydrate in
order, partial updates preserve omitted fields, OpenAPI/import/export are
closed, and malformed persistence or hook results reach doctor/health.)

**Earlier:** 2026-07-15 (community registries, adapters, persisted rows,
API requests and wire responses now share one exact client-safe contract;
malformed state fails closed and contained runtime failures reach doctor/health.)

**Earlier:** 2026-07-15 (i18n now shares one exact bounded config,
locale-resolution, app/theme/plugin catalog, ICU parameter, Admin wire,
persisted override, cache, doctor, and live-health contract.)

**Earlier:** 2026-07-15 (search now shares one exact bounded request,
adapter candidate, public result, site/visibility, cache, reindex, bootstrap
lifecycle, OpenAPI, theme, and live-health contract; malformed external results
are contained and fall back to Postgres.)

**Earlier:** 2026-07-15 (page metadata, JSON-LD, sitemap/feed entries,
theme SEO callback results, and robots bodies now share one exact, bounded
runtime contract before rendering or caching.)

**Earlier:** 2026-07-15 (code-owned custom routes now share one exact,
bounded author/runtime/Admin wire contract; source-owned registration replaces
stale HMR catalogs, and scaffold bootstrap plus doctor consume the same definition.)

**Earlier:** 2026-07-14 (cache invalidation now shares one exact,
awaitable request/result/adapter contract across Next, app writes, workers,
plugins, CDN purge, Admin Health, ops execution, and cached-fetch options.)

**Earlier:** 2026-07-14 (bootstrap now owns one intent-based,
race-safe, retry-safe, terminal runtime lifecycle across Next, app, worker,
standalone scripts, generated scaffolds, and framework-host wiring.)

**Earlier:** 2026-07-14 (observability now shares one exact logger,
reporter, event/context, async result, lifecycle, bootstrap, job-log tee,
health, readiness, doctor, and scaffold contract; adapter failures are
contained and operator-visible.)

**Earlier:** 2026-07-14 (storage now shares one exact runtime intent,
adapter, safe-key, metadata, result, lifecycle, bootstrap, health, doctor, and
ops contract; malformed values fail closed.)

**Earlier:** 2026-07-14 (rate limiting now shares one exact runtime
intent, adapter, request, decision, proxy injection, Redis result, lifecycle,
startup-safety, and doctor contract; malformed values fail closed.)

**Earlier:** 2026-07-14 (email delivery now shares one exact message,
adapter, SMTP environment, credential-expiry template, and auth-job contract;
bootstrap, health, doctor, docs, and scaffolds fail closed on malformed values.)

**Earlier:** 2026-07-14 (staff and member authentication now share exact
JWT, identity, API wire, runtime-config, and one-row browser-session contracts;
refresh rotation is compare-and-swap, logout revokes by either token's shared session id,
and doctor validates persisted auth/session rows.)

**Earlier:** 2026-07-13 (multi-site authorization now projects every
request actor through one persisted capability contract; site/membership inputs
and wire rows fail closed, the reserved default-site invariant is fixed, doctor
reports orphan rows, and deletion atomically covers every site-scoped table plus
collection-owned revision and media-reference rows.)

**Earlier:** 2026-07-13 (site execution now uses one canonical id and
async-local scope across concurrent/nested requests, scripts, scheduled
publishing, and payload-derived background job dispatch.)

**Earlier:** 2026-07-13 (background jobs now share one extensible,
fail-closed runtime contract across enqueue/dispatch, built-in payloads,
pg-boss rows and schedules, worker/log persistence, Admin/API wire shapes,
ops, scaffold guidance, and doctor diagnostics.)

**Earlier:** 2026-07-13 (revision and autosave snapshots now share one
closed collection-aware JSON contract across persistence, API/OpenAPI, Admin,
restore, pruning, deletion, and doctor diagnostics.)

**Earlier:** 2026-07-12 (site identity now has one canonical `np_sites`
owner and framework settings use a closed, fail-closed registry across core,
Admin, plugins, backup import/export, OpenAPI, and doctor.)

**Earlier:** 2026-07-12 (media records and image variants now share one
exact runtime contract across processing, persisted reads, URL resolution,
Admin/API responses, OpenAPI, plugin reads, cleanup, and storage diagnostics;
malformed rows fail closed.)

**Earlier:** 2026-07-12 (navigation now shares one exact recursive wire
contract across themes, Admin/API writes, backup import/export, OpenAPI, cached
reads, and public rendering; malformed persisted trees fail closed.)

**Earlier:** 2026-07-12 (theme tokens now share one closed group/key inventory
and fail-closed value contract across theme definitions, persisted overrides,
Admin/import APIs, plugin reads/writes, OpenAPI, and CSS generation.)

**Earlier:** 2026-07-12 (project config exposes only active runtime
settings and fails closed on invalid values and dependency graphs; storage URL
construction and plugin loading now preserve the same validated contract.)

**Earlier:** 2026-07-12 (collection definitions now fail closed during
module evaluation and config resolution; strict nested schemas, semantic field
rules, codegen-safe persistence shapes, references, and duplicate collection
slugs share one contract before and after theme requirement merging.)

**Earlier:** 2026-07-12 (theme definitions now fail closed across
module evaluation, config merge, core registration, Next bootstrap, CLI add,
and seed content; bundled themes and scaffolds share the same contract.)

**Earlier:** 2026-07-12 (block instances now add one definition-aware
prop/container contract across defaults, Admin/app writes, preview, patterns,
rendering, and plugin doctor while inactive content remains preservable.)

**Earlier:** 2026-07-12 (block content now uses one stable recursive wire
contract across collection validation, generated types, OpenAPI, patterns,
Admin JSON/paste/preview, translation, and unknown-block operations.)

**Earlier:** 2026-07-11 (rich-text content now uses a stable NexPress
v1 envelope across editor, validation, codegen, SSR, search, translation,
imports, themes, and plugins; malformed or raw Lexical JSON fails closed.)

**Earlier:** 2026-07-11 (Admin Settings now exposes bounded XLIFF 1.2
and Gettext PO content interchange. Editors can export one collection/locale
pair, preview every create/update/skip, and explicitly confirm an import while
the shared fail-closed engine reparses and revalidates the upload before writes.)

**Earlier:** 2026-07-11 (content translation interchange now uses one
format-neutral extraction/application engine. XLIFF 1.2 and Gettext PO share
live source, Lexical, block-schema, sibling-routing, dry-run, and fail-closed
import rules.)

**Earlier:** 2026-07-11 (block prop schemas now require explicit
translation intent for textual controls. XLIFF follows that contract through
nested blocks and arrays, validates live ids/types/paths/text, and fails closed
for unknown, duplicated, stale, or structurally incompatible block units.)

**Earlier:** 2026-07-11 (XLIFF 1.2 now round-trips Lexical rich text
through protected inline codes. Import validates live source paths, ordering,
and text before replacing leaves, preserving formatting and non-text nodes.)

**Earlier:** 2026-07-11 (the remaining plugin definition surfaces are
now contract-complete: page templates, ICU translations, config/lifecycle
callbacks, teardown/reload cleanup, and doctor inventories share validated
runtime rules. The never-implemented custom-field registration surface was
removed.)

**Earlier:** 2026-07-11 (plugin page-builder patterns now share one
validated recursive definition and block-reference contract across blocks, the
SDK, Next bootstrap, the shared registry, and plugin doctor. Bootstrap assigns
concrete sources and registers all blocks before patterns.)

**Earlier:** 2026-07-10 (plugin scheduled tasks now share one validated
definition across the SDK, core host, pg-boss registration, and plugin doctor.
Invalid cron expressions, duplicate task ids, and non-void results fail
explicitly; schedules use five-field UTC cron.)

**Earlier:** 2026-07-10 (plugin blocks now share one validated
definition and props-schema contract across blocks, the SDK, Next bootstrap,
the shared registry, and plugin doctor. Invalid and same-plugin duplicate
definitions fail before registration.)

**Earlier:** 2026-07-10 (plugin page routes now share one validated
pattern and definition contract across the SDK, core host, Next dispatcher,
and plugin doctor. `locale: "none"` matches the raw URL and omits automatic
hreflang aliases.)

**Earlier:** 2026-07-10 (plugin API routes now share a typed core/SDK
request and response contract. Definition and host validation reject malformed
or duplicate static routes, handler results are validated before dispatch, and
GET registrations also serve bodyless HEAD responses.)

**Earlier:** 2026-07-10 (plugin content, auth, media, and render hooks
now share one typed hook registry. Lifecycle payloads are exact per name,
validated at dispatch, and fire-and-forget handlers must return void.)

**Earlier:** 2026-07-10 (plugin render contributions now use the single typed
`render:beforePage` hook for both `head` and `bodyEnd`; definition-time hook
validation rejects unsupported names and malformed descriptors.)

**Earlier:** 2026-07-10 (plugin Admin actions now support a definition-level
typed registry, while setup-time `ctx.actions.register*` remains the
compatibility path.)

**Earlier:** 2026-06-17 (docs-currentness pass — `CLAUDE.md`
now delegates here, `apps/web/AGENTS.md` reflects the thin
`@nexpress/app` wrapper structure, CI/Release notes match the active
GitHub workflows, and plugin `surface: "member"` route docs reflect
the shipped member-shell wrapping.)

**Earlier:** 2026-05-05 (post `np` prefix migration — every public
framework-owned `nx`/`Nx`/`NX_`/`nx_`/`nx-`/`--nx-` identifier moved to
`np`/`Np`/`NP_`/`np_`/`np-`/`--np-`. Package names `@nexpress/*` are
unchanged. See `.changeset/breaking-np-prefix-rename.md` for the migration
runbook.)
