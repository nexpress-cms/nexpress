# R6 Incident comment evidence and response target selection

Staff can review retained comment observation metadata separately from the current
comment state, then select an eligible current target in the existing approved
response flow. This does not enable a collector, change moderation policy, or
complete the R6 recipe/evaluation gate.

## Ownership and installation

The optional Incident evidence service reuses the canonical comment source owner,
current staff Incident reader, domain target ACL and existing cursor codec. Hosts
install it explicitly as Studio’s `evidence` owner and supply its trusted
`resolveTargets` to the existing Incident response service. No reference/scaffold
bootstrap enables services, observers, workers or providers.

`createAgentIncidentEvidenceServiceV1` supplies `get`, `resolveTargets` and the
source-only `canReadStaffIncident` callback. The host can wire that callback into
the existing Incident reader without recursive reads. It checks every canonical
comment reference with current staff identity and domain access; unsupported,
missing or tampered references deny the whole Incident. This preserves the
reader’s strict all-evidence visibility contract.

Deterministic spam Signals may have no primary subject. The resolver follows their
verified canonical Event references to real comment targets; it never treats an
Event ID as a comment ID or accepts a client-provided target list. Collector
admission retains its existing exact-current-fact semantics.

## Evidence and current state

The read projection contains bounded source metadata: observation time, observed
status, deterministic spam/profanity verdicts, retention eligibility date and
opaque target identifiers. Current status, edit time and current target version
are separate facts. The source digest proves whether the comment still matches
the observation; the current target digest includes current parent/comment state
and is not presented as an observed historical version.

Comment bodies, rendered HTML, member identities, email, IP addresses and raw
canonical envelopes are not copied into the evidence projection. This slice does
not invent historical text snapshots.

An actual soft-deleted status can be shown after domain access succeeds. Missing
physical comments or Events are unavailable, not presumed deleted or expired.
An Event past its retention eligibility date can remain available because Signal
references retain it; the timestamp does not grant authority or invalidate an
otherwise retained record. Access loss retains the existing fail-closed Incident
visibility boundary.

## HTTP and interaction

`GET /api/admin/agents/incidents/{id}/evidence` accepts only an optional bounded
cursor. Shared App code validates the exact response and Incident binding;
reference and scaffold routes are matching wrappers. Missing installation is
unavailable rather than an empty page.

Evidence is grouped by canonical comment Event with related Signal IDs. A page
contains at most ten items; the source reference set is capped at 100 and excess
is rejected rather than silently treated as complete. Continuation is bound to
current authorization, Incident generation and source/current facts.

Selection requires matching the Incident generation, target and current version
against the server-provided response choices. Selection never prepares, approves
or executes a plan automatically. Loading, pagination, stale data and access loss
clear the previous selection. Existing write interlocks and polling behavior
remain shared with feedback, workflow and response execution.

## Remaining boundaries

Only the installed canonical comment source is supported. Document/report evidence,
model assessments, notifications and other recipe/evaluation gates remain
separate. Explicit Agent designation is covered by the subsequent
[assignment flow](r6-incident-assignment-flow.md). Existing approval, execution and retention owners keep their
semantics. Versions, changesets, lockfile and schema remain unchanged.

## Verification

Independent review covered source integrity, fresh staff identity, strict all-source
visibility, parent/current-version cursor binding and stale browser selection.
The reviewed source passed:

- `pnpm verify --concurrency=1`: all 113 workspace tasks, including 2,172 Core
  unit cases and 631 App cases (37 Incident HTTP boundary cases).
- `pnpm lint`: all 41 tasks; changed-file formatting, links and `git diff --check`.
- PostgreSQL: all 40 cases across evidence, collector, Moderator Incident,
  moderation execution/content and Incident Studio/Gateway/workflow suites.
  The new five cases exercise real observer → collector → subject-null Signal →
  strict evidence ACL → trusted target → staff approval-plan creation, with no
  provider, Runtime or moderation effect during review/planning.
- Production browser: all nine Incident cases across the initial eight passing
  cases and one corrected fixture rerun. The new fixture initially reused a target
  object across rows, which the canonical parser correctly rejected; cloning the
  fixture target fixed it without a product change or rebuild. Evidence recovery,
  pagination and exact target selection were exercised at 390/1280 widths.

The first concurrent workspace run hit an existing Runtime job test's five-second
timeout; all Core tests passed in the final serial workspace run without changing
that test or its timeout. An extra PostgreSQL run overlapped incomplete build
output and was stopped; only the later complete 40-case run is counted above.

Fresh packed-consumer verification passed with all 40 public packages packed from
the verified workspace into an isolated project. Install, configuration-inclusive
typecheck, generated schema/migrations, Agent foundation checks, production build
and the operations journey passed. Installed Core agents, App Incident handler
and Admin client bytes matched the verified producer artifacts. Desktop/mobile
screenshots were visually reviewed with no clipping or horizontal overflow.

These are affected-slice checks, not the full R5/R6 acceptance gate. Dedicated
Redis, theme, native preview and spoken assistive-technology acceptance were not
rerun for this slice; optional integration skips in unit runs are not counted as
passing integration coverage.
