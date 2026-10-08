# R6 Moderator observed-evidence recipe

The explicitly installed `moderator.repeated-link-spam` v1 recipe connects Studio
setup to current observed-comment evidence, a quarantine proposal and existing
human approval. It builds on the [Moderator collector](r6-moderator-flow.md) and
[Runtime continuation](r6-moderator-runtime-flow.md) owners.

## Explicit installation and setup

Hosts include `npCreateAgentModeratorRecipeDefinitionV1()` from
`@nexpress/core/agent-contract` in their existing Runtime registry. They create
`createAgentModeratorRecipeSourceV1({ incidents })` from `@nexpress/core/agents`
with the actual installed Incident read owner, then pass that issued source as
`moderatorEvidence` to both `createAgentRuntimeContextV1` and
`createAgentModerationServiceV1`. Collector/observer, authority, moderation facade,
approval, provider connection and worker installation remain separate explicit
host responsibilities. Missing or unissued sources cannot authorize proposals.

Studio offers “Use Moderator human approval setup” when the installed catalog
supports its recipe, scopes and capability mode. It prepares an approved-autonomy
draft with `incident:read`, `moderation:execute`, the existing Runtime-required
`site:read` scope, and only `moderation.quarantine`.
A collection and verified provider/model must be selected explicitly. Both the
provider connection and effective policy must permit `sensitive-approved` data. The preset
uses a fixed 600-second observation window, three independent accounts and five
items. Its bounded budgets are narrowed by current site/deployment ceilings.
Saving does not delegate staff authority or activate the Agent.

The recipe permits manual runs only and has no structured manual input. Its
response schema permits completion or one exact quarantine proposal; it cannot
request `execute_approved` or restoration. Canonical provider requests retain the
existing Moderator classification task and additionally accept its interactive
Runtime task; current installed recipe/task/schema binding still governs dispatch. The retained legacy
`automaticConfidenceBasisPoints` setting grants no execution authority and has
no setup control. Every proposal needs the existing human approval. Restoration
remains the separate existing staff or approved Runtime operation.

## Current source and approval boundary

The source uses the existing Incident visibility owner and a read-only authority
facet; it does not invent a capability invocation. It scans at most ten visible
open/investigating spam Incidents and accepts at most ten attached Signals per
Incident and 100 unique event references overall. The reused Incident owner may
read its own bounded Signal projection before this tighter eligibility check. Actual canonical Signal/Event evidence and
current comment ACLs, status, version, body-observation binding and parent
visibility are checked before rerunning the existing deterministic detector with
the selected settings. Missing, edited, hidden, cross-site or inconsistent facts
exclude the entire Incident.

The provider receives at most ten stably ordered, target-deduplicated candidates
as a `sensitive-approved` server fact. Each candidate includes exact proposal
bytes, Incident/Signal/Event references and advisory aggregate counts. Raw
comment text/HTML, link domains, member identifiers, Incident prose and original
restoration state are excluded. A bounded scan overflow is explicitly
`truncated`; no mutation is permitted from a truncated result. Rule scores and
counts are evidence, never approval or a model-quality claim.

Context attestation rereads these sources before provider dispatch with the
original capture timestamp. Moderation checks exact current candidate membership
after inference before persisting a proposal and again during fresh approval
inspection and execution. A supporting comment change invalidates the proposal
even when its chosen target has not changed. Existing current authority, policy,
approval signatures, target versions, budgets, CAS and transaction owners remain
in force. Completed receipt projection still validates retained evidence and
current authority without requiring pre-effect candidate eligibility: successful
quarantine necessarily changes that candidate's current status. One run proposes
at most one target. Once quarantine makes a retained source ineligible, that
Incident no longer supplies candidates; remaining campaign response needs staff
review or new valid evidence, not a batch of automatic quarantines.

## Acceptance boundary

The local journey uses real observed comment writes, the collector/detector,
Incident owner, Runtime, PostgreSQL and signed human approval with a deterministic
local provider. This establishes orchestration and refusal behavior, not actual
model usefulness or production false-positive quality. The Studio browser journey
uses real production rendering/login with fixture-backed catalog and draft APIs;
Runtime persistence is covered separately by PostgreSQL tests.

This bundle does not close AP-601, AP-605, AP-606 or R6. Broader sources, automatic
moderation policy and real-model/production evaluation remain open. No provider
calls, credentials, automatic activation, migrations, versions or changesets are
introduced.

## Local verification (2026-10-08)

- PostgreSQL: 45 cases across seven files passed with an explicit isolated test
  database and no skips. The nine new recipe cases cover actual observed writes,
  complete approved quarantine, edited/missing/cross-site evidence, a supporting
  edit after inference and after approval, an unrelated current-version target,
  bounded overflow and missing source installation. Existing Collector, Incident,
  Gateway, Runtime context/executor and approved moderation regressions passed.
- Pure canonical/recipe checks: ten cases passed, including compatibility for
  existing classification requests and denial of unrelated recipe tasks.
  The Moderator, Operator and Publisher Admin preset suites passed six cases.
- `pnpm verify --concurrency=2`: all 113 workspace tasks passed, including Core
  2,273, Admin 183, App 681 and Web 164 unit cases, dependency builds and the
  reference production build/typecheck. `pnpm lint`: all 41 tasks passed.
- Production browser: the Moderator setup and existing typed-draft regression
  passed without retries. The new setup captures were also inspected at 390px
  and 1280px after finishing viewport animations. Captures use the test runner's
  artifact directory. A subsequent artifact-path-only edit passed Web typecheck.
- Fresh packed consumer: all 40 public packages and 50 stages passed outside the
  workspace. The installed factory and source exports, activation-required scopes,
  manual/approved/quarantine-only contract and resume budget were checked. The
  generated app passed typechecking, its own migration generation/application,
  Agent foundation checks (52 tables, 365 critical and 17 deferred constraints),
  production build and scaffold command journey. Eight relevant Core, Admin and
  App JavaScript/declaration entry files matched the frozen producer bytes.
- Self-review, modified-file formatting, local document links and `git diff --check`
  passed. The final nine PostgreSQL cases were repeated successfully after a
  fixture-only repair for writes crossing an observation-window boundary.
  The pre-existing handoff edit was preserved byte-for-byte.

The ordinary unit run retained three opt-in live Redis skips. Redis integration,
theme PostgreSQL and native preview were not rerun for this scoped recipe bundle.
These checks do not constitute the full R6 gate or real-model quality evidence.
