# Read-only Moderator semantic assessment

## Explicit alternative

`npCreateAgentModeratorAssessmentRecipeDefinitionV1` supplies an alternative to
the existing quarantine-proposal recipe. The recipe id and wire version remain
`moderator.repeated-link-spam` / 1; its distinct instruction is
`moderator.semantic-assessment` / 1 and its task is the existing
`moderation-classification`. The [code-owned profile guard](../../../packages/core/src/agent-contract/moderator-assessment-recipe-contract.ts)
checks its instruction, response shape and read-only capability surface.

Hosts can select `npCreateAgentR6AssessmentRecipeRegistryV1` and the matching
`npAgentModeratorAssessmentRecipeSetupV1` draft. It grants observation of
`incident.get` / `incident.list`, with explicit current staff delegation,
`content:read`, `incident:read`, `site:read`, selected collections and
`sensitive-approved` data ceilings. The registry supports manual, scheduled and
event admission. Saving or importing it installs no connection, trigger, worker
or Runtime and does not migrate an existing Agent to another profile. Choose
one Moderator profile per installed registry.

## Current evidence and bounded judgment

The branded [source owner](../../../packages/core/src/agent/moderator-assessment-source.ts)
reads at most one currently authorized open/investigating spam or abuse Incident,
ten Signals, one hundred retained Events and ten unique current content targets.
Before selecting that Incident, manual/scheduled discovery follows at most 25
raw Incident pages, including empty ACL-filtered pages, and skips fingerprints
already at their site or Agent daily/cooldown limits. Event admission selects
among at most 25 Incidents whose attached canonical Signals actually reference
that Run's exact Event. It does not substitute an unrelated older campaign.
Once a provider attempt is retained, its proven Incident identity/version binds
the current Run's retries and source rechecks; access loss fails closed instead
of changing the paid attempt's target.
Existing source owners recheck event integrity, source versions, staff authority,
collection scope and target ACLs. Comment Markdown and the branded document
reader's visible-field text projection produce excerpts of at most 2,000
characters each. Hidden fields never become excerpts; unpublished content needs
an explicit draft-read grant. Raw excerpts remain untrusted provider context.

[Runtime context](../../../packages/core/src/agent/runtime-context.ts) binds safe
metadata and excerpt digests before dispatch. Missing, stale, oversized or
truncated evidence requires `uncertain`; a non-uncertain classification must cite
every admitted excerpt digest. The profile cannot propose a capability or effect.
Its confidence score is model output, not a calibrated probability.
These are per-assessment bounds. A large Incident still requires `uncertain`
when its full evidence exceeds the ten-target or other input bounds. There is
no semantic segment continuation or claim that the whole Incident was classified.

The existing site quota lock and [analysis budget owner](../../../packages/core/src/agent/moderator-assessment-budget.ts)
enforce per-Incident-fingerprint daily limits and cooldowns at site and Agent
levels. Reserved, dispatched and ambiguous attempts retain their charge;
ordinary provider/token/cost ceilings also apply to uncertainty and retries.
Discovery uses the same validated retained accounting; reservation independently
rechecks it under the existing site quota lock. A charged first Incident cannot
consume a new fingerprint's available analysis merely by occupying the list head.

## Retained provenance and display

The [assessment recorder](../../../packages/core/src/agent/incident-assessment-service.ts)
requires a confirmed provider success, exact Run/request/response/profile bindings
and a fresh source/version recheck. It appends one `agent_assessment` timeline
entry, advances the Incident version and replays the same call idempotently.
It never changes content, deterministic facts, approval or containment state.

The pre-dispatch diagnostic stores safe evidence metadata for thirty days.
Timeline details retain only bounded model judgment, authorized source references
and hashes. After diagnostic expiry, the retained classification manifest still
binds that exact metadata and every excerpt digest. Studio independently checks
current Incident access and stored proof, labels the result as an AI assessment
and omits invalid legacy or forged entries.
The optional [Studio list summary](r6-incident-studio-flow.md#review-behavior)
shows assessment availability only after verifying the newest retained assessment
entry. No entry means none recorded; invalid evidence remains unknown. It exposes
no model prose in the list.

## Verification boundary

PostgreSQL journeys use actual services and persistence with fake inference.
They cover mixed documents/comments, hidden fields, source drift, exact replay,
source/digest forgery, diagnostic expiry, bounded truncation, empty evidence and
rejection before reservation/inference when the recording owner is absent.
Additional paths cover empty-ACL-page continuation, an already charged open
Incident followed by a new campaign, actual Event-to-Incident admission, fixed
attempt identity after access loss and verified/unknown Studio list summaries.
The versioned eight-case English/Korean synthetic corpus covers spam, abuse,
benign repeated-reference controls, hostile instructions and uncertainty.
These are conformance checks, not measured semantic accuracy. Actual-model
Runtime validation and broader production usefulness remain outside this bundle.
The additional versioned evaluation fixtures in the R6 bundle remain synthetic
conformance inputs; adding them does not establish measured model accuracy.

The 2026-10-15 focused persistence run passed all 24 cases across semantic
assessment, Incident Studio and actual comment-evidence paging. The separate
fingerprint-budget suite retains five passing paths for site/Agent limits,
cooldown, exact retry accounting, other fingerprints and ambiguous attempts.
The [Studio flow](r6-incident-studio-flow.md#current-paging-and-optional-summary-verification)
records the connected optional summaries and final-page response checks.
